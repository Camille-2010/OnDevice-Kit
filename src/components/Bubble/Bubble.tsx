import type {ReactNode} from 'react';
import React, {useContext} from 'react';
import {Animated} from 'react-native';

import {useTheme} from '../../hooks';
import {SurfaceCard} from '../GlassSurface';

import {styles} from './styles';

import {UserContext} from '../../utils';
import {MessageType} from '../../utils/types';

/**
 * 气泡外壳（液态玻璃由 SurfaceCard 统一处理）。
 *
 * 结构：Animated.View 只负责按压缩放的 transform，
 * SurfaceCard 包住内容 ——
 *   · 非玻璃风格 → 原样渲染成带 backgroundColor 的 View（零视觉变化）
 *   · 液态玻璃   → 换成玻璃，内容在玻璃**里面**（不会被拍进背景产生鬼影）
 *
 * ⚠️ 用户气泡是深青底 + 白字，不能套默认的浅色玻璃，
 *    所以单独传 teal 色调 + 0.72 不透明度，保证白字清楚。
 */

/** 用户气泡的深青色（与 styles.ts 的 BUBBLE_USER 保持一致） */
const USER_BUBBLE_TINT = '#1D6E75';
/** 低于 0.7 白字会看不清（磨砂加强后提到 0.82，压住花哨壁纸） */
const USER_BUBBLE_TINT_OPACITY = 0.82;
/**
 * 助手气泡的玻璃不透明度。
 * 0.40 在花哨壁纸上太淡（气泡和背景糊在一起），提到 0.66 玻璃感更实、字更清楚。
 */
const ASSISTANT_BUBBLE_TINT_OPACITY = 0.66;

export const Bubble = ({
  child,
  message,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  nextMessageInGroup,
  scale = new Animated.Value(1),
}: {
  child: ReactNode;
  message: MessageType.Any;
  nextMessageInGroup: boolean;
  scale?: Animated.Value;
}) => {
  const theme = useTheme();
  const user = useContext(UserContext);
  const currentUserIsAuthor = user?.id === message.author.id;

  const {contentContainer} = styles({
    currentUserIsAuthor,
    message,
    roundBorder: true,
    theme,
  });

  return (
    <Animated.View
      testID={currentUserIsAuthor ? 'user-message' : 'ai-message'}
      style={{transform: [{scale}]}}>
      <SurfaceCard
        style={contentContainer}
        tint={currentUserIsAuthor ? USER_BUBBLE_TINT : undefined}
        tintOpacity={
          currentUserIsAuthor
            ? USER_BUBBLE_TINT_OPACITY
            : ASSISTANT_BUBBLE_TINT_OPACITY
        }
        // 气泡上直接压文字，壁纸花哨时 clear 太透、字会糊 —— 用更磨砂的 regular
        glassType="regular">
        {child}
      </SurfaceCard>
    </Animated.View>
  );
};
