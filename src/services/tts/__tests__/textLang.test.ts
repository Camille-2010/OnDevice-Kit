import {
  checkLangMismatch,
  detectTextLang,
  engineSupportsLang,
  isChineseVoice,
  SYSTEM_ROUTABLE_LANGS,
  voiceSupportsLang,
} from '../textLang';
import type {Voice} from '../types';

const voice = (lang?: string): Voice => ({
  id: 'v1',
  name: 'Luna',
  engine: 'kitten',
  language: lang,
});

describe('detectTextLang', () => {
  it('detects chinese', () => {
    expect(detectTextLang('你好，这是一次测试')).toBe('zh');
  });
  it('detects japanese by kana', () => {
    expect(detectTextLang('こんにちは')).toBe('ja');
  });
  it('detects korean by hangul', () => {
    expect(detectTextLang('안녕하세요')).toBe('ko');
  });
  it('defaults to en for latin text', () => {
    expect(detectTextLang('hello world')).toBe('en');
  });
  it('returns unknown for empty', () => {
    expect(detectTextLang('   ')).toBe('unknown');
  });
  it('counts han even with punctuation mixed', () => {
    expect(detectTextLang('Hello 世界')).toBe('zh');
  });
});

describe('voiceSupportsLang', () => {
  it('zh-CN voice supports zh', () => {
    expect(voiceSupportsLang(voice('zh-CN'), 'zh')).toBe(true);
  });
  it('en voice does not support zh', () => {
    expect(voiceSupportsLang(voice('en'), 'zh')).toBe(false);
  });
  it('unlabeled voice is not hard-blocked', () => {
    expect(voiceSupportsLang(voice(undefined), 'zh')).toBe(true);
  });
  it('en is always allowed as fallback', () => {
    expect(voiceSupportsLang(voice('en'), 'en')).toBe(true);
    expect(voiceSupportsLang(voice('zh-CN'), 'en')).toBe(true);
  });
  it('matches android locale spellings (cmn / yue / underscore)', () => {
    // Android TTS 引擎常把普通话报成 cmn-CN 或 cmn_Hans_CN，粤语报成 yue-HK
    expect(voiceSupportsLang(voice('cmn-Hans-CN'), 'zh')).toBe(true);
    expect(voiceSupportsLang(voice('cmn_CN'), 'zh')).toBe(true);
    expect(voiceSupportsLang(voice('yue-HK'), 'zh')).toBe(true);
    expect(voiceSupportsLang(voice('ja-JP'), 'zh')).toBe(false);
  });
});

describe('checkLangMismatch', () => {
  it('no mismatch for chinese text with a chinese voice', () => {
    const r = checkLangMismatch('你好', voice('zh-CN'));
    expect(r.mismatched).toBe(false);
    expect(r.hint).toBe('');
  });

  it('flags chinese text with an english voice (the reported bug)', () => {
    const r = checkLangMismatch('你好，这是一次测试', voice('en'));
    expect(r.mismatched).toBe(true);
    expect(r.textLang).toBe('zh');
    expect(r.hint).toMatch(/Luna/);
    expect(r.hint).toMatch(/中文/);
  });

  it('no mismatch when no voice selected', () => {
    const r = checkLangMismatch('你好', null);
    expect(r.mismatched).toBe(false);
  });

  it('english text with english voice is fine', () => {
    const r = checkLangMismatch('hello there', voice('en'));
    expect(r.mismatched).toBe(false);
  });
});

describe('engineSupportsLang', () => {
  it('kokoro reads english and chinese (Chinese via chineseG2P phonemes)', () => {
    expect(engineSupportsLang('kokoro', 'zh')).toBe(true);
    expect(engineSupportsLang('kokoro', 'en')).toBe(true);
    expect(engineSupportsLang('kokoro', 'ja')).toBe(false);
  });
  it('kitten is english only', () => {
    expect(engineSupportsLang('kitten', 'ja')).toBe(false);
    expect(engineSupportsLang('kitten', 'en')).toBe(true);
  });
  it('supertonic is english-only for our purposes (zh audio is garbled)', () => {
    // 代码索引器虽然覆盖 CJK，但模型没在中文上训练过，实测出来是杂音；
    // 中文一律走 Kokoro 的中文音色（chineseG2P）。
    expect(engineSupportsLang('supertonic', 'zh')).toBe(false);
    expect(engineSupportsLang('supertonic', 'en')).toBe(true);
  });
  it('system engine handles any language the OS provides', () => {
    expect(engineSupportsLang('system', 'zh')).toBe(true);
    expect(engineSupportsLang('system', 'ja')).toBe(true);
    expect(engineSupportsLang('system', 'en')).toBe(true);
  });
  it('kokoro chinese voices speak chinese through the phoneme path', () => {
    // 中文音色 + chineseG2P（汉字→IPA+声调）→ Speech.speak({phonemes})
    expect(engineSupportsLang('kokoro', 'zh')).toBe(true);
  });
});

describe('isChineseVoice', () => {
  it('true for zh-CN / cmn-Hans-CN / yue-HK voices', () => {
    expect(isChineseVoice(voice('zh-CN'))).toBe(true);
    expect(isChineseVoice(voice('cmn-Hans-CN'))).toBe(true);
    expect(isChineseVoice(voice('yue-HK'))).toBe(true);
  });
  it('false for english / unlabeled / multi voices', () => {
    expect(isChineseVoice(voice('en'))).toBe(false);
    expect(isChineseVoice(voice('multi'))).toBe(false);
    expect(isChineseVoice(voice(undefined))).toBe(false);
  });
});

describe('SYSTEM_ROUTABLE_LANGS', () => {
  it('covers zh/ja/ko so the UI can offer a system fallback', () => {
    expect(SYSTEM_ROUTABLE_LANGS).toContain('zh');
    expect(SYSTEM_ROUTABLE_LANGS).toContain('ja');
    expect(SYSTEM_ROUTABLE_LANGS).toContain('ko');
    expect(SYSTEM_ROUTABLE_LANGS).not.toContain('en');
  });
});
