<template lang="pug">
dt#about {{ $t('setting__about') }}
dd
  .p.small
    | 本软件完全免费，代码已开源。开源地址：
    span.hover.underline(:aria-label="$t('setting__click_open')" @click="openUrl(repoUrl)") {{ repoUrl }}
  .p.small
    | 最新版下载地址：
    span.hover.underline(:aria-label="$t('setting__click_open')" @click="openUrl(releasesUrl)") GitHub Releases
  .p.small
    | 本软件基于 LX Music（原作者：落雪无痕）二次开发，聚焦功能的使用说明与常见问题可参考上游文档：
    span.hover.underline(:aria-label="$t('setting__click_open')" @click="openUrl('https://lyswhut.github.io/lx-music-doc/desktop/faq')") 桌面版常见问题
  .p.small
    strong 本软件没有客服
    | ，但我们整理了一些常见的使用问题。
    strong 仔细、仔细、仔细
    | 地阅读常见问题后，
  .p.small
    | 仍有问题可到&nbsp;GitHub&nbsp;
    span.hover.underline(:aria-label="$t('setting__click_open')" @click="openUrl(issuesUrl)") 提交&nbsp;Issue
    | 。
  br
  .p.small 由于软件开发的初衷仅是为了对新技术的学习与研究，因此软件直至停止维护都将会一直保持纯净。
  .p.small
    | 目前本项目的原始发布地址
    strong 只有&nbsp;GitHub
    | ，其他渠道均为第三方转载发布，可信度请自行鉴别。
  .p.small
    strong 本项目没有微信公众号之类的所谓「官方账号」，谨防被骗！

  .p.small
    | 你已签署本软件的
    base-btn(min @click="handleShowPact") 许可协议
    | 。
  br

  .p.small
    | 本项目基于
    strong.hover.underline(:aria-label="$t('setting__click_open')" @click="openUrl(upstreamUrl)") LX Music
    | 二次开发，遵循 Apache-2.0 协议；上游作者：落雪无痕。
</template>

<script>
import pkg from '../../../../../package.json'
import { isShowPact } from '@renderer/store'
import { openUrl, clipboardWriteText } from '@common/utils/electron'

export default {
  name: 'SettingAbout',
  setup() {
    /*
     * 仓库地址统一由 package.json 推导，避免在模板里散落硬编码字符串。
     * 发布前只需把 package.json 的 author.name 改成真实的 GitHub 账号或组织名，
     * 这里的开源地址、Releases、Issue 三个链接会一起生效。
     */
    const owner = pkg.author?.name ?? ''
    const repoUrl = `https://github.com/${owner}/${pkg.name}`
    const upstreamUrl = 'https://github.com/lyswhut/lx-music-desktop'

    const handleShowPact = () => {
      isShowPact.value = true
    }
    return {
      openUrl,
      clipboardWriteText,
      handleShowPact,
      repoUrl,
      releasesUrl: `${repoUrl}/releases`,
      issuesUrl: `${repoUrl}/issues`,
      upstreamUrl,
    }
  },
}
</script>
