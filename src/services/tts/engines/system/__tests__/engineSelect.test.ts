jest.mock('@pocketpalai/react-native-speech', () => ({
  __esModule: true,
  default: {
    getEngines: jest.fn(),
    setEngine: jest.fn(),
  },
}));

import Speech from '@pocketpalai/react-native-speech';

const mockGetEngines = Speech.getEngines as jest.Mock;
const mockSetEngine = Speech.setEngine as jest.Mock;

/** 每次用例重新加载模块，清掉模块级缓存 */
const loadModule = () => {
  let mod: typeof import('../engineSelect');
  jest.isolateModules(() => {
    mod = require('../engineSelect');
  });
  return mod!;
};

describe('ensureSystemEngineReady', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('default engine binds: uses it directly, never calls setEngine', async () => {
    mockGetEngines.mockResolvedValue([
      {name: 'com.google.android.tts', label: 'Google', isDefault: true},
    ]);
    const {ensureSystemEngineReady} = loadModule();

    const pkg = await ensureSystemEngineReady();

    expect(pkg).toBe('com.google.android.tts');
    expect(mockSetEngine).not.toHaveBeenCalled();
  });

  it('no default flag: prefers a known candidate from the list', async () => {
    mockGetEngines.mockResolvedValue([
      {name: 'com.some.other.tts', label: 'Other', isDefault: false},
      {name: 'com.xiaomi.mibrain.speech', label: 'MIUI', isDefault: false},
    ]);
    const {ensureSystemEngineReady} = loadModule();

    const pkg = await ensureSystemEngineReady();

    expect(pkg).toBe('com.xiaomi.mibrain.speech');
    expect(mockSetEngine).not.toHaveBeenCalled();
  });

  it('default engine fails (MIUI with no default synth): falls back to candidate package', async () => {
    // 默认引擎绑定失败 → 原生重试后 reject
    mockGetEngines.mockRejectedValueOnce(
      new Error('Failed to initialize TTS engine'),
    );
    mockSetEngine.mockResolvedValue(undefined);
    // setEngine 之后的验证调用成功
    mockGetEngines.mockResolvedValue([
      {name: 'com.xiaomi.mibrain.speech', label: 'MIUI', isDefault: true},
    ]);
    const {ensureSystemEngineReady} = loadModule();

    const pkg = await ensureSystemEngineReady();

    expect(pkg).toBe('com.xiaomi.mibrain.speech');
    expect(mockSetEngine).toHaveBeenCalledWith('com.xiaomi.mibrain.speech');
    expect(mockGetEngines).toHaveBeenCalledTimes(2);
  });

  it('skips a candidate whose bind fails and tries the next one', async () => {
    mockGetEngines.mockRejectedValueOnce(new Error('default init failed'));
    mockSetEngine
      .mockRejectedValueOnce(new Error('engine not available'))
      .mockResolvedValueOnce(undefined);
    mockGetEngines.mockResolvedValue([
      {name: 'com.google.android.tts', label: 'Google', isDefault: true},
    ]);
    const {ensureSystemEngineReady} = loadModule();

    const pkg = await ensureSystemEngineReady();

    expect(pkg).toBe('com.google.android.tts');
    expect(mockSetEngine).toHaveBeenNthCalledWith(
      1,
      'com.xiaomi.mibrain.speech',
    );
    expect(mockSetEngine).toHaveBeenNthCalledWith(2, 'com.google.android.tts');
  });

  it('returns null when no engine on the device can be bound', async () => {
    mockGetEngines.mockRejectedValue(new Error('default init failed'));
    mockSetEngine.mockRejectedValue(new Error('engine not available'));
    const {ensureSystemEngineReady} = loadModule();

    await expect(ensureSystemEngineReady()).resolves.toBeNull();
  });

  it('caches the selection: a second call makes no native calls', async () => {
    mockGetEngines.mockResolvedValue([
      {name: 'com.google.android.tts', label: 'Google', isDefault: true},
    ]);
    const {ensureSystemEngineReady} = loadModule();

    const first = await ensureSystemEngineReady();
    mockGetEngines.mockClear();
    const second = await ensureSystemEngineReady();

    expect(first).toBe('com.google.android.tts');
    expect(second).toBe('com.google.android.tts');
    expect(mockGetEngines).not.toHaveBeenCalled();
    expect(mockSetEngine).not.toHaveBeenCalled();
  });
});
