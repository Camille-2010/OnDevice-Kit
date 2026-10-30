/**
 * Chinese text -> GPT-SoVITS v2 phone symbols (TS port).
 *
 * Ported from GPT-SoVITS text/chinese2.py with v1 simplifications:
 *  - pinyin-pro replaces pypinyin + G2PW (dict-based polyphone resolution)
 *  - no jieba segmentation: tone sandhi runs at char level ("一/不" rules
 *    need only the next char's tone; word-level light-tone/儿化 rules are
 *    approximated for the common particle cases)
 *  - latin letters are stripped, matching chinese2.py's zh-segment behavior
 *
 * Every hanzi maps to exactly 2 phone symbols (via opencpop-strict.txt),
 * every punctuation mark to 1 — the same invariant the Python pipeline and
 * the BERT word2ph expansion rely on.
 */

import {pinyin} from 'pinyin-pro';

import {GSV_SYMBOL_TO_ID} from './data/gsvSymbols';
import {OPENCPOP_MAP} from './data/opencpopMap';

// ── symbol tables ──

export const GSV_PUNCTUATION = ['!', '?', '…', ',', '.', '-'] as const;

const SYMBOL_TO_ID = new Map<string, number>(GSV_SYMBOL_TO_ID);
const OPENCPOP = new Map<string, readonly [string, string]>(OPENCPOP_MAP);

// ── normalization ──

const REP_MAP: Record<string, string> = {
  '：': ',',
  '；': ',',
  '，': ',',
  '。': '.',
  '！': '!',
  '？': '?',
  '\n': '.',
  '·': ',',
  '、': ',',
  '…': '…',
  $: '.',
  '/': ',',
  '—': '-',
  '~': '…',
  '～': '…',
  '...': '…',
};

const HANZI_RE = /[\u4e00-\u9fa5]/;

const CN_DIGITS = '零一二三四五六七八九';
const CN_UNITS: [number, string][] = [
  [1e8, '亿'],
  [1e4, '万'],
  [1e3, '千'],
  [100, '百'],
  [10, '十'],
];

/** Minimal cn2an an2cn: integers (up to 亿), decimals, %, minus sign. */
export function numberToChinese(numStr: string): string {
  const neg = numStr.startsWith('-');
  let s = neg ? numStr.slice(1) : numStr;
  let out = '';
  if (s.includes('.')) {
    const [intPart, fracPart = ''] = s.split('.');
    out = intPart ? intToChinese(intPart) + '点' : '零点';
    for (const d of fracPart) {
      out += CN_DIGITS[Number(d)] ?? '';
    }
  } else {
    out = intToChinese(s);
  }
  return (neg ? '负' : '') + out;
}

function intToChinese(s: string): string {
  if (!/^\d+$/.test(s)) {
    return s;
  }
  if (s === '0') {
    return '零';
  }
  let n = Number(s.replace(/^0+/, ''));
  if (!Number.isFinite(n)) {
    return s;
  }
  let result = '';
  for (const [unit, name] of CN_UNITS) {
    if (n >= unit) {
      const q = Math.floor(n / unit);
      n %= unit;
      const qStr = unit >= 1e4 ? intToChinese(String(q)) : digitToChinese(q);
      result += qStr + name;
    }
  }
  if (n > 0) {
    result += digitToChinese(n);
  }
  // bare 10-19 reads "十X" not "一十X"
  if (/^一十/.test(result) && Number(s) < 20) {
    result = result.slice(1);
  }
  return result || '零';
}

function digitToChinese(n: number): string {
  if (n < 10) {
    return CN_DIGITS[n];
  }
  if (n < 20) {
    return '十' + (n % 10 ? CN_DIGITS[n % 10] : '');
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return CN_DIGITS[tens] + '十' + (ones ? CN_DIGITS[ones] : '');
}

/**
 * Normalize raw user text the way chinese2.py.text_normalize does
 * (subset): number reading, punctuation unification, drop everything that
 * is neither hanzi nor half-width punctuation, collapse repeats.
 */
export function normalizeChinese(text: string): string {
  // 嗯/呣 -> regular hanzi (python replace_punctuation does this)
  text = text.replace(/嗯/g, '恩').replace(/呣/g, '母');

  // numbers -> Chinese reading (python does this in TextNormalizer)
  text = text.replace(/-?\d+(\.\d+)?%?/g, m => {
    if (m.endsWith('%')) {
      return '百分之' + numberToChinese(m.slice(0, -1));
    }
    return numberToChinese(m);
  });

  // map full-width punctuation to the half-width set
  let out = '';
  for (const ch of text) {
    out += REP_MAP[ch] ?? ch;
  }

  // keep hanzi + punctuation only (also drops latin, like chinese2.py)
  const punct = GSV_PUNCTUATION.join('');
  out = out.replace(
    new RegExp(`[^\\u4e00-\\u9fa5${escapeRe(punct)}]+`, 'g'),
    '',
  );

  // collapse consecutive punctuation (avoid prompt leakage, like python)
  out = out.replace(/([!?…,.\-])[!?…,.\-]+/g, '$1');
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&');
}

// ── pinyin -> phones ──

const INITIALS_2 = new Set(['zh', 'ch', 'sh']);
const INITIALS_1 = new Set([
  'b',
  'p',
  'm',
  'f',
  'd',
  't',
  'n',
  'l',
  'g',
  'k',
  'h',
  'j',
  'q',
  'x',
  'r',
  'z',
  'c',
  's',
  'y',
  'w',
]);

/** uei/iou/uen compress when there is an initial (python v_rep_map) */
const V_REP_MAP: Record<string, string> = {uei: 'ui', iou: 'iu', uen: 'un'};
/** zero-initial syllable rewrites (python pinyin_rep_map) */
const PINYIN_REP_MAP: Record<string, string> = {
  ing: 'ying',
  i: 'yi',
  in: 'yin',
  u: 'wu',
};
/** zero-initial first-char rewrites (python single_rep_map) */
const SINGLE_REP_MAP: Record<string, string> = {
  v: 'yu',
  e: 'e',
  i: 'y',
  u: 'w',
};

export interface G2pResult {
  /** phone symbol strings (not yet mapped to ids) */
  phones: string[];
  /** BERT hidden states to repeat per phone (len == phones.length) */
  word2ph: number[];
  /** normalized text actually spoken */
  normText: string;
}

function splitInitialFinal(py: string): {
  initial: string;
  final: string;
  tone: string;
} {
  const tone = py[py.length - 1];
  const base = py.slice(0, -1);
  const two = base.slice(0, 2);
  if (INITIALS_2.has(two)) {
    return {initial: two, final: base.slice(2), tone};
  }
  const one = base.slice(0, 1);
  if (INITIALS_1.has(one)) {
    return {initial: one, final: base.slice(1), tone};
  }
  return {initial: '', final: base, tone};
}

/** Per-char pinyin with tone digit ('5' for neutral), ü as v. */
function charPinyins(chars: string[], fullText: string): string[] {
  // sentence-level call keeps pinyin-pro's polyphone context (了 le/liao…);
  // its array mode aligns 1:1 with chars for hanzi + single non-hanzi chars
  const raw = pinyin(fullText, {type: 'array', toneType: 'num', v: true});
  const pys =
    raw.length === chars.length
      ? raw
      : chars.map(
          ch => pinyin(ch, {type: 'array', toneType: 'num', v: true})[0] ?? ch,
        );
  return pys.map((py, i) => {
    if (!HANZI_RE.test(chars[i])) {
      return py; // non-hanzi passthrough
    }
    if (py.length >= 2 && /[a-z]/.test(py[0])) {
      const t = py[py.length - 1];
      const tone = t === '0' ? '5' : t; // pinyin-pro marks neutral as 0; GSV expects 5
      return py.slice(0, -1) + tone;
    }
    return py;
  });
}

function hanziPhones(
  pinyinWithTone: string,
  hanzi: string,
  prevChar: string,
  nextChar: string,
): string[] {
  const {initial, final, tone} = splitInitialFinal(pinyinWithTone);
  let pinyin = initial + final;

  if (initial) {
    const mapped = V_REP_MAP[final];
    if (mapped !== undefined) {
      pinyin = initial + mapped;
    }
  } else {
    pinyin = PINYIN_REP_MAP[pinyin] ?? pinyin;
    const head = SINGLE_REP_MAP[pinyin[0]];
    if (head !== undefined) {
      pinyin = head + pinyin.slice(1);
    }
  }

  const entry = OPENCPOP.get(pinyin);
  if (!entry) {
    return ['UNK'];
  }
  const [symC, symV] = entry;
  const effTone = effectiveTone(hanzi, pinyin, tone, prevChar, nextChar);
  return [symC, symV + effTone];
}

/**
 * Char-level port of ToneSandhi's 一/不 rules plus the particle light-tone
 * cases that don't need word segmentation (pinyin-pro already resolved
 * le/liao-style polyphones for us).
 */
function effectiveTone(
  hanzi: string,
  pinyin: string,
  tone: string,
  prevChar: string,
  nextChar: string,
): string {
  const nextIsHanzi = !!nextChar && HANZI_RE.test(nextChar);
  if (hanzi === '不' && nextIsHanzi) {
    if (toneOfNext(nextChar) === '4') {
      return '2'; // 不怕 -> bu2
    }
    return tone;
  }
  if (hanzi === '一') {
    if (prevChar === nextChar && prevChar) {
      return '5'; // 看一看
    }
    if (pinyin === 'yi' && prevChar === '第') {
      return '1'; // 第一 ordinal
    }
    // number sequences (一百二十, 一零…) keep the dictionary tone, like
    // python's _yi_sandhi all-numeric passthrough
    if (nextIsHanzi && '零一二三四五六七八九十百千万亿两'.includes(nextChar)) {
      return tone;
    }
    if (nextIsHanzi) {
      if (toneOfNext(nextChar) === '4') {
        return '2'; // 一段 -> yi2
      }
      return '4'; // 一天 -> yi4
    }
    return tone;
  }
  // measure-word 个 after a numeral/quantifier reads neutral (python ge rule)
  if (
    hanzi === '个' &&
    prevChar &&
    '零一二两三四五六七八九十百千万亿几有两半多各整每做是'.includes(prevChar)
  ) {
    return '5';
  }
  // particle light tone: 了/着/过 (pinyin-pro already picked the le/liao reading)
  if (
    (hanzi === '了' && pinyin === 'le') ||
    (hanzi === '着' && pinyin === 'zhe') ||
    (hanzi === '过' && pinyin === 'guo')
  ) {
    return '5';
  }
  if ('的地得'.includes(hanzi)) {
    return '5';
  }
  return tone;
}

const charToneCache = new Map<string, string>();

function toneOfNext(char: string): string {
  const cached = charToneCache.get(char);
  if (cached) {
    return cached;
  }
  const py = charPinyins([char], char)[0];
  const tone = py.length >= 2 && /[a-z]/.test(py[0]) ? py[py.length - 1] : '';
  charToneCache.set(char, tone);
  return tone;
}

/** Full Chinese g2p: normalize -> per-char pinyin -> symbol phones. */
export function g2pChinese(rawText: string): G2pResult {
  const text = normalizeChinese(rawText);
  if (!text) {
    return {phones: [], word2ph: [], normText: ''};
  }

  const chars = Array.from(text);
  const pys = charPinyins(chars, text);

  const phones: string[] = [];
  const word2ph: number[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (HANZI_RE.test(ch)) {
      const prev = i > 0 ? chars[i - 1] : '';
      const next = i + 1 < chars.length ? chars[i + 1] : '';
      const ph = hanziPhones(pys[i], ch, prev, next);
      phones.push(...ph);
      word2ph.push(ph.length);
    } else {
      // punctuation symbol (already normalized to the GSV punct set)
      phones.push(ch);
      word2ph.push(1);
    }
  }
  return {phones, word2ph, normText: text};
}

/** Map phone symbols to model ids; throws on symbols outside the table. */
export function phonesToIds(phones: string[]): number[] {
  return phones.map(p => {
    const id = SYMBOL_TO_ID.get(p);
    if (id === undefined) {
      throw new Error(`GsvOnnx: unknown phone symbol "${p}"`);
    }
    return id;
  });
}
