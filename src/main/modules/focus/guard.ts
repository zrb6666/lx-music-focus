import { globalShortcut } from 'electron'
import { NativeGuard } from './nativeGuard'

/** Electron 层能吞掉的快捷键（Win 键与 Alt+Tab 不在其列，必须靠原生钩子） */
const SWALLOW_SHORTCUTS = [
  'Alt+F4',
  'CommandOrControl+W',
  'CommandOrControl+Shift+I',
  'F11',
]

/**
 * 专注拦截层：四层防线里的前三层。
 *
 * 1. 窗口层：全屏独占（kiosk）+ 屏幕级置顶 + 失焦自动夺回
 * 2. 快捷键层：吞掉常见退出键；Win / Alt+Tab 交给原生低级键盘钩子
 * 3. 进程层：原生辅助进程的前台窗口看门狗
 *
 * 第 4 层「意志层」（解锁码）在渲染层的专注 store 中实现。
 */
export class FocusGuard {
  private hooks: LX.FocusGuardHooks | null = null
  private engaged = false
  private strict = false
  private killOnViolation = false
  private readonly nativeGuard = new NativeGuard()
  private nativeRunning = false
  private registered: string[] = []
  private disposers: Array<() => void> = []
  private restoreWindowState: (() => void) | null = null
  private refocusCooldownUntil = 0
  private refocusWindowStart = 0
  private refocusCount = 0
  private refocusSuspendedUntil = 0

  get isEngaged(): boolean {
    return this.engaged
  }

  report(): LX.FocusGuardReport {
    const active: string[] = []
    const unsupported: string[] = []

    if (this.engaged) {
      active.push('全屏独占（kiosk）', '屏幕级置顶', '窗口失焦自动夺回', '关闭窗口拦截')
      if (this.registered.length > 0) active.push('常用退出快捷键屏蔽')
      if (this.nativeRunning) {
        active.push('Win 键 / Alt+Tab 拦截', '前台窗口看门狗')
        active.push(
          this.killOnViolation ? '违规进程终止（有丢失未保存内容的风险）' : '违规窗口最小化',
        )
      }
    }

    /*
     * 待机态要说清楚「还没启用」，不能沿用 engaged 时的判断。
     * this.strict 只在 engage() 里由选项写入，待机时恒为 false，
     * 若直接拿它判断，会把「用户设置里开了严格模式但还没开始专注」误报成
     * 「未开启严格模式」——用户会以为设置没生效。
     */
    if (!this.engaged) {
      unsupported.push('Win 键 / Alt+Tab / 前台看门狗（开始专注后启用）')
    } else if (!this.strict) {
      unsupported.push('Win 键 / Alt+Tab / 前台看门狗（未开启严格模式）')
    } else if (!this.nativeRunning) {
      // 走到这里有两种情况：找不到辅助进程，或找到了但没能起来 / 中途退出。
      // 两者对用户的含意不同，报告里要分开说，不能含糊成一句「未找到」。
      unsupported.push(
        this.nativeGuard.isAvailable()
          ? 'Win 键与 Alt+Tab（原生辅助进程未能启动或已中途退出）'
          : 'Win 键与 Alt+Tab（未找到原生辅助进程，需先构建 native/LxFocusGuard.exe）',
      )
    }
    unsupported.push('Ctrl+Alt+Del（操作系统安全注意序列，任何第三方软件均无法拦截）')
    unsupported.push('任务管理器强行结束进程（操作系统保留的逃生通道）')
    unsupported.push('安全模式重启')

    return {
      platform: process.platform,
      nativeHelper: this.nativeRunning,
      active,
      unsupported,
    }
  }

  async engage(hooks: LX.FocusGuardHooks, options: LX.FocusGuardEngageOptions): Promise<LX.FocusGuardReport> {
    if (this.engaged) return this.report()
    this.hooks = hooks
    this.strict = options.strict
    this.killOnViolation = options.killOnViolation
    this.engaged = true

    // 进入 kiosk / 切换置顶本身会触发一次 blur，给一个宽限期避免误判违规
    this.refocusCooldownUntil = Date.now() + 1200

    const win = hooks.getWindow()
    if (win && !win.isDestroyed()) {
      const prevAlwaysOnTop = win.isAlwaysOnTop()
      // isSkipTaskbar 在部分 Electron 版本的类型声明里缺失，运行时才有，做一次能力探测
      const prevSkipTaskbar = 'isSkipTaskbar' in win
        ? (win as unknown as { isSkipTaskbar: () => boolean }).isSkipTaskbar()
        : false
      this.restoreWindowState = () => {
        if (win.isDestroyed()) return
        win.setKiosk(false)
        win.setAlwaysOnTop(prevAlwaysOnTop)
        win.setSkipTaskbar(prevSkipTaskbar)
      }

      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.setSkipTaskbar(true)
      win.setAlwaysOnTop(true, 'screen-saver')
      win.setKiosk(true)
      win.focus()

      const onBlur = () => { this.handleBlur() }
      const onClose = (event: Electron.Event): void => {
        if (!this.engaged) return
        event.preventDefault()
        this.hooks?.onViolation('shortcut', '尝试关闭主窗口')
        this.hooks?.onToast('warn', '专注进行中，请先结束专注再退出')
      }
      win.on('blur', onBlur)
      win.on('close', onClose)
      this.disposers.push(() => {
        if (win.isDestroyed()) return
        win.off('blur', onBlur)
        win.off('close', onClose)
      })
    }

    for (const accelerator of SWALLOW_SHORTCUTS) {
      try {
        // LX Music 自身可能已占用同名快捷键，注册失败直接跳过
        if (globalShortcut.register(accelerator, () => { this.handleShortcut(accelerator) })) {
          this.registered.push(accelerator)
        }
      } catch {
        // 忽略
      }
    }

    // 原生辅助进程会全局吞键 + 监视前台窗口，属于「重武器」，只在严格模式下启用。
    // 非严格模式退化为 kiosk + 快捷键屏蔽，用户仍能正常退出。
    let started = false
    if (this.strict) {
      const allow = [
        'lx focus.exe',
        'lx-focus.exe',
        'lx music.exe',
        'lx-music-desktop.exe',
        'electron.exe',
        'explorer.exe',
        'consent.exe',
      ]
      // 这里必须等 ready 握手：spawn 成功不等于钩子装上了
      started = await this.nativeGuard.start({
        allowProcesses: allow,
        swallowKeys: true,
        watchForeground: true,
        killOnViolation: this.killOnViolation,
      })
      if (started) {
        this.nativeRunning = true
        this.disposers.push(
          this.nativeGuard.onMessage((message) => {
            if (message.type === 'violation') {
              this.hooks?.onViolation(
                message.kind === 'process' ? 'process' : 'shortcut',
                message.detail ?? '检测到离开专注界面',
              )
            } else if (message.type === 'unsupported' && message.detail) {
              this.hooks?.onToast('warn', message.detail)
            }
          }),
          this.nativeGuard.onLost((detail) => { this.handleNativeLost(detail) }),
        )
      }
    }

    hooks.onToast(
      'info',
      !this.strict
        ? '专注锁已生效（基础防护）'
        : started
          ? '专注锁已生效，全部防护已开启'
          : '专注锁已生效（严格模式，但原生拦截层未能启动，Win 键 / Alt+Tab 拦不住）',
    )

    return this.report()
  }

  disengage(): LX.FocusGuardReport {
    if (!this.engaged) return this.report()
    this.engaged = false

    for (const dispose of this.disposers) dispose()
    this.disposers = []

    for (const accelerator of this.registered) {
      try {
        globalShortcut.unregister(accelerator)
      } catch {
        // 忽略
      }
    }
    this.registered = []

    this.nativeGuard.stop()
    this.nativeRunning = false

    this.restoreWindowState?.()
    this.restoreWindowState = null

    this.refocusCount = 0
    this.refocusSuspendedUntil = 0
    this.hooks = null
    this.strict = false
    this.killOnViolation = false

    return this.report()
  }

  dispose(): void {
    this.disengage()
    this.nativeGuard.dispose()
    this.hooks = null
  }

  private handleShortcut(accelerator: string): void {
    if (!this.engaged) return
    this.hooks?.onViolation('shortcut', `按下被拦截的快捷键 ${accelerator}`)
    this.hooks?.onToast('warn', `${accelerator} 已被专注锁拦截`)
  }

  /**
   * 辅助进程在专注过程中意外消失。
   *
   * 钩子随进程一起卸载，Win 键 / Alt+Tab 当场恢复可用。这里必须把 nativeRunning
   * 落回 false 并通知界面重取报告 —— 否则 UI 会继续挂着那份「全部防护已开启」，
   * 用户以为拦住了，实际上什么都没拦。
   */
  private handleNativeLost(detail: string): void {
    if (!this.engaged) return
    this.nativeRunning = false
    this.hooks?.onToast(
      'warn',
      detail
        ? `原生拦截层已退出（${detail}），Win 键 / Alt+Tab 已拦不住`
        : '原生拦截层已退出，Win 键 / Alt+Tab 已拦不住',
    )
    this.hooks?.onNativeLost?.(detail)
  }

  private handleBlur(): void {
    if (!this.engaged) return
    const now = Date.now()
    if (now < this.refocusCooldownUntil) return
    if (now < this.refocusSuspendedUntil) return

    // 单次失焦只尝试有限次夺回，避免与 UAC 提权弹窗互相抢焦点形成死循环
    if (now - this.refocusWindowStart > 3000) {
      this.refocusWindowStart = now
      this.refocusCount = 0
    }
    this.refocusCount += 1

    if (this.refocusCount > 3) {
      this.refocusSuspendedUntil = now + 5000
      this.hooks?.onToast('warn', '检测到系统弹窗，已暂停焦点夺回 5 秒')
      return
    }

    this.refocusCooldownUntil = now + 400
    setTimeout(() => {
      const win = this.hooks?.getWindow()
      if (!win || win.isDestroyed() || win.isFocused()) return
      win.setAlwaysOnTop(true, 'screen-saver')
      win.focus()
      win.moveTop()
      this.hooks?.onViolation('blur', '离开专注界面，已自动夺回')
    }, 160)
  }
}

export const focusGuard = new FocusGuard()
