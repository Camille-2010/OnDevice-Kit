import {
  BottomSheetModal,
  BottomSheetModalProps,
  BottomSheetTextInput,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import React, {forwardRef, useEffect, useMemo, useRef} from 'react';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BottomSheetModalMethods} from '@gorhom/bottom-sheet/lib/typescript/types';
import {Text} from 'react-native-paper';
import {CloseIcon} from '../../assets/icons';
import {useTheme} from '../../hooks';
import {styles} from './styles';
import BottomSheetKeyboardAwareScrollView from './BottomSheetAwareScrollview';
import {
  BackHandler,
  Dimensions,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {CustomBackdrop} from './CustomBackdrop';
import {Actions} from './Actions';
import {SheetHandle} from './SheetHandle';
import {GlassSurface, hasNativeGlass} from '../GlassSurface';
import {dialogGlassTint} from '../../theme/cards';
import {uiStore} from '../../store';

export interface SheetProps extends Partial<BottomSheetModalProps> {
  children?: React.ReactNode;
  title?: string;
  isVisible?: boolean;
  onClose?: () => void;
  displayFullHeight?: boolean;
  showCloseButton?: boolean;
  /**
   * 液态玻璃外观（仅 liquid-glass 主题 + Android 13+ 生效，其余主题
   * 自动回落成普通白底弹窗）。玻璃面板盖在弹窗整个内容区背后，
   * 文字/输入框仍是原来的样子。
   */
  glass?: boolean;
}

interface SheetComponent
  extends React.ForwardRefExoticComponent<
    SheetProps & React.RefAttributes<BottomSheetModalMethods>
  > {
  ScrollView: typeof BottomSheetKeyboardAwareScrollView;
  View: typeof BottomSheetView;
  Actions: typeof Actions;
  TextInput: typeof BottomSheetTextInput;
}

export const Sheet = forwardRef(
  (
    {
      children,
      title,
      isVisible,
      displayFullHeight,
      onClose,
      showCloseButton = true,
      glass = false,
      ...props
    }: SheetProps,
    ref: React.Ref<BottomSheetModalMethods>,
  ) => {
    const insets = useSafeAreaInsets();
    const innerRef = useRef<BottomSheetModalMethods>(null);

    const activeRef = useMemo(() => {
      if (ref && 'current' in ref && ref.current) {
        return ref;
      }
      return innerRef;
    }, [ref, innerRef]);

    const theme = useTheme();
    // 液态玻璃模式：仅 liquid-glass 主题 + Android 13+（AGSL）生效，
    // 标准主题 / MIUIX / 老 Android 自动回落成原来的白底弹窗。
    const glassMode =
      glass && uiStore.themeStyle === 'liquid-glass' && hasNativeGlass();

    useEffect(() => {
      if (isVisible) {
        activeRef?.current?.present();
      } else {
        activeRef?.current?.close();
      }
    }, [isVisible, activeRef]);

    const onDismiss = () => {
      activeRef?.current?.close();
      onClose?.();
    };

    // 硬件返回键：只关这个 sheet，不让事件冒泡到导航栈。
    //
    // @gorhom/bottom-sheet 5.x 的 BottomSheetModal **不接管 Android 返回键**，
    // 不拦的话：语音面板开着按返回/侧滑返回 —— sheet 不动，底下的
    // 页面被 pop 掉直接回主页（2026-10-20 用户反馈）。
    useEffect(() => {
      if (Platform.OS !== 'android' || !isVisible) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // 只调 close()：dismiss 之后库会自己触发 onDismiss，
        // 那里统一执行 onClose，避免同一个回调被执行两次。
        activeRef?.current?.close();
        return true;
      });
      return () => sub.remove();
    }, [isVisible, activeRef]);

    const snapPoints = useMemo(() => {
      if (displayFullHeight) {
        return [Dimensions.get('screen').height - insets.top - 16];
      }
      return props.snapPoints;
    }, [displayFullHeight, insets, props.snapPoints]);

    return (
      <BottomSheetModal
        ref={activeRef}
        maxDynamicContentSize={
          Dimensions.get('screen').height - insets.top - 16
        }
        enableDynamicSizing={!snapPoints}
        stackBehavior="push"
        backdropComponent={CustomBackdrop}
        handleComponent={SheetHandle}
        keyboardBlurBehavior="restore"
        activeOffsetY={[-1, 1]}
        failOffsetX={[-5, 5]}
        backgroundStyle={
          glassMode
            ? {backgroundColor: 'transparent'}
            : {
                backgroundColor: theme.colors.background,
              }
        }
        snapPoints={snapPoints}
        onDismiss={onDismiss}
        // Disable accessible to allow Appium/e2e tests to access child elements on iOS
        // See: https://github.com/gorhom/react-native-bottom-sheet/issues/1141
        accessible={false}
        {...props}>
        {glassMode ? (
          <View style={styles.contentRoot}>
            {/* 玻璃面板垫在内容背后；pointerEvents 让滚动/点击穿透 */}
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <GlassSurface
                style={{flex: 1}}
                radii={{tl: 28, tr: 28, br: 0, bl: 0}}
                glassType="regular"
                // 弹窗底版：沉灰 tint + 模糊。0.34 让真实模糊层透出来，
                // 面板读作毛玻璃而不是死灰实底（0.45 偏灰暗，用户反馈「磨砂太暗」）；
                // 文字可读性由模糊层兜底。
                // forceFrosted：强制走磨砂路径，blur 才会真正生效（原生 AGSL
                // 路径下 blur 被忽略），且避开小米 HyperOS 覆盖层采样透明的坑。
                tint={dialogGlassTint(theme)}
                tintOpacity={0.34}
                blur
                blurAmount={50}
                blurRounds={6}
                forceFrosted
              />
            </View>
            <View style={styles.header}>
              {title && <Text variant="titleMedium">{title}</Text>}
              {showCloseButton && (
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onDismiss}
                  hitSlop={10}
                  testID="sheet-close-button"
                  accessibilityLabel="Close"
                  accessibilityRole="button">
                  <CloseIcon stroke={theme.colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            {children}
          </View>
        ) : (
          <>
            <View style={styles.header}>
              {title && <Text variant="titleMedium">{title}</Text>}
              {showCloseButton && (
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onDismiss}
                  hitSlop={10}
                  testID="sheet-close-button"
                  accessibilityLabel="Close"
                  accessibilityRole="button">
                  <CloseIcon stroke={theme.colors.primary} />
                </TouchableOpacity>
              )}
            </View>
            {children}
          </>
        )}
      </BottomSheetModal>
    );
  },
) as SheetComponent;

Sheet.displayName = 'Sheet';
Sheet.ScrollView = BottomSheetKeyboardAwareScrollView;
Sheet.View = BottomSheetView;
Sheet.Actions = Actions;
Sheet.TextInput = BottomSheetTextInput;
