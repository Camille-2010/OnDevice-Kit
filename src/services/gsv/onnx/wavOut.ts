/**
 * Float32 mono PCM -> 16-bit WAV file bytes / playback helpers for the
 * on-device GSV pipeline (32 kHz mono, matching api_v2 cloud output).
 */

import {
  bytesToBase64,
  playPcmBase64,
  stopPcmPlayback,
} from '../../tts/cloudPlayer';

export function floatPcmToInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Encode mono 16-bit PCM as a RIFF/WAVE byte array. */
export function encodeWav16(pcm: Int16Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(bytes.buffer);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) {
      dv.setUint8(off + i, s.charCodeAt(i));
    }
  };
  w(0, 'RIFF');
  dv.setUint32(4, 36 + pcm.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  w(36, 'data');
  dv.setUint32(40, pcm.length * 2, true);
  new Uint8Array(dv.buffer).set(
    new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length * 2),
    44,
  );
  return bytes;
}

/** Play synthesized mono float PCM directly through the native player. */
export function playPcm32k(pcm: Float32Array): void {
  const i16 = floatPcmToInt16(pcm);
  const u8 = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  playPcmBase64(bytesToBase64(u8), 32000, 1);
}

export {stopPcmPlayback};
