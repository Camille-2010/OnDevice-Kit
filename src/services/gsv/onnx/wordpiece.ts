/**
 * WordPiece tokenizer for chinese-roberta-wwm-ext-large.
 *
 * GPT-SoVITS feeds one BERT token per Chinese character / punctuation mark:
 * the pipeline asserts hidden_states[1:-1] aligns 1:1 with word2ph, which
 * only holds because the normalized text contains hanzi + half-width
 * punctuation, each of which is a single vocab entry. Unknown chars map to
 * [UNK] (still one token), so the 1:1 invariant is preserved.
 */

export const CLS_ID = 101;
export const SEP_ID = 102;
export const UNK_ID = 100;

export interface BertVocab {
  ids: Int32Array; // token id by char code path below
  map: Map<string, number>;
}

/** Parse a "token per line" vocab file (line index == id). */
export function parseVocab(text: string): BertVocab {
  const lines = text.split('\n');
  const map = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const tok = lines[i];
    if (i === lines.length - 1 && tok === '') {
      break; // trailing newline
    }
    if (!map.has(tok)) {
      map.set(tok, i);
    }
  }
  return {ids: new Int32Array(0), map};
}

/**
 * Tokenize normalized Chinese text: [CLS] + one token per char + [SEP].
 * Attention mask all ones, token_type ids all zeros (single segment).
 */
export function encodeForBert(
  vocab: BertVocab,
  text: string,
): {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
} {
  const n = text.length;
  const ids = new BigInt64Array(n + 2);
  const mask = new BigInt64Array(n + 2);
  const types = new BigInt64Array(n + 2);

  ids[0] = BigInt(CLS_ID);
  mask[0] = 1n;
  for (let i = 0; i < n; i++) {
    const id = vocab.map.get(text[i]);
    ids[i + 1] = BigInt(id === undefined ? UNK_ID : id);
    mask[i + 1] = 1n;
  }
  ids[n + 1] = BigInt(SEP_ID);
  mask[n + 1] = 1n;
  return {inputIds: ids, attentionMask: mask, tokenTypeIds: types};
}
