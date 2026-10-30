/**
 * GPT-SoVITS 服务端（api_v2）返回的是标准 WAV（RIFF）。
 *
 * 项目里的原生播放器只吃「裸 PCM 的 base64」（见 services/tts/cloudPlayer.ts），
 * 所以要先剥掉 WAV 容器：从 RIFF 块结构里找到 fmt 和 data，
 * 拿到采样率 / 声道数 / 位深 / PCM 起始位置。
 *
 * 为什么不用 TextDecoder / DataView 的花哨写法：Hermes 环境，
 * 手动按字节读最稳；WAV 全是小端，直接移位拼即可。
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** PCM 数据在字节数组里的起始下标 */
  dataOffset: number;
  /** PCM 数据长度（按实际字节数截断过，不会越界） */
  dataLength: number;
}

const tagAt = (bytes: Uint8Array, o: number): string =>
  String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);

const u16At = (bytes: Uint8Array, o: number): number =>
  bytes[o] | (bytes[o + 1] << 8);

const u32At = (bytes: Uint8Array, o: number): number =>
  (bytes[o] |
    (bytes[o + 1] << 8) |
    (bytes[o + 2] << 16) |
    (bytes[o + 3] << 24)) >>>
  0;

/**
 * 解析 WAV 头。不是合法 WAV / 没有 data 块时直接抛错，
 * 错误信息会显示在合成页的错误框里。
 */
export function parseWav(bytes: Uint8Array): WavInfo {
  if (
    bytes.length < 44 ||
    tagAt(bytes, 0) !== 'RIFF' ||
    tagAt(bytes, 8) !== 'WAVE'
  ) {
    throw new Error('服务端返回的不是 WAV 音频');
  }

  // fmt 块理论上在 data 之前，但按规范遍历块最稳：
  // 有些实现会在头部插 LIST/INFO 这类附加块，偏移不是固定 44。
  let fmt: {channels: number; sampleRate: number; bits: number} | null = null;
  let off = 12; // 跳过 RIFFxxxxWAVE 共 12 字节

  while (off + 8 <= bytes.length) {
    const id = tagAt(bytes, off);
    const size = u32At(bytes, off + 4);

    if (id === 'fmt ' && off + 8 + 16 <= bytes.length) {
      // fmt 块布局：audioFormat(2) channels(2) sampleRate(4)
      //            byteRate(4) blockAlign(2) bitsPerSample(2)
      fmt = {
        channels: u16At(bytes, off + 10),
        sampleRate: u32At(bytes, off + 12),
        bits: u16At(bytes, off + 22),
      };
    } else if (id === 'data') {
      const dataOffset = off + 8;
      const dataLength = Math.min(size, bytes.length - dataOffset);
      if (!fmt) {
        // 极少见：data 在 fmt 前。兜底 GPT-SoVITS 的默认输出格式
        // （32kHz / 单声道 / 16bit），至少能出声。
        fmt = {channels: 1, sampleRate: 32000, bits: 16};
      }
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bits,
        dataOffset,
        dataLength,
      };
    }

    // 块按 2 字节对齐：size 为奇数时要跳过 1 个填充字节
    off += 8 + size + (size & 1);
  }

  throw new Error('WAV 数据里没有找到 data 块');
}
