/**
 * 本地 ONNX 超分模型注册表。
 *
 * 这些模型通过 onnxruntime-react-native 在端侧推理，不依赖云端服务。
 * 模型文件**首次使用时自动下载**到 App 私有目录
 * （`RNFS.DocumentDirectoryPath/superres/`），下载后离线可用。
 *
 * ⚠️ 关键：每个模型都必须声明 `norm`（输入归一化方式）与 `size`（精确字节数）。
 *   · norm 弄错 → 输出会变成「彩虹噪点/花屏」（real-esr-general-x4v3 就是 [0,1]，
 *     不是 Real-ESRGAN 默认的 [-1,1]），已实测确认。
 *   · size 用于识别被截断的下载（GitHub release CDN 在国内经常只下一半就断）。
 */

/** 输入/输出归一化方式（已逐个实测确认，不要凭家族猜）。 */
export type SRNormalization =
  /** [-1, 1]：Real-ESRGAN 的 RRDB 家族（animevideov3 / x4plus / anime_6B） */
  | 'pm1'
  /** [0, 1]：real-esr-general-x4v3、Real-CUGAN、Anime4K */
  | 'zero-one';

export interface SRModel {
  /** 唯一 id，也是会话缓存的键 */
  id: string;
  /** 显示名 */
  label: string;
  /** 模型家族，仅用于展示 */
  family: 'Real-ESRGAN' | 'Real-CUGAN' | 'Anime4K';
  /** 输出倍率（模型固定，UI 不可改） */
  scale: number;
  /** 归一化方式（实测确认） */
  norm: SRNormalization;
  /** 落盘文件名（也是手动导入时的识别名） */
  file: string;
  /** 期望字节数：下载完成后必须完全一致，否则视为失败重下 */
  size?: number;
  /** VSGAN release 内的文件名；有值即走「GitHub 直链 + 国内镜像」下载 */
  vsgan?: string;
  /** 单独的自定义直链（优先生效）；与 vsgan 二选一 */
  url?: string;
  /** 一句话：这个模型是干什么的 */
  desc: string;
  /** 一句话：它强在哪 / 适合什么图 */
  strength: string;
}

/** VSGAN 发布的 ONNX 模型库（Real-ESRGAN / Real-CUGAN 官方导出的集散地）。 */
const VSGAN_BASE =
  'https://github.com/styler00dollar/VSGAN-tensorrt-docker/releases/download/models/';

/**
 * 下载镜像链。GitHub release 的 CDN 在国内容易被截断/超时，
 * 而反代本身也经常「抽风」（例如 ghproxy.net 实测会直接返回 502 / 错误页，
 * 而不是文件），所以这里放一长串、按「当前较稳」排序，下载时逐个轮流试。
 *
 * 排序说明：gh-proxy.com 在实测中最稳，放第一位；ghproxy.net 虽然偶尔 502
 * 但多数时候可用，放第二；其余按历史可用性排序；最后的 '' 是直连
 * （仅对能直连 GitHub 的网络有用，国内基本会超时，但作为兜底保留）。
 */
export const SR_MIRRORS = [
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
  'https://gh.api.99988866.xyz/',
  'https://ghproxy.com/',
  'https://gh.ddlc.top/',
  'https://gh.idayer.com/',
  'https://github.moeyy.xyz/',
  'https://mirror.ghproxy.com/',
  'https://ghproxy.1888866.xyz/',
  'https://sub.ghproxy.com/',
  'https://ghproxy.futils.com/',
  '',
];

/**
 * 「域名替换」型镜像：不是前缀拼接，而是把 github.com 直接换成镜像域名。
 * kgithub.com 是国内常用的 GitHub 镜像站，稳定性通常优于反代。
 */
const SR_DOMAIN_MIRRORS = ['https://kgithub.com'];

/** 某个模型的全部候选下载地址（按优先级）。手动导入型返回空数组。 */
export function modelUrls(m: SRModel): string[] {
  if (m.url) {
    return [m.url];
  }
  if (!m.vsgan) {
    return [];
  }
  const out = SR_MIRRORS.map(prefix => `${prefix}${VSGAN_BASE}${m.vsgan}`);
  // 域名替换型：把 VSGAN_BASE 里的 github.com 换成镜像域名
  for (const d of SR_DOMAIN_MIRRORS) {
    out.push(`${VSGAN_BASE.replace('https://github.com', d)}${m.vsgan}`);
  }
  return out;
}

/**
 * 全部超分模型（定义表，顺序无语义）。
 * 展示顺序见下方 SR_ORDER / SR_MODELS。
 */
const SR_MODELS_RAW: SRModel[] = [
  {
    id: 'realesr-anime-fast',
    label: 'Real-ESRGAN Anime Fast',
    family: 'Real-ESRGAN',
    scale: 4,
    norm: 'pm1',
    file: 'realesr-animevideov3.onnx',
    vsgan: 'realesr-animevideov3.onnx',
    size: 2490781,
    desc: '动画视频帧专用（视频模型，静态图会被抹软），速度快',
    strength: '二次元视频截图、动画逐帧放大；单张插画请改用 CUGAN',
  },
  {
    id: 'realesr-anime-plus',
    label: 'Real-ESRGAN Anime+',
    family: 'Real-ESRGAN',
    scale: 4,
    norm: 'pm1',
    file: 'RealESRGAN_x4plus_anime_6B_opset16.onnx',
    vsgan: 'RealESRGAN_x4plus_anime_6B_opset16.onnx',
    size: 17917189,
    desc: '高质量二次元插画模型（6B 大模型，17.9MB 下载较久），细节最丰富',
    strength: '动漫插画、线条稿、封面图（画质优先、可接受稍慢）',
  },
  {
    id: 'realesr-animevideo-v3',
    label: 'RealESRGAN AnimeVideo-v3',
    family: 'Real-ESRGAN',
    scale: 4,
    norm: 'pm1',
    file: 'realesr-animevideov3.onnx', // 与 Anime Fast 同源，复用同一份下载
    vsgan: 'realesr-animevideov3.onnx',
    size: 2490781,
    desc: '动画视频帧 ×4（与 Anime Fast 同模型，静态图会偏软）',
    strength: '动漫视频 / GIF 逐帧增强；单张插画请改用 CUGAN',
  },
  {
    id: 'realesr-animevideo-x2',
    label: 'RealESRGAN AnimeVideo-v3 ×2',
    family: 'Real-ESRGAN',
    scale: 2,
    norm: 'pm1',
    file: 'RealESRGANv2-animevideo-xsx2_opset16.onnx',
    vsgan: 'RealESRGANv2-animevideo-xsx2_opset16.onnx',
    size: 2408780,
    desc: '动画视频帧 ×2 专用（xsx2 小模型），速度最快',
    strength: '动漫视频/GIF 只需 2× 时用（省内存、帧间最稳）',
  },
  {
    id: 'realesr-general-x4v3',
    label: 'Real-ESRGAN general-x4v3',
    family: 'Real-ESRGAN',
    scale: 4,
    norm: 'zero-one', // ⚠️ 实测：这个导出要 [0,1]，喂 [-1,1] 会花屏
    file: 'realesr-general-wdn-x4v3_opset16.onnx',
    vsgan: 'realesr-general-wdn-x4v3_opset16.onnx',
    size: 4864534,
    desc: '通用照片/截图 4×，带轻度降噪',
    strength: '老照片、JPEG 压缩图、游戏/应用截图（最接近「真实照片修复」）',
  },
  {
    id: 'animejanai-2x-compact',
    label: 'Anime 轻量 2× (AnimeJaNai)',
    family: 'Anime4K',
    scale: 2,
    norm: 'zero-one',
    file: '2x_AnimeJaNai_V2_SuperUltraCompact_100k_op18_clamp.onnx',
    vsgan: '2x_AnimeJaNai_V2_SuperUltraCompact_100k_op18_clamp.onnx',
    size: 185002,
    desc: '超紧凑动画 2× 模型（185KB），下载秒完成、速度最快（画质一般）',
    strength: '动画截图快速 2× 放大，或网差时应急；追求画质用 CUGAN',
  },
  {
    id: 'cugan-2x-conservative',
    label: 'Real-CUGAN 2x (conservative)',
    family: 'Real-CUGAN',
    scale: 2,
    norm: 'zero-one',
    file: 'cugan_up2x-latest-conservative_op18_clamp.onnx',
    vsgan: 'cugan_up2x-latest-conservative_op18_clamp.onnx',
    size: 5164390,
    desc: '动漫 2× 通用保守版（比 pro 更稳）',
    strength: '二次元图片 2× 放大（通用、稳定）',
  },
  {
    id: 'cugan-pro-x2-conservative',
    label: 'Real-CUGAN pro-x2 (conservative)',
    family: 'Real-CUGAN',
    scale: 2,
    norm: 'zero-one',
    file: 'cugan_pro-conservative-up2x_op18_clamp_colorfix.onnx',
    vsgan: 'cugan_pro-conservative-up2x_op18_clamp_colorfix.onnx',
    size: 5164960,
    desc: '动漫 2× 保守版（pro），尽量保留原画风',
    strength: '二次元图片 2× 放大（保真、伪影少）',
  },
  {
    id: 'cugan-pro-x3-conservative',
    label: 'Real-CUGAN pro-x3 (conservative)',
    family: 'Real-CUGAN',
    scale: 3,
    norm: 'zero-one',
    file: 'cugan_pro-conservative-up3x_op18_clamp_colorfix.onnx',
    vsgan: 'cugan_pro-conservative-up3x_op18_clamp_colorfix.onnx',
    size: 5171874,
    desc: '动漫 3× 保守版（pro），尽量保留原画风',
    strength: '二次元图片 3× 放大（保真、伪影少）',
  },
  {
    id: 'cugan-pro-x4-conservative',
    label: 'Real-CUGAN pro-x4 (conservative)',
    family: 'Real-CUGAN',
    scale: 4,
    norm: 'zero-one',
    file: 'cugan_up4x-latest-conservative_op18_clamp.onnx',
    vsgan: 'cugan_up4x-latest-conservative_op18_clamp.onnx',
    size: 5655490,
    desc: '动漫 4× 保守版，尽量保留原画风',
    strength: '二次元图片 4× 放大（保真、伪影少）',
  },
];

/**
 * UI 展示顺序：处理力度 / 画质由高到低。
 *
 * 排序依据（不是倍率，是「细节增益 + 模型体量」）：
 *   1. Real-ESRGAN Anime+        6B / 17.9MB，细节最猛，插画首选（最慢）
 *   2. CUGAN pro ×4              动漫最强档，伪影控制好
 *   3. CUGAN pro ×3
 *   4. CUGAN pro ×2
 *   5. CUGAN 2x（默认）          通用稳妥，速度和画质平衡
 *   6. general-x4v3              真实照片 / 截图专用（对二次元一般）
 *   7. AnimeVideo-v3 ×4          视频模型，静图偏软
 *   8. AnimeVideo-v3 ×2          视频模型，体积最小档
 *   9. Anime Fast                同上模型的别名，速度优先
 *  10. AnimeJaNai 2× compact     185KB，画质最弱，只适合应急
 *
 * 约定：新模型按上面的档位插入即可，UI 与默认选中都会跟着走。
 */
const SR_ORDER = [
  'realesr-anime-plus',
  'cugan-pro-x4-conservative',
  'cugan-pro-x3-conservative',
  'cugan-pro-x2-conservative',
  'cugan-2x-conservative',
  'realesr-general-x4v3',
  'realesr-animevideo-v3',
  'realesr-animevideo-x2',
  'realesr-anime-fast',
  'animejanai-2x-compact',
];

const orderIndex = (id: string) => {
  const i = SR_ORDER.indexOf(id);
  // 未登记的模型排到末尾，保持原有相对顺序
  return i < 0 ? SR_ORDER.length : i;
};

/** 全部超分模型，已按力度由高到低排好（列表顺序即 UI 展示顺序）。 */
export const SR_MODELS: SRModel[] = SR_MODELS_RAW.slice().sort(
  (a, b) => orderIndex(a.id) - orderIndex(b.id),
);

/** 按 id 取模型；找不到返回 undefined。 */
export const getSRModel = (id: string): SRModel | undefined =>
  SR_MODELS.find(m => m.id === id);

/** superres 模型目录（App 私有）。 */
export const SR_MODEL_DIR = 'superres';
