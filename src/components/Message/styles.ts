import {StyleSheet} from 'react-native';

import {MessageType, Theme} from '../../utils/types';

// Inter-block gap within a single AssistantTurn row.
export const turnBlockStyles = StyleSheet.create({
  blockSpacer: {marginTop: 4},
});

// 聊天气泡配色（参照用户 2026-10-20 提供的截图取色）：
// 用户气泡深青色（深浅主题一致，白字）；助手气泡浅色卡片。
const BUBBLE_USER = '#1D6E75';
const BUBBLE_ASSISTANT_LIGHT = '#F4F4F5';
const BUBBLE_ASSISTANT_DARK = 'rgba(255,255,255,0.08)';

const styles = ({
  currentUserIsAuthor,
  message,
  messageWidth,
  theme,
}: {
  currentUserIsAuthor: boolean;
  message: MessageType.DerivedAny;
  messageWidth: number;
  roundBorder: boolean;
  theme: Theme;
}) =>
  StyleSheet.create({
    container: {
      alignItems: 'flex-end',
      alignSelf: currentUserIsAuthor ? 'flex-end' : 'flex-start',
      justifyContent: !currentUserIsAuthor ? 'flex-end' : 'flex-start',
      flex: 1,
      flexDirection: 'row',
      marginBottom: message.type === 'dateHeader' ? 0 : 4 + message.offset,
      marginLeft: 20,
    },
    contentContainer: {
      // 2026-10-20 用户指定参照「轻格 LocalAI」截图：
      // 用户气泡深青色、助手气泡浅灰卡片，四角统一圆角（去掉"尾巴"直角）。
      backgroundColor: currentUserIsAuthor
        ? BUBBLE_USER
        : theme.dark
          ? BUBBLE_ASSISTANT_DARK
          : BUBBLE_ASSISTANT_LIGHT,
      borderColor: 'transparent',
      borderRadius: theme.borders.messageBorderRadius,
      overflow: 'hidden',
    },
    dateHeader: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 32,
      marginTop: 16,
    },
    pressable: {
      maxWidth: messageWidth,
    },
  });

export default styles;
