import {makeAutoObservable, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import * as RNFS from '@dr.pogodin/react-native-fs';

/**
 * 图像生成 store。
 *
 * 【它是真的在出图】
 * 走标准的 Stable Diffusion WebUI（Automatic1111 / SD.Next / Forge）HTTP API：
 *   POST {serverUrl}/sdapi/v1/txt2img
 * 服务可以架在你自己电脑上（同一个 Wi-Fi 就能连），也可以架在服务器上。
 * 返回的 images[0] 是 base64 PNG，直接拼成 data URI 就能显示。
 *
 * 【为什么不做纯本地】
 * 本项目只有 llama.cpp（跑文字），llama.cpp 跑不了扩散模型 —— 两者网络结构完全不同。
 * 手机上真正本地出图需要移植一整套采样器 + VAE + 文本编码器，
 * 还要 1~2GB 的 ONNX 模型，不是这个项目现有能力能覆盖的。
 *
 * 所有可调参数（步数 / 引导 / 种子 / 尺寸 / 采样器 / 批量）都会真的发到服务端，
 * 并且持久化保存，下次打开还在。
 */

export interface GenImage {
  id: string;
  /** data:image/png;base64,... 可直接给 <Image source={{uri}} /> */
  uri: string;
  prompt: string;
  negative: string;
  steps: number;
  guidance: number;
  seed: number;
  width: number;
  height: number;
  sampler: string;
  scheduler: string;
  createdAt: number;
}

/** Automatic1111 常用的采样器名 */
export const SAMPLERS = [
  'Euler a',
  'Euler',
  'DPM++ 2M',
  'DPM++ 2M Karras',
  'DPM++ SDE',
  'DPM++ SDE Karras',
  'DDIM',
  'LMS',
  'Heun',
  'LCM',
  'UniPC',
] as const;

/** A1111 的调度器（scheduler）取值 */
export const SCHEDULERS = [
  'Automatic',
  'Karras',
  'Exponential',
  'SGM Uniform',
] as const;

/** 推理设备（Runtime）。CPU 更省显存但慢，GPU 快但吃显存。 */
export const RUNTIMES = ['CPU', 'GPU'] as const;
export type Runtime = (typeof RUNTIMES)[number];

/**
 * 内置模型目录（SD1.5 系，装机量最大的一批）。
 *
 * 这些名字同时用作 A1111 的 `sd_model_checkpoint`：
 * 生成时通过 `override_settings` 直接切到它，
 * 所以**服务端装了同名权重就能真的切换**。
 */
export interface LocalModel {
  /** 卡片主标题（同时就是 checkpoint 名） */
  name: string;
  /** 一句话中文说明 */
  desc: string;
  /** 权重体积（GB），和参考应用一致按精简版标注 */
  sizeGB: number;
  /** 推荐分辨率区间 */
  resMin: number;
  resMax: number;
  /** 更适合用哪块算力跑 */
  tag: Runtime;
}

export const MODEL_CATALOG: LocalModel[] = [
  {
    name: 'Anything V5.0',
    desc: '动漫图像生成模型',
    sizeGB: 1.2,
    resMin: 128,
    resMax: 512,
    tag: 'CPU',
  },
  {
    name: 'QteaMix',
    desc: '动漫Q版风格模型',
    sizeGB: 1.2,
    resMin: 128,
    resMax: 512,
    tag: 'CPU',
  },
  {
    name: 'Absolute Reality',
    desc: '现实场景生成模型',
    sizeGB: 1.2,
    resMin: 128,
    resMax: 512,
    tag: 'CPU',
  },
  {
    name: 'CuteYukiMix',
    desc: '动漫特化可爱风格',
    sizeGB: 1.2,
    resMin: 128,
    resMax: 512,
    tag: 'CPU',
  },
  {
    name: 'ChilloutMix',
    desc: '人物图像生成模型',
    sizeGB: 1.2,
    resMin: 128,
    resMax: 512,
    tag: 'CPU',
  },
  {
    name: 'DreamShaper',
    desc: '通用创意插画模型',
    sizeGB: 2.0,
    resMin: 256,
    resMax: 768,
    tag: 'GPU',
  },
  {
    name: 'Realistic Vision',
    desc: '写实人像/摄影风',
    sizeGB: 2.0,
    resMin: 256,
    resMax: 768,
    tag: 'GPU',
  },
];

/**
 * 端侧 SD 权重下载源（stable-diffusion.cpp 可直读的单文件 GGUF）。
 *
 * 源：`second-state/stable-diffusion-v1-5-GGUF`（Hugging Face 官方仓库，
 * 与 stable-diffusion.cpp 配套）。国内走 hf-mirror 镜像（稳定、快），
 * 失败再回退 huggingface 直连。Q4_0 最省内存（低/中端），Q8_0 更清晰（高端）。
 */
export interface SdDownloadOption {
  id: string;
  label: string;
  fileName: string;
  sizeGB: number;
  /** 适配的最低设备档位 */
  minTier: 'low' | 'mid' | 'high' | 'flagship';
  url: string;
  fallbackUrl: string;
}

const SD_HF_MIRROR =
  'https://hf-mirror.com/second-state/stable-diffusion-v1-5-GGUF/resolve/main';
const SD_HF_ORIGIN =
  'https://huggingface.co/second-state/stable-diffusion-v1-5-GGUF/resolve/main';

export const SD_DOWNLOAD_CATALOG: SdDownloadOption[] = [
  {
    id: 'sd15-q4_0',
    label: 'SD1.5 · Q4_0（省内存）',
    fileName: 'stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf',
    sizeGB: 1.57,
    minTier: 'low',
    url: `${SD_HF_MIRROR}/stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf`,
    fallbackUrl: `${SD_HF_ORIGIN}/stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf`,
  },
  {
    id: 'sd15-q8_0',
    label: 'SD1.5 · Q8_0（更清晰）',
    fileName: 'stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf',
    sizeGB: 1.76,
    minTier: 'high',
    url: `${SD_HF_MIRROR}/stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf`,
    fallbackUrl: `${SD_HF_ORIGIN}/stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf`,
  },
];

/** 运行位置：云端（电脑/服务器上的 A1111）/ 本机（手机 CPU）。 */
export type GenMode = 'cloud' | 'local';

/** 端侧模型：下载或从文件导入后落在 App 私有目录，路径直接交给 SdGen。 */
export interface LocalSdModel {
  id: string;
  name: string;
  /** 绝对文件路径（不带 file://），传给原生 sd-cli */
  path: string;
  sizeBytes?: number;
  addedAt: number;
}

/** 端侧模型存放目录（App 私有，卸载才清）。 */
export const LOCAL_MODELS_DIR = `${RNFS.DocumentDirectoryPath}/sd-models`;

/** 出厂默认参数：按钮「恢复默认参数」用，也作为各字段初值的唯一来源 */
export const DEFAULT_PARAMS = {
  steps: 20,
  guidance: 7.5,
  seed: -1,
  width: 512,
  height: 512,
  sampler: 'DPM++ 2M',
  scheduler: 'Karras',
  batchSize: 1,
  runtime: 'GPU' as Runtime,
  hiresFix: false,
  hiresScale: 1.5,
  denoise: 0.6,
};

export class ImageGenStore {
  /** 服务地址，例如 http://192.168.1.56:7860 */
  serverUrl = '';

  /**
   * 图像增强专用的「云端服务」地址与密钥（与「生成图片」页的 serverUrl 分开）。
   * 指向任何 A1111/Forge 兼容的云端 SD 服务即可（形如 https://xxx/sdapi/v1/img2img）。
   * 留空则云端增强不可用；不再借用「生成图片」页的本地服务器。
   */
  enhanceCloudUrl = '';
  enhanceCloudKey = '';

  positivePrompt = 'sky, white clouds, ultra-detailed';
  negativePrompt = 'anatomy, low quality, text, watermark';

  // ── 可调参数（都会真的发给服务端）──
  steps = DEFAULT_PARAMS.steps;
  guidance = DEFAULT_PARAMS.guidance;
  /** -1 = 每次随机 */
  seed = DEFAULT_PARAMS.seed;
  width = DEFAULT_PARAMS.width;
  height = DEFAULT_PARAMS.height;
  sampler: string = DEFAULT_PARAMS.sampler;
  /** A1111 的采样调度器，和 sampler 是两回事，会一起发 */
  scheduler: string = DEFAULT_PARAMS.scheduler;
  batchSize = DEFAULT_PARAMS.batchSize;
  /** 当前选中的模型（= checkpoint 名）。空串表示用服务端当前模型 */
  modelName = '';
  runtime: Runtime = DEFAULT_PARAMS.runtime;
  /** 高清修复：开启后 denoise 才真正生效 */
  hiresFix = DEFAULT_PARAMS.hiresFix;
  hiresScale = DEFAULT_PARAMS.hiresScale;
  /** 去噪强度 0~1，配合高清修复使用 */
  denoise = DEFAULT_PARAMS.denoise;

  // ── 运行态 ──
  isGenerating = false;
  error: string | null = null;
  /** 进度文案（服务端是同步接口，这里只显示阶段） */
  status = '';
  /** 最近一次生成成功的时间，用于触发界面刷新 */
  lastOkAt = 0;
  /** 从服务端读回来的 checkpoint 列表（用于判断本地目录里的模型服务端是否装了） */
  serverModels: string[] = [];
  isLoadingModels = false;
  /** 最近一次「用某个模型成功出图」的模型名 —— 这是「确实能用」的最硬证据 */
  readyModelName = '';

  // ── 运行位置（云端 / 本机）──
  /** 当前出图走哪边：cloud = 服务端 A1111，local = 手机 CPU */
  mode: GenMode = 'cloud';

  // ── 本机模型 ──
  /** 已下载/导入到手机上的模型（落 App 私有目录） */
  localModels: LocalSdModel[] = [];
  /** 当前选中的本机模型 id */
  localModelId = '';
  /** 图像增强（超分）上次选中的模型 id：重开页面时默认回到它 */
  enhanceSrModelId = '';
  /** 本机模型下载状态 */
  downloadingLocal = false;
  /** 下载进度 0~1 */
  downloadProgress = 0;
  /** 正在下载的文件名 */
  downloadName = '';
  /** 服务器没回 Content-Length 时拿不到百分比，进度条转不确定态 */
  downloadIndeterminate = false;

  // ── 云端自动检测 ──
  /** 正在探测服务端模型列表 */
  cloudDetecting = false;
  /** 最近一次自动检测的错误（空串表示没问题） */
  cloudDetectError = '';
  /** 最近一次检测成功的时间戳 */
  cloudDetectedAt = 0;

  /** 生成历史（新的在前），最多留 30 张 */
  history: GenImage[] = [];

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'ImageGenStore',
      properties: [
        'serverUrl',
        'enhanceCloudUrl',
        'enhanceCloudKey',
        'positivePrompt',
        'negativePrompt',
        'steps',
        'guidance',
        'seed',
        'width',
        'height',
        'sampler',
        'scheduler',
        'batchSize',
        'modelName',
        'runtime',
        'hiresFix',
        'hiresScale',
        'denoise',
        'history',
        'mode',
        'localModels',
        'localModelId',
        'enhanceSrModelId',
      ],
      storage: AsyncStorage,
    });
  }

  setServerUrl(v: string) {
    runInAction(() => {
      this.serverUrl = v.trim();
    });
  }
  setEnhanceCloudUrl(v: string) {
    runInAction(() => {
      this.enhanceCloudUrl = v.trim();
    });
  }
  setEnhanceCloudKey(v: string) {
    runInAction(() => {
      this.enhanceCloudKey = v.trim();
    });
  }
  /** 记住图像增强上次选中的超分模型（重开页面默认回到它） */
  setEnhanceSrModelId(id: string) {
    if (this.enhanceSrModelId !== id) {
      runInAction(() => {
        this.enhanceSrModelId = id;
      });
    }
  }
  setPositivePrompt(v: string) {
    runInAction(() => {
      this.positivePrompt = v;
    });
  }
  setNegativePrompt(v: string) {
    runInAction(() => {
      this.negativePrompt = v;
    });
  }
  setSteps(v: number) {
    runInAction(() => {
      this.steps = Math.max(1, Math.min(150, Math.round(v)));
    });
  }
  setGuidance(v: number) {
    runInAction(() => {
      this.guidance = Math.max(1, Math.min(30, v));
    });
  }
  setSeed(v: number) {
    runInAction(() => {
      this.seed = Math.round(v);
    });
  }
  setSize(w: number, h: number) {
    runInAction(() => {
      this.width = Math.max(64, Math.min(2048, Math.round(w / 64) * 64));
      this.height = Math.max(64, Math.min(2048, Math.round(h / 64) * 64));
    });
  }
  setSampler(v: string) {
    runInAction(() => {
      this.sampler = v;
    });
  }
  setScheduler(v: string) {
    runInAction(() => {
      this.scheduler = v;
    });
  }
  setBatchSize(v: number) {
    runInAction(() => {
      // A1111 的 batch_size 上限一般给到 8，之前卡在 4 太保守
      this.batchSize = Math.max(1, Math.min(8, Math.round(v)));
    });
  }
  setModel(name: string) {
    runInAction(() => {
      this.modelName = name;
    });
  }
  setRuntime(v: Runtime) {
    runInAction(() => {
      this.runtime = v;
    });
  }
  setHiresFix(v: boolean) {
    runInAction(() => {
      this.hiresFix = v;
    });
  }
  setHiresScale(v: number) {
    runInAction(() => {
      this.hiresScale = Math.max(1, Math.min(2, Number(v.toFixed(2))));
    });
  }
  setDenoise(v: number) {
    runInAction(() => {
      this.denoise = Math.max(0, Math.min(1, Number(v.toFixed(2))));
    });
  }

  // ── 运行位置 ────────────────────────────────────────────────
  setMode(m: GenMode) {
    runInAction(() => {
      this.mode = m;
      this.error = null;
    });
  }

  /** 云端是否「填了地址 + 探测成功过」 */
  get cloudReady(): boolean {
    return !!this.serverUrl.trim() && this.serverModels.length > 0;
  }

  // ── 本机模型 ────────────────────────────────────────────────
  /** 当前选中的本机模型（没选过就取第一个） */
  get activeLocalModel(): LocalSdModel | undefined {
    return (
      this.localModels.find(m => m.id === this.localModelId) ??
      this.localModels[0]
    );
  }

  get localReady(): boolean {
    return !!this.activeLocalModel;
  }

  setLocalModel(id: string) {
    runInAction(() => {
      this.localModelId = id;
    });
  }

  removeLocalModel(id: string) {
    const target = this.localModels.find(m => m.id === id);
    runInAction(() => {
      this.localModels = this.localModels.filter(m => m.id !== id);
      if (this.localModelId === id) {
        this.localModelId = this.localModels[0]?.id ?? '';
      }
    });
    // 顺手删掉磁盘上的权重，避免白占几个 GB
    if (target) {
      RNFS.unlink(target.path).catch(() => {
        // 文件可能被占用或已被用户手动删掉。列表已移除，但要让用户知道
        // 磁盘上可能还有残留，不能完全静默。
        runInAction(() => {
          this.error =
            '模型已从列表移除，但磁盘文件删除失败（可能正被占用），可稍后到系统存储设置里清理';
        });
      });
    }
  }

  /** 文件名清洗：去掉路径分隔符与非法字符，强制 .gguf 结尾 */
  private normalizeModelFileName(raw: string): string {
    const base = (raw || 'model')
      .split(/[\\/]/)
      .pop()!
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const named = base || `sd-model-${Date.now()}`;
    return /\.gguf$/i.test(named) ? named : `${named}.gguf`;
  }

  private async ensureModelsDir(): Promise<string> {
    if (!(await RNFS.exists(LOCAL_MODELS_DIR))) {
      await RNFS.mkdir(LOCAL_MODELS_DIR);
    }
    return LOCAL_MODELS_DIR;
  }

  private async registerLocalFile(
    dest: string,
    displayName: string,
  ): Promise<LocalSdModel> {
    let sizeBytes: number | undefined;
    try {
      const st = await RNFS.stat(dest);
      sizeBytes = Number(st.size) || undefined;
    } catch {
      sizeBytes = undefined;
    }
    const model: LocalSdModel = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: displayName,
      path: dest,
      sizeBytes,
      addedAt: Date.now(),
    };
    runInAction(() => {
      // 同一路径只保留一条（重复下载覆盖时替换而不是累加）
      this.localModels = [
        model,
        ...this.localModels.filter(m => m.path !== dest),
      ];
      this.localModelId = model.id;
    });
    return model;
  }

  /**
   * 下载一个端侧模型到 App 私有目录。
   * 直链即可（Hugging Face resolve 链接、镜像链接都行）。
   */
  async downloadLocalModel(
    url: string,
    name?: string,
  ): Promise<LocalSdModel | null> {
    if (this.downloadingLocal) {
      return null;
    }
    const from = url.trim();
    if (!/^https?:\/\//i.test(from)) {
      runInAction(() => {
        this.error = '请填写 http(s) 开头的模型直链';
      });
      return null;
    }
    const fileName = this.normalizeModelFileName(
      name || decodeURIComponent(from.split('?')[0].split('/').pop() || ''),
    );
    try {
      const dir = await this.ensureModelsDir();
      const dest = `${dir}/${fileName}`;
      // 先清掉同名半截文件，避免下载失败后残留被当成可用模型
      if (await RNFS.exists(dest)) {
        await RNFS.unlink(dest);
      }
      runInAction(() => {
        this.downloadingLocal = true;
        this.downloadProgress = 0;
        this.downloadName = fileName;
        this.downloadIndeterminate = false;
        this.error = null;
      });

      const task = RNFS.downloadFile({
        fromUrl: from,
        toFile: dest,
        progressInterval: 500,
        progressDivider: 2,
        progress: p => {
          if (p.contentLength > 0) {
            const ratio = p.bytesWritten / p.contentLength;
            runInAction(() => {
              this.downloadIndeterminate = false;
              // 留 1% 给「落盘 + 校验」，避免进度条到 100% 却还在等
              this.downloadProgress = Math.max(0, Math.min(0.99, ratio));
            });
          } else {
            // 服务器没回 Content-Length：切到不确定态，UI 上转圈而不是假 0%
            runInAction(() => {
              this.downloadIndeterminate = true;
            });
          }
        },
      });
      const res = await task.promise;
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        throw new Error(`HTTP ${res.statusCode}`);
      }

      const displayName = fileName.replace(/\.gguf$/i, '');
      const model = await this.registerLocalFile(dest, displayName);
      runInAction(() => {
        this.downloadingLocal = false;
        this.downloadProgress = 1;
        this.downloadName = '';
        this.downloadIndeterminate = false;
      });
      return model;
    } catch (e: any) {
      runInAction(() => {
        this.downloadingLocal = false;
        this.downloadProgress = 0;
        this.downloadName = '';
        this.downloadIndeterminate = false;
        this.error = `模型下载失败：${e?.message ?? String(e)}`;
      });
      return null;
    }
  }

  /**
   * 按设备档位挑一个「适配本机」的 SD 权重：
   * 低/中端 → Q4_0（省内存），高端/旗舰 → Q8_0（更清晰）。缺省按 mid。
   */
  recommendedSdDownload(
    tier?: 'low' | 'mid' | 'high' | 'flagship',
  ): SdDownloadOption {
    const t = tier ?? 'mid';
    return t === 'high' || t === 'flagship'
      ? SD_DOWNLOAD_CATALOG[1]!
      : SD_DOWNLOAD_CATALOG[0]!;
  }

  /** 一键下载「适配本机」的 SD 权重（镜像失败自动回退 HF 直连）。 */
  async downloadRecommendedModel(
    tier?: 'low' | 'mid' | 'high' | 'flagship',
  ): Promise<LocalSdModel | null> {
    const opt = this.recommendedSdDownload(tier);
    let model = await this.downloadLocalModel(opt.url, opt.fileName);
    if (!model && opt.fallbackUrl) {
      model = await this.downloadLocalModel(opt.fallbackUrl, opt.fileName);
    }
    return model;
  }

  /** 从本机文件导入一个 .gguf（复制到私有目录，原文件不动） */
  async importLocalModel(
    uri: string,
    name?: string,
  ): Promise<LocalSdModel | null> {
    try {
      const dir = await this.ensureModelsDir();
      const fileName = this.normalizeModelFileName(
        name || uri.split('/').pop() || '',
      );
      const dest = `${dir}/${fileName}`;
      await RNFS.copyFile(uri, dest);
      const model = await this.registerLocalFile(
        dest,
        fileName.replace(/\.gguf$/i, ''),
      );
      return model;
    } catch (e: any) {
      runInAction(() => {
        this.error = `模型导入失败：${e?.message ?? String(e)}`;
      });
      return null;
    }
  }

  /**
   * 云端自动检测：连上服务端后把可用的 checkpoint 拉回来。
   *
   * 触发点：进入页面（已有地址）、测试连接成功、手动「重新检测」。
   * 没选模型时自动选第一个；已选但服务端没有这个权重时也切到第一个，
   * 免得用户对着一个「服务端没有」的名字反复点生成。
   */
  async detectCloudModels(): Promise<boolean> {
    if (this.cloudDetecting) {
      return false;
    }
    if (!this.serverUrl.trim()) {
      runInAction(() => {
        this.cloudDetectError = '还没填服务地址';
        this.serverModels = [];
        this.cloudDetectedAt = 0;
      });
      return false;
    }
    runInAction(() => {
      this.cloudDetecting = true;
      this.cloudDetectError = '';
    });
    const r = await this.probe();
    runInAction(() => {
      this.cloudDetecting = false;
      if (!r.ok) {
        this.serverModels = [];
        this.cloudDetectedAt = 0;
        this.cloudDetectError = r.message ?? '连接失败';
        return;
      }
      this.serverModels = r.models ?? [];
      this.cloudDetectedAt = Date.now();
      this.cloudDetectError = '';
      if (this.serverModels.length === 0) {
        return;
      }
      if (!this.modelName || !this.serverHasModel(this.modelName)) {
        this.modelName = this.serverModels[0];
      }
    });
    return r.ok;
  }

  /** 服务端是否装了某个 checkpoint（名字可能带 / 子目录，做宽松匹配） */
  serverHasModel(name: string): boolean {
    if (!name) {
      return false;
    }
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/\.(safetensors|ckpt)$/, '')
        .trim();
    const target = norm(name);
    return this.serverModels.some(m => {
      const n = norm(m);
      // 服务端返回的常常是 "anything-v5" 这种，去空格/连字符后再比一次
      return (
        n === target ||
        n.replace(/[\s_-]/g, '') === target.replace(/[\s_-]/g, '')
      );
    });
  }

  /**
   * 模型是否「已就绪、可正常使用」—— 只有它为 true，
   * 「若使用本地模型，请点击加载模型」那句提示才会消失。
   *
   * 判定要求同时满足「选了模型」+ 下面任一条：
   *   1. 这个模型本会话已经成功出过图（最硬的证据）；
   *   2. 从服务端读回的权重列表里确实有这个模型（说明服务端装了）。
   * 两条都不满足（没选 / 服务端没这个权重 / 还没读到列表）→ 一律视为未就绪。
   */
  get modelReady(): boolean {
    if (!this.modelName) {
      return false;
    }
    if (this.readyModelName && this.readyModelName === this.modelName) {
      return true;
    }
    return this.serverHasModel(this.modelName);
  }

  /** 从服务端读 checkpoint 列表（供模型选择页显示真实可用项） */
  async loadServerModels(): Promise<boolean> {
    if (this.isLoadingModels) {
      return false;
    }
    runInAction(() => {
      this.isLoadingModels = true;
    });
    try {
      const r = await this.probe();
      runInAction(() => {
        this.serverModels = r.models ?? [];
        this.isLoadingModels = false;
      });
      return r.ok;
    } catch {
      runInAction(() => {
        this.isLoadingModels = false;
      });
      return false;
    }
  }

  /** 把参数恢复成出厂默认（不动服务地址、提示词和当前模型） */
  resetParams() {
    runInAction(() => {
      this.steps = DEFAULT_PARAMS.steps;
      this.guidance = DEFAULT_PARAMS.guidance;
      this.seed = DEFAULT_PARAMS.seed;
      this.width = DEFAULT_PARAMS.width;
      this.height = DEFAULT_PARAMS.height;
      this.sampler = DEFAULT_PARAMS.sampler;
      this.scheduler = DEFAULT_PARAMS.scheduler;
      this.batchSize = DEFAULT_PARAMS.batchSize;
      this.runtime = DEFAULT_PARAMS.runtime;
      this.hiresFix = DEFAULT_PARAMS.hiresFix;
      this.hiresScale = DEFAULT_PARAMS.hiresScale;
      this.denoise = DEFAULT_PARAMS.denoise;
    });
  }

  clearHistory() {
    runInAction(() => {
      this.history = [];
    });
  }

  /**
   * 真的发一次请求去出图。
   * 成功返回第一张图；失败把原因写进 this.error。
   */
  async generate(): Promise<GenImage | null> {
    if (this.isGenerating) {
      return null;
    }
    if (!this.positivePrompt.trim()) {
      runInAction(() => {
        this.error = '请先填写正向提示词';
      });
      return null;
    }
    if (!this.serverUrl.trim()) {
      runInAction(() => {
        this.error = '请先填写服务地址，例如 http://192.168.1.56:7860';
      });
      return null;
    }

    const base = this.serverUrl.replace(/\/+$/, '');
    runInAction(() => {
      this.isGenerating = true;
      this.error = null;
      this.status = '正在请求服务端…';
    });

    try {
      const res = await axios.post(
        `${base}/sdapi/v1/txt2img`,
        {
          prompt: this.positivePrompt,
          negative_prompt: this.negativePrompt,
          steps: this.steps,
          cfg_scale: this.guidance,
          seed: this.seed,
          width: this.width,
          height: this.height,
          sampler_name: this.sampler,
          scheduler: this.scheduler,
          batch_size: this.batchSize,
          // 选了具体模型就通过 override_settings 切过去（A1111 的原生做法）
          ...(this.modelName
            ? {override_settings: {sd_model_checkpoint: this.modelName}}
            : {}),
          // 高清修复：打开后 denoising_strength 才真正参与计算
          ...(this.hiresFix
            ? {
                enable_hr: true,
                hr_scale: this.hiresScale,
                hr_upscaler: 'Latent',
                denoising_strength: this.denoise,
              }
            : {}),
        },
        {timeout: 300000},
      );

      const b64: string | undefined = res?.data?.images?.[0];
      if (!b64) {
        throw new Error('服务端没有返回图像');
      }

      runInAction(() => {
        this.status = '正在解码图像…';
      });

      // 服务端可能已经把 seed 定下来了，用 info 里的实际值回填
      let usedSeed = this.seed;
      try {
        const info = JSON.parse(res?.data?.info ?? '{}');
        if (typeof info?.seed === 'number') {
          usedSeed = info.seed;
        }
      } catch {
        // info 不是合法 JSON 就算了，不影响出图
      }

      const item: GenImage = {
        id: `${Date.now()}`,
        uri: `data:image/png;base64,${b64}`,
        prompt: this.positivePrompt,
        negative: this.negativePrompt,
        steps: this.steps,
        guidance: this.guidance,
        seed: usedSeed,
        width: this.width,
        height: this.height,
        sampler: this.sampler,
        scheduler: this.scheduler,
        createdAt: Date.now(),
      };

      runInAction(() => {
        this.history = [item, ...this.history].slice(0, 30);
        this.lastOkAt = Date.now();
        // 出图成功 = 这次用的模型确实能用，记下来
        this.readyModelName = this.modelName;
        this.status = '';
        this.isGenerating = false;
      });
      return item;
    } catch (e: any) {
      const msg =
        e?.response?.status != null
          ? `服务端返回 ${e.response.status}（检查地址和模型是否已加载）`
          : e?.code === 'ECONNABORTED'
            ? '请求超时。大尺寸 / 高步数会比较慢，可先降低再试'
            : e?.message?.includes('Network')
              ? '连不上服务端。确认电脑和手机在同一个 Wi-Fi，且服务监听了 0.0.0.0'
              : (e?.message ?? '生成失败');
      runInAction(() => {
        this.error = msg;
        this.status = '';
        this.isGenerating = false;
      });
      return null;
    }
  }

  /**
   * 图像增强（云端）：走 SD WebUI 的 img2img。
   * denoising_strength 越低 = 只做轻微重绘/增强；越高 = 改写幅度更大。
   * 返回可直接显示的 data URI。
   */
  async enhanceImg2Img(
    base64: string,
    opts: {denoise: number; prompt?: string; width?: number; height?: number},
    override?: {baseUrl?: string; apiKey?: string},
  ): Promise<string | null> {
    if (this.isGenerating) {
      return null;
    }
    const rawBase = (override?.baseUrl ?? this.serverUrl).trim();
    if (!rawBase) {
      runInAction(() => {
        this.error = '请先填写云端服务地址';
      });
      return null;
    }
    // 允许传完整端点（…/sdapi/v1/img2img）或只传主机（自动补路径）
    const base = rawBase.replace(/\/+$/, '');
    const endpoint = /\/img2img\/?$/.test(base)
      ? base
      : `${base}/sdapi/v1/img2img`;
    const apiKey = override?.apiKey?.trim();
    runInAction(() => {
      this.isGenerating = true;
      this.error = null;
      this.status = '正在请求云端服务…';
    });
    try {
      const res = await axios.post(
        endpoint,
        {
          init_images: [base64],
          prompt:
            opts.prompt ?? 'high quality, sharp, detailed, 4k, best quality',
          negative_prompt: this.negativePrompt,
          denoising_strength: opts.denoise,
          steps: Math.max(12, Math.min(40, this.steps)),
          cfg_scale: this.guidance,
          sampler_name: this.sampler,
          scheduler: this.scheduler,
          ...(opts.width && opts.height
            ? {width: opts.width, height: opts.height}
            : {}),
          ...(this.modelName
            ? {override_settings: {sd_model_checkpoint: this.modelName}}
            : {}),
        },
        {
          timeout: 300000,
          ...(apiKey ? {headers: {Authorization: `Bearer ${apiKey}`}} : {}),
        },
      );
      const b64: string | undefined = res?.data?.images?.[0];
      if (!b64) {
        throw new Error('服务端没有返回图像');
      }
      runInAction(() => {
        this.status = '';
        this.isGenerating = false;
      });
      return `data:image/png;base64,${b64}`;
    } catch (e: any) {
      const msg =
        e?.response?.status != null
          ? `服务端返回 ${e.response.status}（检查地址和模型是否已加载）`
          : e?.code === 'ECONNABORTED'
            ? '请求超时，可先降低强度再试'
            : e?.message?.includes('Network')
              ? '连不上服务端。确认手机与电脑在同一 Wi-Fi'
              : (e?.message ?? '增强失败');
      runInAction(() => {
        this.error = msg;
        this.status = '';
        this.isGenerating = false;
      });
      return null;
    }
  }

  /** 探一下服务端在不在，返回可用的模型名列表 */
  async probe(): Promise<{ok: boolean; models?: string[]; message?: string}> {
    const base = this.serverUrl.replace(/\/+$/, '');
    if (!base) {
      return {ok: false, message: '还没填服务地址'};
    }
    try {
      const res = await axios.get(`${base}/sdapi/v1/sd-models`, {
        timeout: 15000,
      });
      const models = Array.isArray(res.data)
        ? res.data.map((m: any) => m?.model_name ?? m?.title).filter(Boolean)
        : [];
      return {ok: true, models};
    } catch (e: any) {
      return {ok: false, message: e?.message ?? '连接失败'};
    }
  }
}

export const imageGenStore = new ImageGenStore();
