jest.mock('../../tts/cloudPlayer', () => ({
  playPcmBase64: jest.fn(),
  bytesToBase64: (b: Uint8Array) => Buffer.from(b).toString('base64'),
  stopPcmPlayback: jest.fn(),
  isPcmPlaying: jest.fn(),
  bytesToUtf8: (b: Uint8Array) => Buffer.from(b).toString('utf8'),
}));

import {base64ToBytes} from '../wavPlayback';

describe('base64ToBytes', () => {
  it('decodes a simple payload', () => {
    // "hello" -> aGVsbG8=
    const bytes = base64ToBytes('aGVsbG8=');
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it('decodes with double-padding (length % 4 == 1 -> 1 byte)', () => {
    // "t" -> dA==
    const bytes = base64ToBytes('dA==');
    expect(Array.from(bytes)).toEqual([116]);
  });

  it('decodes with single-padding (length % 4 == 3 -> 2 bytes)', () => {
    // "hi" -> aGk=
    const bytes = base64ToBytes('aGk=');
    expect(Array.from(bytes)).toEqual([104, 105]);
  });

  it('ignores whitespace/newlines', () => {
    const bytes = base64ToBytes('aGVs\nbG8=');
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it('handles a byte with the high bit set', () => {
    // [0xff, 0x00, 0x7f] -> /wB/
    const bytes = base64ToBytes('/wB/');
    expect(Array.from(bytes)).toEqual([255, 0, 127]);
  });

  it('round-trips with a standard encoder', () => {
    const input = new Uint8Array([0, 1, 2, 3, 127, 128, 254, 255]);
    const b64 = Buffer.from(input).toString('base64');
    const roundTripped = base64ToBytes(b64);
    expect(Array.from(roundTripped)).toEqual(Array.from(input));
  });
});
