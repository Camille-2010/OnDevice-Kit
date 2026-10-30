import {AppState, AppStateStatus, Platform, Alert} from 'react-native';
import DeviceInfo from 'react-native-device-info';

import {v4 as uuidv4} from 'uuid';
import 'react-native-get-random-values';
import {makePersistable} from 'mobx-persist-store';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {keepLocalCopy} from '@react-native-documents/picker';
import {
  resolveLoadPath,
  isProcFdPath,
  pickGgufFile,
  probeUri,
  resolveRealPathIfAccessible,
  isAllFilesAccessGranted,
  requestAllFilesAccess,
} from '../services/modelUri';
import {computed, makeAutoObservable, runInAction, toJS} from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ContextParams, LlamaContext, initLlama} from 'llama.rn';
import {
  CompletionParams,
  CompletionEngine,
  toApiCompletionParams,
} from '../utils/completionTypes';

import {fetchModelFilesDetails} from '../api/hf';
import {profileFor} from '../api/servers';
import {
  LocalCompletionEngine,
  OpenAICompletionEngine,
} from '../api/completionEngines';

import {uiStore, hfStore} from '.';
import {serverStore} from './ServerStore';
import {chatSessionStore} from './ChatSessionStore';
import {
  draftCacheDefaults,
  effectiveDraftModeOf,
  resolveDraftCandidate,
  resolveDraftModelId,
  unpairedDraftCandidate,
} from './draftResolution';
import {checkGpuSupport} from '../utils/deviceCapabilities';
import {resolveDeviceSelection} from '../utils/deviceSelection';
import {
  deepMerge,
  getSHA256Hash,
  hfAsModel,
  getMmprojFiles,
  filterProjectionModels,
  inferRepoFromModelId,
  parseSizeLabel,
  formatBytes,
} from '../utils';
import {getRecommendedProjectionModel} from '../utils/multimodalHelpers';
import {isDraftOnlyModel} from '../utils/mtp';
import {
  isProjectionArch,
  isProjectionByFilename,
  isVisionLLMArch,
  isVisionLLMByFilename,
} from '../utils/modelKind';
import {
  probeLocalGgufVision,
  isProjectorCompatible,
  type GgufVisionProbe,
} from '../utils/visionProbe';
import {getOriginalModelName} from '../utils/formatters';
import type {OnboardingPalModelEntry} from './onboarding/onboardingPals';

import {downloadManager, DownloadCancelledError} from '../services/downloads';
import {classify, ClassifyPlatform} from '../services/deviceRules/classify';
import {deriveUrl, parseDeviceRules} from '../services/deviceRules/parse';
import {fetchRules} from '../services/deviceRules/rules';
import {readDeviceSignals} from '../services/deviceRules/signals';
import {
  DeviceRules,
  DeviceSignals,
  RuleCandidate,
  RuleDraft,
  Tier,
} from '../services/deviceRules/types';

import androidRulesRaw from './bundledDeviceRules/rules.android.json';
import iosRulesRaw from './bundledDeviceRules/rules.ios.json';

// Bump when the migration logic that re-merges the persisted model list
// changes. Crossing this version runs the one-time prune-and-reconcile.
export const MODEL_LIST_VERSION = 15;

import {
  getHFDefaultSettings,
  getLocalModelDefaultSettings,
  stops,
} from '../utils/chat';
import {
  CacheType,
  ChatTemplateConfig,
  ContextInitParams,
  DraftConfig,
  HuggingFaceModel,
  Model,
  ModelFile,
  ModelOrigin,
  ModelType,
  RemoteModelCaps,
  RemoteSessionBinding,
} from '../utils/types';
import type {Samplers} from '../utils/samplerParams';

import {ErrorState, createErrorState} from '../utils/errors';
import {chatSessionRepository} from '../repositories/ChatSessionRepository';
import {hasEnoughMemory} from '../hooks/useMemoryCheck';
import {
  isHighEndDevice,
  getRecommendedThreadCount,
  getCpuCoreCount,
} from '../utils/deviceCapabilities';
import {detectThinkingCapability} from '../utils/thinkingCapabilityDetection';
import {ReasoningCapability} from '../utils/reasoningCapability';
import {toServerType} from '../utils/serverTypes';
import {capsMatchBinding, samplerDefaultsFor} from '../utils/remoteCaps';
import {resolveModelCaps} from '../utils/modelCaps';
import type {CapabilityEnv, ModelCapabilityView} from '../utils/modelCaps';
import {t} from '../locales';
import {resolveUseMmap} from '../utils/memorySettings';
import {
  createContextInitParams,
  createDefaultContextInitParams,
  resolveGpuLayersForModel,
} from '../utils/contextInitParamsVersions';
import {defaultGpuLayersForTier} from '../utils/contextInitParamsVersions';
import NativeHardwareInfo from '../specs/NativeHardwareInfo';
import {getModelMemoryRequirement} from '../utils/memoryEstimator';
import {loadLlamaModelInfo} from 'llama.rn';

/**
 * Factory function to create a Model object for a remote model from an OpenAI-compatible server.
 * Fills all required Model fields with sensible defaults.
 */
function createRemoteModel(params: {
  serverId: string;
  serverName: string;
  remoteModelId: string;
  modelName: string;
}): Model {
  const emptyChatTemplate = {
    name: '',
    addBosToken: false,
    addEosToken: false,
    bosToken: '',
    eosToken: '',
    chatTemplate: '',
    addGenerationPrompt: false,
  };
  return {
    id: `${params.serverId}/${params.remoteModelId}`,
    name: params.modelName,
    author: params.serverName,
    origin: ModelOrigin.REMOTE,
    isDownloaded: true,
    isLocal: false,
    size: 0,
    params: 0,
    downloadUrl: '',
    hfUrl: '',
    progress: 0,
    filename: '',
    defaultChatTemplate: emptyChatTemplate,
    chatTemplate: emptyChatTemplate,
    defaultStopWords: [],
    stopWords: [],
    defaultCompletionSettings: {} as CompletionParams,
    completionSettings: {} as CompletionParams,
    serverId: params.serverId,
    serverName: params.serverName,
    remoteModelId: params.remoteModelId,
  };
}

const answersSession = (
  caps: RemoteModelCaps | undefined,
  binding: RemoteSessionBinding,
): boolean =>
  capsMatchBinding(caps, binding, binding.modelId) &&
  caps?.samplerDefaults !== undefined;

const pairedDraftModel = (config?: DraftConfig): Model | undefined =>
  config?.mode === 'paired' ? config.draftModel : undefined;

/**
 * 后台停留多久才真的自动释放模型上下文（毫秒）。
 *
 * 以前是「一切到 background 立刻释放」，但打开系统相册选图、来电、
 * 看一眼通知都会短暂切后台，卸载 + 重载在低端机上是 6~8 秒白等，
 * 而且期间 engine 为 undefined，UI 会误报「模型未加载」。
 *
 * 30 秒能覆盖绝大多数「短暂离开」场景，同时仍然保证长时间后台会释放内存。
 */
const AUTO_RELEASE_DELAY_MS = 30_000;

class ModelStore {
  models: Model[] = [];
  version: number | undefined = undefined; // Persisted version
  deviceTier: Tier | null = null; // resolved device classification
  // initializeStore 是否已跑完（预设注入 + 下载状态结算）。
  // 冷启动 / 刚清数据时持久化 models 为空，预设要等异步 init 才注入 ——
  // 用这个标志让模型页在 init 完成前显示加载中，而不是闪一下误导人的空状态。
  isInitialized = false;

  /**
   * 用户是否在设置里**手动**调过 n_threads。
   *
   * 只有 false 时 initializeThreadCount 才会按核数自动校准 —
   * 这样「老版本遗留的默认值 4」能在 8 核机器上纠正到 6，
   * 而用户自己选的 3/4/8 一律保留。
   */
  nThreadsUserSet = false;
  rulesVersion: string | null = null; // provenance of the preset list

  /**
   * Returns models with projection models filtered out for display purposes
   */
  get displayModels(): Model[] {
    return [...filterProjectionModels(this.models), ...this.remoteModels];
  }

  appState: AppStateStatus = AppState.currentState;
  useAutoRelease: boolean = true;
  // UI loading state - true during model load/release transitions
  isContextLoading: boolean = false;
  loadingModel: Model | undefined = undefined;
  /** 延迟自动释放的定时器 */
  private autoReleaseTimer: ReturnType<typeof setTimeout> | undefined =
    undefined;

  // Unified context initialization parameters
  contextInitParams: ContextInitParams = createDefaultContextInitParams();

  max_threads: number = 4; // Will be set in constructor

  activeModelId: string | undefined = undefined;

  // Flag to track if multimodal is currently active
  isMultimodalActive: boolean = false;
  activeProjectionModelId: string | undefined = undefined;

  // Track initialization settings for the active context
  activeContextSettings: ContextInitParams | undefined = undefined;

  context: LlamaContext | undefined = undefined;

  engine: CompletionEngine | undefined = undefined;

  activeRemoteBinding: RemoteSessionBinding | undefined = undefined;

  private postCompletionProbeFor: RemoteSessionBinding | undefined = undefined;

  lastUsedModelId: string | undefined = undefined;

  // Auto-release tracking (persistent)
  wasAutoReleased: boolean = false;
  lastAutoReleasedModelId: string | undefined = undefined;

  // System UI protection (runtime)
  private autoReleaseDisabledReasons = new Set<string>();

  MIN_CONTEXT_SIZE = 200;

  inferencing: boolean = false;
  isStreaming: boolean = false;

  // Track active completion promise for safe context release
  // This prevents race condition where context is freed while completion is still running
  private activeCompletionPromise: Promise<any> | null = null;

  // Mutex to serialize model load/release operations to prevent memory leaks
  private contextOperationMutex: Promise<void> = Promise.resolve();

  // Last requested model ID - enables "last one wins" during rapid switching
  private pendingModelId: string | null = null;

  // Recovered local-model paths awaiting persistence. resolveLocalModelPath
  // collects (model -> re-anchored path) here instead of writing each one in
  // its own runInAction; a container change invalidates every local path at
  // once, so the batch flush turns N full store serializations into one.
  // Not in the persist list, so it is never serialized itself.
  private pendingLocalPathRecoveries: Map<Model, string> = new Map();

  // When true, the e2e benchmark runner owns the native context lifecycle.
  // Other callers (ChatView auto-load, selectModel, initContext) must defer
  // to keep the matrix's per-cell devices/n_gpu_layers from being shadowed
  // by an in-flight init that started before the matrix could configure them.
  // Runtime-only; not persisted.
  benchmarkActive: boolean = false;

  downloadError: ErrorState | null = null;
  modelLoadError: ErrorState | null = null;

  // Memory calibration variables (persisted)
  // Updated at app startup and after model release
  availableMemoryCeiling: number | undefined = undefined;
  // Updated after successful model load using GGUF estimator
  largestSuccessfulLoad: number | undefined = undefined;
  // Projection models orphaned by the vision heal, awaiting deletion; drained
  // every launch (see drainPendingProjectionCleanup).
  pendingProjectionCleanupIds: string[] = [];

  constructor() {
    makeAutoObservable<ModelStore, 'postCompletionProbeFor'>(this, {
      postCompletionProbeFor: false,
      activeModel: computed,
      activeModelCaps: computed,
      activeSamplerDefaults: computed,
      contextId: computed,
      remoteModels: computed,
      activeDownloads: computed,
    });
    makePersistable(this, {
      name: 'ModelStore',
      properties: [
        'models',
        'version',
        'deviceTier',
        'rulesVersion',
        'useAutoRelease',
        'contextInitParams',
        'lastUsedModelId',
        'wasAutoReleased',
        'lastAutoReleasedModelId',
        'availableMemoryCeiling',
        'largestSuccessfulLoad',
        'pendingProjectionCleanupIds',
        'nThreadsUserSet',
      ],
      storage: AsyncStorage,
    }).then(async () => {
      await this.initializeThreadCount();
      this.initializeStore();
    });

    this.setupAppStateListener();

    // Set up download manager callbacks
    downloadManager.setCallbacks({
      onProgress: (modelId, progress) => {
        const model = this.models.find(m => m.id === modelId);
        if (model) {
          runInAction(() => {
            model.progress = progress.progress;
            model.downloadSpeed = `${progress.speed} ${uiStore.l10n.common.downloadETA}: ${progress.eta}`;
          });
        }
      },
      onComplete: async modelId => {
        const model = this.models.find(m => m.id === modelId);
        if (model) {
          runInAction(() => {
            model.progress = 100;
            model.isDownloaded = true;
          });

          // Fetch and persist GGUF metadata after download completes
          // Skip for projection models (CLIP) - they have different metadata structure
          if (model.modelType !== ModelType.PROJECTION) {
            await this.fetchAndPersistGGUFMetadata(model);
          }
        }
      },
      onError: (modelId, error, keptProgress) => {
        console.error('Download error for model', modelId, error);
        const model = this.models.find(m => m.id === modelId);
        if (model) {
          runInAction(() => {
            model.progress = keptProgress ?? 0;
            model.isDownloaded = false;
          });
        }

        const errorState = createErrorState(error, 'download', 'huggingface', {
          modelId,
        });

        runInAction(() => {
          this.downloadError = errorState;
        });
      },
    });
  }

  private async initializeThreadCount() {
    try {
      const cores = await getCpuCoreCount();
      runInAction(() => {
        this.max_threads = cores;
      });

      // 首次启动按核数设置推荐线程数。
      // 另外：老版本把默认写死成 4，且只在首次启动算一次 —— 8 核机器会
      // 永久停留在 4 线程（纯 CPU 推理时直接损失三分之一算力）。
      // 所以「用户没手动设过」时也重新校准一次；setNThreads 会置
      // nThreadsUserSet = true，用户手调的 3/4/8 一律保留。
      const isFirstLaunch = this.version === undefined;
      if (isFirstLaunch || !this.nThreadsUserSet) {
        const threads = await getRecommendedThreadCount();
        runInAction(() => {
          this.contextInitParams = {
            ...this.contextInitParams,
            n_threads: threads,
          };
        });
      }
    } catch (error) {
      console.error('Failed to initialize thread count:', error);
      runInAction(() => {
        this.max_threads = 4;
      });
    }
  }

  setNThreads = (n_threads: number) => {
    runInAction(() => {
      this.nThreadsUserSet = true;
      this.contextInitParams = {
        ...this.contextInitParams,
        n_threads,
      };
    });
  };

  setCacheTypeK = (cache_type: CacheType) => {
    runInAction(() => {
      // Only allow changing cache type if flash attention is enabled
      // Support both old flash_attn and new flash_attn_type
      const flashAttnEnabled =
        this.contextInitParams.flash_attn ||
        (this.contextInitParams.flash_attn_type &&
          this.contextInitParams.flash_attn_type !== 'off');

      if (flashAttnEnabled) {
        this.contextInitParams = {
          ...this.contextInitParams,
          cache_type_k: cache_type,
        };
      }
    });
  };

  setCacheTypeV = (cache_type: CacheType) => {
    runInAction(() => {
      // Only allow changing cache type if flash attention is enabled
      // Support both old flash_attn and new flash_attn_type
      const flashAttnEnabled =
        this.contextInitParams.flash_attn ||
        (this.contextInitParams.flash_attn_type &&
          this.contextInitParams.flash_attn_type !== 'off');

      if (flashAttnEnabled) {
        this.contextInitParams = {
          ...this.contextInitParams,
          cache_type_v: cache_type,
        };
      }
    });
  };

  setNBatch = (n_batch: number) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        n_batch,
      };
    });
  };

  setNUBatch = (n_ubatch: number) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        n_ubatch,
      };
    });
  };

  setNContext = (n_ctx: number) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        n_ctx,
      };
    });
  };

  setNGPULayers = (n_gpu_layers: number) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        n_gpu_layers,
      };
    });
  };

  setImageMaxTokens = (image_max_tokens: number) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        image_max_tokens,
      };
    });
  };

  setUseMlock = (use_mlock: boolean) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        use_mlock,
      };
    });
  };

  setUseMmap = (use_mmap: 'true' | 'false' | 'smart') => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        use_mmap,
      };
    });
  };

  setNoExtraBufts = (no_extra_bufts: boolean) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        no_extra_bufts,
      };
    });
  };

  setSpeculativeEnabled = (speculativeEnabled: boolean) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        speculativeEnabled,
      };
    });
  };

  setSelectedDraftModel = (selectedDraftModelId?: string) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        selectedDraftModelId,
      };
    });
  };

  setSpecDraftNGpuLayers = (spec_draft_n_gpu_layers: number) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        spec_draft_n_gpu_layers,
      };
    });
  };

  setSpecDraftCacheTypeK = (spec_draft_cache_type_k: CacheType) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        spec_draft_cache_type_k,
      };
    });
  };

  setSpecDraftCacheTypeV = (spec_draft_cache_type_v: CacheType) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        spec_draft_cache_type_v,
      };
    });
  };

  /**
   * Get effective context initialization parameters with constraints applied
   * This is the unified method that replaces both getEffectiveBatchValues and getEffectiveInitSettings
   */
  getEffectiveContextInitParams = async (
    filePath?: string,
    draftConfig?: DraftConfig,
  ): Promise<Omit<ContextParams, 'model'>> => {
    // Apply batch constraints
    const effectiveContext = this.contextInitParams.n_ctx;
    const effectiveBatch = Math.min(
      this.contextInitParams.n_batch,
      effectiveContext,
    );
    const effectiveUBatch = Math.min(
      this.contextInitParams.n_ubatch,
      effectiveBatch,
    );

    // Resolve the effective use_mmap value based on the setting
    const currentUseMmap = this.contextInitParams.use_mmap;
    let effectiveUseMmap: boolean;

    if (currentUseMmap === 'smart') {
      // Handle 'smart' option
      effectiveUseMmap = filePath
        ? await resolveUseMmap('smart', filePath)
        : true;
    } else if (currentUseMmap === 'true') {
      effectiveUseMmap = true;
    } else if (currentUseMmap === 'false') {
      effectiveUseMmap = false;
    } else {
      // Default fallback
      effectiveUseMmap = true;
    }

    const mode = draftConfig?.mode ?? 'off';
    const speculative = mode !== 'off';

    // Handle flash_attn_type (v2.0) - platform-specific default
    const flashAttnModeDefault =
      mode === 'paired'
        ? 'off'
        : mode === 'embedded'
          ? 'auto'
          : Platform.OS === 'ios'
            ? 'auto'
            : 'off';
    const flash_attn_type =
      this.contextInitParams.flash_attn_type ?? flashAttnModeDefault;

    // Build the params object, filtering out undefined values
    const params: Partial<Omit<ContextParams, 'model'>> = {
      n_ctx: effectiveContext,
      n_batch: effectiveBatch,
      n_ubatch: effectiveUBatch,
      n_threads: this.contextInitParams.n_threads,
      flash_attn_type, // NEW: replaces flash_attn boolean
      cache_type_k: this.contextInitParams.cache_type_k,
      cache_type_v: this.contextInitParams.cache_type_v,
      n_gpu_layers: this.contextInitParams.n_gpu_layers ?? 99,
      devices: this.contextInitParams.devices?.slice(),
      kv_unified: this.contextInitParams.kv_unified ?? true, // NEW (default true!)
      n_parallel: this.contextInitParams.n_parallel ?? 1, // NEW (1 for blocking mode only)
      use_mlock: this.contextInitParams.use_mlock,
      use_mmap: effectiveUseMmap,
      no_extra_bufts: this.contextInitParams.no_extra_bufts,
    };

    if (speculative) {
      // llama.rn's speculative type set stays empty without spec_type — nothing engages.
      params.spec_type = 'draft-mtp';

      // llama.rn throws on spec_draft_n_max <= 0 with DRAFT_MTP.
      params.spec_draft_n_max =
        this.contextInitParams.spec_draft_n_max !== undefined
          ? Math.max(1, this.contextInitParams.spec_draft_n_max)
          : undefined;
      params.spec_draft_n_min = this.contextInitParams.spec_draft_n_min;
      params.spec_draft_p_min = this.contextInitParams.spec_draft_p_min;
      params.spec_draft_p_split = this.contextInitParams.spec_draft_p_split;

      const cacheDefaults = draftCacheDefaults(mode, flash_attn_type === 'on');
      params.spec_draft_cache_type_k =
        this.contextInitParams.spec_draft_cache_type_k ?? cacheDefaults.k;
      // With flash attention explicitly off a quantized draft V cache can
      // never load (llama.cpp hard-refuses it) — clamp even an explicit pick.
      const draftV =
        this.contextInitParams.spec_draft_cache_type_v ?? cacheDefaults.v;
      params.spec_draft_cache_type_v =
        flash_attn_type === 'off' && draftV !== CacheType.F16
          ? CacheType.F16
          : draftV;

      if (draftConfig?.mode === 'paired') {
        params.model_draft = draftConfig.resolvedDraftPath;
        params.is_model_draft_asset = false;
        params.spec_draft_n_gpu_layers =
          this.contextInitParams.spec_draft_n_gpu_layers ?? 99;
      } else {
        params.spec_draft_n_gpu_layers =
          this.contextInitParams.spec_draft_n_gpu_layers;
      }
    }

    Object.assign(
      params,
      await resolveDeviceSelection({
        devices: params.devices,
        n_gpu_layers: params.n_gpu_layers,
      }),
    );

    // Remove undefined values from the params object
    return Object.fromEntries(
      Object.entries(params).filter(([_, value]) => value !== undefined),
    ) as Omit<ContextParams, 'model'>;
  };

  // Legacy methods for backward compatibility

  /** @deprecated Use getEffectiveContextInitParams instead */
  getEffectiveBatchValues = () => {
    const effectiveContext = this.contextInitParams.n_ctx;
    const effectiveBatch = Math.min(
      this.contextInitParams.n_batch,
      effectiveContext,
    );
    const effectiveUBatch = Math.min(
      this.contextInitParams.n_ubatch,
      effectiveBatch,
    );

    return {
      n_ctx: effectiveContext,
      n_batch: effectiveBatch,
      n_ubatch: effectiveUBatch,
    };
  };

  /** @deprecated Use getEffectiveContextInitParams instead */
  getEffectiveInitSettings = async (
    filePath?: string,
  ): Promise<Omit<ContextParams, 'model'>> => {
    return this.getEffectiveContextInitParams(filePath);
  };

  /** @deprecated Use getEffectiveBatchValues instead */
  getEffectiveValues = () => {
    return this.getEffectiveBatchValues();
  };

  // Drafts downloaded before draft detection existed were classified as
  // vision models (their repo carries an mmproj); re-derive so they heal.
  // The pairing may have auto-downloaded that mmproj, and projection models
  // are only reachable through a multimodal model's UI — which the heal
  // removes — so the cleared ids are recorded (persisted with the same write
  // that strips the pairing) and drained after download state is synced.
  healDraftVisionClassification = () => {
    runInAction(() => {
      this.models.forEach(model => {
        // A downloaded record without ggufMetadata is only draft-classified by
        // its filename; wait for the header backfill so it can veto first.
        if (model.isDownloaded && !model.ggufMetadata) {
          return;
        }
        if (model.supportsMultimodal && isDraftOnlyModel(model)) {
          const cleared = new Set(this.pendingProjectionCleanupIds);
          model.compatibleProjectionModels?.forEach(id => cleared.add(id));
          if (model.defaultProjectionModel) {
            cleared.add(model.defaultProjectionModel);
          }
          this.pendingProjectionCleanupIds = [...cleared];
          model.supportsMultimodal = false;
          model.capabilities = model.capabilities?.filter(c => c !== 'vision');
          model.compatibleProjectionModels = undefined;
          model.defaultProjectionModel = undefined;
          model.visionEnabled = undefined;
        }
      });
    });
  };

  /**
   * Delete projection models the heal orphaned. Runs every launch: an id
   * stays queued while its download is still in flight or its deletion
   * fails, so a kill or an unfinished mmproj download cannot strand the
   * file forever. An id whose projection model has downloaded dependents is
   * legitimately shared — dropped, never deleted.
   */
  drainPendingProjectionCleanup = async () => {
    if (this.pendingProjectionCleanupIds.length === 0) {
      return;
    }
    const remaining: string[] = [];
    for (const id of this.pendingProjectionCleanupIds) {
      const projection = this.models.find(m => m.id === id);
      if (!projection || projection.modelType !== ModelType.PROJECTION) {
        continue;
      }
      if (this.getDownloadedLLMsUsingProjectionModel(id).length > 0) {
        continue;
      }
      if (downloadManager.isDownloading(id)) {
        remaining.push(id);
        continue;
      }
      if (!projection.isDownloaded) {
        continue;
      }
      try {
        await this.deleteModel(projection);
        if (this.models.find(m => m.id === id)?.isDownloaded) {
          remaining.push(id);
        }
      } catch (error) {
        console.warn('[ModelStore] orphaned projection cleanup failed:', error);
        remaining.push(id);
      }
    }
    runInAction(() => {
      this.pendingProjectionCleanupIds = remaining;
    });
  };

  initializeStore = async () => {
    const storedVersion = this.version || 0;
    console.log('models: ', this.models);

    this.healDraftVisionClassification();

    // Sync download manager with active downloads
    await downloadManager.syncWithActiveDownloads(this.models);

    // After the sync so an in-flight mmproj download is visible and waits. A
    // failure retries next launch; it must not abort the rest of init.
    try {
      await this.drainPendingProjectionCleanup();
    } catch (error) {
      console.warn('[ModelStore] projection cleanup drain failed:', error);
    }

    // Apply the bundled offline floor immediately (no network) so the list is
    // never empty while a slow rules fetch is in flight, then merge/reconcile.
    const presets = await this.resolvePresets();

    if (storedVersion < MODEL_LIST_VERSION) {
      await this.mergeModelLists(presets);
      // mergeModelLists awaits the download-status checks (which re-anchor stale
      // container paths), so pruning here — as the non-migration branch does —
      // is now safe: a recoverable local model has already been settled and will
      // not be dropped as missing.
      this.removeInvalidLocalModels();
      // Only finalize the one-time migration once presets actually resolved.
      // An empty result signals a transient resolve failure (e.g. the RAM read
      // rejected); leave the version unbumped so the migration retries next
      // launch instead of locking in an empty default list.
      if (presets.length > 0) {
        runInAction(() => {
          this.version = MODEL_LIST_VERSION;
        });
      }
    } else {
      this.reconcilePresets(presets);
      await this.initializeDownloadStatus();
      this.removeInvalidLocalModels();
    }

    // 预设已注入（两个分支都会到这里）：标记初始化完成，
    // 模型页据此停止显示「加载中」、并在确为空时才开始显示空状态。
    runInAction(() => {
      this.isInitialized = true;
    });

    // Upgrade past the bundled floor to the online rules override in the
    // background; reconcile (id-keyed, dedup) folds in any newer set.
    this.upgradeToFetchedRules();

    await this.initializeGpuSettings(); // Should be awaited to ensure GPU settings are applied before initializing context

    // Initialize available memory ceiling at app startup if not set
    if (this.availableMemoryCeiling === undefined) {
      try {
        const availableBytes = await NativeHardwareInfo.getAvailableMemory();
        runInAction(() => {
          this.availableMemoryCeiling = availableBytes;
        });
      } catch (error) {
        // Fallback when native call fails
        console.warn(
          '[ModelStore] Native getAvailableMemory failed, using fallback:',
          error,
        );
        const totalMemory = await DeviceInfo.getTotalMemory();
        // Use conservative heuristic: min(60% of RAM, RAM - 1.2GB)
        const fallbackCeiling = Math.min(
          totalMemory * 0.6,
          totalMemory - 1.2 * 1e9,
        );
        runInAction(() => {
          this.availableMemoryCeiling = Math.max(fallbackCeiling, 0); // Ensure non-negative
        });
      }
    }

    // Load missing GGUF metadata for downloaded models (background, non-blocking)
    this.loadMissingGGUFMetadata();

    // Check if we need to reload an auto-released model (for app restarts)
    this.checkAndReloadAutoReleasedModel();
  };

  // Synthesize the minimal {hfModel, modelFile} pair the unchanged hfAsModel
  // reads from a thin candidate, with no network. The deterministic downloadUrl
  // is set here; HF-derivable data (oid/lfs/templates) resolves at download. A
  // multimodal candidate's explicit mmproj is synthesized into a sibling so
  // vision detection pairs the projector and its size enters the fit check.
  private candidateToPair = (
    candidate: RuleCandidate,
  ): {hfModel: HuggingFaceModel; modelFile: ModelFile} => {
    const modelFile: ModelFile = {
      rfilename: candidate.hfFilename,
      url: deriveUrl(candidate.hfRepo, candidate.hfFilename),
      size: candidate.sizeBytes,
    };
    const siblings: ModelFile[] | undefined = candidate.mmproj
      ? [
          {rfilename: candidate.hfFilename, size: candidate.sizeBytes},
          {
            rfilename: candidate.mmproj.hfFilename,
            url: deriveUrl(
              candidate.mmproj.hfRepo,
              candidate.mmproj.hfFilename,
            ),
            size: candidate.mmproj.sizeBytes,
          },
        ]
      : undefined;
    const hfModel = {
      id: candidate.hfRepo,
      author: candidate.hfRepo.split('/')[0],
      url: `https://huggingface.co/${candidate.hfRepo}`,
      specs: {gguf: {total: candidate.params ?? 0}},
      siblings,
    } as unknown as HuggingFaceModel;
    return {hfModel, modelFile};
  };

  // A draft usually lives in a repo other than its target's, so unlike mmproj it
  // cannot be an hfAsModel sibling and needs its own {hfModel, modelFile} pair.
  private draftToStub = (draft: RuleDraft): Model => {
    const modelFile: ModelFile = {
      rfilename: draft.hfFilename,
      url: deriveUrl(draft.hfRepo, draft.hfFilename),
      size: draft.sizeBytes,
    };
    const hfModel = {
      id: draft.hfRepo,
      author: draft.hfRepo.split('/')[0],
      url: `https://huggingface.co/${draft.hfRepo}`,
      specs: {gguf: {total: 0}},
      siblings: undefined,
    } as unknown as HuggingFaceModel;
    return {...hfAsModel(hfModel, modelFile), modelType: ModelType.DRAFT};
  };

  // Materialize the device-tier preset list from rules. Each thin candidate is
  // turned into the minimal pair hfAsModel reads (candidateToPair), so the
  // result is origin:HF, identical to an HF-browser add. Multimodal candidates
  // also push their mmproj projector stub (mirrors addHFModel) so the projection
  // is resolvable for download. Deduped by model.id (author/repo/filename),
  // first wins.
  resolvePresetModels = (
    rules: DeviceRules,
    signals: DeviceSignals,
  ): Model[] => {
    const tier = classify(
      signals,
      rules.classifier,
      Platform.OS as ClassifyPlatform,
    );
    // 兜底：classify 偶尔会给出不在规则里的档位（或规则缺该档位），
    // 直接 rules.tiers[tier].models 会抛错 → 被 catch 成 [] → 预设全空。
    // 这里逐级回退到有候选的档位，保证预设永不为空（用户零自有模型时也有推荐可看）。
    const tierModels =
      rules.tiers[tier]?.models ??
      rules.tiers.mid?.models ??
      rules.tiers.high?.models ??
      rules.tiers.flagship?.models ??
      rules.tiers.low?.models ??
      [];
    const flat = tierModels.flatMap(candidate => {
      const {hfModel, modelFile} = this.candidateToPair(candidate);
      const llm = hfAsModel(hfModel, modelFile);
      let named = candidate.displayName
        ? {...llm, name: candidate.displayName}
        : llm;

      const extras: Model[] = [];
      if (named.supportsMultimodal) {
        const projModels = getMmprojFiles(hfModel.siblings || []).map(file =>
          hfAsModel(hfModel, file),
        );
        extras.push(...projModels);
      }
      if (candidate.draft) {
        const draftStub = this.draftToStub(candidate.draft);
        named = {...named, defaultDraftModel: draftStub.id};
        extras.push(draftStub);
      }
      return [named, ...extras];
    });

    // Dedup on the full model id (author/repo/filename) so two authors sharing a
    // repo name + filename don't collapse. The id also spans origins, matching a
    // legacy origin:PRESET download against a new origin:HF rule entry.
    const seen = new Set<string>();
    const presets: Model[] = [];
    for (const model of flat) {
      if (seen.has(model.id)) {
        continue;
      }
      seen.add(model.id);
      presets.push({...model, isRulePreset: true});
    }
    return presets;
  };

  // Resolve the preset list from the bundled offline floor only — no network. This
  // populates the model list immediately on first launch so a slow or hanging
  // rules fetch can never leave the list empty. The fetched online override is
  // applied afterwards by upgradeToFetchedRules (fire-and-forget).
  private resolvePresets = async (): Promise<Model[]> => {
    try {
      const signals = await readDeviceSignals();
      const bundledRaw = Platform.OS === 'ios' ? iosRulesRaw : androidRulesRaw;
      const rules = parseDeviceRules(bundledRaw, DeviceInfo.getVersion());
      const tier = classify(
        signals,
        rules.classifier,
        Platform.OS as ClassifyPlatform,
      );
      runInAction(() => {
        this.deviceTier = tier;
        this.rulesVersion = rules.rulesVersion;
      });
      this.applyTieredGpuLayers(tier);
      const resolved = this.resolvePresetModels(rules, signals);
      // 诊断日志：全新安装「没有预设」排查用（档位 + 算出几个）
      console.log('[ModelStore] resolvePresets ->', {
        tier,
        count: resolved.length,
      });
      return resolved;
    } catch (error) {
      console.warn('[ModelStore] preset resolution failed:', error);
      return [];
    }
  };

  /**
   * 按设备档位校准**默认 GPU 层数**。
   *
   * 老默认是 99（= 全部层，满）。低端机 GPU 显存小，开满容易 GPU OOM /
   * 整机闪退，而 CPU 侧 mmap 权重是内核可换出的 —— 所以改成按档位给一个
   * **不跑满**的保守值（low 0 / mid 8 / high 16 / flagship 24）。
   *
   * 只在「当前值还是老的满值默认」时才改：用户手动调过的（0 / 12 / 20…）
   * 一律尊重，不覆盖。
   */
  private applyTieredGpuLayers = (tier: Tier) => {
    const cur = this.contextInitParams.n_gpu_layers;
    // 8 是 2026-10-19 那版「保守兜底值」，不是用户手选的；一并视为未校准。
    // 不重算的话，老用户会永久停留在「8 层 GPU + 其余 CPU」——
    // 实测某骁龙8+机型 上推理时 CPU 8 核满载（666%），就是这条造成的。
    const isLegacyFullDefault =
      cur === 99 || cur === 8 || cur === undefined || cur === null;
    if (!isLegacyFullDefault) {
      return; // 用户自己设过，别动
    }
    const recommended = defaultGpuLayersForTier(tier);
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        n_gpu_layers: recommended,
      };
    });
    console.log(
      `[ModelStore] GPU 层数按档位 ${tier} 设为 ${recommended}（原 ${cur}）`,
    );
  };

  // Fetch the online rules override and, if it parses to a usable rule set,
  // re-classify and reconcile so the list upgrades past the bundled floor. Runs
  // off the first-population path (fire-and-forget); any failure leaves the
  // already-applied bundled presets in place.
  private upgradeToFetchedRules = async (): Promise<void> => {
    try {
      const fetched = await fetchRules(DeviceInfo.getVersion());
      if (!fetched) {
        return;
      }
      const signals = await readDeviceSignals();
      const tier = classify(
        signals,
        fetched.classifier,
        Platform.OS as ClassifyPlatform,
      );
      runInAction(() => {
        this.deviceTier = tier;
        this.rulesVersion = fetched.rulesVersion;
      });
      this.applyTieredGpuLayers(tier);
      this.reconcilePresets(this.resolvePresetModels(fetched, signals));
    } catch (error) {
      console.warn('[ModelStore] fetched-rules upgrade failed:', error);
    }
  };

  // Reconcile the freshly-resolved rule presets into the model list. Keyed on the
  // full model id (author/repo/filename), which spans origins: a downloaded
  // legacy PRESET and a new origin:HF rule entry share it, so the kept download
  // suppresses the rule stub (no duplicate card, no re-download).
  //
  // Two-sided so the list stays equal to the current rule set:
  //  - prune non-downloaded rule-provenance stubs no longer in the fresh set
  //    (a newer rulesVersion dropped them, or the device re-tiered). Downloaded
  //    models of any origin and user-added HF/LOCAL models are never pruned.
  //  - append the fresh presets not already represented by a kept model.
  reconcilePresets = (presets: Model[]) => {
    if (presets.length === 0) {
      return;
    }
    const freshIds = new Set(presets.map(p => p.id));
    const kept = this.models.filter(
      m => !(m.isRulePreset && !m.isDownloaded && !freshIds.has(m.id)),
    );
    const existing = new Set(kept.map(m => m.id));
    const toAdd = presets.filter(p => !existing.has(p.id));
    if (kept.length === this.models.length && toAdd.length === 0) {
      return;
    }
    runInAction(() => {
      this.models = [...kept, ...toAdd];
    });
  };

  mergeModelLists = (presets: Model[] = []) => {
    // The default list is data-driven: rule-resolved origin:HF presets replace
    // the old static PRESET array. Keep every downloaded model regardless of
    // origin, drop non-downloaded PRESET stubs, then reconcile the resolved
    // presets in by model.id (author/repo/filename, origin-spanning) so a kept
    // legacy PRESET download suppresses its rule stub.
    const mergedModels = [...this.models].filter(
      model => model.origin !== ModelOrigin.PRESET || model.isDownloaded,
    );

    // Handle HF and LOCAL models
    mergedModels.forEach(model => {
      if (
        model.origin === ModelOrigin.HF ||
        model.origin === ModelOrigin.LOCAL ||
        model.isLocal
      ) {
        // Reset default settings
        if (model.origin === ModelOrigin.LOCAL || model.isLocal) {
          const defaultSettings = getLocalModelDefaultSettings();
          model.defaultChatTemplate = {...defaultSettings.chatTemplate};
          model.defaultStopWords = defaultSettings.completionParams.stop;
        } else if (model.origin === ModelOrigin.HF) {
          const defaultSettings = getHFDefaultSettings(
            model.hfModel as HuggingFaceModel,
          );
          model.defaultChatTemplate = {...defaultSettings.chatTemplate};
          model.defaultStopWords = defaultSettings.completionParams.stop;
        }

        // Update current settings while preserving any customizations
        model.chatTemplate = deepMerge(
          model.chatTemplate || {},
          model.defaultChatTemplate,
        );
        model.stopWords = [
          ...(model.stopWords || []),
          ...(model.defaultStopWords || []),
        ];

        // Infer repo from model.id if missing (for existing HF models)
        if (model.origin === ModelOrigin.HF && !model.repo) {
          const inferredRepo = inferRepoFromModelId(model.id);
          if (inferredRepo) {
            model.repo = inferredRepo;
            console.log(
              `[ModelStore] Inferred repo "${inferredRepo}" from model.id: ${model.id}`,
            );
          }
        }
      }
    });

    runInAction(() => {
      this.models = mergedModels;
    });

    this.reconcilePresets(presets);

    // Returned (not awaited) so callers inside runInAction can stay sync while
    // initializeStore can still await settlement before pruning local models.
    return this.initializeDownloadStatus();
  };

  setupAppStateListener = () => {
    AppState.addEventListener('change', this.handleAppStateChange);
  };

  // Auto-release management methods
  disableAutoRelease = (reason: string) => {
    this.autoReleaseDisabledReasons.add(reason);
    console.log(
      `Auto-release disabled: ${reason}`,
      Array.from(this.autoReleaseDisabledReasons),
    );
  };

  enableAutoRelease = (reason: string) => {
    this.autoReleaseDisabledReasons.delete(reason);
    console.log(
      `Auto-release enabled: ${reason}`,
      Array.from(this.autoReleaseDisabledReasons),
    );
  };

  get isAutoReleaseEnabled() {
    return this.useAutoRelease && this.autoReleaseDisabledReasons.size === 0;
  }

  private markAutoReleased = (modelId: string) => {
    // Skip auto-release for remote models (no native context to release)
    const model = this.activeModel;
    if (model?.origin === ModelOrigin.REMOTE) {
      return;
    }
    console.log('Marking auto-released: ', modelId);
    runInAction(() => {
      this.wasAutoReleased = true;
      this.lastAutoReleasedModelId = modelId;
    });
  };

  private clearAutoReleaseFlags = () => {
    console.log('Clearing auto-release flags');
    runInAction(() => {
      this.wasAutoReleased = false;
      this.lastAutoReleasedModelId = undefined;
    });
  };

  checkAndReloadAutoReleasedModel = async () => {
    if (this.wasAutoReleased && this.lastAutoReleasedModelId) {
      // Skip if the auto-released model ID refers to a remote model
      if (this.lastAutoReleasedModelId.includes('/')) {
        const remoteModel = this.remoteModels.find(
          m => m.id === this.lastAutoReleasedModelId,
        );
        if (remoteModel) {
          this.clearAutoReleaseFlags();
          return;
        }
      }
      const model = this.models.find(
        m => m.id === this.lastAutoReleasedModelId && m.isDownloaded,
      );
      if (model) {
        console.log('Reloading auto-released model:', model.id);
        await this.initContext(model);
      }
      this.clearAutoReleaseFlags();
    }
  };

  /**
   * 安排一次**延迟**自动释放。
   *
   * 打开系统相册、来电、通知预览都会让 App 进后台几十秒到几分钟，
   * 立刻卸载模型再重载（低端机 6~8 秒）代价太大。延迟一小段时间，
   * 中间只要回到前台就取消 —— 只有真正长时间留在后台才释放。
   */
  private scheduleAutoRelease = () => {
    if (this.autoReleaseTimer) {
      clearTimeout(this.autoReleaseTimer);
    }
    console.log(
      `Scheduling auto-release in ${AUTO_RELEASE_DELAY_MS}ms (was: immediate)`,
    );
    this.autoReleaseTimer = setTimeout(async () => {
      this.autoReleaseTimer = undefined;
      // 期间已经回前台了 → 不释放
      if (this.appState === 'active') {
        console.log('Auto-release cancelled: app came back to foreground');
        return;
      }
      if (
        !this.isAutoReleaseEnabled ||
        !this.activeModelId ||
        this.activeModel?.origin === ModelOrigin.REMOTE
      ) {
        return;
      }
      console.log('Background timeout: Auto-releasing context');
      this.markAutoReleased(this.activeModelId);
      await this.releaseContext();
    }, AUTO_RELEASE_DELAY_MS);
  };

  /** 回到前台时取消待执行的自动释放 */
  private cancelScheduledAutoRelease = () => {
    if (this.autoReleaseTimer) {
      clearTimeout(this.autoReleaseTimer);
      this.autoReleaseTimer = undefined;
      console.log('Cancelled scheduled auto-release (back to foreground)');
    }
  };

  handleAppStateChange = async (nextAppState: AppStateStatus) => {
    console.log(`App state change: ${this.appState} → ${nextAppState}`);

    if (
      this.appState.match(/inactive|background/) &&
      nextAppState === 'active'
    ) {
      // 回到前台：取消待执行的延迟释放（若已经释放过才需要重载）
      this.cancelScheduledAutoRelease();
      // Coming to foreground - check if we need to reload auto-released model
      await this.checkAndReloadAutoReleasedModel();
      this.probeSessionCapsIfUnanswered();
    } else if (this.appState === 'active' && nextAppState === 'inactive') {
      // active → inactive: NO action (per requirements)
      console.log('Active → Inactive: No auto-release action');
    } else if (
      (this.appState === 'inactive' || this.appState === 'active') &&
      nextAppState === 'background'
    ) {
      // → background: 延迟释放。
      //
      // ⚠️ 2026-10-19 用户反馈：「图像识别里一选图就提示模型未加载，
      // 几秒后卡片才消失，点开始识别又卡住」。
      // 根因：打开系统相册会让 App 走 active → inactive → background，
      // 这里立刻 releaseContext()，回前台又要 initContext 重载 ——
      // 低端机上 6~7 秒白等，而且 engine 为 undefined 让 UI 误报「未加载」。
      //
      // 打开相册 / 接个电话 / 看一眼通知 都是**秒级**的后台，不该为此
      // 把几 GB 的模型卸掉再装回来。所以改成**延迟释放**：
      // 后台停留超过 AUTO_RELEASE_DELAY_MS 才真的卸载；期间若回到前台就取消。
      if (
        this.isAutoReleaseEnabled &&
        this.activeModelId &&
        this.activeModel?.origin !== ModelOrigin.REMOTE
      ) {
        this.scheduleAutoRelease();
      }
    }

    runInAction(() => {
      this.appState = nextAppState;
    });
  };

  /**
   * Remote models are exempt from auto-release, so a session survives
   * backgrounding, but its capability probe may not have: iOS can tear the
   * request down, and the first probe is the one that raises the local-network
   * prompt, so a grant always arrives after it already failed. A server
   * repointed away from the session's url is skipped: it cannot answer for it.
   */
  private probeSessionCapsIfUnanswered = (): boolean => {
    const binding = this.activeRemoteBinding;
    if (
      !binding ||
      answersSession(serverStore.remoteCaps[binding.modelId], binding)
    ) {
      return false;
    }
    const server = serverStore.servers.find(s => s.id === binding.serverId);
    if (
      !server ||
      server.url !== binding.url ||
      !profileFor(server.serverType).hasProps
    ) {
      return false;
    }
    serverStore
      .fetchRemoteModelCaps(binding.serverId, binding.remoteModelId)
      .catch(() => {});
    return true;
  };

  /**
   * A llama.cpp router proxies GET /props to the model only with autoload on,
   * so the probe fired at selection time cannot land for a model that is not
   * resident yet. The first finished completion guarantees residency.
   */
  reprobeRemoteCapsAfterCompletion = (): void => {
    const binding = this.activeRemoteBinding;
    if (this.postCompletionProbeFor === binding) {
      return;
    }
    if (this.probeSessionCapsIfUnanswered()) {
      this.postCompletionProbeFor = binding;
    }
  };

  reinitializeContext = async () => {
    if (this.activeModelId) {
      const model = this.models.find(m => m.id === this.activeModelId);
      if (model) {
        await this.initContext(model);
      }
    }
  };

  /**
   * Determines the full path for a model file on the device's storage.
   * This path is used for multiple purposes:
   * - As the destination path when downloading a model
   * - To check if a model is downloaded (by checking file existence at this path)
   * - To access the model file for operations like context initialization or deletion
   *
   * Path structure varies by model origin:
   * - LOCAL: Uses the model's fullPath property
   * - PRESET: Checks both legacy path (DocumentDirectoryPath/filename) and
   *          new path (DocumentDirectoryPath/models/preset/author/filename)
   * - HF: Uses DocumentDirectoryPath/models/hf/author/filename
   *
   * IMPORTANT: This logic is duplicated in native Swift code for iOS Shortcuts
   * See: ios/PocketPal/AppIntents/PalDataProvider.swift - parseModelPath() method
   * If we modify this function, we need to update the Swift version as well.
   *
   * @param model - The model object containing necessary metadata (origin, filename, author, etc.)
   * @returns Promise<string> - The full path where the model file is or should be stored
   * @throws Error if filename is undefined or if fullPath is undefined for local models
   */
  getModelFullPath = async (model: Model): Promise<string> => {
    // For local models, use the fullPath
    if (model.isLocal || model.origin === ModelOrigin.LOCAL) {
      if (!model.fullPath) {
        throw new Error('Full path is undefined for local model');
      }
      return this.resolveLocalModelPath(model);
    }

    if (!model.filename) {
      throw new Error('Model filename is undefined');
    }

    // For preset models, check both old and new paths
    if (model.origin === ModelOrigin.PRESET) {
      const author = model.author || 'unknown';
      const repo = model.repo || 'unknown';

      // Very old path (deprecated, for backwards compatibility)
      const veryOldPath = `${RNFS.DocumentDirectoryPath}/${model.filename}`;

      // Old path (deprecated, for backwards compatibility)
      const oldPath = `${RNFS.DocumentDirectoryPath}/models/preset/${author}/${model.filename}`;

      // New path structure includes repository name
      const newPath = `${RNFS.DocumentDirectoryPath}/models/preset/${author}/${repo}/${model.filename}`;

      // Check if file exists at very old path first (for backwards compatibility)
      try {
        if (await RNFS.exists(veryOldPath)) {
          return veryOldPath;
        }
      } catch (err) {
        console.log('Error checking very old preset path:', err);
      }

      // Check if file exists at old path (for backwards compatibility)
      try {
        if (await RNFS.exists(oldPath)) {
          return oldPath;
        }
      } catch (err) {
        console.log('Error checking old preset path:', err);
      }

      // Otherwise use new path
      return newPath;
    }

    // For HF models, use author/repo/model structure with backwards compatibility
    if (model.origin === ModelOrigin.HF) {
      const author = model.author || 'unknown';

      // Try to get repo from model, or infer from model.id, or fallback to 'unknown'
      let repo = model.repo;
      if (!repo) {
        repo = inferRepoFromModelId(model.id) || 'unknown';
      }

      // Old path structure (for backwards compatibility)
      const oldPath = `${RNFS.DocumentDirectoryPath}/models/hf/${author}/${model.filename}`;

      // New path structure includes repository name
      const newPath = `${RNFS.DocumentDirectoryPath}/models/hf/${author}/${repo}/${model.filename}`;

      // Check if file exists at old path (backwards compatibility)
      // This handles: existing downloads, models after reset, models after app update
      try {
        if (await RNFS.exists(oldPath)) {
          return oldPath;
        }
      } catch (err) {
        console.log('Error checking old HF model path:', err);
      }

      // Otherwise use new path
      return newPath;
    }

    // Fallback (shouldn't reach here)
    console.error('should not reach here. model: ', model);
    return `${RNFS.DocumentDirectoryPath}/${model.filename}`;
  };

  /**
   * Re-anchors a LOCAL model's stored absolute path onto the current app
   * container.
   *
   * `fullPath` is persisted verbatim when the file is imported. On iOS the app
   * container UUID can change (OS upgrade, backup/restore, reinstall), which
   * invalidates every stored absolute path even though the file is still on
   * disk under the new container. Imported models are copied into
   * `<DocumentDirectoryPath>/models/local`, so the segment from `models/local`
   * onward is stable and can be re-joined to the *current* documents path.
   *
   * Returns the recovered path (persistence is batched via
   * flushPendingLocalPathRecoveries) when the original is missing but the
   * re-anchored one exists; otherwise returns the stored path unchanged so
   * existing not-found handling still applies.
   *
   * IMPORTANT: this re-anchoring is duplicated in native Swift for iOS
   * Shortcuts — see the LOCAL branch of parseModelPath() in
   * ios/PocketPal/AppIntents/PalDataProvider.swift. Keep the two in sync; the
   * shared '/models/local/' marker must match on both sides.
   */
  resolveLocalModelPath = async (model: Model): Promise<string> => {
    const storedPath = model.fullPath!;

    // A rejected exists() must not escape: getModelFullPath is treated as
    // non-throwing by every consumer, and deleteModel awaits it *outside* its
    // try (a throw would abort the delete before the unlink). An indeterminate
    // check is degraded to "not present" — recovery is attempted, and if it is
    // also indeterminate we fall through to the stored path so the existing
    // not-found handling still applies.
    const pathExists = async (path: string): Promise<boolean> => {
      try {
        return await RNFS.exists(path);
      } catch (err) {
        console.warn(
          '[ModelStore] exists() check failed while resolving local path:',
          {modelId: model.id, path, err},
        );
        return false;
      }
    };

    if (await pathExists(storedPath)) {
      return storedPath;
    }

    // content:// 直接引用的模型：存的是 /proc/self/fd/N，这个 fd 跨进程一定
    // 失效（重启后 N 指向别的文件，甚至不存在）。必须用持久的 contentUri
    // 重新开一个 fd，否则既加载不了、也读不到 GGUF 头（模型类型判定就永远
    // 是导入时按文件名猜的那个值）。
    if (model.contentUri && isProcFdPath(storedPath)) {
      await this.refreshProcFdPath(model);
      const refreshed = model.fullPath;
      if (refreshed && (await pathExists(refreshed))) {
        return refreshed;
      }
    }

    const marker = '/models/local/';
    const markerIndex = storedPath.indexOf(marker);
    if (markerIndex === -1) {
      return storedPath;
    }

    const recoveredPath = `${RNFS.DocumentDirectoryPath}${storedPath.slice(
      markerIndex,
    )}`;
    if (recoveredPath === storedPath || !(await pathExists(recoveredPath))) {
      return storedPath;
    }

    console.log(
      '[ModelStore] Recovered local model path after container change:',
      {modelId: model.id, from: storedPath, to: recoveredPath},
    );
    // Defer the write: flushPendingLocalPathRecoveries applies every recovery
    // from a refresh pass in a single runInAction. Callers use the returned
    // path immediately, so deferring persistence changes nothing they observe.
    this.pendingLocalPathRecoveries.set(model, recoveredPath);
    return recoveredPath;
  };

  /**
   * Applies every path recovered since the last flush in one runInAction, so a
   * container change that invalidates N local paths persists once rather than N
   * times. Called after refreshDownloadStatuses settles; entries for models no
   * longer in the store are dropped.
   */
  private flushPendingLocalPathRecoveries = () => {
    if (this.pendingLocalPathRecoveries.size === 0) {
      return;
    }
    const recoveries = Array.from(this.pendingLocalPathRecoveries.entries());
    this.pendingLocalPathRecoveries.clear();
    runInAction(() => {
      for (const [model, recoveredPath] of recoveries) {
        if (this.models.includes(model)) {
          model.fullPath = recoveredPath;
        }
      }
    });
  };

  async checkFileExists(model: Model) {
    const filePath = await this.getModelFullPath(model);
    const exists = await RNFS.exists(filePath);

    // Don't mark as downloaded if currently downloading
    if (exists && !downloadManager.isDownloading(model.id)) {
      if (!model.isDownloaded) {
        console.log(
          'checkFileExists: marking as downloaded - this should not happen:',
          model.id,
        );
        runInAction(() => {
          model.isDownloaded = true;
        });
      }
    } else {
      runInAction(() => {
        model.isDownloaded = false;
      });
    }
  }

  refreshDownloadStatuses = async () => {
    // Await every check: callers (notably initializeStore, which then runs
    // removeInvalidLocalModels) depend on isDownloaded being settled before they
    // prune.
    //
    // Each check is isolated: a single failure (e.g. an RNFS error, or a local
    // model with no fullPath) must not abort the others, and must leave
    // isDownloaded untouched rather than defaulting it to false — an
    // indeterminate result is not evidence the file is gone.
    await Promise.all(
      this.models.map(model =>
        this.checkFileExists(model).catch(error => {
          console.warn(
            '[ModelStore] Could not determine file status for model:',
            model.id,
            error,
          );
        }),
      ),
    );
    // Persist every path re-anchored during the pass in a single write.
    this.flushPendingLocalPathRecoveries();
  };

  initializeDownloadStatus = async () => {
    await this.refreshDownloadStatuses();
  };

  removeInvalidLocalModels = () => {
    runInAction(() => {
      this.models = this.models.filter(model => {
        // Keep all non-local models (preset and HF)
        if (!(model.isLocal || model.origin === ModelOrigin.LOCAL)) {
          return true;
        }
        // For local models, isDownloaded==true means the file exists, otherwise
        // it's invalid. Callers must let refreshDownloadStatuses settle first —
        // it re-anchors stale container paths (resolveLocalModelPath) so a
        // recoverable model is not treated as missing here.
        if (model.isDownloaded) {
          return true;
        }
        // Dropping a local model is unrecoverable (there is no download URL to
        // re-fetch from), so make it visible rather than silent.
        console.warn(
          '[ModelStore] Removing local model whose file is no longer present:',
          {modelId: model.id, name: model.name, fullPath: model.fullPath},
        );
        return false;
      });
    });
  };

  /**
   * Private method to handle projection model download for vision models
   * @param model The vision model that needs its projection model downloaded
   */
  private _downloadProjectionModelIfNeeded = async (model: Model) => {
    // Only auto-download for vision models that aren't projection models themselves
    if (
      !model.supportsMultimodal ||
      !model.defaultProjectionModel ||
      model.modelType === ModelType.PROJECTION
    ) {
      return;
    }

    // Check if vision is enabled for this model (uses getModelVisionPreference for proper default handling)
    if (!this.getModelVisionPreference(model)) {
      console.log(
        'Vision disabled for model, skipping projection model download:',
        model.id,
      );
      return;
    }

    const projModelId = model.defaultProjectionModel;
    const projModel = this.models.find(m => m.id === projModelId);

    if (
      projModel &&
      !projModel.isDownloaded &&
      !downloadManager.isDownloading(projModelId)
    ) {
      console.log('Auto-downloading projection model for vision model:', {
        llm: model.id,
        projection: projModelId,
      });

      try {
        // Download the projection model
        await this.checkSpaceAndDownload(projModelId);
      } catch (error) {
        console.error('Failed to auto-download projection model:', error);
        // Don't re-throw - projection model download failure shouldn't fail the main model download
        // The user can manually download the projection model later if needed
      }
    }
  };

  private _downloadDraftModelIfNeeded = async (model: Model) => {
    const draftModelId = resolveDraftModelId(
      model,
      this.contextInitParams.selectedDraftModelId,
    );
    if (
      !draftModelId ||
      model.modelType === ModelType.DRAFT ||
      !this.contextInitParams.speculativeEnabled
    ) {
      return;
    }

    const draftModel = this.models.find(m => m.id === draftModelId);

    if (
      draftModel &&
      !draftModel.isDownloaded &&
      !downloadManager.isDownloading(draftModelId)
    ) {
      console.log('Auto-downloading draft model for speculative target:', {
        target: model.id,
        draft: draftModelId,
      });

      try {
        await this.checkSpaceAndDownload(draftModelId);
      } catch (error) {
        console.error('Failed to auto-download draft model:', error);
        // Don't re-throw - draft download failure shouldn't fail the target download.
      }
    }
  };

  checkSpaceAndDownload = async (modelId: string) => {
    const model = this.models.find(m => m.id === modelId);
    // Skip if model is undefined, already downloaded, local or doesn't have a download URL
    // TODO: we need a better way to handle this. Why this could ever happen?
    if (
      !model ||
      model.isDownloaded ||
      model.isLocal ||
      model.origin === ModelOrigin.LOCAL ||
      !model.downloadUrl
    ) {
      return;
    }

    try {
      const destinationPath = await this.getModelFullPath(model);
      const authToken = hfStore.shouldUseToken ? hfStore.hfToken : null;
      await downloadManager.startDownload(model, destinationPath, authToken);

      // For vision models, automatically download the projection model
      await this._downloadProjectionModelIfNeeded(model);
      await this._downloadDraftModelIfNeeded(model);
    } catch (err) {
      if (err instanceof DownloadCancelledError) {
        // User cancelled — not a failure. Don't surface an error and don't
        // chain the projection-model download for multimodal models.
        return;
      }

      console.error('Failed to start download:', err);

      // Create proper error state for the snackbar system
      const errorState = createErrorState(err, 'download', 'huggingface', {
        modelId,
      });

      runInAction(() => {
        this.downloadError = errorState;
      });

      // Re-throw so the caller knows the download failed
      throw err;
    }
  };

  cancelDownload = async (modelId: string) => {
    await downloadManager.cancelDownload(modelId);
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      runInAction(() => {
        model.isDownloaded = false;
        model.progress = 0;
      });
    }
    this.refreshDownloadStatuses();
  };

  get isDownloading() {
    return (modelId: string) => downloadManager.isDownloading(modelId);
  }

  getDownloadProgress = (modelId: string) => {
    return downloadManager.getDownloadProgress(modelId);
  };

  /**
   * Reactive list of in-flight downloads. Each entry carries the Model object
   * plus the latest formatted progress strings so observers can render a
   * banner / sheet / list row without re-deriving anything per frame.
   */
  get activeDownloads(): Array<{
    modelId: string;
    model: Model;
    progress: number;
    bytesDownloaded: number;
    bytesTotal: number;
    speedLabel: string;
    etaLabel: string;
  }> {
    return downloadManager.activeJobs.map(job => ({
      modelId: job.model.id,
      model: job.model,
      progress: job.state.progress?.progress ?? 0,
      bytesDownloaded: job.state.progress?.bytesDownloaded ?? 0,
      bytesTotal: job.state.progress?.bytesTotal ?? 0,
      speedLabel: job.state.progress?.speed ?? '',
      etaLabel: job.state.progress?.eta ?? '',
    }));
  }

  /**
   * Removes a model from the models list if it is not downloaded.
   * @param modelId - The ID of the model to remove.
   * @returns boolean - Returns true if the model was removed, false otherwise.
   */
  removeModelFromList = (model: Model): boolean => {
    const modelIndex = this.models.findIndex(
      m => m.id === model.id && m.origin === model.origin,
    );
    if (modelIndex !== -1) {
      const _model = this.models[modelIndex];
      if (!_model.isDownloaded) {
        runInAction(() => {
          this.models.splice(modelIndex, 1);
        });
        return true;
      }
    }
    return false;
  };

  deleteModel = async (model: Model) => {
    // id should work as well, as long as we are differentiating between models by origin.
    const modelIndex = this.models.findIndex(
      m => m.id === model.id && m.origin === model.origin,
    );
    if (modelIndex === -1) {
      return;
    }
    const _model = this.models[modelIndex];

    // Special handling for projection models
    if (_model.modelType === ModelType.PROJECTION) {
      const canDeleteResult = this.canDeleteProjectionModel(_model.id);
      if (!canDeleteResult.canDelete) {
        throw new Error(
          canDeleteResult.reason || 'Cannot delete projection model',
        );
      }

      // Disable vision for dependent models when their projection model is deleted
      if (
        canDeleteResult.dependentModels &&
        canDeleteResult.dependentModels.length > 0
      ) {
        // Use Promise.allSettled to handle potential errors gracefully
        await Promise.allSettled(
          canDeleteResult.dependentModels.map(dependentModel =>
            this.setModelVisionEnabled(dependentModel.id, false),
          ),
        );
      }
    }

    // Store all projection model IDs that this LLM could use
    const projectionModelIds: string[] = [];
    if (_model.supportsMultimodal) {
      // Add the default projection model
      if (_model.defaultProjectionModel) {
        projectionModelIds.push(_model.defaultProjectionModel);
      }
      // Add all compatible projection models (in case user downloaded additional ones)
      if (_model.compatibleProjectionModels) {
        _model.compatibleProjectionModels.forEach(id => {
          if (!projectionModelIds.includes(id)) {
            projectionModelIds.push(id);
          }
        });
      }
    }

    const filePath = await this.getModelFullPath(_model);
    if (_model.isLocal || _model.origin === ModelOrigin.LOCAL) {
      // Local models are always removed from the list, when the file is deleted.

      // Check if we need to release context (if this model is currently active)
      const needsContextRelease = this.activeModelId === _model.id;

      // Remove model from list first
      runInAction(() => {
        this.models.splice(modelIndex, 1);
      });

      // Release context if needed - this will handle all state cleanup
      if (needsContextRelease) {
        await this.releaseContext(true); // Clear active model and all related state
      }

      // Delete the file from internal storage
      try {
        await RNFS.unlink(filePath);
      } catch (err) {
        console.error('Failed to delete local model file:', err);
      }
    } else {
      // Non-local models are not removed from the list, when the file is deleted.
      console.log('deleting: ', filePath);

      try {
        if (filePath) {
          await RNFS.unlink(filePath);

          // Check if we need to release context (if this model is currently active)
          const needsContextRelease = this.activeModelId === _model.id;

          // Update model state first
          runInAction(() => {
            _model.progress = 0;
            _model.isDownloaded = false; // Mark as not downloaded after successful deletion
          });

          // Release context if needed - this will handle all state cleanup
          if (needsContextRelease) {
            await this.releaseContext(true); // Clear active model and all related state
          }

          //console.log('models: ', this.models);
        } else {
          console.error("Failed to delete, file doesn't exist: ", filePath);
        }
        this.refreshDownloadStatuses();
      } catch (err) {
        console.error('Failed to delete:', err);
      }
    }

    // After deleting an LLM, check if any of its projection models have become orphaned
    if (
      projectionModelIds.length > 0 &&
      _model.modelType !== ModelType.PROJECTION
    ) {
      await this.cleanupOrphanedProjectionModels(projectionModelIds);
    }

    if (this.contextInitParams.selectedDraftModelId === _model.id) {
      this.setSelectedDraftModel(undefined);
    }
  };

  /**
   * Fetch and persist GGUF metadata for a downloaded model
   * Called after download completes to enable accurate memory estimation
   */
  fetchAndPersistGGUFMetadata = async (model: Model) => {
    try {
      const filePath = await this.getModelFullPath(model);
      if (!filePath) {
        console.warn(
          '[ModelStore] Cannot fetch GGUF metadata: model path is undefined',
        );
        return;
      }

      const modelInfo = await loadLlamaModelInfo(filePath);
      if (!modelInfo || typeof modelInfo !== 'object') {
        console.warn('[ModelStore] Invalid model info returned');
        return;
      }

      // Default vocab sizes by architecture (matches Python memory_estimator.py)
      const ARCH_DEFAULT_VOCAB: Record<string, number> = {
        llama: 128256,
        gemma2: 256000,
        gemma3n: 262144,
        qwen2: 151936,
        qwen3: 151936,
        lfm2: 65536,
        phi3: 32064,
        mistral: 32000,
        deepseek2: 102400,
        clip: 49408, // CLIP models have smaller vocab
      };

      // Get the architecture to determine the correct key prefix
      const architecture: string =
        (modelInfo as any)['general.architecture'] || 'llama';

      // Helper to get architecture-specific value with fallback (matches Python get_arch_value)
      const getArchValue = (
        field: string,
        defaultValue?: number,
      ): number | undefined => {
        const key = `${architecture}.${field}`;
        const value = (modelInfo as any)[key];
        if (value !== undefined && value !== null) {
          // Handle string values (GGUF sometimes returns strings)
          if (typeof value === 'string') {
            const parsed = value.includes('.')
              ? parseFloat(value)
              : parseInt(value, 10);
            return isNaN(parsed) ? defaultValue : parsed;
          }
          return typeof value === 'number' ? value : defaultValue;
        }
        return defaultValue;
      };

      // Extract core fields (these are required)
      const n_layers = getArchValue('block_count');
      const n_embd = getArchValue('embedding_length');
      const n_head = getArchValue('attention.head_count');

      // Validate core fields exist - without these we can't estimate memory
      if (!n_layers || !n_embd || !n_head) {
        return;
      }

      // Extract optional fields with fallbacks (matches Python ModelInfo.__post_init__)
      const n_head_kv = getArchValue('attention.head_count_kv', n_head); // fallback to n_head
      const n_vocab =
        getArchValue('vocab_size') ||
        ARCH_DEFAULT_VOCAB[architecture] ||
        128000;

      // Derive head dimensions if not present (matches Python)
      const n_embd_head_k =
        getArchValue('attention.key_length') || Math.floor(n_embd / n_head);
      const n_embd_head_v =
        getArchValue('attention.value_length') || Math.floor(n_embd / n_head);

      // SWA (Sliding Window Attention) - optional
      const sliding_window = getArchValue('attention.sliding_window');

      // Context length from GGUF
      const context_length = getArchValue('context_length');

      const nextn_predict_layers = getArchValue('nextn_predict_layers');
      const embedding_length_out = getArchValue('embedding_length_out');

      const metadata = {
        architecture,
        n_layers,
        n_embd,
        n_head,
        n_head_kv: n_head_kv!,
        n_vocab,
        n_embd_head_k,
        n_embd_head_v,
        sliding_window,
        context_length,
        nextn_predict_layers,
        embedding_length_out,

        // ── 「模型信息」悬浮窗要展示的补充字段。
        // loadLlamaModelInfo 返回的是 GGUF 的完整 key-value 全集，
        // 所以这些不用改原生，直接按标准 key 名取即可。
        size_label: (modelInfo as any)['general.size_label'] as
          | string
          | undefined,
        file_type: getArchValue('file_type'),
        tensor_count: (modelInfo as any)['general.tensor_count'],
        kv_count: (modelInfo as any)['general.kv_count'],
        gguf_version: (modelInfo as any)['general.gguf_version'],
        n_ff: getArchValue('feed_forward_length'),
        rms_norm_eps:
          getArchValue('attention.layer_norm_rms_epsilon') ??
          (modelInfo as any)['general.attention.layer_norm_rms_epsilon'],
        rope_freq_base: getArchValue('rope.freq_base'),
        bos_token_id: (modelInfo as any)['tokenizer.ggml.bos_token_id'],
        eos_token_id: (modelInfo as any)['tokenizer.ggml.eos_token_id'],
      };

      const paramCount = parseSizeLabel(
        (modelInfo as any)['general.size_label'],
      );

      runInAction(() => {
        model.ggufMetadata = metadata;
        if (!model.params && paramCount) {
          model.params = paramCount;
        }

        // 用 GGUF architecture 校正视觉能力。
        // clip / siglip / vit 这类就是投影模型（mmproj 本体），
        // 读出头之后可以确定地盖章，不再依赖文件名猜测。
        //
        // ⚠️ 这里必须**无条件**用 arch 覆盖，不能只在 supportsMultimodal
        // 还没被赋值时才判。否则本地导入时按文件名猜成 vision 的纯文本
        // 模型（文件名里带 -v / vl 之类）会被永久钉死成「视觉模型」，
        // 用户看到的就是「两个都标成图像，而且都加载不了」。
        const archLower = (architecture || '').toLowerCase();
        if (isProjectionArch(archLower)) {
          model.modelType = ModelType.PROJECTION;
          // 投影模型是「视觉能力的一环」，所以标成具备多模态能力，
          // 但**类型**是 PROJECTION —— UI 会据此把它和对话模型区分开。
          model.supportsMultimodal = true;
        } else if (model.modelType !== ModelType.PROJECTION) {
          if (isVisionLLMArch(archLower)) {
            model.supportsMultimodal = true;
            if (model.modelType === undefined) {
              model.modelType = ModelType.VISION;
            }
          } else {
            // arch 明确不是视觉 →撤销导入阶段按文件名的猜测
            model.supportsMultimodal = false;
            model.visionEnabled = undefined;
            model.defaultProjectionModel = undefined;
            model.compatibleProjectionModels = undefined;
            if (model.modelType === ModelType.VISION) {
              model.modelType = undefined;
            }
          }
          model.capabilities = model.supportsMultimodal
            ? model.capabilities?.includes('vision')
              ? model.capabilities
              : [...(model.capabilities ?? []), 'vision']
            : model.capabilities?.filter(c => c !== 'vision');
        }
      });
    } catch (error) {
      console.warn('[ModelStore] Failed to fetch GGUF metadata:', error);
      // ⚠️ 读不到 GGUF 头时，**只撤销导入阶段按文件名的猜测**，
      // 绝不碰用户已经确认过的配置。
      //
      // 以前这里只 warn，`supportsMultimodal` 会一直保留着导入时按
      // `-vl / -vision / -omni` 猜出来的 true，纯文本模型就这样被永久
      // 钉成「视觉模型」（而且这个字段是持久化的，重启也不纠正）。
      //
      // 但**无条件撤销是错的**：用户手动绑过 mmproj 的模型
      // （`defaultProjectionModel` 有值）在下次读头失败时会被一起清掉，
      // 结果就是「我明明配好了，App 说我没有视觉模型」——
      // 2026-10-18 实测踩过这个坑。
      //
      // 判据（满足任一即视为"用户已确认"，什么都不动）：
      //   1. `defaultProjectionModel` 有值 —— 手动绑过 mmproj
      //   2. `ggufMetadata` 已存在 —— 曾经读成功过头
      //   3. `compatibleProjectionModels` 非空 —— 手动加过兼容列表
      const userConfirmed =
        !!model.defaultProjectionModel ||
        !!model.ggufMetadata ||
        (model.compatibleProjectionModels?.length ?? 0) > 0;

      if (!userConfirmed && model.modelType !== ModelType.PROJECTION) {
        // 只有"从来没读成功、也没绑过"的模型才撤销导入时的文件名猜测
        runInAction(() => {
          model.supportsMultimodal = false;
          model.visionEnabled = undefined;
          model.defaultProjectionModel = undefined;
          model.compatibleProjectionModels = undefined;
          if (model.modelType === ModelType.VISION) {
            model.modelType = undefined;
          }
          model.capabilities = model.capabilities?.filter(c => c !== 'vision');
        });
      }
    }
  };

  /**
   * Load GGUF metadata for downloaded models that don't have it yet.
   * Runs in background, doesn't block startup.
   */
  private loadMissingGGUFMetadata = () => {
    const modelsNeedingMetadata = this.models.filter(m => {
      if (!m.isDownloaded || m.modelType === ModelType.PROJECTION) {
        return false;
      }
      if (!m.ggufMetadata) {
        return true;
      }
      // ⚠️ 已有的判定可能是错的，也需要重算一次。
      // 旧版本用文件名猜视觉能力，纯文本模型只要文件名里带 -v / vl 之类
      // 就会被永久钉成「视觉模型」（而且 supportsMultimodal 是持久化的，
      // 重启也不会自己纠正）。这里拿已经读到的 architecture 复核一遍：
      // 标记和 arch 对不上就重跑，读完会按 arch 无条件覆盖。
      //
      // ⚠️ 但**手动绑过 mmproj 的模型必须豁免**：纯文本 LLM + 外接 mmproj
      // 本来就是合法用法（llama.cpp 的 mtmd 就是这么设计的），它的
      // architecture 天生不含 vl/vision。把这类模型重跑一遍就会把
      // 绑定关系清掉，用户看到的就是「我明明配好了，App 说没有视觉模型」。
      const userBoundProjection =
        !!m.defaultProjectionModel ||
        (m.compatibleProjectionModels?.length ?? 0) > 0;
      if (userBoundProjection) {
        return false;
      }
      const arch = (m.ggufMetadata?.architecture || '').toLowerCase();
      if (!arch) {
        return false;
      }
      // 注意 modelType 的静态类型不含 PROJECTION（顶部的 filter 已经排掉了），
      // 但运行时可能是 —— 用宽类型比较，别让TS 误判成永不相等。
      const modelType = m.modelType as ModelType | undefined;
      if (isProjectionArch(arch) && modelType !== ModelType.PROJECTION) {
        return true;
      }
      if (
        !isProjectionArch(arch) &&
        !isVisionLLMArch(arch) &&
        m.supportsMultimodal
      ) {
        return true;
      }
      return false;
    });

    if (modelsNeedingMetadata.length === 0) {
      return;
    }

    // Fetch in background, don't block startup
    (async () => {
      for (const model of modelsNeedingMetadata) {
        try {
          await this.fetchAndPersistGGUFMetadata(model);
        } catch (error) {
          // Log but continue - not critical for startup
          console.warn(
            '[ModelStore] Failed to fetch metadata for',
            model.name,
            error,
          );
        }
      }
    })();
  };

  /**
   * Determines whether multimodal (vision) should be enabled for a model load.
   *
   * Resolves multimodal config: enables vision if model supports it and a projection
   * model is available (explicit path or downloaded default).
   *
   * @returns
   * - isMultimodalInit: true if we should initialize with vision support
   * - resolvedMmProjPath: file path to the projection model (only if isMultimodalInit=true)
   * - projectionModel: the Model object for the projection (only when auto-resolved from defaults)
   *
   * Note: This is a read-only operation safe to call outside the mutex.
   */
  private resolveMultimodalConfig = async (
    model: Model,
    mmProjPath?: string,
  ): Promise<{
    isMultimodalInit: boolean;
    resolvedMmProjPath?: string;
    projectionModel?: Model;
  }> => {
    const visionEnabled = this.getModelVisionPreference(model);

    // Priority 1: Explicit path provided by caller
    if (mmProjPath && visionEnabled) {
      return {isMultimodalInit: true, resolvedMmProjPath: mmProjPath};
    }

    // Priority 2: Auto-resolve from model's default projection model
    if (
      model.supportsMultimodal &&
      model.defaultProjectionModel &&
      visionEnabled
    ) {
      const projectionModel = this.models.find(
        m => m.id === model.defaultProjectionModel,
      );
      if (projectionModel?.isDownloaded) {
        const resolvedPath = await this.getModelFullPath(projectionModel);
        return {
          isMultimodalInit: true,
          resolvedMmProjPath: resolvedPath,
          projectionModel,
        };
      }
    }

    // Default: No multimodal support
    return {isMultimodalInit: false};
  };

  private resolveDraftConfig = async (model: Model): Promise<DraftConfig> => {
    const candidate = resolveDraftCandidate(
      model,
      this.models,
      this.contextInitParams,
    );
    if (candidate.mode !== 'paired') {
      return candidate;
    }

    const resolvedDraftPath = await this.getModelFullPath(candidate.draftModel);
    if (resolvedDraftPath) {
      return {
        mode: 'paired',
        resolvedDraftPath,
        draftModel: candidate.draftModel,
      };
    }

    return unpairedDraftCandidate(model);
  };

  get effectiveDraftMode(): DraftConfig['mode'] {
    return effectiveDraftModeOf(this);
  }

  get effectiveDraftCacheDefaults(): {k: CacheType; v: CacheType} {
    return draftCacheDefaults(
      this.effectiveDraftMode,
      this.contextInitParams.flash_attn_type === 'on',
    );
  }

  /**
   * Check memory/capability requirements and show warning alert if needed.
   * Returns true if user confirms or no warning needed, false if cancelled.
   */
  private checkMemoryAndConfirm = async (
    model: Model,
    isMultimodalInit: boolean,
    projectionModel?: Model,
    draftModel?: Model,
  ): Promise<boolean> => {
    let hasMemory = true;
    try {
      hasMemory = await hasEnoughMemory(model, projectionModel, draftModel);
    } catch (error) {
      console.error('Memory check failed:', error);
      return false;
    }

    const isCapable = isMultimodalInit ? await isHighEndDevice() : true;
    const hasMemoryIssue = !hasMemory;
    const hasCapabilityIssue = isMultimodalInit && !isCapable;

    if (!hasMemoryIssue && !hasCapabilityIssue) {
      return true; // No warning needed
    }

    console.warn(
      `Device performance warning for model: ${model.name} - Memory: ${hasMemoryIssue}, Capability: ${hasCapabilityIssue}`,
    );

    let title: string;
    let message: string;

    if (hasMemoryIssue && hasCapabilityIssue) {
      title = uiStore.l10n.memory.alerts.combinedWarningTitle;
      message = uiStore.l10n.memory.alerts.combinedWarningMessage;
    } else if (hasMemoryIssue) {
      title = uiStore.l10n.memory.alerts.memoryWarningTitle;
      message = uiStore.l10n.memory.alerts.memoryWarningMessage;
    } else {
      title = uiStore.l10n.memory.alerts.multimodalWarningTitle;
      message = uiStore.l10n.memory.alerts.multimodalWarningMessage;
    }

    // Show alert and wait for user decision - this happens OUTSIDE the mutex
    return new Promise<boolean>(resolve => {
      Alert.alert(title, message, [
        {
          text: uiStore.l10n.memory.alerts.cancel,
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: uiStore.l10n.memory.alerts.continue,
          onPress: () => resolve(true),
        },
      ]);
    });
  };

  /**
   * Take exclusive ownership of the native context for the e2e benchmark
   * runner. Sets `benchmarkActive` synchronously so any new auto-load is
   * gated, then drains the mutex (in case one is already in flight) and
   * releases whatever context exists. After this resolves, the runner can
   * safely call `initLlama` directly without racing the rest of the app.
   *
   * Pairs with `exitBenchmarkMode()`. The runner MUST call exit even on
   * failure paths or chat / header / sheet inits will stay rejected.
   */
  enterBenchmarkMode = async (): Promise<void> => {
    runInAction(() => {
      this.benchmarkActive = true;
    });

    const op = this.contextOperationMutex.then(async () => {
      // Release any context the rest of the app loaded (e.g. ChatView's
      // auto-load on cold launch). clearActiveModel:true so the queued
      // post-mutex callers see a clean slate if they ever run.
      await this._releaseContextInternal(true);
    });
    this.contextOperationMutex = op.then(() => {}).catch(() => {});
    await op;
  };

  /**
   * Hand context ownership back to the rest of the app. Intentionally
   * trivial — no native work — so it's safe to call from a `finally` block.
   */
  exitBenchmarkMode = (): void => {
    runInAction(() => {
      this.benchmarkActive = false;
    });
  };

  /**
   * Initialize a model context, optionally with multimodal support.
   *
   * Architecture:
   * - Phase 1 (outside mutex): Resolve config, check memory, show alert if needed
   * - Phase 2 (inside mutex): Release old context, load new context
   *
   * The "last-one-wins" pattern uses pendingModelId set at the START, then checked
   * both after the Alert (to skip if superseded) and inside the mutex (final check).
   * Note: "last-one-wins" not always loading the last tapped model, but it's ok, as
   * long as it is not leading the deadlock or mem leak.
   *
   * @param model The main LLM model to initialize
   * @param mmProjPath Optional path to a projection model for multimodal support
   * @returns The initialized LlamaContext, or null if cancelled/skipped
   */
  initContext = async (
    model: Model,
    mmProjPath?: string,
  ): Promise<LlamaContext | null> => {
    // Benchmark mode owns the native context lifecycle end-to-end.
    // Reject synchronously so any racing caller (ChatView auto-load, header,
    // sheet) fails fast instead of silently shadowing the matrix's per-cell
    // devices / n_gpu_layers via the "already loaded → skip" path.
    if (this.benchmarkActive) {
      throw new Error(
        '[ModelStore] initContext rejected: benchmark mode is active',
      );
    }

    // === Phase 1: Pre-flight checks OUTSIDE mutex ===

    // Mark intent immediately - this is the "last-one-wins" tracking
    // If another model is requested while we're showing an Alert, their
    // pendingModelId will overwrite ours and we'll detect it later
    this.pendingModelId = model.id;

    // Set loading state immediately for UI feedback
    runInAction(() => {
      this.isContextLoading = true;
      this.loadingModel = model;
    });

    // 「直接引用」模型：fullPath 是 /proc/self/fd/<fd>，进程重启后必然失效，
    // 必须用持久化的 contentUri 重新开一次 fd，否则下面会报文件不存在。
    if (model.contentUri) {
      await this.refreshProcFdPath(model);
    }

    try {
      // Resolve multimodal configuration
      const {isMultimodalInit, resolvedMmProjPath, projectionModel} =
        await this.resolveMultimodalConfig(model, mmProjPath);

      const draftConfig = await this.resolveDraftConfig(model);

      // Check memory and get user confirmation if needed (no mutex - UI interaction)
      const shouldProceed = await this.checkMemoryAndConfirm(
        model,
        isMultimodalInit,
        projectionModel,
        pairedDraftModel(draftConfig),
      );

      if (!shouldProceed) {
        throw new Error('Model loading cancelled by user');
      }

      // After Alert (if shown), check if we're still the intended model
      // Another model request might have come in while user was deciding
      if (this.pendingModelId !== model.id) {
        console.log(
          `[ModelStore] Skipping "${model.name}" - user switched to "${this.pendingModelId}" during confirmation`,
        );
        return null;
      }

      // === Phase 2: Execute context operations WITH mutex ===

      const operationPromise = this.contextOperationMutex.then(async () => {
        // A benchmark may have started while this load sat in the mutex
        // queue (cold-launch deep-link race). Bail before doing native work
        // — enterBenchmarkMode will release any context we leave behind.
        if (this.benchmarkActive) {
          console.log(
            `[ModelStore] Skipping queued load for "${model.name}" - benchmark mode is active`,
          );
          return null;
        }

        // Final check if this request is still current (last-one-wins)
        // This catches race conditions where another request queued while we waited
        if (this.pendingModelId !== model.id) {
          console.log(
            `[ModelStore] Skipping outdated load for "${model.name}" - user now wants model "${this.pendingModelId}"`,
          );
          return null;
        }

        // Skip if already loaded
        if (this.activeModelId === model.id && this.context) {
          console.log(
            `[ModelStore] Model "${model.name}" is already loaded, skipping`,
          );
          return this.context;
        }

        // Release existing context
        await this._releaseContextInternal();

        // Small delay for native cleanup before loading next model
        await new Promise(resolve => setTimeout(resolve, 100));

        // Proceed with actual initialization
        return this.proceedWithInitialization(
          model,
          resolvedMmProjPath,
          isMultimodalInit,
          projectionModel,
          draftConfig,
        );
      });

      // Keep mutex chain intact by swallowing errors
      this.contextOperationMutex = operationPromise
        .then(() => {})
        .catch(() => {});

      try {
        return await operationPromise;
      } catch (error) {
        // 「直接引用」的模型：llama.cpp 拿到 /proc/self/fd/<fd> 后会**重新 open
        // 这个路径**（不是复用我们的 fd）。Android 13+ 的 scoped storage 只把
        // 读权限授给了 fd、没授给底层路径 → 加载直接失败（"Failed to load model"）。
        // 这里给一次「复制进 App 目录后重试」的机会。
        //
        // 放在 mutex 之外：重试要重新排队拿锁，在锁内重试会自己等自己。
        // 复制成功会把 contentUri 清空，所以不会无限递归。
        const message = error instanceof Error ? error.message : String(error);
        if (model.contentUri && /Failed to load model/i.test(message)) {
          const materialized = await this.materializeContentUriModel(model);
          if (materialized) {
            // 失败态是上一步 proceedWithInitialization 写进去的，重试前先清掉，
            // 否则错误报告弹层会盖在这次「复制并加载」的提示上面。
            runInAction(() => {
              this.modelLoadError = null;
            });
            return await this.initContext(model, mmProjPath);
          }
        }
        throw error;
      }
    } finally {
      runInAction(() => {
        this.isContextLoading = false;
        this.loadingModel = undefined;
      });
    }
  };

  /**
   * Proceed with the actual model initialization after device capability checks
   */
  private async proceedWithInitialization(
    model: Model,
    mmProjPath?: string,
    isMultimodalInit: boolean = false,
    projectionModel?: Model,
    draftConfig?: DraftConfig,
  ): Promise<LlamaContext> {
    const filePath = await this.getModelFullPath(model);
    if (!filePath) {
      throw new Error('Model path is undefined');
    }

    runInAction(() => {
      this.isMultimodalActive = false; // Reset until we confirm it's enabled
      this.activeProjectionModelId = projectionModel?.id;
    });

    // Get all effective initialization settings BEFORE try block
    // so they're available for error reporting if initialization fails
    const effectiveSettings = await this.getEffectiveContextInitParams(
      filePath,
      draftConfig,
    );

    // 档位默认的 99 只是「尽量全占」的占位符 → 按模型实际层数折算成 90%。
    // 留一成给 KV cache / 输出层，避免 GPU 显存吃满把整机拖卡。
    // 用户手选的层数原样保留。
    effectiveSettings.n_gpu_layers = resolveGpuLayersForModel(
      effectiveSettings.n_gpu_layers,
      model.ggufMetadata?.n_layers,
    );

    try {
      // Create properly versioned ContextInitParams
      const contextInitParams = createContextInitParams(effectiveSettings);

      const t0 = Date.now();
      const ctx = await initLlama(
        {
          model: filePath,
          ...effectiveSettings, // Use effectiveSettings without version for llama.rn
          use_progress_callback: true,
        },
        (_progress: number) => {
          //console.log('progress: ', _progress);
        },
      );
      const t1 = Date.now();
      console.log('init time: ', t1 - t0);

      await this.updateModelStopTokens(ctx, model);

      // Check and update thinking capabilities
      await this.updateModelThinkingCapabilities(ctx, model);

      // Initialize multimodal support if mmproj path was provided
      if (isMultimodalInit && mmProjPath) {
        try {
          // ⚠️ mtmd 打不开 content:// 的 /proc/self/fd/N 路径。
          //
          // 2026-10-18 实测（某机型）：
          //   llama_rn_context_mtmd:731 Failed to initialize multimodal
          //   context with mmproj: /proc/self/fd/133
          // 主模型走 llama_model_load（mmap 已打开的 fd）能成，
          // 但 mtmd 是**独立 open** mmproj 文件的，procfs 不允许
          // 重新 open 自己的 fd 路径，于是 1ms 内直接失败。
          //
          // 解法：先把 mmproj 拷到 App 内部的真实文件，再拿真实路径
          // 去 initMultimodal。带缓存 —— 同一个 mmproj 只拷一次。
          const usableMmProjPath = await this.ensureLocalMmprojPath(
            mmProjPath,
            projectionModel,
          );
          console.log(
            'Initializing multimodal support with path:',
            usableMmProjPath,
          );

          // Initialize multimodal with the new API format
          // Apply effective value: clamp image_max_tokens to n_ctx
          const success = await ctx.initMultimodal({
            path: usableMmProjPath,
            // ⚠️ 视觉投影（mmproj）强制走 CPU，不用 GPU。
            //
            // 2026-10-29 实测 + 根因：开启 GPU（no_gpu_devices=false）时，
            // initMultimodal() 返回 true、图片 tokenize 也正常
            // （日志 `Chunk 1: type=IMAGE, n_tokens=486`），但随后的
            // 多模态前向（生成）在原生层既不回调也不 resolve —— 表现就是
            // 「图像识别一直转圈、到不动」。这是 Android 上 mtmd GPU 投影的
            // 通病（Adreno/Mali 上尤甚）。文本生成仍按用户设置走 GPU，
            // 这里只把视觉编码器钉在 CPU，慢一点但稳定可用。
            use_gpu: false,
            image_max_tokens: Math.min(
              this.contextInitParams.image_max_tokens ?? 512,
              this.contextInitParams.n_ctx,
            ),
          });

          if (!success) {
            console.error('Failed to initialize multimodal support');
          } else {
            console.log('Multimodal support initialized successfully');

            // ⚠️ 只认 initMultimodal 的返回值，**不再拿 isMultimodalEnabled()
            // 二次判定**。
            //
            // 2026-10-18 实测：initMultimodal() 返回 true、随后的图片
            // tokenize 也完全正常（日志里 `Chunk 1: type=IMAGE, n_tokens=486`），
            // 但 isMultimodalEnabled() 返回 false —— 于是 isMultimodalActive
            // 被写回 false，UI 一直说「视觉还没生效」，用户明明能用。
            //
            // initMultimodal() 返回 true 就是明确的成功信号，够了。
            // isMultimodalEnabled() 只留作诊断日志，不参与判定。
            const reported = await ctx
              .isMultimodalEnabled()
              .catch(() => undefined);
            if (reported === false) {
              console.warn(
                '[ModelStore] isMultimodalEnabled() 报 false，但 initMultimodal 已成功；以 init 结果为准',
              );
            }

            runInAction(() => {
              this.isMultimodalActive = true;
              this.activeProjectionModelId = projectionModel?.id;
            });
          }
        } catch (error) {
          console.error('Error initializing multimodal support:', error);
          runInAction(() => {
            this.isMultimodalActive = false;
            this.activeProjectionModelId = undefined;
          });
        }
      }

      runInAction(() => {
        this.context = ctx;
        this.engine = new LocalCompletionEngine(ctx);
        this.activeRemoteBinding = undefined;
        this.activeContextSettings = contextInitParams;
        this.setActiveModel(model.id);
        this.pendingModelId = null;
      });

      // Update largestSuccessfulLoad using GGUF estimator
      try {
        const estimated = getModelMemoryRequirement(
          model,
          projectionModel,
          contextInitParams,
          pairedDraftModel(draftConfig),
        );
        runInAction(() => {
          if (
            this.largestSuccessfulLoad === undefined ||
            estimated > this.largestSuccessfulLoad
          ) {
            this.largestSuccessfulLoad = estimated;
          }
        });
      } catch (error) {
        console.warn(
          '[ModelStore] Failed to update largestSuccessfulLoad:',
          error,
        );
      }

      return ctx;
    } catch (error) {
      console.error(
        `Failed to initialize model context for "${model.name}" (${model.id}):`,
        error,
      );

      // Set error state for UI feedback - include model info and context params for error reporting
      const errorState = createErrorState(error, 'modelInit', undefined, {
        modelId: model.id,
        modelName: model.name,
        modelUrl: model.hfUrl,
        modelSize: model.size,
        contextParams: effectiveSettings,
      });
      runInAction(() => {
        this.modelLoadError = errorState;
      });

      throw error;
    } finally {
      runInAction(() => {
        this.lastUsedModelId = model.id;
      });
    }
  }

  /** Internal release - caller must already hold the mutex. */
  private _releaseContextInternal = async (
    clearActiveModel: boolean = false,
  ) => {
    console.log('attempt to release');
    chatSessionStore.exitEditMode();
    if (!this.context) {
      // For remote models or deletion scenarios, clear engine and state
      if (this.engine || clearActiveModel) {
        // Stop any active remote completion
        if (this.engine) {
          try {
            await this.engine.stopCompletion();
          } catch {
            // Ignore errors from stopping remote completion
          }
        }
        runInAction(() => {
          this.engine = undefined;
          this.activeRemoteBinding = undefined;
          if (clearActiveModel) {
            this.activeModelId = undefined;
          }
          this.isMultimodalActive = false;
          this.activeProjectionModelId = undefined;
        });
      }
      if (!this.engine && !clearActiveModel) {
        return 'No context to release';
      }
      return 'Remote engine cleared';
    }

    try {
      // IMPORTANT: Stop-Await-Release Pattern
      // This prevents race condition where completion callback fires after context is freed
      // which causes SIGSEGV in isMultimodalEnabled/createCompletionResult
      if (
        this.inferencing ||
        this.isStreaming ||
        this.activeCompletionPromise
      ) {
        console.log('Stopping active completion before context release');

        // Step 1: Signal the completion to stop
        try {
          await this.context.stopCompletion();
        } catch (stopError) {
          console.warn('Error stopping completion:', stopError);
          // Continue with release even if stop fails
        }

        // Step 2: Wait for the completion promise to actually finish
        // This is critical - stopCompletion() only signals, it doesn't wait
        if (this.activeCompletionPromise) {
          console.log('Waiting for completion promise to finish...');
          try {
            // Wait for promise to settle (ignore errors, just wait for it to complete)
            await this.activeCompletionPromise.catch(() => {});
          } catch {
            // Ignore any errors, we just need to wait
          }
          this.activeCompletionPromise = null;
        }

        // Clear inference flags
        runInAction(() => {
          this.inferencing = false;
          this.isStreaming = false;
        });
      }

      // Step 3: Now safe to release - First check if multimodal is enabled and release it if needed
      if (this.isMultimodalActive) {
        console.log('Releasing multimodal context first');
        try {
          await this.context.releaseMultimodal();
          // Immediately clear multimodal state after successful release
          runInAction(() => {
            this.isMultimodalActive = false;
            this.activeProjectionModelId = undefined;
          });
          console.log('Multimodal context released and state cleared');
        } catch (error) {
          console.error('Error releasing multimodal context:', error);
          // Even if release fails, clear the state to prevent blocking deletion
          runInAction(() => {
            this.isMultimodalActive = false;
            this.activeProjectionModelId = undefined;
          });
        }
      }

      // Then release the main context
      await this.context.release();
      console.log('released');
    } catch (error) {
      console.error('Error during context release:', error);
    } finally {
      runInAction(() => {
        this.context = undefined;
        this.engine = undefined;
        this.activeRemoteBinding = undefined;
        this.activeContextSettings = undefined;
        // Ensure multimodal state is cleared even if something went wrong above
        this.isMultimodalActive = false;
        this.activeProjectionModelId = undefined;
        // Clear active model if requested (for deletion scenarios)
        if (clearActiveModel) {
          this.activeModelId = undefined;
        }
      });

      // Update availableMemoryCeiling after release (clean state)
      try {
        const availableBytes = await NativeHardwareInfo.getAvailableMemory();
        runInAction(() => {
          if (
            this.availableMemoryCeiling === undefined ||
            availableBytes > this.availableMemoryCeiling
          ) {
            this.availableMemoryCeiling = availableBytes;
          }
        });
      } catch (error) {
        console.warn(
          '[ModelStore] Failed to update availableMemoryCeiling:',
          error,
        );
      }
    }
    return 'Context released successfully';
  };

  /** Acquires mutex before releasing context. */
  releaseContext = async (clearActiveModel: boolean = false) => {
    const operationPromise = this.contextOperationMutex.then(async () => {
      return this._releaseContextInternal(clearActiveModel);
    });

    // Swallow errors to keep mutex chain intact
    this.contextOperationMutex = operationPromise
      .then(() => {})
      .catch(() => {});

    return operationPromise;
  };

  manualReleaseContext = async () => {
    await this.releaseContext(true); // Clear active model for manual release
  };

  /**
   * 用当前 contextInitParams 重新加载当前正在用的模型。
   *
   * mmap / n_gpu_layers 这类参数只在 initLlama 建立 context 时读一次，
   * 改完 setUseMmap / setNGPULayers 只是改了内存里的参数，不重载的话
   * 跑的还是旧配置 —— 这就是「设了却没生效」。这里把上下文卸掉再重建，
   * 让新参数真正落到 native 侧。
   *
   * @returns 是否确实重载了（没有已激活模型时返回 false）
   */
  reloadActiveModelWithNewParams = async (): Promise<boolean> => {
    const model = this.models.find(m => m.id === this.activeModelId);
    if (!model) {
      return false;
    }
    // 不清 activeModelId：initContext 需要它把模型重新标记为激活态
    await this.releaseContext(false);
    await this.initContext(model);
    return true;
  };

  get activeModel(): Model | undefined {
    // Look in local models first, then remote models
    return (
      this.models.find(model => model.id === this.activeModelId) ||
      this.remoteModels.find(model => model.id === this.activeModelId)
    );
  }

  private get capabilityEnv(): CapabilityEnv {
    return {
      remoteCaps: serverStore.remoteCaps,
      listCaps: serverStore.listCaps,
      binding: this.activeRemoteBinding,
      isMultimodalActive: this.isMultimodalActive,
      activeContextSettings: this.activeContextSettings,
      activeModelId: this.activeModelId,
    };
  }

  /**
   * Capabilities of any model, active or not — the model card's entry point.
   * Never annotate it explicitly as `action`: that untracks the observable
   * reads, so every card would freeze on its first value while the suite
   * stayed green.
   */
  capsFor = (model: Model | undefined): ModelCapabilityView =>
    resolveModelCaps(model, this.capabilityEnv);

  /** Capabilities of the live session — chat's entry point. */
  get activeModelCaps(): ModelCapabilityView {
    return this.capsFor(this.activeModel);
  }

  get activeSamplerDefaults(): Samplers | undefined {
    return samplerDefaultsFor(
      this.activeModel,
      serverStore.remoteCaps,
      this.activeRemoteBinding,
    );
  }

  get lastUsedModel(): Model | undefined {
    return this.lastUsedModelId
      ? this.models.find(m => m.id === this.lastUsedModelId && m.isDownloaded)
      : undefined;
  }

  /**
   * Returns a string context identifier for the active model.
   * For local models: the numeric native context ID as a string.
   * For remote models: "remote-{serverId}" string.
   */
  get contextId(): string | undefined {
    if (this.context) {
      return String(this.context.id);
    }
    const model = this.activeModel;
    if (model?.origin === ModelOrigin.REMOTE && model.serverId) {
      return `remote-${model.serverId}`;
    }
    return undefined;
  }

  /**
   * Derived from `serverStore.userSelectedModels` and `serverStore.servers` —
   * not from `serverModels`, so the list a server currently advertises does not
   * change which cards exist. Remote models are never stored in the persisted
   * `models` array.
   */
  get remoteModels(): Model[] {
    const models: Model[] = [];
    for (const selected of serverStore.userSelectedModels) {
      const server = serverStore.servers.find(s => s.id === selected.serverId);
      if (!server) {
        continue;
      }
      // Use the remote model ID as the display name
      models.push(
        createRemoteModel({
          serverId: selected.serverId,
          serverName: server.name,
          remoteModelId: selected.remoteModelId,
          modelName: selected.remoteModelId,
        }),
      );
    }
    return models;
  }

  setActiveModel(modelId: string) {
    this.activeModelId = modelId;
  }

  /**
   * Set a remote model as the active model and create an OpenAI completion engine.
   * Releases any active local context first.
   */
  setRemoteModel = async (model: Model): Promise<void> => {
    if (!model.serverId || !model.remoteModelId) {
      throw new Error('Model is missing remote configuration');
    }

    // Release any existing context (local or remote)
    await this.releaseContext();

    const apiKey = await serverStore.getApiKey(model.serverId);
    const server = serverStore.servers.find(s => s.id === model.serverId);
    if (!server) {
      throw new Error('Server not found');
    }

    const serverType = toServerType(server.serverType);

    runInAction(() => {
      this.engine = new OpenAICompletionEngine({
        url: server.url,
        remoteModelId: model.remoteModelId!,
        apiKey,
        timeoutMs: server.requestTimeoutMs,
        serverType,
      });
      this.activeRemoteBinding = {
        modelId: model.id,
        serverId: model.serverId!,
        remoteModelId: model.remoteModelId!,
        url: server.url,
        serverType,
      };
      this.setActiveModel(model.id);
      // Do NOT set lastUsedModelId for remote models -- server may be offline on next launch
    });

    serverStore
      .fetchRemoteModelCaps(model.serverId, model.remoteModelId, apiKey)
      .catch(() => {});
  };

  /**
   * Public method that routes model selection to the appropriate handler.
   * All callsites should use selectModel() instead of initContext() directly.
   * - Remote models: calls setRemoteModel()
   * - Local models: calls initContext()
   */
  selectModel = async (model: Model): Promise<void> => {
    if (model.origin === ModelOrigin.REMOTE) {
      await this.setRemoteModel(model);
    } else {
      await this.initContext(model);
    }
  };

  downloadHFModel = async (
    hfModel: HuggingFaceModel,
    modelFile: ModelFile,
    options?: {
      enableVision?: boolean;
      projectionModelId?: string; // User-selected projection model
    },
  ) => {
    try {
      const newModel = await this.addHFModel(hfModel, modelFile);
      if (!newModel) {
        throw new Error('Failed to add model to store');
      }

      // Set vision preference based on user choice
      if (newModel.supportsMultimodal && options?.enableVision !== undefined) {
        this.setModelVisionEnabled(newModel.id, options.enableVision);
        // runInAction(() => {
        //   newModel.visionEnabled = options.enableVision;
        // });
      }

      // Override default projection model with user selection if provided
      if (newModel.supportsMultimodal && options?.projectionModelId) {
        // Validate that selected projection model exists in repository
        const mmprojFiles = getMmprojFiles(hfModel.siblings || []);
        const selectedExists = mmprojFiles.some(
          file =>
            `${hfModel.id}/${file.rfilename}` === options.projectionModelId,
        );

        if (selectedExists) {
          runInAction(() => {
            newModel.defaultProjectionModel = options.projectionModelId;
          });
        } else {
          console.warn(
            'Selected projection model not found in repository, using auto-determined default',
          );
        }
      }

      // Wait a bit to ensure the projection model is added to the store
      // This is needed because addHFModel adds mmproj models asynchronously
      await new Promise(resolve => setTimeout(resolve, 200));

      // Use the centralized download method which handles mmproj automatically
      this.checkSpaceAndDownload(newModel.id);

      // The error handling is now done in the downloadManager callbacks
    } catch (error) {
      // Only handle errors related to the initial setup before the download starts
      console.error('Failed to set up HF model download:', error);
      Alert.alert(
        uiStore.l10n.errors.downloadSetupFailedTitle,
        t(uiStore.l10n.errors.downloadSetupFailedMessage, {
          message: (error as Error).message,
        }),
      );
    }
  };

  /**
   * Adds a new HF model to the models list, only if it doesn't exist yet.
   * For multimodal models, ensures all required projection models are also added.
   * @param hfModel - The Hugging Face model to add.
   * @param modelFile - The model file to add.
   * @returns The new model that was added.
   */
  addHFModel = async (hfModel: HuggingFaceModel, modelFile: ModelFile) => {
    const newModel = hfAsModel(hfModel, modelFile);
    const storeModel = this.models.find(m => m.id === newModel.id);

    // For non-multimodal models, return early if the model already exists
    if (storeModel && !newModel.supportsMultimodal) {
      return storeModel;
    }

    // Add the model to the store if it doesn't exist
    let modelToReturn = storeModel;
    if (!storeModel) {
      runInAction(() => {
        this.models.push(newModel);
      });
      modelToReturn = newModel;
    }

    // For multimodal models, always ensure projection models are in the store
    if (
      newModel.supportsMultimodal &&
      newModel.compatibleProjectionModels?.length
    ) {
      // Get the mmproj files from the repository
      const mmprojFiles = getMmprojFiles(hfModel.siblings || []);

      // Add each projection model to the store if it doesn't exist
      for (const mmprojFile of mmprojFiles) {
        const projModelId = `${hfModel.id}/${mmprojFile.rfilename}`;
        const existingProjModel = this.models.find(m => m.id === projModelId);

        if (!existingProjModel) {
          // Create and add the projection model
          const projModel = hfAsModel(hfModel, mmprojFile);
          runInAction(() => {
            this.models.push(projModel);
          });
        }
      }

      // If we're working with an existing model, update its projection model references
      // to ensure they're current with what's now in the store
      if (storeModel) {
        const updatedCompatibleModels = mmprojFiles.map(
          file => `${hfModel.id}/${file.rfilename}`,
        );

        runInAction(() => {
          // Update compatible projection models list
          storeModel.compatibleProjectionModels = updatedCompatibleModels;

          // Ensure default projection model is set if not already set
          if (
            !storeModel.defaultProjectionModel &&
            updatedCompatibleModels.length > 0
          ) {
            // Use the same logic as hfAsModel to determine the default
            const mmprojFilenames = mmprojFiles.map(file => file.rfilename);
            const recommendedFile = getRecommendedProjectionModel(
              modelFile.rfilename,
              mmprojFilenames,
            );
            if (recommendedFile) {
              storeModel.defaultProjectionModel = `${hfModel.id}/${recommendedFile}`;
            }
          }
        });
      }
    }

    // If this is a projection model, check if we need to update any vision models
    if (newModel.modelType === ModelType.PROJECTION) {
      // Get the repository ID from the model ID
      const repoId = newModel.id.split('/').slice(0, 2).join('/');

      // Find vision models from the same repository
      const visionModels = this.models.filter(
        m =>
          m.supportsMultimodal &&
          m.id.startsWith(repoId) &&
          m.id !== newModel.id,
      );

      // Update the compatible projection models for each vision model
      for (const visionModel of visionModels) {
        if (!visionModel.compatibleProjectionModels?.includes(newModel.id)) {
          runInAction(() => {
            if (!visionModel.compatibleProjectionModels) {
              visionModel.compatibleProjectionModels = [];
            }
            visionModel.compatibleProjectionModels.push(newModel.id);

            // If no default projection model is set, set this one as default
            if (!visionModel.defaultProjectionModel) {
              visionModel.defaultProjectionModel = newModel.id;
            }
          });
        }
      }
    }

    await this.refreshDownloadStatuses();
    return modelToReturn;
  };

  /**
   * Lazy-register a curated onboarding-pal HF entry into `models`.
   * Single writer for HF-origin onboarding picks; only call site is
   * `useOnboardingHandlers.finish`. Synthesizes the minimal
   * `{hfModel, modelFile}` pair and delegates to `addHFModel`, which
   * provides idempotency. `siblings: []` keeps `isVisionRepo` false so
   * no projection model materializes (text-only by design).
   */
  registerOnboardingPalModel = async (
    entry: OnboardingPalModelEntry,
  ): Promise<Model | undefined> => {
    const modelFile: ModelFile = {
      rfilename: entry.filename,
      url: entry.downloadUrl,
      size: entry.sizeBytes,
    } as ModelFile;
    const hfModel: HuggingFaceModel = {
      id: entry.repo,
      author: entry.author,
      url: `https://huggingface.co/${entry.repo}`,
      specs: {gguf: {total: entry.params}},
      siblings: [] as ModelFile[],
    } as HuggingFaceModel;
    return this.addHFModel(hfModel, modelFile);
  };

  removeModelByFullPath = (fullPath: string) => {
    const index = this.models.findIndex(
      m =>
        (m.isLocal || m.origin === ModelOrigin.LOCAL) &&
        m.fullPath === fullPath,
    );
    if (index !== -1) {
      this.models.splice(index, 1);
    }
  };

  addLocalModel = async (localFilePath: string) => {
    const filename = localFilePath.split('/').pop(); // Extract filename from path
    if (!filename) {
      throw new Error('Invalid local file path');
    }

    // Read file size from disk
    let fileSize = 0;
    try {
      const stat = await RNFS.stat(localFilePath);
      fileSize = Number(stat.size) || 0;
    } catch (e) {
      console.warn('[ModelStore] Failed to read file size:', e);
    }

    const defaultSettings = getLocalModelDefaultSettings();

    // 本地导入时先按文件名判定视觉能力。
    // 以前这里完全不设 supportsMultimodal / modelType，导致本地导入的
    // 视觉模型（mmproj 投影 + Qwen2-VL 这类多模态 LLM）在模型页全被标成「文本」。
    // 文件名只是先判一轮，GGUF 头读出来之后 fetchAndPersistGGUFMetadata
    // 会用 architecture 再校正一次。
    const projByName = isProjectionByFilename(filename);
    const visionByName = isVisionLLMByFilename(filename);

    const model: Model = {
      id: uuidv4(), // Generate a unique ID
      author: '',
      name: filename,
      size: fileSize,
      params: 0, // Will be updated after GGUF metadata read
      isDownloaded: true,
      downloadUrl: '',
      hfUrl: '',
      progress: 0,
      filename,
      fullPath: localFilePath,
      isLocal: true, // Kept for backward compatibility
      origin: ModelOrigin.LOCAL,
      addedAt: Date.now(),
      defaultChatTemplate: {...defaultSettings.chatTemplate},
      chatTemplate: {...defaultSettings.chatTemplate},
      defaultStopWords: [...(defaultSettings?.completionParams?.stop || [])],
      stopWords: [...(defaultSettings?.completionParams?.stop || [])],
      defaultCompletionSettings: defaultSettings.completionParams,
      completionSettings: {...defaultSettings.completionParams},
      // 视觉相关：投影模型直接标 PROJECTION，多模态 LLM 先按名字标上
      modelType: projByName ? ModelType.PROJECTION : undefined,
      supportsMultimodal: visionByName,
      capabilities: visionByName ? ['vision'] : undefined,
    };

    runInAction(() => {
      this.models.push(model);
      this.refreshDownloadStatuses();
    });

    // Get the MobX observable version — the plain `model` object was wrapped
    // in a proxy when pushed into the observable array. We must pass the proxy
    // so that mutations inside fetchAndPersistGGUFMetadata trigger reactivity.
    const observableModel = this.models.find(m => m.id === model.id);
    if (observableModel) {
      await this.fetchAndPersistGGUFMetadata(observableModel);
    }
  };

  /**
   * 「直接引用」方式导入本地模型：文件本体留在用户原来的位置，
   * App 内**不占任何空间**（不 copyFile）。
   *
   * @param contentUri SAF 返回的 content:// URI（已申请持久化读权限）
   * @param name       显示用文件名
   * @param size       字节数（picker 拿不到时传 0，会用原生再查一次）
   */
  addLocalModelByUri = async (
    contentUri: string,
    name: string,
    size: number = 0,
  ) => {
    // 加载路径优先级：
    //   1. 底层真实路径（已授予「所有文件访问」时，U 盘/外部存储零拷贝且跨重启稳定）
    //   2. /proc/self/fd/N（当次进程可用，重启后由 refreshProcFdPath 重开）
    const realPath = await resolveRealPathIfAccessible(contentUri);
    const loadPath = realPath ?? (await resolveLoadPath(contentUri));
    const filename = name || contentUri.split('/').pop() || 'model.gguf';

    let fileSize = size;
    if (fileSize <= 0) {
      try {
        fileSize = await RNFS.stat(loadPath).then(s => Number(s.size) || 0);
      } catch (e) {
        // /proc/self/fd 的 RNFS.stat 在部分 ROM 上不支持，忽略：大小只用于展示
        console.warn('[ModelStore] 无法读取引用模型大小:', e);
      }
    }

    const defaultSettings = getLocalModelDefaultSettings();
    const model: Model = {
      id: uuidv4(),
      author: '',
      name: filename,
      size: fileSize,
      params: 0,
      isDownloaded: true,
      downloadUrl: '',
      hfUrl: '',
      progress: 0,
      filename,
      fullPath: loadPath,
      contentUri,
      isLocal: true,
      origin: ModelOrigin.LOCAL,
      addedAt: Date.now(),
      defaultChatTemplate: {...defaultSettings.chatTemplate},
      chatTemplate: {...defaultSettings.chatTemplate},
      defaultStopWords: [...(defaultSettings?.completionParams?.stop || [])],
      stopWords: [...(defaultSettings?.completionParams?.stop || [])],
      defaultCompletionSettings: defaultSettings.completionParams,
      completionSettings: {...defaultSettings.completionParams},
    };

    runInAction(() => {
      this.models.push(model);
      this.refreshDownloadStatuses();
    });

    const observableModel = this.models.find(m => m.id === model.id);
    if (observableModel) {
      await this.fetchAndPersistGGUFMetadata(observableModel);
    }
  };

  /**
   * 用**真实文件路径**往库里加一个本地模型（不走 content:// 引用）。
   *
   * 和 `addLocalModelByUri` 的区别：fullPath 是内部存储的真实路径，
   * 不设 contentUri、不需要 fd。mmproj 必须走这条路 ——
   * llama.cpp 的 mtmd 和 RNFS 都打不开 `/proc/self/fd/N`。
   */
  addLocalModelByPath = async (
    localPath: string,
    name: string,
    size: number = 0,
  ): Promise<string> => {
    const filename = name || localPath.split('/').pop() || 'model.gguf';

    let fileSize = size;
    if (fileSize <= 0) {
      fileSize = await RNFS.stat(localPath)
        .then(s => Number(s.size) || 0)
        .catch(() => 0);
    }

    const defaultSettings = getLocalModelDefaultSettings();
    const model: Model = {
      id: uuidv4(),
      author: '',
      name: filename,
      size: fileSize,
      params: 0,
      isDownloaded: true,
      downloadUrl: '',
      hfUrl: '',
      progress: 0,
      filename,
      fullPath: localPath,
      isLocal: true,
      origin: ModelOrigin.LOCAL,
      addedAt: Date.now(),
      defaultChatTemplate: {...defaultSettings.chatTemplate},
      chatTemplate: {...defaultSettings.chatTemplate},
      defaultStopWords: [...(defaultSettings?.completionParams?.stop || [])],
      stopWords: [...(defaultSettings?.completionParams?.stop || [])],
      defaultCompletionSettings: defaultSettings.completionParams,
      completionSettings: {...defaultSettings.completionParams},
    };

    runInAction(() => {
      this.models.push(model);
      this.refreshDownloadStatuses();
    });

    const observableModel = this.models.find(m => m.id === model.id);
    if (observableModel) {
      await this.fetchAndPersistGGUFMetadata(observableModel);
    }
    return model.id;
  };

  /**
   * 「直接引用」的模型，其加载路径是 `/proc/self/fd/<fd>`，进程重启后 fd 全部
   * 失效。加载前必须用持久化的 contentUri 重新开一次 fd，否则会报「文件不存在」。
   * 返回是否发生了重解析（true = 重开过）。
   */
  /**
   * 「直接引用」的模型加载失败时，把文件复制进 App 目录再重试。
   *
   * 为什么需要这条路：
   *   llama.cpp 拿到 `/proc/self/fd/<fd>` 之后是**重新 open 这个路径**的，
   *   不是复用我们手里的 fd。Android 13+ 的 scoped storage 只把读权限授给了
   *   那个 fd（content:// 授权），没有授给底层真实路径 —— 于是：
   *     · 读（copyFile / 流式）没问题
   *     · 重新 open 路径 → EACCES → model == nullptr → "Failed to load model"
   *   Android 12 及以下（旧式存储权限）不会触发，所以同一台机器上
   *   「复制导入」一直正常，只有「直接引用」在这一步炸。
   *
   * 只在**真的加载失败之后**才走这里，不做提前探测：探测口径和 llama.cpp
   * 的 open 不一定一致，误判会把本来能零拷贝的机型也拖去拷几个 G。
   *
   * 复制完成后 contentUri 置空、fullPath 指向真实路径，后续加载和普通本地
   * 模型完全一致（也顺手把 GGUF 头补读回来，内存估算才有 mmap 折扣）。
   */
  private materializeContentUriModel = async (
    model: Model,
  ): Promise<boolean> => {
    const uri = model.contentUri;
    if (!uri) {
      return false;
    }

    const sizeText = model.size > 0 ? formatBytes(model.size, 1) : '数 GB';
    const canRequestAfa = await isAllFilesAccessGranted().then(
      granted => !granted,
    );
    const proceed = await new Promise<boolean>(resolve => {
      const buttons: Array<{
        text: string;
        style?: 'cancel' | 'default' | 'destructive';
        onPress: () => void;
      }> = [];
      // 未授权「所有文件访问」时先给一条零拷贝的正路：授权后真实路径
      // 可直接 mmap，U 盘 4.7G 的模型一个字节都不用复制。
      if (canRequestAfa) {
        buttons.push({
          text: '授予文件权限（推荐）',
          onPress: () => {
            // 跳系统授权页；回来后用户再点一次加载即可走零拷贝路径
            requestAllFilesAccess();
            resolve(false);
          },
        });
      }
      buttons.push(
        {text: '取消', style: 'cancel', onPress: () => resolve(false)},
        {
          text: '复制并加载',
          onPress: () => resolve(true),
        },
      );
      Alert.alert(
        '这个模型需要先复制才能加载',
        '「直接引用」的文件不在 App 目录里，当前系统不允许推理引擎重新打开原路径（Android 13 及以上常见）。\n\n' +
          (canRequestAfa
            ? '推荐先授予「所有文件访问」权限，之后即可直接从原位置（含 U 盘）加载，无需复制。\n\n'
            : '') +
          `把文件复制到 App 目录后也可正常加载，会额外占用约 ${sizeText}。`,
        buttons,
        {cancelable: false},
      );
    });
    if (!proceed) {
      return false;
    }

    try {
      const dir = `${RNFS.DocumentDirectoryPath}/models/local`;
      if (!(await RNFS.exists(dir))) {
        await RNFS.mkdir(dir);
      }
      const dest = `${dir}/${model.filename || model.name}`;

      // 同名副本已存在且大小一致 → 直接复用，别重复拷几个 G
      if (await RNFS.exists(dest)) {
        const existing = await RNFS.stat(dest).catch(() => null);
        const sameSize =
          existing && Number(existing.size) === Number(model.size);
        if (sameSize) {
          runInAction(() => {
            model.fullPath = dest;
            model.contentUri = undefined;
            model.isDownloaded = true;
          });
          return true;
        }
        await RNFS.unlink(dest);
      }

      console.log('[ModelStore] 复制引用模型到 App 目录:', {
        from: uri,
        to: dest,
      });
      await RNFS.copyFile(uri, dest);

      runInAction(() => {
        model.fullPath = dest;
        model.contentUri = undefined;
        model.isDownloaded = true;
      });

      // 复制后路径可读，补一次 GGUF 头（内存估算才能吃到 mmap 折扣）
      this.fetchAndPersistGGUFMetadata(model).catch(() => {});

      return true;
    } catch (e) {
      Alert.alert('复制失败', e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  refreshProcFdPath = async (model: Model): Promise<boolean> => {
    if (!model.contentUri || !isProcFdPath(model.fullPath)) {
      return false;
    }
    // 首选：已授予「所有文件访问」→ 升级成底层真实路径（如
    // /storage/3937-3132/x.gguf，含 U 盘）。真实路径跨重启稳定，llama.cpp
    // 直接 open+mmap，绕开 /proc/self/fd 二次 open 在 Android 13+ 的 EACCES。
    // 升级成功后 fullPath 不再是 fd 路径，下次加载直接走普通本地模型分支。
    const real = await resolveRealPathIfAccessible(model.contentUri);
    if (real) {
      console.log('[ModelStore] content URI 升级为真实路径:', real);
      runInAction(() => {
        model.fullPath = real;
      });
      return true;
    }
    try {
      const fresh = await resolveLoadPath(model.contentUri);
      if (fresh !== model.fullPath) {
        runInAction(() => {
          model.fullPath = fresh;
        });
      }
      return true;
    } catch (e) {
      console.warn('[ModelStore] 重新解析 content URI 失败:', e);
      return false;
    }
  };

  /**
   * 把 fd 路径的 mmproj 转成 App 内部的真实文件路径。
   *
   * 非 fd 路径直接原样返回（已下载到内部存储的 mmproj 不需要这一趟）。
   * fd 路径会先看缓存里有没有同 id 的副本，有就复用，否则 copy 一份。
   *
   * 为什么必须拷：llama.cpp 的 mtmd 会**重新 open** mmproj 文件，
   * 而 /proc/self/fd/N 这种 procfs 路径是打不开的（见上面注释里的实测日志）。
   */
  private ensureLocalMmprojPath = async (
    path: string,
    projectionModel?: Model,
  ): Promise<string> => {
    if (!isProcFdPath(path)) {
      return path;
    }
    const contentUri = projectionModel?.contentUri;
    if (!contentUri) {
      return path;
    }

    const key = projectionModel?.id ?? 'shared';
    const cachePath = `${RNFS.CachesDirectoryPath}/mmproj-${key}.gguf`;

    // 已有缓存且非空 → 直接复用，不重复拷几百 MB
    const cachedSize = await RNFS.stat(cachePath)
      .then(r => r.size)
      .catch(() => 0);
    if (cachedSize > 0) {
      return cachePath;
    }

    // ⚠️ 不能用 RNFS.copyFile(fdPath, dest)。
    //
    // 2026-10-18 实测（某机型）：
    //   ENOENT: /proc/self/fd/134: open failed: ENXIO
    //   (No such device or address)
    // RNFS 的 Java 层打不开 /proc/self/fd/N —— 那个 fd 来自
    // contentResolver.openFileDescriptor，某些 provider 给的并非普通
    // 文件（或是带 close-on-exec 语义），Java File API 拿不到。
    //
    // 但 @react-native-documents/picker 的 keepLocalCopy 是**原生层**
    // 用 contentResolver.openInputStream 直接流式读写的，能正确处理
    // content:// → 本地文件。这正是它存在的意义。
    try {
      const [result] = await keepLocalCopy({
        files: [{uri: contentUri, fileName: `mmproj-${key}.gguf`}],
        destination: 'cachesDirectory',
      });
      if (result.status === 'success' && result.localUri) {
        // localUri 形如 file:///data/user/0/.../cache/xxx.gguf，
        // llama.cpp 要的是裸路径
        const local = result.localUri.startsWith('file://')
          ? result.localUri.slice('file://'.length)
          : result.localUri;
        await RNFS.stat(local).catch(() => null);
        return local;
      }
      console.warn(
        '[ModelStore] keepLocalCopy 失败:',
        result.status === 'error' ? result.copyError : 'unknown',
      );
    } catch (e) {
      console.warn('[ModelStore] 拷贝 mmproj 到内部存储失败:', e);
    }
    // 拷不动就退回原路径，让 llama.cpp 自己报错（错误信息不丢）
    return path;
  };

  /**
   * 给**已经加载好的** context 补上视觉能力，不重新加载主模型。
   *
   * 为什么需要它：用户绑好 mmproj 后，旧做法是 `selectModel(activeModel)`
   * 整模型重载 —— 低端机上主模型加载就要 6 秒以上，用户等不及，
   * 观感就是「点了按钮，过了好久才反应过来」。
   *
   * 这里直接对现有 `this.context` 调 `initMultimodal`，只加载 mmproj，
   * 省掉主模型那一趟。成功后同步 `isMultimodalActive`，
   * UI 的 `visionActive` 立刻翻转。
   */
  retryMultimodalOnActiveContext = async (): Promise<boolean> => {
    const model = this.activeModel;
    const ctx = this.context;
    if (!model || !ctx) {
      return false;
    }
    const projId = model.defaultProjectionModel;
    if (!projId) {
      return false;
    }
    const proj = this.models.find(m => m.id === projId);
    if (!proj?.isDownloaded) {
      return false;
    }
    if (!this.getModelVisionPreference(model)) {
      return false;
    }

    try {
      const rawPath = await this.getModelFullPath(proj);
      // fd 路径的 mmproj 拷进内部存储（mtmd 打不开 /proc/self/fd/N）
      const usablePath = await this.ensureLocalMmprojPath(rawPath, proj);
      const ok = await ctx.initMultimodal({
        path: usablePath,
        // 同上面整模型加载：视觉投影强制 CPU，避免 GPU 投影导致的
        // 多模态前向挂死（图像识别一直转圈）。
        use_gpu: false,
        image_max_tokens: Math.min(
          this.contextInitParams.image_max_tokens ?? 512,
          this.contextInitParams.n_ctx,
        ),
      });
      if (ok) {
        runInAction(() => {
          this.isMultimodalActive = true;
          this.activeProjectionModelId = proj.id;
        });
        // 顺手把 supportsMultimodal 补上，避免卡片上还显示「文本」
        runInAction(() => {
          if (!model.supportsMultimodal) {
            model.supportsMultimodal = true;
          }
        });
      }
      return ok;
    } catch (e) {
      console.warn('[ModelStore] retryMultimodalOnActiveContext 失败:', e);
      return false;
    }
  };

  updateModelChatTemplate = (
    modelId: string,
    newConfig: ChatTemplateConfig,
  ) => {
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      runInAction(() => {
        model.chatTemplate = newConfig;
      });
    }
  };

  updateModelStopWords = (
    modelId: string,
    newStopWords: CompletionParams['stop'],
  ) => {
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      runInAction(() => {
        model.stopWords = newStopWords;
      });
    }
  };

  /**
   * 改这个模型的「默认会话参数」（采样参数那一组）。
   *
   * 写入 `defaultCompletionSettings` —— 用该模型**新建**会话时会读这里；
   * 已经存在的会话保留各自的参数（不追溯改写，和参考 App 的行为一致）。
   * `completionSettings`（当前生效值）不动，避免影响正在跑的会话。
   */
  updateModelDefaultCompletionSettings = (
    modelId: string,
    patch: Partial<CompletionParams>,
  ) => {
    const model = this.models.find(m => m.id === modelId);
    if (!model) {
      return;
    }
    runInAction(() => {
      model.defaultCompletionSettings = {
        ...model.defaultCompletionSettings,
        ...patch,
      };
      model.defaultStopWords = [
        ...(model.defaultCompletionSettings.stop ??
          model.defaultStopWords ??
          []),
      ];
    });
  };

  updateModelName = (modelId: string, newName: string) => {
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      runInAction(() => {
        model.name = newName;
      });
    }
  };

  resetModels = async () => {
    const localModels = this.models.filter(
      model => model.isLocal || model.origin === ModelOrigin.LOCAL,
    );
    localModels.forEach(model => {
      const defaultSettings = getLocalModelDefaultSettings();
      // We change the default settings as well, in case the app introduces new settings.
      model.defaultChatTemplate = {...defaultSettings.chatTemplate};
      model.defaultStopWords = [
        ...(defaultSettings?.completionParams?.stop || []),
      ];
      model.chatTemplate = {...defaultSettings.chatTemplate};
      model.stopWords = [...(defaultSettings?.completionParams?.stop || [])];

      // Clear GGUF metadata to force re-fetch with correct number types
      model.ggufMetadata = undefined;
    });

    const hfModels = this.models.filter(
      model => model.origin === ModelOrigin.HF,
    );
    hfModels.forEach(model => {
      const defaultSettings = getHFDefaultSettings(
        model.hfModel as HuggingFaceModel,
      );
      // We change the default settings as well, in case the app introduces new settings.
      model.defaultChatTemplate = {...defaultSettings.chatTemplate};
      model.defaultStopWords = [
        ...(defaultSettings?.completionParams?.stop || []),
      ];
      model.chatTemplate = {...defaultSettings.chatTemplate};
      model.stopWords = [...(defaultSettings?.completionParams?.stop || [])];

      // Clear GGUF metadata to force re-fetch with correct number types
      model.ggufMetadata = undefined;
    });

    // Re-resolve the device-appropriate presets so reset repopulates the
    // default rule list synchronously, mirroring initializeStore (rather than
    // leaving it empty until the next launch re-migrates).
    const presets = await this.resolvePresets();

    runInAction(() => {
      // Seed with the kept local/HF models so the preset reconcile dedups
      // against them (a downloaded HF model matching a rule preset is not
      // duplicated).
      this.models = [...localModels, ...hfModels];
      this.version = 0;
      this.mergeModelLists(presets);

      // mergeModelLists appends defaultStopWords onto existing stopWords to
      // preserve user customizations; on the just-reset kept models that
      // duplicates the seeded defaults. Dedup the affected models (distinct
      // entries are preserved).
      [...localModels, ...hfModels].forEach(model => {
        model.stopWords = [...new Set(model.stopWords)];
      });
    });

    // Re-fetch GGUF metadata with correct number types
    this.loadMissingGGUFMetadata();
  };

  resetModelChatTemplate = (modelId: string) => {
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      runInAction(() => {
        model.chatTemplate = {...model.defaultChatTemplate};
      });
    }
  };

  resetModelStopWords = (modelId: string) => {
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      runInAction(() => {
        model.stopWords = [...(model.defaultStopWords || [])];
      });
    }
  };

  resetModelName = (modelId: string) => {
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      runInAction(() => {
        model.name = getOriginalModelName(model);
      });
    }
  };

  private async initializeGpuSettings() {
    const gpuCapabilities = await checkGpuSupport();

    // If GPU is not supported but currently enabled, disable it
    if (
      !gpuCapabilities.isSupported &&
      this.contextInitParams.no_gpu_devices === false
    ) {
      runInAction(() => {
        this.contextInitParams = {
          ...this.contextInitParams,
          no_gpu_devices: true,
          n_gpu_layers: 0,
        };
      });
    }
    // If GPU is supported, the persisted value will be used
  }

  setNoGpuDevices = (no_gpu_devices: boolean) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        no_gpu_devices,
      };
    });
  };

  // New v2.0 setters
  setDevices = (devices: string[] | undefined) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        devices,
      };
    });
  };

  setFlashAttnType = (flash_attn_type: 'auto' | 'on' | 'off') => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        flash_attn_type,
        // Reset cache types to F16 if flash attention is disabled
        ...(flash_attn_type !== 'off'
          ? {}
          : {
              cache_type_k: CacheType.F16,
              cache_type_v: CacheType.F16,
            }),
      };
    });
  };

  setKvUnified = (kv_unified: boolean) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        kv_unified,
      };
    });
  };

  setNParallel = (n_parallel: number) => {
    runInAction(() => {
      this.contextInitParams = {
        ...this.contextInitParams,
        n_parallel,
      };
    });
  };

  updateUseAutoRelease = (useAutoRelease: boolean) => {
    runInAction(() => {
      this.useAutoRelease = useAutoRelease;
    });
  };

  /**
   * Updates stop tokens for a model based on its context and chat template
   * @param ctx - The LlamaContext instance
   * @param model - App model to update stop tokens for
   */
  private async updateModelStopTokens(ctx: LlamaContext, model: Model) {
    const storeModel = this.models.find(m => m.id === model.id);
    if (!storeModel) {
      return;
    }

    const stopTokens: string[] = [];

    try {
      // Get EOS token from model metadata
      const eos_token_id = Number(
        (ctx.model as any)?.metadata?.['tokenizer.ggml.eos_token_id'],
      );

      if (!isNaN(eos_token_id)) {
        const detokenized = await ctx.detokenize([eos_token_id]);
        if (detokenized) {
          stopTokens.push(detokenized);
        }
      }

      // Add relevant stop tokens from chat templates
      // First check model's custom chat template.
      const template = storeModel.chatTemplate?.chatTemplate;
      console.log('template: ', template);
      if (template) {
        const templateStops = stops.filter(stop => template.includes(stop));
        stopTokens.push(...templateStops);
      }

      // Then check context's chat template
      const ctxtTemplate = (ctx.model as any)?.metadata?.[
        'tokenizer.chat_template'
      ];
      if (ctxtTemplate) {
        const contextStops = stops.filter(stop => ctxtTemplate.includes(stop));
        stopTokens.push(...contextStops);
      }

      console.log('stopTokens: ', stopTokens);
      // Only update if we found stop tokens
      if (stopTokens.length > 0) {
        runInAction(() => {
          // Helper function to check and update stop tokens
          const updateStopTokens = (words: CompletionParams['stop']) => {
            const uniqueStops = Array.from(
              new Set([...(words || []), ...stopTokens]),
            ).filter(Boolean); // Remove any null/undefined/empty values
            return uniqueStops;
          };

          // Update both default and current completion settings
          storeModel.defaultStopWords = updateStopTokens(
            storeModel.defaultStopWords,
          );
          storeModel.stopWords = updateStopTokens(storeModel.stopWords);
        });
      }
    } catch (error) {
      console.error('Error updating model stop tokens:', error);
      // Continue execution - stop token update is not critical
    }
  }

  /**
   * Update model thinking capabilities based on the loaded context
   */
  private async updateModelThinkingCapabilities(
    ctx: LlamaContext,
    model: Model,
  ) {
    try {
      const storeModel = this.models.find(m => m.id === model.id);
      if (!storeModel) {
        return;
      }

      // Detection is the 'detected' writer; it must not override a user
      // declaration or a learned flip (precedence: user > learned > detected).
      if (
        storeModel.reasoning?.source === 'user' ||
        storeModel.reasoning?.source === 'learned'
      ) {
        return;
      }

      const result = await detectThinkingCapability(ctx);

      runInAction(() => {
        // Keep the deprecated boolean + tags in sync for back-compat readers.
        storeModel.supportsThinking = result.supported;
        if (result.thinkingStartTag) {
          storeModel.thinkingStartTag = result.thinkingStartTag;
        }
        if (result.thinkingEndTag) {
          storeModel.thinkingEndTag = result.thinkingEndTag;
        }
        storeModel.reasoning = {
          isReasoning: result.supported ? 'yes' : 'no',
          source: 'detected',
          supportsEffort: false,
          effortValues: [],
          effortSource: 'none',
        };
      });
    } catch (error) {
      console.error('Error updating model thinking capabilities:', error);
      // Continue execution - thinking capability detection is not critical
    }
  }

  /**
   * Learn-from-stream entry point. The first time a model actually emits
   * reasoning, flip axis-1 to learned 'yes'. Routes remote ids to ServerStore
   * (one direction). Idempotent and monotonic; never overrides a user
   * declaration (handled by the per-store writers).
   */
  recordReasoningObserved = (modelId: string): void => {
    const localModel = this.models.find(m => m.id === modelId);
    if (!localModel) {
      // Not a persisted local model → remote; delegate to ServerStore.
      serverStore.recordRemoteReasoningObserved(modelId);
      return;
    }
    const existing = localModel.reasoning;
    if (existing?.source === 'user' || existing?.isReasoning === 'yes') {
      return;
    }
    runInAction(() => {
      localModel.reasoning = {
        isReasoning: 'yes',
        source: 'learned',
        supportsEffort: existing?.supportsEffort ?? false,
        effortValues: existing?.effortValues ?? [],
        effortSource: existing?.effortSource ?? 'none',
      };
      localModel.supportsThinking = true;
    });
  };

  /**
   * Manual model-card override. Top of precedence; routes remote ids to
   * ServerStore, local to the persisted Model.
   */
  setReasoningOverride = (modelId: string, cap: ReasoningCapability): void => {
    const localModel = this.models.find(m => m.id === modelId);
    if (!localModel) {
      serverStore.setRemoteReasoningOverride(modelId, cap);
      return;
    }
    runInAction(() => {
      localModel.reasoning = cap;
      localModel.supportsThinking = cap.isReasoning === 'yes';
    });
  };

  /**
   * Returns available (i.e. downloaded models) models with projection models filtered out,
   * plus remote models from configured servers.
   */
  get availableModels(): Model[] {
    const localAvailable = filterProjectionModels(
      this.models.filter(
        model =>
          // Include models that are either local or downloaded
          model.isLocal ||
          model.origin === ModelOrigin.LOCAL ||
          model.isDownloaded,
      ),
    );
    return [...localAvailable, ...this.remoteModels];
  }

  setInferencing(value: boolean) {
    this.inferencing = value;
  }

  setIsStreaming(value: boolean) {
    this.isStreaming = value;
  }

  /**
   * Register an active completion promise for safe context release.
   * This should be called when starting a completion operation.
   * @param promise The completion promise to track
   */
  registerCompletionPromise(promise: Promise<any>) {
    this.activeCompletionPromise = promise;
  }

  /**
   * Clear the active completion promise.
   * This should be called when the completion finishes (success or error).
   */
  clearCompletionPromise() {
    this.activeCompletionPromise = null;
  }

  /**
   * Get compatible projection models for a given LLM
   * @param modelId The ID of the LLM model
   * @returns Array of compatible projection models
   */
  getCompatibleProjectionModels = (modelId: string): Model[] => {
    const model = this.models.find(m => m.id === modelId);
    if (!model || !model.supportsMultimodal) {
      return [];
    }

    // If the model has explicitly defined compatible projection models, use those
    if (
      model.compatibleProjectionModels &&
      model.compatibleProjectionModels.length > 0
    ) {
      return this.models.filter(
        m =>
          m.modelType === ModelType.PROJECTION &&
          model.compatibleProjectionModels?.includes(m.id),
      );
    }

    // Otherwise, try to find projection models from the same repository
    const modelIdParts = model.id.split('/');
    if (modelIdParts.length >= 2) {
      const author = modelIdParts[0];
      const repo = modelIdParts[1];

      return this.models.filter(
        m =>
          m.modelType === ModelType.PROJECTION &&
          m.id.startsWith(`${author}/${repo}/`),
      );
    }

    return [];
  };

  /**
   * Set default projection model for an LLM
   * @param modelId The ID of the LLM model
   * @param projectionModelId The ID of the projection model to set as default
   */
  setDefaultProjectionModel = (modelId: string, projectionModelId: string) => {
    const model = this.models.find(m => m.id === modelId);
    if (model && model.supportsMultimodal) {
      runInAction(() => {
        model.defaultProjectionModel = projectionModelId;
      });
    }
  };

  /**
   * 检测一个模型的视觉能力，供「绑定视觉模型」用。
   *
   * 回答两件事：
   *   1. 这个模型自己是不是已经能看图（已有多模态标记 / 已绑投影器）
   *   2. 如果不能，库里现有的投影模型里有哪些**真的能**接上去
   *
   * 「真的能」是实打实读 GGUF 元数据判出来的（clip.projector_type ×
   * general.architecture），不是按文件名猜 —— 猜错的话用户绑完、
   * 一加载就报错，比不给这个入口还糟。
   */
  probeVisionCapability = async (
    model: Model,
  ): Promise<{
    alreadyVision: boolean;
    /** 库里可绑的投影模型（已下载的排前面） */
    candidates: {model: Model; downloaded: boolean}[];
    /** 主模型自己的 GGUF 探测结果（诊断用） */
    mainProbe?: GgufVisionProbe;
    /** 没能完成检测的原因 */
    error?: string;
  }> => {
    const alreadyVision = !!model.supportsMultimodal;

    // 主模型路径
    let mainProbe: GgufVisionProbe | undefined;
    try {
      const mainPath = await this.getModelFullPath(model);
      if (mainPath) {
        mainProbe = await probeLocalGgufVision(mainPath);
      }
    } catch {
      // 探测失败不致命：下面还有文件名兜底
    }

    // ⚠️ 探测失败时退回「已持久化的 architecture」。
    // 之前只有 probeLocalGgufVision 成功才有 mainArch，一旦它读不到
    // （content:// 没开 fd、文件被移走等），isProjectorCompatible 就只能
    // 靠文件名兜底 —— 而 mmproj 的文件名里没有任何模型族关键词，必然判成
    // 「不兼容」，用户看到的就是「明明在别的 App 能绑，这里说无法绑定」。
    const mainArch =
      mainProbe?.architecture ??
      (model.ggufMetadata?.architecture
        ? model.ggufMetadata.architecture.toLowerCase()
        : undefined);

    // 候选池：不止「已标记为 PROJECTION」的模型。
    //
    // 2026-10-19 用户反馈「明明在别的 App 能绑，这里说不是视觉模型」：
    // 老的 content:// 零拷贝导入读不到 GGUF 头，modelType 就不会被置成
    // PROJECTION —— 哪怕它真是 mmproj，也永远进不了这个候选池。
    // 所以补两条弱信号：文件名带 mmproj、或已持久化的架构是投影类。
    const allProjections = this.models.filter(m => {
      if (m.modelType === ModelType.PROJECTION) {
        return true;
      }
      // 已经作为某个主模型的投影在用的，肯定算
      if (m.defaultProjectionModel === undefined && m.supportsMultimodal) {
        // 可能是视觉主模型，不算投影；继续往下判断弱信号
      }
      const name = `${m.filename ?? ''} ${m.name ?? ''}`;
      if (/mmproj/i.test(name)) {
        return true;
      }
      const arch = (m.ggufMetadata?.architecture ?? '').toLowerCase();
      return isProjectionArch(arch);
    });

    const candidates: {model: Model; downloaded: boolean}[] = [];
    for (const proj of allProjections) {
      // 已经绑给这个模型的，就不再列为「可绑」
      if (model.defaultProjectionModel === proj.id) {
        continue;
      }
      let projType: string | undefined;
      try {
        const p = await this.getModelFullPath(proj);
        if (p) {
          const res = await probeLocalGgufVision(p);
          projType = res.projectorType;
        }
      } catch {
        // 读不到就靠文件名兜底
      }
      // 兜底：探测拿不到 projector_type 时，用已持久化的架构
      // （content:// 零拷贝导入的模型只能靠这个）
      if (!projType) {
        projType = proj.ggufMetadata?.architecture?.toLowerCase();
      }

      const compatible = isProjectorCompatible(
        mainArch,
        projType,
        model.filename ?? model.name ?? '',
        proj.filename ?? proj.name ?? '',
      );
      if (compatible) {
        candidates.push({model: proj, downloaded: !!proj.isDownloaded});
      }
    }

    // 已下载的排前面
    candidates.sort((a, b) => Number(b.downloaded) - Number(a.downloaded));

    return {
      alreadyVision,
      candidates,
      mainProbe,
      error: mainProbe?.error,
    };
  };

  /**
   * 把一个投影模型绑给主模型，并把它标记为具备视觉能力。
   *
   * 这一步会真的写 supportsMultimodal = true —— 之前这个字段只在
   * 「HF 下载时按仓库规格判定」或「GGUF 头读到 clip 架构」时才会被置位，
   * 本地导入的文本模型永远没有机会。绑定之后加载路径
   * （resolveMultimodalInit）就能拿到 mmproj 路径了。
   */
  attachProjectionModel = (modelId: string, projectionModelId: string) => {
    const model = this.models.find(m => m.id === modelId);
    const proj = this.models.find(m => m.id === projectionModelId);
    if (!model || !proj || proj.modelType !== ModelType.PROJECTION) {
      return false;
    }
    runInAction(() => {
      model.supportsMultimodal = true;
      model.modelType = model.modelType ?? ModelType.VISION;
      model.defaultProjectionModel = projectionModelId;
      const list = model.compatibleProjectionModels ?? [];
      if (!list.includes(projectionModelId)) {
        model.compatibleProjectionModels = [...list, projectionModelId];
      }
      const caps = model.capabilities ?? [];
      if (!caps.includes('vision')) {
        model.capabilities = [...caps, 'vision'];
      }
      // 视觉默认开着，用户绑完就能直接用
      if (model.visionEnabled === undefined) {
        model.visionEnabled = true;
      }
    });

    // 若这正是当前激活的模型，**异步重载**让它拿到 mmproj。
    //
    // `isMultimodalActive` 是加载时由 `initMultimodal` 成功才置位的，
    // 光绑定不改加载状态，聊天页的 `visionActive` 依然是 false ——
    // 用户看到的就是「我明明绑好了，App 还说没有视觉模型」。
    // 放在 store 里而不是某个调用点，保证所有绑定入口行为一致。
    if (this.activeModelId === model.id && model.isDownloaded) {
      this.selectModel(model).catch(e => {
        console.warn('[ModelStore] 绑定 mmproj 后重载失败:', e);
      });
    }
    return true;
  };

  /**
   * 「导入 MMProj 文件」完整流程：选文件 → 校验 → 零拷贝导入 → 绑定到主模型。
   *
   * 为什么要连成一步：用户从文件管理器拿来的 mmproj 必须**当场**判定
   * 是不是投影模型（GGUF 头里的 architecture 是否 clip/siglip/vit）。
   * 不是的话当场撤掉这次导入并明确报错——不能让它以「普通模型」的
   * 身份混进模型列表，用户后面会一头雾水。
   *
   * 导入用 content:// 直接引用（不复制、不占 App 存储），和模型页
   * 的导入方式一致。
   */
  importAndAttachProjectionModel = async (
    mainModelId: string,
  ): Promise<
    | {ok: true; projectionName: string}
    | {
        ok: false;
        reason: 'cancelled' | 'noPermission' | 'notProjection' | 'failed';
      }
  > => {
    let file;
    try {
      file = await pickGgufFile();
    } catch {
      return {ok: false, reason: 'cancelled'};
    }
    if (!file) {
      return {ok: false, reason: 'cancelled'};
    }
    if (!(await probeUri(file.uri))) {
      return {ok: false, reason: 'noPermission'};
    }

    // ⚠️ mmproj **必须落成真实文件**，不能用 content:// 零拷贝。
    //
    // 2026-10-18/19 实测：从文件管理器选的 mmproj，`resolveLoadPath` 给出的是
    // `/proc/self/fd/N`，而这个路径：
    //   · RNFS（Java File API）打不开 → ENOENT / ENXIO
    //   · llama.cpp 的 mtmd 也打不开 → Failed to initialize multimodal context
    // 结果是「校验：不是投影模型」「加载：视觉初始化失败」两头都挂。
    //
    // 用 keepLocalCopy 在原生层流式复制到 cachesDirectory，拿到真实路径后再
    // 探测 GGUF 头、再入库。代价是多占一份 mmproj 的空间，但这是唯一能用的路。
    let localPath: string | undefined;
    try {
      const [copy] = await keepLocalCopy({
        files: [{uri: file.uri, fileName: `mmproj-${Date.now()}.gguf`}],
        destination: 'cachesDirectory',
      });
      if (copy.status === 'success' && copy.localUri) {
        localPath = copy.localUri.startsWith('file://')
          ? copy.localUri.slice('file://'.length)
          : copy.localUri;
      }
    } catch (e) {
      console.warn('[ModelStore] mmproj 复制到本地失败:', e);
    }
    if (!localPath) {
      return {ok: false, reason: 'failed'};
    }

    // 先探真实文件，确认它确实是投影模型，再入库 —— 避免列表里留垃圾
    const probe = await probeLocalGgufVision(localPath).catch(() => undefined);
    const arch = (probe?.architecture ?? '').toLowerCase();
    const looksProjection =
      !!probe?.projectorType ||
      isProjectionArch(arch) ||
      // 最后兜底：文件名带 mmproj。用户是从"导入 MMProj 文件"入口手动选的，
      // 文件名是很强的信号；有些新出的 mmproj（如 qwen3vl_merger）既不在
      // 架构表里、projector_type 也可能缺失，但确实能绑。宁可让用户绑成功
      // （加载失败会给出明确错误），也不要在这里拦死。
      /mmproj/i.test(file.name ?? '');

    if (!looksProjection) {
      // 不是投影模型：删掉刚拷出来的文件，不留垃圾
      await RNFS.unlink(localPath).catch(() => {});
      return {ok: false, reason: 'notProjection'};
    }

    let projId: string;
    try {
      projId = await this.addLocalModelByPath(localPath, file.name, file.size);
    } catch {
      await RNFS.unlink(localPath).catch(() => {});
      return {ok: false, reason: 'failed'};
    }

    const proj = this.models.find(m => m.id === projId);
    if (!proj) {
      await RNFS.unlink(localPath).catch(() => {});
      return {ok: false, reason: 'failed'};
    }

    // 探测通过但元数据判定没跟上 → 补标记
    if (proj.modelType !== ModelType.PROJECTION) {
      runInAction(() => {
        proj.modelType = ModelType.PROJECTION;
        proj.supportsMultimodal = true;
      });
    }

    if (!this.attachProjectionModel(mainModelId, proj.id)) {
      this.removeModelFromList(proj);
      await RNFS.unlink(localPath).catch(() => {});
      return {ok: false, reason: 'failed'};
    }
    return {ok: true, projectionName: proj.name || file.name};
  };

  /** 解除主模型与投影模型的绑定，并取消视觉标记 */
  detachProjectionModel = (modelId: string) => {
    const model = this.models.find(m => m.id === modelId);
    if (!model) {
      return false;
    }
    runInAction(() => {
      model.supportsMultimodal = false;
      model.defaultProjectionModel = undefined;
      model.compatibleProjectionModels = undefined;
      model.visionEnabled = undefined;
      model.capabilities = model.capabilities?.filter(c => c !== 'vision');
    });
    return true;
  };

  /**
   * Get the default projection model for an LLM
   * @param modelId The ID of the LLM model
   * @returns The default projection model, or undefined if none is set
   */
  getDefaultProjectionModel = (modelId: string): Model | undefined => {
    const model = this.models.find(m => m.id === modelId);
    if (!model || !model.supportsMultimodal || !model.defaultProjectionModel) {
      return undefined;
    }

    return this.models.find(m => m.id === model.defaultProjectionModel);
  };

  /**
   * Get all LLM models that use a specific projection model as their default
   * @param projectionModelId The ID of the projection model
   * @returns Array of LLM models that use this projection model as default
   */
  getLLMsUsingProjectionModel = (projectionModelId: string): Model[] => {
    return this.models.filter(
      m =>
        m.supportsMultimodal &&
        m.defaultProjectionModel === projectionModelId &&
        m.modelType !== ModelType.PROJECTION,
    );
  };

  /**
   * Get all downloaded LLM models that use a specific projection model as their default
   * @param projectionModelId The ID of the projection model
   * @returns Array of downloaded LLM models that use this projection model as default
   */
  getDownloadedLLMsUsingProjectionModel = (
    projectionModelId: string,
  ): Model[] => {
    return this.getLLMsUsingProjectionModel(projectionModelId).filter(
      m => m.isDownloaded,
    );
  };

  /**
   * Check if a vision model has its required projection model downloaded
   * @param model The vision model to check
   * @returns true if the model doesn't need a projection model or if it has one downloaded
   */
  hasRequiredProjectionModel = (model: Model): boolean => {
    const status = this.getProjectionModelStatus(model);
    return status.isAvailable;
  };

  /**
   * Get detailed status of a vision model's projection model
   * @param model The vision model to check
   * @returns Object with availability status and detailed state information
   */
  getProjectionModelStatus = (
    model: Model,
  ): {
    isAvailable: boolean;
    state: 'not_needed' | 'downloaded' | 'downloading' | 'missing';
    projectionModel?: Model;
  } => {
    // Non-multimodal models don't need projection models
    if (!model.supportsMultimodal || !model.defaultProjectionModel) {
      return {
        isAvailable: true,
        state: 'not_needed',
      };
    }

    // Find the projection model
    const projectionModel = this.models.find(
      m => m.id === model.defaultProjectionModel,
    );

    if (!projectionModel) {
      return {
        isAvailable: false,
        state: 'missing',
      };
    }

    // Check if projection model is downloaded
    if (projectionModel.isDownloaded) {
      return {
        isAvailable: true,
        state: 'downloaded',
        projectionModel,
      };
    }

    // Check if projection model is currently downloading
    if (downloadManager.isDownloading(projectionModel.id)) {
      return {
        isAvailable: true, // Consider it available during download
        state: 'downloading',
        projectionModel,
      };
    }

    // Projection model exists but is not downloaded and not downloading
    return {
      isAvailable: false,
      state: 'missing',
      projectionModel,
    };
  };

  /**
   * Check if a projection model can be safely deleted
   * @param projectionModelId The ID of the projection model to check
   * @returns Object with canDelete flag and reason if deletion is blocked
   */
  canDeleteProjectionModel = (
    projectionModelId: string,
  ): {canDelete: boolean; reason?: string; dependentModels?: Model[]} => {
    const projectionModel = this.models.find(m => m.id === projectionModelId);

    if (
      !projectionModel ||
      projectionModel.modelType !== ModelType.PROJECTION
    ) {
      return {
        canDelete: false,
        reason: 'Model not found or not a projection model',
      };
    }

    // Check if it's currently active - but also verify that we actually have a context
    // This prevents false positives when the context has been released but state hasn't updated
    if (this.activeProjectionModelId === projectionModelId) {
      // Double-check: if we don't have an active context, the projection model isn't really active
      if (!this.context) {
        console.log(
          'Projection model marked as active but no context exists, allowing deletion:',
          projectionModelId,
        );
      } else {
        return {
          canDelete: false,
          reason: 'Projection model is currently active',
        };
      }
    }

    // Get dependent models for warning purposes
    const dependentModels =
      this.getDownloadedLLMsUsingProjectionModel(projectionModelId);

    if (dependentModels.length > 0) {
      console.log(
        'Projection model is used by downloaded LLM models:',
        dependentModels.map(m => m.id),
      );

      // Return true to allow manual deletion with warning
      // Automatic cleanup will check dependencies separately
      return {
        canDelete: true,
        reason: 'Projection model is used by downloaded LLM models',
        dependentModels,
      };
    }

    return {canDelete: true, dependentModels};
  };

  /**
   * Automatically cleanup orphaned projection models
   * @param projectionModelId The ID of the projection model to check for cleanup
   */
  cleanupOrphanedProjectionModel = async (projectionModelId: string) => {
    const projectionModel = this.models.find(m => m.id === projectionModelId);

    if (
      !projectionModel ||
      projectionModel.modelType !== ModelType.PROJECTION
    ) {
      return; // Not a projection model, nothing to cleanup
    }

    if (!projectionModel.isDownloaded) {
      return; // Not downloaded, nothing to cleanup
    }

    // For automatic cleanup, check if there are any dependent models
    const dependentModels =
      this.getDownloadedLLMsUsingProjectionModel(projectionModelId);

    if (dependentModels.length > 0) {
      console.log(
        'Skipping auto-cleanup of projection model - still used by downloaded LLMs:',
        dependentModels.map(m => m.id),
      );
      return;
    }

    console.log(
      'Auto-cleaning up orphaned projection model:',
      projectionModelId,
    );
    try {
      await this.deleteModel(projectionModel);
    } catch (error) {
      console.error('Failed to auto-cleanup orphaned projection model:', error);
    }
  };

  /**
   * Automatically cleanup multiple orphaned projection models
   * @param projectionModelIds Array of projection model IDs to check for cleanup
   */
  cleanupOrphanedProjectionModels = async (projectionModelIds: string[]) => {
    console.log('Checking for orphaned projection models:', projectionModelIds);

    // Process each projection model for potential cleanup
    for (const projectionModelId of projectionModelIds) {
      await this.cleanupOrphanedProjectionModel(projectionModelId);
    }
  };

  /**
   * Set vision preference for a model
   * @param modelId The ID of the model
   * @param enabled Whether vision capabilities should be enabled
   */
  setModelVisionEnabled = async (modelId: string, enabled: boolean) => {
    const model = this.models.find(m => m.id === modelId);
    if (!model || !model.supportsMultimodal) {
      return;
    }

    // Store the previous vision state to detect changes
    const previousVisionEnabled = this.getModelVisionPreference(model);

    runInAction(() => {
      model.visionEnabled = enabled;
    });

    // Check if this model is currently active and if vision state actually changed
    const isActiveModel = this.activeModelId === modelId;
    const visionStateChanged = previousVisionEnabled !== enabled;

    if (isActiveModel && visionStateChanged && this.context) {
      console.log(
        `Vision ${
          enabled ? 'enabled' : 'disabled'
        } for active model, reloading context`,
        {
          modelId,
          previousState: previousVisionEnabled,
          newState: enabled,
          isMultimodalActive: this.isMultimodalActive,
        },
      );

      try {
        // Reload the context with the new vision setting
        await this.initContext(model);
      } catch (error) {
        console.error(
          'Failed to reload context after vision state change:',
          error,
        );

        // Revert the vision setting if context reload failed
        runInAction(() => {
          model.visionEnabled = previousVisionEnabled;
        });

        // Re-throw the error so the UI can handle it appropriately
        throw error;
      }
    }
  };

  /**
   * Get vision preference for a model
   * @param model The model to check
   * @returns true if vision should be enabled (defaults to true for backward compatibility)
   */
  getModelVisionPreference = (model: Model): boolean => {
    // For non-multimodal models, always return false
    if (!model.supportsMultimodal) {
      return false;
    }

    // Default to true for backward compatibility if not explicitly set
    return model.visionEnabled !== false;
  };

  /**
   * Starts a completion with one or more images
   * @param params - Completion parameters including image paths
   * @returns Promise<void>
   */
  startImageCompletion = async (params: {
    prompt: string;
    image_path?: string; // For backward compatibility
    image_paths?: string[]; // New parameter for multiple images
    systemMessage?: string;
    onToken?: (token: string) => void;
    onComplete?: (text: string) => void;
    onError?: (error: Error) => void;
  }): Promise<void> => {
    if (!this.context) {
      throw new Error('No model context available');
    }

    // Check if multimodal is enabled
    if (!this.isMultimodalActive) {
      throw new Error('Multimodal is not enabled for this model');
    }

    runInAction(() => {
      this.inferencing = true;
      this.isStreaming = false;
    });

    try {
      // Handle both single image_path and multiple image_paths
      let imagePaths: string[] = [];

      if (params.image_paths && params.image_paths.length > 0) {
        // Use the provided image_paths array
        imagePaths = [...params.image_paths];
      } else if (params.image_path) {
        // Backward compatibility: convert single image_path to array
        imagePaths = [params.image_path];
      }

      if (imagePaths.length === 0) {
        throw new Error('No images provided for multimodal completion');
      }

      // Process all image paths to handle file:// prefix
      const processedImagePaths = imagePaths.map(path =>
        path.startsWith('file://')
          ? Platform.OS === 'ios'
            ? path.substring(7) // iOS: remove 'file://'
            : path // Android: keep as is
          : path,
      );

      // Create a system message if provided
      const systemMessage = params.systemMessage?.trim()
        ? {
            role: 'system',
            content: params.systemMessage,
          }
        : undefined;

      // Create a user message with text and all images
      const userMessage = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: params.prompt,
          },
          // Add all images to the content array
          ...processedImagePaths.map(path => ({
            type: 'image_url',
            image_url: {url: path},
          })),
        ],
      };

      // Start the completion
      runInAction(() => {
        this.isStreaming = true;
      });

      const completionParams =
        await chatSessionRepository.getGlobalCompletionSettings();
      const stopWords = toJS(modelStore.activeModel?.stopWords);

      // Create completion params with app-specific properties
      const messages = systemMessage
        ? [systemMessage, userMessage]
        : [userMessage];
      const completionParamsWithAppProps = {
        ...completionParams,
        messages: messages,
        stop: stopWords,
      } as CompletionParams;

      // Strip app-specific properties before passing to llama.rn
      const cleanCompletionParams = toApiCompletionParams(
        completionParamsWithAppProps,
      );

      // Create the completion promise and register it for safe context release
      const completionPromise = this.context.completion(
        cleanCompletionParams,
        data => {
          if (data.token) {
            params.onToken?.(data.token);
          }
        },
      );

      // Register the promise so releaseContext can wait for it
      this.registerCompletionPromise(completionPromise);

      const result = await completionPromise;

      // Clear the promise after completion finishes
      this.clearCompletionPromise();

      params.onComplete?.(result.text);
    } catch (error) {
      // Clear the promise on error too
      this.clearCompletionPromise();
      console.error('Error in multi-image completion:', error);
      params.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      runInAction(() => {
        this.inferencing = false;
        this.isStreaming = false;
      });
    }
  };

  /**
   * Fetches and updates model file details from HuggingFace.
   * This is used when we need to get the lfs.oid for integrity checks.
   * @param model - The model to update
   * @returns Promise<void>
   */
  async fetchAndUpdateModelFileDetails(model: Model): Promise<void> {
    if (!model.hfModel?.id) {
      return;
    }

    try {
      const fileDetails = await fetchModelFilesDetails(model.hfModel.id);
      const matchingFile = fileDetails.find(
        file => file.path === model.hfModelFile?.rfilename,
      );

      if (matchingFile && matchingFile.lfs) {
        runInAction(() => {
          if (model.hfModelFile) {
            model.hfModelFile.lfs = matchingFile.lfs;
          }
        });
      }
    } catch (error) {
      console.error('Failed to fetch model file details:', error);
    }
  }

  // Expensive operation.
  // It will be calculating hash if hash is not set, unless force is true.
  updateModelHash = async (modelId: string, force: boolean = false) => {
    const model = this.models.find(m => m.id === modelId);

    // We only update hash if the model is downloaded and not currently being downloaded.
    if (model?.isDownloaded && !downloadManager.isDownloading(modelId)) {
      // If not forced, we only update hash if it's not already set.
      if (model.hash && !force) {
        return;
      }
      const filePath = await this.getModelFullPath(model);
      const hash = await getSHA256Hash(filePath);
      runInAction(() => {
        model.hash = hash;
      });
    }
  };

  isModelAvailable = (modelId?: string): boolean => {
    if (!modelId) {
      return false;
    }
    return this.availableModels.some(m => m.id === modelId);
  };

  // /**
  //  * Gets localized strings based on the current language from uiStore
  //  */
  // getL10n() {
  //   const language = uiStore.language;
  //   // Import the l10n object from locales
  //   const {l10n} = require('../locales');
  //   // Return the localized strings for the current language
  //   return l10n[language];
  // }

  clearDownloadError = () => {
    this.downloadError = null;
  };

  clearModelLoadError = () => {
    this.modelLoadError = null;
  };

  retryDownload = () => {
    const modelId = this.downloadError?.metadata?.modelId;
    this.clearDownloadError();

    if (modelId) {
      // Find the model and retry download
      const model = this.models.find(m => m.id === modelId);
      if (model) {
        this.checkSpaceAndDownload(model.id);
      }
    }
  };
}

export const modelStore = new ModelStore();
