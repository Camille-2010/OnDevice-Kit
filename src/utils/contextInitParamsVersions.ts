// When adding a parameter:
// 1. Add it to createContextInitParams
// 2. Increment CURRENT_CONTEXT_INIT_PARAMS_VERSION
// 3. Add a migration step in migrateContextInitParams

import {ContextParams} from 'llama.rn';
import {ContextInitParams, LegacyContextInitParams} from './types';
import {Tier} from '../services/deviceRules/types';
import {Platform} from 'react-native';

export const CURRENT_CONTEXT_INIT_PARAMS_VERSION = '2.4';

export const createContextInitParams = (
  params: Omit<ContextParams, 'model'>,
): ContextInitParams => {
  // Convert boolean use_mmap to string format
  const use_mmap =
    params.use_mmap === true
      ? 'true'
      : params.use_mmap === false
        ? 'false'
        : (params.use_mmap ?? 'true');

  // Handle flash_attn_type (new) vs flash_attn (old)
  const flash_attn_type =
    (params as any).flash_attn_type ?? (Platform.OS === 'ios' ? 'auto' : 'off');

  return {
    ...params,
    use_mmap,
    version: CURRENT_CONTEXT_INIT_PARAMS_VERSION,
    // Ensure all required fields have values (with fallbacks for safety)
    n_ctx: params.n_ctx ?? 2048, // Increased default from 1024
    n_batch: params.n_batch ?? 512,
    n_ubatch: params.n_ubatch ?? 512,
    n_threads: params.n_threads ?? 4,
    cache_type_k: params.cache_type_k ?? 'f16',
    cache_type_v: params.cache_type_v ?? 'f16',
    n_gpu_layers: params.n_gpu_layers ?? 99, // Changed default from 0 to 99
    use_mlock: params.use_mlock ?? false,

    // New parameters (v2.0+)
    flash_attn_type,
    devices: (params as any).devices,
    kv_unified: (params as any).kv_unified ?? true, // CRITICAL default
    n_parallel: (params as any).n_parallel ?? 1, // Blocking completion only

    // v2.1+
    image_max_tokens: (params as any).image_max_tokens ?? 512, // Device-appropriate default

    // v2.2+
    no_extra_bufts: (params as any).no_extra_bufts ?? false, // Default ON: repack enabled (mmap OFF + repack ON is optimal on Android)

    speculativeEnabled: (params as any).speculativeEnabled ?? false,
  };
};

export function migrateContextInitParams(
  params: ContextInitParams | LegacyContextInitParams | any,
): ContextInitParams {
  // Clone the params to avoid modifying the original
  const migratedParams = {...params};

  // If no version is specified, assume it's legacy (pre-versioning)
  if (migratedParams.version === undefined) {
    migratedParams.version = '0.0';
  }

  // Apply migrations sequentially
  if (migratedParams.version === '0.0' || !migratedParams.version) {
    // Migration from legacy (no version) to 1.0

    // Handle n_context -> n_ctx migration (legacy property name change)
    if ('n_context' in migratedParams && !('n_ctx' in migratedParams)) {
      migratedParams.n_ctx = migratedParams.n_context;
      delete migratedParams.n_context;
    }

    // Ensure all required fields have default values if missing
    if (migratedParams.use_mlock === undefined) {
      migratedParams.use_mlock = false;
    }

    if (migratedParams.use_mmap === undefined) {
      migratedParams.use_mmap = Platform.OS === 'android' ? 'smart' : 'true';
    } else if (typeof migratedParams.use_mmap === 'boolean') {
      // Convert boolean to string format
      migratedParams.use_mmap = migratedParams.use_mmap ? 'true' : 'false';
    }

    if (migratedParams.no_gpu_devices === undefined) {
      migratedParams.no_gpu_devices = false;
    }

    migratedParams.version = '1.0';
  }

  // Migration from 1.0 to 2.0: no_gpu_devices → devices, flash_attn → flash_attn_type
  if (migratedParams.version === '1.0') {
    // Migrate no_gpu_devices to devices
    if ('no_gpu_devices' in migratedParams) {
      if (migratedParams.no_gpu_devices === true) {
        // GPU was disabled → set n_gpu_layers to 0, devices undefined (will use CPU)
        migratedParams.n_gpu_layers = 0;
        migratedParams.devices = undefined;
      } else {
        // GPU was enabled → use auto-select
        migratedParams.devices = undefined;
        // Keep existing n_gpu_layers value (or default to 99 if not set)
        if (
          migratedParams.n_gpu_layers === undefined ||
          migratedParams.n_gpu_layers === 0
        ) {
          migratedParams.n_gpu_layers = 99;
        }
      }

      // no_gpu_devices is kept on the record: deprecated, not yet removed.
    }

    // Migrate flash_attn boolean to flash_attn_type string
    if (
      'flash_attn' in migratedParams &&
      typeof migratedParams.flash_attn === 'boolean'
    ) {
      if (migratedParams.flash_attn) {
        // Flash attention was enabled
        migratedParams.flash_attn_type = Platform.OS === 'ios' ? 'auto' : 'off';
      } else {
        // Flash attention was disabled
        migratedParams.flash_attn_type = 'off';
      }

      // flash_attn is kept on the record: deprecated, not yet removed.
    } else if (!migratedParams.flash_attn_type) {
      // No flash_attn or flash_attn_type, set platform-specific default
      migratedParams.flash_attn_type = Platform.OS === 'ios' ? 'auto' : 'off';
    }

    // Add new required parameters with defaults
    if (migratedParams.kv_unified === undefined) {
      migratedParams.kv_unified = true;
    }

    if (migratedParams.n_parallel === undefined) {
      migratedParams.n_parallel = 1; // App only uses blocking completion()
    }

    // Increase default context size if it was the old default
    if (migratedParams.n_ctx === 1024) {
      migratedParams.n_ctx = 2048; // Increase to new recommended default
    }

    migratedParams.version = '2.0';
  }

  // Migration from 2.0 to 2.1: image_max_tokens
  if (migratedParams.version === '2.0') {
    // Add image_max_tokens with device-appropriate default
    if (migratedParams.image_max_tokens === undefined) {
      migratedParams.image_max_tokens = 512;
    }

    migratedParams.version = '2.1';
  }

  // Migration from 2.1 to 2.2: enable repack + disable mmap on Android
  if (migratedParams.version === '2.1') {
    // Enable weight repacking (no_extra_bufts=false means repack ON)
    if (migratedParams.no_extra_bufts === undefined) {
      migratedParams.no_extra_bufts = false;
    }

    // Migrate 'smart' mmap to 'false' on Android (mmap OFF + repack ON is optimal)
    if (Platform.OS === 'android' && migratedParams.use_mmap === 'smart') {
      migratedParams.use_mmap = 'false';
    }

    migratedParams.version = '2.2';
  }

  if (migratedParams.version === '2.2') {
    if (migratedParams.speculativeEnabled === undefined) {
      migratedParams.speculativeEnabled = false;
    }

    migratedParams.version = '2.3';
  }

  if (migratedParams.version === '2.3') {
    /**
     * 2.3 → 2.4：Android 上把 use_mmap 从 'false' 纠正为 'true'。
     *
     * 旧默认把权重整块 read 进堆内存，导致 4B 级 Q4 模型（约 2.3GB）在
     * 6~8GB 手机上直接 OOM。用户反馈「同一个模型别的 App 能跑，我们提示
     * 内存不足 / 加载失败」，根因就在这里。
     *
     * 只在 Android 且值确实是旧默认 'false' 时改；用户手动设过的其他值
     * （'true' / 'smart'）原样保留。
     */
    if (Platform.OS === 'android' && migratedParams.use_mmap === 'false') {
      migratedParams.use_mmap = 'true';
    }

    migratedParams.version = '2.4';
  }

  // Ensure the final version is set correctly
  migratedParams.version = CURRENT_CONTEXT_INIT_PARAMS_VERSION;

  return migratedParams as ContextInitParams;
}

export function validateContextInitParams(
  params: any,
): params is ContextInitParams {
  const requiredFields = [
    'version',
    'n_ctx',
    'n_batch',
    'n_ubatch',
    'n_threads',
    'cache_type_k',
    'cache_type_v',
    'n_gpu_layers',
    'use_mlock',
    'use_mmap',
  ];

  return requiredFields.every(field => field in params);
}

export function createDefaultContextInitParams(): ContextInitParams {
  return {
    version: CURRENT_CONTEXT_INIT_PARAMS_VERSION,
    n_ctx: 2048,
    n_batch: 512,
    n_ubatch: 512,
    n_threads: 4,
    cache_type_k: 'f16',
    cache_type_v: 'f16',
    // 2026-10-19：原来这里是 99（全部层）。开满的代价是显存线性上升，
    // 低端机容易 GPU OOM / 闪退，而 CPU 侧 mmap 权重内核可换出、更安全。
    // 这里给一个保守的兜底值，真正的值由 ModelStore 按 deviceTier 覆盖
    // （low 0 / mid 8 / high 16 / flagship 24）。
    n_gpu_layers: 8,
    use_mlock: false,
    /**
     * mmap —— 大模型能不能在手机上跑起来的**决定性开关**。
     *
     * 之前 Android 上是 'false'，权重被完整 read 进堆内存：一个 2.33GB 的
     * Q4_K_M 就实打实吃掉 2.33GB RAM，再加上 KV cache / compute buffer /
     * mmproj，6GB 机器必然 OOM—— 表现就是「同一个模型别人的 App 能跑、
     * 我们的报内存不足 / 加载失败」。
     *
     * mmap = false 时权重是**不可回收**的匿名内存；mmap = true 时权重由
     * 内核页缓存管理，紧张时可以被换出，这是 llama.cpp 在移动端的标准做法。
     */
    use_mmap: 'true',

    // New v2.0 parameters
    devices: undefined, // Auto-select
    flash_attn_type: Platform.OS === 'ios' ? 'auto' : 'off',
    kv_unified: true, // CRITICAL: saves ~7GB memory
    n_parallel: 1, // App only uses blocking completion()

    // v2.1 parameters
    image_max_tokens: 512, // Device-appropriate default

    // v2.2 parameters
    // 注意：这一项是 llama.cpp 的 KV cache 量化开关，和权重加载方式无关，
    // 之前把它和「mmap OFF」写在一起当理由是误解。权重照常 mmap。
    no_extra_bufts: false,

    speculativeEnabled: false,
  };
}

/**
 * 按设备档位给出**默认 GPU 层数**。
 *
 * ⚠️ 关键原则：**任何档位都不给满**（不用 99 / 不等于总层数）。
 *
 * 为什么不能开满：
 * 1. llama.cpp 的最后一层（output / 采样相关）放 GPU 上几乎没有加速收益，
 *    纯占显存；
 * 2. GPU 层数越多，**显存**需求线性上升。低端机 GPU 显存只有几百 MB，
 *    开满极易 GPU OOM / 整机闪退，而 CPU 侧 mmap 权重是可以被内核换出的；
 * 3. 混部（部分层 GPU、部分层 CPU）时每层来回搬数据，层数过多反而比
 *    全 CPU 更慢。
 *
 * 各档取值（用户可在「加载配置」里手动调高）：
 * | 档位 | GPU 层数 | 理由 |
 * |---|---|---|
 * | low      | 0   | 纯 CPU 最稳。低内存设备 GPU 显存小，开 GPU 常直接闪退 |
 * | mid      | 12  | 6-8G 机器，少量层试水，显存可控 |
 * | high     | 90% | 8-12G 机器，按模型层数 ×0.9 尽量多放 |
 * | flagship | 90% | 12G+ 机器，同样 ×0.9，留一成显存余量 |
 * | 未知     | 12  | 拿不到档位时的保守值 |
 */
export const defaultGpuLayersForTier = (tier?: Tier | null): number => {
  switch (tier) {
    case 'low':
      return 0;
    case 'mid':
      return 12;
    case 'high':
      return 99; // 占位符 → 加载时折算为 90% 层
    case 'flagship':
      return 99; // 占位符 → 加载时折算为 90% 层
    default:
      return 12;
  }
};

/**
 * 把 `99`（档位给的「尽量全占」占位符）折算成模型层数的 **90%**。
 *
 * 为什么不给 100%：
 * 1. 最后一层（output / 采样）放 GPU 几乎没有加速收益，纯占显存；
 * 2. 手机 GPU 显存与系统内存共享，占满会拖垮整机（掉帧 / OOM）。
 * 用户手动调过的具体层数（8 / 20 / 28…）原样返回，不做折算。
 */
export const resolveGpuLayersForModel = (
  requested: number | undefined,
  layerCount: number | undefined,
): number | undefined => {
  if (requested !== 99 || !layerCount || layerCount <= 0) {
    return requested;
  }
  return Math.max(1, Math.round(layerCount * 0.9));
};
