import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  Image,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {observer} from 'mobx-react';

import {uiStore} from '../store';
import {useTheme} from '../hooks';
import {MOTION_ENABLED, motionTiming} from '../utils/disableMotion';

/**
 * 通用「光效」容器。
 *
 * 包住任意模块（卡片 / 分组 / 二级页的卡），给它两样东西：
 *   1. 流动高光带 —— 每隔一段时间，从左上角斜着扫到右下角
 *   2. 点击散光  —— 手指按下时，从触点向外散开一片白光
 *
 * 受设置里「光效」开关控制；关掉时这个组件只做一层普通包装，
 * 不渲染任何光效、也不注册任何触摸监听。
 *
 * 用法：
 *   <SheenSurface radius={cardRadius()} style={styles.card}>
 *     ...原来的内容...
 *   </SheenSurface>
 *
 * radius 一定要和里面模块的圆角一致，否则光带会从方角露出去。
 */
interface Props {
  /** 内部模块的圆角（dp），必须和它一致 */
  radius?: number;
  /** 扫过一次之后停多久（ms） */
  interval?: number;
  /** 单次扫过的时长（ms） */
  duration?: number;
  /** 是否响应点击散光 */
  touchLight?: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

const BAND_RATIO = 0.38; // 光带宽度占模块宽度的比例

/**
 * #RRGGBB -> rgba()。
 * 光带为什么会带颜色：App 的页面底色是 #FAF9FF（几乎纯白），
 * 纯白的光带扫过去像素值一点不变，等于没有 —— 实测过是 0 像素差异。
 * 所以高光取「关键色」的淡色版，在任何底色上都能看出来。
 */

export const SheenSurface: React.FC<Props> = observer(
  ({
    radius = 18,
    interval = 4200,
    duration = 2000,
    touchLight = true,
    style,
    children,
  }) => {
    const theme = useTheme();
    // 光效带由「设置 → 光效」开关控制（uiStore.sheenEffect）
    const enabled = uiStore.sheenEffect;

    const [box, setBox] = useState({w: 0, h: 0});
    const originX = useRef(0);
    const wrapRef = useRef<View>(null);

    const sheen = useRef(new Animated.Value(0)).current;
    const glow = useRef(new Animated.Value(0)).current;
    const seq = useRef(0);
    const [lights, setLights] = useState<{id: number; x: number; y: number}[]>(
      [],
    );

    // ── 流动高光带：0 -> 1 走一趟，然后停 interval 再重来 ──
    useEffect(() => {
      if (!enabled || box.w <= 0) {
        return;
      }
      // 动画全关：不启动循环。
      // ⚠️ 尤其重要：关掉动画后每个分段只剩 1ms，Animated.loop 会变成
      // 「每帧跑一次空动画」的无限空转，白烧 CPU/掉帧。
      if (!MOTION_ENABLED) {
        sheen.setValue(0);
        return;
      }
      const loop = Animated.loop(
        Animated.sequence([
          // ⚠️ 去掉 easing：RN 0.82 新架构下 Animated.timing 同时带
          // easing + useNativeDriver:true 会报
          //   "Interpolation property 'easing' is not supported by
          //    native animated module"
          // sheen 的插值结果直接挂在原生节点的 transform/opacity 上，
          // 必须走纯线性。
          //
          // 用分段线性还原 inOut(cubic)：前 45% 时间走 80% 距离（加速），
          // 后 55% 走剩下 20%（减速）。总时长不变，速度曲线肉眼几乎无差。
          motionTiming(sheen, {
            toValue: 0.8,
            duration: Math.round(duration * 0.45),
            useNativeDriver: true,
          }),
          motionTiming(sheen, {
            toValue: 1,
            duration: Math.round(duration * 0.55),
            useNativeDriver: true,
          }),
          Animated.delay(interval),
          motionTiming(sheen, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }, [enabled, box.w, sheen, duration, interval]);

    // ── 点击散光 ──
    const spawn = (pageX?: number, pageY?: number) => {
      if (!enabled || !touchLight) {
        return;
      }
      seq.current += 1;
      const id = seq.current;
      const x = typeof pageX === 'number' ? pageX - originX.current : box.w / 2;
      const y = typeof pageY === 'number' ? pageY : box.h / 2;
      setLights(prev => [...prev.slice(-2), {id, x, y}]);
      // 触发一次光斑动画
      glow.setValue(0);
      motionTiming(glow, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        // 必须 false：上面刚 setValue 过，和原生驱动混用会抛
        // "has been moved to native"，动画不执行、光斑直接不亮。
        useNativeDriver: false,
      }).start();
    };

    const removeLight = (id: number) =>
      setLights(prev => prev.filter(l => l.id !== id));

    const onLayout = (e: LayoutChangeEvent) => {
      const {width, height} = e.nativeEvent.layout;
      setBox({w: width, h: height});
      wrapRef.current?.measureInWindow(x => {
        originX.current = x;
      });
    };

    if (!enabled) {
      return <View style={style}>{children}</View>;
    }

    const bandW = Math.max(48, box.w * BAND_RATIO);
    // 走向：从「右上角」斜扫到「左下角」
    //   · translateX 由 正 变 负（右 -> 左）
    //   · translateY 由 负 变 正（上 -> 下）
    //   两者同时进行，所以是斜向移动，不是横着扫
    const translateX = sheen.interpolate({
      inputRange: [0, 1],
      outputRange: [box.w + bandW, -bandW],
    });
    const translateY = sheen.interpolate({
      inputRange: [0, 1],
      outputRange: [-box.h * 0.9, box.h * 0.9],
    });

    const lightR = Math.max(box.w, box.h) * 0.9;
    const lightOpacity = glow.interpolate({
      inputRange: [0, 0.1, 0.55, 1],
      outputRange: [0, 1, 0.45, 0],
    });
    const lightScale = glow.interpolate({
      inputRange: [0, 1],
      outputRange: [0.12, 1],
    });

    return (
      <View
        ref={wrapRef}
        onLayout={onLayout}
        // 捕获阶段只「看一眼」触点，返回 false 所以不抢 responder，
        // 里面的按钮照常能点
        onStartShouldSetResponderCapture={e => {
          const ne: any = e?.nativeEvent;
          const px = ne?.pageX ?? ne?.touches?.[0]?.pageX;
          const py = ne?.pageY ?? ne?.touches?.[0]?.pageY;
          spawn(px, py);
          return false;
        }}
        style={[style, {borderRadius: radius, overflow: 'hidden'}]}>
        {children}

        {/* 流动高光带 */}
        {box.w > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.band,
              {
                width: bandW,
                transform: [
                  {translateX},
                  {translateY},
                  // 正角度 = 顶边向右偏 = 光带「左上高、右下低」
                  //（和扫动方向一致：从右上角进来、往左下角出去）
                  {skewX: '45deg'},
                ],
              },
            ]}>
            <LinearGradient
              colors={
                theme.dark
                  ? [
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.06)',
                      'rgba(255,255,255,0.2)',
                      'rgba(255,255,255,0.06)',
                      'rgba(255,255,255,0)',
                    ]
                  : [
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.3)',
                      'rgba(255,255,255,0.85)',
                      'rgba(255,255,255,0.3)',
                      'rgba(255,255,255,0)',
                    ]
              }
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}

        {/* 点击散光 */}
        {lights.map(l => (
          <Animated.View
            key={l.id}
            pointerEvents="none"
            onLayout={() => {
              // 动画走完就清掉，避免越堆越多
              setTimeout(() => removeLight(l.id), 820);
            }}
            style={[
              styles.lightWrap,
              {
                left: l.x - lightR,
                top: l.y - lightR,
                width: lightR * 2,
                height: lightR * 2,
                opacity: lightOpacity,
                transform: [{scale: lightScale}],
              },
            ]}>
            <Image
              source={require('../assets/effects/touchGlow.png')}
              style={[styles.glow, {opacity: theme.dark ? 0.34 : 0.7}]}
              resizeMode="cover"
            />
          </Animated.View>
        ))}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  // 45° 斜切后，光带上下会「歪」出很远，留够高度才不会在卡片角上露缺口
  band: {
    position: 'absolute',
    top: -200,
    bottom: -200,
  },
  lightWrap: {
    position: 'absolute',
  },
  glow: {
    width: '100%',
    height: '100%',
  },
});
