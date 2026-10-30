import React from 'react';
import {observer} from 'mobx-react';
import {Text, Portal} from 'react-native-paper';

import {Dialog, DialogAction} from '../Dialog';
import {L10nContext} from '../../utils';
import {ttsStore} from '../../store';

/**
 * 聊天链路的 TTS 播放失败弹窗。
 *
 * 聊天界面（消息朗读按钮 / VoiceChip / 自动朗读）没有像工作台各屏那样的
 * 内联错误展示，失败时用户看到的就是「点了没反应」。这里观察
 * `ttsStore.speechError`，只对标记为来自聊天的错误弹窗（`speechErrorFromChat`），
 * 工作台屏的试听失败仍走它们自己的内联红字。
 *
 * 格式与 DownloadErrorDialog 同一套：components/Dialog 全局弹窗
 * （自动带液态玻璃底），单个确认按钮关闭并清除错误。
 */
export const TTSErrorDialog: React.FC = observer(() => {
  const l10n = React.useContext(L10nContext);

  const visible = ttsStore.speechError != null && ttsStore.speechErrorFromChat;
  const dismiss = () => ttsStore.clearSpeechError();
  const actions: DialogAction[] = [
    {label: l10n.common.ok, onPress: dismiss, mode: 'contained'},
  ];

  return (
    <Portal>
      <Dialog
        testID="tts-error-dialog"
        visible={visible}
        onDismiss={dismiss}
        title={l10n.voiceAndSpeech.playbackErrorTitle}
        actions={actions}>
        <Text variant="bodyMedium" testID="tts-error-message">
          {ttsStore.speechError}
        </Text>
      </Dialog>
    </Portal>
  );
});
