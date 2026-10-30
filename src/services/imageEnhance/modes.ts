/**
 * 图像增强 —— 增强项元数据（本地 / 云端 UI 共用）。
 *
 * 这里只放「增强项」的静态描述，**不含任何本地处理算法**。
 * 本地超分走 `services/superRes/*`（真·ONNX 模型端侧推理），
 * 云端走 SD WebUI 的 `/sdapi/v1/img2img`。
 */

export type EnhanceModeKey =
  | 'upscale'
  | 'denoise'
  | 'sharpen'
  | 'color'
  | 'face';

export interface EnhanceModeMeta {
  key: EnhanceModeKey;
  /** 卡片标题 */
  label: string;
  /** 这个模式「专门修复什么」 */
  desc: string;
}

export const ENHANCE_MODES: EnhanceModeMeta[] = [
  {
    key: 'upscale',
    label: '超分辨率',
    desc: '放大 2×/4× 并补足细节，适合模糊、尺寸偏小的图',
  },
  {
    key: 'denoise',
    label: '智能去噪',
    desc: '消除颗粒与噪点，适合夜景、压缩痕迹明显的图',
  },
  {
    key: 'sharpen',
    label: '锐化细节',
    desc: '增强边缘与纹理，适合偏软、发糊的照片',
  },
  {
    key: 'color',
    label: '色彩增强',
    desc: '提升饱和度与对比，适合发灰、暗淡的图',
  },
  {
    key: 'face',
    label: '人像柔化',
    desc: '柔化皮肤、改善面部，适合人像',
  },
];
