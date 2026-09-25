import { computed, reactive, ref } from '@common/utils/vueTools'
import { DATA_KEYS } from '@common/constants'
import { FOCUS_GUARD_RENDERER_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { rendererInvoke, rendererOffAll, rendererOn, rendererSend } from '@common/rendererIpc'
import { play, pause, playList } from '@renderer/core/player/action'
import { setVolume as setPlayerVolume } from '@renderer/plugins/player'
import { volume as playerVolume } from '@renderer/store/player/volume'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { defaultList, loveList, userLists } from '@renderer/store/list/state'
import { useI18n } from '@renderer/plugins/i18n'

/** 起跑前的缓冲秒数，给用户一个来不及反悔的窗口 */
const PREPARE_SEC = 3
/** 违规惩罚：淡出 → 暂停 → 静默，之后自动恢复 */
const VIOLATION_SILENCE_MS = 6000

export const phase = ref<LX.FocusPhase>('idle')
export const round = ref(1)
export const remainingSec = ref(0)
export const totalSec = ref(0)
export const focusedSec = ref(0)
export const violations = ref(0)
export const startedAt = ref<number | null>(null)
export const guardReport = reactive<LX.FocusGuardReport>({
  platform: '',
  nativeHelper: false,
  active: [],
  unsupported: [],
})
/** 拦截层是否已接管，避免重复 engage */
export const guardEngaged = ref(false)
export const sessions = ref<LX.FocusSessionRecord[]>([])
export const toasts = reactive<Array<LX.FocusToastPayload & { id: number }>>([])

export const running = computed(() => phase.value !== 'idle' && phase.value !== 'completed')
export const paused = computed(() => phase.value === 'paused')

const t = useI18n()

/**
 * 内置列表的 name 存的是 i18n 键（list__name_default），自建列表存的是用户输入的字面量。
 * getMessage 在查不到键时会原样返回键本身，所以无差别过一遍 t() 即可：
 * 内置列表得到译文，自建列表得到原文。
 */
const translateListName = (name: string): string => t(name as Parameters<typeof t>[0])

/** 供界面展示的可选播放目标：试听列表 / 我的收藏 / 自建列表 —— 本地列表在 fork 方案下完全可用 */
export const listOptions = computed(() => {
  const options: Array<{ id: string, name: string }> = [
    { id: defaultList.id, name: translateListName(defaultList.name) },
    { id: loveList.id, name: translateListName(loveList.name) },
  ]
  for (const item of userLists) options.push({ id: item.id, name: translateListName(item.name) })
  return options
})

let timer: ReturnType<typeof setInterval> | null = null
let violationToken = 0
let toastSeq = 0
let initialized = false

// ---------------------------------------------------------------- 工具

/**
 * 解锁码只做本地比对的轻量散列。
 *
 * 这**不是**安全边界，而是一道「自我承诺」的缓冲：
 * 真正想绕过的人直接改配置文件即可。不加密是刻意为之 ——
 * 用户必须永远保留一条能走出去的路，否则就是在软件里把自己锁死。
 */
const hashCode = (code: string): string => {
  let hash = 5381
  for (let i = 0; i < code.length; i++) {
    hash = ((hash << 5) + hash + code.charCodeAt(i)) >>> 0
  }
  return `fh${hash.toString(16)}`
}

const pushToast = (level: LX.FocusToastPayload['level'], text: string) => {
  const id = ++toastSeq
  toasts.push({ id, level, text })
  if (toasts.length > 3) toasts.shift()
  setTimeout(() => {
    const index = toasts.findIndex(t => t.id === id)
    if (index > -1) toasts.splice(index, 1)
  }, 4200)
}

export { pushToast }

export const dismissToast = (id: number) => {
  const index = toasts.findIndex(t => t.id === id)
  if (index > -1) toasts.splice(index, 1)
}

export const hasUnlockCode = () => appSetting['focus.unlockCode'].length > 0

export const verifyUnlockCode = (code: string) => {
  if (!hasUnlockCode()) return true
  return appSetting['focus.unlockCode'] === hashCode(code.trim())
}

export const saveUnlockCode = async(code: string) => {
  const trimmed = code.trim()
  if (trimmed.length < 4) return false
  await updateSetting({ 'focus.unlockCode': hashCode(trimmed) })
  pushToast('info', '解锁码已更新')
  return true
}

// ---------------------------------------------------------------- 音乐联动

const findListName = (listId: string): string | null =>
  listOptions.value.find(item => item.id === listId)?.name ?? null

const playListById = (listId: string) => {
  if (!listId) return false
  playList(listId, 0)
  return true
}

/**
 * 违规提醒：音量淡出 → 暂停 → 静默数秒 → 淡回。
 *
 * 这里刻意操作播放器实例（plugins/player）而不是音量 store：
 * store 上的 volume 挂着一个 watch，会把值写回用户设置 player.volume，
 * 用淡出过程中的 0 去写等于把用户的音量偏好洗坏了。
 * 以 playerVolume.value（用户的真实意图）为基准，恢复时也回到它，
 * 这样即使用户在淡出期间自己调了音量，也能收敛到正确值。
 */
const fadeOutAndPause = async() => {
  const token = ++violationToken
  const base = playerVolume.value

  if (base > 0) {
    for (let step = 1; step <= 4; step++) {
      if (token !== violationToken) return
      setPlayerVolume(Math.max(0, base * (1 - step / 4)))
      await new Promise(resolve => setTimeout(resolve, 110))
    }
  }

  pause()
  await new Promise(resolve => setTimeout(resolve, VIOLATION_SILENCE_MS))

  restoreVolume()
  if (token !== violationToken) return
  play()
}

const restoreVolume = () => {
  setPlayerVolume(playerVolume.value)
}

// ---------------------------------------------------------------- 拦截层

const engageGuard = async() => {
  try {
    const report = await rendererInvoke<LX.FocusGuardEngageOptions, LX.FocusGuardReport>(
      FOCUS_GUARD_RENDERER_EVENT_NAME.engage,
      {
        strict: appSetting['focus.strictMode'],
        killOnViolation: appSetting['focus.killOnViolation'],
      },
    )
    Object.assign(guardReport, report)
    guardEngaged.value = true
  } catch (error) {
    guardEngaged.value = false
    pushToast('error', '专注锁启用失败，计时仍会继续')
  }
}

const disengageGuard = async() => {
  guardEngaged.value = false
  try {
    // 注意用单类型参数的重载：rendererInvoke<T, V> 那个签名要求必须传 params
    const report = await rendererInvoke<LX.FocusGuardReport>(
      FOCUS_GUARD_RENDERER_EVENT_NAME.disengage,
    )
    Object.assign(guardReport, report)
  } catch {
    // 窗口可能已销毁，忽略
  }
}

export const refreshGuardReport = async() => {
  try {
    const report = await rendererInvoke<LX.FocusGuardReport>(
      FOCUS_GUARD_RENDERER_EVENT_NAME.get_report,
    )
    Object.assign(guardReport, report)
  } catch {
    // 忽略
  }
}

// ---------------------------------------------------------------- 会话落库

/**
 * 把会话列表存到本地。
 *
 * 这里必须送**纯对象**：`sessions.value` 是 Vue 的响应式 Proxy 数组，
 * 而 `ipcRenderer.send` 走的是结构化克隆（V8 ValueSerializer），
 * 碰到 Proxy 会直接抛 `An object could not be cloned.`。
 * 用展开语法摊平成普通对象即可 —— 记录本身刻意保持扁平（只有原始类型），
 * 一层展开就够；以后若给记录加了嵌套字段，这里要跟着改。
 */
const persistSessions = () => {
  rendererSend(WIN_MAIN_RENDERER_EVENT_NAME.save_data, {
    path: DATA_KEYS.focusSessions,
    data: sessions.value.map(item => ({ ...item })),
  })
}

const loadSessions = async() => {
  const stored = await rendererInvoke<string, LX.FocusSessionRecord[] | null>(
    WIN_MAIN_RENDERER_EVENT_NAME.get_data,
    DATA_KEYS.focusSessions,
  )
  sessions.value = Array.isArray(stored) ? stored : []
}

const recordSession = (completed: boolean) => {
  const record: LX.FocusSessionRecord = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    taskName: appSetting['focus.taskName'] || '未命名专注',
    startedAt: startedAt.value ?? Date.now(),
    endedAt: Date.now(),
    plannedSec: appSetting['focus.focusMinutes'] * 60 * appSetting['focus.rounds'],
    focusedSec: focusedSec.value,
    completed,
    violations: violations.value,
    playlistName: findListName(appSetting['focus.focusListId']),
  }
  sessions.value.push(record)
  if (sessions.value.length > 500) sessions.value = sessions.value.slice(-500)
  try {
    persistSessions()
  } catch (error) {
    /*
     * 落盘失败绝不能让状态机停住。
     *
     * recordSession 的两个调用点（abortFocus / complete）后面紧跟 enterPhase('idle')，
     * 而只有 enterPhase('idle') 会解除 kiosk。这里一旦把异常抛出去，
     * 用户就永久困在全屏专注界面里 —— 丢一条统计远好过把人锁死。
     */
    console.error('[focus] 保存专注记录失败：', error)
    pushToast('error', '专注记录保存失败，已跳过（不影响退出）')
  }
}

// ---------------------------------------------------------------- 状态机

const startTimer = () => {
  stopTimer()
  timer = setInterval(tick, 1000)
}

const stopTimer = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

const tick = () => {
  if (phase.value === 'focusing') focusedSec.value += 1
  remainingSec.value -= 1
  if (remainingSec.value <= 0) advance()
}

const advance = () => {
  if (phase.value === 'preparing') {
    enterPhase('focusing')
    startTimer()
    return
  }
  if (phase.value === 'focusing') {
    if (round.value >= appSetting['focus.rounds']) {
      complete()
      return
    }
    enterPhase('breaking')
    startTimer()
    return
  }
  if (phase.value === 'breaking') {
    round.value += 1
    enterPhase('focusing')
    startTimer()
  }
}

const enterPhase = (next: LX.FocusPhase) => {
  const prev = phase.value
  phase.value = next
  switch (next) {
    case 'preparing':
      totalSec.value = PREPARE_SEC
      remainingSec.value = PREPARE_SEC
      break
    case 'focusing':
      totalSec.value = Math.max(1, appSetting['focus.focusMinutes']) * 60
      remainingSec.value = totalSec.value
      break
    case 'breaking':
      totalSec.value = Math.max(1, appSetting['focus.breakMinutes']) * 60
      remainingSec.value = totalSec.value
      break
    default:
      remainingSec.value = 0
      totalSec.value = 0
  }
  // 音乐联动与拦截层启停都由阶段切换统一驱动，避免各处零散调用导致状态漂移
  if (prev !== next) handlePhaseChange(next, prev)
}

const syncMusicForPhase = (next: LX.FocusPhase, prev: LX.FocusPhase) => {
  if (next === 'focusing') {
    restoreVolume()
    const fromStart = prev === 'preparing' || prev === 'breaking'
    if (fromStart && appSetting['focus.focusListId']) {
      playListById(appSetting['focus.focusListId'])
    } else {
      play()
    }
    return
  }
  if (next === 'breaking') {
    if (appSetting['focus.breakListId']) playListById(appSetting['focus.breakListId'])
    else pause()
    return
  }
  if (next === 'completed' || next === 'idle') {
    restoreVolume()
    pause()
  }
}

const handlePhaseChange = (next: LX.FocusPhase, prev: LX.FocusPhase) => {
  syncMusicForPhase(next, prev)

  if (next === 'preparing') {
    if (!guardEngaged.value) {
      guardEngaged.value = true
      void engageGuard()
    }
    return
  }
  if (next === 'idle' || next === 'completed') {
    if (guardEngaged.value) void disengageGuard()
  }
}

// ---------------------------------------------------------------- 对外操作

export const startFocus = () => {
  if (running.value) return
  round.value = 1
  focusedSec.value = 0
  violations.value = 0
  startedAt.value = Date.now()
  enterPhase('preparing')
  startTimer()
}

export const pauseFocus = () => {
  if (phase.value !== 'focusing') return
  stopTimer()
  phase.value = 'paused'
}

export const resumeFocus = () => {
  if (phase.value !== 'paused') return
  phase.value = 'focusing'
  startTimer()
}

export const skipPhase = () => {
  if (!running.value) return
  advance()
}

export const abortFocus = () => {
  if (!running.value) return
  stopTimer()
  /*
   * 用 try/finally 而不是顺序执行：enterPhase('idle') 才是解除 kiosk 的那一步，
   * 它必须无条件执行。如果记账环节抛错就跳过了它，用户会被永久困在全屏专注界面里，
   * 而出口只有一个「结束专注」按钮 —— 那等于把软件做成了牢笼。
   */
  try {
    recordSession(false)
  } catch (error) {
    console.error('[focus] 记录会话失败：', error)
  } finally {
    startedAt.value = null
    enterPhase('idle')
  }
}

const complete = () => {
  stopTimer()
  try {
    recordSession(true)
  } catch (error) {
    console.error('[focus] 记录会话失败：', error)
  } finally {
    // 同理：completed 也会解除 kiosk，不能被记账失败挡在后面
    enterPhase('completed')
  }
  pushToast('info', `专注完成，本轮累计 ${Math.round(focusedSec.value / 60)} 分钟`)
}

export const reportViolation = (kind: LX.FocusViolationKind, detail: string) => {
  if (!running.value) return
  if (!appSetting['focus.reactOnViolation']) return
  if (phase.value !== 'focusing' && phase.value !== 'paused') return
  violations.value += 1
  void fadeOutAndPause()
}

// ---------------------------------------------------------------- 初始化

export const initFocusStore = async() => {
  if (initialized) return
  initialized = true

  await loadSessions()
  await refreshGuardReport()

  // rendererOn 不返回取消订阅的函数（上游签名如此），
  // 所以这里用 rendererOffAll 收尾——这两个事件名是本模块独占的，不会误伤别人
  rendererOn<LX.FocusViolationPayload>(FOCUS_GUARD_RENDERER_EVENT_NAME.violation, ({ params }) => {
    reportViolation(params.kind, params.detail)
  })
  rendererOn<LX.FocusToastPayload>(FOCUS_GUARD_RENDERER_EVENT_NAME.toast, ({ params }) => {
    pushToast(params.level, params.text)
  })
  rendererOn<LX.FocusNativeLostPayload>(FOCUS_GUARD_RENDERER_EVENT_NAME.native_lost, () => {
    // 拉不到原生拦截层就重取报告，让界面把已经失效的防护项撤下来。
    // 提示语由主进程的 toast 负责，这里只负责同步状态。
    void refreshGuardReport()
  })
}

export const disposeFocusStore = () => {
  stopTimer()
  rendererOffAll(FOCUS_GUARD_RENDERER_EVENT_NAME.violation)
  rendererOffAll(FOCUS_GUARD_RENDERER_EVENT_NAME.toast)
  rendererOffAll(FOCUS_GUARD_RENDERER_EVENT_NAME.native_lost)
  initialized = false
}
