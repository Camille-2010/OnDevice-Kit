/**
 * 云端 TTS 的播放层。
 *
 * 为什么单独一个文件：
 *   1. 播放裸 PCM 的能力（`NativeNeuralAudioPlayer`）**没有从包入口导出**，
 *      只能深层导入。这里集中处理，将来包换导出方式时只改这一处。
 *   2. RN 里没有可靠的 `btoa`/`Buffer`，所以自己写一个 base64 编码，
 *      把接口返回的 ArrayBuffer 变成原生需要的 base64 字符串。
 */
import NativeNeuralAudioPlayer from '@pocketpalai/react-native-speech/lib/module/NativeAudioPlayer';

const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Uint8Array -> base64。
 *
 * 不用 `String.fromCharCode(...bytes)` 一次性展开：几秒的音频就有几十万个字节，
 * 展开成参数会爆栈。这里手动按 3 字节一组编码，并且用数组攒完再 join，
 * 避免大量字符串拼接。
 */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  const out: string[] = [];
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < len;
    const has2 = i + 2 < len;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;

    out.push(B64_CHARS[b0 >> 2]);
    out.push(B64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)]);
    out.push(has1 ? B64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=');
    out.push(has2 ? B64_CHARS[b2 & 0x3f] : '=');
  }
  return out.join('');
};

/** 播放一段 base64 裸 PCM。OpenAI 兼容接口的 `response_format: 'pcm'` 是 24kHz 单声道。 */
export const playPcmBase64 = (
  base64: string,
  sampleRate = 24000,
  channels = 1,
): Promise<void> =>
  NativeNeuralAudioPlayer.playAudio(base64, {
    sampleRate,
    channels,
    ducking: true,
  });
/** 停掉云端音频播放 */
export const stopPcmPlayback = (): Promise<void> =>
  NativeNeuralAudioPlayer.stop();

/** 当前是否在播（原生侧的真实状态） */
export const isPcmPlaying = (): Promise<boolean> =>
  NativeNeuralAudioPlayer.isSpeaking();

/**
 * Uint8Array -> UTF-8 字符串。
 *
 * 为什么不用 `TextDecoder`：**Hermes 没有这个全局**（项目里 ggufHeader.ts
 * 也专门为这个坑避过一次）。这里只用于把服务端返回的 JSON 错误体读出来，
 * 数据量很小，手写解码够用；为了保险还截断到前 4KB。
 */
export const bytesToUtf8 = (bytes: Uint8Array, maxBytes = 4096): string => {
  const len = Math.min(bytes.length, maxBytes);
  let out = '';
  let i = 0;
  while (i < len) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      const b1 = bytes[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x1f) << 6) | b1);
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      out += String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2);
    } else {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      const b3 = bytes[i++] & 0x3f;
      const cp = ((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3;
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return out;
};
