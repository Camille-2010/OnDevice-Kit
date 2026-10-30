import {FIREBASE_FUNCTIONS_URL} from '@env';

export const HF_DOMAIN = 'https://huggingface.co';
export const HF_API_BASE = `${HF_DOMAIN}/api/models`;

// Fallback for Firebase Functions URL if not configured
const FIREBASE_BASE =
  FIREBASE_FUNCTIONS_URL || 'https://placeholder-firebase-functions.com';

/**
 * 反馈/基准上报后端是否真的配置过。未配置时上面的占位域名不可达，
 * 而且不该把用户填写的反馈内容 POST 给一个占位域名（域名可被第三方
 * 抢注）——提交前调用方须先检查这个开关，未配置直接报错（fail closed）。
 */
export const FIREBASE_FUNCTIONS_CONFIGURED = !!FIREBASE_FUNCTIONS_URL;

export const urls = {
  // API URLs
  modelsList: () => `${HF_API_BASE}`,
  modelTree: (modelId: string) => `${HF_API_BASE}/${modelId}/tree/main`,
  modelSpecs: (modelId: string) => `${HF_API_BASE}/${modelId}`,

  // Web URLs
  modelDownloadFile: (modelId: string, filename: string) =>
    `${HF_DOMAIN}/${modelId}/resolve/main/${filename}`,
  modelWebPage: (modelId: string) => `${HF_DOMAIN}/${modelId}`,

  // Benchmark Endpoint
  benchmarkSubmit: () => `${FIREBASE_BASE}/api/v1/submit`,

  // Feedback Endpoint
  feedbackSubmit: () => `${FIREBASE_BASE}/feedback`,
};
