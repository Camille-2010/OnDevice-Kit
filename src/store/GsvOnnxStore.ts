import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

import * as RNFS from '@dr.pogodin/react-native-fs';

import {
  assessDevicePerf,
  PerfAssessment,
  RtfMeasurement,
  tierFromRtf,
} from '../services/gptsovits/devicePerf';
import {base64ToBytes} from '../services/audio/wavPlayback';
import {playPcm32k, stopPcmPlayback} from '../services/gsv/onnx/wavOut';
import {rnOrtAdapter} from '../services/gsv/onnx/rnAdapter';
import {GsvPipeline, parseGsvPack} from '../services/gsv/onnx/gsvPipeline';
import {parseVocab} from '../services/gsv/onnx/wordpiece';
import {
  GSV_DEFAULT_ROLE,
  GSV_ONNX_FILES,
  allModelsPresent,
  deleteModels,
  downloadModels,
  ensureBundledAssets,
  gsvModelPath,
  gsvPackDir,
  gsvRootDir,
  importModelsFromDownloads,
  statOnnxFiles,
  type GsvFileInfo,
} from '../services/gsv/onnx/gsvFiles';

/**
 * 端侧 GPT-SoVITS（ONNX）引擎 store。
 *
 * 与云端 api_v2 那套（GptSovitsStore）互不依赖：这里的一切都在手机本地，
 * 模型从电脑局域网拉一次（或 USB 拷到 Download 目录导入），之后完全离线。
 * 默认角色「阿罗娜」的角色包（预计算特征 + 参考音频）随 APK 自带，
 * 权重文件（约 1GB）因体积只能走导入/下载。
 */
export class GsvOnnxStore {
  // ── 配置（持久化） ──
  baseUrl = '';
  speed = 1;
  lastText = '老师，欢迎回来！今天由阿罗娜来为你导航哦。';

  // ── 运行态 ──
  role = GSV_DEFAULT_ROLE;
  assetsReady = false;
  modelInfos: GsvFileInfo[] = [];
  loading = false;
  loaded = false;
  synthesizing = false;
  /** 生成进度（语义 token 数，粗略） */
  progressTokens = 0;
  error: string | null = null;
  logs: string[] = [];
  downloadActive = false;
  downloadFile = '';
  downloadRatio = 0;
  /** 设备性能预判 / RTF 实测 */
  perf: PerfAssessment | null = null;
  rtf: RtfMeasurement | null = null;
  /** 最近一次合成的音频时长 ms（算 RTF 用） */
  lastAudioMs: number | null = null;

  private pipeline: GsvPipeline | null = null;
  private downloadId = 0;

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'GsvOnnxStore',
      properties: ['baseUrl', 'speed', 'lastText'],
      storage: AsyncStorage,
    });
  }

  get verdict(): PerfAssessment | null {
    return this.perf;
  }

  get verdictText(): string {
    if (this.rtf) {
      const tier = tierFromRtf(this.rtf.rtf);
      const label =
        tier === 'fast'
          ? '流畅'
          : tier === 'usable'
            ? '可用（需等待）'
            : '偏慢';
      return `实测 RTF ${this.rtf.rtf.toFixed(2)}（${label}）`;
    }
    return this.perf?.verdict ?? '尚未评估';
  }

  log(msg: string): void {
    const ts = new Date().toLocaleTimeString('zh-CN', {hour12: false});
    this.logs = [`[${ts}] ${msg}`, ...this.logs].slice(0, 80);
  }

  setBaseUrl(v: string): void {
    this.baseUrl = v;
  }
  setSpeed(v: number): void {
    this.speed = v;
  }
  setLastText(v: string): void {
    this.lastText = v;
  }

  async refreshPerf(): Promise<void> {
    try {
      const p = await assessDevicePerf();
      runInAction(() => {
        this.perf = p;
      });
    } catch {
      // non-fatal
    }
  }

  /** Screen entry: copy bundled assets, stat model files, refresh perf. */
  async initialize(): Promise<void> {
    try {
      await ensureBundledAssets(this.role);
      const infos = await statOnnxFiles();
      runInAction(() => {
        this.assetsReady = true;
        this.modelInfos = infos;
      });
    } catch (e) {
      runInAction(() => {
        this.error = `初始化失败：${(e as Error).message}`;
      });
    }
    if (!this.perf) {
      this.refreshPerf();
    }
    // auto-load pipeline when everything is already on disk
    if (await allModelsPresent()) {
      this.loadPipeline();
    }
  }

  refreshModels(): Promise<void> {
    return statOnnxFiles().then(infos =>
      runInAction(() => {
        this.modelInfos = infos;
      }),
    );
  }

  async loadPipeline(): Promise<boolean> {
    if (this.pipeline?.isLoaded) {
      return true;
    }
    if (!(await allModelsPresent())) {
      this.error = '模型文件不完整，请先下载或导入';
      return false;
    }
    runInAction(() => {
      this.loading = true;
      this.error = null;
    });
    this.log('加载 ONNX 模型（约 1GB，首次较慢）…');
    try {
      const [meta, refBert, promptSemantic, referSpec, vocabText] =
        await Promise.all([
          RNFS.readFile(`${gsvPackDir(this.role)}/meta.json`, 'utf8'),
          RNFS.readFile(`${gsvPackDir(this.role)}/ref_bert.bin`, 'base64'),
          RNFS.readFile(
            `${gsvPackDir(this.role)}/prompt_semantic.bin`,
            'base64',
          ),
          RNFS.readFile(`${gsvPackDir(this.role)}/refer_spec.bin`, 'base64'),
          RNFS.readFile(`${gsvRootDir()}/bert-vocab.txt`, 'utf8'),
        ]);
      const pack = parseGsvPack({
        meta,
        refBert: base64ToBytes(refBert),
        promptSemantic: base64ToBytes(promptSemantic),
        referSpec: base64ToBytes(referSpec),
      });
      const pipeline = new GsvPipeline(
        rnOrtAdapter,
        {
          bert: gsvModelPath('bert.onnx'),
          gptEncoder: gsvModelPath('gpt_encoder.onnx'),
          gptStep: gsvModelPath('gpt_step.onnx'),
          sovits: gsvModelPath('sovits.onnx'),
        },
        pack,
        parseVocab(vocabText),
      );
      const t0 = Date.now();
      await pipeline.load();
      this.pipeline = pipeline;
      runInAction(() => {
        this.loading = false;
        this.loaded = true;
      });
      this.log(`模型加载完成（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
      return true;
    } catch (e) {
      runInAction(() => {
        this.loading = false;
        this.loaded = false;
        this.error = `模型加载失败：${(e as Error).message}`;
      });
      this.log(`加载失败：${(e as Error).message}`);
      return false;
    }
  }

  async releasePipeline(): Promise<void> {
    await this.pipeline?.release();
    this.pipeline = null;
    runInAction(() => {
      this.loaded = false;
    });
  }

  async synthesize(): Promise<void> {
    if (this.synthesizing) {
      return;
    }
    if (!this.pipeline?.isLoaded) {
      const ok = await this.loadPipeline();
      if (!ok) {
        return;
      }
    }
    stopPcmPlayback();
    runInAction(() => {
      this.synthesizing = true;
      this.progressTokens = 0;
      this.error = null;
    });
    const text = this.lastText;
    this.log(`合成：${text.slice(0, 24)}${text.length > 24 ? '…' : ''}`);
    try {
      const pipeline = this.pipeline!;
      const result = await pipeline.synthesize(text, {
        speed: this.speed,
        onProgress: tokens =>
          runInAction(() => {
            this.progressTokens = tokens;
          }),
      });
      const audioMs = (result.audio.length / result.sampleRate) * 1000;
      const rtf = result.elapsedMs / audioMs;
      playPcm32k(result.audio);
      runInAction(() => {
        this.synthesizing = false;
        this.rtf = {
          elapsedMs: result.elapsedMs,
          audioMs,
          rtf,
          source: 'local-onnx',
          at: Date.now(),
        };
        this.lastAudioMs = audioMs;
      });
      this.log(
        `完成：${(audioMs / 1000).toFixed(1)}s 音频 / ${result.tokens} tokens / RTF ${rtf.toFixed(2)}`,
      );
    } catch (e) {
      runInAction(() => {
        this.synthesizing = false;
        this.error = (e as Error).message;
      });
      this.log(`合成失败：${(e as Error).message}`);
    }
  }

  async downloadFromUrl(): Promise<void> {
    if (!this.baseUrl.trim() || this.downloadActive) {
      if (!this.baseUrl.trim()) {
        this.error = '请先填写电脑服务地址，如 http://192.168.1.5:8000';
      }
      return;
    }
    const id = ++this.downloadId;
    runInAction(() => {
      this.downloadActive = true;
      this.downloadFile = '';
      this.downloadRatio = 0;
      this.error = null;
    });
    this.log(
      `开始下载模型（${(GSV_ONNX_FILES.reduce((a, f) => a + f.bytes, 0) / 1e9).toFixed(2)} GB）…`,
    );
    try {
      await downloadModels(this.baseUrl, (file, written, total) => {
        if (id !== this.downloadId) {
          return;
        }
        runInAction(() => {
          this.downloadFile = file;
          this.downloadRatio = total > 0 ? written / total : 0;
        });
      });
      await this.refreshModels();
      runInAction(() => {
        this.downloadActive = false;
      });
      this.log('模型下载完成');
    } catch (e) {
      runInAction(() => {
        this.downloadActive = false;
        this.error = `下载失败：${(e as Error).message}`;
      });
      this.log(`下载失败：${(e as Error).message}`);
    }
  }

  cancelDownload(): void {
    this.downloadId++;
    runInAction(() => {
      this.downloadActive = false;
    });
  }

  async importFromDownloads(): Promise<void> {
    runInAction(() => {
      this.error = null;
    });
    try {
      const n = await importModelsFromDownloads(msg => this.log(msg));
      await this.refreshModels();
      this.log(
        n > 0
          ? `从 Download 目录导入 ${n} 个模型文件`
          : 'Download 目录没有找到匹配的模型文件',
      );
      if (n > 0 && (await allModelsPresent())) {
        this.loadPipeline();
      }
    } catch (e) {
      runInAction(() => {
        this.error = `导入失败：${(e as Error).message}`;
      });
    }
  }

  async removeModels(): Promise<void> {
    await this.releasePipeline();
    await deleteModels();
    await this.refreshModels();
    this.log('已删除模型文件');
  }
}

export const gsvOnnxStore = new GsvOnnxStore();
