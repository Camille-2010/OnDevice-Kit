import React, {useRef} from 'react';
import {motionSpring} from '../utils/disableMotion';
import {SPRING_PRESS} from '../theme/motion';
import {Animated, Pressable, StyleProp, ViewStyle} from 'react-native';

/**
 * 统一的按压反馈容器：按下时轻微缩小 + 一层高光抬起，松手回弹。
 *
 * 项目里其它页面用 activeOpacity 变暗，那是一种「消失感」；这里改成
 * 「按下去」的物理感——元素被手指压进去一点、同时表面被点亮，松手带
 * 一点点过冲回弹（spring），和主页宫格卡片的手感一致。
 *
 * useNativeDriver 跑 transform/opacity，低端机也不掉帧。
 */
interface Props {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** 按下时的缩放，默认 0.96；传 1 可关闭缩放只留高光 */
  scaleTo?: number;
  /** 高光层透明度，默认 0.14 */
  glowOpacity?: number;
  /** 高光颜色，默认跟随 accent */
  glowColor?: string;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'menuitem';
  hitSlop?: number;
}

export const PressFeedback: React.FC<Props> = ({
  children,
  onPress,
  onLongPress,
  disabled = false,
  style,
  scaleTo = 0.94,
  glowOpacity = 0.14,
  glowColor = '#3B82F6',
  testID,
  accessibilityLabel,
  accessibilityRole = 'button',
  hitSlop,
}) => {
  const press = useRef(new Animated.Value(0)).current;

  const animate = (toValue: number) => {
    if (scaleTo === 1 && glowOpacity === 0) {
      return;
    }
    motionSpring(press, {
      toValue,
      // 对齐 BAVoice 的 SPRING_PRESS（dampingRatio 0.6 / StiffnessHigh）：
      // 高刚度 → 压下去立刻到位；低阻尼 → 松手带回弹。
      // 原来用废弃的 friction/tension（RN 已不推荐，且换算出的手感偏软）。
      ...SPRING_PRESS,
      useNativeDriver: true,
    }).start();
  };

  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, scaleTo],
  });

  // 高光：按下时一层浅色蒙版从中间淡入。
  //
  // ⚠️ 这里**绝对不能**加 `easing`。
  // RN 0.82 新架构下，插值节点带 easing 且挂在原生驱动上会报
  //   "Interpolation property 'easing' is not supported by native
  //    animated module"
  // 而这层高光只在 0→0.14 的透明度区间里变化，线性已经足够柔和，
  // 加缓动肉眼分辨不出，却会污染整条日志。
  const glow = press.interpolate({
    inputRange: [0, 1],
    outputRange: [0, glowOpacity],
  });

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPressIn={() => animate(1)}
      onPressOut={() => animate(0)}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled}}
      style={style}>
      <Animated.View
        style={[
          {
            transform: [{scale}],
          },
          {flexShrink: 1},
        ]}>
        {children}
        {glowOpacity > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                borderRadius: 16,
                backgroundColor: glowColor,
                opacity: glow,
              },
            ]}
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
};
