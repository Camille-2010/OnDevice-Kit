/**
 * Float16 <-> Float32 conversion for small tensors.
 *
 * The exported GPT-SoVITS ONNX models are mixed-precision: KV caches and
 * BERT features flow through the graph as raw float16 (Uint16Array bits in
 * onnxruntime-react-native). We never convert the big tensors (they pass
 * through opaquely); only tiny ones (top-k logits, dtype shims) pay the cost.
 */

const f32Buf = new ArrayBuffer(4);
const f32View = new Float32Array(f32Buf);
const i32View = new Int32Array(f32Buf);

/** float32 -> float16 bits */
export function f32ToF16(value: number): number {
  f32View[0] = value;
  const x = i32View[0];

  const sign = (x >>> 16) & 0x8000;
  let exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;

  if (exp === 0xff) {
    // Inf / NaN
    return sign | 0x7c00 | (mant ? 0x1 : 0);
  }

  // rebias 127 -> 15
  exp = exp - 127 + 15;
  if (exp >= 0x1f) {
    return sign | 0x7c00; // overflow -> inf
  }
  if (exp <= 0) {
    // subnormal half
    if (exp < -10) {
      return sign;
    }
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | (mant >> 13);
  }
  return sign | (exp << 10) | (mant >> 13);
}

/** float16 bits -> float32 */
export function f16ToF32(h: number): number {
  const sign = (h & 0x8000) << 16;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;

  i32View[0] = 0;
  if (exp === 0) {
    if (mant === 0) {
      f32View[0] = 0;
      i32View[0] |= sign;
      return f32View[0];
    }
    // subnormal -> normalize
    let e = -1;
    let m = mant;
    do {
      m <<= 1;
      e++;
    } while (!(m & 0x400));
    m &= 0x3ff;
    i32View[0] = sign | ((127 - 15 - e) << 23) | (m << 13);
    return f32View[0];
  }
  if (exp === 0x1f) {
    i32View[0] = sign | 0x7f800000 | (mant ? 0x400000 : 0);
    return f32View[0];
  }
  i32View[0] = sign | ((exp - 15 + 127) << 23) | (mant << 13);
  return f32View[0];
}

/** float32 array -> float16 bits (new Uint16Array) */
export function f32ToF16Array(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = f32ToF16(src[i]);
  }
  return out;
}

/** float16 bits -> float32 array (new Float32Array) */
export function f16ToF32Array(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = f16ToF32(src[i]);
  }
  return out;
}
