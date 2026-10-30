declare module 'react-native/Libraries/Blob/Blob' {
  class Blob {
    constructor(parts: Array<Blob | string>);

    get size(): number;
  }

  export default Blob;
}

declare module '*.png' {
  const value: any;
  export default value;
}

declare module '*.svg' {
  import React from 'react';
  import {SvgProps} from 'react-native-svg';
  const content: React.FC<SvgProps>;
  export default content;
}

/**
 * 原生 PCM 播放器。
 *
 * 这个播放器**没有从包入口导出**（index 只导出了 Speech 和引擎类），
 * 但包里没有 `exports` 字段，所以 Metro 能按路径解析到它。
 * 云端 TTS 返回的是裸 PCM，正好用它播（见 services/tts/cloudPlayer.ts）。
 */
declare module '@pocketpalai/react-native-speech/lib/module/NativeAudioPlayer' {
  interface PcmPlayerConfig {
    /** 采样率，OpenAI 的 pcm 是 24000 */
    sampleRate: number;
    /** 声道数，1 = 单声道 */
    channels: number;
    ducking?: boolean;
  }
  const player: {
    playAudio: (
      audioDataBase64: string,
      config: PcmPlayerConfig,
    ) => Promise<void>;
    stop: () => Promise<void>;
    pause: () => Promise<boolean>;
    resume: () => Promise<boolean>;
    isSpeaking: () => Promise<boolean>;
  };
  export default player;
}
