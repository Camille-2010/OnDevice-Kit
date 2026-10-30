import {DeviceEventEmitter, NativeModules} from 'react-native';

/**
 * 端侧（手机本地）图像生成 —— 原生模块 SdGen 的 JS 桥。
 *
 * sd-cli（stable-diffusion.cpp，OpenCL 构建）随 APK 内置（jniLibs → nativeLibraryDir）。
 * 后端由原生层 auto-fit 自动选：有 OpenCL GPU（Mali/Adreno）走 GPU，没有自动回退 CPU。
 * 实测某骁龙8+机型（Mali-G710）GPU：256×256/4 步 ≈ 73s、512×512/4 步 ≈ 6 分钟；
 * 强制 CPU：256×256/4 步 ≈ 110s。
 * 原生模块见 android/app/src/main/java/com/pocketpalai/SdGenModule.kt。
 */
/** 本地出图后端：gpu（默认）= 自动（OpenCL GPU，无则回退 CPU）；cpu = 强制纯 CPU。 */
export type SdGenBackend = 'gpu' | 'cpu';

type SdGenNative = {
  isReady: (modelPath: string) => Promise<boolean>;
  generate: (
    modelPath: string,
    prompt: string,
    steps: number,
    threads: number,
    width: number,
    height: number,
    backend?: SdGenBackend,
  ) => Promise<string>;
  cancel: () => void;
};

const SdGen: SdGenNative | undefined = (NativeModules as any).SdGen;

/**
 * 兜底默认模型路径。正常情况下 modelPath 一律由调用方传入
 * （ImageGenStore.activeLocalModel.path，位于 App 私有目录 sd-models/）。
 * 旧的手动 adb push 到 /sdcard 的路径在 targetSdk 36 下读不到，不再作为默认。
 */
export const DEFAULT_SD_MODEL = '';

export const sdGenAvailable = (): boolean => !!SdGen;

export const sdGenIsReady = (modelPath = DEFAULT_SD_MODEL): Promise<boolean> =>
  SdGen?.isReady ? SdGen.isReady(modelPath) : Promise.resolve(false);

/** 取消当前正在跑的生成（若有）。 */
export const sdGenCancel = (): void => {
  try {
    SdGen?.cancel?.();
  } catch {
    // ignore
  }
};

export type SdGenStage =
  | 'loading'
  | 'encoding'
  | 'sampling'
  | 'decoding'
  | 'done'
  | 'cancelled';

export interface SdGenProgress {
  stage: SdGenStage;
  message: string;
  /** 当前步（仅 sampling） */
  step?: number;
  /** 总步数（仅 sampling） */
  total?: number;
  /** 每步耗时（秒） */
  sPerIt?: number;
  /** 预计剩余秒数 */
  etaSec?: number;
}

/**
 * 订阅本地生成进度（原生 emitDeviceEvent → DeviceEventEmitter）。
 * 返回取消订阅函数。
 */
export const addSdGenProgressListener = (
  cb: (p: SdGenProgress) => void,
): (() => void) => {
  const sub = DeviceEventEmitter.addListener(
    'SdGenProgress',
    (p: SdGenProgress) => {
      try {
        cb(p);
      } catch {
        // ignore
      }
    },
  );
  return () => sub.remove();
};

/**
 * 本地出图。返回生成图片的 data URI。
 * 取消时 reject 的 code 为 'CANCELLED'（e?.code === 'CANCELLED'）。
 */
export const sdGenGenerate = (
  prompt: string,
  opts?: {
    steps?: number;
    threads?: number;
    width?: number;
    height?: number;
    modelPath?: string;
    /** 后端：gpu（默认，自动）/ cpu（强制纯 CPU） */
    backend?: SdGenBackend;
  },
): Promise<string> => {
  if (!SdGen) {
    return Promise.reject(new Error('本地生成模块不可用（未打包原生模块）'));
  }
  return SdGen.generate(
    opts?.modelPath ?? DEFAULT_SD_MODEL,
    prompt,
    opts?.steps ?? 10,
    opts?.threads ?? 8,
    opts?.width ?? 512,
    opts?.height ?? 512,
    opts?.backend ?? 'gpu',
  );
};
