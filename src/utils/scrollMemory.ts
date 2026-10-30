import {useCallback, useRef} from 'react';
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native';

/**
 * 滚动位置记忆。
 *
 * 解决的问题：
 *   「在一个页面向下滚动 → 打开二级页 → 返回，页面回到了顶部」。
 *
 * 根因是**组件被卸载了**，不是滚动被重置：
 *   · App.tsx 的 `renderMore()` 对 `moreSub` 做 switch —— 只要进了二级页，
 *     `MoreScreen` 整棵子树就被卸载，ScrollView 的滚动偏移随实例一起消失。
 *   · 首页同理：`homeSub === 'chat'` 时 `HomeScreen` 被 `ChatScreen` 顶掉。
 *   · 返回时重新挂载，新 ScrollView 从 0 开始 —— 就是「弹回顶部」。
 *
 * 为什么不用「把父页面留着不卸载、二级页盖上去」：
 *   那需要改渲染结构（父页做底层、二级页做绝对定位层），并且让转场只滑
 *   新层。当前 `subDX` 是整个内容容器的位移，两层一起滑会得到错误的观感；
 *   而「不变任何界面视觉」这条约束下，动渲染结构风险太高。
 *
 * 所以这里记住偏移量，重新挂载时**无动画**滚回去 —— 视觉上等价于没离开过。
 *
 * 用法：
 *   const scroll = useScrollMemory('more');
 *   <ScrollView
 *     ref={scroll.ref}
 *     onScroll={scroll.onScroll}
 *     scrollEventThrottle={16}
 *     onContentSizeChange={scroll.onContentSizeChange}>
 *
 * 注意 `onContentSizeChange` 里必须等内容量出高度后再滚：
 * 挂载瞬间内容高度还是 0，那时 scrollTo 会被忽略（滚不动）。
 */

const offsets = new Map<string, number>();

export interface ScrollMemory {
  ref: React.RefObject<ScrollView | null>;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onContentSizeChange: () => void;
}

export function useScrollMemory(key: string): ScrollMemory {
  const ref = useRef<ScrollView | null>(null);
  // 上一次已知偏移。初值从 Map 里取，所以重新挂载时能接上。
  const lastY = useRef<number>(offsets.get(key) ?? 0);
  // 是否已经还原过。内容尺寸可能多次变化（图片加载、列表增长），
  // 只在第一次量出高度时还原，否则会把用户的滚动反复拽回去。
  const restored = useRef(false);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      lastY.current = e.nativeEvent.contentOffset.y;
      offsets.set(key, lastY.current);
    },
    [key],
  );

  const onContentSizeChange = useCallback(() => {
    if (restored.current) {
      return;
    }
    const y = lastY.current;
    if (y <= 0) {
      restored.current = true;
      return;
    }
    // 内容高度还不足时不要标记完成，等下一次回调再试
    const node = ref.current;
    if (!node) {
      return;
    }
    node.scrollTo({y, animated: false});
    restored.current = true;
  }, []);

  return {ref, onScroll, onContentSizeChange};
}

/** 清掉某个页面记住的位置（例如用户主动「回到顶部」时） */
export function forgetScroll(key: string): void {
  offsets.delete(key);
}
