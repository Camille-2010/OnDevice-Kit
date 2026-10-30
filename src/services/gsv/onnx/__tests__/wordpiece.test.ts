import {encodeForBert, parseVocab, CLS_ID, SEP_ID, UNK_ID} from '../wordpiece';

const MINI_VOCAB = [
  '[PAD]',
  '[UNK]',
  '[CLS]',
  '[SEP]',
  '你',
  '好',
  '，',
  '世',
  '界',
  '!',
].join('\n');

describe('wordpiece', () => {
  const vocab = parseVocab(MINI_VOCAB);

  it('assigns ids by line index', () => {
    expect(vocab.map.get('你')).toBe(4);
    expect(vocab.map.get('!')).toBe(9);
  });

  it('wraps text with [CLS]/[SEP], one token per char', () => {
    const {inputIds, attentionMask, tokenTypeIds} = encodeForBert(
      vocab,
      '你好,世界!',
    );
    // note: half-width ',' is not in the mini vocab -> UNK, still 1 token
    expect(inputIds.length).toBe(8); // CLS + 6 chars + SEP
    expect(inputIds[0]).toBe(BigInt(CLS_ID));
    expect(inputIds[inputIds.length - 1]).toBe(BigInt(SEP_ID));
    expect(inputIds[1]).toBe(BigInt(4));
    expect(Array.from(attentionMask)).toEqual(new Array(8).fill(1n));
    expect(Array.from(tokenTypeIds)).toEqual(new Array(8).fill(0n));
  });

  it('maps unknown chars to [UNK] keeping 1:1 alignment', () => {
    const {inputIds} = encodeForBert(vocab, '你咩');
    expect(inputIds[2]).toBe(BigInt(UNK_ID));
    expect(inputIds.length).toBe(4);
  });
});
