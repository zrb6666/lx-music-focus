import { app, BrowserWindow } from 'electron'
import { FOCUS_GUARD_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainHandle } from '@common/mainIpc'
import { getWebContents, sendEvent } from '../winMain/main'
import { focusGuard } from './guard'

export { focusGuard } from './guard'

const getMainWindow = (): BrowserWindow | null => {
  try {
    return BrowserWindow.fromWebContents(getWebContents())
  } catch {
    // 窗口尚未创建或已销毁
    return null
  }
}

/**
 * 注册专注拦截层。
 *
 * 分工很明确：主进程只管「窗口与系统层的约束」，
 * 会话状态机、计时、统计都在渲染层（因为它要直接调播放器）。
 */
export default () => {
  mainHandle<LX.FocusGuardEngageOptions, LX.FocusGuardReport>(
    FOCUS_GUARD_RENDERER_EVENT_NAME.engage,
    async({ params }) =>
      await focusGuard.engage(
        {
          getWindow: getMainWindow,
          onViolation: (kind, detail) => {
            sendEvent<LX.FocusViolationPayload>(FOCUS_GUARD_RENDERER_EVENT_NAME.violation, {
              kind,
              detail,
              at: Date.now(),
            })
          },
          onToast: (level, text) => {
            sendEvent<LX.FocusToastPayload>(FOCUS_GUARD_RENDERER_EVENT_NAME.toast, { level, text })
          },
          // 原生拦截层没了就通知界面重取报告，把失效的防护项从「已生效」里撤下
          onNativeLost: (detail) => {
            sendEvent<LX.FocusNativeLostPayload>(FOCUS_GUARD_RENDERER_EVENT_NAME.native_lost, {
              detail,
              at: Date.now(),
            })
          },
        },
        {
          strict: params?.strict ?? false,
          killOnViolation: params?.killOnViolation ?? false,
        },
      ),
  )

  mainHandle<unknown, LX.FocusGuardReport>(FOCUS_GUARD_RENDERER_EVENT_NAME.disengage, async() =>
    focusGuard.disengage(),
  )

  mainHandle<unknown, LX.FocusGuardReport>(FOCUS_GUARD_RENDERER_EVENT_NAME.get_report, async() =>
    focusGuard.report(),
  )

  // 退出时必须卸掉 kiosk 与键盘钩子，否则会把窗口状态留在异常值上
  app.once('before-quit', () => {
    focusGuard.dispose()
  })
}
