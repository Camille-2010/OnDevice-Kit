import {Model, GGUFMetadata, ContextInitParams, CacheType} from './types';

// Guards against corrupted metadata persisted by older app versions.
function isValidGGUFMetadata(metadata: GGUFMetadata): boolean {
  const requiredFields = [
    metadata.n_layers,
    metadata.n_embd,
    metadata.n_head,
    metadata.n_head_kv,
    metadata.n_vocab,
    metadata.n_embd_head_k,
    metadata.n_embd_head_v,
  ];

  return requiredFields.every(
    value => typeof value === 'number' && !isNaN(value) && value > 0,
  );
}

// Sizes mirror llama.cpp's cache types.
export function getKVCacheTypeBytes(cacheType: string): number {
  const typeMap: Record<string, number> = {
    f32: 4.0,
    f16: 2.0,
    bf16: 2.0,
    q8_0: 1.0625, // 34/32
    q4_0: 0.5625, // 18/32
    q4_1: 0.625, // 20/32
    q5_0: 0.6875, // 22/32
    q5_1: 0.75, // 24/32
  };
  return typeMap[cacheType.toLowerCase()] || 2.0; // Default to f16
}

function calculateKVCacheMemory(
  metadata: GGUFMetadata,
  contextSettings: ContextInitParams,
): number {
  // Defensive: Convert to numbers in case metadata was persisted as strings
  const n_layers = Number(metadata.n_layers);
  const n_embd_head_k = Number(metadata.n_embd_head_k);
  const n_embd_head_v = Number(metadata.n_embd_head_v);
  const n_head_kv = Number(metadata.n_head_kv);
  const sliding_window = metadata.sliding_window
    ? Number(metadata.sliding_window)
    : undefined;

  const {n_ctx, cache_type_k, cache_type_v} = contextSettings;

  // For SWA (Sliding Window Attention) models like Gemma
  const effectiveCtx = sliding_window ? Math.min(n_ctx, sliding_window) : n_ctx;

  // Calculate key and value cache separately (may have different quantization)
  const bytesPerK = getKVCacheTypeBytes(cache_type_k || 'f16');
  const bytesPerV = getKVCacheTypeBytes(cache_type_v || 'f16');

  const keyCacheSize =
    n_layers * effectiveCtx * n_embd_head_k * n_head_kv * bytesPerK;
  const valueCacheSize =
    n_layers * effectiveCtx * n_embd_head_v * n_head_kv * bytesPerV;

  return keyCacheSize + valueCacheSize;
}

function calculateComputeBuffer(
  metadata: GGUFMetadata,
  contextSettings: ContextInitParams,
): number {
  // Defensive: Convert to numbers in case metadata was persisted as strings
  const n_vocab = Number(metadata.n_vocab);
  const n_embd = Number(metadata.n_embd);
  const {n_ubatch} = contextSettings;

  return (n_vocab + n_embd) * n_ubatch * 4;
}

const RUNTIME_OVERHEAD = 1.1;
const RUNTIME_OVERHEAD_WITHOUT_METADATA = 1.2;

/**
 * mmap 开启时，权重只有「当前活跃的那部分」真正占着进程内存，
 * 其余页在内核页缓存里、内存紧张时可被换出。llama.cpp 推理过程中大约
 * 30~50% 的权重页会被反复访问，所以只按这一部分计入常驻估算。
 *
 * mmap 关闭时权重是完整 read 进堆内存的**匿名页，不可回收**，全额计入。
 *
 * 这一条如果搞反，会出现两种都很糟的结果：mmap 下按全额算 → 明明跑得动
 * 却报「内存不足」；非 mmap 下打折算 → 真 OOM 了还提示可以加载。
 */
const MMAP_WEIGHT_RESIDENT_RATIO = 0.45;

/** 权重在内存中的实际占用估算 */
function estimateWeightsResident(
  sizeBytes: number,
  contextSettings?: ContextInitParams,
): number {
  const useMmap = contextSettings?.use_mmap;
  // undefined 视为未知，走保守的全额（与改动前一致）
  const isMmap = useMmap === 'true' || useMmap === 'smart';
  return isMmap ? sizeBytes * MMAP_WEIGHT_RESIDENT_RATIO : sizeBytes;
}

export function getModelMemoryRequirement(
  model: Model,
  projectionModel?: Model,
  contextSettings?: ContextInitParams,
  draftModel?: Model,
): number {
  const mmProjSize = projectionModel?.size || 0;
  const draftSize = draftModel?.size || 0;

  // A paired draft runs with its own KV cache, sized by the target's n_ctx —
  // there is no separate draft n_ctx.
  let draftKvCacheSize = 0;
  if (
    draftModel?.ggufMetadata &&
    contextSettings &&
    isValidGGUFMetadata(draftModel.ggufMetadata)
  ) {
    draftKvCacheSize = calculateKVCacheMemory(draftModel.ggufMetadata, {
      ...contextSettings,
      cache_type_k: (contextSettings.spec_draft_cache_type_k ||
        'f16') as CacheType,
      cache_type_v: (contextSettings.spec_draft_cache_type_v ||
        'f16') as CacheType,
    });
  }

  if (
    model.ggufMetadata &&
    contextSettings &&
    isValidGGUFMetadata(model.ggufMetadata)
  ) {
    const metadata = model.ggufMetadata;
    // mmap 下权重只按常驻部分算（见上面的说明）
    const weightsSize = estimateWeightsResident(model.size, contextSettings);
    const kvCacheSize = calculateKVCacheMemory(metadata, contextSettings);
    const computeBuffer = calculateComputeBuffer(metadata, contextSettings);

    const baseMemory = weightsSize + kvCacheSize + computeBuffer;
    const totalMemory =
      baseMemory * RUNTIME_OVERHEAD +
      estimateWeightsResident(mmProjSize, contextSettings) * RUNTIME_OVERHEAD +
      (draftSize + draftKvCacheSize) * RUNTIME_OVERHEAD;

    return totalMemory;
  }

  // 没有 GGUF metadata 时无从判断 mmap 行为，保守按全额算，
  // 宁可提示用户也别让它 OOM 崩掉
  const totalSize = model.size + mmProjSize + draftSize;
  const estimated = totalSize * RUNTIME_OVERHEAD_WITHOUT_METADATA;

  return estimated;
}
