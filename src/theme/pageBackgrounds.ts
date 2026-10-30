import type {ImageSourcePropType} from 'react-native';
import {uiStore} from '../store';

/**
 * 页面背景选项（设置 → 外观 → 页面背景）。
 *
 * 全部为图片背景。本测试版统一使用桌面「新建文件夹」里的 8 张图。
 * 新增背景图：把图片放进 src/assets/home-bg/portrait/ 下并在此追加一项即可。
 */
export type PageBackground = {
  key: string;
  label: string;
  source: ImageSourcePropType;
};

export const PAGE_BACKGROUNDS: PageBackground[] = [
  {
    key: 'wall-001',
    label: '壁纸 1',
    source: require('../assets/home-bg/portrait/wall-001.jpg'),
  },
  {
    key: 'wall-002',
    label: '壁纸 2',
    source: require('../assets/home-bg/portrait/wall-002.jpg'),
  },
  {
    key: 'wall-003',
    label: '壁纸 3',
    source: require('../assets/home-bg/portrait/wall-003.jpg'),
  },
  {
    key: 'wall-004',
    label: '壁纸 4',
    source: require('../assets/home-bg/portrait/wall-004.jpg'),
  },
  {
    key: 'wall-005',
    label: '壁纸 5',
    source: require('../assets/home-bg/portrait/wall-005.jpg'),
  },
  {
    key: 'wall-006',
    label: '壁纸 6',
    source: require('../assets/home-bg/portrait/wall-006.jpg'),
  },
  {
    key: 'wall-007',
    label: '壁纸 7',
    source: require('../assets/home-bg/portrait/wall-007.jpg'),
  },
  {
    key: 'wall-008',
    label: '壁纸 8',
    source: require('../assets/home-bg/portrait/wall-008.jpg'),
  },
];

/** 安全取当前背景（下标越界/负数都回绕到合法值）。 */
export const getPageBackground = (index: number): PageBackground => {
  const len = PAGE_BACKGROUNDS.length;
  const i = ((index % len) + len) % len;
  return PAGE_BACKGROUNDS[i];
};

/**
 * 当前应显示的页面背景（整个 App 共用同一张）。
 *
 * · 开了「随机背景」→ 用本次启动的种子取图（切页/返回都不变，重启才换）
 * · 关了「随机背景」→ 用用户在设置里选的那一张
 *
 * 首页和各二级页都从这儿取，所以**每个页面背后的壁纸是同一张**，
 * 液态玻璃在任意页面都能折射到背景。
 */
export const getCurrentPageBackground = (): PageBackground => {
  const idx = uiStore.randomHomeBg
    ? Math.floor(uiStore.sessionBgSeed * PAGE_BACKGROUNDS.length)
    : uiStore.homeBgIndex;
  return getPageBackground(idx);
};
