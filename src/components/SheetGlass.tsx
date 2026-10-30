import React, {type ReactNode} from 'react';
import {type ViewStyle} from 'react-native';

import {GlassSurface} from './GlassSurface';
import {uiStore} from '../store';
import {useTheme} from '../hooks';
import {dialogGlassTint} from '../theme/cards';

/**
 * 弹窗玻璃面板本体（AnimatedSheet inPage 模式专用）。
 *
 * 从 ImageGenScreen 的 SheetBody 抽出共享 —— AddAssistantSheet 等
 * 其他弹窗同样需要「玻璃面板 + 内部玻璃卡」的两层结构。
 *
 * 为什么要整块面板都是玻璃：内部卡片/胶囊是 GlassSurface，原生玻璃
 * 采样背后的画面；面板如果是死白实底，卡片采样到的就是白 → 显白、
 * 没有折射（用户截图反馈的问题）。
 *
 * 非玻璃模式（MIUIX / 标准）原样返回 children，面板实底由调用方的
 * sheetStyle 提供。
 */
const sheetGlassStyle: ViewStyle = {
  // 24：面板与内容之间多留一点呼吸，避免芯片/页脚按钮贴着面板边框
  paddingHorizontal: 24,
  paddingBottom: 24,
  // maxHeight 让内部 ScrollView（flexShrink:1）超高时滚动而不是撑破面板
  maxHeight: '100%',
  overflow: 'hidden',
};

export const SheetGlass: React.FC<{
  children: ReactNode;
  /** 覆盖色调不透明度（越大越实、背景干扰越少） */
  tintOpacity?: number;
  /** 覆盖色调 */
  tint?: string;
  /** 磨砂路径是否叠真实模糊 */
  blur?: boolean;
  blurAmount?: number;
  blurRounds?: number;
}> = ({
  children,
  // 0.34：真磨砂的关键是「模糊层要能透出来」。0.45 仍偏灰暗（用户反馈
  // 「磨砂太暗，提高一点透明度」），降到 0.34 让背后模糊层透出更多，
  // 面板更亮更通透；文字可读性由模糊层兜底。
  tintOpacity = 0.34,
  tint,
  // 弹窗默认开模糊，进一步压背景干扰（只对弹窗面板开，卡片不开）
  blur = true,
  blurAmount,
  blurRounds,
}) => {
  const theme = useTheme();
  if (uiStore.themeStyle !== 'liquid-glass') {
    return <>{children}</>;
  }
  return (
    <GlassSurface
      backdrop="solid"
      // regular = 更磨砂档（模糊半径更大），把背后页面内容糊掉、不再干扰文字
      glassType="regular"
      // 强制磨砂：原生 AGSL 玻璃在部分 ROM（小米 HyperOS）的 inPage 覆盖层里
      // 采样不到背景 → 面板全透明、内容叠在一起看不清。磨砂不依赖抓屏，稳定。
      forceFrosted
      // 弹窗专用沉灰 tint（dialogGlassTint）：原默认近白 #F1F2F7 会泛白。
      tint={tint ?? dialogGlassTint(theme)}
      tintOpacity={tintOpacity}
      // Android 13 以下的磨砂默认不带模糊；弹窗面板开 blur 才有真磨砂
      blur={blur}
      blurAmount={blurAmount}
      blurRounds={blurRounds}
      // 四角皆圆：面板不再贴屏幕底边（bottom:5%），像一块浮起的玻璃板
      radii={{tl: 20, tr: 20, br: 20, bl: 20}}
      // 1.4 的边：面板与内部玻璃卡之间层级可辨
      rimWidth={1.4}
      style={sheetGlassStyle}>
      {children}
    </GlassSurface>
  );
};
