import React from 'react';
import {StyleSheet, ViewStyle} from 'react-native';

import {useTheme} from '../hooks';
import {GlassSurface} from './GlassSurface';

/**
 * 胶囊标签：在「没有卡片底、直接浮在壁纸上的小字」背后垫一层**液态玻璃**胶囊，
 * 让浮空小字（小节标题、标签等）在花哨壁纸上也能看清，不抢内容。
 *
 * 和页面大卡片一样走真·液态玻璃（AGSL / 磨砂降级），不透明度比大卡片
 * （wallpaper 模式 ~0.26）「稍微高一点点」，所以看起来是更实一点的小胶囊。
 * 玻璃会自动按系统版本降级（Android 13+ 原生玻璃，以下磨砂），无需调用方关心。
 */
interface Props {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** 档位：soft 默认（略实于卡片）；strong 更实一点（如激活态标签） */
  opacity?: 'soft' | 'strong';
  /** 背后是什么：默认壁纸（页面都铺了壁纸） */
  backdrop?: 'wallpaper' | 'solid';
  /** 圆角；默认 16（大胶囊）。小 chip 传 ~12 即满圆角 */
  radius?: number;
  /**
   * 玻璃色调（十六进制），如 '#10B981' 绿 / '#3B82F6' 蓝。
   * 不传则默认中性灰。用于按类别上色的类型胶囊（图像=绿、文本=蓝…）。
   */
  tint?: string;
  /** 边缘高光描边宽度（玻璃叠玻璃时加大以区分层级） */
  rimWidth?: number;
  /**
   * 自定义色调浓度（0~1），覆盖 opacity 档位（soft 0.40 / strong 0.52）。
   * 用于低浓度色胶囊（如红色警告 0.12）。
   */
  tintOpacity?: number;
}

export const PillLabel: React.FC<Props> = ({
  children,
  style,
  opacity = 'soft',
  backdrop = 'wallpaper',
  radius = 16,
  rimWidth,
  tintOpacity: tintOpacityProp,
  tint,
}) => {
  const theme = useTheme();
  // 大卡片 wallpaper 模式 alpha=0.26；这里 0.40 / 0.52 稍微高一点点。
  const tintOpacity = tintOpacityProp ?? (opacity === 'strong' ? 0.52 : 0.4);
  const border = theme.dark ? 'rgba(255,255,255,0.12)' : 'rgba(11,12,17,0.10)';
  return (
    <GlassSurface
      style={[styles.pill, {borderColor: border}, style]}
      radius={radius}
      backdrop={backdrop}
      tint={tint}
      tintOpacity={tintOpacity}
      rimWidth={rimWidth}>
      {children}
    </GlassSurface>
  );
};

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    // 极细描边增强胶囊轮廓（不透明度很低，不影响通透感）
    borderWidth: StyleSheet.hairlineWidth,
  },
});
