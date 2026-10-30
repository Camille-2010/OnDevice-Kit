import type {EngineId, Voice} from './types';

/**
 * 文本语言检测 + 音色语言匹配。
 *
 * 【为什么需要这个】
 *   用户报告「不能播放中文」。根因是当前音色是 kitten 的 Luna，
 *   `language: 'en'` —— 一个**英文音色**，喂中文文本自然发不出正确声音
 *   （原机会尝试按英文发音读汉字，结果是无声或乱音）。
 *   这个问题对所有走本地引擎的功能都成立（生成语音 / GPT-SoVITS 等），
 *   所以检测逻辑放这里统一复用，而不是在每个页面各写一份。
 *
 * 【判定口径】
 *   · 文本语言：按 CJK 字符占比判断，中文 > 日语 > 韩语 > 其他算英文。
 *   · 音色语言：Voice.language 是 BCP-47（zh-CN / en-US）或引擎自定义（en）。
 *     只要**包含**目标语言的两位码就算支持 —— zh-CN 支持中文，
 *     en-US 不支持。
 */

export type TextLang = 'zh' | 'ja' | 'ko' | 'en' | 'unknown';

/** 判断字符是否是 CJK 统一表意文字（中文主体） */
const isHan = (code: number): boolean =>
  (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
  (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
  (code >= 0xf900 && code <= 0xfaff); // 兼容表意

const isKana = (code: number): boolean =>
  (code >= 0x3040 && code <= 0x309f) || // 平假名
  (code >= 0x30a0 && code <= 0x30ff); // 片假名

const isHangul = (code: number): boolean =>
  (code >= 0xac00 && code <= 0xd7af) || // 韩文字母
  (code >= 0x1100 && code <= 0x11ff); // 韩文字母辅音

/**
 * 按字符占比猜文本语言。中日韩共享汉字，所以优先级是
 * 中文 > 日语（有假名）> 韩语（有谚文）> 英文。
 */
export const detectTextLang = (text: string): TextLang => {
  if (!text || !text.trim()) {
    return 'unknown';
  }
  let han = 0;
  let kana = 0;
  let hangul = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (isHan(code)) {
      han++;
    } else if (isKana(code)) {
      kana++;
    } else if (isHangul(code)) {
      hangul++;
    }
  }
  if (hangul > 0) {
    return 'ko';
  }
  if (kana > 0) {
    return 'ja';
  }
  if (han > 0) {
    return 'zh';
  }
  return 'en';
};

/**
 * 语言无关的音色语言标记：Supertonic 的说话人嵌入是跨语言通用的
 * （同一个 embedding 在 31 种语言上都能用），所以标成 multi。
 */
const LANGUAGE_AGNOSTIC_CODES = ['multi', 'auto', 'na'];

/** 音色是否支持某个语言（两位码包含匹配，大小写不敏感） */
export const voiceSupportsLang = (voice: Voice, lang: TextLang): boolean => {
  if (lang === 'unknown' || lang === 'en') {
    // 英文是兜底：音色没标语言或标了 en 都算支持
    return true;
  }
  const v = normalizeLangCode(voice.language);
  if (!v) {
    // 没标语言的音色不硬判不支持，交给引擎自己处理
    return true;
  }
  if (LANGUAGE_AGNOSTIC_CODES.includes(v)) {
    return true;
  }
  return langCodeMatches(v, lang);
};

/** 语言码归一化：Android 的 TTS 常给 `zh_CN`，Web 习惯 `zh-CN` */
export const normalizeLangCode = (code?: string): string =>
  (code ?? '').toLowerCase().replace(/_/g, '-');

/**
 * 语言码是否属于目标语言。
 *
 * ⚠️ 中文不能只判 `zh` 前缀：Android TTS 引擎（含 Google、讯飞）经常把
 * 普通话报成 `cmn-CN` / `cmn-Hans-CN`，粤语报成 `yue-HK`。只按 `zh` 匹配
 * 会漏掉这些音色，回退到「语言兜底音色」后系统找不到对应嗓音 ——
 * 用户看到的就是「选了中文音色但读不出中文」。
 */
export const langCodeMatches = (voiceLang: string, lang: TextLang): boolean => {
  const v = normalizeLangCode(voiceLang);
  if (!v) {
    return false;
  }
  if (lang === 'zh') {
    return v.startsWith('zh') || v.startsWith('cmn') || v.startsWith('yue');
  }
  return v.startsWith(lang);
};

/**
 * 每个引擎实际能做的语言（音素化 / 字符编码能力）。
 *
 * · kitten：只有英文 IPA 词典（en-us.bin），中文读不了。
 * · kokoro：英文音色只读英文；6 个中文音色（zf-/zm-）是中文模型，配合
 *   services/tts/chineseG2P.ts 的「汉字 → IPA + 声调」可以真读中文。
 *
 * · supertonic：v3 的字符索引器覆盖 CJK（实测 unicode_indexer.json 里
 *   「你好世界中文」都映射到真实 token，不是 -1），且模型训练过语言无关
 *   标签 `<na>`。所以中文/日文/韩文可以走它 —— 语言码用 'na' 送进去，
 *   见 TTSStore.supertonicLanguageFor()。
 *
 * · system：交给操作系统，由设备自带语音包决定。
 */
export const ENGINE_LANG_SUPPORT: Record<EngineId, TextLang[]> = {
  kitten: ['en', 'unknown'],
  // Kokoro：英文音色照旧只读英文；6 个中文音色走中文 G2P（见 chineseG2P.ts）
  kokoro: ['en', 'zh', 'unknown'],
  // Supertonic：语言码表里没有 zh，实测中文出来是杂音 —— 中文不给它
  supertonic: ['en', 'unknown'],
  system: ['zh', 'ja', 'ko', 'en', 'unknown'],
};

/**
 * 是不是能读中文的 Kokoro 中文音色。
 *
 * 判定用音色语言标记（zh-CN）而不是 id 前缀 —— voices.ts 里就是这么标的。
 */
export const isChineseVoice = (voice: Voice): boolean =>
  ['zh', 'cmn', 'yue'].some(code =>
    normalizeLangCode(voice.language ?? '').startsWith(code),
  );

/** 某个引擎能否音素化该语言 */
export const engineSupportsLang = (
  engineId: EngineId,
  lang: TextLang,
): boolean => ENGINE_LANG_SUPPORT[engineId]?.includes(lang) ?? false;

/** 哪些语言可以回退到系统 TTS（系统通常有对应语言包） */
export const SYSTEM_ROUTABLE_LANGS: TextLang[] = ['zh', 'ja', 'ko'];

/** 给人看的语言名（导出供 UI 复用） */
export const LANG_LABEL: Record<TextLang, string> = {
  zh: '中文',
  ja: '日语',
  ko: '韩语',
  en: '英文',
  unknown: '未知语言',
};

/** 系统路由时用的 BCP-47 语言标签（Android setLanguage 直接吃这个） */
export const LANG_TO_BCP47: Record<'zh' | 'ja' | 'ko', string> = {
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
};

export interface LangMismatch {
  /** 是否不匹配（需要提示用户） */
  mismatched: boolean;
  textLang: TextLang;
  /** 音色声明的语言（展示用） */
  voiceLang: string;
  /** 给人看的提示语；mismatched 为 false 时是空串 */
  hint: string;
}

/**
 * 检查「这段文本」和「这个音色」语言是否对得上。
 * 对不上就给出人话提示，界面直接显示。
 */
export const checkLangMismatch = (
  text: string,
  voice: Voice | null | undefined,
): LangMismatch => {
  const textLang = detectTextLang(text);
  if (!voice) {
    return {mismatched: false, textLang, voiceLang: '', hint: ''};
  }
  const voiceLang = voice.language ?? '';
  if (voiceSupportsLang(voice, textLang)) {
    return {mismatched: false, textLang, voiceLang, hint: ''};
  }
  return {
    mismatched: true,
    textLang,
    voiceLang,
    hint: `当前音色「${voice.name}」只支持${
      voiceLang ? voiceLang.toUpperCase() : '其他'
    }语言，读${LANG_LABEL[textLang]}会发不出正确声音。点「更换音色」挑一个支持${LANG_LABEL[textLang]}的音色。`,
  };
};
