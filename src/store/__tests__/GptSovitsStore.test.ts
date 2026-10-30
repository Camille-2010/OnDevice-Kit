// Mock persistence BEFORE importing the store
jest.mock('mobx-persist-store', () => ({
  makePersistable: jest.fn().mockReturnValue(Promise.resolve()),
}));

// Mock the player layer so we can assert what got handed to the native
// AudioTrack without touching the real native module.
const mockPlayPcmBase64 = jest.fn().mockResolvedValue(undefined);
const mockStopPcmPlayback = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/tts/cloudPlayer', () => ({
  playPcmBase64: (...args: any[]) => mockPlayPcmBase64(...args),
  stopPcmPlayback: (...args: any[]) => mockStopPcmPlayback(...args),
  bytesToBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
  bytesToUtf8: (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8'),
  isPcmPlaying: jest.fn().mockResolvedValue(false),
}));

// axios mock
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockGet(...args),
    post: (...args: any[]) => mockPost(...args),
  },
}));

import {GptSovitsStore} from '../GptSovitsStore';

/** 最小合法 WAV（32k/单声道/16bit），供 synthesize 返回 */
const wavBytes = (): ArrayBuffer => {
  const buf = new Uint8Array(12 + 8 + 16 + 8 + 8);
  const view = new DataView(buf.buffer);
  let o = 0;
  const str = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      buf[o++] = s.charCodeAt(i);
    }
  };
  str('RIFF');
  view.setUint32(o, buf.length - 8, true);
  o += 4;
  str('WAVE');
  str('fmt ');
  view.setUint32(o, 16, true);
  o += 4;
  view.setUint16(o, 1, true);
  o += 2;
  view.setUint16(o, 1, true);
  o += 2;
  view.setUint32(o, 32000, true);
  o += 4;
  view.setUint32(o, 64000, true);
  o += 4;
  view.setUint16(o, 2, true);
  o += 2;
  view.setUint16(o, 16, true);
  o += 2;
  str('data');
  view.setUint32(o, 8, true);
  o += 4;
  return buf.buffer;
};

const makeStore = () => {
  const s = new GptSovitsStore();
  s.setApiBaseUrl('http://192.168.1.10:9880');
  s.setRefAudioPath('refs/demo.wav');
  s.setPromptText('这是参考文本');
  return s;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GptSovitsStore · 地址推导', () => {
  it('derives webui :9872 from api base when webui not set', () => {
    const s = makeStore();
    expect(s.webuiUrl).toBe('http://192.168.1.10:9872');
  });

  it('respects https scheme', () => {
    const s = new GptSovitsStore();
    s.setApiBaseUrl('https://box.local:9880');
    expect(s.webuiUrl).toBe('https://box.local:9872');
  });

  it('handles api without a port', () => {
    const s = new GptSovitsStore();
    s.setApiBaseUrl('http://box.local');
    expect(s.webuiUrl).toBe('http://box.local:9872');
  });

  it('custom webui overrides derivation', () => {
    const s = makeStore();
    s.setWebuiBaseUrl('http://10.0.0.5:8000');
    expect(s.webuiUrl).toBe('http://10.0.0.5:8000');
  });

  it('strips trailing slashes from api base', () => {
    const s = new GptSovitsStore();
    s.setApiBaseUrl('http://192.168.1.10:9880/');
    expect(s.apiBase).toBe('http://192.168.1.10:9880');
  });

  it('returns empty webui when api empty', () => {
    const s = new GptSovitsStore();
    expect(s.webuiUrl).toBe('');
  });
});

describe('GptSovitsStore · 连接检测', () => {
  it('marks online and records latency when both endpoints respond', async () => {
    mockGet.mockResolvedValue({data: {}});
    const s = makeStore();
    await s.checkConnection();
    expect(s.apiStatus).toBe('online');
    expect(s.webuiStatus).toBe('online');
    expect(s.apiLatency).not.toBeNull();
  });

  it('marks offline when api rejects', async () => {
    mockGet.mockRejectedValue({message: 'Network Error'});
    const s = makeStore();
    await s.checkConnection();
    expect(s.apiStatus).toBe('offline');
    expect(s.error).toBeTruthy();
  });

  it('requires api base', async () => {
    const s = new GptSovitsStore();
    await s.checkConnection();
    expect(s.error).toMatch(/服务地址/);
  });
});

describe('GptSovitsStore · 切权重', () => {
  it('posts set_gpt_weights', async () => {
    mockPost.mockResolvedValue({data: {message: 'ok'}});
    const s = makeStore();
    s.setGptWeightPath('GPT_weights_v2/x.ckpt');
    const ok = await s.applyGptWeights();
    expect(ok).toBe(true);
    expect(mockPost).toHaveBeenCalledWith(
      'http://192.168.1.10:9880/set_gpt_weights',
      {gpt_path: 'GPT_weights_v2/x.ckpt'},
      expect.anything(),
    );
  });

  it('posts set_sovits_weights', async () => {
    mockPost.mockResolvedValue({data: {message: 'ok'}});
    const s = makeStore();
    s.setSovitsWeightPath('SoVITS_weights_v2/x.pth');
    const ok = await s.applySovitsWeights();
    expect(ok).toBe(true);
    expect(mockPost).toHaveBeenCalledWith(
      'http://192.168.1.10:9880/set_sovits_weights',
      {sovits_path: 'SoVITS_weights_v2/x.pth'},
      expect.anything(),
    );
  });

  it('errors when path empty', async () => {
    const s = makeStore();
    expect(await s.applyGptWeights()).toBe(false);
    expect(s.error).toBeTruthy();
  });

  it('surfaces server error message', async () => {
    mockPost.mockRejectedValue({
      response: {status: 500, data: {message: '路径不存在'}},
    });
    const s = makeStore();
    s.setGptWeightPath('bad');
    const ok = await s.applyGptWeights();
    expect(ok).toBe(false);
    expect(s.error).toMatch(/500/);
    expect(s.error).toMatch(/路径不存在/);
  });
});

describe('GptSovitsStore · 合成', () => {
  it('posts tts and plays decoded pcm', async () => {
    mockPost.mockResolvedValue({data: wavBytes()});
    const s = makeStore();
    const ok = await s.synthesize('你好');
    expect(ok).toBe(true);
    expect(mockPost).toHaveBeenCalledWith(
      'http://192.168.1.10:9880/tts',
      expect.objectContaining({
        text: '你好',
        text_lang: 'zh',
        ref_audio_path: 'refs/demo.wav',
        media_type: 'wav',
      }),
      expect.objectContaining({responseType: 'arraybuffer'}),
    );
    // 原生播放器被调用，采样率来自 WAV 头
    expect(mockPlayPcmBase64).toHaveBeenCalledWith(
      expect.any(String),
      32000,
      1,
    );
  });

  it('requires ref audio path', async () => {
    const s = new GptSovitsStore();
    s.setApiBaseUrl('http://x:9880');
    expect(await s.synthesize('hi')).toBe(false);
    expect(s.error).toMatch(/参考音频/);
  });

  it('requires api base', async () => {
    const s = new GptSovitsStore();
    s.setRefAudioPath('a.wav');
    expect(await s.synthesize('hi')).toBe(false);
    expect(s.error).toMatch(/服务地址/);
  });

  it('errors when server returns non-wav', async () => {
    mockPost.mockResolvedValue({data: new ArrayBuffer(8)});
    const s = makeStore();
    expect(await s.synthesize('hi')).toBe(false);
    expect(s.error).toMatch(/WAV/);
  });
});

describe('GptSovitsStore · 角色包', () => {
  it('saves current config as a role', () => {
    const s = makeStore();
    s.setPromptLanguage('en');
    const role = s.saveCurrentAsRole('角色A');
    expect(role).not.toBeNull();
    expect(s.roles).toHaveLength(1);
    expect(s.activeRoleId).toBe(role!.id);
  });

  it('replaces same-named role', () => {
    const s = makeStore();
    s.saveCurrentAsRole('角色A');
    s.setRefAudioPath('refs/other.wav');
    s.saveCurrentAsRole('角色A');
    expect(s.roles).toHaveLength(1);
    expect(s.roles[0].refAudioPath).toBe('refs/other.wav');
  });

  it('select role copies config', () => {
    const s = makeStore();
    const role = s.saveCurrentAsRole('角色A')!;
    s.setRefAudioPath('changed.wav');
    s.selectRole(role.id);
    expect(s.refAudioPath).toBe('refs/demo.wav');
    expect(s.activeRoleId).toBe(role.id);
  });

  it('delete role clears active', () => {
    const s = makeStore();
    const role = s.saveCurrentAsRole('角色A')!;
    s.deleteRole(role.id);
    expect(s.roles).toHaveLength(0);
    expect(s.activeRoleId).toBeNull();
  });

  it('requires name and ref audio', () => {
    const s = makeStore();
    expect(s.saveCurrentAsRole('  ')).toBeNull();
    const s2 = new GptSovitsStore();
    expect(s2.saveCurrentAsRole('X')).toBeNull();
  });
});
