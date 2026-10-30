import React from 'react';
import {fireEvent} from '@testing-library/react-native';

import {render} from '../../../../jest/test-utils';
import {TTSErrorDialog} from '../TTSErrorDialog';
import {ttsStore} from '../../../../src/store';
import {l10n} from '../../../../src/locales';

describe('TTSErrorDialog', () => {
  const title = l10n.en.voiceAndSpeech.playbackErrorTitle;

  beforeEach(() => {
    jest.clearAllMocks();
    ttsStore.speechError = null;
    ttsStore.speechErrorFromChat = false;
  });

  it('renders nothing when there is no speech error', () => {
    const {queryByText} = render(<TTSErrorDialog />);
    expect(queryByText(title)).toBeNull();
  });

  it('renders nothing when the error did not come from the chat path', () => {
    ttsStore.speechError = 'boom';
    ttsStore.speechErrorFromChat = false;
    const {queryByText} = render(<TTSErrorDialog />);
    // 工作台屏有自己的内联错误展示，弹窗不抢
    expect(queryByText(title)).toBeNull();
  });

  it('shows the error message for chat-path errors', () => {
    ttsStore.speechError = 'engine crashed';
    ttsStore.speechErrorFromChat = true;
    const {getByText} = render(<TTSErrorDialog />);
    expect(getByText(title)).toBeTruthy();
    expect(getByText('engine crashed')).toBeTruthy();
  });

  it('clears the error when the OK action is pressed', () => {
    ttsStore.speechError = 'engine crashed';
    ttsStore.speechErrorFromChat = true;
    const {getByText} = render(<TTSErrorDialog />);
    fireEvent.press(getByText(l10n.en.common.ok));
    expect(ttsStore.clearSpeechError).toHaveBeenCalledTimes(1);
  });
});
