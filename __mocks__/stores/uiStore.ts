import {makeAutoObservable} from 'mobx';
import {l10n, supportedLanguages} from '../../src/locales';

export class UIStore {
  static readonly GROUP_KEYS = {
    READY_TO_USE: 'ready_to_use',
    AVAILABLE_TO_DOWNLOAD: 'available_to_download',
  } as const;
}

export const mockUiStore = {
  colorScheme: 'light',
  autoNavigatetoChat: false,
  benchmarkShareDialog: {
    shouldShow: true,
  },
  pageStates: {
    modelsScreen: {
      filters: [],
      expandedGroups: {
        [UIStore.GROUP_KEYS.READY_TO_USE]: true,
      },
    },
  },
  language: 'en',
  supportedLanguages: [...supportedLanguages],
  l10n: l10n.en,
  // 真实 store 的 setValue 会写 pageStates[page][key]；mock 也要真写，
  // 否则 ModelsScreen 的 toggleGroup 等依赖 setValue 持久化路径的交互
  // 在测试里永远不生效（jest.fn() 只记录不落盘）。
  setValue: jest.fn((page: string, key: string, value: unknown) => {
    (mockUiStore.pageStates as any)[page] =
      (mockUiStore.pageStates as any)[page] ?? {};
    (mockUiStore.pageStates as any)[page][key] = value;
  }),
  displayMemUsage: false,
  themeStyle: 'rounded',
  // —— 壁纸 / 液态玻璃相关（App 的 getCurrentPageBackground、玻璃组件直接读取；
  // 缺字段会让 Math.floor(undefined*len)=NaN → 取不到壁纸 → 渲染崩）——
  homeBgIndex: 0,
  randomHomeBg: false, // mock 固定第 1 张壁纸，行为确定
  sessionBgSeed: 0.5,
  randomBgDefaultApplied: true,
  setHomeBgIndex: jest.fn(),
  setRandomHomeBg: jest.fn(),
  // App 挂载/hydration 后的一次性默认值迁移（见 App.tsx useEffect）
  applyUiDefaultsOnce: jest.fn(),
  applyRandomBgDefaultOnce: jest.fn(),
  applyFrostedDefaultOnce: jest.fn(),
  acceptDisclaimer: jest.fn(),
  sheenEffect: true,
  frosted: true,
  frostedDefaultApplied: true,
  keyColor: '#297CF2',
  uiDefaultsApplied: true,
  _language: 'en',
  disclaimerAccepted: true,
  showDownloadEntry: true,
  screenEpoch: 0,
  // Entrance 按页面 key 取各自的 epoch；mock 里给个空 Map 即可
  // （缺字段会让 Entrance 读 .get 时直接抛
  //  "Cannot read properties of undefined"）
  screenEpochByKey: new Map<string, number>(),
  replayScreenEnter: jest.fn(),
  replayScreenEnterForKey: jest.fn(),
  setAutoNavigateToChat: jest.fn(),
  setColorScheme: jest.fn(),
  setThemeStyle: jest.fn(),
  setDisplayMemUsage: jest.fn(),
  setBenchmarkShareDialogPreference: jest.fn(),
  showError: jest.fn(),
  setChatWarning: jest.fn(),
  clearChatWarning: jest.fn(),
  toolCompatWarnedModels: [] as string[],
  hasWarnedToolCompat: jest.fn(() => false),
  markToolCompatWarned: jest.fn(),
  hasCompletedOnboarding: true,
  onboardingTopicsSnapshot: [] as string[],
  onboardingState: {
    currentStep: 1 as 1 | 2 | 3 | 4 | 5 | 6,
    selectedTopic: null as string | null,
    selectedModelId: null as string | null,
  },
  setOnboardingStep: jest.fn(),
  setOnboardingTopic: jest.fn(),
  setOnboardingModelId: jest.fn(),
  completeOnboarding: jest.fn(),
  resetOnboarding: jest.fn(),
  replayOnboarding: jest.fn(),
  dismissedDownloadIds: [] as string[],
  isDownloadBannerDismissed: jest.fn(() => false),
  dismissDownloadBanner: jest.fn(),
  clearDownloadBannerDismissal: jest.fn(),
};

// 组件普遍是 observer 包裹、直接读 uiStore.xxx；mock 必须是真正的
// MobX observable，否则测试里的交互写入（setValue/toggleGroup）不会
// 触发重渲染，断言永远看到旧树。
// jest.fn 方法用 overrides 排除：makeAutoObservable 会把函数包装成
// action，包装后的函数不再是 jest.Mock，测试里
// expect(uiStore.setChatWarning).toHaveBeenCalled() 就会失效。
const overrides: Record<string, false> = {};
for (const [key, value] of Object.entries(mockUiStore)) {
  if (typeof value === 'function' && 'mock' in (value as any)) {
    overrides[key] = false;
  }
}
makeAutoObservable(mockUiStore, overrides);
