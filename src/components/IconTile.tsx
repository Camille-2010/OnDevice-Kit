import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppIcon, AppIconName} from './AppIcon';

// 全局统一图标：BAVoice 式「简单留白」。
// 默认只画线条图标本身，不加任何色块底；需要实心色块时显式传 filled。
interface Props {
  icon: AppIconName;
  color: string; // 线条颜色（主色）
  size?: number; // filled 模式的色块边长，默认 44
  iconSize?: number; // 图标大小，默认 22
  radius?: number; // filled 模式的圆角，默认正圆
  iconColor?: string; // 覆盖图标颜色
  filled?: boolean; // true = 实心色块 + 白色图标
}

export const IconTile: React.FC<Props> = ({
  icon,
  color,
  size = 44,
  iconSize = 22,
  radius,
  iconColor,
  filled = false,
}) => {
  if (!filled) {
    // 简单留白风格：只保留线条图标
    return <AppIcon name={icon} size={iconSize} color={iconColor ?? color} />;
  }

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius ?? size / 2,
          backgroundColor: color,
        },
      ]}>
      <AppIcon name={icon} size={iconSize} color={iconColor ?? '#FFFFFF'} />
    </View>
  );
};

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
