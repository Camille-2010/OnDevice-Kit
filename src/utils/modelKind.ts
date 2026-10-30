import {Model, ModelType} from './types';

/** 模型种类：文本 / 图像（多模态 LLM）/ 投影（mmproj）/ 语音 */
export type ModelKind = 'text' | 'vision' | 'projection' | 'audio';

/**
 * 投影模型（mmproj）文件名特征。
 * 与 utils/multimodalPatterns.ts 的 MMProjRegex 保持同一套写法，
 * 但这里额外容忍「文件名开头就是 mmproj-」的情况（用户从本地导入时很常见，
 * 没有仓库路径前缀，MMProjRegex 要求 mmproj 前后都有分隔符会漏掉一部分）。
 */
const PROJECTION_FILENAME = /(^|[-_.])mmproj([-_.]|$)/i;

/** GGUF 里代表「视觉编码器」的 architecture */
const PROJECTION_ARCHITECTURES = ['clip', 'siglip', 'vit', 'pixtral'];
/**
 * 从文件名判断是不是投影模型（mmproj）。
 *
 * 本地导入的模型拿不到 HuggingFace 的 specs，只能靠文件名先判一轮；
 * 等 GGUF 头读出来之后再用 architecture 兜底。
 */
export const isProjectionByFilename = (filename?: string): boolean =>
  PROJECTION_FILENAME.test((filename ?? '').split('/').pop() ?? '');

/**
 * 从文件名判断是不是「支持视觉的 LLM」。
 *
 * 覆盖市面上常见的多模态模型命名：Qwen-VL / LLaVA / SmolVLM / MiniCPM-V /
 * InternVL / Phi-3-Vision / Gemma-3（自带视觉）等。带 -VL / -Vision /
 * -v 后缀的对话模型都属于这一类。
 */
export const isVisionLLMByFilename = (filename?: string): boolean => {
  const name = (filename ?? '').split('/').pop() ?? '';
  return (
    /(^|[-_.])(vl|vision|vlm|multimodal|omni)([-_.]|$)/i.test(name) ||
    /(llava|smolvlm|minicpm[-_]?v|internvl|moondream|pixtral|idefics|paligemma)/i.test(
      name,
    )
  );
};

/**
 * GGUF architecture 里代表「语音」的系列。
 *
 * 覆盖 ASR（whisper / mms / sensevoice / moonshine）、TTS（speecht5 /
 * parler / bark / vits / piper / tts 系列）以及通用音频编码器。判断用
 * 「包含匹配」而非精确相等，因为 GGUF 里 architecture 常带后缀，如
 * `whisper`、`mms-300m`、`SenseVoiceSmall`。
 */
const AUDIO_ARCHITECTURES = [
  'whisper',
  'mms',
  'sensevoice',
  'speecht5',
  'speech-t5',
  'parler',
  'bark',
  'piper',
  'vits',
  'tts',
  'wav2vec',
  'moonshine',
  'higgsfield',
  'fish-speech',
];

/** 取模型的 GGUF architecture（优先本地读到的 metadata，其次 HuggingFace 规格） */
export const getModelArchitecture = (model: Model): string =>
  (
    model.ggufMetadata?.architecture ||
    model.hfModel?.specs?.gguf?.architecture ||
    ''
  ).toLowerCase();

/**
 * 从 GGUF architecture 判断是不是投影模型（mmproj 本体）。
 * clip / siglip / vit / pixtral 都是视觉编码器，不是对话模型。
 */
export const isProjectionArch = (arch: string): boolean => {
  const a = (arch || '').toLowerCase();
  if (!a) {
    return false;
  }
  return (
    PROJECTION_ARCHITECTURES.some(p => a.includes(p)) ||
    // llama.cpp 的 mtmd 里，mmproj 有时把 merger 架构直接写进
    // general.architecture（如 qwen3vl_merger），不带 clip/vit 字样。
    a.includes('merger')
  );
};

/**
 * 从 GGUF architecture 判断是不是「自带视觉的多模态 LLM」。
 * 这些是能直接看图的对话模型（Qwen2-VL / InternVL / Gemma-3 等），
 * 仍然需要外接一个 mmproj。
 */
export const isVisionLLMArch = (arch: string): boolean => {
  const a = (arch || '').toLowerCase();
  if (!a || isProjectionArch(a)) {
    return false;
  }
  return /(vl|vision|vlm|omni|llava|internvl|minicpmv|moondream|idefics|paligemma|gemma3)/.test(
    a,
  );
};

/**
 * 判定模型种类。
 *
 * 判据按可信度从高到低：
 *   1. `modelType === PROJECTION` → 投影模型（mmproj）。**这是独立的一类**，
 *      它不是「视觉模型」：它自己不能对话、不能设为主模型，只能绑定给
 *      某个多模态 LLM 当视觉投影。之前把它标成 vision，导致它在视觉模型
 *      列表里被点一下就去setActiveModel → 加载报错。
 *   2. `supportsMultimodal`（加载/导入时探测出来的多模态 LLM）
 *   3. GGUF architecture：clip/siglip/vit → 投影；含 vl/vision → 多模态 LLM
 *   4. 文件名特征（GGUF 头还没读出来时的兜底，读到头之后会被 arch 覆盖）
 */
export const getModelKind = (model: Model): ModelKind => {
  if (model.modelType === ModelType.PROJECTION) {
    return 'projection';
  }
  const arch = getModelArchitecture(model);
  // arch 已经读出来就以它为准 —— 文件名启发式会误伤（比如纯文本模型
  // 文件名里带个 -v 之类），arch 不会。
  if (arch) {
    if (isProjectionArch(arch)) {
      return 'projection';
    }
    if (isVisionLLMArch(arch) || model.supportsMultimodal) {
      return 'vision';
    }
    return AUDIO_ARCHITECTURES.some(p => arch.includes(p)) ? 'audio' : 'text';
  }
  // GGUF 头读出来之前（arch 为空）才用文件名兜底
  if (isProjectionByFilename(model.filename)) {
    return 'projection';
  }
  if (model.supportsMultimodal || isVisionLLMByFilename(model.filename)) {
    return 'vision';
  }
  return 'text';
};

/** 卡片上的中文标注 */
export const MODEL_KIND_LABEL: Record<ModelKind, string> = {
  text: '文本',
  vision: '图像',
  projection: '投影',
  audio: '语音',
};

/** 描述加载方式：n_gpu_layers 表示前 N 层放 GPU，其余留在 CPU */
export const describeOffload = (
  nGpuLayers: number,
  nLayers?: number,
): string => {
  if (nGpuLayers <= 0) {
    return '全部层在 CPU';
  }
  if (!nLayers) {
    return `前 ${nGpuLayers} 层上 GPU，其余在 CPU`;
  }
  const rest = Math.max(nLayers - nGpuLayers, 0);
  return `前 ${nGpuLayers}/${nLayers} 层上 GPU，其余 ${rest} 层在 CPU`;
};
