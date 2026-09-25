const { afterPack } = require('./deps')

const fs = require('fs').promises
const path = require('path')

// https://github.com/electron-userland/electron-builder/issues/4630
// https://github.com/electron-userland/electron-builder/issues/4630#issuecomment-782020139

module.exports = async(context) => {
  await afterPack()
  const { electronPlatformName, appOutDir } = context

  /*
   * 移除 electron-builder 自动生成的 app-update.yml。
   *
   * 这个文件只有一个用途：告诉 electron-updater 去哪儿找新版本。本 fork 已经把
   * 应用内的检查更新 / 下载更新整条链路删掉了，客户端根本不会读它。
   *
   * 之所以要主动删除而不是「放着不管」：它的内容由 package.json 的 repository
   * 推导而来。fork 里这个字段只要还写着上游坐标，产物内就会带一份指向
   * lyswhut/lx-music-desktop 的更新配置 —— 谁哪天手滑执行了 publish=always，
   * 就会把 Release 推到别人的仓库去。与其指望坐标永远填对，不如从产物里拿掉。
   */
  if (electronPlatformName === 'win32' || electronPlatformName === 'linux') {
    await fs.rm(path.join(appOutDir, 'resources', 'app-update.yml'), { force: true })
  }

  if (electronPlatformName !== 'darwin') return
  const {
    productFilename,
    info: {
      _metadata: { macLanguagesInfoPlistStrings },
    },
  } = context.packager.appInfo

  const resPath = `${appOutDir}/${productFilename}.app/Contents/Resources`

  // 创建APP语言包文件
  return Promise.all(
    Object.entries(macLanguagesInfoPlistStrings).map(([lang, config]) => {
      let infos = Object.entries(config).map(([k, v]) => `"${k}" = "${v}";`).join('\n')
      return fs.writeFile(`${resPath}/${lang}.lproj/InfoPlist.strings`, infos)
    }),
  )
}
