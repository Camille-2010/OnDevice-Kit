/**
 * 视觉能力探测：读一个 GGUF 的头部 KV，回答两个问题 ——
 *
 *   1. 这个文件是「投影模型（mmproj）」吗？
 *      判据：architecture 是 clip / siglip / vit 之类，或者 KV 里有
 *      `clip.*` / `mmproj.*` 前缀的键。
 *
 *   2. 这个文件（作为主模型）能接上某个投影模型吗？
 *      判据：拿投影器的 `clip.projector_type` 和主模型的 architecture
 *      做族匹配（见 PROJECTOR_COMPAT）。
 *
 * 为什么必须真读文件而不是猜文件名：
 *   把不兼容的 mmproj 绑给一个文本模型，llama.cpp 在加载时会直接报错，
 *   不是能滑过去的事。所以「能不能加视觉」必须基于文件里的真实元数据。
 *
 * 实现上复用了 MTP 探测器那套「按长度前缀跳过不需要的值」的解析：
 *   tokenizer 词表动辄十万条字符串，全量物化会很慢；这里只解我们关心的
 *   几个键，其余一律 seek 过去。
 */
import * as RNFS from '@dr.pogodin/react-native-fs';

const GGUF_MAGIC = 0x46554747; // "GGUF" read as LE u32

/** 头部最大读入量：GGUF 的 KV 段一般远小于这个数 */
const LOCAL_READ_BUDGET = 64 * 1024 * 1024;
const READ_CHUNK = 4 * 1024 * 1024;

const MAX_KV_COUNT = 4096;
const MAX_KEY_LENGTH = 4096;
const MAX_ARRAY_COUNT = 32 * 1024 * 1024;

const enum GGUFType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12,
}

const FIXED_SIZES: Partial<Record<number, number>> = {
  [GGUFType.UINT8]: 1,
  [GGUFType.INT8]: 1,
  [GGUFType.BOOL]: 1,
  [GGUFType.UINT16]: 2,
  [GGUFType.INT16]: 2,
  [GGUFType.UINT32]: 4,
  [GGUFType.INT32]: 4,
  [GGUFType.FLOAT32]: 4,
  [GGUFType.UINT64]: 8,
  [GGUFType.INT64]: 8,
  [GGUFType.FLOAT64]: 8,
};

/** 严格够用的 UTF-8 解码（Hermes 没有 TextDecoder） */
const decodeUtf8 = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
    } else if (b0 < 0xe0) {
      out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b0 < 0xf0) {
      out += String.fromCharCode(
        ((b0 & 0x0f) << 12) |
          ((bytes[i + 1] & 0x3f) << 6) |
          (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return out;
};

/** 按需从本地文件读字节的游标读取器（顺序前缀，和 HTTP 版同构） */
class LocalReader {
  private bytes = new Uint8Array(0);
  private view = new DataView(new ArrayBuffer(0));
  private eof = false;

  constructor(private readonly path: string) {}

  private async ensure(end: number): Promise<void> {
    if (end > LOCAL_READ_BUDGET) {
      throw new Error('gguf header read past byte budget');
    }
    while (this.bytes.byteLength < end && !this.eof) {
      const from = this.bytes.byteLength;
      // 一次尽量读够（按 4MB 对齐往上取），减少 RNFS 往返次数。
      // 之前写成 Math.min(READ_CHUNK, ...) 会导致每次只读 4MB，
      // 解析长头部时要来回很多趟。
      const need = end - from;
      const len = Math.max(
        READ_CHUNK,
        Math.ceil(need / READ_CHUNK) * READ_CHUNK,
      );
      // base64 是 RNFS 在 Android 上唯一稳定的二进制读法
      const b64 = await RNFS.read(this.path, len, from, 'base64');
      if (!b64) {
        this.eof = true;
        break;
      }
      const chunk = base64ToBytes(b64);
      if (chunk.byteLength === 0) {
        this.eof = true;
        break;
      }
      const grown = new Uint8Array(this.bytes.byteLength + chunk.byteLength);
      grown.set(this.bytes);
      grown.set(chunk, this.bytes.byteLength);
      this.bytes = grown;
      this.view = new DataView(grown.buffer);
      if (chunk.byteLength < len) {
        this.eof = true;
      }
    }
    if (this.bytes.byteLength < end) {
      throw new Error('gguf header truncated');
    }
  }

  async u32(offset: number): Promise<number> {
    await this.ensure(offset + 4);
    return this.view.getUint32(offset, true);
  }

  async u64(offset: number): Promise<number> {
    await this.ensure(offset + 8);
    const value = this.view.getBigUint64(offset, true);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('gguf length exceeds safe integer range');
    }
    return Number(value);
  }

  async i64(offset: number): Promise<number> {
    await this.ensure(offset + 8);
    return Number(this.view.getBigInt64(offset, true));
  }

  async f64(offset: number): Promise<number> {
    await this.ensure(offset + 8);
    return this.view.getFloat64(offset, true);
  }

  async f32(offset: number): Promise<number> {
    await this.ensure(offset + 4);
    return this.view.getFloat32(offset, true);
  }

  async slice(offset: number, length: number): Promise<Uint8Array> {
    await this.ensure(offset + length);
    return this.bytes.subarray(offset, offset + length);
  }

  async skip(offset: number, length: number): Promise<number> {
    await this.ensure(offset + length);
    return offset + length;
  }
}

/** 纯 JS 的 base64 解码（Hermes 没有 atob） */
const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Int16Array = (() => {
  const t = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) {
    t[B64_CHARS.charCodeAt(i)] = i;
  }
  return t;
})();

const base64ToBytes = (b64: string): Uint8Array => {
  let len = b64.length;
  while (len > 0 && b64[len - 1] === '=') {
    len--;
  }
  // 上界按 ceil(len*3/4) 取，宁大勿小 —— 小了下标会写越界被静默丢弃，
  // 结果是「文件读少了一个字节」，GGUF 头部解析会莫名其妙地失败。
  const out = new Uint8Array(Math.ceil((len * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const v = B64_LOOKUP[b64.charCodeAt(i)];
    if (v < 0) {
      continue;
    }
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
};

export interface GgufVisionProbe {
  /** 读到了头部并成功解析 */
  ok: boolean;
  /** general.architecture 的小写值 */
  architecture?: string;
  /** clip.projector_type（mmproj 才有） */
  projectorType?: string;
  /** 是否含 clip.* / mmproj.* 键 → 基本可以断定是投影模型 */
  hasClipKeys: boolean;
  /** 这个文件看起来是投影模型 */
  isProjection: boolean;
  /** 探测过程中的错误信息 */
  error?: string;
}

/** architecture 里代表「视觉编码器」的值 */
const PROJECTION_ARCH_RE =
  /^(clip|siglip|vit|pixtral|qwen2vl_merger|internvl)/i;

/** 读一个本地 GGUF 的视觉相关元数据 */
export const probeLocalGgufVision = async (
  path: string,
): Promise<GgufVisionProbe> => {
  const reader = new LocalReader(path);

  const empty: GgufVisionProbe = {
    ok: false,
    hasClipKeys: false,
    isProjection: false,
  };

  try {
    if ((await reader.u32(0)) !== GGUF_MAGIC) {
      return {...empty, error: '不是 GGUF 文件'};
    }
    const version = await reader.u32(4);
    if (version < 1 || version > 3) {
      return {...empty, error: `不支持的 GGUF 版本 ${version}`};
    }
    const len = async (offset: number): Promise<[number, number]> =>
      version === 1
        ? [await reader.u32(offset), offset + 4]
        : [await reader.u64(offset), offset + 8];

    let offset = 8;
    let kvCount: number;
    [, offset] = await len(offset);
    [kvCount, offset] = await len(offset);
    if (kvCount > MAX_KV_COUNT) {
      return {...empty, error: 'GGUF KV 数量超出预期'};
    }

    const skipValue = async (
      type: number,
      at: number,
      depth: number,
    ): Promise<number> => {
      if (depth > 2) {
        throw new Error('gguf nesting too deep');
      }
      if (type === GGUFType.STRING) {
        const [n, after] = await len(at);
        return reader.skip(after, n);
      }
      if (type === GGUFType.ARRAY) {
        const elemType = await reader.u32(at);
        const [count, afterCount] = await len(at + 4);
        if (count > MAX_ARRAY_COUNT) {
          throw new Error('gguf array too long');
        }
        let next = afterCount;
        const elemFixed = FIXED_SIZES[elemType];
        if (elemFixed !== undefined) {
          return reader.skip(next, count * elemFixed);
        }
        for (let i = 0; i < count; i++) {
          next = await skipValue(elemType, next, depth + 1);
        }
        return next;
      }
      const fixed = FIXED_SIZES[type];
      if (fixed !== undefined) {
        return reader.skip(at, fixed);
      }
      throw new Error(`未知的 GGUF 值类型 ${type}`);
    };

    let architecture: string | undefined;
    let projectorType: string | undefined;
    let hasClipKeys = false;

    for (let i = 0; i < kvCount; i++) {
      const [keyLen, afterLen] = await len(offset);
      if (keyLen > MAX_KEY_LENGTH) {
        throw new Error('gguf key length out of range');
      }
      const key = decodeUtf8(await reader.slice(afterLen, keyLen));
      const typeAt = afterLen + keyLen;
      const valueType = await reader.u32(typeAt);
      const valueAt = typeAt + 4;

      const lower = key.toLowerCase();
      if (lower.startsWith('clip.') || lower.startsWith('mmproj.')) {
        hasClipKeys = true;
      }

      // 只解我们真正需要的两个字符串键，其余全部 seek 掉
      if (valueType === GGUFType.STRING) {
        const [n, after] = await len(valueAt);
        if (
          lower === 'general.architecture' ||
          lower === 'clip.projector_type'
        ) {
          const raw = await reader.slice(after, n);
          const val = decodeUtf8(raw);
          if (lower === 'general.architecture') {
            architecture = val.toLowerCase();
          } else {
            projectorType = val;
          }
        }
        offset = await reader.skip(after, n);
      } else {
        offset = await skipValue(valueType, valueAt, 0);
      }
    }

    const isProjection =
      hasClipKeys || (!!architecture && PROJECTION_ARCH_RE.test(architecture));

    return {ok: true, architecture, projectorType, hasClipKeys, isProjection};
  } catch (e: any) {
    return {...empty, error: e?.message ?? String(e)};
  }
};

/**
 * 投影器类型 → 能接的主模型 architecture 族。
 *
 * 这些对应 llama.cpp 的 mtmd 实现：projector_type 决定它输出什么维度的
 * 视觉 embedding，主模型必须用同一套视觉塔才接得上。
 * 拿不准的一律**不放行**（返回 false），避免用户点了「绑定」之后
 * 加载模型直接报错。
 */
const PROJECTOR_COMPAT: Record<string, string[]> = {
  // Qwen2-VL / Qwen2.5-VL 系列：merger 输出接 qwen2vl / qwen25vl
  qwen2vl_merger: ['qwen2vl', 'qwen2.5vl', 'qwen25vl'],
  'qwen2.5vl_merger': ['qwen2vl', 'qwen2.5vl', 'qwen25vl'],
  // Qwen3-VL：llama.cpp 的 mtmd 用 clip.projector_type = qwen3vl_merger。
  // 以前只列了 qwen2vl，导致 Qwen3-VL 的 mmproj 永远判成「不兼容」——
  // 用户在别的 App 里能绑，这里点绑定直接说无法绑定。
  qwen3vl_merger: ['qwen3vl', 'qwen3-vl', 'qwen3vl_moe'],
  qwen3vlmoe_merger: ['qwen3vlmoe', 'qwen3vl_moe', 'qwen3vl'],
  // LLaVA 系：经典 clip + mlp，接 llama 系的 llava 架构
  mlp: ['llava', 'llava1.5', 'bunnyllama', 'llava-qwen', 'llavaqwen'],
  // Gemma 3 / SmolVLM / 一般 siglip 系
  gemma3: ['gemma3', 'gemma3n'],
  smolvlm: ['smollm', 'smolvlm', 'llama'],
  // InternVL
  internvl: ['internvl', 'internvl2'],
  // MiniCPM-V
  minicpmv: ['minicpmv', 'qwen2vl'],
  // 通用 clip 投影器（老的 llava 风格）
  clip: ['llava', 'llava1.5', 'bunnyllama', 'llava-qwen', 'llavaqwen'],
};

/**
 * 判断一个投影模型能不能接到某个主模型上。
 *
 * @param mainArch  主模型的 general.architecture（小写）
 * @param projector 投影模型的 clip.projector_type（可能为空）
 * @param mainName  主模型文件名（兜底用）
 * @param projName  投影模型文件名（兜底用）
 */
export const isProjectorCompatible = (
  mainArch: string | undefined,
  projector: string | undefined,
  mainName: string,
  projName: string,
): boolean => {
  // 1) 有 projector_type 时按表匹配（最可靠）
  if (projector) {
    const key = projector.toLowerCase();
    const allowed = PROJECTOR_COMPAT[key];
    if (allowed && mainArch) {
      const hit = allowed.some(a => mainArch.includes(a));
      // 留一条日志：兼容表是按 llama.cpp 的 mtmd 实现整理的，
      // 万一某个转换器写出的 projector_type 值不在表里，这条日志
      // 能一眼看出「实际读到的值是什么」，方便补表。
      console.log(
        '[visionProbe] 按表匹配 projector=%s mainArch=%s -> %s',
        projector,
        mainArch,
        hit,
      );
      return hit;
    }
    console.log(
      '[visionProbe] projector_type=%s 不在兼容表里，改用文件名兜底（mainArch=%s）',
      projector,
      mainArch,
    );
  }
  // 2) 主模型 architecture 本身就是多模态架构 → 直接放行
  if (mainArch) {
    const visionArchRe =
      /(vl|vision|llava|internvl|minicpm|gemma3|pixtral|idefics|paligemma)/i;
    if (visionArchRe.test(mainArch)) {
      console.log('[visionProbe] 主模型架构 %s 本身是多模态，放行', mainArch);
      return true;
    }
  }
  // 3) 最后才用文件名：两者名字里带同一个模型族关键词
  const family = (s: string) =>
    (s.toLowerCase().match(/[a-z0-9.]{3,}/g) ?? []).filter(
      w =>
        !/^(gguf|mmproj|f16|f32|bf16|q\d|q\d_k|q\d_k_m|it|instruct|model)$/.test(
          w,
        ),
    );
  const a = new Set(family(mainName));
  const hit = family(projName).some(w => a.has(w));
  console.log(
    '[visionProbe] 文件名兜底 main=%s proj=%s -> %s',
    mainName,
    projName,
    hit,
  );
  if (hit) {
    return true;
  }

  // 4) 完全读不到 projector 信息 → 不判死，放行。
  //
  // 2026-10-19 用户反馈：在别的 App 能绑的 mmproj，这里说「不是视觉模型」。
  // 根因是 content:// 零拷贝导入的 mmproj 读不到 GGUF 头，projector_type
  // 和 architecture 全空 —— 于是一路掉到文件名兜底；而 mmproj 的文件名
  // 里通常只有 `mmproj-model-f16` 这种词，跟主模型族名没有任何交集，
  // 必然判成「不兼容」。
  //
  // 判断依据不足时不该拦住用户：绑错了 llama.cpp 加载会报明确错误
  //（Failed to initialize multimodal context），比「根本不让绑」可诊断得多。
  // 只要**读到了** projector_type 且和主架构对不上，上面的分支已经拒绝。
  if (!projector) {
    console.log(
      '[visionProbe] projector 类型未知（读不到 GGUF 头），无法判断兼容性 → 放行',
    );
    return true;
  }
  return false;
};
