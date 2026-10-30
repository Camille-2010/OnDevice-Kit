import React, {useRef} from 'react';
import {
  Animated,
  BackHandler,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';

import {EASE, SHEET} from '../theme/motion';
import {motionTiming} from '../utils/disableMotion';

/**
 * 带动画 + 返回键拦截的底部弹窗。
 *
 * 为什么要自己写而不用 RN 的 <Modal animationType="slide">：
 *   1. Android 上 transparent + animationType="slide" 的动画质量很差
 *      （几乎看不见、还会闪），用户实测「弹窗没有动画」。
 *   2. RN 的 Modal 在 Android 上默认不拦硬件返回键，返回事件会冒泡到
 *      App 的 BackHandler —— 「弹窗开着按返回，直接回主页」。
 *
 * 这里自己控制：
 *   · 遮罩淡入淡出（opacity，原生驱动）
 *   · 面板从底部滑入 / 滑出（translateY，原生驱动）
 *   · 进场播完才挂载内容，退场播完再卸载（避免生硬）
 *   · 自动接管返回键：按返回只关这个弹窗
 *
 * 用法：
 *   <AnimatedSheet
 *     visible={show}
 *     onClose={() => setShow(false)}>
 *     {内容}
 *   </AnimatedSheet>
 */

export interface AnimatedSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 面板样式 */
  sheetStyle?: ViewStyle | ViewStyle[];
  /**
   * 遮罩颜色，默认半透明黑。
   * 0.45 太重 —— 弹窗一开整页死暗（用户反馈「整个页面都变暗了」）；
   * 0.25 保留「模态」的聚焦感，又不再压黑背后内容。
   */
  backdropColor?: string;
  /** 点遮罩是否关闭，默认 true */
  dismissOnBackdropPress?: boolean;
  /**
   * 页面内渲染（不用 RN Modal）。
   *
   * ⚠️ 为什么需要：原生液态玻璃（AGSL）的 capture root 是「最近的
   * rnscreens Screen / ReactRootView」。RN 的 Modal 在 Android 上是
   * **独立窗口 + 独立 ReactRootView**，玻璃只能采到 Modal 窗口里的
   * 东西（遮罩+面板），采不到页面壁纸 → 弹窗内所有玻璃卡退化成
   * 「本地采样」，观感发白、没有折射（用户截图反馈的问题）。
   * inPage 模式把弹窗降为页面内的绝对定位覆盖层，capture root 就是
   * 页面 Screen，玻璃正常采样壁纸。
   *
   * 前提：调用方父容器是全屏 flex:1（覆盖层要铺满整页）。
   * 返回键拦截两种模式下都由组件内的 BackHandler 处理，不受影响。
   */
  inPage?: boolean;
  /**
   * 覆盖进入时长（ms）。默认走 BAVoice 的 iosSheet：Slow(520)。
   * 退出固定用 Standard(320)，不跟这个值。
   */
  duration?: number;
  testID?: string;
}

export const AnimatedSheet: React.FC<AnimatedSheetProps> = ({
  visible,
  onClose,
  children,
  sheetStyle,
  backdropColor = 'rgba(0,0,0,0.25)',
  dismissOnBackdropPress = true,
  inPage = false,
  duration = SHEET.enter,
  testID,
}) => {
  // 0 = 完全关闭，1 = 完全打开。用插值同时驱动遮罩和面板
  const progress = useRef(new Animated.Value(0)).current;
  // 挂载开关：退场动画播完才卸载，否则内容会瞬间消失
  const [mounted, setMounted] = React.useState(visible);

  React.useEffect(() => {
    if (visible) {
      setMounted(true);
    }
    // 缓动/时长对齐 BAVoice 的 iosSheet：
    //   进入 Slow(520) + IosSheet(0.32, 0.72, 0, 1) —— 起步极快、尾巴很长
    //   退出 Standard(320) + EmphasizedAccelerate
    // 原来进出都用 out(cubic)，弹性感差很多。
    motionTiming(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? duration : SHEET.exit,
      easing: visible ? EASE.iosSheet : EASE.emphasizedAccelerate,
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
  }, [visible, progress, duration]);

  // 硬件返回键：只关这个弹窗
  React.useEffect(() => {
    if (Platform.OS !== 'android' || !visible) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // 键盘避让：manifest 是 adjustResize，但 inPage 覆盖层是页面内的
  // 绝对定位节点，Android 上窗口 resize 推不动它（RN 常见坑）——
  // 键盘弹出后面板纹丝不动，直接把下半部分（含输入框）盖住
  // （用户反馈：图像生成页输种子时「输入栏把输入框覆盖掉」）。
  // 手动监听键盘，给面板加 marginBottom 顶到键盘上方。
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  React.useEffect(() => {
    // 防御性可选链：jest 环境里 Keyboard.addListener 可能返回 undefined
    const showSub = Keyboard.addListener('keyboardDidShow', e => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub?.remove();
      hideSub?.remove();
    };
  }, []);

  if (!mounted) {
    return null;
  }

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  const backdrop = (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {backgroundColor: backdropColor, opacity: progress},
      ]}>
      {dismissOnBackdropPress && (
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
      )}
    </Animated.View>
  );

  const panel = (
    <Animated.View
      style={[
        styles.sheet,
        {transform: [{translateY}]},
        sheetStyle,
        // 键盘弹出时把面板顶到键盘上方（marginBottom 推开）
        keyboardHeight > 0 ? {marginBottom: keyboardHeight} : null,
      ]}>
      <View style={styles.handle} />
      {children}
    </Animated.View>
  );

  // 页面内模式：覆盖层挂在调用方根容器上（不新开窗口），
  // 玻璃的 capture root 是页面 Screen，能采到壁纸
  if (inPage) {
    return (
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        testID={testID}>
        {backdrop}
        {panel}
      </View>
    );
  }

  return (
    <Modal
      transparent
      visible={mounted}
      onRequestClose={onClose}
      testID={testID}>
      {backdrop}
      {panel}
    </Modal>
  );
};

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: 'rgba(150,150,150,0.5)',
  },
});
