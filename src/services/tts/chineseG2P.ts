/**
 * 中文 G2P：汉字 → IPA（带声调箭头）。
 *
 * 【为什么需要它】
 * Kokoro 的 6 个中文音色（zf_* / zm_*）是真正的中文语音模型，但它默认只带
 * **英文**音素词典（en-us.bin）—— 汉字进不去，所以之前中文音色读不出中文。
 * 语音库的 `Speech.speak({phonemes})` 支持直接喂音素串，绕开内置英文音素化。
 *
 * 【音素体系必须对齐 misaki】
 * 模型训练时的 G2P 是 misaki（hexgrad/misaki 的 zh.py）。它对 tokenizer 的
 * 约束是**硬性的**——Kokoro 的 tokenizer 是字符级，不在词表里的字符被
 * **静默丢弃**（BPETokenizer.normalize：validChars 之外的字符直接丢）。
 * 实测官方 tokenizer.json（115 字符）：
 *   ✓ 在表内：ʈ ʂ ʰ ɕ ɥ ɛ ə ŋ ɪ ʊ ɚ ɐ …（汉语 IPA 辅音元音全覆盖）
 *   ✗ 不在表内：Chao 调值字母 ˥˧˩、数字 1-5
 * misaki 的 `retone()` 因此把 Chao 字母替换成**箭头**（词表里有 ↗↘↓→）：
 *   ˧˩˧→↓（三声） ˧˥→↗（二声） ˥˩→↘（四声） ˥→→（一声）
 * 我们原来直接把 Chao 字母喂进去 → 全部被丢弃 → 读出来的是无声调拼音；
 * 再叠加 phonemize 的拼音索引错位 bug → 多字文本拼音全乱，用户听感就是
 * 「标注中文却读不出中文」。两个问题本文件一并修掉。
 *
 * 【混合文本】
 * 中文片段转成 IPA，其余字符（英文/数字/标点）原样保留交给模型。
 * Kokoro 的中文音色本来也只该喂中文；英文内容请切回英文音色。
 */

interface ZhG2PModel {
  textToIPA(text: string): string;
}

// 用包名子路径（package.json 的 exports 里有 "./zh-g2p"）：Metro / Node /
// Jest 都能解析。不能写 `phonemize/dist/zh-g2p.cjs` —— exports 会把这种
// 深路径判为非法导入。CJS 入口 RN 直接支持。
const G2PModel = require('phonemize/zh-g2p') as {
  new (): ZhG2PModel;
};

const model = new G2PModel();

/** 这段文本里有没有汉字（没有就没必要走中文 G2P） */
export const containsHan = (text: string): boolean =>
  /[\u4e00-\u9fff]/.test(text);

/**
 * Chao 调值字母 → 声调箭头（对齐 misaki ZHG2P.retone）。
 *
 * ⚠️ 替换顺序：组合长的优先，˥ 是其他组合的子串必须放最后；
 * phonemize 的一声用双 ˥（TONE_MARKS[1]='˥˥'），misaki 用单 ˥，两种都覆盖。
 * 轻声的 ˧ 不在词表 → 显式去掉（丢弃不如不给，省一个空 token）。
 */
const retone = (p: string): string =>
  p
    .replace(/˧˩˧/g, '↓') // 三声
    .replace(/˧˥/g, '↗') // 二声
    .replace(/˥˩/g, '↘') // 四声
    .replace(/˥˥/g, '→') // 一声（phonemize：双 ˥）
    .replace(/˥/g, '→') // 一声（misaki：单 ˥，兜底）
    .replace(/˧/g, ''); // 轻声：词表无此字符，直接去掉

/**
 * 中文标点 → 英文标点（对齐 misaki ZHG2P.map_punctuation）。
 * Kokoro 词表只有英文标点，中文标点原样喂进去会被静默丢弃 → 全文无停顿。
 */
const PUNCT_MAP: [RegExp, string][] = [
  [/、/g, ', '],
  [/，/g, ', '],
  [/。/g, '. '],
  [/．/g, '. '],
  [/！/g, '! '],
  [/？/g, '? '],
  [/：/g, ': '],
  [/；/g, '; '],
  [/「/g, ' “'],
  [/」/g, '” '],
  [/【/g, ' “'],
  [/】/g, '” '],
  [/（/g, ' ('],
  [/）/g, ') '],
  [/《/g, ' “'],
  [/》/g, '” '],
];

const mapPunctuation = (text: string): string => {
  let out = text;
  for (const [re, to] of PUNCT_MAP) {
    out = out.replace(re, to);
  }
  return out;
};

/** 汉字 → IPA（带声调箭头）；非汉字字符原样返回 */
export const chineseToIPA = (text: string): string => {
  if (!text || !text.trim()) {
    return text;
  }
  try {
    const normalized = mapPunctuation(text);
    // ⚠️ 必须按「汉字段 / 非汉字段」切分后逐段转：
    // phonemize 内部用 pinyin-pro 的 `nonZh:'removed'`（非汉字被移除），
    // 再按**全文索引**去拼音数组里取 —— 一旦文本里有标点/空格/英文，
    // 数组比全文短，索引从第一个非汉字起整体错位（实测「你好，世界」
    // 的「世」取到「界」的拼音）。整段纯汉字送进去时数组长度==文本长度，
    // 索引对齐，绕开该 bug；非汉字段原样拼回。
    return normalized
      .split(/([\u4e00-\u9fff]+)/)
      .map(seg =>
        /^[\u4e00-\u9fff]+$/.test(seg) ? retone(model.textToIPA(seg)) : seg,
      )
      .join('');
  } catch (err) {
    console.warn('[chineseG2P] 音素化失败，退回原文:', err);
    return text;
  }
};
