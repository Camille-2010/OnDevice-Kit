/**
 * 本地 ONNX 超分推理服务。
 *
 * 流程：
 *   1. ensureModel  —— 首次使用时把 .onnx 下载到 App 私有目录（带完整性校验 + 镜像重试）
 *   2. runSuperRes —— 用 onnxruntime-react-native 在端侧推理（CPU，稳定优先）
 *   3. 在 RN 侧完成「后处理」（反归一化 + NCHW→RGBA），输出以 base64 回传 WebView
 *
 * 为什么在 RN 侧后处理、而不是回传浮点张量：
 *   模型输出是 [1,3,Ho,Wo] 的浮点张量，x4 时可达 200 万+ 个 float。
 *   原样以 JSON 数组回传约 19MB，会撑爆 React Native WebView 桥。
 *   因此在 RN 侧先反归一化并转成 RGBA 字节（每像素 4 字节），再做 base64 只传 ~1.4MB。
 *
 * 输入/输出张量格式均为 NCHW float32；输入由调用方（WebView）负责像素 → 张量。
 */
import * as RNFS from '@dr.pogodin/react-native-fs';
import {InferenceSession, Tensor} from 'onnxruntime-react-native';

import {SRModel, SRNormalization, SR_MODEL_DIR, modelUrls} from './models';

/** 模型目录绝对路径（App 私有，离线可用）。 */
export const modelDir = () => `${RNFS.DocumentDirectoryPath}/${SR_MODEL_DIR}`;

const localPathOf = (model: SRModel) => `${modelDir()}/${model.file}`;

/** 已创建的推理会话缓存（避免重复加载模型）。 */
const sessionCache = new Map<string, InferenceSession>();

/** 单个文件最小可信体积（未声明 size 的模型用它兜底）。 */
const MIN_VALID_BYTES = 1024 * 1024;

/**
 * 是否启用 NNAPI 加速。
 * 目前关闭：部分机型/模型在 NNAPI 下会静默输出错误结果，排查成本高；
 * CPU 结果确定、可控。需要提速时把它改成 true 即可（会自动回落）。
 */
const USE_NNAPI = false;

/** 一块待超分的输入（RGB 原始字节，未归一化）。 */
export interface SRTile {
  /** 块序号（回传时原样带回，用于拼接） */
  idx: number;
  w: number;
  h: number;
  /** RGB 交错字节，长度 w*h*3 */
  rgb: Uint8Array;
}

export interface SRTileOut {
  idx: number;
  /** 放大后的 RGBA 字节，已 base64 */
  b64: string;
  w: number;
  h: number;
}

const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

async function fileSizeOf(path: string): Promise<number> {
  try {
    const st = await RNFS.stat(path);
    return Number(st.size) || 0;
  } catch {
    return 0;
  }
}

/** 文件体积是否符合预期（有 size 就必须精确相等）。 */
async function isSizeOk(model: SRModel, path: string): Promise<boolean> {
  const size = await fileSizeOf(path);
  if (size <= 0) {
    return false;
  }
  return model.size ? size === model.size : size > MIN_VALID_BYTES;
}

/**
 * 粗略校验是不是真的 ONNX：onnx 是 protobuf，
 * 首字节应为 0x08（ir_version 字段）。被 CDN 拦截时下到的多是 HTML(`<`)/JSON(`{`)。
 */
async function looksLikeOnnx(path: string): Promise<boolean> {
  try {
    const head = await RNFS.read(path, 4, 0, 'base64'); // 4 字节 → base64 8 字符
    const i0 = B64_CHARS.indexOf(head[0]);
    const i1 = B64_CHARS.indexOf(head[1]);
    if (i0 < 0 || i1 < 0) {
      return false;
    }
    return ((i0 << 2) | (i1 >> 4)) === 0x08;
  } catch {
    return false;
  }
}

/**
 * 确保模型文件在本地可用（三级兜底）：
 *   1. 已存在且体积精确匹配 → 直接返回
 *   2. 网络可连 → 走镜像下载（不占安装包体积）
 *   3. 下载失败（镜像全挂 / 无网络）→ 用安装包内置的 assets 模型兜底，离线也能用
 *   4. 仍失败 → 提示从「下载」目录手动导入
 */
export async function ensureModel(
  model: SRModel,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const dest = localPathOf(model);
  await RNFS.mkdir(modelDir());

  if ((await RNFS.exists(dest)) && (await isSizeOk(model, dest))) {
    onProgress?.(1);
    return dest;
  }
  // 体积不对（截断/错误页/旧版本）→ 删掉重来
  if (await RNFS.exists(dest)) {
    await RNFS.unlink(dest).catch(() => undefined);
  }

  // ① 网络下载优先（镜像可连时不占用安装包体积）
  if (await tryDownloadModel(model, dest, onProgress)) {
    return dest;
  }

  // ② 下载失败 → 安装包内置模型兜底（离线也能用）
  try {
    await copyBundledModel(model, dest, onProgress);
    return dest;
  } catch (bundleErr) {
    // ③ 仍失败 → 尝试「下载」目录手动导入，最后给出可读错误
    const manualErr = await tryManualImport(model, dest, onProgress);
    if (manualErr) {
      throw new Error(
        `模型「${model.label}」获取失败：${String(
          (bundleErr as Error)?.message ?? bundleErr,
        )}。${manualErr}`,
      );
    }
    return dest;
  }
}

/** 从镜像下载模型；成功返回 true，失败（含全部重试耗尽 / 无下载地址）返回 false。 */
async function tryDownloadModel(
  model: SRModel,
  dest: string,
  onProgress?: (fraction: number) => void,
): Promise<boolean> {
  const urls = modelUrls(model);
  if (urls.length === 0) {
    return false; // 无下载地址（手动导入型），交给上层处理
  }
  // 每个源跑 3 轮：镜像会随机截断/抽风，多试几次才下得完整。
  const attempts = urls.length * 3;
  for (let i = 0; i < attempts; i++) {
    const url = urls[i % urls.length];
    try {
      if (await RNFS.exists(dest)) {
        await RNFS.unlink(dest).catch(() => undefined);
      }
      const code = await new Promise<number>((resolve, reject) => {
        const job = RNFS.downloadFile({
          fromUrl: url,
          toFile: dest,
          progressDivider: 25,
          // 反代偶发「连上了但不吐数据」的假死，设超时让它尽快失败、切下一个镜像。
          // connection 12s：连不上的死源快速放弃；read 45s：给慢但活的 5MB 传输留足时间。
          connectionTimeout: 12000,
          readTimeout: 45000,
          begin: () => onProgress?.(0),
          progress: r => {
            const total =
              r.contentLength > 0 ? r.contentLength : (model.size ?? 0);
            if (total > 0) {
              onProgress?.(Math.min(0.99, r.bytesWritten / total));
            }
          },
        });
        job.promise.then(
          res => resolve(res.statusCode),
          err => reject(new Error(String(err))),
        );
      });

      if (code < 200 || code >= 300) {
        // 该源本轮不可用，切下一个
      } else if (!(await isSizeOk(model, dest))) {
        // 截断/错误页，切下一个
      } else if (!(await looksLikeOnnx(dest))) {
        // 不是真 ONNX（被拦截），切下一个
      } else {
        onProgress?.(1);
        return true;
      }
    } catch {
      // 该源异常，切下一个
    }
    // 失败后稍等再试下一个镜像：反代经常是瞬时抽风，等一下往往就好了
    if (i < attempts - 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  await RNFS.unlink(dest).catch(() => undefined);
  return false;
}

/** 从安装包内置 assets 复制模型作为离线兜底。失败抛错。 */
async function copyBundledModel(
  model: SRModel,
  dest: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const assetPath = `superres/${model.file}`;
  onProgress?.(0);
  try {
    await RNFS.copyFileAssets(assetPath, dest);
  } catch (e) {
    throw new Error(
      `内置模型读取失败（${String((e as Error)?.message ?? e)}）。` +
        `可能是当前 APK 未打包该模型。`,
    );
  }
  if (!(await isSizeOk(model, dest))) {
    const got = await fileSizeOf(dest);
    await RNFS.unlink(dest).catch(() => undefined);
    throw new Error(
      `内置模型体积不符（${got}/${model.size ?? '?'} 字节），APK 资源可能缺失。`,
    );
  }
  if (!(await looksLikeOnnx(dest))) {
    await RNFS.unlink(dest).catch(() => undefined);
    throw new Error(`内置模型「${model.label}」不是有效的 ONNX 文件。`);
  }
  onProgress?.(1);
}

/**
 * 手动导入型兜底：在「下载」目录查找同名 .onnx 并复制。
 * 返回 null 表示成功复制；返回字符串表示失败原因。
 */
async function tryManualImport(
  model: SRModel,
  dest: string,
  onProgress?: (fraction: number) => void,
): Promise<string | null> {
  const candidates = [
    `${RNFS.DownloadDirectoryPath}/${model.file}`,
    `${RNFS.DownloadDirectoryPath}/OnDeviceKit/${model.file}`,
  ];
  for (const c of candidates) {
    try {
      if (await RNFS.exists(c)) {
        const size = await fileSizeOf(c);
        if (model.size && size !== model.size) {
          throw new Error(
            `文件体积不符（${size}/${model.size} 字节），可能没复制完`,
          );
        }
        await RNFS.copyFile(c, dest);
        onProgress?.(1);
        return null;
      }
    } catch (e) {
      return `手动导入也失败：${String((e as Error)?.message ?? e)}`;
    }
  }
  return `请联网重试，或把 ${model.file} 放进手机「下载」目录（或 下载/OnDeviceKit/）后重试。`;
}

/**
 * 修复「声明的 opset 高于实际使用」的模型。
 *
 * 现象：VSGAN 的 `*_op18_clamp.onnx`（Real-CUGAN 全家）里 ReduceMean 仍用 opset≤17
 * 的属性写法 `axes=...`，却被声明成 opset 18 → ORT 报
 * "Unrecognized attribute: axes for operator ReduceMean"，模型直接加载失败。
 *
 * 这些文件的 ModelProto 字段顺序固定，`opset_import`（field 8）永远在文件末尾：
 *   尾部固定是 42 02 10 <opset 版本>   （18 = 0x12）
 * 所以只需把最后一个字节 0x12 改成 0x11（17），单字节原地改写，不改变文件长度。
 *
 * 仅在「加载失败」后才调用，且改完仍失败会删文件重下，不会把好模型改坏。
 */
async function tryDowngradeOpset(path: string): Promise<boolean> {
  try {
    const size = await fileSizeOf(path);
    if (size < 16) {
      return false;
    }
    const tailBytes = base64ToBytes(
      await RNFS.read(path, 8, size - 8, 'base64'),
    );
    const n = tailBytes.length;
    // 末尾 4 字节固定是 42 02 10 <opset>：field8(len2){ field2(varint)=18 }
    const matches =
      n >= 4 &&
      tailBytes[n - 4] === 0x42 &&
      tailBytes[n - 3] === 0x02 &&
      tailBytes[n - 2] === 0x10 &&
      tailBytes[n - 1] === 0x12;
    if (!matches) {
      return false;
    }

    // 先试「只改写最后 4 字节」，改完回读校验
    const patchedTail = bytesToBase64(new Uint8Array([0x42, 0x02, 0x10, 0x11]));
    await RNFS.write(path, patchedTail, size - 4, 'base64');
    const check = base64ToBytes(await RNFS.read(path, 4, size - 4, 'base64'));
    if (check.length === 4 && check[3] === 0x11) {
      return true;
    }

    // 回退：整文件读出来改完再写回（语义最稳，代价是峰值内存约 2×文件大小）
    const all = base64ToBytes(await RNFS.read(path, size, 0, 'base64'));
    if (all.length !== size) {
      return false;
    }
    all[size - 1] = 0x11;
    await RNFS.writeFile(path, bytesToBase64(all), 'base64');
    return true;
  } catch {
    return false;
  }
}

/** 获取（或创建并缓存）推理会话。 */
async function getSession(
  model: SRModel,
  onProgress?: (fraction: number) => void,
): Promise<InferenceSession> {
  const cached = sessionCache.get(model.id);
  if (cached) {
    return cached;
  }

  let path = await ensureModel(model, onProgress);
  const providers = USE_NNAPI ? ['nnapi', 'cpu'] : ['cpu'];

  const tryCreate = async (p: string) => {
    return InferenceSession.create(p, {executionProviders: providers});
  };

  let session: InferenceSession | undefined;
  try {
    session = await tryCreate(path);
  } catch {
    // 可能是 opset 声明错误的老导出 → 单字节修一下再试
    if (await tryDowngradeOpset(path)) {
      try {
        session = await tryCreate(path);
      } catch {
        session = undefined;
      }
    }
  }

  if (!session) {
    // 修不动：删掉重下一次再试，仍失败就把原因抛给用户
    await RNFS.unlink(path).catch(() => undefined);
    path = await ensureModel(model, onProgress);
    await tryDowngradeOpset(path);
    try {
      session = await tryCreate(path);
    } catch (e) {
      throw new Error(
        `模型「${model.label}」加载失败：${(e as Error)?.message ?? String(e)}`,
      );
    }
  }

  sessionCache.set(model.id, session);
  return session;
}

/** base64 → 字节数组（RN 不保证 Buffer，手写更稳）。 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_CHARS.indexOf(clean[i]);
    const c1 = B64_CHARS.indexOf(clean[i + 1]);
    const c2 = B64_CHARS.indexOf(clean[i + 2]);
    const c3 = B64_CHARS.indexOf(clean[i + 3]);
    if (p < len) {
      out[p++] = (c0 << 2) | (c1 >> 4);
    }
    if (c2 >= 0 && p < len) {
      out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    }
    if (c3 >= 0 && p < len) {
      out[p++] = ((c2 & 3) << 6) | c3;
    }
  }
  return out;
}

/** Uint8Array / Uint8ClampedArray → base64（RN 不保证有 Buffer/btoa，手写更稳）。 */
function bytesToBase64(bytes: Uint8Array | Uint8ClampedArray): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += b1 !== undefined ? B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += b2 !== undefined ? B64_CHARS[b2 & 63] : '=';
  }
  return out;
}

/**
 * 后处理：模型输出 NCHW float32 → RGBA 字节。
 * - 'pm1'      ：输出在 [-1,1]，需 *0.5+0.5
 * - 'zero-one' ：输出已在 [0,1]
 * Uint8ClampedArray 自动裁剪到 [0,255]。通道顺序 RGB（实测确认）。
 */
function postprocess(
  out: Float32Array,
  dims: number[],
  norm: SRNormalization,
): Uint8ClampedArray {
  const H = dims[2];
  const W = dims[3];
  const N = H * W;
  const rgba = new Uint8ClampedArray(N * 4);
  const denorm = norm === 'pm1';
  for (let p = 0; p < N; p++) {
    let ch0 = out[p]; // R
    let ch1 = out[N + p]; // G
    let ch2 = out[2 * N + p]; // B
    if (denorm) {
      ch0 = ch0 * 0.5 + 0.5;
      ch1 = ch1 * 0.5 + 0.5;
      ch2 = ch2 * 0.5 + 0.5;
    }
    rgba[p * 4] = ch0 * 255;
    rgba[p * 4 + 1] = ch1 * 255;
    rgba[p * 4 + 2] = ch2 * 255;
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

/**
 * 单块端侧推理：RGB 字节 → RGBA（base64）。
 *
 * 这是「分块超分」的核心：WebView 把图切成 192px 的核心块（带 16px 重叠），
 * 每块单独送进来推理，结果由 WebView 按核心区拼接。
 *
 * 注意：CUGAN / up4x 这类模型内部有 PixelUnshuffle，要求 H/W 是 4 的倍数，
 * 所以这里先把块补齐到 8 的倍数（边缘复制），多出来的边由 WebView 裁掉。
 */
export async function runTile(
  model: SRModel,
  tile: SRTile,
  onProgress?: (fraction: number) => void,
): Promise<SRTileOut> {
  const session = await getSession(model, onProgress);
  const {w, h, rgb} = tile;

  const padW = Math.ceil(w / 8) * 8;
  const padH = Math.ceil(h / 8) * 8;
  const N = padW * padH;
  const f32 = new Float32Array(N * 3);
  const scale = model.norm === 'pm1' ? 1 / 127.5 : 1 / 255;
  const bias = model.norm === 'pm1' ? -1 : 0;

  for (let y = 0; y < padH; y++) {
    const sy = y < h ? y : h - 1; // 超出部分复制最后一行
    for (let x = 0; x < padW; x++) {
      const sx = x < w ? x : w - 1;
      const src = (sy * w + sx) * 3;
      const p = y * padW + x;
      f32[p] = rgb[src] * scale + bias;
      f32[N + p] = rgb[src + 1] * scale + bias;
      f32[2 * N + p] = rgb[src + 2] * scale + bias;
    }
  }

  const tensor = new Tensor('float32', f32, [1, 3, padH, padW]);
  const feeds: Record<string, Tensor> = {};
  feeds[session.inputNames[0]] = tensor;

  const results = await session.run(feeds);
  const outTensor = results[session.outputNames[0]] as Tensor;
  if (!outTensor) {
    throw new Error('模型没有返回输出张量');
  }
  const outData = outTensor.data as Float32Array;
  const outDims = outTensor.dims as number[];
  if (outDims.length !== 4 || outDims[1] !== 3) {
    throw new Error(
      `输出张量形状异常：[${outDims.join(', ')}]，该模型可能不被运行时支持`,
    );
  }

  const rgba = postprocess(outData, outDims, model.norm);
  return {
    idx: tile.idx,
    b64: bytesToBase64(rgba),
    w: outDims[3],
    h: outDims[2],
  };
}

/** 释放某模型的会话（切换模型时调用，避免常驻内存）。 */
export function releaseSession(modelId: string): void {
  const s = sessionCache.get(modelId);
  if (s) {
    s.release?.();
    sessionCache.delete(modelId);
  }
}
