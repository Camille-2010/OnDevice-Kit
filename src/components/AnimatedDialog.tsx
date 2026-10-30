import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  BackHandler,
  Modal,
  Platform,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';

import {DURATION, EASE} from '../theme/motion';
import {motionTiming} from '../utils/disableMotion';

/**
 * 带动画的居中对话框。
 *
 * 对齐 BAVoice 的 **scaleFade** 转场
 * （Transitions.kt 里的 `scaleFade()`）：
 *
 *   进入：scale 0.92 → 1.0 + 淡入，Standard(320) + EmphasizedDecelerate
 *   退出：scale 1.0 → 0.96 + 淡出，Fast(220) + EmphasizedAccelerate
 *
 * 和 RN 自带 `<Modal animationType="fade">` 的区别：
 *   · RN 的 fade 只有透明度，没有「浮出来」的层次感，时长也由平台决定；
 *   · 这里把缩放和淡入捆在一起，观感和 BAVoice 的对话框一致。
 *
 * 生命周期：退场动画播完才卸载内容（`mounted`），否则会「啪」地消失。
 * 返回键：Android 上只关这个对话框，不让事件冒泡到 App 级 BackHandler。
 *
 * 用法：
 *   <AnimatedDialog
 *     visible={show}
 *     onClose={() => setShow(false)}
 *     overlayStyle={styles.modalOverlay}
 *     cardStyle={styles.modalCard}>
 *     ...卡片内容...
 *   </AnimatedDialog>
 */

export interface AnimatedDialogProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 遮罩层样式（含底色、居中、padding） */
  overlayStyle?: StyleProp<ViewStyle>;
  /** 卡片样式（圆角、背景、内边距） */
  cardStyle?: StyleProp<ViewStyle>;
  /** 点遮罩是否关闭，默认 true */
  dismissOnBackdropPress?: boolean;
  testID?: string;
}

/** 进入时的起始缩放（BAVoice scaleFade 的 initialScale） */
const ENTER_SCALE = 0.92;

export const AnimatedDialog: React.FC<AnimatedDialogProps> = ({
  visible,
  onClose,
  children,
  overlayStyle,
  cardStyle,
  dismissOnBackdropPress = true,
  testID,
}) => {
  // 0 = 完全隐藏，1 = 完全显示
  const progress = useRef(new Animated.Value(0)).current;
  // 退场动画播完才卸载
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
    motionTiming(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? DURATION.standard : DURATION.fast,
      easing: visible ? EASE.emphasizedDecelerate : EASE.emphasizedAccelerate,
      useNativeDriver: true,
    }).start(({finished}) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
  }, [visible, progress]);

  // Android 返回键：只关这个对话框
  useEffect(() => {
    if (Platform.OS !== 'android' || !visible) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!mounted) {
    return null;
  }

  // 遮罩透明度：整组（遮罩 + 卡片）一起淡入淡出。
  //
  // ⚠️ 卡片**不能**再叠一层 opacity。遮罩是卡片的父级，父级 opacity 已经
  // 作用到子树上；再给卡片一个 opacity = progress，两者相乘就是 progress²，
  // 卡片前半程会比遮罩暗一大截，看起来「先暗后亮」，不像一个整体。
  // 所以：淡入交给遮罩层，卡片只负责缩放。
  const overlayOpacity = progress;

  // 卡片缩放：0.92 → 1。
  // 退场时 progress 反向回到 0，缩放自然回到 0.92；
  // BAVoice 的 exit 端点是 0.96，两者在 220ms 内肉眼无差，
  // 用单条插值能保证中途反向（手势/快速开关）时不会跳变。
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [ENTER_SCALE, 1],
  });

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={onClose}
      testID={testID}>
      <Animated.View style={[overlayStyle, {opacity: overlayOpacity}]}>
        {dismissOnBackdropPress && (
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="关闭对话框"
          />
        )}
        <Animated.View style={[cardStyle, {transform: [{scale}]}]}>
          {children}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};
