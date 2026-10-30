import {Platform} from 'react-native';

import * as RNFS from '@dr.pogodin/react-native-fs';

/**
 * File layout for on-device GPT-SoVITS (ONNX).
 *
 * <root>/gsv/
 *   bert-vocab.txt          — bundled asset, copied on first use
 *   packs/arona/…           — bundled role pack (small, precomputed on PC)
 *   models/bert.onnx        — 599 MB, shared by every role (fp16)
 *   models/gpt_encoder.onnx — per-role, ~160 MB
 *   models/gpt_step.onnx    — per-role, ~158 MB
 *   models/sovits.onnx      — per-role, ~81 MB
 */

export const GSV_DIR_SUBPATH = 'gsv';

export const GSV_ONNX_FILES = [
  {name: 'bert.onnx', bytes: 599245073, desc: 'BERT 韵律模型（所有角色共享）'},
  {name: 'gpt_encoder.onnx', bytes: 159653293, desc: 'GPT 语义编码'},
  {name: 'gpt_step.onnx', bytes: 157801590, desc: 'GPT 自回归解码'},
  {name: 'sovits.onnx', bytes: 81368420, desc: 'SoVITS 声码器'},
] as const;

export const GSV_PACK_ASSETS = [
  'meta.json',
  'ref_bert.bin',
  'prompt_semantic.bin',
  'refer_spec.bin',
  'ref.wav',
] as const;

export const GSV_DEFAULT_ROLE = 'arona';

export function gsvRootDir(): string {
  if (Platform.OS === 'ios') {
    return `${RNFS.LibraryDirectoryPath}/Application Support/${GSV_DIR_SUBPATH}`;
  }
  return `${RNFS.DocumentDirectoryPath}/${GSV_DIR_SUBPATH}`;
}

export function gsvModelsDir(): string {
  return `${gsvRootDir()}/models`;
}

export function gsvPackDir(role: string): string {
  return `${gsvRootDir()}/packs/${role}`;
}

export function gsvModelPath(name: string): string {
  return `${gsvModelsDir()}/${name}`;
}

/** Copy bundled pack + vocab assets out of the APK. Idempotent. */
export async function ensureBundledAssets(role: string): Promise<void> {
  const root = gsvRootDir();
  await RNFS.mkdir(root).catch(() => {});
  await RNFS.mkdir(gsvModelsDir()).catch(() => {});
  const packDir = gsvPackDir(role);
  await RNFS.mkdir(packDir).catch(() => {});

  const vocabDst = `${root}/bert-vocab.txt`;
  if (!(await RNFS.exists(vocabDst))) {
    await RNFS.copyFileAssets(`gsv/bert-vocab.txt`, vocabDst);
  }
  for (const f of GSV_PACK_ASSETS) {
    const dst = `${packDir}/${f}`;
    if (!(await RNFS.exists(dst))) {
      await RNFS.copyFileAssets(`gsv/packs/${role}/${f}`, dst);
    }
  }
}

export interface GsvFileInfo {
  name: string;
  exists: boolean;
  size: number;
  expectedBytes: number;
}

export async function statOnnxFiles(): Promise<GsvFileInfo[]> {
  const out: GsvFileInfo[] = [];
  for (const f of GSV_ONNX_FILES) {
    const p = gsvModelPath(f.name);
    let exists = false;
    let size = 0;
    try {
      const st = await RNFS.stat(p);
      exists = st.isFile();
      size = Number(st.size);
    } catch {
      exists = false;
    }
    out.push({name: f.name, exists, size, expectedBytes: f.bytes});
  }
  return out;
}

export async function allModelsPresent(): Promise<boolean> {
  const infos = await statOnnxFiles();
  return infos.every(i => i.exists && i.size > 1_000_000);
}

/**
 * Download the ONNX files from a base URL (e.g. http://192.168.1.5:8000),
 * keeping the on-disk names. Skips files that are already complete.
 */
export async function downloadModels(
  baseUrl: string,
  onProgress: (file: string, written: number, total: number) => void,
  shouldAbort: () => boolean = () => false,
): Promise<void> {
  const base = baseUrl.replace(/\/+$/, '');
  await RNFS.mkdir(gsvModelsDir()).catch(() => {});
  for (const f of GSV_ONNX_FILES) {
    if (shouldAbort()) {
      throw new Error('已取消');
    }
    const dst = gsvModelPath(f.name);
    if (await RNFS.exists(dst)) {
      const st = await RNFS.stat(dst);
      if (Number(st.size) === f.bytes) {
        continue; // already complete
      }
    }
    const job = RNFS.downloadFile({
      fromUrl: `${base}/${f.name}`,
      toFile: dst,
      connectionTimeout: 15000,
      readTimeout: 60000,
      progressInterval: 500,
      progress: res => onProgress(f.name, res.bytesWritten, res.contentLength),
    });
    const res = await job.promise;
    if (res.statusCode && res.statusCode >= 300) {
      await RNFS.unlink(dst).catch(() => {});
      throw new Error(`${f.name} 下载失败（HTTP ${res.statusCode}）`);
    }
    const st = await RNFS.stat(dst);
    if (Math.abs(Number(st.size) - f.bytes) > 1024) {
      throw new Error(
        `${f.name} 大小不符（${st.size} ≠ ${f.bytes}），请检查服务端文件`,
      );
    }
  }
}

/** Import model files from the device Download folder (USB copy path). */
export async function importModelsFromDownloads(
  onProgress: (msg: string) => void,
): Promise<number> {
  type DirItem = Awaited<ReturnType<typeof RNFS.readDir>>[number];
  const candidates = [
    RNFS.DownloadDirectoryPath,
    `${RNFS.DownloadDirectoryPath}/OnDeviceKit`,
  ].filter(Boolean);
  let imported = 0;
  for (const dir of candidates) {
    let entries: DirItem[] = [];
    try {
      entries = await RNFS.readDir(dir);
    } catch {
      continue;
    }
    for (const f of GSV_ONNX_FILES) {
      const hit = entries.find(e => e.name === f.name && e.isFile());
      if (!hit) {
        continue;
      }
      const dst = gsvModelPath(f.name);
      if (await RNFS.exists(dst)) {
        const st = await RNFS.stat(dst);
        if (Number(st.size) === f.bytes) {
          continue;
        }
      }
      onProgress(`导入 ${f.name}…`);
      await RNFS.copyFile(hit.path, dst);
      imported++;
    }
  }
  return imported;
}

export async function deleteModels(): Promise<void> {
  for (const f of GSV_ONNX_FILES) {
    await RNFS.unlink(gsvModelPath(f.name)).catch(() => {});
  }
}
