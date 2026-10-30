import {Dimensions} from 'react-native';

import {Theme} from '../utils/types';
import {uiStore} from '../store';

// 全应用统一 BAVoice / MIUIX 风格：
//   - 页面底：近白（浅色 #FAF9FF）
//   - 卡片：浅灰（theme.colors.surface），无边框、无阴影
//   - 小节标题：蓝色竖杠 + 深色粗体字
export const CARD_RADIUS = 18;

/** 强调色：跟随「关键色」设置，未设置时用默认那套蓝 */
export const sectionAccent = (): string => uiStore.keyColor ?? '#297CF2';

/**
 * 模块圆角：跟随「界面风格」设置
 *   - MIUIX（HyperOS）：18，大圆角浅灰模块
 *   - 标准（Material）：12，收敛的标准 Material 圆角
 */
export const cardRadius = (): number =>
  uiStore.themeStyle === 'standard' ? 12 : CARD_RADIUS;

/**
 * 悬浮胶囊栏圆角，跟随界面风格。
 * 半径直接由胶囊栏高度推导（高 ÷ 2），两端永远是完整半圆 —— 也就是最圆的胶囊形。
 * 这样以后调胖瘦只需要改 PILL_BAR_HEIGHT 一个数，圆角会自动跟上，
 * 不会再出现「高度改了、半径还写死」导致两端变方的问题。
 * 标准（Material）风格下不做胶囊，用 12 的常规圆角。
 */
export const pillRadius = (): number =>
  uiStore.themeStyle === 'standard' ? 12 : PILL_BAR_HEIGHT / 2;

/* ------------------------------------------------------------------
 * 横向尺寸：按屏宽等比推导，不能写死
 * ------------------------------------------------------------------
 * 之前左右边距全是固定 dp（胶囊栏 40），那些数字是照着某机型
 * （720x1600 / 320dpi = 360dp 宽）调的。搬到 411dp 宽的机器上（如
 * 1440x3200 / 560dpi）占屏比例就变了，看起来就是「错位」—— 实际是
 * 横向留白没跟着屏宽走。
 *
 * 所以下面统一按「基准 360dp」折算：360dp 屏上算出来还是原来的数，
 * 宽屏上按比例放大，两台机器观感一致。
 * ------------------------------------------------------------------ */

/** 基准设计宽度（dp）。360 = 常见窄屏，数值与旧版写死值保持一致 */
const BASE_WIDTH = 360;

/** 当前屏宽（dp），取竖屏短边，横竖屏切换时自动跟随 */
const screenWidthDp = (): number => {
  const {width, height} = Dimensions.get('window');
  return Math.min(width, height);
};

/**
 * 把「按360dp 设计出来的固定值」换算成当前屏宽下的值。
 * 屏宽 ≥ 基准时按比例放大，但设上限 1.15 —— 不然平板/折叠屏上会拉得太夸张。
 */
const scaleX = (designDp: number): number =>
  Math.min(designDp * (screenWidthDp() / BASE_WIDTH), designDp * 1.15);

/** 胶囊栏左右外边距（屏宽的 ~11%，360dp 屏上 = 40） */
export const PILL_BAR_SIDE = scaleX(40);
/** 胶囊栏离屏幕底部的距离 */
export const PILL_BAR_BOTTOM = 36;
/** 胶囊栏固定高度（只影响「胖瘦」，左右两端由 PILL_BAR_SIDE 决定） */
export const PILL_BAR_HEIGHT = 64;

/**
 * 「添加模型」按钮：宽度、离屏幕右侧的距离、与胶囊栏之间的间距。
 * 高度不在这里定 —— 它跟胶囊栏共用 PILL_BAR_HEIGHT，保证两者上下沿严格对齐。
 */
export const ADD_BUTTON_SIZE = 56;
export const ADD_BUTTON_SIDE = scaleX(24);
export const ADD_BUTTON_GAP = 12;

/* ------------------------------------------------------------------
 * 顶部栏（页面标题栏）统一尺寸
 * 主屏幕顶部栏与设置页（含所有二级页）顶部栏共用这几个值，
 * 保证两边完全一致、不会各改各的而走样。
 * ------------------------------------------------------------------ */

/** 顶部栏内容区基准高度（不含系统状态栏那一段） */
export const HEADER_HEIGHT = 56;

/** 顶部栏额外向下加长的部分：只加长下半段，文字与图标位置不变 */
export const HEADER_EXTRA = 14;

/** 顶部栏底色：与卡片同色（浅灰面），整条铺满状态栏区域 */
export const headerBg = (theme: Theme): string => theme.colors.surface;

/**
 * 磨砂（毛玻璃）模式下，顶栏与卡片共用的统一半透明色。
 * 与首页卡片的磨砂底色完全一致（0.62 alpha），保证「顶栏 = 底卡」同透明。
 */
export const frostedSurface = (theme: Theme): string =>
  theme.dark ? 'rgba(28, 28, 32, 0.62)' : 'rgba(255, 255, 255, 0.62)';

/** 顶部栏标题字（主标题统一用这套字重字号） */
export const HEADER_TITLE_SIZE = 23;
export const HEADER_TITLE_WEIGHT = '800' as const;

/** 顶部栏左右「模块」按钮尺寸：主屏幕的设置/侧边栏按钮、二级页返回按钮共用 */
export const HEADER_MODULE_SIZE = 46;
/** 上面这些模块按钮里的图标大小 */
export const HEADER_ICON_SIZE = 24;

/**
 * 顶部栏左右「模块」按钮的圆角：跟随「界面风格」
 *   - MIUIX：13，圆角方块
 *   - 标准（Material）：8，更收敛
 */
export const headerModuleRadius = (): number =>
  uiStore.themeStyle === 'standard' ? 8 : 13;

/**
 * 顶部栏底部两个角的圆角：跟随「界面风格」
 *   - MIUIX（rounded）和液态玻璃：20，条子像一块圆角模块盖下来
 *   - 标准（standard）：0，直角
 * 主屏幕、设置页（含二级页）、对话二级页都用这一个值，保证一致。
 *
 * ⚠️ 这里判断的是「是不是 standard」而不是「是不是 rounded」——
 * 液态玻璃风格的几何必须与 MIUIX **完全一致**（玻璃只改表面质感，不改尺寸），
 * 如果写成 `=== 'rounded' ? 20 : 0`，选液态玻璃时顶栏会变成直角，就和 MIUIX 不一样了。
 */
export const headerBottomRadius = (): number =>
  uiStore.themeStyle === 'standard' ? 0 : 20;

/** 卡片底色：浅色主题为浅灰面，深色主题为深色面 */
export const cardBg = (theme: Theme): string => theme.colors.surface;

/**
 * 弹窗（Modal）专用玻璃色调。
 *
 * 历史：曾用过近白 #F1F2F7（太亮，像白纸）→ 又压成 #E3E6EC 中性灰（用户反馈
 * 「磨砂有点太暗」）。现在取两者之间偏亮的中性色 #EEF1F6：既不泛白，也不会
 * 把整块面板压成灰板；配合更低的 tintOpacity，让背后的模糊层透出来。
 */
export const dialogGlassTint = (theme: Theme): string =>
  theme.dark ? '#343943' : '#EEF1F6';

/**
 * 玻璃（液态玻璃 / 磨砂）色调。
 *
 * alpha 就是「不透明度」：0.25 = 通透 75%。
 * 壁纸现在铺到了每一个页面，所以两档几乎一致（0.25 / 0.26）；
 * 之前 0.45 的白叠在浅色底上会显得惨白。
 */
export const glassTint = (
  theme: Theme,
  backdrop: 'wallpaper' | 'solid' = 'solid',
): string => {
  const a = backdrop === 'wallpaper' ? 0.28 : 0.38;
  // 中性灰（MIUIX 卡片面）而不是纯白：浅色壁纸下纯白会泛白刺眼
  return theme.dark ? `rgba(28, 32, 39, ${a})` : `rgba(241, 242, 247, ${a})`;
};

/**
 * 导航顶栏的底色。
 *
 * 液态玻璃风格下用半透明（透出根层壁纸，近似磨砂玻璃）；
 * 其他风格保持原来的实底，零视觉变化。
 *
 * ⚠️ 顶栏**不能**直接放真玻璃视图：顶栏在 scene 之上，而壁纸在 scene 内，
 * 玻璃采样不到背景就会渲染成一片空白亮白。
 */
export const headerTranslucent = (
  theme: Theme,
  /** 非玻璃风格下的回落色（各顶栏原本的实底，保证 MIUIX/标准 零视觉变化） */
  base: string = theme.colors.background,
): string => {
  if (uiStore.themeStyle !== 'liquid-glass') {
    return base;
  }
  // 0.40 与卡片玻璃保持一致：再高就会在浅色壁纸上显成一块白条
  return theme.dark ? 'rgba(28, 32, 39, 0.42)' : 'rgba(241, 242, 247, 0.40)';
};

/**
 * 壁纸蒙版：铺在壁纸上、内容下面的一层极淡的膜。
 *
 * 作用：壁纸是彩色插画，直接在上面放深色文字（比如「推荐模型」、空状态说明）
 * 会糊成一片。加一层和文字方向相反的淡色膜把对比度拉回来：
 *   · 浅色主题 → 极淡的白（提亮底，深色字更清楚）
 *   · 深色主题 → 极淡的黑（压暗底，浅色字更清楚）
 * 数值刻意压得很低（0.22），壁纸的图案和颜色依然清楚可见。
 */
export const wallpaperScrim = (theme: Theme): string =>
  theme.dark ? 'rgba(0, 0, 0, 0.30)' : 'rgba(255, 255, 255, 0.22)';

/**
 * 按钮「最外圈高光」的颜色。
 *
 * 液态玻璃风格下给按钮描一圈亮白边（按键的玻璃质感全靠这圈边）；
 * 其他风格返回 transparent —— 和原来完全一致。
 */
export const buttonRing = (theme: Theme): string =>
  uiStore.themeStyle === 'liquid-glass'
    ? theme.dark
      ? 'rgba(255,255,255,0.34)'
      : 'rgba(255,255,255,0.68)'
    : 'transparent';

/** 玻璃边缘的高光描边色 */
export const glassStroke = (theme: Theme): string =>
  theme.dark ? 'rgba(226, 232, 240, 0.22)' : 'rgba(255, 255, 255, 0.65)';

/**
 * 液态玻璃风格的按钮底。
 *
 * Paper v5 Button 的背景/边框由内部 buttonStyle 提供，但调用方 `style`
 * 在样式数组里排在 buttonStyle **之后** —— 传 backgroundColor /
 * borderColor / borderWidth 会覆盖内部值，所以不需要动 Button 源码。
 *
 * 用法（两种风格零分支）：
 *   outlined: style={[styles.btn, glassButton(theme)]}
 *   contained: style={[styles.btn, glassButton(theme, 'filled')]}
 *             textColor={theme.colors.primary}
 *
 * 非玻璃风格返回 {} —— 展开进数组是空对象，观感与原来完全一致。
 */
export const glassButton = (
  theme: Theme,
  variant: 'filled' | 'outlined' = 'outlined',
): {
  backgroundColor: string;
  borderWidth: number;
  borderColor: string;
} => {
  if (uiStore.themeStyle !== 'liquid-glass') {
    return {} as ReturnType<typeof glassButton>;
  }
  // 之前 outlined 只有 0.34 的近白填充，叠在浅色弹窗上几乎看不见，只剩一圈
  // 描边（用户反馈「按键只有一圈高光」）。提高到 0.5 / 0.64，让按钮有明确
  // 的玻璃填充、一眼能看出是「可按的键」，同时仍保留高光描边。
  const alpha = variant === 'filled' ? 0.64 : 0.5;
  return {
    backgroundColor: theme.dark
      ? `rgba(28, 32, 39, ${alpha})`
      : `rgba(241, 242, 247, ${alpha})`,
    borderWidth: 1,
    borderColor: buttonRing(theme),
  };
};

export const flatCard = (theme: Theme) => ({
  backgroundColor: cardBg(theme),
  borderRadius: cardRadius(),
});
