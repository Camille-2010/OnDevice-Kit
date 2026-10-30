import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';
import Slider from '@react-native-community/slider';

import {useTheme} from '../hooks';

/**
 * 「粗轨道 + 原生拇指」滑块。
 *
 * 原生 `@react-native-community/slider` 的轨道粗细是固定的、无法通过 props 调
 * （只有 web 实现暴露 trackHeight，原生 Android/iOS 没有）。用户反馈「拉杆太细、
 * 想把横线加粗，但圆形按钮别变大」。
 *
 * 做法：把原生轨道的 min/max tint 都设成透明（轨道不可见，但拖动手势、step、
 * 无障碍、拇指位置全部保留），在它背后自绘一条更粗的圆角轨道 + 已填充部分。
 * 拇指仍是原生控件，大小完全不变。
 *
 * 对齐：原生 SeekBar 的拇指中心在 [thumbRadius, width - thumbRadius] 之间移动，
 * 所以自绘轨道左右各内缩 thumbRadius、填充宽度按该区间换算，跟拇指严丝合缝。
 */
type Props = {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (v: number) => void;
  onSlidingComplete?: (v: number) => void;
  style?: StyleProp<ViewStyle>;
  /** 轨道粗细（dp），默认 8 —— 比原生 ~4 明显更粗 */
  trackHeight?: number;
  /** 原生拇指半径估计值（用于轨道内缩对齐），默认 10 */
  thumbRadius?: number;
  /** 轨道高度（整个可点区域），默认 40 */
  height?: number;
};

export const ThickTrackSlider: React.FC<Props> = ({
  value,
  min,
  max,
  step,
  onValueChange,
  onSlidingComplete,
  style,
  trackHeight = 8,
  thumbRadius = 10,
  height = 40,
}) => {
  const theme = useTheme();
  const [width, setWidth] = React.useState(0);

  const ratio =
    max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const innerW = Math.max(0, width - thumbRadius * 2);
  const radius = trackHeight / 2;

  const trackBg = theme.dark ? 'rgba(255,255,255,0.18)' : 'rgba(11,12,17,0.12)';

  return (
    <View
      style={[styles.wrap, {height}, style]}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      {/* 轨道底（自绘，粗） */}
      <View
        pointerEvents="none"
        style={[
          styles.track,
          {
            left: thumbRadius,
            right: thumbRadius,
            height: trackHeight,
            borderRadius: radius,
            backgroundColor: trackBg,
          },
        ]}
      />
      {/* 已填充部分 */}
      <View
        pointerEvents="none"
        style={[
          styles.track,
          {
            left: thumbRadius,
            width: innerW * ratio,
            height: trackHeight,
            borderRadius: radius,
            backgroundColor: theme.colors.primary,
          },
        ]}
      />
      {/* 原生滑块：轨道透明（只留拇指与交互） */}
      <Slider
        style={{width: '100%', height}}
        value={value}
        minimumValue={min}
        maximumValue={max}
        step={step}
        onValueChange={onValueChange}
        onSlidingComplete={onSlidingComplete}
        minimumTrackTintColor="transparent"
        maximumTrackTintColor="transparent"
        thumbTintColor={theme.colors.primary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
  },
});

export default ThickTrackSlider;
