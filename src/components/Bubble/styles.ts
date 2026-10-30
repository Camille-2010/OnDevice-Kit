import {StyleSheet} from 'react-native';

import {MessageType, Theme} from '../../utils/types';

export const styles = ({
  currentUserIsAuthor,
  message,
  theme,
}: {
  currentUserIsAuthor: boolean;
  message: MessageType.Any;
  roundBorder: boolean;
  theme: Theme;
}) => {
  return StyleSheet.create({
    contentContainer: {
      backgroundColor:
        message.type === 'image'
          ? 'transparent' // 图片本身自带内容，不需要气泡底
          : currentUserIsAuthor
            ? theme.colors.authorBubbleBackground
            : theme.colors.surfaceVariant, // 2026-10-19：AI 回答也给气泡底
      // 只有 AI 气泡补内边距 —— user 气泡的文字自带 padding，
      // 一起加会让现有观感变化（用户气泡会凭空胖一圈）。
      paddingHorizontal:
        message.type === 'image' || currentUserIsAuthor ? 0 : 14,
      paddingVertical: message.type === 'image' || currentUserIsAuthor ? 0 : 10,
      // 2026-10-27：四角一律圆角（用户明确要求「角都变成圆的」）。
      // 之前按 roundBorder / 作者方向做过「贴边直角」处理，多行气泡看着偏方；
      // 现在统一四角同半径，视觉更圆润。
      borderTopLeftRadius: theme.borders.messageBorderRadius,
      borderTopRightRadius: theme.borders.messageBorderRadius,
      borderBottomLeftRadius: theme.borders.messageBorderRadius,
      borderBottomRightRadius: theme.borders.messageBorderRadius,
      borderColor: 'transparent',
      borderRadius: theme.borders.messageBorderRadius,
      overflow: 'hidden',
    },
    dateHeader0: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 32,
      marginTop: 16,
    },
    dateHeaderContainer: {
      textAlign: 'right',
      paddingBottom: 12,
      marginTop: -8,
      marginLeft: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dateHeader: {
      //textAlign: 'right',
      color: theme.colors.textSecondary,
      fontSize: 10,
    },
    iconContainer: {
      color: theme.colors.textSecondary,
      fontSize: 16,
    },
  });
};
