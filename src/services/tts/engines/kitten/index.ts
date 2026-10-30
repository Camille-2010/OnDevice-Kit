import {Platform} from 'react-native';

import * as RNFS from '@dr.pogodin/react-native-fs';
import Speech, {TTSEngine} from '@pocketpalai/react-native-speech';

import {
  KITTEN_MODEL_BASE_URL,
  KITTEN_MODEL_FILES,
  KITTEN_MODEL_SUBDIR,
  KITTEN_VOICES_MANIFEST_FILENAME,
  TTS_DICT_FILENAME,
  TTS_PARENT_SUBDIR,
} from '../../constants';
import {writeBundledDict} from '../../bundledDict';
import {downloadTtsFile} from '../../modelSource';
import {ttsRuntime} from '../../runtime';
import {createEngineStreamingHandle} from '../../streamingHandle';
import type {
  Engine,
  StreamingHandle,
  StreamingOptions,
  Voice,
} from '../../types';
import {KITTEN_VOICES} from './voices';

export type KittenProgressCallback = (progress: number) => void;

/**
 * Kitten neural TTS engine (15M StyleTTS2, English only).
 *
 * Installation is a single-phase, all-or-nothing download: the ONNX model,
 * the voices manifest, and the IPA dict. On any failure the entire
 * `tts/kitten/` directory is removed so a retry starts clean.
 *
 * CPU-only execution is forced to match the other neural engines.
 */
export class KittenEngine implements Engine {
  readonly id = 'kitten' as const;

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
    return `${root}/${KITTEN_MODEL_SUBDIR}`;
  }

  private getFilePath(filename: string): string {
    return `${this.getModelPath()}/${filename}`;
  }

  async isInstalled(): Promise<boolean> {
    try {
      for (const file of KITTEN_MODEL_FILES) {
        if (!(await RNFS.exists(this.getFilePath(file.name)))) {
          return false;
        }
      }
      return RNFS.exists(this.getFilePath(TTS_DICT_FILENAME));
    } catch (err) {
      console.warn('[KittenEngine] isInstalled check failed:', err);
      return false;
    }
  }

  async getVoices(): Promise<Voice[]> {
    return KITTEN_VOICES;
  }

  async downloadModel(onProgress?: KittenProgressCallback): Promise<void> {
    const parentDir = this.getParentDir();
    const modelDir = this.getModelPath();

    await RNFS.mkdir(parentDir, {NSURLIsExcludedFromBackupKey: true});
    await RNFS.mkdir(modelDir, {NSURLIsExcludedFromBackupKey: true});

    const allFiles = KITTEN_MODEL_FILES.map(f => ({
      name: f.name,
      url: `${KITTEN_MODEL_BASE_URL}/${f.urlPath}`,
    }));
    const perFileProgress = new Array(allFiles.length + 1).fill(0);
    const reportOverall = () => {
      if (!onProgress) {
        return;
      }
      const sum = perFileProgress.reduce((a, b) => a + b, 0);
      onProgress(Math.min(1, sum / perFileProgress.length));
    };

    try {
      for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i]!;
        const target = this.getFilePath(file.name);
        const result = await downloadTtsFile({
          fromUrl: file.url,
          toFile: target,
          background: false,
          discretionary: false,
          cacheable: false,
          progressInterval: 500,
          progress: res => {
            const contentLength = res.contentLength || 1;
            perFileProgress[i] = Math.min(1, res.bytesWritten / contentLength);
            reportOverall();
          },
        });

        if (result.statusCode !== 200) {
          throw new Error(
            `Failed to download ${file.name}: HTTP ${result.statusCode}`,
          );
        }
        perFileProgress[i] = 1;
        reportOverall();
      }

      // 音素字典：随包写入（HF 的大文件在大陆连不上，见 bundledDict.ts）
      await writeBundledDict(this.getFilePath(TTS_DICT_FILENAME));
      perFileProgress[allFiles.length] = 1;
      reportOverall();

      // 第 2 阶段：把音色嵌入也下到本地（best-effort）
      await this.downloadVoices(modelDir);

      if (onProgress) {
        onProgress(1);
      }
    } catch (err) {
      try {
        if (await RNFS.exists(modelDir)) {
          await RNFS.unlink(modelDir);
        }
      } catch (cleanupErr) {
        console.warn(
          '[KittenEngine] partial-download cleanup failed:',
          cleanupErr,
        );
      }
      throw err;
    }
  }

  /**
   * 把 manifest 里列出的音色嵌入下到 `<modelDir>/voices/`。
   *
   * 【为什么必须这样做】
   * manifest 里写的是「音色从哪个 baseUrl 现取」，而 Kitten 的 manifest 是
   * 从 HF 直接下下来的文件，baseUrl 写死了 huggingface.co。库在首次播放时
   * 会用 fetch 去取 —— **fetch 没有超时**，在连不上 HF 的网络里会一直挂着，
   * 表现为「点了试听没有任何反应、状态一直停在播放中」。
   * 库的逻辑是**先找 `<modelDir>/voices/<id>.json`**，找不到才联网，
   * 所以提前把它们下好就完全不需要网络，也不用去改 manifest 里的域名。
   *
   * 已经存在的文件会跳过 —— 因此 `loadInto()` 里调用它是近乎零成本的补漏。
   */
  private async downloadVoices(modelDir: string): Promise<void> {
    const manifestPath = `${modelDir}/${KITTEN_VOICES_MANIFEST_FILENAME}`;
    try {
      if (!(await RNFS.exists(manifestPath))) {
        return;
      }
      const manifest = JSON.parse(await RNFS.readFile(manifestPath, 'utf8'));
      const base: string =
        manifest?.baseUrl ?? `${KITTEN_MODEL_BASE_URL}/voices`;
      const voiceIds: string[] = Array.isArray(manifest?.voices)
        ? manifest.voices
        : [];
      if (voiceIds.length === 0) {
        return;
      }
      const voicesDir = `${modelDir}/voices`;
      await RNFS.mkdir(voicesDir, {NSURLIsExcludedFromBackupKey: true});

      for (const id of voiceIds) {
        const target = `${voicesDir}/${id}.json`;
        try {
          if (await RNFS.exists(target)) {
            continue;
          }
          const result = await downloadTtsFile({
            fromUrl: `${base}/${id}.json`,
            toFile: target,
            background: false,
            discretionary: false,
            cacheable: false,
            progressInterval: 1000,
          });
          if (result.statusCode !== 200) {
            console.warn(
              `[KittenEngine] voice ${id} download failed: HTTP ${result.statusCode}`,
            );
          }
        } catch (voiceErr) {
          // 单个音色失败不影响整体：库里还留了联网兜底
          console.warn(`[KittenEngine] voice ${id} download failed:`, voiceErr);
        }
      }
    } catch (err) {
      console.warn('[KittenEngine] downloadVoices failed:', err);
    }
  }

  async deleteModel(): Promise<void> {
    try {
      if (await RNFS.exists(this.getModelPath())) {
        await RNFS.unlink(this.getModelPath());
      }
    } catch (err) {
      console.warn('[KittenEngine] deleteModel failed:', err);
    }
  }

  async loadInto(): Promise<void> {
    const modelDir = this.getModelPath();
    // 补下缺失的音色文件：老版本装下来的 Kitten 只下了 manifest，
    // 音色是首播时现取的 —— 连不上 HF 就会一直挂着。这一步让它自愈。
    await this.downloadVoices(modelDir);
    await Speech.initialize({
      engine: TTSEngine.KITTEN,
      modelPath: `file://${modelDir}/kitten.onnx`,
      voicesPath: `file://${modelDir}/voices-manifest.json`,
      dictPath: `file://${modelDir}/${TTS_DICT_FILENAME}`,
      executionProviders: ['cpu'],
      maxChunkSize: 200,
      silentMode: 'obey',
      ducking: true,
    });
  }

  async play(text: string, voice: Voice): Promise<void> {
    if (!(await this.isInstalled())) {
      throw new Error('Kitten model is not installed');
    }
    await ttsRuntime.acquire(this, () => Speech.speak(text, voice.id));
  }

  playStreaming(
    voice: Voice,
    waitFor?: Promise<void>,
    opts?: StreamingOptions,
  ): StreamingHandle {
    return createEngineStreamingHandle(
      this,
      voice.id,
      opts?.onError ? {onError: opts.onError} : undefined,
      waitFor,
    );
  }

  async stop(): Promise<void> {
    await Speech.stop();
  }
}
