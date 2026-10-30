import React, {useEffect, useRef, useState} from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {motionTiming} from '../utils/disableMotion';

/**
 * 顶栏 / 胶囊栏的「流动光带」。
 *
 * 从 App.tsx 抽出成共享组件：主页顶栏、二级页顶栏（SubPageHeader）和
 * SubHeader 都要用它，各自写一份必然走样（时长/斜率/渐变色对不上）。
 *
 * 受「设置 → 光效」开关控制的是外层（调用方按 uiStore.sheenEffect 决定
 * 要不要渲染本组件），这里只负责把光带画出来。
 */
export const GlassSheen: React.FC<{dark: boolean}> = ({dark}) => {
  const slide = useRef(new Animated.Value(0)).current;
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    if (barWidth <= 0) {
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        // ⚠️ 去掉 easing 的原因同 TouchLight：RN 0.82 新架构下
        // timing 带 easing + useNativeDriver:true 会报
        //   "Interpolation property 'easing' is not supported by native
        //    animated module"
        // 这里 slide 的插值结果（translateX）直接挂在原生节点上，
        // 所以必须走纯线性的原生动画。
        //
        // 用「快起慢停」的分段线性还原原来的 inOut(cubic)：
        // 前 45% 的时间走 80% 距离（加速），后 55% 走剩下 20%（减速）。
        // 总时长仍是 2600ms，光带的速度曲线肉眼几乎无差。
        motionTiming(slide, {
          toValue: 0.8,
          duration: 1170,
          useNativeDriver: true,
        }),
        motionTiming(slide, {
          toValue: 1,
          duration: 1430,
          useNativeDriver: true,
        }),
        // 扫完歇一下，避免变成「跑马灯」那种浮躁感
        Animated.delay(1600),
        motionTiming(slide, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [slide, barWidth]);

  const bandWidth = Math.max(64, barWidth * 0.32);
  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-bandWidth, barWidth],
  });

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
      {barWidth > 0 ? (
        <Animated.View
          style={[
            styles.band,
            {
              width: bandWidth,
              transform: [{translateX}, {skewX: '-18deg'}],
            },
          ]}>
          <LinearGradient
            colors={
              dark
                ? [
                    'rgba(255,255,255,0)',
                    'rgba(255,255,255,0.05)',
                    'rgba(255,255,255,0.16)',
                    'rgba(255,255,255,0.05)',
                    'rgba(255,255,255,0)',
                  ]
                : [
                    'rgba(255,255,255,0)',
                    'rgba(255,255,255,0.35)',
                    'rgba(255,255,255,0.85)',
                    'rgba(255,255,255,0.35)',
                    'rgba(255,255,255,0)',
                  ]
            }
            start={{x: 0, y: 0}}
            end={{x: 1, y: 0}}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // 上下多留 24，抵消 skew 后左右两端出现的空隙
  band: {
    position: 'absolute',
    top: -24,
    bottom: -24,
  },
});

export default GlassSheen;
