/**
 * On-device GPT-SoVITS v2 inference pipeline (ONNX).
 *
 * Role packs are precomputed on PC (F:/gsv-minimal/export_pack.py): the
 * reference audio's ssl codes, spectrogram and reference-text BERT features
 * are frozen into the pack, so the device only runs four models:
 *   bert.onnx -> gpt_encoder.onnx -> gpt_step.onnx (autoregressive loop)
 *   -> sovits.onnx -> 32 kHz mono float32 PCM.
 *
 * The ORT binding is injected (OrtAdapter) so the same code runs under
 * onnxruntime-react-native on device and onnxruntime-node in the test
 * harness.
 */

import {f16ToF32Array, f32ToF16Array} from './half';
import {encodeForBert, parseVocab, type BertVocab} from './wordpiece';
import {g2pChinese, phonesToIds} from './g2pChinese';
import {asInt64LE, asUint16LE, bytesOf} from './packBinary';

// ── ORT adapter ──

export type OrtTensorData =
  | Float32Array
  | Uint16Array
  | Int32Array
  | BigInt64Array;

export interface OrtTensorLike {
  data: OrtTensorData;
  dims: readonly number[];
}

export interface OrtSessionLike {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  /** input name -> ORT type string ('float16' | 'float32' | 'int64' …) */
  readonly inputTypes: Record<string, string>;
  run(
    feeds: Record<string, OrtTensorLike>,
  ): Promise<Record<string, OrtTensorLike>>;
  release?(): Promise<void> | void;
}

export interface OrtAdapter {
  createSession(path: string): Promise<OrtSessionLike>;
  tensorFloat32(data: Float32Array, dims: readonly number[]): OrtTensorLike;
  tensorFloat16(bits: Uint16Array, dims: readonly number[]): OrtTensorLike;
  tensorInt64(data: BigInt64Array, dims: readonly number[]): OrtTensorLike;
}

// ── voice pack ──

export interface GsvPack {
  /** normalized reference text */
  refNormText: string;
  /** phone symbol ids of the reference text */
  refPhoneIds: number[];
  /** BERT feature of reference text, raw fp16 bits, [1024, T1] */
  refBertBits: Uint16Array;
  /** ssl codes of reference audio, [1, T_codes] after squeeze */
  promptSemantic: BigInt64Array;
  /** reference spectrogram, raw fp16 bits, [1, 1025, T_ref] */
  referSpecBits: Uint16Array;
  referSpecShape: readonly number[];
}

export interface GsvModelPaths {
  bert: string;
  gptEncoder: string;
  gptStep: string;
  sovits: string;
}

export interface GsvSynthOptions {
  speed?: number;
  temperature?: number;
  maxSteps?: number;
  /** progress: generated token count out of an estimated total */
  onProgress?: (tokens: number) => void;
}

export interface GsvSynthResult {
  /** mono 32 kHz PCM */
  audio: Float32Array;
  sampleRate: number;
  tokens: number;
  elapsedMs: number;
}

const EOS_TOKEN = 1024;
const TOPK = 50;
const BERT_DIM = 1024;

export class GsvPipeline {
  private sessions: {
    bert: OrtSessionLike;
    gptEncoder: OrtSessionLike;
    gptStep: OrtSessionLike;
    sovits: OrtSessionLike;
  } | null = null;

  constructor(
    private readonly adapter: OrtAdapter,
    private readonly paths: GsvModelPaths,
    private readonly pack: GsvPack,
    private readonly vocab: BertVocab,
  ) {}

  get isLoaded(): boolean {
    return this.sessions !== null;
  }

  async load(): Promise<void> {
    if (this.sessions) {
      return;
    }
    const [bert, gptEncoder, gptStep, sovits] = await Promise.all([
      this.adapter.createSession(this.paths.bert),
      this.adapter.createSession(this.paths.gptEncoder),
      this.adapter.createSession(this.paths.gptStep),
      this.adapter.createSession(this.paths.sovits),
    ]);
    this.sessions = {bert, gptEncoder, gptStep, sovits};
  }

  async release(): Promise<void> {
    const s = this.sessions;
    this.sessions = null;
    if (!s) {
      return;
    }
    await Promise.all(
      [s.bert, s.gptEncoder, s.gptStep, s.sovits].map(
        m => m.release?.() ?? Promise.resolve(),
      ),
    );
  }

  /** Synthesize Chinese text with the loaded role pack. */
  async synthesize(
    text: string,
    opts: GsvSynthOptions = {},
  ): Promise<GsvSynthResult> {
    const sess = this.sessions;
    if (!sess) {
      throw new Error('GsvOnnx: pipeline not loaded');
    }
    const t0 = Date.now();
    const speed = opts.speed ?? 1;
    const temperature = opts.temperature ?? 1.0;
    const maxSteps = opts.maxSteps ?? 1500;

    // 1. text -> phones
    const {phones, word2ph, normText} = g2pChinese(text);
    if (phones.length === 0) {
      throw new Error('GsvOnnx: 没有可合成的中文内容');
    }
    const phoneIds = phonesToIds(phones);
    const allPhoneIds = [...this.pack.refPhoneIds, ...phoneIds];

    // 2. BERT features for the synthesis text, expanded per word2ph
    const bert2 = await this.runBert(sess.bert, normText, word2ph);
    const bertAll = this.concatBert(this.pack.refBertBits, bert2);

    // 3. GPT encoder (prompt + text) -> initial KV cache + first sample
    const encOut = await sess.gptEncoder.run({
      phoneme_ids: this.adapter.tensorInt64(
        BigInt64Array.from(allPhoneIds.map(BigInt)),
        [1, allPhoneIds.length],
      ),
      prompts: this.adapter.tensorInt64(this.pack.promptSemantic, [
        1,
        this.pack.promptSemantic.length,
      ]),
      bert_feature: this.feedHalf(
        sess.gptEncoder,
        'bert_feature',
        bertAll.bits,
        [1, BERT_DIM, bertAll.length],
      ),
    });

    let currentSample = this.sampleTopk(
      encOut.topk_values,
      encOut.topk_indices,
      temperature,
    );
    const generated: number[] = [currentSample];
    const xLen = encOut.x_len.data as BigInt64Array;
    const yLen = encOut.y_len.data as BigInt64Array;
    let kCache = encOut.k_cache;
    let vCache = encOut.v_cache;
    opts.onProgress?.(generated.length);

    // 4. autoregressive loop
    let steps = 1;
    for (let i = 0; i < maxSteps; i++) {
      const stepOut = await sess.gptStep.run({
        samples: this.adapter.tensorInt64(
          BigInt64Array.from([BigInt(currentSample)]),
          [1, 1],
        ),
        k_cache: this.cacheTensor(sess.gptStep, 'k_cache', kCache),
        v_cache: this.cacheTensor(sess.gptStep, 'v_cache', vCache),
        x_len: this.adapter.tensorInt64(BigInt64Array.from([xLen[0]]), [1]),
        y_len: this.adapter.tensorInt64(BigInt64Array.from([yLen[0]]), [1]),
        idx: this.adapter.tensorInt64(BigInt64Array.from([BigInt(i)]), [1]),
      });
      kCache = stepOut.k_cache_new;
      vCache = stepOut.v_cache_new;
      currentSample = this.sampleTopk(
        stepOut.topk_values,
        stepOut.topk_indices,
        temperature,
      );
      generated.push(currentSample);
      steps++;
      opts.onProgress?.(generated.length);
      if (currentSample === EOS_TOKEN) {
        break;
      }
    }

    // 5. strip EOS + assemble semantic tokens (prompt excluded)
    let gen = generated;
    if (gen[gen.length - 1] === EOS_TOKEN) {
      gen = gen.slice(0, -1);
    }
    if (gen.length === 0) {
      throw new Error('GsvOnnx: 未生成语义 token');
    }
    const semantic = new BigInt64Array(gen.length);
    for (let i = 0; i < gen.length; i++) {
      semantic[i] = BigInt(gen[i]);
    }

    // 6. SoVITS vocoder (exported graph: speed scalar, noise_scale baked in)
    const sovOut = await sess.sovits.run({
      pred_semantic: this.adapter.tensorInt64(semantic, [1, 1, gen.length]),
      text_seq: this.adapter.tensorInt64(
        BigInt64Array.from(phoneIds.map(BigInt)),
        [1, phoneIds.length],
      ),
      refer_spec: this.feedHalf(
        sess.sovits,
        'refer_spec',
        this.pack.referSpecBits,
        this.pack.referSpecShape,
      ),
      speed: this.feedScalar(sess.sovits, 'speed', speed),
    });
    const audioOut = sovOut[Object.keys(sovOut)[0]];
    const audio = this.toF32(audioOut);

    return {
      audio,
      sampleRate: 32000,
      tokens: steps,
      elapsedMs: Date.now() - t0,
    };
  }

  // ── internals ──

  /** Feed a KV cache tensor back, adapting dtype if the model wants the other precision. */
  private cacheTensor(
    sess: OrtSessionLike,
    name: string,
    t: OrtTensorLike,
  ): OrtTensorLike {
    const want = sess.inputTypes[name];
    const have = t.data instanceof Uint16Array ? 'float16' : 'float32';
    if (want === have || (want !== 'float32' && want !== 'float16')) {
      return t;
    }
    return want === 'float32'
      ? this.adapter.tensorFloat32(f16ToF32Array(t.data as Uint16Array), t.dims)
      : this.adapter.tensorFloat16(
          f32ToF16Array(t.data as Float32Array),
          t.dims,
        );
  }

  /** Feed fp16-bits data, converting to fp32 when the model expects it. */
  private feedHalf(
    sess: OrtSessionLike,
    name: string,
    bits: Uint16Array,
    dims: readonly number[],
  ): OrtTensorLike {
    return sess.inputTypes[name] === 'float32'
      ? this.adapter.tensorFloat32(f16ToF32Array(bits), dims)
      : this.adapter.tensorFloat16(bits, dims);
  }

  /** Feed a float scalar in the dtype the model wants. */
  private feedScalar(
    sess: OrtSessionLike,
    name: string,
    value: number,
  ): OrtTensorLike {
    return sess.inputTypes[name] === 'float16'
      ? this.adapter.tensorFloat16(f32ToF16Array(Float32Array.of(value)), [1])
      : this.adapter.tensorFloat32(Float32Array.of(value), [1]);
  }

  /** Decode any float output (fp16 bits or fp32) to Float32Array. */
  private toF32(t: OrtTensorLike): Float32Array {
    return t.data instanceof Float32Array
      ? t.data
      : f16ToF32Array(t.data as Uint16Array);
  }

  /** Run BERT for synthesis text and expand to phone level via word2ph. */
  private async runBert(
    sess: OrtSessionLike,
    normText: string,
    word2ph: number[],
  ): Promise<Uint16Array> {
    const enc = encodeForBert(this.vocab, normText);
    const out = await sess.run({
      input_ids: this.adapter.tensorInt64(enc.inputIds, [
        1,
        enc.inputIds.length,
      ]),
      attention_mask: this.adapter.tensorInt64(enc.attentionMask, [
        1,
        enc.attentionMask.length,
      ]),
      token_type_ids: this.adapter.tensorInt64(enc.tokenTypeIds, [
        1,
        enc.tokenTypeIds.length,
      ]),
    });
    const hidden = out.hidden_states;
    // [1, T_bert, 1024] -> drop [CLS]/[SEP] -> tile per word2ph
    const data =
      hidden.data instanceof Float32Array
        ? hidden.data
        : f16ToF32Array(hidden.data as Uint16Array);
    const T = hidden.dims[1];
    const res = data.subarray(1 * BERT_DIM, (T - 1) * BERT_DIM); // [T-2, 1024]

    const total = word2ph.reduce((a, b) => a + b, 0);
    if (T - 2 !== word2ph.length) {
      throw new Error(
        `GsvOnnx: BERT token 数 ${T - 2} 与 word2ph ${word2ph.length} 不一致（文本含生僻字符?）`,
      );
    }
    const bits = new Uint16Array(total * BERT_DIM);
    let w = 0;
    const f32 = new Float32Array(BERT_DIM);
    for (let i = 0; i < word2ph.length; i++) {
      const off = i * BERT_DIM;
      for (let d = 0; d < BERT_DIM; d++) {
        f32[d] = res[off + d];
      }
      const f16 = f32ToF16Array(f32);
      for (let r = 0; r < word2ph[i]; r++) {
        bits.set(f16, w);
        w += BERT_DIM;
      }
    }
    return bits;
  }

  /** Concat reference BERT bits with synthesis BERT bits along the time axis. */
  private concatBert(
    refBits: Uint16Array,
    textBits: Uint16Array,
  ): {bits: Uint16Array; length: number} {
    const refLen = refBits.length / BERT_DIM;
    const textLen = textBits.length / BERT_DIM;
    const bits = new Uint16Array(refBits.length + textBits.length);
    bits.set(refBits, 0);
    bits.set(textBits, refBits.length);
    return {bits, length: refLen + textLen};
  }

  /** Softmax sample from top-k logits (fp16 bits + int64 indices). */
  private sampleTopk(
    topkValues: OrtTensorLike,
    topkIndices: OrtTensorLike,
    temperature: number,
  ): number {
    const vals = f16ToF32Array(topkValues.data as Uint16Array);
    const idx = topkIndices.data as BigInt64Array;
    const k = Math.min(TOPK, vals.length);
    let max = -Infinity;
    for (let i = 0; i < k; i++) {
      const v = vals[i] / temperature;
      vals[i] = v;
      if (v > max) {
        max = v;
      }
    }
    let sum = 0;
    const probs = new Float64Array(k);
    for (let i = 0; i < k; i++) {
      probs[i] = Math.exp(vals[i] - max);
      sum += probs[i];
    }
    let r = Math.random() * sum;
    for (let i = 0; i < k; i++) {
      r -= probs[i];
      if (r <= 0) {
        return Number(idx[i]);
      }
    }
    return Number(idx[k - 1]);
  }
}

// ── pack loading helpers (pure; file IO stays outside) ──

export interface GsvPackFiles {
  meta: string; // meta.json content
  refBert: ArrayBuffer | Uint8Array; // fp16 bits
  promptSemantic: ArrayBuffer | Uint8Array; // int64
  referSpec: ArrayBuffer | Uint8Array; // fp16 bits
}

export function parseGsvPack(files: GsvPackFiles): GsvPack {
  const meta = JSON.parse(files.meta) as {
    refNormText: string;
    refPhonesIds: number[];
    refBertShape: number[];
    referSpecShape: number[];
    promptSemanticLen: number;
  };
  const promptSemantic = asInt64LE(bytesOf(files.promptSemantic));
  // exported as [1,1,T]; squeeze the middle dim -> [1,T]
  const promptLen = meta.promptSemanticLen;
  const flat =
    promptSemantic.length === promptLen
      ? promptSemantic
      : promptSemantic.subarray(promptSemantic.length - promptLen);
  return {
    refNormText: meta.refNormText,
    refPhoneIds: meta.refPhonesIds,
    refBertBits: asUint16LE(bytesOf(files.refBert)),
    promptSemantic: flat,
    referSpecBits: asUint16LE(bytesOf(files.referSpec)),
    referSpecShape: meta.referSpecShape,
  };
}

/** Parse the bundled vocab asset. */
export function loadVocabFromText(text: string): BertVocab {
  return parseVocab(text);
}
