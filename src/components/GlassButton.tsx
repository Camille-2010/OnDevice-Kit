import React, {useRef} from 'react';
import {Animated, StyleSheet, ViewStyle} from 'react-native';
import {Button} from 'react-native-paper';
import {observer} from 'mobx-react';

import {uiStore} from '../store';
import {motionSpring} from '../utils/disableMotion';
import {PRESS_SCALE, SPRING_PRESS} from '../theme/motion';

type PaperButtonProps = React.ComponentProps<typeof Button>;

/**
 * 玻璃按钮：液态玻璃下按住放大一圈、松手回弹；其余主题原样渲染 Paper Button。
 * 缩放由 Paper Button 自己的 onPressIn/onPressOut 驱动（ripple / onPress /
 * loading / disabled 全部保留）。
 *
 * 两种布局处理，自动区分：
 *  · 整块按钮（无 flex）→ 外层只带 transform 的极简壳，按钮保留完整样式；
 *  · 并排 flex 按钮（flex / flexGrow / flexBasis）→ 把 flex 移到外层壳、按钮
 *    flexGrow:1 填满，否则等宽按钮会被外层壳挤小。
 * 外层壳**绝不额外加 flexGrow**（那会在滚动列里把按钮纵向撑满整屏）。
 */
export const GlassButton: React.FC<PaperButtonProps> = observer(props => {
  const {style, onPressIn, onPressOut, ...rest} = props;
  const glassOn = uiStore.themeStyle === 'liquid-glass';
  const press = useRef(new Animated.Value(0)).current;
  const animate = (to: number) => {
    if (!glassOn) {
      return;
    }
    motionSpring(press, {
      toValue: to,
      ...SPRING_PRESS,
      useNativeDriver: true,
    }).start();
  };
  const pressScale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, PRESS_SCALE],
  });
  const pressHandlers = {
    onPressIn: (e: any) => {
      animate(1);
      onPressIn?.(e);
    },
    onPressOut: (e: any) => {
      animate(0);
      onPressOut?.(e);
    },
  };

  if (!glassOn) {
    return <Button {...props} />;
  }

  const flat = (StyleSheet.flatten([style]) ?? {}) as ViewStyle;
  const isFlex =
    flat.flex !== undefined ||
    flat.flexGrow !== undefined ||
    flat.flexBasis !== undefined;

  // 整块按钮：极简壳（不动布局）
  if (!isFlex) {
    return (
      <Animated.View style={{transform: [{scale: pressScale}]}}>
        <Button {...rest} style={style} {...pressHandlers} />
      </Animated.View>
    );
  }

  // 并排 flex 按钮：布局移到外层壳，按钮填满
  const {
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    alignSelf,
    width,
    height,
    minWidth,
    minHeight,
    maxWidth,
    maxHeight,
    margin,
    marginTop,
    marginBottom,
    marginLeft,
    marginRight,
    marginHorizontal,
    marginVertical,
    position,
    top,
    bottom,
    left,
    right,
    zIndex,
    ...innerStyle
  } = flat;
  return (
    <Animated.View
      style={[
        {
          flex,
          flexGrow,
          flexShrink,
          flexBasis,
          alignSelf,
          width,
          height,
          minWidth,
          minHeight,
          maxWidth,
          maxHeight,
          margin,
          marginTop,
          marginBottom,
          marginLeft,
          marginRight,
          marginHorizontal,
          marginVertical,
          position,
          top,
          bottom,
          left,
          right,
          zIndex,
        },
        {transform: [{scale: pressScale}]},
      ]}>
      <Button
        {...rest}
        style={[innerStyle, {flexGrow: 1}]}
        {...pressHandlers}
      />
    </Animated.View>
  );
});

export default GlassButton;
