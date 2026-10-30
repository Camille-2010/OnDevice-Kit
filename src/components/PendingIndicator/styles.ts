import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingTop: 6,
    // Extra paddingBottom keeps the dot-row from sitting flush against
    // the chat input — when the keyboard is closed, the FlatList's
    // header spacer collapses to height: 0 and the indicator is
    // otherwise the very last visible row above the input.
    paddingBottom: 16,
    paddingHorizontal: 12,
    gap: 4,
  },
  /**
   * 三个点外面套一层和 AI 消息一致的气泡：同样的 surfaceVariant 底色、
   * 同样的圆角半径、同样的水平内边距，视觉上就像 AI 正在「说」一句还没
   * 说完的话，而不是一串浮在背景上的孤零零的点。
   */
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
});

export const createCountStyle = (theme: Theme) =>
  StyleSheet.create({
    count: {
      marginLeft: 4,
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
      opacity: 0.75,
      // 工具名 + token 数 + 秒数可能很长，允许在气泡内收缩换行，
      // 避免把气泡撑出屏幕宽度。
      flexShrink: 1,
    },
  });
