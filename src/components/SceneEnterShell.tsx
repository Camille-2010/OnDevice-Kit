import React, {useEffect} from 'react';
import {StyleSheet} from 'react-native';
import {useIsFocused} from '@react-navigation/native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {ENTRANCE} from '../theme/motion';
import {MOTION_ENABLED} from '../utils/disableMotion';

/** 与 Entrance 同款「地板透明度」：进度 0 时也有 0.68，绝不整页全透。 */
const OPACITY_FLOOR = 0.68;
/** 起始下移距离，与 Entrance 默认 offset 一致。 */
const ENTER_OFFSET = 10;

interface Props {
  children: React.ReactNode;
}

/**
 * Drawer 场景入场动画（淡入 + 轻微上浮）。
 *
 * 背景：主界面 Tab 切换、二级页进出都有转场（transitionContent /
 * Entrance），但 Drawer 的各路由（设置 / 关于 / 基准测试 / 下载管理 /
 * 视觉模型 / Pals…）之间切换时 Drawer 导航器不提供任何转场 ——
 * 旧页瞬间消失、新页瞬间出现，就是「有的页面没有动画」的来源。
 *
 * 做法：每个 Drawer 场景包一层「聚焦即入场」的壳 —— useIsFocused 变 true
 * 时重播一次 260ms 的淡入上浮。Drawer 的非焦点页只是隐藏不卸载
 * （MaybeScreen visible），所以每次回到该页都会重播，和 Tab 的
 * Entrance 重播是同一节奏。
 *
 * 细节：
 *   · reanimated sharedValue（UI 线程），与 Entrance 同一套实现；
 *     单节点成本可忽略，低端机无需再降级。
 *   · 透明度地板 0.68：场景内有 screenLayout 注入的壁纸层，
 *     淡入期间壁纸始终可见，不会露底色、不会白闪。
 *   · 全局关动画（MOTION_ENABLED=false）时直接渲染 children，
 *     不建动画节点（与 Entrance 的关闭分支同语义）。
 */
export const SceneEnterShell: React.FC<Props> = ({children}) => {
  const isFocused = useIsFocused();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!isFocused) {
      // 非焦点场景（隐藏中）：停在完成态，等聚焦再播
      progress.value = 1;
      return;
    }
    // 归零再播：首次挂载、从其他路由返回都完整播一遍
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: ENTRANCE.duration,
      // 对齐 Entrance 的 EmphasizedDecelerate
      easing: Easing.bezier(0.05, 0.7, 0.1, 1),
    });
  }, [isFocused, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [OPACITY_FLOOR, 1]),
    transform: [
      {translateY: interpolate(progress.value, [0, 1], [ENTER_OFFSET, 0])},
    ],
  }));

  if (!MOTION_ENABLED) {
    return <>{children}</>;
  }

  return (
    <Animated.View style={[styles.fill, animatedStyle]}>
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fill: {flex: 1},
});
