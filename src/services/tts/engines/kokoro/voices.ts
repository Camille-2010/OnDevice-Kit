import type {Voice} from '../../types';

/**
 * Kokoro 82M v1.0 voice catalog (28 voices).
 *
 * IDs follow the `<lang><gender>_<name>` convention used by the upstream
 * repo: `a` = American English, `b` = British English, `e` = Spanish,
 * `f` = French, `h` = Hindi, `i` = Italian, `j` = Japanese, `p` =
 * Brazilian Portuguese, `z` = Mandarin Chinese. `f` = female, `m` = male.
 *
 * 之前只放英文音色（v1b scope 注释里写的 "filter at the UI layer by
 * `language === 'en'`）。这里把官方模型自带的中文音色（`z` 前缀）补进
 * catalog，让用户在「更换音色」里能看到中文选项。
 *
 * 注意：本地神经引擎只有英文音素词典，无法给中文做音素化，所以选了这些
 * 中文音色、喂中文文本时，TTSStore 会自动回退到系统 TTS（国产机自带中文
 * 语音包）来真正读出来 —— 这 6 个条目起的是「中文选项可见 + 触发系统路由」
 * 的作用，而不是让 Kokoro 引擎自己去读中文。
 */
export const KOKORO_VOICES: Voice[] = [
  // American English — female
  {
    id: 'af_heart',
    name: 'Heart',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_bella',
    name: 'Bella',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_nicole',
    name: 'Nicole',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_sarah',
    name: 'Sarah',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_sky',
    name: 'Sky',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_aoede',
    name: 'Aoede',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_jessica',
    name: 'Jessica',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_kore',
    name: 'Kore',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_river',
    name: 'River',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  // American English — male
  {
    id: 'am_adam',
    name: 'Adam',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_echo',
    name: 'Echo',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_eric',
    name: 'Eric',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_fenrir',
    name: 'Fenrir',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_liam',
    name: 'Liam',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_michael',
    name: 'Michael',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_onyx',
    name: 'Onyx',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_santa',
    name: 'Santa',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  // British English — female
  {
    id: 'bf_alice',
    name: 'Alice',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'f',
  },
  {
    id: 'bf_emma',
    name: 'Emma',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'f',
  },
  {
    id: 'bf_lily',
    name: 'Lily',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'f',
  },
  // British English — male
  {
    id: 'bm_george',
    name: 'George',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'm',
  },
  {
    id: 'bm_lewis',
    name: 'Lewis',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'm',
  },
  // ── Mandarin Chinese（官方模型自带，之前漏列）──
  {
    id: 'zf_xiaoxiao',
    name: '晓晓（中文）',
    engine: 'kokoro',
    language: 'zh-CN',
    gender: 'f',
  },
  {
    id: 'zf_xiaoni',
    name: '小妮（中文）',
    engine: 'kokoro',
    language: 'zh-CN',
    gender: 'f',
  },
  {
    id: 'zf_xiaobei',
    name: '小贝（中文）',
    engine: 'kokoro',
    language: 'zh-CN',
    gender: 'f',
  },
  {
    id: 'zm_yunjian',
    name: '云建（中文）',
    engine: 'kokoro',
    language: 'zh-CN',
    gender: 'm',
  },
  {
    id: 'zm_yunxi',
    name: '云溪（中文）',
    engine: 'kokoro',
    language: 'zh-CN',
    gender: 'm',
  },
  {
    id: 'zm_yunyang',
    name: '云阳（中文）',
    engine: 'kokoro',
    language: 'zh-CN',
    gender: 'm',
  },
];
