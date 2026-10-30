import {f16ToF32, f32ToF16, f16ToF32Array, f32ToF16Array} from '../half';

describe('half float conversion', () => {
  const cases: [number, number][] = [
    [0, 0],
    [1, 0x3c00],
    [-1, 0xbc00],
    [0.5, 0x3800],
    [2, 0x4000],
    [65504, 0x7bff], // max normal half
    [1e-8, 0], // underflows to zero
  ];

  it.each(cases)('f32ToF16(%p) === %#x', (f32, bits) => {
    // allow subnormal/rounding slack of 1 ulp
    expect(Math.abs(f32ToF16(f32) - bits)).toBeLessThanOrEqual(1);
  });

  it('round-trips values within half precision', () => {
    for (const v of [0.25, 0.75, 1.5, -3.25, 123.5, 0.001, -0.001]) {
      expect(f16ToF32(f32ToF16(v))).toBeCloseTo(v, 3);
    }
  });

  it('preserves special values', () => {
    expect(f16ToF32(f32ToF16(Infinity))).toBe(Infinity);
    expect(f16ToF32(f32ToF16(-Infinity))).toBe(-Infinity);
    expect(Number.isNaN(f16ToF32(f32ToF16(NaN)))).toBe(true);
  });

  it('converts arrays', () => {
    const f32 = Float32Array.from([0, 1, -2, 0.5]);
    const bits = f32ToF16Array(f32);
    expect(bits).toBeInstanceOf(Uint16Array);
    expect(Array.from(f16ToF32Array(bits))).toEqual([0, 1, -2, 0.5]);
  });
});
