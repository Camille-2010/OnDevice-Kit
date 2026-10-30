import Speech, {TTSEngine} from '@pocketpalai/react-native-speech';

import {ttsRuntime} from '../../runtime';
import {createEngineStreamingHandle} from '../../streamingHandle';
import type {
  Engine,
  StreamingHandle,
  StreamingOptions,
  Voice,
} from '../../types';
import {getSystemVoices} from './voices';
import {ensureSystemEngineReady} from './engineSelect';

/**
 * Thin wrapper around the OS native TTS path exposed by
 * `@pocketpalai/react-native-speech`. Always available on iOS 13+ / Android 8+.
 */
export class SystemEngine implements Engine {
  readonly id = 'system' as const;

  async isInstalled(): Promise<boolean> {
    return true;
  }

  getVoices(): Promise<Voice[]> {
    return getSystemVoices();
  }

  /**
   * The fork still requires `Speech.initialize({engine: OS_NATIVE})` when
   * switching from a neural engine — needed so playback routes through the
   * OS native path instead of staying on the previously-active neural
   * engine. The runtime calls this whenever System becomes the active
   * engine; switching back to a neural engine triggers its own loadInto.
   *
   * 另外必须先 `ensureSystemEngineReady()`：部分国产 ROM（小米实测）没有设置
   * 默认 TTS 引擎、也没装 Google TTS，原生默认引擎绑定会直接失败
   * （"Failed to initialize TTS engine"），必须显式指定设备上存在的引擎包名。
   */
  async loadInto(): Promise<void> {
    await Speech.initialize({engine: TTSEngine.OS_NATIVE});
    const pkg = await ensureSystemEngineReady();
    if (!pkg) {
      throw new Error('系统 TTS 不可用：设备上没有找到可用的语音引擎');
    }
  }

  async play(text: string, voice: Voice): Promise<void> {
    await ttsRuntime.acquire(this, () => {
      // 具体系统音色：按 id 指定。语言兜底音色（无 id，来自 TTSStore 的系统
      // 路由 —— 不少国产 TTS 引擎不实现 getVoices，枚举不到音色但
      // setLanguage(lang) 依然有效）：用 language 选项让引擎挑默认嗓音。
      if (voice.id) {
        return Speech.speak(text, voice.id);
      }
      const lang = voice.language;
      if (lang) {
        return Speech.speak(text, undefined, {language: lang});
      }
      return Speech.speak(text);
    });
  }

  /**
   * Streaming path. The library's stream degrades to roughly per-sentence
   * speaks on OS engine (native `speak()` resolves on dispatch, so the
   * stream's underrun guard fires immediately), but the OS native queue
   * handles the chaining — behavior is equivalent to the prior JS-side
   * `onFinish` loop and we inherit the library's CJK sentence handling.
   */
  playStreaming(
    voice: Voice,
    waitFor?: Promise<void>,
    opts?: StreamingOptions,
  ): StreamingHandle {
    // 语言兜底音色（无 id）：把 language 透传进流式合成的每个批次，
    // 让系统引擎按语言挑默认嗓音。
    const streamOptions =
      voice.id || !voice.language
        ? opts?.onError
          ? {onError: opts.onError}
          : undefined
        : {language: voice.language, onError: opts?.onError};
    return createEngineStreamingHandle(this, voice.id, streamOptions, waitFor);
  }

  async stop(): Promise<void> {
    await Speech.stop();
  }
}
