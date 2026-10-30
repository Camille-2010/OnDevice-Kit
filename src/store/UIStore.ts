import {Appearance} from 'react-native';

import {makePersistable} from 'mobx-persist-store';
import {makeAutoObservable, runInAction} from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  l10n,
  supportedLanguages as localesSupportedLanguages,
  type AvailableLanguage,
} from '../locales';
import {ErrorState} from '../utils/errors';
import {
  INITIAL_ONBOARDING_STATE,
  type OnboardingState,
  type OnboardingStep,
  type TopicKey,
} from './onboarding/types';

export class UIStore {
  static readonly GROUP_KEYS = {
    READY_TO_USE: 'ready_to_use',
    AVAILABLE_TO_DOWNLOAD: 'available_to_download',
  } as const;

  pageStates = {
    modelsScreen: {
      filters: [] as string[],
      expandedGroups: {
        [UIStore.GROUP_KEYS.READY_TO_USE]: true,
      },
    },
  };

  // This is a flag to auto-navigate to the chat page after loading a model
  // 2026-10-19：默认从 true 改为 false。
  // 用户反馈「模型加载完成后不要自动跳转」—— 加载完自动跳到对话页，
  // 会打断「我只是想把这个模型设为当前模型」这个动作。
  // 设置页里仍可手动打开。
  autoNavigatetoChat = false;

  // 出厂默认（全新安装就是这个）：浅色主题 + 液态玻璃页面风格。
  // 注意 themeStyle 的取值：'rounded' = MIUIX，'standard' = 标准（Material），
  // 'liquid-glass' = 液态玻璃（默认），全项目的圆角/形态判断都按这个约定走（见 theme/cards.ts）。
  colorScheme: 'system' | 'light' | 'dark' = 'light';

  // Current selected language (default to Chinese)
  _language: AvailableLanguage = 'zh';

  // List of supported languages (derived from locales registry)
  get supportedLanguages(): readonly AvailableLanguage[] {
    return localesSupportedLanguages;
  }

  displayMemUsage = false;

  /**
   * 「待打开的更多子页」请求：任意页面（如下载管理）想跳进「更多」tab 里的
   * 某个子功能（gptsovits / voiceChange / tts…）时设一个 key，MainTabs 的
   * effect 看到就切 tab + 开子页，然后立刻清掉自己。
   * 之所以走 store 而不是 navigation：更多 tab 的子页是 App 级 state
   * （activeTab/moreSub），不是路由，跨屏只能这样递请求。
   */
  pendingMoreSub: string | null = null;

  /**
   * 首次安装的「用户协议与免责声明」是否已同意。
   *
   * 默认 false：全新安装 / 清除数据后首次启动必须先看完声明并同意，
   * 才会挂载主应用（不是盖一层浮层，而是根本先不渲染 App）。
   * 同意后持久化，之后不再弹出。
   */
  disclaimerAccepted = false;

  /**
   * 页面重入计数：每次切 Tab / 进二级页 +1。
   *
   * Entrance 组件用它做入场动画的触发源 —— 之前 Entrance 只在首次挂载时
   * 播一次，切走再回来组件还挂着（anim 已经是 1），所以「回到某个页面」
   * 完全没有任何入场动画，看着就是硬切。这里给一个可观察的递增信号，
   * Entrance 订阅它重播动画。
   *
   * 只在内存里，不持久化。
   */
  screenEpoch = 0;

  /**
   * 只在「目标页面」这一棵子树里重播，不再全局广播。
   *
   * 旧实现是 screenEpoch += 1，而 Entrance 订阅的正是这个全局值 ——
   * 于是任何一处调 replayScreenEnter()（App.tsx 有 3 处，设置页 1 处），
   * 整个 App 所有页面的几十个 Entrance 区块会同时重播一遍：
   *   1) 一次性起几十个动画节点，切页/进二级页必卡；
   *   2) 用户看到「动画播了两遍」（翻页一遍 + 入场又一遍）。
   *
   * 现在改成「只给指定 key 的页面 +1」，Entrance 只订阅自己那一页的 epoch，
   * 互不相干。
   *
   * ⚠️ 用 observable.map 而不是普通对象 + 整体替换：
   *   旧写法 `this.screenEpochByKey = {...this.screenEpochByKey, [key]: n}`
   *   每次都**新建整个对象**，MobX 会通知**所有**订阅者 —— 69 个 Entrance
   *   全部重渲染，哪怕只有一页变了。改用 observable.map 后，只有
   *   `get(key)` 那个 key 的 observer 会被通知。
   */
  screenEpochByKey = new Map<string, number>();

  /** 通知某个页面的 Entrance 重播入场动画（只影响该页） */
  replayScreenEnter(key: string = 'home') {
    const n = (this.screenEpochByKey.get(key) ?? 0) + 1;
    this.screenEpochByKey.set(key, n);
  }

  // Visual treatment for the floating tab bar and shared app surfaces.
  // 'rounded' = MIUIX，'standard' = 标准 Material，'liquid-glass' = 液态玻璃（默认）
  themeStyle: 'standard' | 'rounded' | 'liquid-glass' = 'liquid-glass';

  /**
   * 一次性迁移标记：把「浅色 + 液态玻璃」这套默认值也落实到**已经装过的实例**上。
   * 只执行一次，之后用户在设置里的选择不会被覆盖。
   */
  uiDefaultsApplied = false;

  /** 把 UI 默认值（浅色 + 液态玻璃）应用一次；见 App.tsx 的 hydration 之后调用 */
  applyUiDefaultsOnce() {
    if (this.uiDefaultsApplied) {
      return;
    }
    runInAction(() => {
      this.themeStyle = 'liquid-glass';
      this.colorScheme = 'light';
      this.uiDefaultsApplied = true;
    });
  }

  // ── 主题二级页的真实开关 ──────────────────────────────────────
  /** 关键色（强调色）覆盖；null = 用主题自带的那套蓝 */
  keyColor: string | null = '#297CF2';

  /**
   * 光效：顶栏/底栏叠加缓慢流动的高光带。
   *
   * 以前这个开关绑的是 `liquidGlassBar`（文案与实际控制的变量对不上）。
   * 现在液态玻璃由「界面风格 → 液态玻璃」统一控制，这里专门管光效带。
   */
  sheenEffect = true;

  /**
   * 磨砂（毛玻璃）模式：首页背景图上叠加半透明顶栏与卡片。
   * 出厂默认开启（全新安装即开）；已装实例也会通过 applyFrostedDefaultOnce 默认开启。
   * 关闭时首页恢复纯白背景、卡片与顶栏改为不透明实底。
   */
  frosted = true;
  /** 一次性迁移标记：让已装实例也默认开启磨砂 */
  frostedDefaultApplied = false;

  // 首页背景随机种子
  homeBgIndex = 0;
  /** 随机背景：开启后每次进入首页随机显示一张背景图（出厂默认开启） */
  randomHomeBg = true;
  /**
   * 本次启动的随机壁纸种子（0~1）。
   * 只在 store 构造时随机一次 → 返回首页/切页都不变；
   * 重启 App 会重建 store → 换一张。**不持久化**。
   */
  sessionBgSeed = Math.random();
  /** 一次性迁移标记：让已装实例也默认开启随机壁纸 */
  randomBgDefaultApplied = false;

  // 是否显示主页「模型下载直达」入口
  showDownloadEntry = true;

  iOSBackgroundDownloading = true;

  benchmarkShareDialog = {
    shouldShow: true,
  };

  // Warning state for chat-related warnings (like multimodal warnings)
  chatWarning: ErrorState | null = null;

  // Models for which the tool-compatibility banner has already been shown.
  // Persisted so each model warns at most once per device.
  toolCompatWarnedModels: string[] = [];

  // Onboarding flow gating: persisted; default false on a fresh install.
  // Once flipped true, the OnboardingStack never re-mounts in this app
  // lifetime.
  hasCompletedOnboarding: boolean = false;

  // Frozen at onboarding completion; consumed by future Homepage
  // pal-suggestion surfaces. Never re-edited after the single write in
  // `completeOnboarding`.
  onboardingTopicsSnapshot: TopicKey[] = [];

  // Per-session, in-memory only. Reset on completion. Not persisted.
  onboardingState: OnboardingState = {...INITIAL_ONBOARDING_STATE};

  // Per-modelId dismissal of the download banner. Per-session — once the
  // download completes, the entry can be cleared so a fresh ready-to-load
  // state isn't pre-dismissed.
  dismissedDownloadIds: string[] = [];

  hasWarnedToolCompat(modelId: string): boolean {
    return this.toolCompatWarnedModels.includes(modelId);
  }

  markToolCompatWarned(modelId: string) {
    runInAction(() => {
      if (!this.toolCompatWarnedModels.includes(modelId)) {
        this.toolCompatWarnedModels.push(modelId);
      }
    });
  }

  showError(message: string) {
    // TODO: Implement error display logic (e.g., toast, alert, etc.)
    console.error(message);
  }

  setChatWarning(warning: ErrorState | null) {
    runInAction(() => {
      this.chatWarning = warning;
    });
  }

  clearChatWarning() {
    runInAction(() => {
      this.chatWarning = null;
    });
  }

  /** 同意首次安装的免责声明（持久化，之后不再弹出）。 */
  acceptDisclaimer() {
    runInAction(() => {
      this.disclaimerAccepted = true;
    });
  }

  /** 请求跳进「更多」tab 的某个子页（见 pendingMoreSub 注释）。 */
  requestMoreSub(key: string) {
    runInAction(() => {
      this.pendingMoreSub = key;
    });
  }

  clearPendingMoreSub() {
    runInAction(() => {
      this.pendingMoreSub = null;
    });
  }

  constructor() {
    makeAutoObservable(this);
    makePersistable(this, {
      name: 'UIStore',
      properties: [
        'pageStates',
        'colorScheme',
        'autoNavigatetoChat',
        'displayMemUsage',
        'themeStyle',
        'uiDefaultsApplied',
        'keyColor',
        'sheenEffect',
        'frosted',
        'frostedDefaultApplied',
        'homeBgIndex',
        'randomHomeBg',
        'randomBgDefaultApplied',
        'showDownloadEntry',
        'benchmarkShareDialog',
        '_language',
        'toolCompatWarnedModels',
        'hasCompletedOnboarding',
        'onboardingTopicsSnapshot',
        'disclaimerAccepted',
      ],
      storage: AsyncStorage,
    });

    // backwards compatibility. Removed this from the ui settings screen.
    this.iOSBackgroundDownloading = true;
  }

  setValue<T extends keyof typeof this.pageStates>(
    page: T,
    key: keyof (typeof this.pageStates)[T],
    value: any,
  ) {
    runInAction(() => {
      if (this.pageStates[page]) {
        this.pageStates[page][key] = value;
      } else {
        console.error(`Page '${page}' does not exist in pageStates`);
      }
    });
  }

  setColorScheme(colorScheme: 'system' | 'light' | 'dark') {
    runInAction(() => {
      this.colorScheme = colorScheme;
    });
  }

  get effectiveColorScheme(): 'light' | 'dark' {
    if (this.colorScheme !== 'system') {
      return this.colorScheme;
    }
    return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  }

  setLanguage(language: AvailableLanguage) {
    runInAction(() => {
      this._language = language;
    });
  }
  get language() {
    // 语言不在 l10n 里时回退到 'en'（基础语言），而不是 'zh'。
    // 会发生在：App 增删了语言、或持久化里存了无效/别处构建的语言值。
    // 正常中文用户 _language='zh' 是有效值，不走这条回退。
    const stored = this._language in l10n ? this._language : 'en';
    return stored;
  }

  get l10n() {
    return l10n[this.language];
  }

  setAutoNavigateToChat(value: boolean) {
    runInAction(() => {
      this.autoNavigatetoChat = value;
    });
  }

  setThemeStyle(v: 'standard' | 'rounded' | 'liquid-glass') {
    runInAction(() => {
      this.themeStyle = v;
    });
  }

  setHomeBgIndex(i: number) {
    runInAction(() => {
      this.homeBgIndex = i;
    });
  }

  setRandomHomeBg(v: boolean) {
    runInAction(() => {
      this.randomHomeBg = v;
    });
  }

  /**
   * 一次性迁移：把「随机壁纸」也默认开到已经装过的实例上。
   * 带持久化标记，只跑一次；之后用户在设置里的开关不会被覆盖。
   */
  applyRandomBgDefaultOnce() {
    if (this.randomBgDefaultApplied) {
      return;
    }
    runInAction(() => {
      this.randomBgDefaultApplied = true;
      this.randomHomeBg = true;
    });
  }

  setShowDownloadEntry(v: boolean) {
    runInAction(() => {
      this.showDownloadEntry = v;
    });
  }

  /** 关键色：传 null 恢复主题默认 */
  setKeyColor(color: string | null) {
    runInAction(() => {
      this.keyColor = color;
    });
  }

  /** 光效（流动高光带）开关 */
  setSheenEffect(v: boolean) {
    runInAction(() => {
      this.sheenEffect = v;
    });
  }

  setFrosted(v: boolean) {
    runInAction(() => {
      this.frosted = v;
    });
  }

  /**
   * 一次性迁移：把「磨砂」也默认开到已经装过的实例上。
   * 带持久化标记，只跑一次；之后用户在设置里的开关不会被覆盖。
   */
  applyFrostedDefaultOnce() {
    if (this.frostedDefaultApplied) {
      return;
    }
    runInAction(() => {
      this.frostedDefaultApplied = true;
      this.frosted = true;
    });
  }

  setDisplayMemUsage(value: boolean) {
    runInAction(() => {
      this.displayMemUsage = value;
    });
  }

  setiOSBackgroundDownloading(value: boolean) {
    runInAction(() => {
      this.iOSBackgroundDownloading = value;
    });
  }

  setBenchmarkShareDialogPreference(shouldShow: boolean) {
    runInAction(() => {
      this.benchmarkShareDialog.shouldShow = shouldShow;
    });
  }

  setOnboardingStep(step: OnboardingStep) {
    runInAction(() => {
      this.onboardingState.currentStep = step;
    });
  }

  setOnboardingTopic(key: TopicKey | null) {
    runInAction(() => {
      this.onboardingState.selectedTopic = key;
    });
  }

  setOnboardingModelId(modelId: string | null) {
    runInAction(() => {
      this.onboardingState.selectedModelId = modelId;
    });
  }

  completeOnboarding({
    topic,
    modelId: _modelId,
  }: {
    topic: TopicKey | null;
    modelId: string | null;
  }) {
    runInAction(() => {
      this.hasCompletedOnboarding = true;
      // Persisted snapshot stays as `TopicKey[]` for multi-tag headroom.
      // Derive from the new scalar: null → [], else [topic].
      this.onboardingTopicsSnapshot = topic === null ? [] : [topic];
      this.onboardingState = {...INITIAL_ONBOARDING_STATE};
    });
  }

  // Test / E2E only — callers MUST gate with `__DEV__ || __E2E__`.
  resetOnboarding() {
    runInAction(() => {
      this.hasCompletedOnboarding = false;
      this.onboardingTopicsSnapshot = [];
      this.onboardingState = {...INITIAL_ONBOARDING_STATE};
    });
  }

  // User-triggered replay (About → Show intro again). Re-enters the flow
  // without nuking the persisted topic snapshot; the user's next finish
  // will overwrite it. Distinct from `resetOnboarding` (dev/E2E nuke).
  replayOnboarding() {
    runInAction(() => {
      this.hasCompletedOnboarding = false;
      this.onboardingState = {...INITIAL_ONBOARDING_STATE};
    });
  }

  isDownloadBannerDismissed(modelId: string): boolean {
    return this.dismissedDownloadIds.includes(modelId);
  }

  dismissDownloadBanner(modelId: string) {
    runInAction(() => {
      if (!this.dismissedDownloadIds.includes(modelId)) {
        this.dismissedDownloadIds.push(modelId);
      }
    });
  }

  clearDownloadBannerDismissal(modelId: string) {
    runInAction(() => {
      this.dismissedDownloadIds = this.dismissedDownloadIds.filter(
        id => id !== modelId,
      );
    });
  }
}

export const uiStore = new UIStore();
