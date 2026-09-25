/*
 * LX Focus 原生辅助进程
 *
 * 职责（Electron 层做不到的两件事）：
 *   1. 低级键盘钩子 WH_KEYBOARD_LL —— 吞掉 Win 键、Alt+Tab、Alt+Esc、Ctrl+Esc、Ctrl+Shift+Esc
 *   2. 前台窗口看门狗 —— 发现非白名单进程跑到前台就上报，并按需终止或最小化
 *
 * 为什么是独立 exe 而不是 Node 原生模块：
 *   Node addon 必须跟着 Electron 的 ABI 重编译，而普通 exe 与 Electron 版本完全解耦，
 *   崩溃也拖不垮主进程。另外它是个纯用户态程序，不装驱动、不需要管理员权限。
 *
 * 与主进程的通信协议（stdin / stdout 各一行 JSON）：
 *   主进程 → 本进程： {"cmd":"stop"}
 *   本进程 → 主进程： {"type":"ready"}
 *                    {"type":"violation","kind":"process|shortcut","detail":"chrome.exe"}
 *                    {"type":"unsupported","detail":"..."}
 *                    {"type":"error","detail":"..."}
 *
 * 注意：本文件刻意使用 C# 5 语法（不使用字符串插值、空条件运算符、表达式成员），
 * 以便直接用 Windows 自带的 csc.exe 编译，用户无需安装任何开发工具链。
 */

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class LxFocusGuard
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_QUIT = 0x0012;
    private const int SW_MINIMIZE = 6;

    private const int VK_TAB = 0x09;
    private const int VK_ESCAPE = 0x1B;
    private const int VK_F4 = 0x73;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;
    private const int VK_APPS = 0x5D;
    private const int VK_SHIFT = 0x10;
    private const int VK_CONTROL = 0x11;
    private const int VK_MENU = 0x12;

    private static IntPtr hookId = IntPtr.Zero;
    private static LowLevelKeyboardProc hookProc;
    private static volatile bool running = true;
    private static uint mainThreadId;
    private static string ownerWindowTitle = "LX Focus";

    private static bool swallowKeys;
    private static bool watchForeground;
    private static bool killOnViolation;
    private static int parentPid;
    private static readonly HashSet<string> allowProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    /** 无论如何都不终止的系统进程，误杀会导致桌面崩溃 */
    private static readonly HashSet<string> protectedProcesses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "system", "idle", "registry", "smss", "csrss", "wininit", "winlogon", "services",
        "lsass", "svchost", "dwm", "explorer", "taskhostw", "fontdrvhost", "ctfmon",
        "searchhost", "startmenuexperiencehost", "shellexperiencehost", "runtimebroker",
        "sihost", "audiodg", "conhost", "dllhost", "spoolsv", "wudfhost", "lsaiso",
        "securityhealthservice", "securityhealthsystray", "textinputhost",
    };

    private static readonly List<IntPtr> minimizedWindows = new List<IntPtr>();
    private static long lastShortcutReportTicks;
    private static long lastForegroundReportTicks;
    private static DateTime lastWatchdogHit = DateTime.MinValue;
    private static string lastForegroundName = "";

    /*
     * 刻意绕开 Console.In / Console.Out：
     * Console.OutputEncoding 在 stdout 被重定向时可能先吐一个 UTF-8 BOM，
     * 而 stdin 是管道时设置 Console.InputEncoding 又会抛异常。
     * 直接对标准流写字节，编码完全由我们掌控。
     */
    private static readonly System.IO.Stream stdoutStream = Console.OpenStandardOutput();
    private static readonly UTF8Encoding utf8NoBom = new UTF8Encoding(false);
    private static readonly byte[] newlineBytes = new byte[] { 10 };

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    private static void Main(string[] args)
    {
        ParseArgs(args);

        Emit("{\"type\":\"ready\"}");

        if (parentPid > 0)
        {
            Thread watchdogParent = new Thread(ParentWatchLoop);
            watchdogParent.IsBackground = true;
            watchdogParent.Start();
        }

        Thread stdinReader = new Thread(StdinLoop);
        stdinReader.IsBackground = true;
        stdinReader.Start();

        if (watchForeground)
        {
            Thread watch = new Thread(ForegroundWatchLoop);
            watch.IsBackground = true;
            watch.Start();
        }

        if (swallowKeys && Environment.OSVersion.Platform == PlatformID.Win32NT)
        {
            RunKeyboardHook();
        }
        else
        {
            while (running) Thread.Sleep(200);
        }

        Cleanup();
    }

    private static void ParseArgs(string[] args)
    {
        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];
            switch (arg)
            {
                case "--swallow-keys":
                    swallowKeys = true;
                    break;
                case "--watch-foreground":
                    watchForeground = true;
                    break;
                case "--kill-on-violation":
                    killOnViolation = true;
                    break;
                case "--parent-pid":
                    if (i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out parentPid);
                    }
                    break;
                case "--allow":
                    if (i + 1 < args.Length)
                    {
                        string list = args[++i];
                        string[] parts = list.Split(',');
                        for (int p = 0; p < parts.Length; p++)
                        {
                            string name = parts[p].Trim().ToLowerInvariant();
                            if (name.Length > 0) allowProcesses.Add(name);
                        }
                    }
                    break;
                case "--title":
                    if (i + 1 < args.Length) ownerWindowTitle = args[++i];
                    break;
            }
        }
    }

    // ---------------------------------------------------------------- 键盘钩子

    private static void RunKeyboardHook()
    {
        mainThreadId = GetCurrentThreadId();
        hookProc = HookCallback;
        IntPtr module = GetModuleHandle(null);
        hookId = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, module, 0);
        if (hookId == IntPtr.Zero)
        {
            Emit("{\"type\":\"unsupported\",\"detail\":\"键盘钩子安装失败，Win 键与 Alt+Tab 无法拦截\"}");
            while (running) Thread.Sleep(200);
            return;
        }

        while (running)
        {
            // 低级键盘钩子必须依附在一个消息循环上
            if (!PeekMessage()) Thread.Sleep(10);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

    private static bool PeekMessage()
    {
        MSG msg;
        while (PeekMessage(out msg, IntPtr.Zero, 0, 0, 1))
        {
            if (msg.message == WM_QUIT) return false;
        }
        return true;
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int message = wParam.ToInt32();
            if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN)
            {
                KBDLLHOOKSTRUCT info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                int vk = (int)info.vkCode;
                if (ShouldSwallow(vk))
                {
                    ReportShortcut(vk);
                    return (IntPtr)1; // 吞掉这次按键
                }
            }
        }
        return CallNextHookEx(hookId, nCode, wParam, lParam);
    }

    private static bool ShouldSwallow(int vk)
    {
        // Win 键本身：连同基于它的 Win+D / Win+R 等组合一起失效
        if (vk == VK_LWIN || vk == VK_RWIN || vk == VK_APPS) return true;

        bool alt = IsDown(VK_MENU);
        bool ctrl = IsDown(VK_CONTROL);
        bool shift = IsDown(VK_SHIFT);

        if (vk == VK_TAB && alt) return true;
        if (vk == VK_ESCAPE && (alt || ctrl)) return true;
        if (vk == VK_F4 && alt) return true;
        if (vk == VK_ESCAPE && ctrl && shift) return true;
        return false;
    }

    private static bool IsDown(int vk)
    {
        return (GetAsyncKeyState(vk) & 0x8000) != 0;
    }

    private static void ReportShortcut(int vk)
    {
        long now = DateTime.Now.Ticks;
        // 长按会连续触发，做节流避免刷屏
        if (now - lastShortcutReportTicks < TimeSpan.TicksPerSecond) return;
        lastShortcutReportTicks = now;
        Emit("{\"type\":\"violation\",\"kind\":\"shortcut\",\"detail\":\"" + VkName(vk) + "\"}");
    }

    private static string VkName(int vk)
    {
        switch (vk)
        {
            case VK_LWIN: return "Win 键";
            case VK_RWIN: return "Win 键";
            case VK_APPS: return "菜单键";
            case VK_TAB: return "Alt+Tab";
            case VK_ESCAPE: return "Alt/Ctrl+Esc";
            case VK_F4: return "Alt+F4";
            default: return "VK_" + vk;
        }
    }

    // ---------------------------------------------------------------- 前台窗口看门狗

    private static void ForegroundWatchLoop()
    {
        while (running)
        {
            try
            {
                CheckForeground();
            }
            catch (Exception ex)
            {
                Emit("{\"type\":\"error\",\"detail\":\"" + Escape(ex.Message) + "\"}");
            }
            Thread.Sleep(400);
        }
    }

    private static void CheckForeground()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return;

        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid == 0) return;
        if (parentPid > 0 && pid == (uint)parentPid) return;

        string name = "";
        try
        {
            Process process = Process.GetProcessById((int)pid);
            name = process.ProcessName.ToLowerInvariant();
            if (!name.EndsWith(".exe")) name = name + ".exe";
        }
        catch
        {
            return; // 进程已退出，忽略
        }

        if (allowProcesses.Contains(name)) return;

        // 同一个窗口反复触发时折叠成一次，避免骚扰
        if (name == lastForegroundName && (DateTime.Now - lastWatchdogHit).TotalSeconds < 3) return;
        lastWatchdogHit = DateTime.Now;
        lastForegroundName = name;

        Emit("{\"type\":\"violation\",\"kind\":\"process\",\"detail\":\"" + Escape(name) + "\"}");

        if (protectedProcesses.Contains(name))
        {
            // 系统进程只最小化，不动手终止
            ShowWindow(hwnd, SW_MINIMIZE);
            return;
        }

        if (killOnViolation)
        {
            try
            {
                Process target = Process.GetProcessById((int)pid);
                target.Kill();
                return;
            }
            catch
            {
                // 权限不足等情况退化为最小化
            }
        }

        minimizedWindows.Add(hwnd);
        ShowWindow(hwnd, SW_MINIMIZE);
    }

    // ---------------------------------------------------------------- 生命周期

    private static void StdinLoop()
    {
        try
        {
            using (System.IO.StreamReader reader = new System.IO.StreamReader(Console.OpenStandardInput(), utf8NoBom))
            {
                string line;
                while (running && (line = reader.ReadLine()) != null)
                {
                    if (line.IndexOf("\"stop\"", StringComparison.OrdinalIgnoreCase) >= 0) break;
                }
            }
        }
        catch
        {
            // 管道异常等同于对端已退出
        }
        // 读到 EOF 或显式 stop：认定主进程已结束，收工
        running = false;
        StopMessageLoop();
    }

    private static void ParentWatchLoop()
    {
        while (running)
        {
            Thread.Sleep(1000);
            try
            {
                Process parent = Process.GetProcessById(parentPid);
                if (parent.HasExited)
                {
                    running = false;
                    StopMessageLoop();
                    return;
                }
            }
            catch
            {
                running = false;
                StopMessageLoop();
                return;
            }
        }
    }

    private static void StopMessageLoop()
    {
        if (mainThreadId != 0)
        {
            PostThreadMessage(mainThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        }
    }

    private static void Cleanup()
    {
        if (hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(hookId);
            hookId = IntPtr.Zero;
        }

        // 把被我们最小化的窗口还原回去，别留下烂摊子
        for (int i = 0; i < minimizedWindows.Count; i++)
        {
            try
            {
                ShowWindow(minimizedWindows[i], 9); // SW_RESTORE
            }
            catch
            {
                // 忽略
            }
        }
        minimizedWindows.Clear();
    }

    private static void Emit(string json)
    {
        try
        {
            byte[] bytes = utf8NoBom.GetBytes(json);
            stdoutStream.Write(bytes, 0, bytes.Length);
            stdoutStream.Write(newlineBytes, 0, 1);
            stdoutStream.Flush();
        }
        catch
        {
            // 主进程已经走了
        }
    }

    private static string Escape(string value)
    {
        if (value == null) return "";
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ").Replace("\r", " ");
    }
}
