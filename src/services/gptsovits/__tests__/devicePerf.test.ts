import {tierFromRtf, assessDevicePerf} from '../devicePerf';

jest.mock('react-native-device-info', () => ({
  __esModule: true,
  default: {
    getModel: jest.fn(),
    getHardware: jest.fn(),
    getTotalMemory: jest.fn(),
    getFreeDiskStorage: jest.fn(),
    isLowRamDevice: jest.fn(),
  },
}));

import DeviceInfo from 'react-native-device-info';

const mock = DeviceInfo as unknown as {
  getModel: jest.Mock;
  getHardware: jest.Mock;
  getTotalMemory: jest.Mock;
  getFreeDiskStorage: jest.Mock;
  isLowRamDevice: jest.Mock;
};

const setDevice = (opts: {
  hardware?: string;
  ramGb?: number;
  diskGb?: number;
  lowRam?: boolean;
}) => {
  mock.getModel.mockResolvedValue('Test Phone');
  mock.getHardware.mockResolvedValue(opts.hardware ?? 'sm8650');
  mock.getTotalMemory.mockResolvedValue((opts.ramGb ?? 12) * 1024 ** 3);
  mock.getFreeDiskStorage.mockResolvedValue((opts.diskGb ?? 50) * 1024 ** 3);
  mock.isLowRamDevice.mockResolvedValue(opts.lowRam ?? false);
};

beforeEach(() => jest.clearAllMocks());

describe('tierFromRtf', () => {
  it('maps rtf < 1 to fast', () => {
    expect(tierFromRtf(0.5)).toBe('fast');
  });
  it('maps 1 ~ 1.5 to usable', () => {
    expect(tierFromRtf(1)).toBe('usable');
    expect(tierFromRtf(1.4)).toBe('usable');
  });
  it('maps > 1.5 to struggling', () => {
    expect(tierFromRtf(2)).toBe('struggling');
  });
  it('maps invalid to unknown', () => {
    expect(tierFromRtf(0)).toBe('unknown');
    expect(tierFromRtf(NaN)).toBe('unknown');
  });
});

describe('assessDevicePerf', () => {
  it('flags a flagship as fast', async () => {
    setDevice({hardware: 'sm8650', ramGb: 12});
    const r = await assessDevicePerf();
    expect(r.tier).toBe('fast');
    expect(r.facts.socFamily).toBe('qualcomm');
  });

  it('recognizes mediatek', async () => {
    setDevice({hardware: 'mt6983', ramGb: 12});
    const r = await assessDevicePerf();
    expect(r.facts.socFamily).toBe('mediatek');
  });

  it('rejects low ram even on a fast soc', async () => {
    setDevice({hardware: 'sm8650', ramGb: 3});
    const r = await assessDevicePerf();
    expect(r.tier).toBe('struggling');
  });

  it('rejects when disk is too small for the model', async () => {
    setDevice({ramGb: 12, diskGb: 1});
    const r = await assessDevicePerf();
    expect(r.tier).toBe('struggling');
    expect(r.verdict).toMatch(/存储/);
  });

  it('gives a conservative verdict for unknown soc', async () => {
    setDevice({hardware: 'unknown-soc', ramGb: 8});
    const r = await assessDevicePerf();
    expect(r.tier).toBe('usable');
    expect(r.reasons.join()).toMatch(/已知列表|保守/);
  });

  it('always returns reasons for the verdict', async () => {
    setDevice({ramGb: 12});
    const r = await assessDevicePerf();
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.facts.totalMemoryGb).toBeCloseTo(12, 1);
  });
});
