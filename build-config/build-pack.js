/* eslint-disable no-template-curly-in-string */

const builder = require('electron-builder')
const path = require('node:path')
const fs = require('node:fs/promises')
const beforePack = require('./build-before-pack')
const afterPack = require('./build-after-pack')

/**
* @type {import('electron-builder').Configuration}
* @see https://www.electron.build/configuration/configuration
*/
const options = {
  // 品牌已与上游脱钩：上游是 cn.toside.music.desktop / lx-music-desktop，
  // 沿用会导致两个应用共用同一份用户数据目录、互相覆盖配置。
  appId: 'com.lxfocus.desktop',
  productName: 'lx-focus',
  beforePack,
  afterPack,
  protocols: {
    name: 'lx-music-protocol',
    schemes: [
      'lxmusic',
    ],
  },
  directories: {
    buildResources: './resources',
    output: './build',
  },
  files: [
    '!node_modules/**/*',
    'node_modules/font-list',
    'node_modules/better-sqlite3/lib',
    'node_modules/better-sqlite3/package.json',
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/node-gyp-build',
    'node_modules/bufferutil',
    'node_modules/utf-8-validate',
    'dist/**/*',
  ],
  asar: {
    smartUnpack: false,
  },
  /*
   * 关闭 electron-builder 的 npmRebuild。
   *
   * 默认行为是打包前用 @electron/rebuild 调 node-gyp 把原生模块按 Electron 的 ABI
   * 重编一遍，而这需要本机装有 Visual Studio（C++ 生成工具）。对普通打包者来说
   * 这个前提太重，而且对本项目完全没有必要：
   *
   *   better-sqlite3  v13    → node-addon-api，N-API
   *   bufferutil      v4.1.0 → prebuildify --napi
   *   utf-8-validate  v6.0.6 → prebuildify --napi
   *
   * 三者都是 N-API 模块，ABI 在 Node 与 Electron 之间通用，预编译件直接可用
   * （见各自的 prebuilds/ 目录，含 win32-x64）。重编只会白白引入 VS 依赖，
   * 并在没有 VS 的机器上让整个打包流程失败。
   *
   * better-sqlite3 按目标架构挑选预编译件的工作由 beforePack → deps.copyLib 完成。
   */
  npmRebuild: false,
  extraResources: [
    './licenses',
    // 原生辅助进程（专注拦截用），落地为 resources/native/bin/LxFocusGuard.exe
    { from: './native/bin', to: 'native/bin' },
  ],
  /*
   * 这里刻意不配置 publish。
   *
   * publish 是 electron-updater 的数据来源：配了它，electron-builder 会在
   * resources/ 下生成 app-update.yml，安装包升级时据此去远端找新版本。
   * 本 fork 已经把应用内的检查更新 / 下载更新整套能力删掉了，发布方式就是
   * 手动分发 Release 产物，所以既不需要 app-update.yml，也不希望它被生成。
   *
   * 但「不配置 publish」并不等于 electron-builder 就不生成这两样东西 ——
   * 二者都要另外收拾，而且收拾的位置各不相同（翻 app-builder-lib/out 源码确认过）：
   *
   *   app-update.yml
   *     getPublishConfigs() 返回空数组后，getPublishConfigsForUpdateInfo()
   *     会退回用 package.json 的 repository 推导出一份 github provider 配置，
   *     照样写盘，位置固定在 resources/ 下。
   *     它由 electron-builder 内部的 onAfterPack 监听器写入，而
   *     PlatformPackager.doPack() 里 emitAfterPack() 在前、config 的
   *     afterPack 钩子在后，所以 build-after-pack.js 在那个钩子里删除它是有效的
   *     —— 删除发生在 NSIS / 7z 取件之前，产物里不会带。
   *
   *   latest.yml（以及 mac / linux 的同名变体）
   *     由 publishManager.awaitTasks() → writeUpdateInfoFiles() 写进产物目录。
   *     awaitTasks() 位于 builder.build() 的 executeFinally 收尾阶段，时序比
   *     afterAllArtifactBuild 钩子还晚 —— 钩子跑的时候文件根本还没生成，
   *     在那儿删只会删个空气（这个坑踩过一次）。所以这项放到下面 build() 里、
   *     等 builder.build() 兑现之后通过 removeUpdateMetadata() 删除。
   */
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const winOptions = {
  win: {
    icon: './resources/icons/icon.ico',
    // 上游在此声明 legalTrademarks: 'lyswhut'，fork 不应继承他人的商标声明
    // artifactName: '${productName}-v${version}-${env.ARCH}-${env.TARGET}.${ext}',
  },
  nsis: {
    oneClick: false,
    language: '2052',
    allowToChangeInstallationDirectory: true,
    // differentialPackage: true,
    license: './licenses/license.rtf',
    shortcutName: 'LX Focus',
  },
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const linuxOptions = {
  linux: {
    maintainer: 'LX Focus',
    // artifactName: '${productName}-${version}.${env.ARCH}.${ext}',
    icon: './resources/icons',
    category: 'Utility;AudioVideo;Audio;Player;Music;',
    desktop: {
      // https://www.electron.build/app-builder-lib.interface.linuxdesktopfile
      // https://www.electronjs.org/docs/latest/tutorial/linux-desktop-actions
      // https://specifications.freedesktop.org/desktop-entry-spec/latest/example.html
      // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html#desktop-files
      entry: {
        Name: 'LX Focus',
        'Name[zh_CN]': 'LX Focus',
        'Name[zh_TW]': 'LX Focus',
        Encoding: 'UTF-8',
        MimeType: 'x-scheme-handler/lxmusic',
        StartupNotify: 'false',
      },
    },
  },
  appImage: {
    license: './licenses/license_zh.txt',
    category: 'Utility;AudioVideo;Audio;Player;Music;',
  },
}
/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const macOptions = {
  mac: {
    icon: './resources/icons/icon.icns',
    category: 'public.app-category.music',
    // artifactName: '${productName}-${version}.${ext}',
  },
  dmg: {
    window: {
      width: 530,
      height: 380,
    },
    contents: [
      {
        x: 140,
        y: 200,
      },
      {
        x: 390,
        y: 200,
        type: 'link',
        path: '/Applications',
      },
    ],
    title: 'LX Focus v${version}',
  },
}

// win: {
// tagret: {
//   setup: ['nsis', '${productName}-v${version}-${env.ARCH}-Setup.${ext}'],
//   green: ['7z', '${productName}-v${version}-${env.ARCH}-green.${ext}'],
//   portable: ['portable', '${productName}-v${version}-${env.ARCH}-portable.${ext}'],
// },
// },
// linux: {
// platform: Platform.WINDOWS,
// arch: {
//   x64: builder.Arch.x64,
//   arm64: builder.Arch.arm64,
//   armv7l: builder.Arch.armv7l,
// },
// tagret: {
//   deb: ['deb', '${productName}_${version}_${env.ARCH}.${ext}'],
//   appImage: ['AppImage', '${productName}_${version}_${env.ARCH}.${ext}'],
//   pacman: ['pacman', '${productName}_${version}_${env.ARCH}.${ext}'],
//   rpm: ['rpm', '${productName}-${version}.${env.ARCH}.${ext}'],
// },
// },
// mac: {
// arch: {
//   x64: builder.Arch.x64,
//   x86: builder.Arch.ia32,
//   arm64: builder.Arch.arm64,
// },
// tagret: {
//   dmg: ['dmg', '${productName}-${version}-${env.ARCH}.${ext}'],
// },
// },

const createTarget = {
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  win(arch, packageType) {
    switch (packageType) {
      case 'setup':
        winOptions.artifactName = `\${productName}-v\${version}-${arch}-Setup.\${ext}`
        return {
          buildOptions: { win: ['nsis'] },
          options: winOptions,
        }
      case 'green':
        winOptions.artifactName = `\${productName}-v\${version}-win_${arch}-green.\${ext}`
        return {
          buildOptions: { win: ['7z'] },
          options: winOptions,
        }
      case 'win7_setup':
        winOptions.artifactName = `\${productName}-v\${version}-win7_${arch}-Setup.\${ext}`
        return {
          buildOptions: { win: ['nsis'] },
          options: winOptions,
        }
      case 'win7_green':
        winOptions.artifactName = `\${productName}-v\${version}-win7_${arch}-green.\${ext}`
        return {
          buildOptions: { win: ['7z'] },
          options: winOptions,
        }
      case 'portable':
        winOptions.artifactName = `\${productName}-v\${version}-${arch}-portable.\${ext}`
        return {
          buildOptions: { win: ['portable'] },
          options: winOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  linux(arch, packageType) {
    switch (packageType) {
      case 'deb':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch == 'x64' ? 'amd64' : arch}.\${ext}`
        return {
          buildOptions: { linux: ['deb'] },
          options: linuxOptions,
        }
      case 'appImage':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch}.\${ext}`
        return {
          buildOptions: { linux: ['AppImage'] },
          options: linuxOptions,
        }
      case 'pacman':
        linuxOptions.artifactName = `\${productName}_\${version}_${arch}.\${ext}`
        return {
          buildOptions: { linux: ['pacman'] },
          options: linuxOptions,
        }
      case 'rpm':
        linuxOptions.artifactName = `\${productName}-\${version}.${arch}.\${ext}`
        return {
          buildOptions: { linux: ['rpm'] },
          options: linuxOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
  /**
   *
   * @param {*} arch
   * @param {*} packageType
   * @returns {{ buildOptions: import('electron-builder').CliOptions, options: import('electron-builder').Configuration }}
   */
  mac(arch, packageType) {
    switch (packageType) {
      case 'dmg':
        macOptions.artifactName = `\${productName}-\${version}-${arch}.\${ext}`
        return {
          buildOptions: { mac: ['dmg'] },
          options: macOptions,
        }
      default: throw new Error('Unknown package type: ' + packageType)
    }
  },
}

// directories.output 写的是 './build'，相对项目根目录（本文件位于 build-config/ 下）
const OUTPUT_DIR = path.resolve(__dirname, '..', 'build')

/**
 * 清掉 electron-builder 留在产物目录里的更新元数据。
 *
 * latest.yml / latest-mac.yml / latest-linux.yml 是给更新服务器用的文件清单
 * （版本号 + 安装包 sha512 + 发布日期），只在发布自动更新时有意义。本 fork 不做
 * 自动更新，留在产物目录里既没用，又会让人误以为这里有一套配套的更新发布流程。
 *
 * 必须在 `builder.build()` 兑现之后再调用 —— 这些文件是 executeFinally 里的
 * publishManager.awaitTasks() 写出来的，时序晚于 afterAllArtifactBuild 钩子，
 * 详见上面 options 里那段关于 publish 的注释。
 */
const removeUpdateMetadata = async() => {
  await Promise.all([
    'latest.yml',
    'latest-mac.yml',
    'latest-linux.yml',
  ].map(name => fs.rm(path.join(OUTPUT_DIR, name), { force: true })))
}

/**
 *
 * @param {'win' | 'mac' | 'linux' | 'dir'} target 构建目标平台
 * @param {'x86_64' | 'x64' | 'x86' | 'arm64' | 'armv7l'} arch 包架构
 * @param {*} packageType 包类型
 * @param {'onTagOrDraft' | 'always' | 'never'} publishType 发布类型
 */
const build = async(target, arch, packageType, publishType) => {
  if (target == 'dir') {
    await builder.build({
      dir: true,
      config: { ...options, ...winOptions, ...linuxOptions, ...macOptions },
    })
    return
  }
  const targetInfo = createTarget[target](arch, packageType)
  // Promise is returned
  await builder.build({
    ...targetInfo.buildOptions,
    publish: publishType ?? 'never',
    x64: arch == 'x64' || arch == 'x86_64',
    ia32: arch == 'x86' || arch == 'x86_64',
    arm64: arch == 'arm64',
    armv7l: arch == 'armv7l',
    config: { ...options, ...targetInfo.options },
  })
  // 收尾：builder.build() 兑现之后，latest.yml 才刚被 publishManager 写出来
  await removeUpdateMetadata()
  // .then((result) => {
  //   console.log(JSON.stringify(result))
  // })
  // .catch((error) => {
  //   console.error(error)
  // })
}

const params = {}

for (const param of process.argv.slice(2)) {
  const [name, value] = param.split('=')
  params[name] = value
}

if (params.target == null) throw new Error('Missing target')
if (params.target != 'dir' && params.arch == null) throw new Error('Missing arch')
if (params.target != 'dir' && params.type == null) throw new Error('Missing type')

console.log(params.target, params.arch, params.type, params.publish ?? '')
build(params.target, params.arch, params.type, params.publish)
