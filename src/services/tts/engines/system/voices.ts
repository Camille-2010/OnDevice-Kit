import Speech from '@pocketpalai/react-native-speech';

import type {Voice} from '../../types';
import {ensureSystemEngineReady} from './engineSelect';

/**
 * Fetch the OS-provided voice catalog and map it onto our generic `Voice`
 * shape. Lives in its own file so v2 can grow filtering/sorting helpers
 * (e.g., "only English voices", "group by quality") without touching
 * `SystemEngine`.
 *
 * 先 `ensureSystemEngineReady()`：默认 TTS 引擎不可用的设备（小米实测）上，
 * 不先 bind 到具体引擎包名，`getAvailableVoices()` 会直接 reject。
 */
export const getSystemVoices = async (): Promise<Voice[]> => {
  await ensureSystemEngineReady();
  const voices = await Speech.getAvailableVoices();
  return voices.map(v => ({
    id: v.identifier,
    name: v.name ?? v.identifier,
    engine: 'system',
    language: v.language,
  }));
};

/**
 * 带会话内缓存的系统语音读取。
 *
 * 文本语言路由（见 TTSStore.resolveVoiceForText）每次播放都可能来查系统里
 * 有没有对应语言的语音，原生 `getAvailableVoices()` 是跨桥调用，不该每次都打。
 * 这里缓存一次；设备语言包变化时调用 `clearSystemVoicesCache()` 刷新。
 */
let cachedSystemVoices: Voice[] | null = null;

export const getSystemVoicesCached = async (): Promise<Voice[]> => {
  if (cachedSystemVoices) {
    return cachedSystemVoices;
  }
  cachedSystemVoices = await getSystemVoices();
  return cachedSystemVoices;
};

export const clearSystemVoicesCache = (): void => {
  cachedSystemVoices = null;
};
