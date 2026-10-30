import {AppState, AppStateStatus} from 'react-native';

import {makeAutoObservable, reaction, runInAction} from 'mobx';
import {makePersistable} from 'mobx-persist-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';
import Speech from '@pocketpalai/react-native-speech';
import type {SupertonicLanguage} from '@pocketpalai/react-native-speech';

import {
  getEngine,
  KittenEngine,
  KokoroEngine,
  SupertonicEngine,
  KOKORO_VOICES,
  TTS_MIN_RAM_BYTES,
  TTS_PREVIEW_SAMPLE,
  SUPERTONIC_MODEL_ESTIMATED_BYTES,
  KOKORO_MODEL_ESTIMATED_BYTES,
  KITTEN_MODEL_ESTIMATED_BYTES,
  ttsRuntime,
} from '../services/tts';
import type {StreamingHandle, SupertonicSteps, Voice} from '../services/tts';
import {
  ThinkingStripper,
  pickThinkingPlaceholder,
} from '../services/tts/thinkingStripper';
import {
  LANG_LABEL,
  LANG_TO_BCP47,
  detectTextLang,
  engineSupportsLang,
  isChineseVoice,
  langCodeMatches,
} from '../services/tts/textLang';
import {getSystemVoicesCached} from '../services/tts/engines/system/voices';
import {chineseToIPA, containsHan} from '../services/tts/chineseG2P';
import {chatSessionStore} from './ChatSessionStore';

/** Supertonic 语言选择器里可以选的值（比引擎的 SupertonicLanguage 多一个 zh） */
export type SupertonicLanguageOption = SupertonicLanguage | 'zh';

/**
 * Discriminated union describing what the store is currently doing.
 *
 * - `idle`: nothing playing, no streaming session active.
 * - `streaming`: an assistant message is still being produced; `handle`
 *   receives token deltas via `onAssistantMessageChunk`.
 * - `playing`: a full-text utterance is playing (replay path / fallback).
 */
export type TTSPlaybackState =
  | {mode: 'idle'}
  | {mode: 'streaming'; messageId: string; handle: StreamingHandle}
  | {mode: 'playing'; messageId: string};

/**
 * State machine for a neural-engine model download lifecycle.
 * Derived from the engine's `isInstalled()` on `init()` — never
 * persisted; the source of truth is the file system.
 */
export type NeuralDownloadState =
  | 'not_installed'
  | 'downloading'
  | 'ready'
  | 'error';

/**
 * 把「各种形态」的报错转成一句能给用户看的话。
 * 原生抛过来的可能是一句话，也可能是 {message, code}，甚至是个对象。
 */
const describeSpeechError = (err: unknown): string => {
  if (err == null) {
    return '播放失败（没有拿到具体原因）';
  }
  if (typeof err === 'string') {
    return err;
  }
  const anyErr = err as {message?: string; code?: string};
  if (anyErr.message) {
    return anyErr.code ? `${anyErr.message}（${anyErr.code}）` : anyErr.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
};

/** Alias preserved for external consumers that imported the v1.2 name. */
export type SupertonicDownloadState = NeuralDownloadState;

/** Neural engine ids managed by the store's download state machines. */
export type NeuralEngineId = 'supertonic' | 'kokoro' | 'kitten';

const DEFAULT_SUPERTONIC_STEPS: SupertonicSteps = 5;

/**
 * Default Supertonic synthesis language: `na` ("Auto"), the trained
 * language-agnostic tag in the v3 model. New and existing users start here
 * (existing users have no persisted key, so hydration leaves it at `na`).
 */
const DEFAULT_SUPERTONIC_LANGUAGE: SupertonicLanguage = 'na';

const previewMessageId = (voice: Voice): string =>
  `preview:${voice.engine}:${voice.id}`;

/** 音色的全局唯一键，跨「试听」和「生成语音」共用。 */
const voiceKey = (voice: Voice): string => `${voice.engine}:${voice.id}`;

/**
 * 「正在加载音色」提示的最长展示时间（毫秒），按引擎给经验值。
 *
 * 神经网络引擎首次用一个音色时，原生侧要把音色嵌入（几 MB 的 JSON）
 * 读出来解析成张量再喂给模型 —— 这一步没有进度回调，界面能做的只是
 * 「把等待变得可见」。真正开始出声时会收到原生 `onStart` 事件，届时
 * 立刻收起提示；这里的值只是**兜底**，防止事件没到导致提示一直挂着。
 *
 * 系统引擎不加载任何东西，几乎瞬时，给一个很短的值就够。
 */
const PREPARE_HINT_MS: Record<string, number> = {
  system: 1500,
  kitten: 9000,
  kokoro: 7000,
  supertonic: 6000,
};

const DEFAULT_PREPARE_HINT_MS = 8000;

/**
 * Store that coordinates text-to-speech playback.
 *
 * Availability gate: `isTTSAvailable` is the single boolean every TTS-aware
 * surface reads. It is derived from `deviceMeetsMemory` (set once in `init()`
 * from `DeviceInfo.getTotalMemory()`) and `userTTSOverride` (a persisted user
 * choice). See architecture/tts.md §4a for the formula. The lifecycle hooks
 * registered in `init()` (AppState listener, session reaction, isInstalled
 * checks) run unconditionally so a low-memory user opting in mid-session has
 * a safe runtime — see architecture/tts.md §4e.
 *
 * Streaming: `useChatSession` calls three hooks as an assistant message is
 * produced — `onAssistantMessageStart`, `onAssistantMessageChunk`, and
 * `onAssistantMessageComplete`. The first creates a `StreamingHandle`, the
 * second feeds deltas into it, the third flushes the remaining buffer. If
 * `start` is missed (e.g., voice picked mid-message) `complete` falls back
 * to the full-text `play()` path.
 */
export class TTSStore {
  // Set once in init() from getTotalMemory() >= TTS_MIN_RAM_BYTES; never
  // re-checked. RAM doesn't change at runtime. See architecture/tts.md §1a.
  deviceMeetsMemory: boolean = false;
  // Tristate persisted user choice. null = not set (mirrors deviceMeetsMemory).
  // See architecture/tts.md §4a, D1.
  userTTSOverride: boolean | null = null;
  private initialized: boolean = false;

  /**
   * The TTS availability gate. Single boolean every TTS-aware surface reads.
   * Derived from `userTTSOverride` and `deviceMeetsMemory` per the formula
   * in architecture/tts.md §4a.1: an explicit user override wins; otherwise
   * the device-memory default applies.
   */
  get isTTSAvailable(): boolean {
    return this.ttsBlockReason === null;
  }

  /**
   * 语音功能不可用的**具体原因**，null 表示可用。
   *
   * 之前界面上只有一句笼统的「内存偏低」，但真正把它关掉的常常是
   * 用户自己在设置里关掉的开关（`userTTSOverride === false`）——
   * 说错原因会把人带去检查内存，白折腾。
   */
  get ttsBlockReason(): 'opted-out' | 'low-memory' | null {
    if (this.userTTSOverride === true) {
      return null;
    }
    if (this.userTTSOverride === false) {
      return 'opted-out';
    }
    return this.deviceMeetsMemory ? null : 'low-memory';
  }

  /** 不能播时给用户看的一句话（写明原因和怎么开） */
  get ttsBlockMessage(): string {
    return this.ttsBlockReason === 'opted-out'
      ? '语音功能已在设置里关闭。打开后即可播放和试听。'
      : '当前设备内存偏低，语音功能默认关闭。可以手动打开。';
  }

  // Runtime playback state (discriminated union)
  playbackState: TTSPlaybackState = {mode: 'idle'};

  /**
   * 最近一次播放 / 试听失败的原因。
   *
   * 以前失败只走 console.warn，界面上一点反馈都没有 —— 用户看到的现象
   * 就是「点了没反应」。这里把原因存下来，让界面能直接显示出来。
   */
  speechError: string | null = null;

  /**
   * 中性提示（非错误），比如「中文自动用本机系统语音朗读了」。
   * 和 speechError 分开：错误用红色、提示用普通色。播放开始时被清空。
   */
  speechHint: string | null = null;

  /**
   * 当前 speechError 是否来自聊天链路（消息朗读按钮 / VoiceChip / 自动朗读
   * 兜底）。工作台各屏（Voice / VoiceClone / VoiceChange / GPT-SoVITS）有自己的
   * 内联错误展示；错误弹窗只对聊天链路弹，避免同一条错误既弹窗又内联。
   */
  speechErrorFromChat: boolean = false;

  /**
   * 正在「加载音色」的那个 messageId，null 表示没有处在加载阶段。
   *
   * 本机实测：低端机上首次用一个神经网络音色，光加载音色嵌入就要 5 秒上下
   * （2 MB 的 JSON 解析 + 转 Float32Array），这段时间**没有任何声音**。
   * 界面如果只把按钮切成「停止」，用户看到的就是「点了没反应」。
   * 所以单独暴露这个状态，让界面能显示「正在加载音色…」。
   *
   * 真信号是原生 `onStart`（音频真的开始播放时触发）；拿不到时由
   * `PREPARE_HINT_MS` 兜底收回。
   */
  preparingMessageId: string | null = null;

  /**
   * 「加载提示」的非响应式簿记。
   *
   * 收在一个字段里、并在 makeAutoObservable 的 overrides 中标成 `false`：
   * 这些是纯实现细节（Set、定时器句柄、事件订阅句柄），既不需要被观察，
   * 也不该被 MobX 包一层。
   *
   * - `warmedVoices`：本会话已经成功播放过的音色（key = `engine:id`）。
   *   只有「第一次」才需要加载，所以只有第一次才点亮加载提示；之后再点
   *   同一个音色就是秒出。不持久化 —— 进程重启后原生侧缓存也没了。
   */
  internal = {
    warmedVoices: new Set<string>(),
    hintTimer: null as ReturnType<typeof setTimeout> | null,
    startSub: null as {remove: () => void} | null,
    listenerBound: false,
    /** 当前流式会话是否已经上报过合成错误（onError 先弹、finalize 兜底去重）。 */
    streamErrorSeen: false,
  };

  // Persisted user preferences
  autoSpeakEnabled: boolean = false;
  currentVoice: Voice | null = null;
  /**
   * Supertonic diffusion-step count. Persisted so a user's quality
   * preference survives restart. Missing values default to 5 on first load.
   */
  supertonicSteps: SupertonicSteps = DEFAULT_SUPERTONIC_STEPS;
  /**
   * Supertonic synthesis language. Persisted so the user's choice survives
   * restart. Defaults to `na` ("Auto", language-agnostic). Read at every
   * Supertonic synthesis entry point and passed explicitly so the engine
   * default never governs. See architecture/tts.md §4a.
   *
   * `zh` 是本项目扩展的选项：Supertonic 的语言码里没有中文（31 个码全是其他
   * 语言），但模型的字符索引器覆盖 CJK、也训练过 `<na>` 标签，所以中文是能读
   * 的。选择器里给它一个「中文」入口，内部一律按 `na` 送进引擎
   * （见 `supertonicLanguageFor`）。
   */
  supertonicLanguage: SupertonicLanguageOption = DEFAULT_SUPERTONIC_LANGUAGE;

  // UI state
  isSetupSheetOpen: boolean = false;
  /** Free disk bytes, refreshed each time the setup sheet opens. */
  freeDiskBytes: number | null = null;

  // Per-engine model lifecycle — derived state, NOT persisted.
  supertonicDownloadState: NeuralDownloadState = 'not_installed';
  supertonicDownloadProgress: number = 0;
  supertonicDownloadError: string | null = null;

  kokoroDownloadState: NeuralDownloadState = 'not_installed';
  kokoroDownloadProgress: number = 0;
  kokoroDownloadError: string | null = null;

  kittenDownloadState: NeuralDownloadState = 'not_installed';
  kittenDownloadProgress: number = 0;
  kittenDownloadError: string | null = null;

  // Idempotency guard for the auto-speak path.
  lastSpokenMessageId: string | null = null;

  private appStateSubscription: {remove: () => void} | null = null;
  private sessionReactionDispose: (() => void) | null = null;
  /**
   * Voice id pending restore after a forced engine re-download (e.g. Kokoro
   * FP16 → FP32 migration). When `init()` finds a persisted voice whose
   * engine reports not-installed, the voice id is stashed here so the next
   * successful download of that engine can restore the user's selection
   * instead of falling back to `voices[0]`. Reset to null after restore.
   * Map keyed by engine id; only neural engines participate.
   */
  private pendingVoiceRestore: Partial<Record<NeuralEngineId, string>> = {};

  // Per-streaming-session state for stripping `<think>…</think>` markup.
  private streamStripper: ThinkingStripper | null = null;
  private streamPlaceholderEmitted: boolean = false;

  constructor() {
    makeAutoObservable(
      this,
      {
        // 「加载提示」的簿记字段：纯实现细节，不做 observable
        internal: false,
      },
      {autoBind: true},
    );
    makePersistable(this, {
      name: 'TTSStore',
      properties: [
        'autoSpeakEnabled',
        'currentVoice',
        'supertonicSteps',
        'supertonicLanguage',
        'userTTSOverride',
      ],
      storage: AsyncStorage,
    });
  }

  /**
   * Initialize the store. Idempotent — safe to call multiple times; only the
   * first call does work.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    let totalMemory = 0;
    try {
      totalMemory = await DeviceInfo.getTotalMemory();
    } catch (err) {
      console.warn('[TTSStore] getTotalMemory failed:', err);
      totalMemory = 0;
    }

    runInAction(() => {
      this.deviceMeetsMemory = totalMemory >= TTS_MIN_RAM_BYTES;
    });

    // Lifecycle hooks below run UNCONDITIONALLY — see architecture/tts.md §4e
    // and I8. A user on a low-memory device may flip `userTTSOverride = true`
    // mid-session, at which point the AppState listener and session reaction
    // must already be in place. The four call-site guards in `play`,
    // `preview`, `onAssistantMessageStart`, `onAssistantMessageComplete`
    // (plus component-level guards) remain the gate on user-visible work.

    // Derive each neural engine's install state from disk in parallel.
    const neuralIds: NeuralEngineId[] = ['supertonic', 'kokoro', 'kitten'];
    const results = await Promise.all(
      neuralIds.map(async id => {
        try {
          return {id, installed: await getEngine(id).isInstalled()};
        } catch (err) {
          console.warn(`[TTSStore] ${id} isInstalled check failed:`, err);
          return {id, installed: false};
        }
      }),
    );
    runInAction(() => {
      for (const {id, installed} of results) {
        this.setDownloadState(id, installed ? 'ready' : 'not_installed');
      }
      // Reconcile persisted currentVoice: if the engine's model files
      // were deleted (app restore, manual cleanup) or the engine layout
      // changed (e.g. Kokoro FP16 → FP32 migration), clear the voice so
      // play/stream paths don't crash trying to init a missing engine.
      // Stash the voice id first so it can be restored after re-download
      // — otherwise users lose their selection across the forced upgrade.
      if (
        this.currentVoice != null &&
        this.currentVoice.engine !== 'system' &&
        this.getDownloadState(this.currentVoice.engine as NeuralEngineId) !==
          'ready'
      ) {
        const engineId = this.currentVoice.engine as NeuralEngineId;
        this.pendingVoiceRestore[engineId] = this.currentVoice.id;
        this.currentVoice = null;
      }
    });

    this.appStateSubscription = AppState.addEventListener(
      'change',
      this.handleAppStateChange,
    );

    this.sessionReactionDispose = reaction(
      () => chatSessionStore.activeSessionId,
      () => {
        this.stop();
      },
    );
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'background') {
      // Stop in-flight audio AND release the active engine's native
      // resources (200-450 MB depending on engine). Re-init is lazy on
      // the next play after foreground.
      // Only react to 'background' — 'inactive' fires for transient
      // interruptions (Control Center, incoming call sheet, notification
      // tap) that shouldn't tear down a 200+ MB engine.
      this.stop()
        .then(() => ttsRuntime.release())
        .catch(err => {
          console.warn('[TTSStore] background release failed:', err);
        });
    }
  };

  clearSpeechError() {
    this.speechError = null;
    this.speechErrorFromChat = false;
  }

  /**
   * 这个音色此刻是否处在「正在加载」阶段。
   *
   * 试听按钮 / 音色行用它来显示转圈 + 「正在加载音色…」—— 直接显示
   * 「停止」会让用户以为已经在出声了，实际还在加载、一点声音都没有。
   */
  isPreparingVoice(voice: Voice): boolean {
    return this.preparingMessageId === previewMessageId(voice);
  }

  /** 同上，按 messageId 判断（「生成语音」按钮用）。 */
  isPreparing(messageId: string): boolean {
    return this.preparingMessageId === messageId;
  }

  /** 本会话是否已经加载过这个音色（加载过就不会再有「首次」那段延迟）。 */
  isVoiceWarmed(voice: Voice): boolean {
    return this.internal.warmedVoices.has(voiceKey(voice));
  }

  /** 进入「加载音色」状态。只有本会话第一次播放该音色时才会调用。 */
  private beginPreparing(messageId: string, engine: Voice['engine']): void {
    this.endPreparing();
    this.ensurePrepareListener();
    runInAction(() => {
      this.preparingMessageId = messageId;
    });
    const hint = PREPARE_HINT_MS[engine] ?? DEFAULT_PREPARE_HINT_MS;
    this.internal.hintTimer = setTimeout(
      () => this.endPreparing(messageId),
      hint,
    );
  }

  /**
   * 退出「加载音色」状态。
   *
   * 带 messageId 时只在该次播放仍处于加载阶段才清理 —— 否则会把下一次
   * 播放刚设好的状态误清掉（连续点两个不同音色时会发生）。
   */
  private endPreparing(messageId?: string): void {
    if (this.internal.hintTimer) {
      clearTimeout(this.internal.hintTimer);
      this.internal.hintTimer = null;
    }
    if (messageId && this.preparingMessageId !== messageId) {
      return;
    }
    if (this.preparingMessageId !== null) {
      runInAction(() => {
        this.preparingMessageId = null;
      });
    }
  }

  /**
   * 订阅原生 `onStart` —— 音频**真正开始播放**那一刻触发。
   *
   * 这是判断「加载结束」最准的信号（定时器只能猜）。系统引擎和神经
   * 播放器都会 emit，所以两种音色都能覆盖。订阅失败就退化成定时器
   * 兜底，不影响播放本身。
   */
  private ensurePrepareListener(): void {
    if (this.internal.listenerBound) {
      return;
    }
    this.internal.listenerBound = true;
    try {
      const emitter = (
        Speech as unknown as {
          onStart?: (cb: () => void) => {remove: () => void};
        }
      ).onStart;
      if (typeof emitter === 'function') {
        this.internal.startSub = emitter(() => this.endPreparing());
      }
    } catch (err) {
      console.warn('[TTSStore] subscribe onStart failed:', err);
    }
  }

  /** 成功播完一次后记下来：下次再点同一个音色就是「打开就有声」。 */
  private markVoiceWarmed(voice: Voice): void {
    this.internal.warmedVoices.add(voiceKey(voice));
  }

  setAutoSpeak(on: boolean) {
    this.autoSpeakEnabled = on;
    if (!on) {
      // Turning auto-speak off frees the active neural engine's RAM
      // proactively — the user has signaled they don't want passive
      // playback. Re-init is lazy on the next preview / message replay.
      this.stop()
        .then(() => ttsRuntime.release())
        .catch(err => {
          console.warn('[TTSStore] release on auto-speak off failed:', err);
        });
    }
  }

  /**
   * Persist the user's explicit choice for the TTS availability gate.
   * `true` forces the gate open even on low-memory devices; `false` forces
   * it closed even on high-memory devices. Mirrors `setAutoSpeak(false)`'s
   * stop+release pattern when the gate transitions from open to closed,
   * to free engine RAM immediately. See architecture/tts.md §4a.5, I3, I6.
   */
  setUserTTSOverride(value: boolean): void {
    const wasAvailable = this.isTTSAvailable;
    this.userTTSOverride = value;
    if (wasAvailable && !value) {
      this.stop()
        .then(() => ttsRuntime.release())
        .catch(err => {
          console.warn('[TTSStore] release on TTS opt-out failed:', err);
        });
    }
  }

  setCurrentVoice(v: Voice | null) {
    this.currentVoice = v;
  }

  setSupertonicSteps(steps: SupertonicSteps) {
    this.supertonicSteps = steps;
  }

  /**
   * The sole explicit writer of `supertonicLanguage` (the language picker).
   * Takes effect on the next utterance; in-flight playback is not restarted.
   */
  setSupertonicLanguage(language: SupertonicLanguageOption) {
    this.supertonicLanguage = language;
  }

  openSetupSheet() {
    this.isSetupSheetOpen = true;
    this.refreshFreeDisk();
  }

  /** Re-read free disk space. Called on sheet open so the UI can
   *  disable Install buttons for engines that won't fit. */
  async refreshFreeDisk() {
    try {
      const bytes = await DeviceInfo.getFreeDiskStorage('important');
      runInAction(() => {
        this.freeDiskBytes = bytes;
      });
    } catch (err) {
      console.warn('[TTSStore] refreshFreeDisk failed:', err);
    }
  }

  closeSetupSheet() {
    this.isSetupSheetOpen = false;
  }

  // --- Per-engine state helpers ----------------------------------------

  private setDownloadState(id: NeuralEngineId, state: NeuralDownloadState) {
    if (id === 'supertonic') {
      this.supertonicDownloadState = state;
    } else if (id === 'kokoro') {
      this.kokoroDownloadState = state;
    } else {
      this.kittenDownloadState = state;
    }
  }

  private setDownloadProgress(id: NeuralEngineId, progress: number) {
    if (id === 'supertonic') {
      this.supertonicDownloadProgress = progress;
    } else if (id === 'kokoro') {
      this.kokoroDownloadProgress = progress;
    } else {
      this.kittenDownloadProgress = progress;
    }
  }

  private setDownloadError(id: NeuralEngineId, error: string | null) {
    if (id === 'supertonic') {
      this.supertonicDownloadError = error;
    } else if (id === 'kokoro') {
      this.kokoroDownloadError = error;
    } else {
      this.kittenDownloadError = error;
    }
  }

  private getDownloadState(id: NeuralEngineId): NeuralDownloadState {
    if (id === 'supertonic') {
      return this.supertonicDownloadState;
    }
    if (id === 'kokoro') {
      return this.kokoroDownloadState;
    }
    return this.kittenDownloadState;
  }

  /**
   * Stop any in-flight playback and reset state to idle.
   */
  async stop(): Promise<void> {
    const state = this.playbackState;
    const voice = this.currentVoice;
    runInAction(() => {
      this.playbackState = {mode: 'idle'};
    });
    this.streamStripper = null;
    this.streamPlaceholderEmitted = false;
    if (state.mode === 'streaming') {
      try {
        await state.handle.cancel();
      } catch (err) {
        console.warn('[TTSStore] streaming cancel failed:', err);
      }
      return;
    }
    if (voice) {
      try {
        await getEngine(voice.engine).stop();
      } catch (err) {
        console.warn('[TTSStore] stop failed:', err);
      }
    }
  }

  /**
   * 这段文本该用哪个 Supertonic 语言码。
   *
   * Supertonic 的类型里**没有 zh**（31 个语言码里中文缺席），但 v3 的字符
   * 索引器实测覆盖 CJK —— 「你好世界中文」都能映射到真实 token，而且模型
   * 训练过语言无关标签 `<na>`。所以中文按 'na' 送进去就能读。
   *
   * 其他语言沿用用户在设置里选的码；日/韩有独立语言码，直接用它更准。
   */
  /**
   * 用户选的语言码 → 引擎真的认识的语言码。
   * 「中文」在 Supertonic 的语言码里不存在，统一映射到 `na`。
   */
  private toEngineSupertonicLanguage = (
    language: SupertonicLanguageOption,
  ): SupertonicLanguage => (language === 'zh' ? 'na' : language);

  private supertonicLanguageFor = (text: string): SupertonicLanguage => {
    // 用户显式选了「中文」：不管文本是什么都按中文读
    if (this.supertonicLanguage === 'zh') {
      return 'na';
    }
    const lang = detectTextLang(text);
    if (lang === 'zh') {
      return 'na';
    }
    if (lang === 'ja') {
      return 'ja';
    }
    if (lang === 'ko') {
      return 'ko';
    }
    return this.toEngineSupertonicLanguage(this.supertonicLanguage);
  };

  /**
   * 决定「这段文本」到底用哪个音色/引擎播。
   *
   * 本地神经引擎里只有 supertonic 能读中文（字符索引器覆盖 CJK）；
   * kokoro/kitten 只有英文音素词典，喂中文会发不出声。路由顺序：
   *   1. 选中的引擎能读 → 原样用；
   *   2. 装过 supertonic → 交给它（中文走 'na' 标签）；
   *   3. 都没有 → 回退系统 TTS：
   *      a. 系统音色列表里有对应语言的音色 → 直接用它；
   *      b. 枚举不到（不少国产 TTS 引擎不实现 getVoices，返回空列表）→
   *         构造一个只带 language 的兜底音色，靠 Android `setLanguage(zh-CN)`
   *         让引擎用默认中文嗓音读 —— setLanguage 不依赖音色枚举。
   * 英文 / 未知语言原样返回。
   *
   * 返回：
   *  - {kind:'ok', voice, routed:false}            直接用选中的音色
   *  - {kind:'ok', voice, routed:true, langLabel}  已回退到系统对应语言语音
   */
  private async resolveVoiceForText(
    text: string,
    preferred: Voice,
  ): Promise<
    | {kind: 'ok'; voice: Voice; routed: false}
    | {
        kind: 'ok';
        voice: Voice;
        routed: true;
        langLabel: string;
        via: 'kokoro-zh' | 'system';
      }
  > {
    const lang = detectTextLang(text);
    if (lang === 'en' || lang === 'unknown') {
      return {kind: 'ok', voice: preferred, routed: false};
    }

    // ① 中文 + Kokoro：英文音色读不了中文（英文音素词典），但引擎装了中文
    //    音色，先切到中文音色。放在 engineSupportsLang 之前 —— 引擎级能力表
    //    里 kokoro 是「英文 + 中文」混合值，分不清用户手里具体哪个音色。
    if (
      lang === 'zh' &&
      preferred.engine === 'kokoro' &&
      !isChineseVoice(preferred) &&
      this.getDownloadState('kokoro') === 'ready'
    ) {
      const zhVoice = KOKORO_VOICES.find(isChineseVoice);
      if (zhVoice) {
        return {
          kind: 'ok',
          voice: zhVoice,
          routed: true,
          langLabel: LANG_LABEL.zh,
          via: 'kokoro-zh',
        };
      }
    }

    if (engineSupportsLang(preferred.engine, lang)) {
      return {kind: 'ok', voice: preferred, routed: false};
    }

    // ① 中文 → Kokoro 的中文音色（zf_ / zm_ 开头那 6 个）。
    //    它们是真正的中文模型，配合 chineseG2P（汉字 → IPA + 声调）就能读中文，
    //    播放时走 playPhonemes 路径，绕开引擎自带的英文音素词典。
    //    当前选的是英文音色也切过来，比系统 TTS 音质好，也更有「中文语音包」感。
    if (lang === 'zh' && this.getDownloadState('kokoro') === 'ready') {
      const zhVoice = KOKORO_VOICES.find(isChineseVoice);
      if (zhVoice) {
        return {
          kind: 'ok',
          voice: zhVoice,
          routed: true,
          langLabel: LANG_LABEL.zh,
          via: 'kokoro-zh',
        };
      }
    }

    // ② 没装 Supertonic → 找系统里对应语言的语音
    let sysVoices: Voice[] = [];
    try {
      sysVoices = await getSystemVoicesCached();
    } catch (err) {
      console.warn('[TTSStore] 读取系统语音失败:', err);
    }
    // 语言码要按 cmn/yue 一起判：Android 引擎常把普通话报成 cmn-CN
    const match = sysVoices.find(v => langCodeMatches(v.language ?? '', lang));
    const langLabel = LANG_LABEL[lang];
    if (match) {
      return {kind: 'ok', voice: match, routed: true, langLabel, via: 'system'};
    }
    // 枚举不到对应语言的系统音色 ≠ 读不了。退到系统 TTS 的语言默认嗓音，
    // 具体能不能读由系统语音包决定（系统设置里装了就能读）。
    return {
      kind: 'ok',
      voice: {
        id: '',
        name: `系统${langLabel}语音`,
        engine: 'system',
        language: LANG_TO_BCP47[lang],
      },
      routed: true,
      langLabel,
      via: 'system',
    };
  }

  /**
   * Speak `text` as a single utterance (replay path).
   */
  async play(
    messageId: string,
    text: string,
    opts?: {hadReasoning?: boolean; voiceOverride?: Voice; fromChat?: boolean},
  ): Promise<void> {
    if (!this.isTTSAvailable) {
      runInAction(() => {
        this.speechError = this.ttsBlockMessage;
        this.speechErrorFromChat = opts?.fromChat === true;
      });
      return;
    }
    const voice = opts?.voiceOverride ?? this.currentVoice;
    if (!voice) {
      runInAction(() => {
        this.speechError = '还没有选择音色，先挑一个再播放';
        this.speechErrorFromChat = opts?.fromChat === true;
      });
      return;
    }

    await this.stop();
    runInAction(() => {
      this.speechError = null;
      this.speechHint = null;
    });

    const {text: cleanText, hadNonEmptyThink} = ThinkingStripper.stripFinal(
      text,
      {hadReasoning: opts?.hadReasoning},
    );
    const spokenText = hadNonEmptyThink
      ? `${pickThinkingPlaceholder()} ${cleanText}`
      : cleanText;

    // 中文/日/韩等非英文文本：本地神经引擎读不出，自动回退到系统 TTS。
    const resolved = await this.resolveVoiceForText(spokenText, voice);
    const effectiveVoice = resolved.voice;
    if (resolved.routed) {
      runInAction(() => {
        this.speechHint =
          resolved.via === 'kokoro-zh'
            ? `已改用 Kokoro 中文音色「${effectiveVoice.name}」朗读中文`
            : `本机引擎读不了${resolved.langLabel}，已自动改用系统${resolved.langLabel}语音朗读`;
      });
    }

    // 同 preview：只有本会话第一次用这个音色时才需要「正在加载」提示
    if (!this.isVoiceWarmed(effectiveVoice)) {
      this.beginPreparing(messageId, effectiveVoice.engine);
    }
    runInAction(() => {
      this.playbackState = {mode: 'playing', messageId};
    });

    try {
      const engine = getEngine(effectiveVoice.engine);
      // 中文音色 + 文本里有汉字 → 走音素路径（汉字 → IPA + 声调），
      // 绕开引擎自带的英文音素词典。这一条同时覆盖「用户自己选了中文音色」
      // 和「路由自动切到中文音色」两种情况。
      const speakChinesePhonemes =
        isChineseVoice(effectiveVoice) &&
        containsHan(spokenText) &&
        typeof engine.playPhonemes === 'function';
      if (speakChinesePhonemes) {
        await engine.playPhonemes!(chineseToIPA(spokenText), effectiveVoice);
      } else if (effectiveVoice.engine === 'supertonic') {
        await (engine as SupertonicEngine).play(spokenText, effectiveVoice, {
          language: this.supertonicLanguageFor(spokenText),
          inferenceSteps: this.supertonicSteps,
        });
      } else {
        await engine.play(spokenText, effectiveVoice);
      }
      // 能播完就说明音色已经加载进内存了，下次直接用
      this.markVoiceWarmed(effectiveVoice);
    } catch (err) {
      console.warn('[TTSStore] play failed:', err);
      runInAction(() => {
        this.speechError = describeSpeechError(err);
        this.speechErrorFromChat = opts?.fromChat === true;
      });
    } finally {
      this.endPreparing(messageId);
      runInAction(() => {
        if (
          this.playbackState.mode === 'playing' &&
          this.playbackState.messageId === messageId
        ) {
          this.playbackState = {mode: 'idle'};
        }
      });
    }
  }

  /**
   * Audition path — speak `TTS_PREVIEW_SAMPLE` with `voice` and route
   * through the store so it interacts cleanly with any in-flight stream
   * or replay (no overlapping audio, no engine-swap races).
   *
   * Skips the thinking-stripper entirely — preview text is fixed and
   * known clean.
   *
   * messageId is engine-qualified (`preview:<engine>:<voiceId>`) so two
   * engines that share a voice id can't collide on the cleanup guard.
   */
  async preview(voice: Voice): Promise<void> {
    if (!this.isTTSAvailable) {
      runInAction(() => {
        this.speechError = this.ttsBlockMessage;
      });
      return;
    }
    const messageId = previewMessageId(voice);
    await this.stop();
    runInAction(() => {
      this.speechError = null;
      this.speechHint = null;
    });
    // 本会话第一次用这个音色：先把「正在加载」亮出来。神经网络引擎要读
    // 几 MB 的音色嵌入，这段是真的慢（低端机实测 5 秒上下）且全程无声，
    // 不提示的话用户只会看到「点了没反应」。
    if (!this.isVoiceWarmed(voice)) {
      this.beginPreparing(messageId, voice.engine);
    }
    runInAction(() => {
      this.playbackState = {mode: 'playing', messageId};
    });
    try {
      const engine = getEngine(voice.engine);
      if (voice.engine === 'supertonic') {
        await (engine as SupertonicEngine).play(TTS_PREVIEW_SAMPLE, voice, {
          language: this.toEngineSupertonicLanguage(this.supertonicLanguage),
          inferenceSteps: this.supertonicSteps,
        });
      } else {
        await engine.play(TTS_PREVIEW_SAMPLE, voice);
      }
      this.markVoiceWarmed(voice);
    } catch (err) {
      console.warn('[TTSStore] preview failed:', err);
      runInAction(() => {
        this.speechError = describeSpeechError(err);
        this.speechErrorFromChat = false;
      });
    } finally {
      this.endPreparing(messageId);
      runInAction(() => {
        if (
          this.playbackState.mode === 'playing' &&
          this.playbackState.messageId === messageId
        ) {
          this.playbackState = {mode: 'idle'};
        }
      });
    }
  }

  /**
   * `true` when a preview for `voice` is currently in flight. Components
   * use this to swap their play icon for stop while the engine loads
   * and speaks (Kokoro warm-up is ~4s — without this the user has no
   * feedback that their tap registered).
   */
  isPreviewingVoice(voice: Voice): boolean {
    return (
      this.playbackState.mode === 'playing' &&
      this.playbackState.messageId === previewMessageId(voice)
    );
  }

  /** First token / message creation. Opens a streaming session. */
  onAssistantMessageStart(messageId: string): void {
    if (
      !this.isTTSAvailable ||
      !this.autoSpeakEnabled ||
      this.currentVoice == null ||
      messageId === this.lastSpokenMessageId
    ) {
      return;
    }
    // Stop ANY prior playback before opening the new session. The stop
    // promise is passed to the streaming handle so it waits for the old
    // `Speech.stop()` to complete before starting synthesis — prevents
    // the old stop flag from killing the new stream's first sentence.
    const stopDone = this.stop().catch(err => {
      console.warn('[TTSStore] stop before new stream failed:', err);
    });

    const voice = this.currentVoice;
    this.lastSpokenMessageId = messageId;
    this.internal.streamErrorSeen = false;
    this.streamStripper = new ThinkingStripper();
    this.streamPlaceholderEmitted = false;
    // 流式批次合成失败：库会继续合成后续批次，错误在这里实时上报；
    // finalize() 最后还会带首个错误 reject 一次，由 streamErrorSeen 去重。
    // 取消（stop / 切会话 / 退后台）不会触发。
    const onStreamError = (err: Error) => {
      console.warn('[TTSStore] streaming synthesis failed:', err);
      this.internal.streamErrorSeen = true;
      runInAction(() => {
        this.speechError = describeSpeechError(err);
        this.speechErrorFromChat = true;
      });
    };
    const engine = getEngine(voice.engine);
    const handle =
      voice.engine === 'supertonic'
        ? (engine as SupertonicEngine).playStreaming(voice, stopDone, {
            language: this.toEngineSupertonicLanguage(this.supertonicLanguage),
            inferenceSteps: this.supertonicSteps,
            onError: onStreamError,
          })
        : engine.playStreaming(voice, stopDone, {onError: onStreamError});
    runInAction(() => {
      this.playbackState = {mode: 'streaming', messageId, handle};
    });
  }

  /** Delta chunk from the LLM stream. */
  onAssistantMessageChunk(
    messageId: string,
    chunkText: string,
    reasoningDelta?: string,
  ) {
    const state = this.playbackState;
    if (state.mode !== 'streaming' || state.messageId !== messageId) {
      return;
    }
    const stripper = this.streamStripper;
    if (stripper == null) {
      state.handle.appendText(chunkText);
      return;
    }
    if (reasoningDelta) {
      stripper.noteReasoning(reasoningDelta);
    }
    const cleaned = stripper.feed(chunkText);
    if (
      stripper.hadNonEmptyThink() &&
      !this.streamPlaceholderEmitted &&
      cleaned.length === 0
    ) {
      state.handle.appendText(`${pickThinkingPlaceholder()} `);
      this.streamPlaceholderEmitted = true;
      return;
    }
    if (cleaned.length > 0) {
      if (stripper.hadNonEmptyThink() && !this.streamPlaceholderEmitted) {
        state.handle.appendText(`${pickThinkingPlaceholder()} `);
        this.streamPlaceholderEmitted = true;
      }
      state.handle.appendText(cleaned);
    }
  }

  /** Final completion — flushes streaming or falls back to replay. */
  onAssistantMessageComplete(
    messageId: string,
    text: string,
    opts?: {hadReasoning?: boolean},
  ) {
    const state = this.playbackState;
    if (state.mode === 'streaming' && state.messageId === messageId) {
      const stripper = this.streamStripper;
      if (stripper != null) {
        const leftover = stripper.flush();
        if (leftover.length > 0) {
          if (stripper.hadNonEmptyThink() && !this.streamPlaceholderEmitted) {
            state.handle.appendText(`${pickThinkingPlaceholder()} `);
            this.streamPlaceholderEmitted = true;
          }
          state.handle.appendText(leftover);
        }
      }
      state.handle
        .finalize()
        .catch(err => {
          console.warn('[TTSStore] finalize failed:', err);
          // onError 已经弹过的批次错误不再重复弹；这里兜的是 onError
          // 覆盖不到的失败——比如引擎 acquire 失败（音色没装好、运行时
          // 被占用），此时 finalize() 会同样 reject。
          if (!this.internal.streamErrorSeen) {
            this.internal.streamErrorSeen = true;
            runInAction(() => {
              this.speechError = describeSpeechError(err);
              this.speechErrorFromChat = true;
            });
          }
        })
        .finally(() => {
          runInAction(() => {
            if (
              this.playbackState.mode === 'streaming' &&
              this.playbackState.messageId === messageId
            ) {
              this.playbackState = {mode: 'idle'};
              // Only reset stripper if this message still owns it —
              // a new message may have already set its own stripper.
              this.streamStripper = null;
              this.streamPlaceholderEmitted = false;
            }
          });
        });
      return;
    }

    if (
      !this.isTTSAvailable ||
      !this.autoSpeakEnabled ||
      this.currentVoice == null ||
      messageId === this.lastSpokenMessageId
    ) {
      return;
    }
    this.lastSpokenMessageId = messageId;
    this.play(messageId, text, {
      hadReasoning: opts?.hadReasoning,
      fromChat: true,
    }).catch(() => {
      // play() already logs and recovers; swallow to satisfy no-floating-promises.
    });
  }

  // --- Per-engine download actions --------------------------------------

  private static readonly ENGINE_ESTIMATED_BYTES: Record<
    NeuralEngineId,
    number
  > = {
    supertonic: SUPERTONIC_MODEL_ESTIMATED_BYTES,
    kokoro: KOKORO_MODEL_ESTIMATED_BYTES,
    kitten: KITTEN_MODEL_ESTIMATED_BYTES,
  };

  private async downloadNeuralEngine(id: NeuralEngineId): Promise<void> {
    if (this.getDownloadState(id) === 'downloading') {
      return;
    }
    // Set downloading immediately so concurrent calls are blocked.
    runInAction(() => {
      this.setDownloadState(id, 'downloading');
      this.setDownloadProgress(id, 0);
      this.setDownloadError(id, null);
    });

    const engine = getEngine(id) as
      | SupertonicEngine
      | KokoroEngine
      | KittenEngine;

    // Reclaim engine-specific legacy files BEFORE the disk-space preflight,
    // so a borderline device upgrading from an older engine layout (e.g.
    // Kokoro FP16 → FP32) is not blocked by space the migration is about to
    // free. Idempotent; safe when there is nothing to reclaim.
    if (
      'reclaimLegacySpace' in engine &&
      typeof engine.reclaimLegacySpace === 'function'
    ) {
      try {
        await engine.reclaimLegacySpace();
      } catch (err) {
        console.warn(`[TTSStore] ${id} legacy reclaim failed:`, err);
      }
    }

    // Safety-net disk-space check. The UI already disables the Install
    // button when `freeDiskBytes` is too low, so this is a last resort
    // guard for race conditions (space changed between sheet open and tap).
    const estimatedBytes = TTSStore.ENGINE_ESTIMATED_BYTES[id];
    const requiredBytes = Math.ceil(estimatedBytes * 1.2);
    try {
      const freeBytes = await DeviceInfo.getFreeDiskStorage('important');
      if (freeBytes < requiredBytes) {
        runInAction(() => {
          this.setDownloadState(id, 'not_installed');
          this.freeDiskBytes = freeBytes;
        });
        return;
      }
    } catch (err) {
      console.warn('[TTSStore] disk-space preflight failed:', err);
    }
    try {
      await engine.downloadModel(progress => {
        runInAction(() => {
          this.setDownloadProgress(id, progress);
        });
      });
      // Auto-select a voice when none is set — so play and auto-speak work
      // immediately after install. If a previous selection for this engine
      // was stashed during init() (e.g. forced re-download after a model
      // layout migration), restore it when still valid; otherwise fall
      // back to the first voice.
      const voices = await engine.getVoices();
      runInAction(() => {
        this.setDownloadState(id, 'ready');
        this.setDownloadProgress(id, 1);
        if (this.currentVoice == null && voices.length > 0) {
          const pendingId = this.pendingVoiceRestore[id];
          const restored =
            pendingId != null ? voices.find(v => v.id === pendingId) : null;
          this.currentVoice = restored ?? voices[0]!;
        }
        delete this.pendingVoiceRestore[id];
      });
    } catch (err) {
      console.warn(`[TTSStore] ${id} download failed:`, err);
      const message = err instanceof Error ? err.message : String(err);
      runInAction(() => {
        this.setDownloadState(id, 'error');
        this.setDownloadError(id, message);
      });
    }
  }

  private async deleteNeuralEngine(id: NeuralEngineId): Promise<void> {
    // Defensive: refuse to delete while a download is writing into the
    // same directory. The UI never offers delete in this state, but the
    // store API is public — guard anyway. Mirrors `downloadNeuralEngine`'s
    // own early-return on duplicate downloads.
    if (this.getDownloadState(id) === 'downloading') {
      return;
    }
    const engine = getEngine(id) as
      | SupertonicEngine
      | KokoroEngine
      | KittenEngine;
    // If this engine is currently active, stop in-flight audio AND
    // release the native resources BEFORE unlinking files. Skipping
    // either step risks a native crash from the engine touching files
    // that have just been removed under it.
    if (ttsRuntime.getActiveEngineId() === id) {
      await this.stop();
      await ttsRuntime.release();
    }
    try {
      await engine.deleteModel();
    } catch (err) {
      console.warn(`[TTSStore] ${id} delete failed:`, err);
    }
    runInAction(() => {
      this.setDownloadState(id, 'not_installed');
      this.setDownloadProgress(id, 0);
      this.setDownloadError(id, null);
      if (this.currentVoice?.engine === id) {
        this.currentVoice = null;
      }
    });
  }

  async downloadSupertonic(): Promise<void> {
    return this.downloadNeuralEngine('supertonic');
  }

  async downloadKokoro(): Promise<void> {
    return this.downloadNeuralEngine('kokoro');
  }

  async downloadKitten(): Promise<void> {
    return this.downloadNeuralEngine('kitten');
  }

  /** Retry a failed Supertonic download (preserved for API compat). */
  async retryDownload(): Promise<void> {
    return this.downloadNeuralEngine('supertonic');
  }

  async retryKokoroDownload(): Promise<void> {
    return this.downloadNeuralEngine('kokoro');
  }

  async retryKittenDownload(): Promise<void> {
    return this.downloadNeuralEngine('kitten');
  }

  async deleteSupertonic(): Promise<void> {
    return this.deleteNeuralEngine('supertonic');
  }

  async deleteKokoro(): Promise<void> {
    return this.deleteNeuralEngine('kokoro');
  }

  async deleteKitten(): Promise<void> {
    return this.deleteNeuralEngine('kitten');
  }
}

export const ttsStore = new TTSStore();
