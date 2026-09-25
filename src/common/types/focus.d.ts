import type { BrowserWindow } from 'electron'

declare global {
  declare namespace LX {
    /** 专注会话阶段 */
    type FocusPhase = 'idle' | 'preparing' | 'focusing' | 'paused' | 'breaking' | 'completed'

    /** 违规类型 */
    type FocusViolationKind = 'blur' | 'shortcut' | 'process' | 'manual'

    /**
     * 拦截层能力报告。
     *
     * 这里如实暴露「哪些防护生效、哪些做不到」是刻意的设计：
     * Windows 把 Ctrl+Alt+Del 划为安全注意序列，内核直接接管，
     * 任何用户态程序都无法拦截；任务管理器强杀进程同理。
     * 把边界摆在用户面前，比假装自己能封死一切更有价值。
     */
    interface FocusGuardReport {
      platform: string
      /** 原生辅助进程是否在跑（决定 Win 键 / Alt+Tab 能不能拦） */
      nativeHelper: boolean
      /** 当前实际生效的防护项 */
      active: string[]
      /** 明确无法防护的项 */
      unsupported: string[]
    }

    interface FocusGuardEngageOptions {
      /** 严格模式：启用原生辅助进程（Win 键 / Alt+Tab 拦截 + 前台看门狗） */
      strict: boolean
      /**
       * 终止违规进程。
       *
       * 与严格模式分开是有意为之：直接结束他人进程会丢失未保存的工作，
       * 属于破坏性操作，必须由用户显式开启（默认只最小化 + 记录违规）。
       */
      killOnViolation: boolean
    }

    interface FocusGuardHooks {
      getWindow: () => BrowserWindow | null
      onViolation: (kind: LX.FocusViolationKind, detail: string) => void
      onToast: (level: 'info' | 'warn' | 'error', text: string) => void
      /**
       * 原生拦截层在专注中途意外退出时调用。
       *
       * 界面收到后应重取报告，把「Win 键 / Alt+Tab 拦截」从已生效列表里撤下来 ——
       * 进程没了钩子就没了，继续显示已生效就是谎报。
       */
      onNativeLost?: (detail: string) => void
    }

    interface FocusNativeLostPayload {
      detail: string
      at: number
    }

    interface FocusViolationPayload {
      kind: LX.FocusViolationKind
      detail: string
      at: number
    }

    interface FocusToastPayload {
      level: 'info' | 'warn' | 'error'
      text: string
    }

    /** 一次完整的专注会话记录，用于统计 */
    interface FocusSessionRecord {
      id: string
      taskName: string
      startedAt: number
      endedAt: number
      plannedSec: number
      focusedSec: number
      completed: boolean
      violations: number
      playlistName: string | null
    }
  }
}

export {}
