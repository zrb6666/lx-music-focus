<template>
  <div class="focus-view" :class="{ 'is-running': running }">
    <!-- 左：计时器与防护状态 -->
    <div class="fv-col fv-left">
      <div class="fv-card fv-timer-card" :class="[phaseClass, { 'is-live': isLive }]">
        <div class="fv-ring-wrap">
          <svg class="fv-ring" viewBox="0 0 300 300">
            <defs>
              <linearGradient id="fvRingGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="var(--color-primary)" />
                <stop offset="55%" stop-color="var(--color-primary)" />
                <stop offset="100%" stop-color="var(--color-primary-dark-300)" />
              </linearGradient>
            </defs>
            <!-- 轨道 -->
            <circle cx="150" cy="150" :r="RADIUS" fill="none" stroke="var(--color-primary-alpha-800)" stroke-width="10" />
            <!--
              不限时模式下 totalSec 为 0，画不出有意义的比例，因此只留轨道。
              光晕与进度都带 v-if 隐藏 —— 留一个空转的弧会比不画更让人困惑。
            -->
            <template v-if="totalSec > 0">
              <!-- 光晕：与进度同形，粗而淡，负责「发光」的观感 -->
              <circle
                cx="150"
                cy="150"
                :r="RADIUS"
                fill="none"
                :stroke="ringStroke"
                stroke-width="24"
                stroke-linecap="round"
                :stroke-dasharray="CIRCUMFERENCE"
                :stroke-dashoffset="dashOffset"
                transform="rotate(-90 150 150)"
                class="fv-ring-glow"
              />
              <!-- 进度 -->
              <circle
                cx="150"
                cy="150"
                :r="RADIUS"
                fill="none"
                :stroke="ringStroke"
                stroke-width="10"
                stroke-linecap="round"
                :stroke-dasharray="CIRCUMFERENCE"
                :stroke-dashoffset="dashOffset"
                transform="rotate(-90 150 150)"
                class="fv-ring-progress"
              />
            </template>
          </svg>

          <div class="fv-ring-content">
            <div class="fv-ring-phase">{{ phaseText }}</div>
            <div class="fv-ring-time">{{ mainTime }}</div>
            <div class="fv-ring-hint">{{ ringHint }}</div>
          </div>

          <div
            v-if="totalRounds > 1"
            class="fv-rounds"
            :aria-label="`共 ${totalRounds} 轮，第 ${round} 轮`"
          >
            <span
              v-for="n in totalRounds"
              :key="n"
              class="fv-round-dot"
              :class="{ done: n < round, cur: running && n === round }"
            ></span>
          </div>
        </div>

        <div class="fv-task-line">
          <div class="fv-task-name" :class="{ 'fv-muted': !currentTaskLabel }">
            {{ currentTaskLabel || '未命名专注' }}
          </div>
          <div v-if="running" class="fv-violations" :class="{ hot: violations > 0 }">
            <span class="fv-violations-dot"></span>分心 {{ violations }} 次
          </div>
        </div>

        <div class="fv-actions">
          <template v-if="!running">
            <button class="fv-btn fv-btn-primary fv-btn-start" @click="onStart">
              {{ completed ? '再来一轮' : '开始专注' }}
            </button>
          </template>
          <template v-else>
            <button v-if="paused" class="fv-btn fv-btn-primary" @click="onResume">继续专注</button>
            <button v-else class="fv-btn" @click="onPause">暂停</button>
            <!--
              不限时没有「下一阶段」的终点，跳过这一阶段会直接推进到休息/结束，
              在本模式下没有意义，因此隐藏。
            -->
            <button v-if="!countUpSession" class="fv-btn" @click="skipPhase">跳过本阶段</button>
            <button class="fv-btn fv-btn-danger" @click="onAbort">结束专注</button>
          </template>
        </div>
      </div>

      <!--
        播放面板：专注中才出现，把播放详情页的左封面 + 右歌词 + 底部进度条
        收进专注界面，这样计时和音乐不必来回切页。
        待机时右栏已有完整的设置，此时再放一个播放器只会让界面变吵。
      -->
      <div v-if="running" class="fv-card fv-player-card">
        <div class="fv-card-title">
          正在播放
          <span v-if="focusPlaylistName" class="fv-tag">{{ focusPlaylistName }}</span>
        </div>

        <div class="fv-pd">
          <div class="fv-pd-left">
            <div class="fv-pd-cover">
              <img v-if="currentMusicCover" :src="currentMusicCover" alt="" />
              <div v-else class="fv-pd-cover-empty">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"
                    fill="currentColor"
                  />
                </svg>
              </div>
            </div>
            <div class="fv-pd-meta">
              <div class="fv-pd-name">{{ currentMusicName || '暂无歌曲' }}</div>
              <div class="fv-pd-singer">{{ currentMusicSinger || '选一首歌开始，或载入专注歌单' }}</div>
              <div v-if="currentMusicAlbum" class="fv-pd-album">{{ currentMusicAlbum }}</div>
            </div>
          </div>

          <!-- 歌词：与播放详情页同一份 lyric store，逐行高亮跟随进度 -->
          <div class="fv-pd-lyric">
            <div
              v-for="line in lyricWindow"
              :key="line.key"
              class="fv-pd-line"
              :class="{ active: line.isActive }"
              @click="onSeekToLine(line.time)"
            >
              {{ line.text }}
            </div>
            <div v-if="!hasLyric" class="fv-pd-line is-empty">
              {{ currentMusicId ? '这首歌还没有歌词' : '暂无播放中的歌曲' }}
            </div>
          </div>
        </div>

        <!-- 进度条：可点击定位，与播放详情页底部那条同源 -->
        <div class="fv-pd-progress">
          <span class="fv-pd-time">{{ nowPlayTimeStr }}</span>
          <div
            class="fv-pd-track"
            :aria-label="`播放进度 ${nowPlayTimeStr} / ${maxPlayTimeStr}`"
            @click="onSeekByClick"
            @mousedown="onSeekDragStart"
          >
            <div class="fv-pd-track-fill" :style="{ width: `${playProgress * 100}%` }">
              <span class="fv-pd-knob" />
            </div>
          </div>
          <span class="fv-pd-time">{{ maxPlayTimeStr }}</span>
        </div>

        <div class="fv-now-actions">
          <button class="fv-btn fv-btn-sm" :disabled="!hasPlaylist" @click="onPrevMusic">上一首</button>
          <button class="fv-btn fv-btn-sm fv-btn-primary" @click="onToggleMusic">
            {{ isPlayingMusic ? '暂停' : '播放' }}
          </button>
          <button class="fv-btn fv-btn-sm" :disabled="!hasPlaylist" @click="onNextMusic">下一首</button>
          <button
            v-if="appSetting['focus.focusListId']"
            class="fv-btn fv-btn-sm fv-btn-ghost"
            @click="onLoadFocusList"
          >
            载入专注歌单
          </button>
        </div>
      </div>

      <!--
        防护状态：待机时完整展示（它本身就是这个应用的说明书）；
        专注中收成一行摘要，把版面让给计时与音乐。
      -->
      <div v-if="!running" class="fv-card">
        <div class="fv-card-title">
          防护状态
          <span class="fv-tag" :class="guardReport.nativeHelper ? 'ok' : 'warn'">
            {{ guardReport.nativeHelper ? '完整防护' : '基础防护' }}
          </span>
        </div>
        <div class="fv-guard-block is-active">
          <div class="fv-guard-head">已生效</div>
          <div class="fv-chips">
            <span v-for="item in guardReport.active" :key="item" class="fv-chip on">{{ item }}</span>
            <span v-if="guardReport.active.length === 0" class="fv-chip">待机中，未启用</span>
          </div>
        </div>
        <div class="fv-guard-block is-unsupported">
          <div class="fv-guard-head">无法防护 · 这是操作系统的限制，不是软件缺陷</div>
          <div class="fv-chips">
            <span v-for="item in guardReport.unsupported" :key="item" class="fv-chip off">{{ item }}</span>
          </div>
        </div>
        <p class="fv-note">
          专注锁的定位是「把分心的摩擦成本抬高」，而不是「不可破解的笼子」。真正让专注成立的，
          是你按下开始键的那一刻。
        </p>
      </div>

      <div v-else class="fv-guard-strip">
        <span class="fv-guard-strip-label">防护</span>
        <span class="fv-chip on">{{ guardReport.active.length }} 项已生效</span>
        <span v-if="guardReport.unsupported.length" class="fv-chip off">{{ guardReport.unsupported.length }} 项系统限制</span>
        <span v-if="!guardReport.nativeHelper" class="fv-chip off">Win 键拦截未启用</span>
      </div>
    </div>

    <!-- 右：设置与统计 -->
    <div class="fv-col fv-right">
      <!--
        目标卡：专注中收起。
        专注开始后目标不能改、时长不能改、开关不能动，留着这一整卡只是噪音；
        期间真正要看的统计与播放都已经在左栏和「近 7 天」里了。
      -->
      <div v-if="!running" class="fv-card">
        <div class="fv-card-title">
          目标
          <span class="fv-tag">{{ currentTaskLabel || '未选择' }}</span>
        </div>

        <!-- 从已保存的目标里选，点一下即选中 -->
        <div class="fv-field">
          <span class="fv-field-label">选择目标</span>
          <div v-if="goalOptions.length" class="fv-chips">
            <button
              v-for="goal in goalOptions"
              :key="goal"
              class="fv-chip fv-chip-btn"
              :class="{ active: appSetting['focus.taskName'] === goal }"
              @click="onPickGoal(goal)"
            >
              {{ goal }}
            </button>
          </div>
          <span v-else class="fv-hint">还没有目标，在下面添加一个。</span>
        </div>

        <!-- 临时手填：不进列表，只作为本次的目标 -->
        <label class="fv-field">
          <span class="fv-field-label">本次目标</span>
          <input
            class="fv-input"
            :value="appSetting['focus.taskName']"
            placeholder="也可以直接输入，不进列表"
            @change="onTaskName"
          />
        </label>

        <!-- 维护列表 -->
        <div class="fv-field">
          <span class="fv-field-label">管理目标列表</span>
          <div class="fv-inline">
            <input
              v-model="newGoalInput"
              class="fv-input"
              :maxlength="24"
              placeholder="添加一个新目标"
              @keyup.enter="onAddGoal"
            />
            <button class="fv-btn fv-btn-sm" @click="onAddGoal">添加</button>
          </div>
          <div v-if="goalOptions.length" class="fv-goal-manage">
            <span v-for="goal in goalOptions" :key="goal" class="fv-goal-item">
              {{ goal }}
              <button class="fv-goal-remove" :title="`删除「${goal}」`" @click="onRemoveGoal(goal)">×</button>
            </span>
          </div>
        </div>
      </div>

      <div v-if="!running" class="fv-card">
        <div class="fv-card-title">
          计时方式
          <span class="fv-tag" :class="appSetting['focus.countUp'] ? 'ok' : ''">
            {{ appSetting['focus.countUp'] ? '不限时' : '倒计时' }}
          </span>
        </div>

        <div class="fv-toggle-row">
          <div class="fv-toggle-copy">
            <div>不限时（正向计时）</div>
            <div class="fv-hint">
              只累计已专注时长，不倒数、不自动结束，也不进入休息段 —— 做完了自己按结束
            </div>
          </div>
          <button
            class="fv-switch"
            :class="{ on: appSetting['focus.countUp'] }"
            @click="updateSetting({ 'focus.countUp': !appSetting['focus.countUp'] })"
          ></button>
        </div>

        <!-- 倒计时专有的参数，不限时下收起，避免摆一堆用不上的输入框 -->
        <template v-if="!appSetting['focus.countUp']">
          <div class="fv-field">
            <span class="fv-field-label">专注时长</span>
            <div class="fv-chips">
              <button
                v-for="preset in FOCUS_PRESETS"
                :key="preset"
                class="fv-chip fv-chip-btn"
                :class="{ active: appSetting['focus.focusMinutes'] === preset }"
                @click="updateSetting({ 'focus.focusMinutes': preset })"
              >
                {{ preset }} 分钟
              </button>
            </div>
            <input
              class="fv-input"
              type="number"
              min="1"
              max="240"
              :value="appSetting['focus.focusMinutes']"
              @change="updateSetting({ 'focus.focusMinutes': readNumber($event, 1, 240, 25) })"
            />
          </div>

          <div class="fv-field-row">
            <label class="fv-field">
              <span class="fv-field-label">休息时长（分钟）</span>
              <input
                class="fv-input"
                type="number"
                min="1"
                max="60"
                :value="appSetting['focus.breakMinutes']"
                @change="updateSetting({ 'focus.breakMinutes': readNumber($event, 1, 60, 5) })"
              />
            </label>
            <label class="fv-field">
              <span class="fv-field-label">轮数</span>
              <input
                class="fv-input"
                type="number"
                min="1"
                max="12"
                :value="appSetting['focus.rounds']"
                @change="updateSetting({ 'focus.rounds': readNumber($event, 1, 12, 4) })"
              />
            </label>
          </div>
        </template>
      </div>

      <div v-if="!running" class="fv-card">
        <div class="fv-card-title">专注行为</div>

        <div class="fv-toggle-row">
          <div class="fv-toggle-copy">
            <div>严格模式</div>
            <div class="fv-hint">启用原生拦截层，屏蔽 Win 键 / Alt+Tab，并监视跑到前台的程序</div>
          </div>
          <button
            class="fv-switch"
            :class="{ on: appSetting['focus.strictMode'] }"
            :disabled="running"
            @click="updateSetting({ 'focus.strictMode': !appSetting['focus.strictMode'] })"
          ></button>
        </div>

        <div class="fv-toggle-row">
          <div class="fv-toggle-copy">
            <div>
              终止违规进程
              <span class="fv-tag danger" style="margin-left: 6px">危险</span>
            </div>
            <div class="fv-hint">
              关闭时只把违规窗口最小化；开启后会直接结束它，未保存的内容会丢失
            </div>
          </div>
          <button
            class="fv-switch"
            :class="{ on: appSetting['focus.killOnViolation'] }"
            :disabled="running"
            @click="updateSetting({ 'focus.killOnViolation': !appSetting['focus.killOnViolation'] })"
          ></button>
        </div>

        <div class="fv-toggle-row">
          <div class="fv-toggle-copy">
            <div>违规时打断音乐</div>
            <div class="fv-hint">离开界面会让音乐淡出静默 6 秒，作为一次提醒</div>
          </div>
          <button
            class="fv-switch"
            :class="{ on: appSetting['focus.reactOnViolation'] }"
            :disabled="running"
            @click="updateSetting({ 'focus.reactOnViolation': !appSetting['focus.reactOnViolation'] })"
          ></button>
        </div>

        <label class="fv-field" style="margin-top: 14px">
          <span class="fv-field-label">
            解锁码
            <span class="fv-tag" :class="hasUnlockCode() ? 'ok' : 'warn'" style="margin-left: 6px">
              {{ hasUnlockCode() ? '已设置' : '未设置' }}
            </span>
          </span>
          <div class="fv-inline">
            <input
              v-model="unlockCodeInput"
              class="fv-input"
              type="password"
              placeholder="至少 4 位"
              :disabled="running"
            />
            <button class="fv-btn fv-btn-sm" :disabled="running" @click="onSaveUnlockCode">保存</button>
          </div>
          <span class="fv-hint">
            未设置解锁码时，暂停与结束将直接放行 —— 宁可约束弱一点，也不能把你锁死在软件里。
            忘记了解锁码，直接改设置文件里的 focus.unlockCode 即可重置。
          </span>
        </label>
      </div>

      <div v-if="!running" class="fv-card">
        <div class="fv-card-title">专注歌单</div>

        <label class="fv-field" style="margin-bottom: 0">
          <span class="fv-field-label">专注时载入</span>
          <select
            class="fv-input"
            :value="appSetting['focus.focusListId']"
            @change="updateSetting({ 'focus.focusListId': readValue($event) })"
          >
            <option value="">未指定</option>
            <option v-for="item in listOptions" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>

        <p class="fv-note">
          这里指定的歌单不会自动播放 —— 开始与结束专注都不会改动你的播放状态。
          它只是让专注界面里的播放面板多一个「载入专注歌单」的按钮，放不放由你决定。
          列表直接取自 LX Music 的「我的列表」，本地自建列表同样可以播放。
        </p>
      </div>

      <div class="fv-card">
        <div class="fv-card-title">近 7 天</div>
        <div class="fv-week">
          <div v-for="day in weekStats" :key="day.key" class="fv-day">
            <div class="fv-day-bar-wrap">
              <div
                class="fv-day-bar"
                :style="{ height: `${Math.max(3, (day.focusedSec / weekMax) * 100)}%` }"
                :title="`${day.key} · ${formatDuration(day.focusedSec)}`"
              ></div>
            </div>
            <div class="fv-day-label">{{ day.key.slice(5) }}</div>
          </div>
        </div>

        <div class="fv-stats">
          <div class="fv-stat">
            <div class="fv-stat-value">{{ formatDuration(todayStats.focusedSec) }}</div>
            <div class="fv-stat-label">今日专注</div>
          </div>
          <div class="fv-stat">
            <div class="fv-stat-value">{{ todayStats.count }}</div>
            <div class="fv-stat-label">今日会话</div>
          </div>
          <div class="fv-stat">
            <div class="fv-stat-value">{{ todayStats.violations }}</div>
            <div class="fv-stat-label">今日分心</div>
          </div>
        </div>
      </div>

      <div class="fv-card">
        <div class="fv-card-title">最近会话</div>
        <div v-if="recentSessions.length === 0" class="fv-empty">还没有记录，开始第一次专注吧</div>
        <div v-else class="fv-session-list">
          <div v-for="item in recentSessions" :key="item.id" class="fv-session">
            <div class="fv-session-main">
              <div class="fv-session-name">{{ item.taskName }}</div>
              <div class="fv-session-time">{{ formatDate(item.startedAt) }}</div>
            </div>
            <div class="fv-session-right">
              <span>{{ formatDuration(item.focusedSec) }}</span>
              <span class="fv-tag" :class="item.completed ? 'ok' : 'warn'">
                {{ item.completed ? '已完成' : '中途结束' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 解锁码弹窗 -->
    <div v-if="codePrompt" class="fv-overlay" @click.self="cancelCode">
      <div class="fv-dialog">
        <div class="fv-dialog-title">{{ codePromptTitle }}</div>
        <div class="fv-hint">该操作需要解锁码</div>
        <input
          v-model="codeInput"
          class="fv-input"
          type="password"
          placeholder="输入解锁码"
          @keyup.enter="confirmCode"
        />
        <div class="fv-dialog-actions">
          <button class="fv-btn" @click="cancelCode">取消</button>
          <button class="fv-btn fv-btn-primary" @click="confirmCode">确认</button>
        </div>
      </div>
    </div>

    <!-- 轻提示 -->
    <div class="fv-toasts">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="fv-toast"
        :class="toast.level"
        @click="dismissToast(toast.id)"
      >
        {{ toast.text }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
import {
  addGoal,
  abortFocus,
  countUpSession,
  dismissToast,
  focusedSec,
  guardReport,
  hasUnlockCode,
  initFocusStore,
  listOptions,
  pauseFocus,
  paused,
  phase,
  playListById,
  pushToast,
  refreshGuardReport,
  remainingSec,
  removeGoal,
  resumeFocus,
  round,
  running,
  saveUnlockCode,
  sessions,
  setTaskName,
  skipPhase,
  startFocus,
  toasts,
  totalSec,
  verifyUnlockCode,
  violations,
} from '@renderer/store/focus'
import { isPlay as playerIsPlay, musicInfo as currentMusic } from '@renderer/store/player/state'
import { playNext, playPrev, pause as pauseMusic, play as playMusic } from '@renderer/core/player/action'
import { lyric } from '@renderer/store/player/lyric'
import { playProgress as playProgressStore } from '@renderer/store/player/playProgress'
import usePlayProgress from '@renderer/utils/compositions/usePlayProgress'

const FOCUS_PRESETS = [15, 25, 45, 60, 90]
const RADIUS = 132
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const unlockCodeInput = ref('')
const codePrompt = ref<null | { title: string, action: 'pause' | 'resume' | 'abort' }>(null)
const codeInput = ref('')
const newGoalInput = ref('')

/** 已保存的目标列表 */
const goalOptions = computed<string[]>(() => appSetting['focus.goals'] ?? [])

/** 当前选中的目标，空字符串时显示占位文案 */
const currentTaskLabel = computed(() => appSetting['focus.taskName']
  ? appSetting['focus.taskName']
  : '')

const onAddGoal = async() => {
  const name = newGoalInput.value.trim()
  if (!name) {
    pushToast('warn', '请输入目标名称')
    return
  }
  if (await addGoal(name)) {
    newGoalInput.value = ''
    pushToast('info', `已添加目标「${name}」`)
  }
}

const onRemoveGoal = async(name: string) => {
  await removeGoal(name)
  pushToast('info', `已删除目标「${name}」`)
}

// ---------------------------------------------------------------- 内嵌播放面板

const currentMusicName = computed(() => currentMusic.name || '')
const currentMusicSinger = computed(() => currentMusic.singer || '')
const currentMusicCover = computed(() => currentMusic.pic ?? '')
const isPlayingMusic = computed(() => playerIsPlay.value)
/** 有歌单上下文时上一首/下一首才有意义 */
const hasPlaylist = computed(() => (currentMusic.id ?? null) != null)
const focusPlaylistName = computed(() =>
  listOptions.value.find(item => item.id === appSetting['focus.focusListId'])?.name ?? '')

const onToggleMusic = () => {
  if (playerIsPlay.value) pauseMusic()
  else playMusic()
}

const onNextMusic = () => { void playNext() }
const onPrevMusic = () => { void playPrev() }

/** 手动载入专注歌单 —— 这是唯一会改变播放状态的入口，且必须由使用者点 */
const onLoadFocusList = () => {
  if (playListById(appSetting['focus.focusListId'])) pushToast('info', '已载入专注歌单')
}

// ---------------------------------------------------------------- 歌词与进度

const currentMusicAlbum = computed(() => currentMusic.album ?? '')
const currentMusicId = computed(() => currentMusic.id ?? null)

/** 播放详情页那条进度条的同一份数据源 */
const { progress: playProgress, nowPlayTimeStr, maxPlayTimeStr } = usePlayProgress()
/** 总时长（秒），拖动与点击定位都要拿它做比例换算 */
const maxPlayTime = toRef(playProgressStore, 'maxPlayTime')

const hasLyric = computed(() => (lyric.lines?.length ?? 0) > 0)

/**
 * 只渲染当前行附近的若干行。
 *
 * 直接铺满整首歌的歌词会让面板很高、还要自己做平滑滚动，而专注界面里
 * 歌词的作用是「余光扫一眼知道在唱哪句」，不是一个要去滚动浏览的阅读器。
 * 取一个固定窗口既省渲染，也让高亮始终落在同一个视觉位置。
 */
const LYRIC_WINDOW = 5

const lyricWindow = computed(() => {
  const lines = lyric.lines ?? []
  if (!lines.length) return []
  const active = Math.max(0, Math.min(lines.length - 1, lyric.line))
  const half = Math.floor(LYRIC_WINDOW / 2)
  let start = active - half
  if (start < 0) start = 0
  if (start + LYRIC_WINDOW > lines.length) start = Math.max(0, lines.length - LYRIC_WINDOW)
  const end = Math.min(lines.length, start + LYRIC_WINDOW)

  const out: Array<{ key: string, text: string, time: number, isActive: boolean }> = []
  for (let i = start; i < end; i++) {
    const item = lines[i]
    out.push({
      // 同一首歌里时间戳可能重复，索引一并带上保证 key 唯一
      key: `${i}-${item.time}`,
      text: item.text || '···',
      time: item.time ?? 0,
      isActive: i === active,
    })
  }
  return out
})

/** 点击歌词行跳到那一句 */
const onSeekToLine = (time: number) => {
  if (!hasPlaylist.value || !Number.isFinite(time)) return
  seekTo(time)
}

/**
 * 定位到某一秒。
 *
 * 走的是 app_event.setProgress（播放详情页底部那条进度条用的同一个入口），
 * 不是 store 里的 setProgress —— 后者是两参数、只负责刷新显示值，
 * 不会真正让播放器跳转。用错了会表现为「进度条动了但歌还在原处」。
 */
const seekTo = (time: number) => {
  window.app_event.setProgress(time)
}

/** 点击进度条定位：按点击位置占轨道宽度的比例换算成秒 */
const onSeekByClick = (event: MouseEvent) => {
  const total = maxPlayTime.value
  if (!hasPlaylist.value || !(total > 0)) return
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  if (!rect.width) return
  const ratioValue = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  seekTo(total * ratioValue)
}

/**
 * 按住进度条拖动。
 *
 * 监听挂在 window 上而不是轨道上：手一快就会滑出轨道元素，
 * 挂在元素上会中途断掉，体验像「拖到一半没反应」。
 */
const onSeekDragStart = (event: MouseEvent) => {
  if (!hasPlaylist.value || !(maxPlayTime.value > 0)) return
  const track = event.currentTarget as HTMLElement
  const rect = track.getBoundingClientRect()
  if (!rect.width) return

  const seekByClientX = (clientX: number) => {
    const ratioValue = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    seekTo(maxPlayTime.value * ratioValue)
  }

  seekByClientX(event.clientX)

  const onMove = (e: MouseEvent) => { seekByClientX(e.clientX) }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/*
 * 标题单独算一份，不要在模板里直接写 {{ codePrompt.title }}。
 *
 * `<script setup>` 会把 ref 编译成 `codePrompt.value`，而 v-if 所在的同一个表达式里
 * 还夹着 `_withModifiers(...)` 这类函数调用；TypeScript 对属性访问的收窄会被
 * 中间的函数调用作废，于是模板里那处访问会被判定为「可能为 null」而编译失败。
 */
const codePromptTitle = computed(() => codePrompt.value?.title ?? '')

const ratio = computed(() => {
  if (totalSec.value <= 0) return 0
  return Math.max(0, Math.min(1, remainingSec.value / totalSec.value))
})

const dashOffset = computed(() => CIRCUMFERENCE * (1 - ratio.value))

/** 交给样式层去区分阶段的观感（配色、光晕强度都挂在它上面） */
const phaseClass = computed(() => phase.value)

/** 只有真正「在跑」的阶段才点亮光晕，避免待机时整圈发亮显得吵 */
const isLive = computed(() => phase.value === 'focusing' || phase.value === 'breaking' || phase.value === 'paused')

const completed = computed(() => phase.value === 'completed')

const totalRounds = computed(() => {
  const value = Number(appSetting['focus.rounds'])
  return Number.isFinite(value) && value > 1 ? Math.min(12, Math.round(value)) : 1
})

const ringStroke = computed(() => {
  if (phase.value === 'breaking') return '#35d39a'
  if (phase.value === 'paused') return '#ffb648'
  if (running.value) return 'url(#fvRingGradient)'
  return 'var(--color-primary-alpha-700)'
})

/**
 * 环内主时间。
 *
 * 不限时模式显示「已专注时长」（往上走），倒计时显示剩余（往下走）——
 * 待机时按当前设置预演一下，让使用者点开始前就知道等会儿看到的是什么。
 */
const mainTime = computed(() => {
  if (countUpSession.value) {
    return formatClock(running.value && phase.value === 'focusing' ? focusedSec.value : 0)
  }
  const sec = running.value ? remainingSec.value : appSetting['focus.focusMinutes'] * 60
  return formatClock(sec)
})

const phaseText = computed(() => {
  switch (phase.value) {
    case 'preparing':
      return '准备开始'
    case 'focusing':
      return countUpSession.value ? '专注中 · 不限时' : `专注中 · 第 ${round.value} 轮`
    case 'paused':
      return '已暂停'
    case 'breaking':
      return `休息中 · 第 ${round.value} 轮`
    case 'completed':
      return '已完成'
    default:
      return countUpSession.value ? '不限时' : '准备就绪'
  }
})

const ringHint = computed(() => {
  switch (phase.value) {
    case 'preparing':
      return '趁现在把桌面收拾干净'
    case 'focusing':
      // 不限时没有终点可等，提示改成与「自己判断何时结束」相关的
      return countUpSession.value ? '不限时，做完了自己按结束' : '专注锁已生效，离开会被记录'
    case 'paused':
      return '恢复需要解锁码'
    case 'breaking':
      return '起来走两步，别碰手机'
    case 'completed':
      return '干得不错，记录已保存'
    default:
      return countUpSession.value ? '不限时：只累计，不倒数' : '设定时长和目标，然后开始'
  }
})

const recentSessions = computed(() => sessions.value.slice(-8).reverse())

const todayKey = () => dayKey(Date.now())

const todayStats = computed(() => {
  const key = todayKey()
  let focused = 0
  let count = 0
  let violationCount = 0
  for (const item of sessions.value) {
    if (dayKey(item.startedAt) !== key) continue
    focused += item.focusedSec
    count += 1
    violationCount += item.violations
  }
  return { focusedSec: focused, count, violations: violationCount }
})

const weekStats = computed(() => {
  const days: Array<{ key: string, focusedSec: number }> = []
  for (let i = 6; i >= 0; i--) {
    days.push({ key: dayKey(Date.now() - i * 86400_000), focusedSec: 0 })
  }
  const index = new Map(days.map((day, i) => [day.key, i]))
  for (const item of sessions.value) {
    const key = dayKey(item.startedAt)
    const position = index.get(key)
    if (position === undefined) continue
    days[position].focusedSec += item.focusedSec
  }
  return days
})

const weekMax = computed(() => Math.max(...weekStats.value.map(day => day.focusedSec), 1))

function dayKey(ts: number): string {
  const d = new Date(ts)
  const month = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function formatClock(totalSecond: number): string {
  const sec = Math.max(0, Math.round(totalSecond))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

function formatDuration(totalSecond: number): string {
  const sec = Math.max(0, Math.round(totalSecond))
  if (sec < 60) return `${sec} 秒`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h === 0) return `${m} 分钟`
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function readNumber(event: Event, min: number, max: number, fallback: number): number {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function readValue(event: Event): string {
  return (event.target as HTMLSelectElement).value
}

function onTaskName(event: Event): void {
  setTaskName((event.target as HTMLInputElement).value)
}

/** 点选目标：已选中的再点一次即取消，便于「本来只想看看」的情况 */
function onPickGoal(goal: string): void {
  setTaskName(appSetting['focus.taskName'] === goal ? '' : goal)
}

async function onSaveUnlockCode(): Promise<void> {
  const ok = await saveUnlockCode(unlockCodeInput.value)
  if (!ok) {
    pushToast('warn', '解锁码至少需要 4 位')
    return
  }
  unlockCodeInput.value = ''
}

/** 需要解锁码时弹出对话框；未设置解锁码则一律放行，避免把用户锁死 */
function requiresCode(action: 'pause' | 'resume' | 'abort', title: string): boolean {
  // 只看「有没有设过解锁码」，与严格模式解耦：
  // 严格模式管的是原生拦截层，解锁码管的是「防自己手滑」
  if (!hasUnlockCode()) return false
  codePrompt.value = { action, title }
  codeInput.value = ''
  return true
}

function cancelCode(): void {
  codePrompt.value = null
  codeInput.value = ''
}

function confirmCode(): void {
  const prompt = codePrompt.value
  if (!prompt) return
  if (!verifyUnlockCode(codeInput.value)) {
    pushToast('error', '解锁码不正确')
    return
  }
  const action = prompt.action
  codePrompt.value = null
  codeInput.value = ''
  if (action === 'pause') pauseFocus()
  else if (action === 'resume') resumeFocus()
  else abortFocus()
}

function onStart(): void {
  startFocus()
}

function onPause(): void {
  if (requiresCode('pause', '暂停专注')) return
  pauseFocus()
}

function onResume(): void {
  if (requiresCode('resume', '恢复专注')) return
  resumeFocus()
}

function onAbort(): void {
  if (requiresCode('abort', '结束本次专注')) return
  abortFocus()
}

onMounted(() => {
  void initFocusStore()
  void refreshGuardReport()
})

onBeforeUnmount(() => {
  // 页面切走不中断会话，只做一次状态同步；会话本身由 store 的计时器驱动
  void refreshGuardReport()
})
</script>

<style lang="less">
/*
 * 专注界面的视觉层。
 *
 * 设计约束（改动前请先读）：
 * 1. 只使用上游的主题变量族（--color-*），不硬编码任何「随主题变化」的颜色。
 *    上游的主题系统会在切换浅色/深色时重写 --color-850（正文）、--color-450（次要文字）、
 *    --color-primary-light-1000（卡片底）等，硬编码颜色必然会有一端不可读。
 * 2. 语义色（警示橙 / 危险红 / 休息青）只在「大面积色块」或「小圆点」上使用，
 *    文字一律交给 --color-font / --color-font-label / --color-primary，
 *    这样在浅底和深底上都成立。
 * 3. 层次靠阴影 + 圆角 + 间距，而不是靠更粗的边框。边框统一压到 alpha-800 附近。
 */
.focus-view {
  --fv-radius: 16px;
  --fv-radius-sm: 10px;
  --fv-line: 1px solid var(--color-primary-alpha-800);
  --fv-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 8px 26px var(--color-primary-alpha-900);
  --fv-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.04), 0 20px 48px var(--color-primary-alpha-900);
  --fv-rest: #35d39a;
  --fv-warn: #e8a33d;
  --fv-danger: #d4544e;

  position: absolute;
  inset: 0;
  display: flex;
  gap: 16px;
  padding: 16px;
  box-sizing: border-box;
  overflow: hidden;
  /* 两团极淡的主题色光晕：把整页从「一块死白」里拉出来，且自动跟随主题色 */
  background-image:
    radial-gradient(760px 420px at 16% -14%, var(--color-primary-alpha-900), transparent 62%),
    radial-gradient(620px 380px at 108% 114%, var(--color-primary-alpha-900), transparent 58%);
  background-repeat: no-repeat;

  /*
   * 专注中收窄两栏。
   *
   * 左栏此时只剩计时 + 播放 + 防护摘要，右栏只剩 7 天统计，都撑不满原宽度，
   * 拉满会显得松散。用 justify-content 让两栏整体居中，再给每栏限一个上界 ——
   * 直接给 .focus-view 设 max-width 是无效的（它是 flex 容器且 position:absolute，
   * 宽度由 inset 决定），必须作用到子项上。
   */
  &.is-running {
    justify-content: center;

    // 左栏现在要容下「计时 + 播放面板（封面 108 + 歌词）」，比之前宽
    .fv-left {
      flex: 0 1 auto;
      width: 100%;
      max-width: 560px;
    }

    .fv-right {
      width: 320px;
    }
  }

  .fv-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 2px;
  }

  .fv-left {
    flex: 1;
    min-width: 0;
  }

  .fv-right {
    width: 360px;
    flex: none;
  }

  // ---------- 卡片 ----------

  .fv-card {
    flex: none;
    position: relative;
    padding: 20px;
    border-radius: var(--fv-radius);
    background-color: var(--color-content-background);
    border: var(--fv-line);
    box-shadow: var(--fv-shadow);
    box-sizing: border-box;
    animation: fv-rise 0.5s cubic-bezier(0.22, 0.68, 0.28, 1) both;
  }

  // 依次入场，制造一点节奏感
  .fv-col .fv-card:nth-child(1) { animation-delay: 0.02s; }
  .fv-col .fv-card:nth-child(2) { animation-delay: 0.08s; }
  .fv-col .fv-card:nth-child(3) { animation-delay: 0.14s; }
  .fv-col .fv-card:nth-child(4) { animation-delay: 0.2s; }
  .fv-col .fv-card:nth-child(5) { animation-delay: 0.26s; }
  .fv-col .fv-card:nth-child(n + 6) { animation-delay: 0.32s; }

  .fv-card-title {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 16px;
    padding-left: 11px;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-font);

    // 左侧渐变小竖条：不用图标也能建立标题层级
    &:before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      width: 3px;
      height: 13px;
      margin-top: -6.5px;
      border-radius: 2px;
      background-image: linear-gradient(180deg, var(--color-primary), var(--color-primary-dark-300));
    }
  }

  // ---------- 主计时卡 ----------

  .fv-timer-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    padding: 34px 24px 28px;
    border-radius: 20px;
    background-image: linear-gradient(168deg, var(--color-primary-alpha-900) 0%, transparent 46%);
    box-shadow: var(--fv-shadow-lg);
    transition: box-shadow 0.4s ease, background-image 0.4s ease;

    &.is-live {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04), 0 22px 56px var(--color-primary-alpha-800);
    }

    &.paused {
      background-image: linear-gradient(168deg, rgba(232, 163, 61, 0.13) 0%, transparent 46%);
    }

    &.breaking {
      background-image: linear-gradient(168deg, rgba(53, 211, 154, 0.13) 0%, transparent 46%);
    }
  }

  .fv-ring-wrap {
    position: relative;
    width: 320px;
    height: 320px;
    flex: none;

    // 环内侧一团柔光，让圆环像「悬」在卡片上而不是压在上面
    &:before {
      content: '';
      position: absolute;
      inset: 32px;
      border-radius: 50%;
      background-image: radial-gradient(circle, var(--color-primary-alpha-900) 0%, transparent 72%);
      pointer-events: none;
    }
  }

  .fv-ring {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .fv-ring-progress {
    transition: stroke-dashoffset 0.9s linear, stroke 0.4s ease, filter 0.4s ease;
  }

  .fv-timer-card.focusing .fv-ring-progress {
    filter: drop-shadow(0 0 12px var(--color-primary-alpha-600));
  }

  .fv-timer-card.paused .fv-ring-progress {
    filter: drop-shadow(0 0 12px rgba(232, 163, 61, 0.45));
  }

  .fv-timer-card.breaking .fv-ring-progress {
    filter: drop-shadow(0 0 12px rgba(53, 211, 154, 0.45));
  }

  // 与进度同形、更粗更糊的一层，负责「发光」的氛围；待机时不点亮
  .fv-ring-glow {
    opacity: 0;
    filter: blur(7px);
    transition: stroke-dashoffset 0.9s linear, stroke 0.4s ease, opacity 0.6s ease;
  }

  .fv-timer-card.is-live .fv-ring-glow {
    opacity: 0.22;
  }

  // 专注中让光晕缓慢呼吸：番茄钟的「活着」的感觉，全靠这个
  .fv-timer-card.focusing .fv-ring-glow {
    animation: fv-breathe 4.5s ease-in-out infinite;
  }

  .fv-ring-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    pointer-events: none;
  }

  .fv-ring-phase {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 12px;
    border-radius: 999px;
    background-color: var(--color-primary-alpha-900);
    font-size: 12px;
    letter-spacing: 0.04em;
    color: var(--color-primary);
    transition: color 0.3s ease, background-color 0.3s ease;
  }

  .fv-timer-card.paused .fv-ring-phase {
    background-color: rgba(232, 163, 61, 0.14);
    color: var(--fv-warn);
  }

  .fv-timer-card.breaking .fv-ring-phase {
    background-color: rgba(53, 211, 154, 0.14);
    color: var(--fv-rest);
  }

  .fv-ring-time {
    font-size: 58px;
    font-weight: 200;
    line-height: 1;
    letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums;
    color: var(--color-font);
  }

  .fv-ring-hint {
    max-width: 184px;
    font-size: 12px;
    line-height: 1.5;
    text-align: center;
    color: var(--color-font-label);
  }

  // 轮次指示：贴在圆环内侧底部，不额外占高度
  .fv-rounds {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
  }

  .fv-round-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--color-primary-alpha-700);
    transition: background-color 0.3s ease, transform 0.3s ease;

    &.done {
      background-color: var(--color-primary-alpha-400);
    }

    &.cur {
      background-color: var(--color-primary);
      transform: scale(1.35);
    }
  }

  .fv-task-line {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 22px;
    font-size: 14px;
    color: var(--color-font);
  }

  .fv-task-name {
    max-width: 340px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .fv-muted {
    color: var(--color-font-label);
  }

  .fv-violations {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 10px;
    border-radius: 999px;
    background-color: var(--color-primary-alpha-900);
    font-size: 12px;
    color: var(--color-font-label);
    transition: color 0.25s ease, background-color 0.25s ease;

    .fv-violations-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: var(--color-primary-alpha-500);
      flex: none;
      transition: background-color 0.25s ease;
    }

    &.hot {
      background-color: rgba(232, 163, 61, 0.13);
      color: var(--fv-warn);

      .fv-violations-dot {
        background-color: var(--fv-warn);
      }
    }
  }

  // ---------- 按钮 ----------

  .fv-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
    margin-top: 2px;
  }

  .fv-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 36px;
    padding: 0 18px;
    border: 1px solid var(--color-primary-alpha-700);
    border-radius: var(--fv-radius-sm);
    background-color: var(--color-button-background);
    color: var(--color-button-font);
    font-size: 13.5px;
    cursor: pointer;
    transition: background-color 0.18s ease, border-color 0.18s ease,
      transform 0.18s ease, box-shadow 0.18s ease;

    &:hover:not(:disabled) {
      background-color: var(--color-button-background-hover);
      border-color: var(--color-primary-alpha-500);
      transform: translateY(-1px);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    &:focus-visible {
      outline: 2px solid var(--color-primary-alpha-500);
      outline-offset: 2px;
    }
  }

  .fv-btn-primary {
    border-color: transparent;
    background-color: var(--color-primary);
    background-image: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark-200) 100%);
    color: #fff;
    box-shadow: 0 4px 14px var(--color-primary-alpha-700);

    &:hover:not(:disabled) {
      background-color: var(--color-primary);
      background-image: linear-gradient(135deg, var(--color-primary-dark-100) 0%, var(--color-primary-dark-300) 100%);
      box-shadow: 0 6px 20px var(--color-primary-alpha-600);
    }
  }

  .fv-btn-danger {
    border-color: rgba(212, 84, 78, 0.4);
    color: var(--fv-danger);

    &:hover:not(:disabled) {
      background-color: rgba(212, 84, 78, 0.12);
      border-color: rgba(212, 84, 78, 0.6);
    }
  }

  .fv-btn-start {
    height: 46px;
    padding: 0 40px;
    border-radius: 999px;
    font-size: 15.5px;
    letter-spacing: 0.06em;

    &:hover:not(:disabled) {
      box-shadow: 0 8px 26px var(--color-primary-alpha-600);
    }

    &:active:not(:disabled) {
      transform: scale(0.98);
    }
  }

  .fv-btn-sm {
    height: 32px;
    padding: 0 14px;
    font-size: 12.5px;
    flex: none;
  }

  // ---------- 表单 ----------

  .fv-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 15px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  .fv-field-label {
    display: flex;
    align-items: center;
    font-size: 12.5px;
    color: var(--color-font-label);
  }

  .fv-field-row {
    display: flex;
    gap: 12px;

    > .fv-field {
      flex: 1;
      min-width: 0;
    }
  }

  .fv-input {
    width: 100%;
    height: 38px;
    padding: 0 12px;
    box-sizing: border-box;
    border: 1px solid var(--color-primary-alpha-700);
    border-radius: var(--fv-radius-sm);
    background-color: var(--color-main-background);
    color: var(--color-font);
    font-size: 13.5px;
    outline: none;
    transition: border-color 0.18s ease, box-shadow 0.18s ease;

    &:hover:not(:disabled) {
      border-color: var(--color-primary-alpha-500);
    }

    &:focus {
      border-color: var(--color-primary);
      box-shadow: 0 0 0 3px var(--color-primary-alpha-900);
    }

    &:disabled {
      // 专注中这些值仍然要能看清（用户得确认自己设的是多少分钟），
      // 所以不压太暗 —— 「不可编辑」交给光标和开关的半透明去表达
      opacity: 0.72;
      cursor: not-allowed;
    }

    &::placeholder {
      color: var(--color-font-label);
      opacity: 0.7;
    }
  }

  select.fv-input {
    cursor: pointer;
  }

  .fv-inline {
    display: flex;
    gap: 8px;
  }

  /*
   * 目标管理列表。
   *
   * 与「选择目标」的 chips 分开做：chips 是选一个（单选、可高亮），
   * 这里是列出来删（每条带 ×），两者混在一起会分不清「点它是选中还是删除」。
   */
  .fv-goal-manage {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .fv-goal-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 4px 3px 9px;
    border: 1px solid var(--color-primary-alpha-800);
    border-radius: 999px;
    font-size: 11.5px;
    color: var(--color-font-label);
  }

  .fv-goal-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--color-font-label);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;

    &:hover {
      background: var(--color-primary-alpha-900);
      color: var(--color-font);
    }
  }

  // ------------------------------------------------------------ 内嵌播放面板

  .fv-player-card {
    animation: fv-rise 0.24s ease both;
  }

  /*
   * 播放面板：把播放详情页的左封面 + 右歌词 + 底部进度条压缩进一卡。
   *
   * 左右分栏沿用详情页的比例关系（封面窄、歌词宽），但尺寸整体收小，
   * 因为这里只是专注界面里的一张卡，不该压过中间那个计时环。
   */
  .fv-pd {
    display: flex;
    gap: 16px;
    margin-top: 12px;
  }

  .fv-pd-left {
    flex: none;
    width: 108px;
  }

  .fv-pd-cover {
    width: 108px;
    height: 108px;
    overflow: hidden;
    border: 1px solid var(--color-primary-alpha-800);
    border-radius: 12px;
    background-color: var(--color-primary-alpha-900);
    box-shadow: 0 4px 14px var(--color-primary-alpha-900);

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  }

  // 没有封面时放一个音符占位，避免左边突然空掉一块
  .fv-pd-cover-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--color-font-label);
    opacity: 0.45;

    svg {
      width: 36px;
      height: 36px;
    }
  }

  .fv-pd-meta {
    margin-top: 10px;
    min-width: 0;
  }

  .fv-pd-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-font);
  }

  .fv-pd-singer,
  .fv-pd-album {
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--color-font-label);
  }

  /*
   * 歌词窗口：固定渲染当前行附近的几行，高亮始终落在同一视觉位置。
   *
   * 不做整首滚动是有意的 —— 专注界面里歌词只是「余光扫一眼知道在唱哪句」，
   * 不是要滚动浏览的阅读器；整首铺开会让卡片很高，还会跟计时环抢注意力。
   */
  .fv-pd-lyric {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-flow: column nowrap;
    justify-content: center;
    gap: 2px;
    // 与播放详情页歌词区一致的上下淡出遮罩
    -webkit-mask-image: linear-gradient(transparent 0%, #fff 22%, #fff 78%, transparent 100%);
  }

  .fv-pd-line {
    padding: 3px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--color-font-label);
    cursor: pointer;
    transition: color 0.2s ease, font-size 0.2s ease, opacity 0.2s ease;
    opacity: 0.72;

    &:hover {
      opacity: 1;
    }

    &.active {
      font-size: 14px;
      font-weight: 600;
      color: var(--color-primary);
      opacity: 1;
    }

    &.is-empty {
      cursor: default;
      opacity: 0.6;
    }
  }

  // 进度条：与播放详情页底部那条同源，可点击定位、可按住拖动
  .fv-pd-progress {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
  }

  .fv-pd-time {
    flex: none;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--color-font-label);
  }

  .fv-pd-track {
    position: relative;
    flex: 1;
    height: 4px;
    border-radius: 999px;
    background-color: var(--color-primary-alpha-800);
    cursor: pointer;

    // 命中区放大到 14px：4px 高的条子很难点准
    &:before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: -5px;
      bottom: -5px;
    }
  }

  .fv-pd-track-fill {
    position: relative;
    height: 100%;
    border-radius: 999px;
    background-color: var(--color-primary);
    transition: width 0.2s linear;
  }

  .fv-pd-knob {
    position: absolute;
    right: -4px;
    top: 50%;
    width: 9px;
    height: 9px;
    transform: translateY(-50%);
    border-radius: 50%;
    background-color: var(--color-primary);
    box-shadow: 0 0 0 3px var(--color-primary-alpha-900);
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  .fv-pd-track:hover .fv-pd-knob {
    opacity: 1;
  }

  .fv-now-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }

  // 专注中的防护摘要条：把待机时那一整卡压成一行
  .fv-guard-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--color-primary-alpha-800);
    border-radius: var(--fv-radius-sm);
    background-color: var(--color-primary-alpha-900);
    animation: fv-rise 0.24s ease both;
  }

  .fv-guard-strip-label {
    font-size: 11.5px;
    letter-spacing: 0.08em;
    color: var(--color-font-label);
  }

  .fv-hint {
    margin-top: 3px;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--color-font-label);
  }

  .fv-note {
    position: relative;
    margin: 14px 0 0;
    padding: 2px 0 2px 12px;
    font-size: 11.5px;
    line-height: 1.7;
    color: var(--color-font-label);

    // 左侧细线代替整块底色：一页里三处绿底会糊成一片
    &:before {
      content: '';
      position: absolute;
      left: 0;
      top: 4px;
      bottom: 4px;
      width: 2px;
      border-radius: 1px;
      background-color: var(--color-primary-alpha-700);
    }
  }

  // ---------- 标签与开关 ----------

  .fv-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  .fv-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 27px;
    padding: 0 11px;
    border-radius: 999px;
    border: 1px solid var(--color-primary-alpha-800);
    background-color: var(--color-main-background);
    color: var(--color-font-label);
    font-size: 12px;
    transition: border-color 0.18s ease, color 0.18s ease, background-color 0.18s ease;

    // 状态圆点用 currentColor，颜色跟着上面的 color 走，省掉一套映射
    &:before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: currentColor;
      opacity: 0.7;
      flex: none;
    }

    &.on {
      border-color: var(--color-primary-alpha-600);
      background-color: var(--color-primary-alpha-900);
      color: var(--color-primary);
    }

    &.off {
      // 刻意不铺底色：铺了会和「已生效」的绿底混淆，
      // 无法防护靠橙色圆点标记就够了
      background-color: var(--color-main-background);
      color: var(--color-font-label);

      &:before {
        background-color: var(--fv-warn);
        opacity: 1;
      }
    }

    &.active {
      border-color: var(--color-primary);
      background-color: var(--color-primary-alpha-900);
      color: var(--color-primary);
    }
  }

  .fv-chip-btn {
    cursor: pointer;

    &:before {
      display: none;
    }

    &:hover:not(:disabled) {
      border-color: var(--color-primary-alpha-500);
      color: var(--color-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .fv-tag {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 9px;
    border-radius: 999px;
    font-size: 11.5px;
    background-color: var(--color-primary-alpha-900);
    color: var(--color-font-label);

    &.ok {
      color: var(--color-primary);
    }

    &.warn {
      background-color: rgba(232, 163, 61, 0.13);
      color: var(--fv-warn);
    }

    &.danger {
      background-color: rgba(212, 84, 78, 0.13);
      color: var(--fv-danger);
    }
  }

  .fv-toggle-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 0;
    font-size: 13px;
    color: var(--color-font);

    & + .fv-toggle-row {
      border-top: 1px solid var(--color-primary-alpha-900);
    }
  }

  .fv-toggle-copy {
    flex: 1;
    min-width: 0;
  }

  .fv-switch {
    position: relative;
    flex: none;
    width: 46px;
    height: 25px;
    padding: 0;
    border-radius: 999px;
    border: 1px solid var(--color-primary-alpha-700);
    background-color: var(--color-main-background);
    cursor: pointer;
    transition: background-color 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;

    &:before {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 19px;
      height: 19px;
      border-radius: 50%;
      background-color: var(--color-font-label);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
      transition: transform 0.22s cubic-bezier(0.3, 0.9, 0.4, 1.2), background-color 0.22s ease;
    }

    &.on {
      border-color: transparent;
      background-color: var(--color-primary);
      background-image: linear-gradient(135deg, var(--color-primary), var(--color-primary-dark-200));
      box-shadow: 0 2px 10px var(--color-primary-alpha-700);

      &:before {
        transform: translateX(21px);
        background-color: #fff;
      }
    }

    &:disabled {
      // 同理：专注中被锁定的开关也要让人看得出当前是开还是关
      opacity: 0.62;
      cursor: not-allowed;
    }
  }

  // ---------- 防护状态 ----------

  .fv-guard-block {
    margin-bottom: 14px;
  }

  .fv-guard-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 9px;
    font-size: 12px;
    color: var(--color-font-label);

    &:before {
      content: '';
      width: 5px;
      height: 5px;
      border-radius: 50%;
      flex: none;
      background-color: var(--color-primary);
    }
  }

  .fv-guard-block.is-unsupported {
    margin-bottom: 0;

    .fv-guard-head:before {
      background-color: var(--fv-warn);
    }
  }

  // ---------- 统计 ----------

  .fv-week {
    display: flex;
    align-items: flex-end;
    gap: 7px;
    height: 84px;
    margin-bottom: 16px;
  }

  .fv-day {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    height: 100%;
  }

  .fv-day-bar-wrap {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
  }

  .fv-day-bar {
    width: 100%;
    border-radius: 6px;
    background-image: linear-gradient(180deg, var(--color-primary) 0%, var(--color-primary-alpha-600) 100%);
    transition: height 0.45s cubic-bezier(0.3, 0.8, 0.3, 1), filter 0.2s ease;

    &:hover {
      filter: brightness(1.08);
    }
  }

  // 数组按时间正序，最后一根即今天，给它一点光晕
  .fv-day:last-child .fv-day-bar {
    box-shadow: 0 0 12px var(--color-primary-alpha-600);
  }

  .fv-day-label {
    font-size: 10.5px;
    color: var(--color-font-label);
  }

  .fv-stats {
    display: flex;
    gap: 10px;
  }

  .fv-stat {
    flex: 1;
    padding: 11px 4px;
    border-radius: var(--fv-radius-sm);
    text-align: center;
    background-color: var(--color-primary-alpha-900);
    border: 1px solid var(--color-primary-alpha-900);
    transition: border-color 0.2s ease;

    &:hover {
      border-color: var(--color-primary-alpha-700);
    }
  }

  .fv-stat-value {
    font-size: 19px;
    font-weight: 500;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
    color: var(--color-font);
  }

  .fv-stat-label {
    margin-top: 4px;
    font-size: 11.5px;
    color: var(--color-font-label);
  }

  // ---------- 会话列表 ----------

  .fv-session-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fv-session {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 10px;
    border-radius: var(--fv-radius-sm);
    transition: background-color 0.18s ease;

    &:hover {
      background-color: var(--color-primary-alpha-900);
    }
  }

  .fv-session-main {
    min-width: 0;
  }

  .fv-session-name {
    max-width: 150px;
    font-size: 13px;
    color: var(--color-font);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fv-session-time {
    margin-top: 2px;
    font-size: 11.5px;
    color: var(--color-font-label);
  }

  .fv-session-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    font-size: 12.5px;
    color: var(--color-font-label);
  }

  .fv-empty {
    padding: 18px 0;
    text-align: center;
    font-size: 12.5px;
    color: var(--color-font-label);
  }

  // ---------- 弹窗与轻提示 ----------

  .fv-overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(3px);
  }

  .fv-dialog {
    width: 312px;
    padding: 22px;
    border-radius: 18px;
    background-color: var(--color-content-background);
    border: var(--fv-line);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.28);
    display: flex;
    flex-direction: column;
    gap: 12px;
    animation: fv-pop 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  }

  .fv-dialog-title {
    font-size: 15.5px;
    font-weight: 500;
    color: var(--color-font);
  }

  .fv-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    margin-top: 4px;
  }

  .fv-toasts {
    position: absolute;
    top: 16px;
    right: 18px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 9px;
    align-items: flex-end;
  }

  .fv-toast {
    position: relative;
    max-width: 320px;
    padding: 11px 15px 11px 17px;
    border-radius: 12px;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--color-font);
    background-color: var(--color-content-background);
    border: var(--fv-line);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.14);
    cursor: pointer;
    overflow: hidden;
    animation: fv-slide-in 0.28s cubic-bezier(0.2, 0.8, 0.3, 1) both;

    // 左侧色条代替图标，用颜色表达级别
    &:before {
      content: '';
      position: absolute;
      left: 0;
      top: 9px;
      bottom: 9px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background-color: var(--color-primary);
    }

    &.warn:before {
      background-color: var(--fv-warn);
    }

    &.error:before {
      background-color: var(--fv-danger);
    }
  }
}

@keyframes fv-breathe {
  0%,
  100% {
    opacity: 0.16;
  }

  50% {
    opacity: 0.3;
  }
}

@keyframes fv-rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fv-pop {
  from {
    opacity: 0;
    transform: scale(0.94);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes fv-slide-in {
  from {
    opacity: 0;
    transform: translateX(16px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

// 窄窗口下左右两栏改竖排，避免右栏被压瘪
@media (max-width: 1060px) {
  .focus-view {
    flex-direction: column;
    overflow-y: auto;

    .fv-col {
      overflow: visible;
    }

    .fv-right {
      width: 100%;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .focus-view {
    .fv-card,
    .fv-dialog,
    .fv-toast,
    .fv-ring-glow {
      animation: none;
    }

    .fv-btn,
    .fv-switch,
    .fv-ring-progress,
    .fv-ring-glow,
    .fv-day-bar {
      transition: none;
    }
  }
}
</style>
