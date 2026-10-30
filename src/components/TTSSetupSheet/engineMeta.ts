import type {EngineId} from '../../services/tts';

import {l10n as locales} from '../../locales';

/**
 * Per-engine numeric/visual metadata used across the sheet for branding,
 * spec strips and group headers. Single source of truth — extend here
 * when adding a new engine.
 *
 * Localized strings (title, tagline, tier label) live in
 * `voiceAndSpeech.engine*` keys in en.json — look them up at the call
 * site so translators can localize without touching this table.
 *
 * RAM is the peak resident MB measured during synthesis (E2E memory
 * profile, iPhone 17 Pro simulator and Pixel emulator, Release). Each value
 * is the higher of the two platforms, rounded. Approximate, not disk
 * footprint.
 */
export interface EngineMeta {
  /** ~MB on disk after install (0 for system). */
  sizeMb: number;
  /** ~Peak RAM during synthesis, MB (0 for system / unknown). */
  ramMb: number;
  /** Voice count for spec strip. */
  voices: number;
  accent: string;
  gradientFrom: string;
  gradientTo: string;
}

export const ENGINE_META: Record<EngineId, EngineMeta> = {
  kitten: {
    sizeMb: 57,
    ramMb: 350,
    voices: 8,
    accent: '#F29547',
    gradientFrom: 'rgba(242, 149, 71, 0.12)',
    gradientTo: 'rgba(242, 149, 71, 0.02)',
  },
  kokoro: {
    sizeMb: 330,
    ramMb: 640,
    voices: 28,
    accent: '#6F5CD6',
    gradientFrom: 'rgba(111, 92, 214, 0.14)',
    gradientTo: 'rgba(111, 92, 214, 0.02)',
  },
  supertonic: {
    sizeMb: 380,
    ramMb: 670,
    voices: 10,
    accent: '#1E4DF6',
    gradientFrom: 'rgba(30, 77, 246, 0.14)',
    gradientTo: 'rgba(30, 77, 246, 0.02)',
  },
  system: {
    sizeMb: 0,
    ramMb: 0,
    voices: 0,
    accent: '#7B8896',
    gradientFrom: 'rgba(123, 136, 150, 0.10)',
    gradientTo: 'rgba(123, 136, 150, 0.02)',
  },
};

/**
 * 每个引擎能朗读的语言（l10n key）。
 *
 * 为什么单列：Kokoro 的 6 个「中文」音色只是**说话声纹**，发音词典只有
 * 英文；能真正读中文的本地引擎是 Supertonic。以前 UI 上完全看不出差别，
 * 用户挑了中文音色读不出中文，只会以为 App 坏了。
 */
type VoiceAndSpeechKeys = (typeof locales)['en']['voiceAndSpeech'];

/** 只取值为字符串的 key（跳过 supertonicLanguageNames 这类对象字段） */
type StringKeys<T> = {
  [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];

export const ENGINE_LANGS_KEY: Record<
  EngineId,
  StringKeys<VoiceAndSpeechKeys>
> = {
  kitten: 'engineLangsKitten',
  kokoro: 'engineLangsKokoro',
  supertonic: 'engineLangsSupertonic',
  system: 'engineLangsSystem',
};
