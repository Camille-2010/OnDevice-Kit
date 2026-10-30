import React from 'react';
import {ViewStyle} from 'react-native';

import {SurfaceCard} from './GlassSurface';
import {PressFeedback} from './PressFeedback';

/**
 * 圆形图标按钮的玻璃外壳：外层 SurfaceCard 提供液态玻璃质感（真玻璃 /
 * 磨砂自动降级），内层 PressFeedback 负责按压缩放 + 高光，图标居中铺满。
 *
 * 玻璃模式下 SurfaceCard 会剥掉 glassStyle 里的 backgroundColor（玻璃自带
 * 色调），只留尺寸与圆角；非玻璃模式则原样渲染（浅灰圆底回退）。
 *
 * ⚠️ glassStyle 的 borderRadius 必须是**尺寸的一半**（36→18、32→16、40→20），
 * 绝不能写 999 —— 原生 LiquidGlassView 会把圆角再乘一次屏幕密度
 * （ReactNativeLiquidGlassView.updateCornerRadius 的 convertDpToPx），
 * 560dpi 机器上 999×3.5 远超半高，四角巨弧重叠会渲染成椭圆。
 */
interface Props {
  testID?: string;
  onPress?: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  /** 关掉按压动画（如「推荐模型」分组：只浏览不操作） */
  flatPress?: boolean;
  /** 调用方传入：带尺寸 + 主题回退底色的圆形样式 */
  glassStyle: ViewStyle;
}

export const GlassIconButton: React.FC<Props> = ({
  testID,
  onPress,
  accessibilityLabel,
  children,
  flatPress,
  glassStyle,
}) => (
  <SurfaceCard style={glassStyle} backdrop="wallpaper">
    <PressFeedback
      testID={testID}
      onPress={onPress}
      scaleTo={flatPress ? 1 : 0.88}
      glowOpacity={flatPress ? 0 : 0.12}
      style={ICON_HIT}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      {children}
    </PressFeedback>
  </SurfaceCard>
);

const ICON_HIT: ViewStyle = {
  width: '100%',
  height: '100%',
  alignItems: 'center',
  justifyContent: 'center',
};
