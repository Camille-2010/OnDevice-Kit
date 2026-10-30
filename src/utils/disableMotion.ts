/**
 * 全局动画开关。
 *
 * ## 为什么不 patch `Animated.Value.prototype.animate`
 * 试过。理论上它是所有声明式动画的唯一收口，patch 掉就能一处关掉全部。
 * 实际会直接把界面搞坏：
 *   · 很多动画的 `toValue` 是**中间态**（opacity 0.45、位移中途值等），
 *     同步落过去就等于把组件永远停在那儿 —— 表现是内容半透明/错位，
 *     露出的底色就是「整体变白」。
 *   · `parallel / sequence` 依赖子动画的完成回调计数，patch 掉 animate 后
 *     它们要么永不回调（状态机死锁），要么重复回调。
 *   · `stopAnimation` 语义被破坏，进行中的动画无法取消。
 *
 * ## 也不要自己伪造 `{start, stop}` 对象冒充动画
 * 同样红屏：`Animated.parallel / sequence / stagger` 会去读内部字段
 *（`__getNativeAnimationConfig` 等），塞一个假对象进去立刻崩。
 *
 * ## 所以统一走这一种方式
 * 关闭时把配置转成 `Animated.timing({duration: 1})`：
 *   · 返回的是**真·Animated 动画对象**，parallel / sequence / stop 全部兼容
 *   · `duration: 1` 走 requestAnimationFrame 路径 → **回调仍是异步的**，
 *     和真动画同语义，不会出现「render 期间 setState」。
 *     ⚠️ 不要用 duration: 0 —— RN 会把它当同步路径，回调当场触发，更危险。
 *   · 视觉上 1ms 等于没有动画
 */
import {Animated} from 'react-native';

/**
 * 总开关。true = 播放 BAVoice 规格的动画；false = 全部瞬时到位（保留代码结构，
 * 便于 A/B 对比与排查掉帧来源）。
 */
export const MOTION_ENABLED = true;

type Cfg = {toValue?: number; [k: string]: any};

const instant = (value: any, config: Cfg) =>
  Animated.timing(value, {
    ...config,
    duration: 1,
    delay: 0,
    useNativeDriver: false,
  } as any);

/** `Animated.timing` 的开关版。 */
export const motionTiming = (value: any, config: Cfg) =>
  MOTION_ENABLED
    ? Animated.timing(value, config as any)
    : instant(value, config);

/**
 * `Animated.spring` 的开关版。
 * spring 没有 duration，关闭时降级成 1ms timing（视觉上同样是瞬时到位）。
 */
export const motionSpring = (value: any, config: Cfg) =>
  MOTION_ENABLED
    ? Animated.spring(value, config as any)
    : instant(value, config);

/** `Animated.decay` 的开关版。 */
export const motionDecay = (value: any, config: Cfg) =>
  MOTION_ENABLED
    ? Animated.decay(value, config as any)
    : instant(value, config);
