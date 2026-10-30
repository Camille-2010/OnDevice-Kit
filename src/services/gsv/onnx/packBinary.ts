/**
 * Alignment-safe little-endian reinterpretation of raw model-pack bytes.
 *
 * `new BigInt64Array(bytes)` on a byte view converts element-wise (each byte
 * becomes a BigInt) instead of reinterpreting the buffer — everything that
 * reads pack .bin files must go through these helpers instead.
 */

export function asUint16LE(bytes: Uint8Array): Uint16Array {
  if (bytes.byteOffset % 2 === 0) {
    return new Uint16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength >> 1,
    );
  }
  const out = new Uint16Array(bytes.byteLength >> 1);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) {
    out[i] = dv.getUint16(i * 2, true);
  }
  return out;
}

export function asInt64LE(bytes: Uint8Array): BigInt64Array {
  if (bytes.byteOffset % 8 === 0) {
    return new BigInt64Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength >> 3,
    );
  }
  const out = new BigInt64Array(bytes.byteLength >> 3);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) {
    out[i] = dv.getBigInt64(i * 8, true);
  }
  return out;
}

/** Decode .bin bytes (base64/file) to a Uint8Array view over the payload. */
export function bytesOf(ab: ArrayBuffer | Uint8Array): Uint8Array {
  return ab instanceof Uint8Array ? ab : new Uint8Array(ab);
}
