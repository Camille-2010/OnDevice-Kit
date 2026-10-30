import React from 'react';
import {
  Dimensions,
  Image,
  ImageStyle,
  PixelRatio,
  StyleProp,
} from 'react-native';

import {ICON3D, Icon3DName} from '../assets/icons3d';

/**
 * 3D 图标尺寸按屏宽缩放。
 *
 * 调用方仍然传「按 360dp 设计出来的值」（如 66/ 40 / 36 / 34），
 * 这里统一折算到当前屏宽，避免在 411dp 宽的机器上图标显得偏小、
 * 和周围文字对不上（之前就是这个毛病）。
 *
 * 上限 1.15倍，防止宽屏/平板上被放得过大。
 */
const BASE_WIDTH = 360;
/** 图标源文件边长（icons3d 全是 256×256） */
const SOURCE_PX = 256;

const scaleForScreen = (designDp: number): number => {
  const {width, height} = Dimensions.get('window');
  const w = Math.min(width, height);
  return Math.min(designDp * (w / BASE_WIDTH), designDp * 1.15);
};

// 统一使用用户提供的 3D 图标：正方形贴图，不额外加色块底
interface Props {
  name: Icon3DName;
  /** 按 360dp 基准设计的尺寸，内部会按屏宽折算 */
  size?: number;
  /** 传true 则不做缩放，用于已经自己算好尺寸的场景 */
  fixed?: boolean;
  style?: StyleProp<ImageStyle>;
}

export const Icon3D: React.FC<Props> = ({
  name,
  size = 34,
  fixed = false,
  style,
}) => {
  const raw = fixed ? size : scaleForScreen(size);
  /**
   * 关键：**取整 + 不允许把源图放大**。
   *
   * 1. 取整：分数 dp 在设备上会落到半像素，RN 的缩放会产生重采样模糊
   *    （用户反馈「图标模糊不清」）。
   * 2. 不放大：源图只有 256px。高 DPI 机器（如小米 560dpi≈3.5x）上
   *    66dp 实际要 ~231px，再乘 1.15 上限就超过 256px —— 源图被拉伸，
   *    必糊。这里把渲染尺寸钳在「源图像素 / 像素密度」以内，宁可小
   *    1~2dp 也不放大，保证任何密度下都清晰。
   */
  const maxDp = SOURCE_PX / PixelRatio.get();
  const px = Math.max(1, Math.min(Math.round(raw), Math.floor(maxDp)));
  return (
    <Image
      source={ICON3D[name]}
      style={[{width: px, height: px}, style]}
      resizeMode="contain"
    />
  );
};
