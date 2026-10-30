import {Platform} from 'react-native';

import * as RNFS from '@dr.pogodin/react-native-fs';
import Speech, {TTSEngine} from '@pocketpalai/react-native-speech';

import {
  KOKORO_MODEL_BASE_URL,
  KOKORO_MODEL_FILES,
  KOKORO_MODEL_SUBDIR,
  KOKORO_VOICES_BASE_URL,
  KOKORO_VOICES_MANIFEST_FILENAME,
  TTS_DICT_FILENAME,
  TTS_PARENT_SUBDIR,
} from '../../constants';
import {writeBundledDict} from '../../bundledDict';
import {downloadTtsFile, resolveTtsUrl} from '../../modelSource';
import {ttsRuntime} from '../../runtime';
import {createEngineStreamingHandle} from '../../streamingHandle';
import type {
  Engine,
  StreamingHandle,
  StreamingOptions,
  Voice,
} from '../../types';
import {KOKORO_VOICES} from './voices';

export type KokoroProgressCallback = (progress: number) => void;

/**
 * Kokoro neural TTS engine (82M FP32 ONNX port).
 *
 * Installation is two-phase:
 *   1. Core files (`model_fp32.onnx`, `tokenizer.json`, IPA dict) — all-or-nothing;
 *      any failure cleans up the whole `tts/kokoro/` dir.
 *   2. Per-voice `.bin` embedding files — best-effort; partial success is
 *      accepted (engine usable with whichever voices did land). The voices
 *      manifest is (re)written at the end to point at the full voice
 *      catalog.
 *
 * CPU-only execution is forced (`executionProviders: ['cpu']`) across all
 * three neural engines for consistent battery/thermal behavior and easier
 * QA. The library default on iOS would otherwise include CoreML; we keep
 * it bare CPU for now.
 */
export class KokoroEngine implements Engine {
  readonly id = 'kokoro' as const;

  private getParentDir(): string {
    const root =
      Platform.OS === 'ios'
        ? `${RNFS.LibraryDirectoryPath}/Application Support`
        : RNFS.DocumentDirectoryPath;
    return `${root}/${TTS_PARENT_SUBDIR}`;
  }

  getModelPath(): string {
    const root =
      Platform.OS === 'ios'
        ? `${RNFS.LibraryDirectoryPath}/Application Support`
        : RNFS.DocumentDirectoryPath;
    return `${root}/${KOKORO_MODEL_SUBDIR}`;
  }

  private getFilePath(filename: string): string {
    return `${this.getModelPath()}/${filename}`;
  }

  async isInstalled(): Promise<boolean> {
    try {
      for (const file of KOKORO_MODEL_FILES) {
        if (!(await RNFS.exists(this.getFilePath(file.name)))) {
          return false;
        }
      }
      if (!(await RNFS.exists(this.getFilePath(TTS_DICT_FILENAME)))) {
        return false;
      }
      return RNFS.exists(this.getFilePath(KOKORO_VOICES_MANIFEST_FILENAME));
    } catch (err) {
      console.warn('[KokoroEngine] isInstalled check failed:', err);
      return false;
    }
  }

  async getVoices(): Promise<Voice[]> {
    return KOKORO_VOICES;
  }

  // Reclaim FP16 weights from previous installs (saved as `model.onnx`)
  // before the disk-space gate runs. isInstalled() reports false for legacy
  // users because the new local name is `model_fp32.onnx`, so the bundled
  // FP32 file does not double-count — but the orphan ~163 MB sits on disk
  // and can push a borderline device below the install threshold. Run this
  // BEFORE the store's disk preflight so reclaimable space counts.
  async reclaimLegacySpace(): Promise<void> {
    const legacyModelPath = this.getFilePath('model.onnx');
    if (await RNFS.exists(legacyModelPath)) {
      await RNFS.unlink(legacyModelPath).catch(() => {});
    }
  }

  async downloadModel(onProgress?: KokoroProgressCallback): Promise<void> {
    const parentDir = this.getParentDir();
    const modelDir = this.getModelPath();
    const voicesDir = `${modelDir}/voices`;

    await RNFS.mkdir(parentDir, {NSURLIsExcludedFromBackupKey: true});
    await RNFS.mkdir(modelDir, {NSURLIsExcludedFromBackupKey: true});
    await RNFS.mkdir(voicesDir, {NSURLIsExcludedFromBackupKey: true});

    // Defensive: ensure legacy FP16 file is gone even if the store skipped
    // `reclaimLegacySpace()`. Idempotent.
    await this.reclaimLegacySpace();

    // Phase 1: core files (model + tokenizer) — all-or-nothing.
    // 音素字典不再联网：HF 的大文件会 302 到大陆连不上的 xethub CDN，
    // 直接写随包的那份（见 bundledDict.ts）。
    const corePhaseWeight = 0.6;
    const coreFiles = [...KOKORO_MODEL_FILES];
    const corePerFile = new Array(coreFiles.length + 1).fill(0);
    const reportCore = () => {
      if (!onProgress) {
        return;
      }
      const sum = corePerFile.reduce((a, b) => a + b, 0);
      onProgress(Math.min(1, (sum / corePerFile.length) * corePhaseWeight));
    };

    try {
      for (let i = 0; i < coreFiles.length; i++) {
        const file = coreFiles[i]!;
        const target = this.getFilePath(file.name);
        const fromUrl = `${KOKORO_MODEL_BASE_URL}/${file.urlPath}`;
        const result = await downloadTtsFile({
          fromUrl,
          toFile: target,
          background: false,
          discretionary: false,
          cacheable: false,
          progressInterval: 500,
          progress: res => {
            const contentLength = res.contentLength || 1;
            corePerFile[i] = Math.min(1, res.bytesWritten / contentLength);
            reportCore();
          },
        });

        if (result.statusCode !== 200) {
          throw new Error(
            `Failed to download ${file.name}: HTTP ${result.statusCode}`,
          );
        }
        corePerFile[i] = 1;
        reportCore();
      }

      // 字典：随包写入（不占下载进度，失败会抛错进统一清理）
      await writeBundledDict(this.getFilePath(TTS_DICT_FILENAME));
      corePerFile[coreFiles.length] = 1;
      reportCore();
    } catch (err) {
      try {
        if (await RNFS.exists(modelDir)) {
          await RNFS.unlink(modelDir);
        }
      } catch (cleanupErr) {
        console.warn(
          '[KokoroEngine] partial-download cleanup failed:',
          cleanupErr,
        );
      }
      throw err;
    }

    // Phase 2: per-voice `.bin` embedding files — best-effort; partial OK.
    const voicePhaseBase = corePhaseWeight;
    const voicePhaseWeight = 1 - corePhaseWeight;
    let voicesDone = 0;
    for (const voice of KOKORO_VOICES) {
      const target = `${voicesDir}/${voice.id}.bin`;
      try {
        const result = await downloadTtsFile({
          fromUrl: `${KOKORO_VOICES_BASE_URL}/${voice.id}.bin`,
          toFile: target,
          background: false,
          discretionary: false,
          cacheable: false,
          progressInterval: 1000,
        });
        if (result.statusCode !== 200) {
          console.warn(
            `[KokoroEngine] voice ${voice.id} download failed: HTTP ${result.statusCode}`,
          );
        }
      } catch (voiceErr) {
        console.warn(
          `[KokoroEngine] voice ${voice.id} download failed:`,
          voiceErr,
        );
      }
      voicesDone++;
      if (onProgress) {
        onProgress(
          Math.min(
            1,
            voicePhaseBase +
              (voicesDone / KOKORO_VOICES.length) * voicePhaseWeight,
          ),
        );
      }
    }

    // Write voices manifest pointing at the voices/ directory.
    const manifest = {
      // 用真正下载成功的那个源，播放时懒取音色才不会又撞墙
      baseUrl: resolveTtsUrl(KOKORO_VOICES_BASE_URL),
      voices: KOKORO_VOICES.map(v => v.id),
    };
    await RNFS.writeFile(
      this.getFilePath(KOKORO_VOICES_MANIFEST_FILENAME),
      JSON.stringify(manifest, null, 2),
    );

    if (onProgress) {
      onProgress(1);
    }
  }

  async deleteModel(): Promise<void> {
    try {
      if (await RNFS.exists(this.getModelPath())) {
        await RNFS.unlink(this.getModelPath());
      }
    } catch (err) {
      console.warn('[KokoroEngine] deleteModel failed:', err);
    }
  }

  async loadInto(): Promise<void> {
    const modelDir = this.getModelPath();
    // 装过旧版的用户，manifest 里可能只登记了英文音色。加载时顺手把当前
    // catalog 里的全部音色（含新增的中文）补登记进 manifest，原生才认得。
    await this.syncManifest();
    await Speech.initialize({
      engine: TTSEngine.KOKORO,
      modelPath: `file://${modelDir}/model_fp32.onnx`,
      tokenizerPath: `file://${modelDir}/tokenizer.json`,
      voicesPath: `file://${modelDir}/${KOKORO_VOICES_MANIFEST_FILENAME}`,
      dictPath: `file://${modelDir}/${TTS_DICT_FILENAME}`,
      executionProviders: ['cpu'],
      maxChunkSize: 200,
      silentMode: 'obey',
      ducking: true,
    });
  }

  /**
   * 懒加载某个音色的风格嵌入 .bin。
   *
   * 安装时只下载了「当时 catalog 里的」音色。新增中文等音色后，已经装过
   * Kokoro 的机器不会重新跑完整安装，于是这些新音色的 .bin 不在本地。这里
   * 在第一次用到时按 id 从官方源补齐，保证「列表里能选得到」的音色真出声。
   */
  private async ensureVoiceBin(voiceId: string): Promise<void> {
    const voicesDir = `${this.getModelPath()}/voices`;
    const target = `${voicesDir}/${voiceId}.bin`;
    try {
      if (await RNFS.exists(target)) {
        return;
      }
    } catch {
      // 读不到就当不存在，走下面的下载兜底
    }
    await RNFS.mkdir(voicesDir, {NSURLIsExcludedFromBackupKey: true}).catch(
      () => {},
    );
    try {
      const res = await downloadTtsFile({
        fromUrl: `${KOKORO_VOICES_BASE_URL}/${voiceId}.bin`,
        toFile: target,
        background: false,
        discretionary: false,
        cacheable: false,
        progressInterval: 1000,
      });
      if (res.statusCode !== 200) {
        console.warn(
          `[KokoroEngine] 音色 ${voiceId} 风格文件下载失败: HTTP ${res.statusCode}`,
        );
      }
    } catch (err) {
      console.warn(`[KokoroEngine] 音色 ${voiceId} 风格文件下载失败:`, err);
    }
  }

  /**
   * 把 catalog 里的全部音色 id 同步进本地 voices-manifest.json。
   *
   * 原生侧按 manifest 的 voices 列表注册可用音色。已经装过的机器 manifest
   * 里只有早期英文音色，新增的中文音色需要补进列表，原生才会认得并报出声。
   * 幂等：没有新增时不动文件。返回是否改动过 manifest。
   */
  private async syncManifest(): Promise<boolean> {
    const manifestPath = this.getFilePath(KOKORO_VOICES_MANIFEST_FILENAME);
    try {
      if (!(await RNFS.exists(manifestPath))) {
        return false;
      }
      const raw = await RNFS.readFile(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      const ids = new Set<string>(manifest.voices ?? []);
      let changed = false;
      for (const v of KOKORO_VOICES) {
        if (!ids.has(v.id)) {
          ids.add(v.id);
          changed = true;
        }
      }
      if (changed) {
        manifest.voices = [...ids];
        manifest.baseUrl = resolveTtsUrl(KOKORO_VOICES_BASE_URL);
        await RNFS.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      }
      return changed;
    } catch (err) {
      console.warn('[KokoroEngine] syncManifest 失败:', err);
      return false;
    }
  }

  /**
   * 选到一个「不在旧 manifest 里」的音色时，保证它的 .bin 已就位、manifest
   * 已登记，并在引擎已加载的情况下重新初始化让原生认得它。
   */
  private async ensureVoiceRegistered(voiceId: string): Promise<void> {
    await this.ensureVoiceBin(voiceId);
    const changed = await this.syncManifest();
    if (changed && ttsRuntime.getActiveEngineId() === this.id) {
      // 之前已经用旧 manifest 初始化过，重新加载让原生认识这个新音色
      await ttsRuntime.release();
    }
  }

  async play(text: string, voice: Voice): Promise<void> {
    if (!(await this.isInstalled())) {
      throw new Error('Kokoro model is not installed');
    }
    await this.ensureVoiceRegistered(voice.id);
    await ttsRuntime.acquire(this, () => Speech.speak(text, voice.id));
  }

  /**
   * 直接喂 IPA 音素播放 —— 这是中文能读出来的关键。
   *
   * Kokoro 的 6 个中文音色（zf_ 和 zm_ 开头）是中文模型，但引擎内置的音素化
   * 只有英文词典，汉字进不去。语音库的 `Speech.speak({phonemes})` 接受音素串，
   * 我们先用 `chineseG2P` 把汉字转成「拼音 → IPA + 声调」
   * （例：你好 → ni˧˩˧ xɑʊ˧˩˧），再交给模型，绕开英文音素化这一步。
   */
  async playPhonemes(phonemes: string, voice: Voice): Promise<void> {
    if (!(await this.isInstalled())) {
      throw new Error('Kokoro model is not installed');
    }
    await this.ensureVoiceRegistered(voice.id);
    await ttsRuntime.acquire(this, () => Speech.speak({phonemes}, voice.id));
  }

  playStreaming(
    voice: Voice,
    waitFor?: Promise<void>,
    opts?: StreamingOptions,
  ): StreamingHandle {
    // 在流真正创建前把新音色的 .bin / manifest 备齐，避免首句卡在等加载
    const prepared = (waitFor ?? Promise.resolve()).then(() =>
      this.ensureVoiceRegistered(voice.id),
    );
    return createEngineStreamingHandle(
      this,
      voice.id,
      opts?.onError ? {onError: opts.onError} : undefined,
      prepared,
    );
  }

  async stop(): Promise<void> {
    await Speech.stop();
  }
}
