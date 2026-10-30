/**
 * 中文 G2P 冒烟测试。
 *
 * 这里同时验证三件事：
 *   1. `phonemize` 的 zh-g2p 子路径在 Jest / RN 里能正常 require；
 *   2. 汉字 → IPA 真的出声调（对齐 misaki 的箭头：↗↘↓→，Chao 字母
 *      不在 Kokoro 词表里、喂进去会被 tokenizer 静默丢弃）；
 *   3. 拼音索引不错位（phonemize 的 nonZh:'removed' + 全文索引 bug：
 *      含标点时从第一个非汉字起拼音整体取错）。
 */

import {chineseToIPA, containsHan} from '../chineseG2P';

describe('chineseG2P', () => {
  it('detects han characters', () => {
    expect(containsHan('你好 world')).toBe(true);
    expect(containsHan('hello')).toBe(false);
    expect(containsHan('')).toBe(false);
  });

  it('converts hanzi to IPA with tone arrows', () => {
    const ipa = chineseToIPA('你好');
    expect(ipa).not.toContain('你');
    expect(ipa).not.toContain('好');
    // 声调箭头（↗↘↓→）必须出现，否则模型读不出四声
    expect(ipa).toMatch(/[↗↘↓→]/);
    // Chao 调值字母必须全部转掉（不在 Kokoro 词表，会被静默丢弃）
    expect(ipa).not.toMatch(/[˥˧˩]/);
  });

  it('converts a full sentence', () => {
    const ipa = chineseToIPA('今天天气不错');
    expect(ipa.length).toBeGreaterThan(8);
    expect(ipa).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('keeps pinyin aligned across punctuation (index-misalignment regression)', () => {
    // 「世」的正确读音是 ʂɨ（shi）。索引错位时它会取到后面字的拼音
    // （旧实现输出 tɕiɛ = 「济」的音）。
    const ipa = chineseToIPA('你好，世界');
    expect(ipa).toContain('ʂɨ');
    // 中文逗号被映射成英文逗号（Kokoro 词表只有英文标点）
    expect(ipa).toContain(',');
  });

  it('maps chinese punctuation to ascii', () => {
    const ipa = chineseToIPA('你好，世界。');
    expect(ipa).toContain(',');
    expect(ipa).toContain('.');
    expect(ipa).not.toMatch(/[，。]/);
  });

  it('keeps latin chars in mixed text', () => {
    const ipa = chineseToIPA('你好，world');
    expect(ipa.replace(/ /g, '')).toContain('world');
  });

  it('returns empty input unchanged', () => {
    expect(chineseToIPA('')).toBe('');
    expect(chineseToIPA('   ')).toBe('   ');
  });
});
