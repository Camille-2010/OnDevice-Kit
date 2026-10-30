/**
 * 动画参数中心 —— 全部取自 BAVoice 的 Compose 实现（anim/Motion.kt）。
 *
 * ⚠️ 这个文件**只管动画**：时长、缓动、弹簧、位移比例。
 *    任何尺寸 / 颜色 / 圆角 / 间距都不在这里，也**不要**往这里加 ——
 *    那些属于「视觉」，复刻动画时不能动。
 *
 * 和 Compose 的对应关系：
 *   Motion.Fast / Standard / Medium ...  → 下面同名常量
 *   CubicBezierEasing(a,b,c,d)           → bezier(a,b,c,d) 生成的 Easing
 *   spring(dampingRatio, stiffness)      → springFromCompose(...) 转成 RN 的
 *                                          Animated.spring 参数
 */

import {Easing} from 'react-native';

/** 时长（ms），与 Compose 端一一对应 */
export const DURATION = {
  /** 90 —— 纯瞬时反馈 */
  instant: 90,
  /** 220 —— 退出、指示器微调 */
  fast: 220,
  /** 320 —— 标准转场 */
  standard: 320,
  /** 420 —— 横向整屏翻页 */
  medium: 420,
  /** 520 —— iOS 弹层 */
  slow: 520,
  /** 700 —— Hero 级 */
  hero: 700,
} as const;

/**
 * 三次贝塞尔缓动。
 * React Native 的 Easing 没有直接给 CubicBezierEasing，
 * 但 Easing.bezier(x1, y1, x2, y2) 就是它，参数含义和 Compose 完全一致。
 */
const bezier = (x1: number, y1: number, x2: number, y2: number) =>
  Easing.bezier(x1, y1, x2, y2);

export const EASE = {
  /** EmphasizedDecelerate —— 进入（快起慢收） */
  emphasizedDecelerate: bezier(0.05, 0.7, 0.1, 1.0),
  /** EmphasizedAccelerate —— 退出（慢起快收） */
  emphasizedAccelerate: bezier(0.3, 0.0, 0.8, 0.15),
  /** StandardEasing = FastOutSlowIn */
  standard: Easing.inOut(Easing.quad),
  /** GentleIn = LinearOutSlowIn */
  gentleIn: Easing.out(Easing.quad),
  /** GentleOut = FastOutLinearIn */
  gentleOut: Easing.in(Easing.quad),
  /** LiquidEasing —— y1 = 1.35 > 1，带过冲（弹过头再回来） */
  liquid: bezier(0.2, 1.35, 0.4, 1.0),
  /** IosSheet —— iOS 弹层专用曲线 */
  iosSheet: bezier(0.32, 0.72, 0.0, 1.0),
} as const;

/** Compose 的 Spring 常数（StiffnessMediumLow 等） */
export const STIFFNESS = {
  low: 1200, // Spring.StiffnessLow
  mediumLow: 1500, // Spring.StiffnessMediumLow
  medium: 2000, // Spring.StiffnessMedium
  high: 4000, // Spring.StiffnessHigh
} as const;

/**
 * Compose spring(dampingRatio, stiffness) → RN Animated.spring 参数。
 *
 * ⚠️ 关键约束：RN 的 spring 配置分两套互斥参数 ——
 *      A) {mass, damping, stiffness}    （物理三件套）
 *      B) {bounciness, speed}           （观感二件套）
 *    **同时给两套时 B 会覆盖 A。** 旧实现同时塞了 damping / bounciness / speed，
 *    结果 damping 被忽略，回弹由 bounciness 单独决定，和 Compose 的
 *    dampingRatio 对不上、换不来真正的过冲。
 *
 *    这里改用 A 套（物理参数），因为 dampingRatio 与 stiffness 正好能
 *    一对一映射：
 *      ζ = damping / (2 * sqrt(stiffness * mass))
 *      → damping = 2 * ζ * sqrt(stiffness * mass)
 *
 *    Compose 的 stiffness 数值范围（1200~4000）比 RN 惯用值
 *    （通常 100~400）大一个量级，因为 Compose 内部按「每秒」计时。
 *    所以先除以经验缩放系数，再代入 —— 这样保持**相对快慢排序**不变，
 *    同时绝对速度落在肉眼舒适的区间。
 */

/** Compose stiffness → RN stiffness 的经验缩放 */
const STIFFNESS_SCALE = 12;

/** RN spring 的等效质量（固定 1，便于推导阻尼） */
const SPRING_MASS = 1;

/**
 * 把 Compose 的 (dampingRatio, stiffness) 转成 RN 的
 * {mass, damping, stiffness} 三件套。
 *
 * @param dampingRatio Compose dampingRatio；1.0 = 临界阻尼（不回弹），<1 回弹
 * @param stiffness    Compose stiffness 常数（用 STIFFNESS.*）
 * @param speedScale   整体快慢微调，默认 1
 */
export const springFromCompose = (
  dampingRatio: number,
  stiffness: number,
  speedScale = 1,
) => {
  const rnStiffness = Math.max(
    20,
    Math.round((stiffness / STIFFNESS_SCALE) * speedScale),
  );
  // 临界阻尼系数：ζ=1 时刚好不回弹
  const criticalDamping = 2 * Math.sqrt(rnStiffness * SPRING_MASS);
  const damping = Math.max(
    1,
    Math.round(dampingRatio * criticalDamping * 10) / 10,
  );
  return {
    mass: SPRING_MASS,
    damping,
    stiffness: rnStiffness,
  };
};

/**
 * 各处实际时长 —— 从 BAVoice 的档位里挑的，可按手感微调。
 */
export const ENTRANCE = {
  /** 内容区块入场。介于 Fast(220) 与 Standard(320) 之间 */
  duration: 260,
} as const;

export const TRANSITION = {
  /** 二级页转场。Fast 档：高频操作要跟手 */
  subPage: DURATION.fast,
  /** Tab 翻页补完。standard(320) → 260：点击后更快看到终点页，
   *  用户感知就是"反应快"，而 260ms 仍保留收尾的余韵 */
  tabFlip: 260,
  /** Tab 指示器滑动兜底时长（spring 通常先收敛） */
  tabIndicator: DURATION.fast,
  /** 跨多 Tab 直切（无滑动）时的淡入 */
  tabJump: DURATION.fast,
} as const;

export const SHEET = {
  /** 弹层进入。Medium 档（BAVoice 的 Slow(520) 实测偏慢） */
  enter: DURATION.medium,
  /** 弹层退出 */
  exit: DURATION.standard,
} as const;

/** 翻页吸附 —— dampingRatio 0.82 / StiffnessMediumLow（轻微回弹） */
export const SPRING_PAGER_SNAP = springFromCompose(0.82, STIFFNESS.mediumLow);

/** 液态指示器 —— dampingRatio 0.62 / StiffnessLow（跟手、明显过冲） */
export const SPRING_LIQUID_INDICATOR = springFromCompose(0.62, STIFFNESS.low);

/** 拖拽归位 —— dampingRatio 1.0 / StiffnessMedium（不回弹，干脆） */
export const SPRING_DAMPED_DRAG = springFromCompose(1.0, STIFFNESS.medium);

/** 浮层落定 —— dampingRatio 0.55 / StiffnessLow（软、回弹明显） */
export const SPRING_OVERLAY_SETTLE = springFromCompose(0.55, STIFFNESS.low);

/** Tab 图标选中放大 —— dampingRatio 0.7 / StiffnessMedium */
export const SPRING_TAB_ICON = springFromCompose(0.7, STIFFNESS.medium);

/** 按压回弹 —— dampingRatio 0.6 / StiffnessHigh（快速、带回弹） */
export const SPRING_PRESS = springFromCompose(0.6, STIFFNESS.high);

/**
 * 液态玻璃「按压缩放」统一倍率：按下放大到该值，松手回弹到 1。
 * 全项目所有玻璃卡片 / 胶囊 / 面板内元素统一用这一个值 —— 手感一致、且足够
 * 明显可观察（1.05 ≈ 放大一圈）。
 */
export const PRESS_SCALE = 1.05;

/**
 * 位移比例（相对屏宽 / 屏高）。
 * 和 BAVoice 的 slideHorizontal / slideVertical / sharedAxis 一致。
 */
export const OFFSET = {
  /** slideHorizontal：进入 100%，退出 -25% */
  hEnter: 1.0,
  hExit: -0.25,
  /** slideVertical：进入 100%，退出 1/6 */
  vEnter: 1.0,
  vExit: 1 / 6,
  /** sharedAxis X/Y：各 30% */
  sharedAxis: 0.3,
} as const;

/** 液态指示器的拉伸：stretch = 1 + distance * 0.18，上限 1.18 */
export const LIQUID = {
  stretchPerTab: 0.18,
  stretchMax: 1.18,
} as const;

/** Tab 选中/未选中的缩放与透明度 */
export const TAB_STATE = {
  selectedScale: 1.08,
  unselectedAlpha: 0.55,
} as const;

/** 轮播缩放/透明度（Hero / MultiBrowse） */
export const CAROUSEL = {
  heroScaleMax: 1.0,
  heroScaleMin: 0.82,
  heroAlphaMin: 0.55,
  browseScaleMin: 0.9,
} as const;

/** 转场方向 */
export const DIRECTION = {
  /** 前进：新页从右侧进入 */
  forward: 1 as const,
  /** 返回：新页从左侧进入 */
  backward: -1 as const,
};
