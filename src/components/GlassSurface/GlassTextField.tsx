import React from 'react';
import {StyleProp, TextStyle, ViewStyle} from 'react-native';
import {TextInput, TextInputProps} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {SurfaceCard} from './GlassSurface';

/**
 * 玻璃文字框（输入框）。
 *
 * 与普通玻璃卡片的区别只有一处：**磨砂更重** ——
 *   · glassType="regular"（原生玻璃的「更磨砂」档，模糊半径更大）
 *   · tintOpacity 0.55（普通卡 0.40）—— 底色更实，壁纸花纹不会从字缝里透出来
 *
 * 文字是玻璃上信息密度最高的内容，糊得不够时背后的壁纸会和文字互相干扰，
 * 所以输入框单独用一档更重的参数，而不是跟卡片共用。
 *
 * ⚠️ cursorColor 必须显式给：玻璃模式下外层 SurfaceCard 会剥掉
 * TextInput 的默认背景，Paper 的光标色继承链断掉，不设就是透明/黑，
 * 用户看到的就是「能打字、找不到光标」。
 *
 * 非玻璃模式（MIUIX / 标准）：外层 SurfaceCard 原样渲染成「浅灰圆角填充区」，
 * TextInput 走 flat 无边框无下划线，观感接近 Material 的 filled text field，
 * 两种风格都不需要调用方写分支。
 *
 * ⚠️ 外层 `style` 是玻璃容器样式（圆角/内边距/外边距），
 *    输入文字本身的样式走 `inputStyle`。
 */
export const GlassTextField: React.FC<
  {
    style?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
    /** 原生玻璃类型：'regular' = 更磨砂（默认，已是输入框专用重磨砂档）。 */
    glassType?: 'clear' | 'regular';
    /**
     * 底色不透明度。默认 0.55（输入框本就比普通卡片更实）。
     * 调高 → 壁纸花纹更难从字缝里透出来，文字更清晰（视觉上「磨砂更强」）。
     */
    tintOpacity?: number;
    /**
     * 自定义玻璃色调。不传则用默认近白色（页面输入框用默认即可）；
     * 弹窗内（如添加助手 / 图像生成设置）传 dialogGlassTint 让输入框和面板
     * 同色系，避免输入框比面板更白、显得刺眼。
     */
    tint?: string;
    /**
     * 真实模糊（磨砂路径才生效；原生玻璃路径下 blur 被忽略）。
     * 用于「要求更糊」的输入框——背景被真正抹开，而不是只靠半透明底色。
     */
    blur?: boolean;
    blurAmount?: number;
    blurRounds?: number;
    /**
     * 强制走磨砂路径。**嵌在玻璃卡片里的输入框必须开**：原生
     * LiquidGlassView 在部分 ROM 的覆盖层里采样不到背景，会渲染成透明；
     * 磨砂路径不依赖抓屏，任何 ROM 都稳定，且 blur 才会真正生效。
     */
    forceFrosted?: boolean;
  } & Omit<TextInputProps, 'style' | 'mode'>
> = ({
  style,
  inputStyle,
  glassType = 'regular',
  tintOpacity = 0.55,
  tint,
  blur,
  blurAmount,
  blurRounds,
  forceFrosted,
  ...rest
}) => {
  const theme = useTheme();
  return (
    <SurfaceCard
      style={style}
      glassType={glassType}
      tintOpacity={tintOpacity}
      tint={tint}
      blur={blur}
      blurAmount={blurAmount}
      blurRounds={blurRounds}
      forceFrosted={forceFrosted}>
      <TextInput
        mode="flat"
        underlineColor="transparent"
        activeUnderlineColor="transparent"
        cursorColor={theme.colors.primary}
        selectionColor={theme.colors.primary}
        style={[{backgroundColor: 'transparent'}, inputStyle]}
        {...rest}
      />
    </SurfaceCard>
  );
};
