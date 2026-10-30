import RNFS from '@dr.pogodin/react-native-fs';

import {parseWav} from '../gptsovits/wav';
import {bytesToBase64, playPcmBase64} from '../tts/cloudPlayer';

const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_LOOKUP: Int8Array = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) {
    t[B64_CHARS.charCodeAt(i)] = i;
  }
  return t;
})();

/** base64 → Uint8Array（RN 没有可靠 Buffer，手写解码，复用编码端查表思路）。 */
export const base64ToBytes = (b64: string): Uint8Array => {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const groups = (clean.length / 4) | 0;
  let pad = 0;
  if (clean.endsWith('==')) {
    pad = 2;
  } else if (clean.endsWith('=')) {
    pad = 1;
  }
  const out = new Uint8Array(groups * 3 - pad);
  let o = 0;
  for (let i = 0; i < groups; i++) {
    const a = B64_LOOKUP[clean.charCodeAt(i * 4)];
    const b = B64_LOOKUP[clean.charCodeAt(i * 4 + 1)];
    const c = B64_LOOKUP[clean.charCodeAt(i * 4 + 2)];
    const d = B64_LOOKUP[clean.charCodeAt(i * 4 + 3)];
    out[o++] = (a << 2) | (b >> 4);
    if (c !== -1) {
      out[o++] = (b << 4) | (c >> 2);
    }
    if (d !== -1) {
      out[o++] = (c << 6) | d;
    }
  }
  return out;
};

/** 读取本地 WAV 文件并播放（复用 cloudPlayer 的 PCM 播放 + gptsovits 的 WAV 解析）。 */
export const playWavFile = async (path: string): Promise<void> => {
  const b64 = await RNFS.readFile(path, 'base64');
  const bytes = base64ToBytes(b64);
  const wav = parseWav(bytes);
  if (wav.bitsPerSample !== 16) {
    throw new Error(`暂只支持 16bit WAV（文件是 ${wav.bitsPerSample}bit）`);
  }
  const pcm = bytes.subarray(wav.dataOffset, wav.dataOffset + wav.dataLength);
  await playPcmBase64(bytesToBase64(pcm), wav.sampleRate, wav.channels);
};
