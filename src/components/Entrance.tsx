import React, {useEffect, useRef} from 'react';
import {StyleProp, ViewStyle} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import {observer} from 'mobx-react';

import {modelStore, uiStore} from '../store';
import {useScreenActive} from '../utils/ScreenActive';
import {ENTRANCE} from '../theme/motion';
import {MOTION_ENABLED} from '../utils/disableMotion';

/**
 * 入场动画「地板透明度」。
 *
 * 之前重播时直接把 progress 归零并映射到 opacity:0 —— 整块内容瞬间全透明，
 * 露出底下的页面底色（浅色主题是 #FAF9FF，肉眼就是「闪一下白屏」），
 * 然后才一格一格淡进来。切页卡顿/白闪，九成来自这里。
 *
 * 现在 progress 仍然 0→1 走完整个动画，但映射出来的透明度是 0.55→1：
 * 内容从头到尾都看得见，观感变成「轻轻浮上来」，而不是「先白一下再长出来」。
 */
const OPACITY_FLOOR = 0.68;

/** 每级错峰间隔（ms）。原来 55ms 太慢，长列表越往下等越久，看着像卡住。 */
const STAGGER_MS = 18;
/** 错峰最多算到第几级，超出的同批出场，避免长列表尾部迟迟不出现。 */
const STAGGER_CAP = 5;

/**
 * 超过这一层的区块不再创建动画节点，直接静态显示。
 *
 * 列表型页面（会话列表 / 更多 / 设置 / 模型卡片）动辄几十个区块，
 * 每个都建一个 Animated.timing 并在切页那一刻一起 start —— 一次性
 * 创建几十个动画节点正是「切页卡一下」的另一半来源。首屏看得见的
 * 前几项照旧有动画，屏幕外的直接省略，肉眼分辨不出来。
 */
const MAX_ANIMATED_INDEX = 6;
/** 低端机同屏最多播几个入场动画。其余直接静态显示。 */
const MAX_ANIMATED_INDEX_LOW = 3;

/**
 * 低端机（deviceTier === 'low'）的动画降级。
 *
 * 只降「节奏和数量」，不动任何功能与布局：
 *   · 同屏动画节点 7 → 4 个（其余直接静态，肉眼几乎看不出差别）
 *   · 时长 260 → 190ms（更短，更快结束，留给主线程干别的）
 *   · 错峰 26 → 16ms（尾部等待更短）
 *
 * 为什么用 deviceTier 而不是硬编码：项目本来就有设备规则引擎
 * （low/mid/high/flagship），这里直接复用，不在组件里重复判断硬件。
 */
const LOW_TIER_OVERRIDE = {
  maxIndex: MAX_ANIMATED_INDEX_LOW,
  duration: 190,
  staggerMs: 10,
} as const;

interface Props {
  /** 出场顺序，0 开始；每级延后 26ms（最多算到第 5 级） */
  index?: number;
  /** 起始下移距离，默认 10 */
  offset?: number;
  /** 时长，默认 200ms */
  duration?: number;
  /**
   * 起始透明度，默认 0.55。
   * 不要调到 0 —— 那就会回到「先白屏再出内容」的老问题。
   */
  floor?: number;
  /**
   * 这个区块属于哪个页面（'home' / 'models' / 'more' / 'profile'，
   * 或二级页名如 'speech'）。只订阅自己那一页的重播信号 ——
   * 否则任何一页调 replayScreenEnter() 都会让所有页面同时重播，
   * 几十个动画节点一起起，既卡又像「动画播了两遍」。
   * 不传则退回全局 epoch（兼容旧调用）。
   */
  screenKey?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * 页面内容入场动画：淡入 + 轻微上移。
 *
 * 全 App 每个页面的每个区块都用它，保证「每个页面都有动画、不漏」。
 * 用 index 做错峰，越靠下的区块出场越晚一点，观感是一条条落下来。
 *
 * 性能：全程 useNativeDriver，走原生驱动，低端机也不掉帧。
 *
 * 重播：订阅 uiStore.screenEpoch。切走再回到同一个页面时组件并没有重新
 * 挂载，光靠 mount 钩子只会播第一次；之前从 Tab 切回来看到的是硬切，
 * 就是因为这个。现在每次切页/进二级页都会重播一次。
 *
 * 全局关闭动画时（MOTION_ENABLED = false）走AnimatedEntrance 之外的
 * 分支：**直接渲染 children，不建 Animated.Value、不建 Animated.View**，
 * 少一层原生视图、少一次 interpolate 求解。
 */
export const Entrance: React.FC<Props> = observer(props =>
  MOTION_ENABLED ? <AnimatedEntrance {...props} /> : <>{props.children}</>,
);

const AnimatedEntrance: React.FC<Props> = observer(
  ({
    index = 0,
    offset = 10,
    duration = ENTRANCE.duration,
    floor = OPACITY_FLOOR,
    screenKey,
    style,
    children,
  }) => {
    // 低端机降规格（只改节奏，不改布局）
    const isLowTier = modelStore.deviceTier === 'low';
    const maxIndex = isLowTier
      ? LOW_TIER_OVERRIDE.maxIndex
      : MAX_ANIMATED_INDEX;
    const staggerMs = isLowTier ? LOW_TIER_OVERRIDE.staggerMs : STAGGER_MS;
    const effDuration = isLowTier
      ? Math.min(duration, LOW_TIER_OVERRIDE.duration)
      : duration;

    // 层级太深的区块不建动画，直接停在「已完成」状态
    const animated = index <= maxIndex;
    // 常驻挂载后同一时刻有多个页面实例；只有前台那一页才真的播动画
    const isActive = useScreenActive();
    // 只订阅自己那一页的 epoch；没传 screenKey 就退回全局值。
    // 用 Map.get 而不是 [] 访问：observable.map 只有这个 key 的 observer
    // 会被通知，其它页面的 Entrance 不受影响。
    const epoch = screenKey
      ? (uiStore.screenEpochByKey.get(screenKey) ?? 0)
      : uiStore.screenEpoch;

    // ⚠️ 这里用 reanimated 的 sharedValue 而不是 RN 的 Animated.Value。
    //
    // 旧实现走 Animated.timing + useNativeDriver:false（因为要 setValue(0)
    // 重播，混用 native driver 会抛 "moved to native"，见历史踩坑）。
    // 代价是**每个 Entrance 的每一帧插值都在 JS 线程算** —— 低端机上
    // 一次切页十几个区块同时跑，直接和布局抢线程，观感就是"动画卡"。
    //
    // reanimated 的 sharedValue 活在 UI 线程，withTiming 由原生帧回调驱动，
    // JS 再忙也不影响它。同一个 0→1 的进度，插值也在 UI 侧完成。
    const progress = useSharedValue(animated ? 0 : 1);

    // 已经为「当前 epoch」播过一次没有。
    //
    // 为什么需要它：isActive 必须以依赖身份参与，否则会漏播 ——
    // 二级页用的是 ScreenActiveProviderDeferred（**先 false 后 true**），
    // 组件挂载那一刻 isActive=false，effect 把 progress 直接置 1，
    // 两帧后 active 变 true 时 effect 却不重跑，那块内容就**永远没有入场动画**。
    // 这正是「有的页面没有动画」的根因。
    //
    // 但 isActive 进依赖会带来另一个问题：切 Tab 翻页时
    // active 也会 false→true，如果每次都重播，几十个区块会在翻页过程中
    // 一起起动画、和翻页位移抢线程（这就是当初把 isActive 拿出去的原因）。
    //
    // 用 epoch 区分两者：
    //   · 翻页回来 —— epoch 没变，且已经播过 → 不再重播
    //   · 进二级页 —— epoch 变了 → 重播
    //   · 首次激活 —— 从没播过 → 一定要播
    const lastEpochRef = useRef<number | null>(null);

    useEffect(() => {
      if (!animated) {
        // index 太深的区块：不做动画，直接停在完成态
        progress.value = 1;
        return;
      }
      if (!isActive) {
        // 还没轮到前台（或正在等首屏布局）：保持完成态，等激活
        progress.value = 1;
        return;
      }
      const isNewEpoch = lastEpochRef.current !== epoch;
      if (!isNewEpoch && lastEpochRef.current !== null) {
        // 翻页回到前台，且这个 epoch 已经播过 → 不重播
        return;
      }
      lastEpochRef.current = epoch;

      // 归零再播。progress 只是进度，opacity 被映射到 floor，
      // 所以不会露底色、不会白闪。
      progress.value = 0;
      progress.value = withDelay(
        Math.min(index, STAGGER_CAP) * staggerMs,
        withTiming(1, {
          duration: effDuration,
          // 对齐 EmphasizedDecelerate（0.05, 0.7, 0.1, 1.0）
          easing: Easing.bezier(0.05, 0.7, 0.1, 1),
        }),
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [animated, isActive, index, effDuration, epoch]);

    // 插值放在 UI 线程
    const animatedStyle = useAnimatedStyle(() => ({
      opacity: interpolate(progress.value, [0, 1], [floor, 1]),
      transform: [
        {translateY: interpolate(progress.value, [0, 1], [offset, 0])},
      ],
    }));

    return (
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    );
  },
);
