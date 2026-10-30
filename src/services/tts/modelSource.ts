// 用命名空间导入（和三个引擎一致）：项目的 RNFS jest mock 只有具名导出，
// 写成 default import 在测试里会拿到 undefined
import * as RNFS from '@dr.pogodin/react-native-fs';

/**
 * TTS 模型下载源（ModelScope → HF 镜像 → HF 官方，逐个试）。
 *
 * 【为什么要三路】
 * 三个神经网络音色（Kitten / Kokoro / Supertonic）的权重原本都托管在
 * huggingface.co。现在 HF 对大文件启用了 Xet 存储：`/resolve/` 会 302 到
 * `cas-bridge.xethub.hf.co`。这个域名在中国大陆**连不上**（TLS 被重置），
 * 表现是：
 *   SSL handshake aborted: ssl=0x...: I/O error during system call,
 *   Connection reset by peer
 * 而且 hf-mirror.com 也只是把同一个 302 转发回来，救不了 —— 实测 2026-10-20。
 *
 * ModelScope（阿里）在国内可直连，且镜像了本 App 需要的三个仓库，所以
 * 把它放在第一顺位；镜像和官方只作为境外网络的兜底。
 *
 * 【路径映射】
 *   HF:        https://huggingface.co/{repo}/resolve/main/{path}
 *   ModelScope https://modelscope.cn/models/{repo}/resolve/master/{path}
 * 仓库名大多一致，个别不一致的走 MS_REPO_ALIAS。
 */

export const HF_OFFICIAL_ORIGIN = 'https://huggingface.co';
export const HF_MIRROR_ORIGIN = 'https://hf-mirror.com';
export const MS_ORIGIN = 'https://modelscope.cn/models';

/** HF 仓库 → ModelScope 仓库（同名的不必列） */
const MS_REPO_ALIAS: Record<string, string> = {
  'palshub/kitten-tts-nano-0.8-fp32': 'KittenML/kitten-tts-nano-0.8-fp32',
};

/** 本次会话最近一次成功的源，仅用于诊断/日志 */
let activeOrigin = HF_OFFICIAL_ORIGIN;

export const activeTtsOrigin = (): string => activeOrigin;

/**
 * 把 HF 的 resolve 链接映射成 ModelScope 的等价链接；不是 HF 链接返回 null。
 */
export const modelScopeUrl = (url: string): string | null => {
  const match =
    /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/main\/(.+)$/.exec(
      url,
    );
  if (!match) {
    return null;
  }
  const repo = MS_REPO_ALIAS[match[1]!] ?? match[1]!;
  return `${MS_ORIGIN}/${repo}/resolve/master/${match[2]!}`;
};

/** 把 HF 链接换成镜像链接；不是 HF 链接返回 null */
const mirrorUrl = (url: string): string | null =>
  url.startsWith(HF_OFFICIAL_ORIGIN)
    ? HF_MIRROR_ORIGIN + url.slice(HF_OFFICIAL_ORIGIN.length)
    : null;

/**
 * 当前应使用的链接（用于写进本地 voices-manifest 的 baseUrl，
 * 保证播放时懒加载音色也走同一个能连通的域名）。
 */
export const resolveTtsUrl = (url: string): string =>
  modelScopeUrl(url) ?? mirrorUrl(url) ?? url;

/** 一次下载要依次尝试的候选链接（去重，顺序 = 优先级） */
const candidateUrls = (url: string): string[] => {
  const list = [modelScopeUrl(url), mirrorUrl(url), url].filter(
    (item): item is string => !!item,
  );
  return [...new Set(list)];
};

const originOf = (url: string): string => {
  if (url.startsWith(MS_ORIGIN)) {
    return MS_ORIGIN;
  }
  return url.startsWith(HF_MIRROR_ORIGIN)
    ? HF_MIRROR_ORIGIN
    : HF_OFFICIAL_ORIGIN;
};

export interface TtsDownloadOptions {
  fromUrl: string;
  toFile: string;
  background?: boolean;
  discretionary?: boolean;
  cacheable?: boolean;
  progressInterval?: number;
  progress?: (res: {bytesWritten: number; contentLength: number}) => void;
}

const runDownload = (
  fromUrl: string,
  opts: TtsDownloadOptions,
): Promise<{statusCode: number; bytesWritten?: number}> =>
  RNFS.downloadFile({...opts, fromUrl}).promise;

/**
 * 下载一个 TTS 资源文件：按 ModelScope → HF 镜像 → HF 官方 的顺序逐个试，
 * 第一个 200 的即为结果。全部失败时抛最后一个网络错误（或返回最后一个
 * 非 200 的响应，交给调用方报 HTTP 码）。
 */
export const downloadTtsFile = async (
  opts: TtsDownloadOptions,
): Promise<{statusCode: number; bytesWritten?: number}> => {
  const candidates = candidateUrls(opts.fromUrl);
  let lastResult: {statusCode: number; bytesWritten?: number} | null = null;
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const result = await runDownload(candidate, opts);
      if (result.statusCode === 200) {
        activeOrigin = originOf(candidate);
        return result;
      }
      lastResult = result;
      console.warn(
        `[TTS download] ${candidate} → HTTP ${result.statusCode}, 试下一个源`,
      );
    } catch (err) {
      lastError = err;
      console.warn(
        `[TTS download] ${candidate} 失败: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  if (lastResult) {
    return lastResult;
  }
  throw lastError ?? new Error('TTS download failed: no usable source');
};
