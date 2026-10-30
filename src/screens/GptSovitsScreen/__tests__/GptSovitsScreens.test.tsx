import React from 'react';
import {render, fireEvent} from '@testing-library/react-native';

// Persistence + player + device-info must be stubbed before importing screens
jest.mock('mobx-persist-store', () => ({
  makePersistable: jest.fn().mockReturnValue(Promise.resolve()),
}));
jest.mock('../../../services/tts/cloudPlayer', () => ({
  playPcmBase64: jest.fn().mockResolvedValue(undefined),
  stopPcmPlayback: jest.fn().mockResolvedValue(undefined),
  bytesToBase64: (b: Uint8Array) => Buffer.from(b).toString('base64'),
  bytesToUtf8: (b: Uint8Array) => Buffer.from(b).toString('utf8'),
  isPcmPlaying: jest.fn().mockResolvedValue(false),
}));

import {GptSovitsScreen} from '../GptSovitsScreen';
import {GptSovitsOnnxScreen} from '../GptSovitsOnnxScreen';
import {GptSovitsPyTorchScreen} from '../GptSovitsPyTorchScreen';
import {gptSovitsStore} from '../../../store/GptSovitsStore';

describe('GPT-SoVITS 页面渲染冒烟', () => {
  // 这些页面共用一个 gptSovitsStore 单例；前一个测试把 mode 切到 local 会
  // 泄漏到下一个测试，导致「默认云端模式」类断言失准。每个用例前复位。
  beforeEach(() => {
    gptSovitsStore.setMode('cloud');
  });

  it('引擎选择页渲染出两个引擎卡片', () => {
    const {getByText} = render(<GptSovitsScreen />);
    expect(getByText('原生 PyTorch')).toBeTruthy();
    expect(getByText('Mini ONNX')).toBeTruthy();
  });

  it('原生 PyTorch 页渲染出本地/云端切换；云端模式隐藏本地推理预判卡', () => {
    const {getByText, queryByText} = render(
      <GptSovitsPyTorchScreen onBack={() => {}} />,
    );
    expect(getByText('本地引擎')).toBeTruthy();
    expect(getByText('云端 GPT-SoVITS')).toBeTruthy();
    // 默认云端模式：不显示「这台手机跑本地推理行不行」预判卡
    expect(queryByText('这台手机跑本地推理行不行')).toBeNull();
    // 切到本地模式后才显示
    fireEvent.press(getByText('本地引擎'));
    expect(getByText('这台手机跑本地推理行不行')).toBeTruthy();
  });

  it('Mini ONNX 页渲染双模式；云端模式隐藏本地推理评估卡', () => {
    const {getByText, queryByText} = render(
      <GptSovitsOnnxScreen onBack={() => {}} />,
    );
    expect(getByText('本地 ONNX 引擎')).toBeTruthy();
    expect(getByText('云端 GPT-SoVITS')).toBeTruthy();
    // 默认云端模式：不显示「这台手机能跑本地推理吗」评估卡
    expect(queryByText('这台手机能跑本地推理吗')).toBeNull();
    // 切到本地模式后才显示
    fireEvent.press(getByText('本地 ONNX 引擎'));
    expect(getByText('这台手机能跑本地推理吗')).toBeTruthy();
  });
});
