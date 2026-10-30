import axios from 'axios';

import {urls} from '../config';

import {hfUserAgent} from '../utils/hfUserAgent';
import {
  GGUFSpecs,
  HuggingFaceModel,
  HuggingFaceModelsResponse,
  ModelFileDetails,
} from '../utils/types';

/**
 * HF API 镜像兜底。
 *
 * huggingface.co 在中国大陆连不上（TLS 被重置），模型搜索/文件列表会直接
 * 报「网络连不上」。hf-mirror.com 代理了 `/api/...` 且国内可达，所以
 * **先打官方、失败（网络错误/超时/5xx）再用镜像重试**，并把 HF token
 * 从镜像请求里去掉（token 只能发给 huggingface.co）。
 */
const HF_ORIGIN = 'https://huggingface.co';
const HF_MIRROR_ORIGIN = 'https://hf-mirror.com';
/** 官方源请求超时，超时即切镜像（否则国内会一直挂着） */
const HF_API_TIMEOUT_MS = 12000;

const toMirrorUrl = (url: string): string =>
  url.startsWith(HF_ORIGIN)
    ? HF_MIRROR_ORIGIN + url.slice(HF_ORIGIN.length)
    : url;

/** 先官方、失败再镜像地执行一个请求（镜像请求不带鉴权）。 */
async function withMirrorFallback<T>(
  url: string,
  run: (targetUrl: string, useAuth: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await run(url, true);
  } catch (err) {
    const mirror = toMirrorUrl(url);
    if (mirror === url) {
      throw err;
    }
    console.warn(`[hf] ${url} 失败，改用镜像重试: ${mirror}`);
    return run(mirror, false);
  }
}

/** 带超时的 fetch：国内打官方源会一直挂着，超时才能触发镜像兜底。 */
function fetchWithTimeout(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HF_API_TIMEOUT_MS);
  return fetch(url, {headers, signal: controller.signal}).finally(() =>
    clearTimeout(timer),
  );
}

/**
 * Get information from all models in the Hub.
 * The response is paginated, use the Link header to get the next pages.
 *
 * search: Filter based on substrings for repos and their usernames, such as resnet or microsoft
 * author: Filter models by an author or organization, such as huggingface or microsoft
 * filter: Filter based on tags, such as text-classification or spacy.
 * sort: Property to use when sorting, such as downloads or author.
 * direction: Direction in which to sort, such as -1 for descending, and anything else for ascending.
 * limit: Limit the number of models fetched.
 * full: Whether to fetch most model data, such as all tags, the files, etc.
 * config: Whether to also fetch the repo config.
 *
 * @see https://huggingface.co/docs/api-reference/api-endpoints#get-models
 */
export async function fetchModels({
  search,
  author,
  filter,
  sort,
  direction,
  limit,
  full,
  config,
  nextPageUrl,
  authToken,
}: {
  search?: string;
  author?: string;
  filter?: string;
  sort?: string;
  direction?: string;
  limit?: number;
  full?: boolean;
  config?: boolean;
  nextPageUrl?: string;
  authToken?: string | null;
}): Promise<HuggingFaceModelsResponse> {
  try {
    const headers: Record<string, string> = {'User-Agent': hfUserAgent()};

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await withMirrorFallback(
      nextPageUrl || urls.modelsList(),
      (targetUrl, useAuth) =>
        axios.get(targetUrl, {
          params: {
            search,
            author,
            filter,
            sort,
            direction,
            limit,
            full,
            config,
          },
          timeout: HF_API_TIMEOUT_MS,
          // 镜像请求不带鉴权（token 只给 huggingface.co）
          headers: useAuth ? headers : {'User-Agent': hfUserAgent()},
        }),
    );

    const linkHeader = response.headers.link;
    let nextLink = null;

    if (linkHeader) {
      const match = linkHeader.match(/<([^>]*)>/);
      if (match) {
        nextLink = match[1];
      }
    }

    return {
      models: response.data as HuggingFaceModel[],
      nextLink,
    };
  } catch (error) {
    console.error('Error fetching models:', error);
    throw error;
  }
}

/**
 * Fetches the details of the model's files. Mainly the size is used.
 * @param modelId - The ID of the model.
 * @param authToken - Optional authentication token for accessing private models
 * @returns An array of ModelFileDetails.
 */
export const fetchModelFilesDetails = async (
  modelId: string,
  authToken?: string | null,
): Promise<ModelFileDetails[]> => {
  const url = `${urls.modelTree(modelId)}?recursive=true`;

  try {
    const baseHeaders: Record<string, string> = {'User-Agent': hfUserAgent()};
    if (authToken) {
      baseHeaders.Authorization = `Bearer ${authToken}`;
    }

    const response = await withMirrorFallback(url, (targetUrl, useAuth) =>
      fetchWithTimeout(
        targetUrl,
        useAuth ? baseHeaders : {'User-Agent': hfUserAgent()},
      ),
    );

    if (!response.ok) {
      throw new Error(`Error fetching model files: ${response.statusText}`);
    }

    const data: ModelFileDetails[] = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch model files:', error);
    throw error;
  }
};

/**
 * Fetches the specs of the GGUF for a specific model.
 * @param modelId - The ID of the model.
 * @param authToken - Optional authentication token for accessing private models
 * @returns The GGUF specs.
 */
export const fetchGGUFSpecs = async (
  modelId: string,
  authToken?: string | null,
): Promise<GGUFSpecs> => {
  const url = `${urls.modelSpecs(modelId)}?expand[]=gguf`;

  try {
    const baseHeaders: Record<string, string> = {'User-Agent': hfUserAgent()};
    if (authToken) {
      baseHeaders.Authorization = `Bearer ${authToken}`;
    }

    const response = await withMirrorFallback(url, (targetUrl, useAuth) =>
      fetchWithTimeout(
        targetUrl,
        useAuth ? baseHeaders : {'User-Agent': hfUserAgent()},
      ),
    );

    if (!response.ok) {
      throw new Error(`Error fetching GGUF specs: ${response.statusText}`);
    }

    const data: GGUFSpecs = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch GGUF specs:', error);
    throw error;
  }
};

/**
 * Fetches complete model information from HuggingFace API
 * @param repoId - The repository ID (e.g., "microsoft/DialoGPT-medium")
 * @param revision - Optional revision/branch (defaults to main)
 * @param full - Whether to fetch full model data
 * @param authToken - Optional authentication token for accessing private models
 * @param stripFields - Optional array of fields to remove from the result
 * @returns Partial HuggingFaceModel with GGUF specs converted to compatible format
 */
export async function fetchModelInfo({
  repoId,
  revision,
  full,
  authToken,
  stripFields = ['spaces', 'cardData', 'config'], // Default fields to strip
}: {
  repoId: string;
  revision?: string;
  full?: boolean;
  authToken?: string | null;
  stripFields?: string[];
}): Promise<Partial<HuggingFaceModel>> {
  const headers: Record<string, string> = {'User-Agent': hfUserAgent()};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const base = revision
    ? `${urls.modelSpecs(repoId)}/revision/${revision}`
    : urls.modelSpecs(repoId);

  try {
    const response = await withMirrorFallback(base, (targetUrl, useAuth) =>
      axios.get<any>(targetUrl, {
        params: {
          full,
        },
        timeout: HF_API_TIMEOUT_MS,
        headers: useAuth ? headers : {'User-Agent': hfUserAgent()},
      }),
    );

    const modelData: Partial<HuggingFaceModel> = {...response.data};

    // Remove unwanted fields
    for (const field of stripFields) {
      delete (modelData as any)[field];
    }

    // Convert GGUF field to specs format for compatibility with existing code
    // The API returns: { "gguf": { "total": 123, "architecture": "llama", ... } }
    // But our code expects: { "specs": { "gguf": { "total": 123, ... } } }
    // TODO: at some point this needs to be migrated to be compatible with HF datastructure.
    if (response.data.gguf) {
      modelData.specs = {
        _id: response.data._id || '',
        id: response.data.id || repoId,
        gguf: response.data.gguf,
        // Include other fields that might be in the original specs format
        ...modelData.specs,
      };
      // Remove the original gguf field since we've moved it to specs.gguf
      delete (modelData as any).gguf;
    }

    return modelData;
  } catch (error) {
    console.error('Failed to fetch model info:', error);
    throw error;
  }
}

/**
 * 验证 HuggingFace 访问令牌是否有效。
 *
 * 直接打 `whoami-v2` 接口（带 Bearer）。因为国内 huggingface.co 常连不上，
 * 网络错误/超时会再退回 hf-mirror.com 的同款接口重试——镜像也是 HF 官方代理，
 * 令牌只发给这两个 HF 基础设施域名，绝不会发给其它第三方。
 *
 * @returns valid 之外，成功时带 username；失败时带 error：
 *   'invalid'（401/403，令牌无效、过期或缺少 whoami 权限）、
 *   'timeout'/'network'（连不上）、或其它文本（如 `HTTP 500`）。
 */
export const verifyHfToken = async (
  token: string,
): Promise<{valid: boolean; username?: string; error?: string}> => {
  const endpoints = [
    'https://huggingface.co/api/whoami-v2',
    'https://hf-mirror.com/api/whoami-v2',
  ];

  for (const url of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HF_API_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': hfUserAgent(),
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      if (res.status === 200) {
        try {
          const data = await res.json();
          const username =
            data?.name ?? data?.id ?? data?.username ?? undefined;
          return {valid: true, username};
        } catch {
          // 200 但非 JSON（极少见）——仍视为有效
          return {valid: true};
        }
      }
      if (res.status === 401 || res.status === 403) {
        return {valid: false, error: 'invalid'};
      }
      return {valid: false, error: `HTTP ${res.status}`};
    } catch {
      // AbortError（超时）或其它网络错误（DNS / TLS 被重置等）：试下一个源
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  return {valid: false, error: 'network'};
};
