<h1 align="center">LX Focus</h1>

<p align="center">
  把「专注锁」和「音乐播放」做成同一件事的桌面工具。
</p>

---

## 这是什么

LX Focus 是一个基于 [LX Music 桌面版](https://github.com/lyswhut/lx-music-desktop) 二次开发的桌面应用。

它在上游的音乐播放能力之上，加了一个**专注模块**：设定好时长和目标，进入专注后应用会接管窗口与系统层的交互，让你很难随手切走去干别的；专注期间自动播放你指定的歌单，休息时切换成另一套歌单或直接静音；每一次专注的时长、完成情况和「走神次数」都会被如实记录下来。

一句话概括设计取向：**把分心的摩擦成本抬高，而不是造一个不可破解的笼子。**

## 上游与许可

| | |
|---|---|
| 上游项目 | [LX Music 桌面版](https://github.com/lyswhut/lx-music-desktop) |
| 上游作者 | lyswhut 及各位贡献者 |
| 许可证 | Apache License 2.0 |

本项目是上游的修改版，依据 Apache License 2.0 第 4 条 b 款，**修改声明见 [NOTICE](./NOTICE)**。

LX Music 的名称与标识不属于本项目，本项目也不主张任何相关权利。上游的完整使用协议与免责声明保留在 [`licenses/`](./licenses) 目录中，未作改动，使用前请一并阅读。

> **能力边界**：本项目自身不含任何音乐源。在线播放能力来自使用者在「自定义源」中自行导入的音源脚本，与上游行为一致。
>
> **使用限制**（摘自上游协议，继续适用）：禁止在违反当地法律法规的情况下使用本项目；音乐平台不易，请尊重版权、支持正版。

## 专注模块做了什么

### 专注界面（`/focus`）

- 环形计时器，预设 15 / 25 / 45 / 60 / 90 分钟，也可以手填
- 多轮循环：专注 → 休息 → 专注，轮数与休息时长均可配置
- 7 天专注时长柱状图、今日汇总、最近会话列表

### 专注锁

分四层，逐层增强，越往下对系统的侵入越深：

| 层 | 手段 | 依赖 |
|---|---|---|
| 1. 窗口层 | kiosk 全屏独占、屏幕级置顶、失焦自动夺回 | Electron |
| 2. 快捷键层 | 屏蔽 Alt+F4 / Ctrl+W / F11 / Ctrl+Shift+I | Electron `globalShortcut` |
| 3. 进程层 | 低级键盘钩子吞掉 Win 键与 Alt+Tab；前台窗口看门狗 | `native/LxFocusGuard.exe` |
| 4. 意志层 | 暂停 / 结束需要解锁码 | 应用内 |

第 3 层需要一个随包分发的 Windows 原生辅助进程。它是个纯用户态程序，不装驱动、不需要管理员权限。构建方式：

```bash
npm run build:native-guard     # 用系统自带的 csc.exe 编译，无需 Visual Studio
npm run pack                   # 打包时会自动调用上一步
```

### 关于「无法防护」的部分

这些不是缺陷，而是操作系统的边界，应用会**如实告知**而不是假装自己封死了一切：

- `Ctrl+Alt+Del` 是安全注意序列（SAS），由内核接管，任何用户态程序都无法拦截
- 通过任务管理器强行结束进程 —— 系统保留的逃生通道
- 安全模式重启

专注界面里会实打实地列出「已生效」与「无法防护」两组项目。

### 违规时的反应

默认只是把跑到前台的其他窗口**最小化**，并记一次违规，同时让音乐淡出静默 6 秒作为提醒。

「直接结束违规进程」是一个**单独的、默认关闭**的开关。开着它确实更狠，但会丢失对方程序里未保存的内容，所以必须由使用者显式开启，界面上也标了危险提示。

### 数据

会话记录保存在本机，不联网、不上传。解锁码只做本地散列比对 —— 它是一道「自我承诺」的缓冲，**不是安全边界**。忘记了解锁码，直接改配置里的 `focus.unlockCode` 即可重置。这是刻意留的出口：任何自律工具都不该让使用者把自己锁死在软件里。

## 开发

```bash
npm install --ignore-scripts   # 原因见下方说明
npm run build:native-guard     # 编译原生辅助进程（仅 Windows 需要）
npm run dev
```

### 关于 `--ignore-scripts`

`better-sqlite3` 的 postinstall 会尝试用 node-gyp 重新编译原生模块，在没装 Visual Studio 的机器上会失败并**中断整个安装**，导致 Electron 二进制等后续步骤被静默跳过。

实际上该模块自带 N-API 预编译件（`prebuilds/`），ABI 在 Node 与 Electron 之间稳定，不需要本地编译。因此跳过 install 脚本即可，装完后补一下 Electron 二进制：

```bash
cd node_modules/electron
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js
```

### 打包

```bash
npm run pack:win:7z:x64        # Windows 免安装版
npm run pack:win:setup:x64     # Windows 安装包
```

产物落在 `build/`：

| 文件 | 说明 |
|---|---|
| `lx-focus-v0.1.0-win_x64-green.7z` | 免安装绿色版，解压即用，适合随 GitHub Release 分发 |
| `lx-focus-v0.1.0-x64-Setup.exe` | NSIS 安装包，可选安装目录（`oneClick: false`） |

打包配置已把 `appId` / `productName` 与上游脱钩 —— 沿用上游的 appId 会让两个应用共用同一份用户数据目录并互相覆盖配置。

打包**不需要 Visual Studio**。本项目依赖的三个原生模块全部是 N-API 模块并自带 `prebuilds/`，ABI 在 Node 与 Electron 之间通用，因此 `build-config/build-pack.js` 里关掉了 electron-builder 默认的 `npmRebuild`。上游的默认配置会调 `@electron/rebuild` → `node-gyp`，把「本机装有 C++ 生成工具」变成打包前置条件，而这对本项目是纯粹的额外负担。

`build-config/build-pack.js` 已不再配置 `publish`，因此不存在需要替换的 `publish.owner` 占位值。仓库坐标只由 `package.json` 的 `author.name` 决定，见下文「发布前要改的一处」。

### 关于更新

**本项目已移除应用内的检查更新、下载更新与更新日志能力。** 具体表现为：

- 设置页没有「软件更新」入口，不会弹出更新提示，也不会出现「更新失败」这类误报
- 依赖中已去掉 `electron-updater`，相关的 IPC 事件名、store 状态与组件一并删除
- 打包产物里不再留有更新元数据：`resources/app-update.yml` 与产物目录下的 `latest.yml` 都会被清掉

需要说明的是，**「不配置 `publish`」并不足以让 electron-builder 停止生成这两样东西**：当 `publish` 为 `null` 或未配置时，`getPublishConfigsForUpdateInfo()` 会退回用 `package.json` 的 `repository` 推导出一份 github provider 配置照常写盘。两者写入时机不同，因此清理位置也不同：

| 文件 | 写入者 | 清理位置 |
| --- | --- | --- |
| `resources/app-update.yml` | electron-builder 内部的 `onAfterPack` 监听器 | `build-config/build-after-pack.js` 的 `afterPack` 钩子（跑在该监听器之后、NSIS / 7z 取件之前，所以产物里也不会带） |
| `latest.yml` | `publishManager.awaitTasks()` → `writeUpdateInfoFiles()` | `build-config/build-pack.js` 的 `removeUpdateMetadata()`（在 `await builder.build()` 兑现之后） |

`latest.yml` 的时序容易踩坑：它由 `builder.build()` 的 `executeFinally` 收尾阶段写出，比 `afterAllArtifactBuild` 钩子还晚 —— 在钩子里删只会删个空气，因为文件当时还没生成。

新版本一律手动下载覆盖安装，或到「关于」页点开源地址自行获取。

上游的 `publish/` 目录（生成 `version.json` 的发布脚本）保留着，它只是发布工具、与运行时无关 —— 客户端已不再读取该文件。



## 目录结构（本项目新增部分）

```
src/renderer/views/Focus/index.vue          专注界面
src/renderer/store/focus/index.ts           会话状态机、音乐联动、数据落盘
src/main/modules/focus/index.ts             专注拦截模块入口与 IPC
src/main/modules/focus/guard.ts             窗口层 / 快捷键层 / 进程层编排
src/main/modules/focus/nativeGuard.ts       与原生辅助进程的 stdio 桥
native/LxFocusGuard.cs                      Windows 原生辅助进程
scripts/build-native-guard.mjs              编译辅助进程
src/common/types/focus.d.ts                 类型声明
NOTICE                                      修改声明
```


