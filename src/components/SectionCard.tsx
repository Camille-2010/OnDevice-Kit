import React, {type ReactNode} from 'react';
import {View, StyleSheet, type StyleProp, type ViewStyle} from 'react-native';

import {useTheme} from '../hooks';
import {cardBg} from '../theme/cards';

export interface SectionCardProps {
  children: ReactNode;
  /** 卡片内边距，默认 14 */
  padding?: number;
  /** 圆角，默认跟随 theme.borders.default */
  radius?: number;
  /** 卡片背景，默认跟随主题；传 'transparent' 做纯分组容器 */
  background?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * 通用内容卡片。
 *
 * 2026-10-19 抽出：二级页面里的卡片圆角/内边距/背景各写各的
 * （有的 12 有的 16，有的用 surface 有的用 surfaceVariant），
 * 同一个页面里层级就分不清了。这里统一成一套 token。
 */
export const SectionCard: React.FC<SectionCardProps> = ({
  children,
  padding = 14,
  radius,
  background,
  style,
}) => {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: background ?? cardBg(theme),
          borderRadius: radius ?? theme.borders.default,
          padding,
        },
        style,
      ]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    // 卡片之间的统一间距；页面想更紧凑/更松散时用 style 覆盖 marginBottom
    marginBottom: 12,
  },
});

export default SectionCard;
