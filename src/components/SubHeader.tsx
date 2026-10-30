import React, {type ReactNode} from 'react';
import {
  View,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import {Text} from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {BackButton} from './BackButton';
import {useTheme} from '../hooks';
import {
  HEADER_EXTRA,
  HEADER_HEIGHT,
  HEADER_ICON_SIZE,
  HEADER_TITLE_SIZE,
  HEADER_TITLE_WEIGHT,
  headerBg,
  headerBottomRadius,
  headerTranslucent,
} from '../theme/cards';
import {SurfaceCard} from './GlassSurface';
import {GlassSheen} from './GlassSheen';
import {uiStore} from '../store';

export interface SubHeaderProps {
  title: string;
  /** 返回回调；不传就不渲染返回键 */
  onBack?: () => void;
  /** 标题右侧的额外内容（图标按钮、chips 等） */
  right?: ReactNode;
  /** 标题下方的一行说明文字 */
  subtitle?: string;
  /** 是否在底部画一条分隔线。默认 false —— 二级页通常靠间距分层 */
  divider?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * 二级页面统一顶栏。
 *
 * 与主屏幕顶部栏（App.tsx 的 headerFor）和二级页内联 SubPageHeader
 * **完全同构**：同一个 SurfaceCard、同一套几何（高度 / 内边距 / 下圆角 /
 * 下间距）、同一个标题字号字重、同一段光效 —— 三者看起来是同一块顶栏，
 * 不会出现「二级页顶栏和主页不一样」。
 *
 * 液态玻璃风格下 SurfaceCard 自动渲染成真 AGSL 玻璃（其余风格自动回落成
 * 原来的实底，零视觉变化）。
 */
export const SubHeader: React.FC<SubHeaderProps> = ({
  title,
  onBack,
  right,
  subtitle,
  divider = false,
  style,
}) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const titleStyle: TextStyle = {
    color: theme.colors.onSurface,
    fontSize: HEADER_TITLE_SIZE,
    fontWeight: HEADER_TITLE_WEIGHT,
    letterSpacing: 0.2,
  };

  return (
    <SurfaceCard
      style={[
        styles.header,
        {
          backgroundColor: headerTranslucent(theme, headerBg(theme)),
          height: HEADER_HEIGHT + insets.top + HEADER_EXTRA,
          paddingTop: insets.top,
          paddingBottom: HEADER_EXTRA,
          borderBottomLeftRadius: headerBottomRadius(),
          borderBottomRightRadius: headerBottomRadius(),
          borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
          borderBottomColor: theme.colors.outlineVariant,
        },
        style,
      ]}>
      {uiStore.sheenEffect ? (
        <>
          <View pointerEvents="none" style={styles.highlight}>
            <LinearGradient
              colors={
                theme.dark
                  ? [
                      'rgba(248,250,252,0)',
                      'rgba(248,250,252,0.2)',
                      'rgba(248,250,252,0)',
                    ]
                  : [
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.45)',
                      'rgba(255,255,255,0)',
                    ]
              }
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <GlassSheen dark={theme.dark} />
        </>
      ) : null}
      {onBack ? (
        <BackButton onPress={onBack} iconSize={HEADER_ICON_SIZE} />
      ) : null}
      <View style={styles.titleWrap}>
        <Text style={titleStyle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[styles.subtitle, {color: theme.colors.onSurfaceVariant}]}
            numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </SurfaceCard>
  );
};

const styles = StyleSheet.create({
  // 与主页顶栏一致：横排、整条铺满、底边两角磨圆、底部留 10 间距
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    marginBottom: 10,
    overflow: 'hidden',
  },
  // 光效高光带容器（与主页顶栏同款，需被 overflow:hidden 裁住）
  highlight: {
    ...StyleSheet.absoluteFillObject,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 1,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});

export default SubHeader;
