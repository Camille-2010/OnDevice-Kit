import 'react-native-gesture-handler/jestSetup';
import mockClipboard from '@react-native-clipboard/clipboard/jest/clipboard-mock.js';

import 'react-native-gesture-handler/jestSetup';

// __E2E__ is a build-time constant in prod/e2e builds (see babel.config.js),
// but in Jest the transform-define plugin is disabled so it stays a runtime
// global. Default to true so adapter tests render their components; tests
// that assert the DCE gate override with `(global as any).__E2E__ = false`.
(global as any).__E2E__ = true;
// Onboarding bypass flag: default off in Jest so the AutomationBridge
// adapter renders but no-ops; tests that need the bypass-on path override
// with `(global as any).__E2E_SKIP_ONBOARDING__ = true`.
(global as any).__E2E_SKIP_ONBOARDING__ = false;

jest.mock('react-native-haptic-feedback');

jest.mock('react-native-keyboard-controller', () => {
  const KeyboardControllerMock = require('react-native-keyboard-controller/jest');
  return KeyboardControllerMock;
});

// Mock react-native-reanimated
//require('react-native-reanimated').setUpTests();
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');

  Reanimated.default.call = () => {};

  Reanimated.useReducedMotion = jest.fn(() => false);

  Reanimated.useSharedValue = jest.fn(() => ({value: 0}));
  Reanimated.useAnimatedStyle = jest.fn(() => ({}));
  Reanimated.useAnimatedScrollHandler = jest.fn(() => ({}));
  Reanimated.useAnimatedProps = jest.fn(() => ({}));
  Reanimated.useAnimatedGestureHandler = jest.fn(() => ({}));
  Reanimated.withTiming = jest.fn(() => ({}));
  Reanimated.withSpring = jest.fn(() => ({}));
  Reanimated.cancelAnimation = jest.fn();

  Reanimated.default.createAnimatedComponent = (Component: any) => Component;

  return Reanimated;
});

jest.mock('@react-navigation/elements', () => ({
  ...jest.requireActual('@react-navigation/elements'),
  useHeaderHeight: jest.fn().mockReturnValue(56), // Provide a mock return value
}));

import {mockUiStore} from '../__mocks__/stores/uiStore';
import {mockHFStore} from '../__mocks__/stores/hfStore';
import {mockModelStore} from '../__mocks__/stores/modelStore';
import {
  mockChatSessionStore,
  mockDefaultCompletionSettings,
} from '../__mocks__/stores/chatSessionStore';
import {benchmarkStore as mockBenchmarkStore} from '../__mocks__/stores/benchmarkStore';
import {mockPalStore} from '../__mocks__/stores/palStore';
import {deepLinkStore as mockDeepLinkStore} from '../__mocks__/stores/deepLinkStore';
import {mockServerStore} from '../__mocks__/stores/serverStore';
import {mockTTSStore} from '../__mocks__/stores/ttsStore';
import {mockSearchProviderStore} from '../__mocks__/stores/searchProviderStore';
import {mockPurchaseStore} from '../__mocks__/stores/purchaseStore';

jest.mock('@react-native-clipboard/clipboard', () => mockClipboard);

jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter');

// Mock NativeHardwareInfo TurboModule
jest.mock('../src/specs/NativeHardwareInfo', () => ({
  __esModule: true,
  default: {
    getCPUInfo: jest.fn(() => Promise.resolve({cores: 4})),
    getGPUInfo: jest.fn(() =>
      Promise.resolve({
        renderer: 'Mock GPU',
        vendor: 'Mock Vendor',
        version: 'Mock Version',
        hasAdreno: false,
        hasMali: false,
        hasPowerVR: false,
        supportsOpenCL: false,
        gpuType: 'Mock GPU',
      }),
    ),
    getChipset: jest.fn(() => Promise.resolve('Mock Chipset')),
    getAvailableMemory: jest.fn(() => Promise.resolve(3 * 1000 * 1000 * 1000)), // 3GB
    writeMemorySnapshot: jest.fn((label: string) =>
      Promise.resolve({label, status: 'written'}),
    ),
    purgeNativeAllocator: jest.fn(() =>
      Promise.resolve({purged: true, rss_kb_before: 0, rss_kb_after: 0}),
    ),
  },
}));

jest.mock('react-native-safe-area-context', () => {
  const inset = {top: 0, right: 0, bottom: 0, left: 0};
  const actual = jest.requireActual('react-native-safe-area-context');
  const React = require('react');
  return {
    ...actual,
    // SafeAreaProvider 不能只做透传：@react-navigation/stack 的 StackView
    // 直接读 SafeAreaInsetsContext.Consumer，透传会让它拿到 null →
    // CardStack 在 insets.top 上崩。这里真的把零 insets 提供出去。
    SafeAreaProvider: jest.fn(({children}: {children: any}) =>
      React.createElement(
        actual.SafeAreaInsetsContext.Provider,
        {value: inset},
        children,
      ),
    ),
    SafeAreaConsumer: jest.fn(({children}: any) => children(inset)),
    useSafeAreaInsets: jest.fn(() => inset),
    useSafeAreaFrame: jest.fn(() => ({x: 0, y: 0, width: 390, height: 844})),
  };
});

jest.mock('../src/store', () => {
  const {UIStore} = require('../__mocks__/stores/uiStore');
  return {
    modelStore: mockModelStore,
    UIStore,
    uiStore: mockUiStore,
    chatSessionStore: mockChatSessionStore,
    hfStore: mockHFStore,
    benchmarkStore: mockBenchmarkStore,
    palStore: mockPalStore,
    deepLinkStore: mockDeepLinkStore,
    serverStore: mockServerStore,
    ttsStore: mockTTSStore,
    searchProviderStore: mockSearchProviderStore,
    purchaseStore: mockPurchaseStore,
    defaultCompletionSettings: mockDefaultCompletionSettings,
    // 云端对话 store：默认「未启用、未配置」→ ready=false，
    // 这样既有测试继续走本地推理路径；需要测云端时可在用例里改写 ready。
    apiStore: {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      ready: false,
      setEnabled: jest.fn(),
      setBaseUrl: jest.fn(),
      setApiKey: jest.fn(),
      setModel: jest.fn(),
    },
    cloudTTSStore: {
      enabled: false,
      baseUrl: '',
      apiKey: '',
      model: '',
      voice: '',
      speed: 1,
      setEnabled: jest.fn(),
      setBaseUrl: jest.fn(),
      setApiKey: jest.fn(),
      setModel: jest.fn(),
      setVoice: jest.fn(),
      setSpeed: jest.fn(),
    },
    imageGenStore: {
      serverUrl: '',
      enhanceCloudUrl: '',
      enhanceCloudKey: '',
      setServerUrl: jest.fn(),
      setEnhanceCloudUrl: jest.fn(),
      setEnhanceCloudKey: jest.fn(),
      probe: jest.fn(),
    },
  };
});

jest.mock('../src/hooks/useTheme', () => {
  const {themeFixtures} = require('./fixtures/theme');
  return {
    useTheme: jest.fn().mockReturnValue(themeFixtures.lightTheme),
  };
});

jest.mock('../src/hooks/useMemoryCheck', () => ({
  useMemoryCheck: jest.fn().mockReturnValue({
    memoryWarning: '',
    shortMemoryWarning: '',
    multimodalWarning: '',
  }),
  hasEnoughMemory: jest.fn().mockResolvedValue(true),
  isHighEndDevice: jest.fn().mockResolvedValue(true),
}));

jest.mock('../src/services/downloads', () => ({
  downloadManager: require('../__mocks__/services/downloads').downloadManager,
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid-12345' + Math.random(),
}));

jest.mock('../src/repositories/ChatSessionRepository', () => ({
  chatSessionRepository:
    require('../__mocks__/repositories/ChatSessionRepository')
      .chatSessionRepository,
}));

jest.mock('../src/utils/keepAwake', () => ({
  activateKeepAwake: jest.fn(),
  deactivateKeepAwake: jest.fn(),
}));

jest.mock('react-native-share', () => ({
  default: jest.fn(),
}));

jest.mock('react-native-image-picker');
jest.mock('react-native-vision-camera');

jest.mock('../src/database', () => {
  return {
    database: require('../__mocks__/database').mockDatabase,
  };
});

jest.mock('../src/services', () => {
  return require('../__mocks__/services');
});

// src/specs/* 是 codegen TurboModule：模块加载阶段就 getEnforcing 原生模块，
// Jest 环境没有原生二进制。有些测试（如 DownloadManager.test）在
// NativeModules.DownloadModule 层做 mock，真实 spec 能透传过去；而全量渲染
// App 的链路（App → screens/index → VoiceChangeScreen → audioRecorder）
// 没有任何原生模块可解析，getEnforcing 会在 import 时抛。
// 所以这里「先试真实模块，失败才退化」——工厂里 requireActual 同名字面量，
// 失败则换成「任意方法都是 jest.fn()」的代理。
// （jest.mock 的路径参数必须是字面量才能正确匹配，因此不用循环变量拼路径。）
const nativeSpecProxyFactory = () =>
  new Proxy(
    {},
    {
      get: (target: Record<string, unknown>, prop: string | symbol) => {
        if (typeof prop !== 'string' || prop === '__proto__') {
          return undefined;
        }
        if (!(prop in target)) {
          target[prop] = jest.fn();
        }
        return target[prop];
      },
    },
  );

jest.mock('../src/specs/NativeAudioRecorder', () => {
  try {
    return jest.requireActual('../src/specs/NativeAudioRecorder');
  } catch {
    return {__esModule: true, default: nativeSpecProxyFactory()};
  }
});
jest.mock('../src/specs/NativeContentUri', () => {
  try {
    return jest.requireActual('../src/specs/NativeContentUri');
  } catch {
    return {__esModule: true, default: nativeSpecProxyFactory()};
  }
});
jest.mock('../src/specs/NativeDownloadModule', () => {
  try {
    return jest.requireActual('../src/specs/NativeDownloadModule');
  } catch {
    return {__esModule: true, default: nativeSpecProxyFactory()};
  }
});
jest.mock('../src/specs/NativeHardwareInfo', () => {
  try {
    return jest.requireActual('../src/specs/NativeHardwareInfo');
  } catch {
    return {__esModule: true, default: nativeSpecProxyFactory()};
  }
});
jest.mock('../src/specs/NativeKeepAwake', () => {
  try {
    return jest.requireActual('../src/specs/NativeKeepAwake');
  } catch {
    return {__esModule: true, default: nativeSpecProxyFactory()};
  }
});
