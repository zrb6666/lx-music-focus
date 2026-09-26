<template>
  <div ref="dom_menu" :class="$style.menu">
    <ul :class="$style.list" role="toolbar">
      <li v-for="item in menus" :key="item.to" :class="$style.navItem" role="presentation">
        <router-link :class="[$style.link, {[$style.active]: $route.meta.name == item.name}]" role="tab" :aria-selected="$route.meta.name == item.name" :to="item.to" :aria-label="item.tips">
          <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" :viewBox="item.iconSize" :height="item.size" :width="item.size" space="preserve">
            <use :xlink:href="item.icon" />
          </svg>
        </router-link>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { appSetting } from '@renderer/store/setting'
import { running as focusRunning } from '@renderer/store/focus'
import { useI18n } from '@root/lang'
import { ref, computed, watch } from '@common/utils/vueTools'
import { useIconSize } from '@renderer/utils/compositions/useIconSize'
import { useRoute, useRouter } from '@common/utils/vueRouter'

/*
 * 专注期间允许留在侧边栏的页面。
 *
 * 「专注」本身必须在 —— 计时读数、暂停与结束专注都在那个页面上，
 * 只留两个音乐页的话，切过去挑完歌就回不来了。
 * 搜索 / 歌单 / 排行榜 / 设置被隐藏：它们不是听歌必需的，
 * 却都是「本来只想看一眼，结果半小时没了」的入口。
 */
const FOCUS_ALLOWED_PAGES = ['Focus', 'List', 'Download']

export default {
  name: 'NavBar',
  setup() {
    const t = useI18n()
    const dom_menu = ref<HTMLElement>()
    const iconSize = useIconSize(dom_menu, 0.32)

    const route = useRoute()
    const router = useRouter()

    const menus = computed(() => {
      const size = iconSize.value
      return [
        {
          to: '/focus',
          // 专注是本项目的核心新增页面，未走 i18n 词条，直接使用中文标签
          tips: '专注',
          icon: '#icon-focus',
          iconSize: '0 0 24 24',
          size,
          name: 'Focus',
          enable: true,
        },
        {
          to: '/search',
          tips: t('search'),
          icon: '#icon-search-2',
          iconSize: '0 0 425.2 425.2',
          size,
          name: 'Search',
          enable: true,
        },
        {
          to: '/songList/list',
          tips: t('song_list'),
          icon: '#icon-album',
          iconSize: '0 0 425.2 425.2',
          size,
          name: 'SongList',
          enable: true,
        },
        {
          to: '/leaderboard',
          tips: t('leaderboard'),
          icon: '#icon-leaderboard',
          iconSize: '0 0 425.22 425.2',
          size,
          name: 'Leaderboard',
          enable: true,
        },
        {
          to: '/list',
          tips: t('my_list'),
          icon: '#icon-love',
          iconSize: '0 0 444.87 391.18',
          size,
          name: 'List',
          enable: true,
        },
        {
          to: '/download',
          tips: t('download'),
          icon: '#icon-download-2',
          iconSize: '0 0 425.2 425.2',
          size,
          enable: appSetting['download.enable'],
          name: 'Download',
        },
        {
          to: '/setting',
          tips: t('setting'),
          icon: '#icon-setting',
          iconSize: '0 0 493.23 436.47',
          size,
          enable: true,
          name: 'Setting',
        },
      ].filter(m => m.enable)
        .filter(m => !focusRunning.value || FOCUS_ALLOWED_PAGES.includes(m.name))
    })

    /*
     * 专注开始时如果人正站在被隐藏的页面上（比如从托盘或快捷键起的专注），
     * 页面本身已经进不去了，还留在那儿只会让人以为自己卡住了 —— 送回专注页。
     */
    watch(focusRunning, isRunning => {
      if (!isRunning) return
      const name = route.name as string | undefined
      if (!name || FOCUS_ALLOWED_PAGES.includes(name)) return
      void router.push('/focus')
    })

    return {
      appSetting,
      menus,
      dom_menu,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.menu {
  flex: auto;
  // &.controlBtnLeft {
  //   display: flex;
  //   flex-flow: column nowrap;
  //   justify-content: center;
  //   padding-bottom: @control-btn-height;
  // }
  // padding: 5px;
}
.list {
  -webkit-app-region: no-drag;
  // margin-bottom: 15px;
  &:last-child {
    margin-bottom: 0;
  }
  // background-color: pink;
  // dt {
  //   padding-left: 5px;
  //   font-size: 11px;
  //   transition: @transition-normal;
  //   transition-property: color;
  //   color: @color-theme-font-label;
  //   .mixin-ellipsis-1();
  // }
}
.navItem {
  position: relative;
  &:before {
    content: '';
    display: block;
    width: 100%;
    padding-bottom: 84%;
  }
}
.link {
  position: absolute;
  left: 0%;
  top: 0%;
  width: 100%;
  height: 100%;
  // left: 15%;
  // top: 15%;
  // width: 70%;
  // height: 70%;
  // display: block;
  box-sizing: border-box;
  // text-decoration: none;
  // border-radius: 20%;

  // padding: 18px 3px;
  // margin: 5px 0;
  // border-left: 5px solid transparent;
  transition: @transition-fast;
  transition-property: background-color, opacity;
  color: var(--color-nav-font);
  cursor: pointer;
  // font-size: 11.5px;
  text-align: center;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;

  // border-radius: @radius-border;
  .mixin-ellipsis-1();
  &:before {
    .mixin-after();
    left: 0;
    top: 0;
    width: 3px;
    height: 100%;
    background-color: var(--color-primary-dark-200-alpha-700);
    border-radius: 4px;
    transform: translateX(-100%);
    transition: transform @transition-fast;
  }

  &.active {
    // border-left-color: @color-theme-active;
    background-color: var(--color-primary-light-300-alpha-700);

    &:before {
      transform: translateX(0);
    }

    &:hover {
      background-color: var(--color-primary-light-300-alpha-800);
    }
  }


  &:hover {
    color: var(--color-nav-font);

    &:not(.active) {
      opacity: .8;
      background-color: var(--color-primary-light-400-alpha-700);
    }
  }
  &:active:not(.active) {
    opacity: .6;
    background-color: var(--color-primary-light-300-alpha-600);
  }
}

// .icon {
//   // margin-bottom: 5px;
//   &> svg {
//     width: 32%;
//   }
// }

</style>
