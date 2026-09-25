import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const HELPER_NAME = 'LxFocusGuard.exe'

/**
 * 等待 ready 握手的超时。
 *
 * 辅助进程启动后第一件事就是回报 {"type":"ready"}，正常是毫秒级；
 * 给 3 秒是为了留出冷启动与被杀软扫描的余量。
 */
const READY_TIMEOUT_MS = 3000

export interface NativeGuardMessage {
  type: 'ready' | 'violation' | 'unsupported' | 'error' | 'foreground'
  kind?: string
  detail?: string
}

/**
 * 解析原生辅助进程路径。
 *
 * 用独立 exe 而不是 Node 原生模块，是为了避开 Electron ABI 重编译的坑：
 * 辅助进程与 Electron 版本完全解耦，崩溃也拖不垮主进程。
 */
export const resolveHelperPath = (): string | null => {
  const candidates: string[] = []

  // 打包后：electron-builder 的 extraResources 把 native/bin 原样放进 resources/
  // 注意不能依赖 NODE_ENV 判断是否打包——开发模式跑构建产物时它也是 production
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'native', 'bin', HELPER_NAME))
    candidates.push(path.join(process.resourcesPath, 'native', HELPER_NAME))
  }

  // 开发 / 未打包：以项目根目录为基准
  candidates.push(path.join(process.cwd(), 'native', 'bin', HELPER_NAME))
  candidates.push(path.join(process.cwd(), 'native', HELPER_NAME))

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

export interface NativeGuardStartOptions {
  /** 允许出现在前台的进程名（小写，含 .exe），不视为违规 */
  allowProcesses: string[]
  /** 低级键盘钩子：屏蔽 Win / Alt+Tab / Alt+Esc / Ctrl+Esc */
  swallowKeys: boolean
  /** 前台窗口看门狗 */
  watchForeground: boolean
  /** 发现违规时是否直接终止对方进程 */
  killOnViolation: boolean
}

/**
 * 与 C# 原生辅助进程的 stdio 桥。
 *
 * 辅助进程不存在时整体降级为「不可用」，上层据此如实告知用户哪些防护没生效。
 */
export class NativeGuard {
  private child: ChildProcess | null = null
  private buffer = ''
  private readonly listeners = new Set<(message: NativeGuardMessage) => void>()
  private readonly lostListeners = new Set<(detail: string) => void>()
  /** 本次运行是否已收到 ready 握手 */
  private ready = false
  /** 等待握手的 resolve；只在 start() 期间有值 */
  private readyWaiter: ((ok: boolean) => void) | null = null
  /** 是否由 stop() 主动结束——主动结束不算「意外丢失」 */
  private stopping = false
  /** 辅助进程 stderr 上最后一条输出，用于解释它为什么没了 */
  private lastError = ''

  isAvailable(): boolean {
    return resolveHelperPath() !== null
  }

  isRunning(): boolean {
    return this.child !== null
  }

  onMessage(cb: (message: NativeGuardMessage) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /**
   * 订阅「辅助进程在专注过程中意外消失」。
   *
   * 这不只是日志问题：进程一没，低级键盘钩子就随之卸载，Win 键与 Alt+Tab
   * 立刻恢复可用。此时若沿用之前那份报告，界面会继续显示「Win 键 / Alt+Tab 拦截」
   * 已生效 —— 那是彻头彻尾的谎报，用户会以为拦住了而实际没有。
   */
  onLost(cb: (detail: string) => void): () => void {
    this.lostListeners.add(cb)
    return () => this.lostListeners.delete(cb)
  }

  /**
   * 启动辅助进程，并等它回报 ready 握手。
   *
   * 只判断 spawn 是否成功是不够的：进程能被创建、随后又立刻退出（被杀软拦下、
   * 缺运行时、钩子安装失败等）时 spawn 依然成功，上层就会据此宣布
   * 「全部防护已开启」。所以必须等握手，超时或提前退出一律视为启动失败。
   *
   * @returns 握手成功为 true；找不到可执行文件、超时、提前退出均为 false
   */
  async start(options: NativeGuardStartOptions): Promise<boolean> {
    if (this.child) return this.ready
    const exe = resolveHelperPath()
    if (!exe) return false

    const args = ['--parent-pid', String(process.pid)]
    if (options.swallowKeys) args.push('--swallow-keys')
    if (options.watchForeground) args.push('--watch-foreground')
    if (options.killOnViolation) args.push('--kill-on-violation')
    if (options.allowProcesses.length > 0) args.push('--allow', options.allowProcesses.join(','))

    this.stopping = false
    this.ready = false
    this.lastError = ''
    this.buffer = ''

    let child: ChildProcess
    try {
      child = spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    } catch {
      return false
    }

    this.child = child
    child.stdout?.setEncoding('utf-8')
    child.stdout?.on('data', (chunk: string) => { this.consume(chunk) })
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text) {
        this.lastError = text
        this.emit({ type: 'error', detail: text })
      }
    })
    child.on('exit', () => {
      const wasReady = this.ready
      const intentional = this.stopping
      if (this.child === child) this.child = null
      this.ready = false
      // 在等握手期间就退出：让 start() 立刻拿到失败结果，不必干等到超时
      const waiter = this.readyWaiter
      this.readyWaiter = null
      waiter?.(false)
      if (wasReady && !intentional) {
        this.emit({
          type: 'error',
          detail: `原生辅助进程已退出${this.lastError ? '：' + this.lastError : ''}`,
        })
        for (const cb of this.lostListeners) cb(this.lastError)
      }
    })

    const ok = await new Promise<boolean>(resolve => {
      this.readyWaiter = resolve
      setTimeout(() => {
        if (this.readyWaiter !== resolve) return
        this.readyWaiter = null
        resolve(false)
      }, READY_TIMEOUT_MS)
    })

    if (!ok) this.discard(child)
    return ok
  }

  /** 让辅助进程自行收尾（卸载钩子、恢复被最小化的窗口），再断开 */
  stop(): void {
    const child = this.child
    this.stopping = true
    this.ready = false
    this.readyWaiter = null
    if (!child) return
    try {
      child.stdin?.write(JSON.stringify({ cmd: 'stop' }) + '\n')
    } catch {
      // 管道可能已关闭
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // 已退出
      }
    }, 800)
    child.once('exit', () => { clearTimeout(timer) })
    this.child = null
    this.buffer = ''
  }

  dispose(): void {
    this.stop()
    this.listeners.clear()
    this.lostListeners.clear()
  }

  /** 启动失败时把它收干净，避免留一个半死的子进程 */
  private discard(child: ChildProcess): void {
    if (this.child === child) this.child = null
    this.ready = false
    try {
      child.kill()
    } catch {
      // 已经退出了
    }
  }

  private consume(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      // 子进程设置 Console.OutputEncoding 时可能在流首写入 UTF-8 BOM，
      // 不剥掉的话第一条消息（ready）永远解析不出来
      const line = this.buffer.slice(0, index).replace(/^\uFEFF/, '').trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line) {
        try {
          const message = JSON.parse(line) as NativeGuardMessage
          if (message.type === 'ready') this.markReady()
          this.emit(message)
        } catch {
          // 非 JSON 输出直接忽略
        }
      }
      index = this.buffer.indexOf('\n')
    }
    if (this.buffer.length > 64 * 1024) this.buffer = ''
  }

  private markReady(): void {
    this.ready = true
    const waiter = this.readyWaiter
    this.readyWaiter = null
    waiter?.(true)
  }

  private emit(message: NativeGuardMessage): void {
    for (const listener of this.listeners) listener(message)
  }
}
