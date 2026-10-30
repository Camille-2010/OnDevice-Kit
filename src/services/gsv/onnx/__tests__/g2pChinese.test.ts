import {
  g2pChinese,
  normalizeChinese,
  phonesToIds,
  numberToChinese,
} from '../g2pChinese';

describe('normalizeChinese', () => {
  it('maps full-width punctuation to the GSV set', () => {
    expect(normalizeChinese('你好，世界！')).toBe('你好,世界!');
  });

  it('drops latin (chinese2.py strips it inside zh segments)', () => {
    expect(normalizeChinese('你好ABC世界')).toBe('你好世界');
  });

  it('reads numbers as Chinese', () => {
    expect(normalizeChinese('第123名')).toBe('第一百二十三名');
  });

  it('collapses repeated punctuation', () => {
    expect(normalizeChinese('好。。。停！')).toBe('好.停!');
  });

  it('replaces 嗯 like the python cleaner', () => {
    expect(normalizeChinese('嗯')).toBe('恩');
  });
});

describe('numberToChinese', () => {
  it('handles integers, decimals and percent', () => {
    expect(numberToChinese('123')).toBe('一百二十三');
    expect(numberToChinese('10')).toBe('十');
    expect(numberToChinese('0')).toBe('零');
    expect(numberToChinese('3.14')).toBe('三点一四');
    expect(numberToChinese('-5')).toBe('负五');
  });
});

describe('g2pChinese', () => {
  it('gives 2 phones per hanzi and 1 per punctuation', () => {
    const r = g2pChinese('你好,世界!');
    expect(r.normText).toBe('你好,世界!');
    expect(r.phones).toHaveLength(10); // 4 hanzi * 2 + 2 punct
    expect(r.word2ph).toEqual([2, 2, 1, 2, 2, 1]);
    expect(r.word2ph.reduce((a, b) => a + b, 0)).toBe(r.phones.length);
  });

  it('produces only symbols present in the v2 table', () => {
    const sentences = [
      '今天要开始什么课程呢？',
      '老师，欢迎回来！今天由阿罗娜来为你导航哦。',
      '一小时有一百二十分钟。',
      '我不去，你去吧！',
      '风起了，云散了，天晴了。',
    ];
    for (const s of sentences) {
      expect(() => phonesToIds(g2pChinese(s).phones)).not.toThrow();
    }
  });

  it('applies 一 sandhi: 一天 -> yi4, 一段 -> yi2, 第一 -> yi1', () => {
    expect(g2pChinese('一天。').phones.slice(0, 2)).toEqual(['y', 'i4']);
    expect(g2pChinese('一段。').phones.slice(0, 2)).toEqual(['y', 'i2']);
    expect(g2pChinese('第一。').phones.slice(2, 4)).toEqual(['y', 'i1']);
  });

  it('applies 不 sandhi: 不怕 -> bu2', () => {
    expect(g2pChinese('不怕。').phones[1]).toBe('u2');
    expect(g2pChinese('不怕。').phones.slice(2, 4)).toEqual(['p', 'a4']);
  });

  it('reads particle 了 as neutral via pinyin-pro context', () => {
    expect(g2pChinese('风起了。').phones[5]).toBe('e5');
  });

  it('maps measure-word 个 to neutral after numerals', () => {
    expect(g2pChinese('一个。').phones[3]).toBe('e5');
  });

  it('reads 一 in number sequences per speech sandhi (一百 -> yi4)', () => {
    expect(g2pChinese('一百二十。').phones[1]).toBe('i4');
  });
});
