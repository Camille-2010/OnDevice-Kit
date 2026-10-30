/**
 * 下载源解析：把 HuggingFace 的下载链接换成一个**在国内真正连得上**的源。
 *
 * 【问题】
 * HF 对大文件启用了 Xet 存储：`huggingface.co/{repo}/resolve/main/{file}`
 * 会 302 到 `cas-bridge.xethub.hf.co`。这个域名在中国大陆连不上（TLS 被重置），
 * hf-mirror.com 也只是把同一个 302 转发回来，救不了 —— 表现就是
 * 「网络连不上 / 下载失败」。
 *
 * 【解决】
 * ModelScope（阿里）镜像了绝大多数热门仓库，且文件直连国内 CDN
 * （cdn-lfs-cn-1.modelscope.cn），不经过 Xet。所以**优先走 ModelScope**，
 * HF 原链作为境外网络的兜底。
 *
 * 与 TTS 的 modelSource.ts 是同一套思路，这里抽出来给通用模型下载复用。
 */

const MS_MODELS = 'https://modelscope.cn/models';

/** HF resolve 链接 → ModelScope 等价链接；不是 HF 链接返回 null。 */
export const modelscopeDownloadUrl = (url: string): string | null => {
  const m =
    /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/(?:main|master)\/(.+)$/.exec(
      url,
    );
  if (!m) {
    return null;
  }
  return `${MS_MODELS}/${m[1]}/resolve/master/${m[2]}`;
};

/** 候选下载源（去重、按优先级）：ModelScope → HF 原链。 */
export const candidateDownloadUrls = (url: string): string[] => {
  const ms = modelscopeDownloadUrl(url);
  const list = ms ? [ms, url] : [url];
  return [...new Set(list)];
};

const isHfUrl = (url: string): boolean =>
  url.startsWith('https://huggingface.co/');

/**
 * 用 `Range: bytes=0-0` 快速探测某个源是否可达（只取 1 字节，不下载整个文件）。
 * 206 = Range 生效；200 = 服务器忽略 Range 但仍可用；其余视为不可用。
 */
const isReachable = async (
  url: string,
  authToken?: string | null,
  timeoutMs = 8000,
): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {Range: 'bytes=0-0'};
    // HF token 只能发给 huggingface.co，绝不能泄漏给第三方镜像。
    if (authToken && isHfUrl(url)) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
    return res.status === 206 || res.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * 选出一个真正可下载的地址：按候选顺序探测，返回第一个可达的。
 * 全部探测失败时返回第一个候选，让真正的下载去暴露具体错误。
 */
export const resolveDownloadUrl = async (
  url: string,
  authToken?: string | null,
): Promise<string> => {
  const candidates = candidateDownloadUrls(url);
  for (const candidate of candidates) {
    if (await isReachable(candidate, authToken)) {
      return candidate;
    }
  }
  return candidates[0]!;
};
