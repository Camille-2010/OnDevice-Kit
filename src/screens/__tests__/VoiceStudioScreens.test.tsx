import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

// Persistence + player 必须在 import 页面之前 stub
jest.mock('mobx-persist-store', () => ({
  makePersistable: jest.fn().mockReturnValue(Promise.resolve()),
}));
jest.mock('../../services/tts/cloudPlayer', () => ({
  playPcmBase64: jest.fn().mockResolvedValue(undefined),
  stopPcmPlayback: jest.fn().mockResolvedValue(undefined),
  bytesToBase64: (b: Uint8Array) => Buffer.from(b).toString('base64'),
  bytesToUtf8: (b: Uint8Array) => Buffer.from(b).toString('utf8'),
  isPcmPlaying: jest.fn().mockResolvedValue(false),
}));
jest.mock('../../specs/NativeAudioRecorder', () => ({
  __esModule: true,
  default: {
    startRecording: jest.fn().mockResolvedValue(true),
    stopRecording: jest.fn().mockResolvedValue('/tmp/rec.wav'),
    isRecording: jest.fn().mockResolvedValue(false),
  },
}));

import {VoiceCloneScreen} from '../VoiceCloneScreen';
import {VoiceChangeScreen} from '../VoiceChangeScreen';

describe('语音克隆 / 音色转换 页面渲染冒烟', () => {
  it('语音克隆页：默认云端模式，渲染出双模式切换与克隆合成入口', () => {
    const {getByText} = render(<VoiceCloneScreen />);
    expect(getByText('云端服务')).toBeTruthy();
    expect(getByText('本地引擎')).toBeTruthy();
    expect(getByText('参考音频（要克隆的音色）')).toBeTruthy();
    expect(getByText('克隆并生成')).toBeTruthy();
  });

  it('语音克隆页：切到本地模式后显示音色选择与「本机无克隆引擎」提示', () => {
    const {getByText} = render(<VoiceCloneScreen />);
    fireEvent.press(getByText('本地引擎'));
    expect(getByText('音色')).toBeTruthy();
    expect(getByText(/本机没有音色克隆引擎/)).toBeTruthy();
  });

  it('音色转换页：默认云端 RVC 变声模式，渲染源音频与变声入口', () => {
    const {getByText} = render(<VoiceChangeScreen />);
    expect(getByText('云端服务')).toBeTruthy();
    expect(getByText('本地引擎')).toBeTruthy();
    expect(getByText('RVC 变声（真变声）')).toBeTruthy();
    expect(getByText('源音频（要转换的声音）')).toBeTruthy();
    expect(getByText('开始变声')).toBeTruthy();
  });

  it('音色转换页：切到跨音色重读显示目标音色与重读入口', () => {
    const {getByText} = render(<VoiceChangeScreen />);
    fireEvent.press(getByText('跨音色重读'));
    expect(getByText('目标音色（要换成的声音）')).toBeTruthy();
    expect(getByText('开始重读')).toBeTruthy();
  });

  it('音色转换页：切到本地模式后显示音色选择与「本机无变声引擎」提示', () => {
    const {getByText} = render(<VoiceChangeScreen />);
    fireEvent.press(getByText('本地引擎'));
    expect(getByText('音色')).toBeTruthy();
    expect(getByText(/本机没有变声引擎/)).toBeTruthy();
  });
});
