import {parseWav} from '../wav';

/**
 * 构造一个最小 WAV 字节数组（16bit PCM）。
 * layout: RIFFxxxxWAVE + fmt块(16B) + data块
 */
const buildWav = (opts?: {
  sampleRate?: number;
  channels?: number;
  bits?: number;
  pcm?: number;
  extraFmtBytes?: number; // 在 fmt 与 data 之间插入 LIST 等附加块
}): Uint8Array => {
  const sampleRate = opts?.sampleRate ?? 32000;
  const channels = opts?.channels ?? 1;
  const bits = opts?.bits ?? 16;
  const pcmLen = opts?.pcm ?? 8;
  const extra = opts?.extraFmtBytes ?? 0;
  // 附加块占 8 字节头 + extra 字节载荷（extra 取偶数，避免再补对齐字节）

  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;

  // RIFF(12) + fmt(8+16) + [LIST(8+extra)] + data(8+pcm)
  const extraTotal = extra > 0 ? 8 + extra : 0;
  const total = 12 + 8 + 16 + extraTotal + 8 + pcmLen;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  let o = 0;
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      buf[o++] = s.charCodeAt(i);
    }
  };
  const u32 = (v: number) => {
    view.setUint32(o, v, true);
    o += 4;
  };
  const u16 = (v: number) => {
    view.setUint16(o, v, true);
    o += 2;
  };

  str('RIFF');
  u32(total - 8);
  str('WAVE');

  str('fmt ');
  u32(16);
  u16(1); // PCM
  u16(channels);
  u32(sampleRate);
  u32(byteRate);
  u16(blockAlign);
  u16(bits);

  if (extra > 0) {
    str('LIST');
    u32(extra);
    for (let i = 0; i < extra; i++) {
      buf[o++] = 0;
    }
  }

  str('data');
  u32(pcmLen);
  for (let i = 0; i < pcmLen; i++) {
    buf[o++] = i & 0xff;
  }

  return buf;
};

describe('parseWav', () => {
  it('parses a standard 32k mono 16bit wav', () => {
    const info = parseWav(buildWav());
    expect(info.sampleRate).toBe(32000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.dataLength).toBe(8);
    // data 起点应指向 PCM 第一字节
    expect(info.dataOffset).toBe(12 + 8 + 16 + 8);
  });

  it('parses stereo 44.1k', () => {
    const info = parseWav(buildWav({sampleRate: 44100, channels: 2}));
    expect(info.sampleRate).toBe(44100);
    expect(info.channels).toBe(2);
  });

  it('handles an extra LIST chunk before data (non-44 offset)', () => {
    const info = parseWav(buildWav({extraFmtBytes: 10}));
    expect(info.sampleRate).toBe(32000);
    expect(info.dataLength).toBe(8);
    // 有附加块时 data 起点要后移，且仍能正确读到长度
    expect(info.dataOffset).toBeGreaterThan(12 + 8 + 16 + 8);
  });

  it('reports bits per sample for 24bit', () => {
    const info = parseWav(buildWav({bits: 24}));
    expect(info.bitsPerSample).toBe(24);
  });

  it('throws on non-wav bytes', () => {
    expect(() => parseWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(
      /不是 WAV/,
    );
  });

  it('throws on too-short buffer', () => {
    expect(() => parseWav(new Uint8Array(10))).toThrow();
  });
});
