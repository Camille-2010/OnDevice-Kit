/**
 * Tests for KokoroEngine (two-phase install: core files all-or-nothing,
 * per-voice `.bin` best-effort).
 */

import {Platform} from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Speech, {TTSEngine} from '@pocketpalai/react-native-speech';

import {KokoroEngine} from '..';
import {
  KOKORO_MODEL_FILES,
  KOKORO_VOICES_MANIFEST_FILENAME,
  TTS_DICT_FILENAME,
} from '../../../constants';
import {writeBundledDict} from '../../../bundledDict';
import {KOKORO_VOICES} from '../voices';

// 字典改成随包写入（不联网），这里 mock 掉，避免把 3.5MB base64 读进单测
jest.mock('../../../bundledDict', () => ({
  writeBundledDict: jest.fn(() => Promise.resolve()),
}));

const setPlatform = (os: 'ios' | 'android') => {
  Object.defineProperty(Platform, 'OS', {
    configurable: true,
    get: () => os,
  });
};

describe('KokoroEngine', () => {
  const anyVoice = KOKORO_VOICES[0]!;

  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS as any).__resetMockState?.();
    setPlatform('ios');
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    (RNFS.mkdir as jest.Mock).mockResolvedValue(undefined);
    (RNFS.writeFile as jest.Mock).mockResolvedValue(undefined);
    (RNFS.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  describe('getModelPath()', () => {
    it('returns iOS Application Support path on iOS', () => {
      setPlatform('ios');
      expect(new KokoroEngine().getModelPath()).toBe(
        '/path/to/library/Application Support/tts/kokoro',
      );
    });

    it('returns Documents path on Android', () => {
      setPlatform('android');
      expect(new KokoroEngine().getModelPath()).toBe(
        '/path/to/documents/tts/kokoro',
      );
    });
  });

  describe('isInstalled()', () => {
    it('returns true when core files, dict, and manifest all exist', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      await expect(new KokoroEngine().isInstalled()).resolves.toBe(true);
    });

    it('returns false when a core model file is missing', async () => {
      (RNFS.exists as jest.Mock).mockImplementation((path: string) =>
        Promise.resolve(!path.endsWith('tokenizer.json')),
      );
      await expect(new KokoroEngine().isInstalled()).resolves.toBe(false);
    });

    it('returns false when the dict is missing', async () => {
      (RNFS.exists as jest.Mock).mockImplementation((path: string) =>
        Promise.resolve(!path.endsWith(TTS_DICT_FILENAME)),
      );
      await expect(new KokoroEngine().isInstalled()).resolves.toBe(false);
    });

    it('returns false when the voices manifest is missing', async () => {
      (RNFS.exists as jest.Mock).mockImplementation((path: string) =>
        Promise.resolve(!path.endsWith(KOKORO_VOICES_MANIFEST_FILENAME)),
      );
      await expect(new KokoroEngine().isInstalled()).resolves.toBe(false);
    });
  });

  describe('downloadModel() — two-phase', () => {
    const okDownload = () => ({
      promise: Promise.resolve({statusCode: 200, bytesWritten: 100}),
      jobId: 1,
    });

    it('deletes a legacy FP16 weights file (model.onnx) before downloading FP32', async () => {
      (RNFS.downloadFile as jest.Mock).mockImplementation(okDownload);
      (RNFS.exists as jest.Mock).mockImplementation((path: string) =>
        Promise.resolve(path.endsWith('/model.onnx')),
      );

      await new KokoroEngine().downloadModel();

      expect(RNFS.unlink).toHaveBeenCalledWith(
        expect.stringContaining('/tts/kokoro/model.onnx'),
      );
    });

    it('does not unlink anything when no legacy FP16 weights are present', async () => {
      (RNFS.downloadFile as jest.Mock).mockImplementation(okDownload);
      (RNFS.exists as jest.Mock).mockResolvedValue(false);

      await new KokoroEngine().downloadModel();

      expect(RNFS.unlink).not.toHaveBeenCalledWith(
        expect.stringContaining('/tts/kokoro/model.onnx'),
      );
    });

    it('phase 1 downloads model + tokenizer, phase 2 downloads each voice, then writes manifest', async () => {
      (RNFS.downloadFile as jest.Mock).mockImplementation(okDownload);

      await new KokoroEngine().downloadModel();

      // Phase 1: core files (KOKORO_MODEL_FILES)，字典改为随包写入。
      for (const file of KOKORO_MODEL_FILES) {
        expect(RNFS.downloadFile).toHaveBeenCalledWith(
          expect.objectContaining({
            fromUrl: `https://modelscope.cn/models/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/master/${file.urlPath}`,
            toFile: expect.stringContaining(`/tts/kokoro/${file.name}`),
          }),
        );
      }
      expect(writeBundledDict).toHaveBeenCalledWith(
        expect.stringContaining(`/tts/kokoro/${TTS_DICT_FILENAME}`),
      );
      // 字典不再走网络（HF 大文件在大陆连不上）
      expect(RNFS.downloadFile).not.toHaveBeenCalledWith(
        expect.objectContaining({
          toFile: expect.stringContaining(TTS_DICT_FILENAME),
        }),
      );

      // Phase 2: every voice is downloaded.
      for (const voice of KOKORO_VOICES) {
        expect(RNFS.downloadFile).toHaveBeenCalledWith(
          expect.objectContaining({
            fromUrl: `https://modelscope.cn/models/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/master/voices/${voice.id}.bin`,
            toFile: expect.stringContaining(`/voices/${voice.id}.bin`),
          }),
        );
      }

      // Manifest written last.
      expect(RNFS.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(
          `/tts/kokoro/${KOKORO_VOICES_MANIFEST_FILENAME}`,
        ),
        expect.any(String),
      );
    });

    it('phase 1 failure cleans up the model dir and rethrows (manifest NOT written)', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      const fail = (jobId: number) => () => ({
        promise: Promise.resolve({statusCode: 500, bytesWritten: 0}),
        jobId,
      });
      (RNFS.downloadFile as jest.Mock)
        .mockImplementationOnce(okDownload) // model.onnx succeeds
        // tokenizer 会依次试 ModelScope / HF 镜像 / HF 官方，三次都失败才抛错
        .mockImplementationOnce(fail(2))
        .mockImplementationOnce(fail(3))
        .mockImplementationOnce(fail(4));

      await expect(new KokoroEngine().downloadModel()).rejects.toThrow(
        /HTTP 500/,
      );

      expect(RNFS.unlink).toHaveBeenCalledWith(
        expect.stringContaining('/tts/kokoro'),
      );
      // Manifest must not be written on core failure.
      expect(RNFS.writeFile).not.toHaveBeenCalled();
    });

    it('phase 2 voice failure is tolerated (best-effort): manifest still written, no throw', async () => {
      const coreFilesCount = KOKORO_MODEL_FILES.length; // 字典随包写入，不占下载调用
      let call = 0;
      (RNFS.downloadFile as jest.Mock).mockImplementation(() => {
        call++;
        if (call <= coreFilesCount) {
          return okDownload();
        }
        // Every voice fails with a non-200 status.
        return {
          promise: Promise.resolve({statusCode: 404, bytesWritten: 0}),
          jobId: call,
        };
      });

      await expect(new KokoroEngine().downloadModel()).resolves.toBeUndefined();

      expect(RNFS.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(KOKORO_VOICES_MANIFEST_FILENAME),
        expect.any(String),
      );
      // Phase-1 cleanup must NOT be triggered.
      expect(RNFS.unlink).not.toHaveBeenCalled();
    });

    it('phase 2 voice rejection is tolerated (best-effort): manifest still written, no throw', async () => {
      const coreFilesCount = KOKORO_MODEL_FILES.length;
      let call = 0;
      (RNFS.downloadFile as jest.Mock).mockImplementation(() => {
        call++;
        if (call <= coreFilesCount) {
          return okDownload();
        }
        return {
          promise: Promise.reject(new Error('network blip')),
          jobId: call,
        };
      });

      await expect(new KokoroEngine().downloadModel()).resolves.toBeUndefined();

      expect(RNFS.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(KOKORO_VOICES_MANIFEST_FILENAME),
        expect.any(String),
      );
    });

    it('reports monotonic progress ending at 1.0', async () => {
      (RNFS.downloadFile as jest.Mock).mockImplementation(okDownload);

      const progresses: number[] = [];
      await new KokoroEngine().downloadModel(p => progresses.push(p));

      expect(progresses.length).toBeGreaterThan(0);
      expect(progresses[progresses.length - 1]).toBe(1);
      expect(Math.min(...progresses)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...progresses)).toBeLessThanOrEqual(1);
    });
  });

  describe('deleteModel()', () => {
    it('unlinks the model directory when present', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);
      await new KokoroEngine().deleteModel();
      expect(RNFS.unlink).toHaveBeenCalledWith(
        expect.stringContaining('/tts/kokoro'),
      );
    });

    it('no-ops when the directory does not exist', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(false);
      await expect(new KokoroEngine().deleteModel()).resolves.toBeUndefined();
      expect(RNFS.unlink).not.toHaveBeenCalled();
    });
  });

  describe('voice catalog — Chinese support', () => {
    it('includes Mandarin Chinese voices tagged with a zh language', () => {
      const zh = KOKORO_VOICES.filter(v =>
        (v.language ?? '').toLowerCase().startsWith('zh'),
      );
      expect(zh.length).toBeGreaterThanOrEqual(6);
      for (const v of zh) {
        expect(v.engine).toBe('kokoro');
        expect(v.id.startsWith('zf') || v.id.startsWith('zm')).toBe(true);
      }
    });

    it('keeps all English voices intact', () => {
      const en = KOKORO_VOICES.filter(v =>
        (v.language ?? '').toLowerCase().startsWith('en'),
      );
      expect(en.length).toBe(22);
    });
  });

  describe('play()', () => {
    it('throws when the model is not installed', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(false);
      await expect(new KokoroEngine().play('hello', anyVoice)).rejects.toThrow(
        /not installed/i,
      );
    });

    it('initializes lazily with Kokoro engine id and delegates to Speech.speak', async () => {
      (RNFS.exists as jest.Mock).mockResolvedValue(true);

      const engine = new KokoroEngine();
      await engine.play('hello', anyVoice);

      expect(Speech.initialize).toHaveBeenCalledTimes(1);
      expect(Speech.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          engine: TTSEngine.KOKORO,
          modelPath: expect.stringMatching(/^file:\/\/.*model_fp32\.onnx$/),
          tokenizerPath: expect.stringMatching(/tokenizer\.json$/),
          voicesPath: expect.stringMatching(/voices-manifest\.json$/),
          dictPath: expect.stringMatching(/en-us\.bin$/),
          executionProviders: ['cpu'],
        }),
      );
      expect(Speech.speak).toHaveBeenCalledWith('hello', anyVoice.id);

      // Second play() reuses the initialized engine.
      await engine.play('again', anyVoice);
      expect(Speech.initialize).toHaveBeenCalledTimes(1);
    });
  });
});
