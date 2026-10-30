import React, {useState, useEffect, useRef, useContext} from 'react';
import {AppIcon, AppIconName} from '../../components/AppIcon';
import {BackButton} from '../../components/BackButton';
import {Entrance} from '../../components/Entrance';
import {
  HEADER_EXTRA,
  HEADER_HEIGHT,
  buttonRing,
  dialogGlassTint,
} from '../../theme/cards';
import {PAGE_BACKGROUNDS, getPageBackground} from '../../theme/pageBackgrounds';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';
import {
  Animated,
  Easing,
  View,
  Image,
  Platform,
  FlatList,
  TouchableWithoutFeedback,
  Keyboard,
  Modal,
  TextInput as RNTextInput,
  Alert,
  Linking,
  TouchableOpacity,
  BackHandler,
  useWindowDimensions,
} from 'react-native';

import {debounce} from 'lodash';
import {observer} from 'mobx-react-lite';
import {toJS} from 'mobx';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import {useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {
  Switch,
  Text,
  Card,
  Icon,
  List,
  SegmentedButtons,
} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';

import {CpuChipIcon, ShareIcon, LinkExternalIcon} from '../../assets/icons';

import {
  TextInput,
  Menu,
  HFTokenSheet,
  SearchProviderKeySheet,
  InputSlider,
  RemoteModelSheet,
} from '../../components';
import {AuthSheet} from '../../components/PalsHub';
import {PurchasesCard} from './PurchasesCard';

import {useTheme} from '../../hooks';

import {createStyles} from './styles';
import {CacheTypeMenuRow, useMenuAnchor} from './CacheTypeMenuRow';
import {Popover} from '../../components/Popover';

import {
  apiStore,
  modelStore,
  uiStore,
  hfStore,
  ttsStore,
  cloudTTSStore,
  imageGenStore,
  searchProviderStore,
  serverStore,
  purchaseStore,
} from '../../store';
import {authService} from '../../services';
import type {SearchProviderId} from '../../services/search/types';

import {CacheType, ModelType} from '../../utils/types';
import {
  L10nContext,
  formatBytes,
  clearAllSessionCaches,
  getSessionCacheInfo,
} from '../../utils';
import {AvailableLanguage, languageDisplayNames, t} from '../../locales';
import {checkGpuSupport} from '../../utils/deviceCapabilities';
import {exportLegacyChatSessions} from '../../utils/exportUtils';
import {getDeviceOptions, DeviceOption} from '../../utils/deviceSelection';
import {
  inferBackendType,
  getAllowedCacheTypeKOptions,
  getAllowedCacheTypeVOptions,
} from '../../utils/flashAttnCompatibility';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {motionTiming, motionSpring} from '../../utils/disableMotion';
import {SurfaceCard, GlassTextField} from '../../components/GlassSurface';
import {PillLabel} from '../../components/PillLabel';
import {verifyHfToken} from '../../api/hf';

type SettingsSubPage =
  | 'list'
  | 'appearance'
  | 'home-bg'
  | 'speech'
  | 'model'
  | 'memory'
  | 'loading'
  | 'search'
  | 'api'
  | 'account'
  | 'data'
  | 'layout';

// OpenCL documentation URL (not localized)
const OPENCL_DOCS_URL =
  'https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md#model-preparation';

/**
 * 轻量探测一个 OpenAI 兼容服务是否可达、鉴权是否通过。
 * 打 `GET /v1/models`（地址已带 /v1 时不再重复拼），只用来做「测试连接」，
 * 不会发送任何对话内容或密钥以外的数据。
 */
async function probeOpenAiService(
  baseUrl: string,
  apiKey: string,
): Promise<{ok: boolean; message: string}> {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) {
    return {ok: false, message: '请先填写服务地址'};
  }
  const key = apiKey.trim();
  const url = /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: key ? {Authorization: `Bearer ${key}`} : {},
      signal: controller.signal,
    });
    if (res.ok) {
      return {ok: true, message: '连接成功，服务可用'};
    }
    if (res.status === 401 || res.status === 403) {
      return {ok: false, message: `鉴权失败（${res.status}），请检查 API Key`};
    }
    return {ok: false, message: `服务端返回 ${res.status}（地址可能不对）`};
  } catch {
    return {ok: false, message: '连不上服务，请检查地址与网络'};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 「AI 服务」页专用输入框：比默认输入框更磨砂。
 * 0.7 底色 + 真实模糊 + forceFrosted（嵌在玻璃卡片里，原生玻璃路径会
 * 采样不到背景而渲染成透明，必须强制走磨砂路径，blur 才会真正生效）。
 */
const FrostedInput: React.FC<
  React.ComponentProps<typeof GlassTextField>
> = props => <GlassTextField tintOpacity={0.7} blur forceFrosted {...props} />;

/**
 * 二级页转场的「地板透明度」：切换时内容只压暗到这里，绝不淡到 0。
 * 淡到 0 会整页露出底色（浅色主题 = #FAF9FF），就是「白屏闪一下」。
 */
const SUBPAGE_FADE_FLOOR = 0.45;

// 关键色（应用强调色）可选值；null = 用主题默认那套蓝
const KEY_COLORS: {value: string | null; label: string}[] = [
  {value: null, label: '默认'},
  {value: '#297CF2', label: '蓝'},
  {value: '#10B981', label: '绿'},
  {value: '#8B5CF6', label: '紫'},
  {value: '#F59E0B', label: '橙'},
  {value: '#EC4899', label: '粉'},
  {value: '#EF4444', label: '红'},
];

// 界面风格可选值（点击后弹出选择器）
const STYLE_OPTIONS: {
  value: 'standard' | 'rounded' | 'liquid-glass';
  label: string;
  desc: string;
}[] = [
  {
    value: 'standard',
    label: '标准',
    desc: 'Material Design 观感',
  },
  {
    value: 'rounded',
    label: 'MIUIX',
    desc: 'MiUIX（HyperOS风格）',
  },
  {
    // 之前 UIStore 支持但这里没列出来，用户在设置里选不到液态玻璃
    value: 'liquid-glass',
    label: '液态玻璃',
    desc: '真·原生模糊与折射',
  },
];

/**
 * 各选择器面板共用的动效：入场 spring + 退场 timing。
 * 所有界面风格下都生效（之前只在 MIUIX 下播放，标准风格下完全没动画）。
 */
const usePickerAnim = (visible: boolean) => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      return;
    }
    anim.setValue(0);
    // iOS 27 风格：用物理弹簧参数（damping / stiffness / mass），
    // 冲得快、收得稳，不会像 speed/bounciness 那样在结尾抖一下
    motionSpring(anim, {
      toValue: 1,
      damping: 17,
      stiffness: 240,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const close = React.useCallback(
    (done: () => void) => {
      motionTiming(anim, {
        toValue: 0,
        duration: 170,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(done);
    },
    [anim],
  );

  return {anim, close};
};

export const SettingsScreen: React.FC = observer(() => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  // ⚠️ 判断的是「是不是 standard」而不是「是不是 rounded」——
  // 液态玻璃风格的几何必须与 MIUIX 完全一致（玻璃只改表面质感，不改尺寸），
  // 写成 `=== 'rounded'` 的话，选液态玻璃时设置页自己的内边距/字号会退回 Material，与 MIUIX 不符。
  const styles = createStyles(theme, uiStore.themeStyle !== 'standard');
  const isRounded = uiStore.themeStyle !== 'standard';
  // 小标题是否在「液态玻璃」下渲染成玻璃胶囊：与 SurfaceCard 的判定一致
  // （只有真正的液态玻璃才会出真玻璃；标准 / MIUIX 下保持原来的「蓝杠 + 文字」）。
  const isLiquidGlass = uiStore.themeStyle === 'liquid-glass';

  // 分组小标题：液态玻璃下是玻璃胶囊，其余风格保持原样（蓝杠 + 加粗文字）。
  // 玻璃胶囊和上下的大玻璃卡片之间留足间距（marginTop/marginBottom），
  // 否则两块玻璃会糊成一片、分不清层级。
  const renderGroupTitle = (title: string) =>
    isLiquidGlass ? (
      <PillLabel radius={14} style={styles.glassSectionTitle}>
        <View style={styles.glassSectionTitleInner}>
          <View style={styles.glassSectionTitleMarker} />
          <Text style={styles.glassSectionTitleText}>{title}</Text>
        </View>
      </PillLabel>
    ) : (
      <View style={styles.groupHeading}>
        <View style={styles.groupMarker} />
        <Text style={styles.groupTitle}>{title}</Text>
      </View>
    );

  // 卡片内的小标题（如「搜索服务供应商」「API 密钥」「结果数」）：在液态玻璃下
  // 也渲染成玻璃胶囊，但间距比卡片之间的大标题更紧凑，避免把控件挤散。
  const renderSectionLabel = (title: string) =>
    isLiquidGlass ? (
      <PillLabel radius={12} style={styles.glassSectionLabel}>
        <View style={styles.glassSectionTitleInner}>
          <View style={styles.glassSectionTitleMarker} />
          <Text style={styles.glassSectionTitleText}>{title}</Text>
        </View>
      </PillLabel>
    ) : (
      <Text variant="titleMedium" style={styles.textLabel}>
        {title}
      </Text>
    );
  const isFocused = useIsFocused();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  // 只有作为 Drawer 的「设置」路由时才需要管它自带的标题栏
  const isDrawerRoute = route.name === 'Settings';
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [showKeyColorPicker, setShowKeyColorPicker] = useState(false);

  // 语言选项：中文永远排第一位
  const languageOptions = React.useMemo(() => {
    const langs = [...uiStore.supportedLanguages].sort((a, b) =>
      a === 'zh' ? -1 : b === 'zh' ? 1 : 0,
    );
    return langs.map(lang => ({
      value: lang,
      label: languageDisplayNames[lang],
    }));
  }, []);

  // 语言面板要贴在「界面语言」那一行的下拉箭头正下方，
  // 所以先把那一行的位置量出来，再按 measured 的 top/right 绝对定位。
  const {width: winWidth} = useWindowDimensions();
  // 「当前效果」预览：contain 完整显示整图（不裁切），框高按图片真实比例自适应
  const [bgLoadedAspect, setBgLoadedAspect] = useState<number | undefined>(
    undefined,
  );
  const langRowRef = useRef<View>(null);
  const [langAnchor, setLangAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);

  const openLanguagePicker = () => {
    const node = langRowRef.current;
    if (!node) {
      setShowLanguagePicker(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setLangAnchor({
        // 弹窗顶部在整行正下方
        top: y + h,
        right: Math.max(8, winWidth - (x + w)),
      });
      setShowLanguagePicker(true);
    });
  };

  // 两个选择器共用同一套动效（见文件上方 usePickerAnim）
  const langPicker = usePickerAnim(showLanguagePicker);
  const closeLanguagePicker = React.useCallback(() => {
    langPicker.close(() => setShowLanguagePicker(false));
  }, [langPicker]);

  // 「界面风格」的锚点与动效：和语言选择器完全一致
  const styleRowRef = useRef<View>(null);
  // 用 undefined 而不是 null：Popover 的 anchorPosition 只接受 {top,right} | undefined
  const [styleAnchor, setStyleAnchor] = useState<
    | {
        top: number;
        right: number;
      }
    | undefined
  >(undefined);
  const stylePicker = usePickerAnim(showStylePicker);

  const openStylePicker = () => {
    const node = styleRowRef.current;
    if (!node) {
      setShowStylePicker(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setStyleAnchor({
        top: y + h,
        right: Math.max(8, winWidth - (x + w)),
      });
      setShowStylePicker(true);
    });
  };

  const closeStylePicker = React.useCallback(() => {
    stylePicker.close(() => setShowStylePicker(false));
  }, [stylePicker]);

  // 「关键色」的锚点与动效：和语言/风格选择器完全一致
  const keyColorRowRef = useRef<View>(null);
  const [keyColorAnchor, setKeyColorAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const keyColorPicker = usePickerAnim(showKeyColorPicker);

  const openKeyColorPicker = () => {
    const node = keyColorRowRef.current;
    if (!node) {
      setShowKeyColorPicker(true);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setKeyColorAnchor({
        top: y + h - 30,
        right: Math.max(8, winWidth - (x + w)),
      });
      setShowKeyColorPicker(true);
    });
  };

  const closeKeyColorPicker = React.useCallback(() => {
    keyColorPicker.close(() => setShowKeyColorPicker(false));
  }, [keyColorPicker]);

  // 语言列表右侧的划动指示标：滚动时淡入、松手 0.5s 后淡出
  const langScrollY = useRef(new Animated.Value(0)).current;
  const langIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const [langScroll, setLangScroll] = useState({view: 0, content: 0});

  const langIndicatorHeight =
    langScroll.content > langScroll.view && langScroll.view > 0
      ? Math.max(26, (langScroll.view / langScroll.content) * langScroll.view)
      : 0;

  const showLangIndicator = () => {
    motionTiming(langIndicatorOpacity, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };
  const hideLangIndicator = () => {
    motionTiming(langIndicatorOpacity, {
      toValue: 0,
      duration: 300,
      delay: 500,
      useNativeDriver: true,
    }).start();
  };

  const [contextSize, setContextSize] = useState(
    modelStore.contextInitParams.n_ctx.toString(),
  );
  const [isValidInput, setIsValidInput] = useState(true);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  // 设置页二级导航：list = 一级列表，其余为各分组详情页
  const [subPage, setSubPage] = useState<SettingsSubPage>('list');
  // 「AI 服务 → 远程模型服务器」的添加弹窗
  const [showRemoteModelSheet, setShowRemoteModelSheet] = useState(false);
  const transitionOpacity = useRef(new Animated.Value(1)).current;
  const transitionX = useRef(new Animated.Value(0)).current;

  useEffect(
    () => () => {
      transitionOpacity.stopAnimation();
      transitionX.stopAnimation();
    },
    [transitionOpacity, transitionX],
  );

  const goSubPage = (p: typeof subPage) => {
    if (p === subPage) {
      return;
    }
    transitionOpacity.stopAnimation();
    transitionX.stopAnimation();
    // 透明度只降到 SUBPAGE_FADE_FLOOR，不降到 0：
    // 降到 0 的那一帧整页内容消失、露出底色（浅色主题 #FAF9FF），
    // 就是「进二级页先闪一下白屏」的来源。留一点内容在，
    // 观感变成「压暗一下再弹回来」。
    transitionOpacity.setValue(SUBPAGE_FADE_FLOOR);
    transitionX.setValue(p === 'list' ? -18 : 18);
    setSubPage(p);
    scrollRef.current?.scrollTo({y: 0, animated: false});
    // 通知 Entrance 重播：进二级页时列表区块要有入场动画。
    // 只重播设置页自己（'settings'）—— 全局广播会让其它页面几十个区块
    // 同时起动画，看起来就是「动画播了两遍」而且还很卡。
    uiStore.replayScreenEnter('settings');
    // 先让出一帧，等 React 把新的二级页提交并布局完，再开始淡入。
    // 不让帧的话 native 侧拿到的还是旧布局，第一帧会闪一下 —— 这就是
    // 「进设置二级页顿一下」的来源。
    requestAnimationFrame(() => {
      Animated.parallel([
        motionTiming(transitionOpacity, {
          toValue: 1,
          duration: 170,
          // 必须 false：上面刚 setValue(SUBPAGE_FADE_FLOOR) 过，
          // 混用原生驱动会抛 "has been moved to native"，动画不执行、
          // 内容永久停在压暗且偏移的位置（进设置二级页就再也不动了）。
          useNativeDriver: false,
        }),
        motionSpring(transitionX, {
          toValue: 0,
          speed: 22,
          bounciness: 3,
          useNativeDriver: false,
        }),
      ]).start();
    });
  };

  // ── 深链进入二级页 ──
  // 别的页面可以用 navigation.navigate(ROUTES.SETTINGS, {subPage: 'api'})
  // 直接落到某个二级页（如「对话」顶栏的云端按钮 → AI 服务）。
  // 用完立刻把参数清掉：否则从二级页返回设置列表时 params 还在，
  // 每次渲染都会再触发一次，把用户强行拽回那个二级页。
  const deepLinkSubPage = (
    route.params as {subPage?: SettingsSubPage} | undefined
  )?.subPage;
  React.useEffect(() => {
    if (!deepLinkSubPage || deepLinkSubPage === 'list') {
      return;
    }
    goSubPage(deepLinkSubPage);
    navigation.setParams({subPage: undefined});
    // goSubPage 是渲染期新建的普通函数，不能进依赖；只需要在
    // 「目标子页」变化时触发一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkSubPage]);

  // KeyboardAwareScrollView 的 ref 就是 ScrollView 实例
  const scrollRef =
    useRef<React.ElementRef<typeof KeyboardAwareScrollView>>(null);
  const detailTitles: Record<string, string> = {
    appearance: '外观',
    'home-bg': '页面背景',
    speech: '语音',
    model: '模型',
    memory: '内存',
    loading: '模型加载',
    search: '联网搜索',
    api: 'AI 服务',
    account: '账户与安全',
    data: '数据',
    layout: '布局',
  };
  const inputRef = useRef<RNTextInput>(null);
  const keyCacheMenu = useMenuAnchor();
  const valueCacheMenu = useMenuAnchor();
  const draftKeyCacheMenu = useMenuAnchor();
  const draftValueCacheMenu = useMenuAnchor();
  const [showDraftModelMenu, setShowDraftModelMenu] = useState(false);
  const [showHfTokenDialog, setShowHfTokenDialog] = useState(false);
  const [showAuthSheet, setShowAuthSheet] = useState(false);
  const [showSearchProviderMenu, setShowSearchProviderMenu] = useState(false);

  // 测试 HuggingFace 令牌有效性（whoami-v2）
  const [testingToken, setTestingToken] = useState(false);
  const [tokenTest, setTokenTest] = useState<{
    ok: boolean;
    username?: string;
    reason?: string;
  } | null>(null);

  const handleTestToken = async () => {
    if (!hfStore.isTokenPresent) {
      return;
    }
    setTestingToken(true);
    setTokenTest(null);
    try {
      const res = await verifyHfToken(hfStore.hfToken!);
      if (res.valid) {
        setTokenTest({ok: true, username: res.username});
      } else {
        const reason =
          res.error === 'invalid'
            ? l10n.settings.tokenTestInvalid
            : res.error === 'network' || res.error === 'timeout'
              ? l10n.settings.tokenTestNetwork
              : res.error || l10n.settings.tokenTestFailedMessage;
        setTokenTest({ok: false, reason});
      }
    } catch (e: any) {
      setTokenTest({
        ok: false,
        reason: e?.message || l10n.settings.tokenTestFailedMessage,
      });
    } finally {
      setTestingToken(false);
    }
  };
  // 云端对话 / 云端语音 / 云端图像 的「测试连接」状态
  const [testingChat, setTestingChat] = useState(false);
  const [chatTest, setChatTest] = useState<{ok: boolean; msg: string} | null>(
    null,
  );
  const [testingTts, setTestingTts] = useState(false);
  const [ttsTest, setTtsTest] = useState<{ok: boolean; msg: string} | null>(
    null,
  );
  const [testingImg, setTestingImg] = useState(false);
  const [imgTest, setImgTest] = useState<{ok: boolean; msg: string} | null>(
    null,
  );

  const handleTestChat = async () => {
    setTestingChat(true);
    setChatTest(null);
    const r = await probeOpenAiService(apiStore.baseUrl, apiStore.apiKey);
    setChatTest({ok: r.ok, msg: r.message});
    setTestingChat(false);
  };

  const handleTestTts = async () => {
    setTestingTts(true);
    setTtsTest(null);
    const r = await probeOpenAiService(
      cloudTTSStore.baseUrl,
      cloudTTSStore.apiKey,
    );
    setTtsTest({ok: r.ok, msg: r.message});
    setTestingTts(false);
  };

  const handleTestImage = async () => {
    setTestingImg(true);
    setImgTest(null);
    const r = await imageGenStore.probe();
    setImgTest(
      r.ok
        ? {ok: true, msg: `连接成功，服务端有 ${r.models?.length ?? 0} 个模型`}
        : {ok: false, msg: r.message || '连接失败'},
    );
    setTestingImg(false);
  };

  const [searchProviderAnchor, setSearchProviderAnchor] = useState<{
    x: number;
    y: number;
  }>({x: 0, y: 0});
  const [showSearchKeySheet, setShowSearchKeySheet] = useState(false);
  const searchProviderButtonRef = useRef<View>(null);
  const [gpuSupported, setGpuSupported] = useState(false);
  const [draftModelAnchor, setDraftModelAnchor] = useState<{
    x: number;
    y: number;
  }>({x: 0, y: 0});
  const [deviceOptions, setDeviceOptions] = useState<DeviceOption[]>([]);
  const [currentBackend, setCurrentBackend] = useState<
    'metal' | 'opencl' | 'hexagon' | 'cpu' | 'blas'
  >(Platform.OS === 'ios' ? 'metal' : 'cpu');
  const draftModelButtonRef = useRef<View>(null);
  const debouncedUpdateStore = useRef(
    debounce((value: number) => {
      modelStore.setNContext(value);
    }, 500),
  ).current;

  useEffect(() => {
    setContextSize(modelStore.contextInitParams.n_ctx.toString());

    // Check for GPU support (Metal on iOS 18+, OpenCL on Android with Adreno + CPU features)
    const checkGpuCapabilities = async () => {
      const gpuCapabilities = await checkGpuSupport();
      setGpuSupported(gpuCapabilities.isSupported);
    };

    checkGpuCapabilities().catch(error => {
      console.warn('Failed to check GPU capabilities:', error);
      setGpuSupported(false);
    });

    const loadDeviceOptions = async () => {
      try {
        const options = await getDeviceOptions();
        setDeviceOptions(options);
      } catch (error) {
        console.warn('Failed to load device options:', error);
      }
    };

    loadDeviceOptions();
  }, []);

  // Skipped while the input is focused so the re-sync never fights typing.
  const configuredNCtx = modelStore.contextInitParams.n_ctx;
  useEffect(() => {
    if (isFocused && !inputRef.current?.isFocused()) {
      setContextSize(configuredNCtx.toString());
      setIsValidInput(true);
    }
  }, [isFocused, configuredNCtx]);

  // Convert MobX observable to plain JS for dependency tracking
  const devicesKey = JSON.stringify(toJS(modelStore.contextInitParams.devices));

  useEffect(() => {
    const updateBackend = async () => {
      const backend = await inferBackendType(
        modelStore.contextInitParams.devices,
      );
      setCurrentBackend(backend);
    };

    updateBackend();
  }, [devicesKey]);

  useEffect(() => {
    return () => {
      debouncedUpdateStore.cancel();
    };
  }, [debouncedUpdateStore]);

  // Android 返回键：二级详情页先回一级列表，不直接退出设置
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isFocused && subPage !== 'list') {
        goSubPage('list');
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // goSubPage 每次渲染重建，加进依赖会让 BackHandler 订阅每帧重挂；
    // isFocused/subPage 变化时 effect 本就会重订阅并拿到新闭包。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, subPage]);

  // Android 返回键：弹窗开着时先关最上面那个弹窗，不要直接退回主页。
  // RN 的 Modal / BottomSheet 默认不拦返回键，事件会冒泡到 App 的
  // BackHandler —— 用户实测「弹窗开着按返回，直接回主页了」。
  // 注意注册顺序：本 effect 后注册，所以它先拿到事件，弹窗关完才轮到上面
  // 那个（关二级页）。React 的 effect 清理是反序的，行为符合预期。
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    // 顺序 = 打开先后，后面的盖在上面
    const layers: [boolean, () => void][] = [
      [showKeyColorPicker, () => setShowKeyColorPicker(false)],
      [showLanguagePicker, () => setShowLanguagePicker(false)],
      [showStylePicker, () => setShowStylePicker(false)],
      [showAuthSheet, () => setShowAuthSheet(false)],
      [showSearchKeySheet, () => setShowSearchKeySheet(false)],
      [showHfTokenDialog, () => setShowHfTokenDialog(false)],
    ];
    if (!layers.some(([open]) => open)) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      for (let i = layers.length - 1; i >= 0; i--) {
        if (layers[i][0]) {
          layers[i][1]();
          return true;
        }
      }
      return false;
    });
    return () => sub.remove();
  }, [
    showKeyColorPicker,
    showLanguagePicker,
    showStylePicker,
    showAuthSheet,
    showSearchKeySheet,
    showHfTokenDialog,
  ]);

  // 顶栏统一由页面内的玻璃 SurfaceCard 渲染（主列表 + 子页都是真液态玻璃）；
  // 导航器自带的「实底」顶栏一律隐藏，否则主列表顶部是一条不透明灰条。
  useEffect(() => {
    if (!isDrawerRoute) {
      return;
    }
    navigation.setOptions({headerShown: false});
    return () => navigation.setOptions({headerShown: true});
  }, [isDrawerRoute, navigation]);

  const handleOutsidePress = () => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    setContextSize(modelStore.contextInitParams.n_ctx.toString());
    setIsValidInput(true);
    keyCacheMenu.close();
    valueCacheMenu.close();
    draftKeyCacheMenu.close();
    draftValueCacheMenu.close();
    setShowDraftModelMenu(false);
  };

  const handleContextSizeChange = (text: string) => {
    setContextSize(text);
    const value = parseInt(text, 10);
    if (!isNaN(value) && value >= modelStore.MIN_CONTEXT_SIZE) {
      setIsValidInput(true);
      debouncedUpdateStore(value);
    } else {
      setIsValidInput(false);
    }
  };

  const currentFlashAttnType =
    modelStore.contextInitParams.flash_attn_type ??
    (Platform.OS === 'ios' ? 'auto' : 'off');
  const flashAttnOff =
    !modelStore.contextInitParams.flash_attn_type ||
    modelStore.contextInitParams.flash_attn_type === 'off';

  const cacheTypeKOptions = getAllowedCacheTypeKOptions(
    currentFlashAttnType as 'auto' | 'on' | 'off',
    currentBackend,
  );

  const cacheTypeVOptions = getAllowedCacheTypeVOptions(
    currentFlashAttnType as 'auto' | 'on' | 'off',
    currentBackend,
  );

  const getCacheTypeLabel = (
    value: CacheType | string,
    isValueCache = false,
  ) => {
    const options = isValueCache ? cacheTypeVOptions : cacheTypeKOptions;
    return options.find(option => option.value === value)?.label || value;
  };

  const speculativeEnabled =
    modelStore.contextInitParams.speculativeEnabled ?? false;
  const selectedDraftModelId =
    modelStore.contextInitParams.selectedDraftModelId;

  const activeModelId = modelStore.activeModel?.id;
  const eligibleDraftModels = modelStore.availableModels.filter(
    m =>
      m.isDownloaded &&
      m.modelType !== ModelType.PROJECTION &&
      m.id !== activeModelId,
  );
  const selectedDraftModel = eligibleDraftModels.find(
    m => m.id === selectedDraftModelId,
  );

  const draftMode = modelStore.effectiveDraftMode;
  const showSpeculativeNoEffectNote =
    speculativeEnabled && !!modelStore.activeModel && draftMode === 'off';

  const draftPickIgnoredNote = (() => {
    if (!selectedDraftModel) {
      return undefined;
    }
    const activeDefaultDraft = modelStore.activeModel?.defaultDraftModel;
    if (activeDefaultDraft && activeDefaultDraft !== selectedDraftModel.id) {
      return l10n.settings.speculativeDraftModelIgnoredOverridden;
    }
    if (draftMode === 'paired' || showSpeculativeNoEffectNote) {
      return undefined;
    }
    return modelStore.activeModel
      ? l10n.settings.speculativeDraftModelIgnoredIncompatible
      : l10n.settings.speculativeDraftModelIgnoredNotCapable;
  })();

  // Draft cache compatibility is the draft's own, not the target's flash-attn.
  const draftCacheTypeKOptions = getAllowedCacheTypeKOptions(
    'on',
    currentBackend,
  );
  const draftCacheTypeVOptions = getAllowedCacheTypeVOptions(
    'on',
    currentBackend,
  );
  const getDraftCacheTypeLabel = (
    value: CacheType | string | undefined,
    isValueCache = false,
  ) => {
    const defaults = modelStore.effectiveDraftCacheDefaults;
    const effectiveValue = value ?? (isValueCache ? defaults.v : defaults.k);
    const options = isValueCache
      ? draftCacheTypeVOptions
      : draftCacheTypeKOptions;
    return (
      options.find(option => option.value === effectiveValue)?.label ||
      effectiveValue
    );
  };

  const getCurrentDeviceId = (): string => {
    const devices = modelStore.contextInitParams.devices;
    const nGpuLayers = modelStore.contextInitParams.n_gpu_layers ?? 0;

    // iOS
    if (Platform.OS === 'ios') {
      if (!devices || devices.length === 0) {
        return nGpuLayers === 0 ? 'cpu' : 'auto';
      }
      if (devices[0] === 'Metal') {
        return 'gpu';
      }
      if (devices[0] === 'CPU') {
        return 'cpu';
      }
      return 'auto';
    }

    // Android
    // No auto mode on Android - always explicit device selection
    if (!devices || devices.length === 0 || devices[0] === 'CPU') {
      return 'cpu';
    }

    if (devices[0].startsWith('HTP')) {
      return 'hexagon';
    }

    // GPU device (Adreno, etc.)
    return 'gpu';
  };

  const handleDeviceSelect = (option: DeviceOption) => {
    modelStore.setDevices(option.devices);

    // Only update flash attention if current value is not valid for the selected device
    const currentFlashAttn =
      modelStore.contextInitParams.flash_attn_type ??
      (Platform.OS === 'ios' ? 'auto' : 'off');

    if (!option.valid_flash_attn_types.includes(currentFlashAttn)) {
      // Current setting is invalid for this device, use the default
      modelStore.setFlashAttnType(option.default_flash_attn_type);
    }
    // Otherwise, keep the user's current flash attention preference
  };

  const handleDraftModelPress = () => {
    draftModelButtonRef.current?.measure(
      (x, y, width, height, pageX, pageY) => {
        setDraftModelAnchor({x: pageX, y: pageY + height});
        setShowDraftModelMenu(true);
      },
    );
  };

  const handleSearchProviderPress = () => {
    searchProviderButtonRef.current?.measure(
      (x, y, width, height, pageX, pageY) => {
        setSearchProviderAnchor({x: pageX, y: pageY + height});
        setShowSearchProviderMenu(true);
      },
    );
  };

  const activeSearchProvider = searchProviderStore.providers.find(
    p => p.id === searchProviderStore.activeProviderId,
  );
  const activeSearchProviderId = searchProviderStore.activeProviderId;
  const activeRequiresKey = searchProviderStore.activeProviderRequiresKey;
  const searchHasConsent = searchProviderStore.hasConsentedToSearch;
  const settingsSections: {
    title: string;
    rows: {
      id: string;
      title: string;
      description: string;
      icon: AppIconName;
      color: string;
      route: SettingsSubPage;
      value?: string;
    }[];
  }[] = [
    {
      title: '外观',
      rows: [
        {
          id: 'language',
          title: '界面语言',
          description: '不跟随系统语言，仅在此切换',
          icon: 'translate',
          color: '#8B5CF6',
          route: 'appearance',
          value: languageDisplayNames[uiStore.language],
        },
        {
          id: 'theme',
          title: '主题',
          description: '选择应用主题模式与配色',
          icon: 'palette',
          color: '#1E6FEB',
          route: 'appearance',
          value:
            uiStore.colorScheme === 'system'
              ? '跟随系统'
              : uiStore.colorScheme === 'dark'
                ? '深色'
                : '浅色',
        },
        {
          id: 'style',
          title: '界面风格',
          description: '',
          icon: 'shape',
          color: '#F59E0B',
          route: 'appearance',
          value:
            uiStore.themeStyle === 'standard'
              ? '标准（Material）'
              : uiStore.themeStyle === 'liquid-glass'
                ? '液态玻璃'
                : 'MIUIX（HyperOS 风格）',
        },
        {
          id: 'home-background',
          title: '页面背景',
          description: '预览、切换页面背景',
          icon: 'image',
          color: '#EC4899',
          route: 'home-bg',
        },
      ],
    },
    {
      // 从「外观」里单独分出来的一组
      title: '语音',
      rows: [
        {
          id: 'tts',
          title: '文本转语音',
          description: '朗读助手回复',
          icon: 'tts',
          color: '#8B5CF6',
          route: 'speech',
        },
      ],
    },
    {
      title: '模型',
      rows: [
        {
          id: 'model',
          title: '模型初始化设置',
          description: '设备选择、上下文长度与高级参数',
          icon: 'models',
          color: '#1E6FEB',
          route: 'model',
        },
        {
          id: 'memory',
          title: '内存',
          description: '内存锁定、内存映射与缓存',
          icon: 'memory',
          color: '#10B981',
          route: 'memory',
        },
        {
          id: 'loading',
          title: '模型加载',
          description: '自动卸载与加载后的页面跳转',
          icon: 'download',
          color: '#F59E0B',
          route: 'loading',
        },
      ],
    },
    {
      title: '服务与账户',
      rows: [
        {
          id: 'api',
          title: 'AI 服务',
          description: '云端对话、语音、图像、搜索与令牌',
          icon: 'cloud',
          color: '#3B82F6',
          route: 'api',
        },
        {
          id: 'account',
          title: '账户与安全',
          description: 'Hugging Face 访问令牌',
          icon: 'key',
          color: '#64748B',
          route: 'account',
        },
      ],
    },
    {
      title: '数据与布局',
      rows: [
        {
          id: 'data',
          title: '数据管理',
          description: '导出旧版聊天会话',
          icon: 'database',
          color: '#EC4899',
          route: 'data',
        },
        {
          id: 'layout',
          title: '资源下载按钮',
          description: '主页显示模型下载入口',
          icon: 'box',
          color: '#14B8A6',
          route: 'layout',
          value: uiStore.showDownloadEntry ? '开启' : '关闭',
        },
      ],
    },
  ];

  // 下载当前背景图：dev 下资源走 http（Metro 服务），release 下是本地文件。
  // 优先复制/下载到系统下载目录；失败时退回系统分享（可存到相册）。
  // 「当前效果」预览按图片自身比例展示（整图完整、不裁成大头）。
  // 「当前效果」预览要和首页**同一张」：随机开启时用启动种子算同一张，否则用选中的那张。
  const currentBgIndex = uiStore.randomHomeBg
    ? Math.floor(uiStore.sessionBgSeed * PAGE_BACKGROUNDS.length)
    : uiStore.homeBgIndex;
  const currentPageBg = getPageBackground(currentBgIndex);
  // 预览框严格跟随图片自身比例：aspectRatio = 宽/高，
  // 这样 contain 时整图恰好满框、零灰边；竖图自然更高（预览更大）。
  // 先用 resolve 的元数据（dev/release 均可），图片 onLoad 后再用真实尺寸校正。
  const currentPageBgResolved = Image.resolveAssetSource(currentPageBg.source);
  const currentPageBgAspect =
    bgLoadedAspect ??
    (currentPageBgResolved?.width && currentPageBgResolved?.height
      ? currentPageBgResolved.width / currentPageBgResolved.height
      : 9 / 16);

  const downloadCurrentBg = async () => {
    const opt = getPageBackground(uiStore.homeBgIndex);
    const src = Image.resolveAssetSource(opt.source);
    const fname = `page_bg_${Date.now()}.jpg`;
    const dest = `${RNFS.DownloadDirectoryPath}/${fname}`;
    try {
      if (src.uri.startsWith('http')) {
        const res = await RNFS.downloadFile({
          fromUrl: src.uri,
          toFile: dest,
        }).promise;
        if (res.statusCode && res.statusCode >= 400) {
          throw new Error(`HTTP ${res.statusCode}`);
        }
      } else {
        await RNFS.copyFile(src.uri.replace(/^file:\/\//, ''), dest);
      }
      try {
        (RNFS as any).scanFile?.(dest);
      } catch {
        // 媒体扫描失败不影响文件已落盘
      }
      Alert.alert('已下载', `已保存到：\n${dest}`, [
        {
          text: '分享',
          onPress: () =>
            Share.open({
              url: `file://${dest}`,
              type: 'image/jpeg',
              failOnCancel: false,
            }),
        },
        {text: '好'},
      ]);
    } catch (e) {
      try {
        await Share.open({
          url: src.uri,
          type: 'image/jpeg',
          failOnCancel: false,
        });
      } catch {
        Alert.alert('下载失败', String(e));
      }
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <Animated.View
        style={[
          styles.contentTransition,
          {
            opacity: transitionOpacity,
            transform: [{translateX: transitionX}],
          },
        ]}>
        {/* 顶栏：主列表与子页统一用玻璃 SurfaceCard（液态玻璃模式下是真玻璃）。
          主列表无返回键、标题左对齐；子页带返回键。 */}
        <SurfaceCard
          scaleOnAnyTouch
          style={[
            styles.subHeader,
            // 与主屏幕顶部栏同一套尺寸：
            // 高度 = 状态栏高度(仅 Drawer 路由) + 基准高度 + 向下加长
            {
              height:
                HEADER_HEIGHT + (isDrawerRoute ? insets.top : 0) + HEADER_EXTRA,
              paddingTop: isDrawerRoute ? insets.top : 0,
              paddingBottom: HEADER_EXTRA,
            },
          ]}>
          {subPage !== 'list' && (
            <BackButton onPress={() => goSubPage('list')} />
          )}
          <Text style={styles.subHeaderTitle}>
            {subPage === 'list'
              ? l10n.screenTitles.settings
              : detailTitles[subPage]}
          </Text>
          <View style={styles.subHeaderSpacer} />
        </SurfaceCard>
        <TouchableWithoutFeedback
          onPress={handleOutsidePress}
          accessible={false}>
          <KeyboardAwareScrollView
            ref={scrollRef}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled">
            {subPage === 'list' && (
              <>
                <Entrance index={0} screenKey="settings">
                  <SurfaceCard scaleOnAnyTouch style={styles.accountCard}>
                    <View style={styles.accountAvatar}>
                      <Icon
                        source="account-circle-outline"
                        size={30}
                        color={theme.colors.secondary}
                      />
                    </View>
                    <View style={styles.accountTextWrap}>
                      <Text style={styles.accountName}>本地 AI 用户</Text>
                      <Text style={styles.accountMeta}>
                        本地离线 · 云端可选
                      </Text>
                    </View>
                    <Icon
                      source="chevron-right"
                      size={22}
                      color={theme.colors.onSurfaceVariant}
                    />
                  </SurfaceCard>
                </Entrance>

                {settingsSections.map((section, sIdx) => (
                  <Entrance
                    key={section.title}
                    index={sIdx + 1}
                    screenKey="settings">
                    <View>
                      {renderGroupTitle(section.title)}
                      <SurfaceCard scaleOnAnyTouch style={styles.settingsGroup}>
                        {section.rows.map((row, index) => (
                          <React.Fragment key={row.id}>
                            <TouchableOpacity
                              ref={
                                row.id === 'language'
                                  ? langRowRef
                                  : row.id === 'style'
                                    ? styleRowRef
                                    : undefined
                              }
                              style={styles.entryRow}
                              testID={`settings-entry-${row.id}`}
                              onPress={() => {
                                // 这两个都不跳二级页，直接在原地弹出选择器
                                if (row.id === 'style') {
                                  openStylePicker();
                                  return;
                                }
                                if (row.id === 'language') {
                                  openLanguagePicker();
                                  return;
                                }
                                goSubPage(row.route);
                              }}
                              accessibilityRole="button">
                              <View style={styles.entryIconPlain}>
                                <AppIcon
                                  name={row.icon}
                                  size={25}
                                  color={theme.colors.onSurface}
                                  strokeWidth={1.6}
                                />
                              </View>
                              <View style={styles.entryTextWrap}>
                                <Text style={styles.entryTitle}>
                                  {row.title}
                                </Text>
                                {row.description ? (
                                  <Text
                                    style={styles.entryDesc}
                                    numberOfLines={2}>
                                    {row.description}
                                  </Text>
                                ) : null}
                              </View>
                              {row.value ? (
                                <Text style={styles.entryValue}>
                                  {row.value}
                                </Text>
                              ) : null}
                              <Icon
                                source={
                                  row.id === 'style' || row.id === 'language'
                                    ? 'chevron-down'
                                    : 'chevron-right'
                                }
                                size={22}
                                color={theme.colors.onSurfaceVariant}
                              />
                            </TouchableOpacity>
                            {!isRounded && index < section.rows.length - 1 ? (
                              <View style={styles.groupDivider} />
                            ) : null}
                          </React.Fragment>
                        ))}
                      </SurfaceCard>
                    </View>
                  </Entrance>
                ))}
              </>
            )}
            {/* 分组：外观 */}
            {subPage === 'home-bg' && (
              <>
                {/* 外观 */}
                {renderGroupTitle('外观')}

                <SurfaceCard scaleOnAnyTouch style={styles.settingsGroup}>
                  <View style={styles.entryRow}>
                    <View style={styles.entryIconPlain}>
                      <AppIcon
                        name="spark"
                        size={24}
                        color={theme.colors.onSurface}
                        strokeWidth={1.6}
                      />
                    </View>
                    <View style={styles.entryTextWrap}>
                      <Text style={styles.entryTitle}>随机背景</Text>
                      <Text style={styles.entryDesc} numberOfLines={2}>
                        每次进入首页随机显示一张背景图
                      </Text>
                    </View>
                    <Switch
                      value={uiStore.randomHomeBg}
                      onValueChange={v => uiStore.setRandomHomeBg(v)}
                    />
                  </View>

                  <View style={styles.groupDivider} />

                  <TouchableOpacity
                    style={styles.entryRow}
                    accessibilityRole="button"
                    onPress={() => {
                      uiStore.setRandomHomeBg(false);
                      uiStore.setHomeBgIndex(0);
                    }}>
                    <View style={styles.entryIconPlain}>
                      <AppIcon
                        name="back"
                        size={24}
                        color={theme.colors.onSurface}
                        strokeWidth={1.6}
                      />
                    </View>
                    <View style={styles.entryTextWrap}>
                      <Text style={styles.entryTitle}>恢复默认背景</Text>
                      <Text style={styles.entryDesc} numberOfLines={2}>
                        清除选择，回到默认背景图
                      </Text>
                    </View>
                    <Icon
                      source="chevron-right"
                      size={22}
                      color={theme.colors.onSurfaceVariant}
                    />
                  </TouchableOpacity>

                  <View style={styles.groupDivider} />

                  <TouchableOpacity
                    style={styles.entryRow}
                    accessibilityRole="button"
                    onPress={downloadCurrentBg}>
                    <View style={styles.entryIconPlain}>
                      <AppIcon
                        name="download"
                        size={24}
                        color={theme.colors.onSurface}
                        strokeWidth={1.6}
                      />
                    </View>
                    <View style={styles.entryTextWrap}>
                      <Text style={styles.entryTitle}>下载当前图片</Text>
                      <Text style={styles.entryDesc} numberOfLines={2}>
                        保存当前背景图到手机下载目录
                      </Text>
                    </View>
                    <Icon
                      source="chevron-right"
                      size={22}
                      color={theme.colors.onSurfaceVariant}
                    />
                  </TouchableOpacity>
                </SurfaceCard>

                {/* 可选背景 */}
                {renderGroupTitle('可选背景')}

                <FlatList
                  horizontal
                  data={PAGE_BACKGROUNDS}
                  keyExtractor={opt => opt.key}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.bgThumbRow}
                  initialNumToRender={8}
                  windowSize={5}
                  removeClippedSubviews
                  renderItem={({item: opt, index: i}) => {
                    const active =
                      !uiStore.randomHomeBg && uiStore.homeBgIndex === i;
                    return (
                      <SurfaceCard
                        scaleOnAnyTouch
                        activeOpacity={0.85}
                        onPress={() => {
                          uiStore.setRandomHomeBg(false);
                          uiStore.setHomeBgIndex(i);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{selected: active}}
                        style={[
                          styles.bgThumbCard,
                          active
                            ? {
                                borderColor: theme.colors.secondary,
                                borderWidth: 2,
                              }
                            : null,
                        ]}>
                        <Image
                          source={opt.source}
                          style={styles.bgThumb}
                          resizeMode="cover"
                        />
                        {active ? (
                          <View
                            style={[
                              styles.bgThumbCheck,
                              {backgroundColor: theme.colors.secondary},
                            ]}>
                            <AppIcon
                              name="check"
                              size={12}
                              color="#FFFFFF"
                              strokeWidth={2.6}
                            />
                          </View>
                        ) : null}
                      </SurfaceCard>
                    );
                  }}
                />

                {/* 当前效果 */}
                {renderGroupTitle('当前效果')}

                <View
                  style={[
                    styles.bgEffectWrap,
                    {aspectRatio: currentPageBgAspect},
                  ]}>
                  <Image
                    source={currentPageBg.source}
                    style={styles.bgEffectImg}
                    resizeMode="contain"
                    onLoad={e => {
                      const {width, height} = e.nativeEvent.source;
                      if (width && height) setBgLoadedAspect(width / height);
                    }}
                  />
                </View>
              </>
            )}

            {subPage === 'appearance' && (
              <>
                <PillLabel radius={16} style={styles.glassPageTitle}>
                  <Text style={styles.glassPageTitleText}>主题</Text>
                </PillLabel>

                <SurfaceCard
                  noPressScale
                  style={[
                    styles.themePreview,
                    {
                      backgroundColor: theme.dark ? '#0F172A' : '#F7F8FC',
                      borderColor: theme.colors.outlineVariant,
                      borderWidth: isLiquidGlass ? 0 : 1,
                    },
                  ]}>
                  <View style={styles.themePreviewHeader}>
                    <View style={styles.themePreviewBrand}>
                      <Image
                        source={require('../../assets/ondevice-kit-logo.png')}
                        style={styles.themePreviewBrandMark}
                        resizeMode="contain"
                      />
                      <Text
                        style={[
                          styles.themePreviewBrandText,
                          {color: theme.colors.onSurface},
                        ]}>
                        OnDevice Kit
                      </Text>
                    </View>
                    <Icon
                      source="cog-outline"
                      size={17}
                      color={theme.colors.onSurfaceVariant}
                    />
                  </View>
                  <View style={styles.themePreviewMain}>
                    <View
                      style={[
                        styles.themePreviewCard,
                        {backgroundColor: theme.colors.surface},
                      ]}>
                      <View style={styles.themePreviewCardTop}>
                        <View
                          style={[
                            styles.themePreviewAvatar,
                            {backgroundColor: theme.colors.secondaryContainer},
                          ]}
                        />
                        <View style={styles.themePreviewLines}>
                          <View
                            style={[
                              styles.themePreviewLine,
                              {backgroundColor: theme.colors.onSurface},
                            ]}
                          />
                          <View
                            style={[
                              styles.themePreviewLineShort,
                              {backgroundColor: theme.colors.onSurfaceVariant},
                            ]}
                          />
                        </View>
                      </View>
                      <View
                        style={[
                          styles.themePreviewWideLine,
                          {backgroundColor: theme.colors.surfaceVariant},
                        ]}
                      />
                      <View
                        style={[
                          styles.themePreviewButton,
                          {backgroundColor: theme.colors.primary},
                        ]}
                      />
                    </View>
                    <View
                      style={[
                        styles.themePreviewSideCard,
                        {backgroundColor: theme.colors.surface},
                      ]}>
                      <View
                        style={[
                          styles.themePreviewSideLine,
                          {backgroundColor: theme.colors.secondary},
                        ]}
                      />
                      <View
                        style={[
                          styles.themePreviewSideLine,
                          {backgroundColor: theme.colors.surfaceVariant},
                        ]}
                      />
                      <View
                        style={[
                          styles.themePreviewSideLine,
                          {backgroundColor: theme.colors.surfaceVariant},
                        ]}
                      />
                    </View>
                  </View>
                </SurfaceCard>

                {/* 主题模式：独立卡片（去掉灰底，只保留方格 + 选中效果） */}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={[styles.card, styles.cardTransparent]}>
                  <Card.Content style={styles.themeModeCardContent}>
                    <View style={styles.segOuterBox}>
                      {(
                        [
                          {value: 'system', label: '跟随系统'},
                          {value: 'light', label: '浅色'},
                          {value: 'dark', label: '深色'},
                        ] as const
                      ).map(opt => {
                        const active = uiStore.colorScheme === opt.value;
                        return (
                          <TouchableOpacity
                            key={opt.value}
                            style={[
                              styles.segBtn,
                              active && styles.segBtnActive,
                            ]}
                            onPress={() => uiStore.setColorScheme(opt.value)}
                            activeOpacity={0.6}>
                            <Text
                              style={[
                                styles.segBtnText,
                                active && styles.segBtnTextActive,
                              ]}>
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </Card.Content>
                </SurfaceCard>

                {/* 关键色 / 光效（行距收紧，卡片更扁） */}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContentCompact}>
                    <View style={styles.settingItemContainer}>
                      {/* 关键色：点击弹出取色面板 */}
                      <TouchableOpacity
                        ref={keyColorRowRef}
                        style={[
                          styles.switchContainer,
                          styles.switchContainerCompact,
                        ]}
                        onPress={openKeyColorPicker}
                        accessibilityRole="button">
                        <View style={styles.labelWithIconContainer}>
                          <View style={styles.settingIcon}>
                            <Icon
                              source="palette-outline"
                              size={17}
                              color={theme.colors.onSurface}
                            />
                          </View>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            关键色
                          </Text>
                        </View>
                        <View style={styles.keyColorValueWrap}>
                          <View
                            style={[
                              styles.keyColorDot,
                              {
                                backgroundColor:
                                  uiStore.keyColor ?? theme.colors.secondary,
                              },
                            ]}
                          />
                          <Text
                            variant="labelLarge"
                            style={styles.styleValueText}>
                            {uiStore.keyColor
                              ? (KEY_COLORS.find(
                                  c => c.value === uiStore.keyColor,
                                )?.label ?? '自定义')
                              : '默认'}
                          </Text>
                          <Icon
                            source="chevron-down"
                            size={17}
                            color={theme.colors.onSurfaceVariant}
                          />
                        </View>
                      </TouchableOpacity>

                      {/* 光效 */}
                      <View
                        style={[
                          styles.switchContainer,
                          styles.switchContainerCompact,
                        ]}>
                        <View style={styles.textContainer}>
                          <View style={styles.labelWithIconContainer}>
                            <View style={styles.settingIcon}>
                              <Icon
                                source="creation"
                                size={17}
                                color={theme.colors.onSurface}
                              />
                            </View>
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              光效
                            </Text>
                          </View>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            点击光效会应用在整个软件上；顶栏和底栏都会叠加
                            缓慢流动的高光带
                          </Text>
                        </View>
                        <Switch
                          testID="sheen-effect-switch"
                          value={uiStore.sheenEffect}
                          onValueChange={v => uiStore.setSheenEffect(v)}
                        />
                      </View>

                      {/* 磨砂（毛玻璃）背景 */}
                      <View
                        style={[
                          styles.switchContainer,
                          styles.switchContainerCompact,
                        ]}>
                        <View style={styles.textContainer}>
                          <View style={styles.labelWithIconContainer}>
                            <View style={styles.settingIcon}>
                              <Icon
                                source="image-outline"
                                size={17}
                                color={theme.colors.onSurface}
                              />
                            </View>
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              磨砂
                            </Text>
                          </View>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {uiStore.themeStyle === 'rounded'
                              ? '开启后首页叠加半透明顶栏与卡片（毛玻璃）；关闭则恢复实底'
                              : '仅在「界面风格 → MIUIX」下生效，切换为 MIUIX 后即可开启'}
                          </Text>
                        </View>
                        <Switch
                          testID="frosted-switch"
                          value={uiStore.frosted}
                          disabled={uiStore.themeStyle !== 'rounded'}
                          onValueChange={v => uiStore.setFrosted(v)}
                        />
                      </View>

                      {/* Display Memory Usage (iOS only) */}
                      {Platform.OS === 'ios' && (
                        <>
                          <View style={styles.switchContainer}>
                            <View style={styles.textContainer}>
                              <View style={styles.labelWithIconContainer}>
                                <CpuChipIcon
                                  width={20}
                                  height={20}
                                  style={styles.settingIcon}
                                  stroke={theme.colors.onSurface}
                                />
                                <Text
                                  variant="titleMedium"
                                  style={styles.textLabel}>
                                  {l10n.settings.displayMemoryUsage}
                                </Text>
                              </View>
                              <Text
                                variant="labelSmall"
                                style={styles.textDescription}>
                                {l10n.settings.displayMemoryUsageDescription}
                              </Text>
                            </View>
                            <Switch
                              testID="display-memory-usage-switch"
                              value={uiStore.displayMemUsage}
                              onValueChange={value =>
                                uiStore.setDisplayMemUsage(value)
                              }
                            />
                          </View>
                        </>
                      )}
                    </View>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}

            {/* 分组：语音（从「外观」里分出来的独立二级页） */}
            {subPage === 'speech' && (
              <>
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.speechCardContent}>
                    <View style={styles.speechItemContainer}>
                      {/* Text-to-speech availability toggle */}
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <View style={styles.labelWithIconContainer}>
                            <View style={styles.settingIcon}>
                              <Icon
                                source="volume-high"
                                size={17}
                                color={theme.colors.onSurface}
                              />
                            </View>
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              {l10n.settings.ttsAvailability}
                            </Text>
                          </View>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {l10n.settings.ttsAvailabilityDescription}
                          </Text>
                          {!ttsStore.deviceMeetsMemory && (
                            <Text
                              variant="labelSmall"
                              style={styles.textDescription}>
                              {l10n.settings.ttsAvailabilityLowMemoryWarning}
                            </Text>
                          )}
                        </View>
                        <Switch
                          testID="tts-availability-switch"
                          value={
                            ttsStore.userTTSOverride ??
                            ttsStore.deviceMeetsMemory
                          }
                          onValueChange={value =>
                            ttsStore.setUserTTSOverride(value)
                          }
                        />
                      </View>
                    </View>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}

            {/* 分组：模型 */}
            {subPage === 'model' && (
              <>
                {/* 页面内的「模型」分组标题和卡片标题「模型初始化设置」都去掉了：
              顶部栏本来就有「模型」，同一屏里重复两遍只是白占三行；
              去掉之后整页内容自然往上顶了一截。 */}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={[styles.card, styles.modelInitCard]}>
                  <Card.Content style={styles.modelInitCardContent}>
                    {/* Device Selection */}

                    <View style={styles.modelInitItemContainer}>
                      {/* Show full UI when multiple device options available */}
                      {deviceOptions.length > 1 ? (
                        <>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {Platform.OS === 'ios'
                              ? l10n.settings.deviceSelectionIOS
                              : l10n.settings.deviceSelection}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.modelInitDescription}>
                            {Platform.OS === 'ios'
                              ? l10n.settings.deviceSelectionIOSDescription
                              : l10n.settings.deviceSelectionAndroidDescription}
                          </Text>
                          <SegmentedButtons
                            value={getCurrentDeviceId()}
                            onValueChange={deviceId => {
                              const option = deviceOptions.find(
                                opt => opt.id === deviceId,
                              );
                              if (option) {
                                handleDeviceSelect(option);
                              }
                            }}
                            density="medium"
                            buttons={deviceOptions.map(option => ({
                              value: option.id,
                              label: option.label,
                              labelStyle: {
                                fontSize: 10,
                              },
                              testID: `device-option-${option.id}`,
                            }))}
                            style={styles.segmentedButtons}
                          />

                          {/* GPU Layers Slider */}
                          <InputSlider
                            testID="gpu-layers-slider"
                            value={modelStore.contextInitParams.n_gpu_layers}
                            onValueChange={value =>
                              modelStore.setNGPULayers(Math.round(value))
                            }
                            min={0}
                            max={99}
                            step={1}
                          />
                          <Text
                            variant="labelSmall"
                            style={styles.modelInitDescription}>
                            {t(l10n.settings.layersOnGPU, {
                              gpuLayers:
                                modelStore.contextInitParams.n_gpu_layers.toString(),
                            })}
                          </Text>
                        </>
                      ) : (
                        /* Simplified UI when only CPU available */
                        <>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {l10n.settings.deviceSelection}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.modelInitDescription}>
                            {l10n.settings.cpuOnlyNoAccelerators}
                          </Text>
                        </>
                      )}

                      {/* OpenCL quantization note for Android */}
                      {Platform.OS === 'android' &&
                        gpuSupported &&
                        (modelStore.contextInitParams.n_gpu_layers ?? 0) >
                          0 && (
                          <View>
                            <Text
                              variant="labelSmall"
                              style={styles.modelInitDescription}>
                              {l10n.settings.openCLQuantizationNote}
                            </Text>
                            <TouchableOpacity
                              onPress={() => Linking.openURL(OPENCL_DOCS_URL)}
                              style={styles.linkContainer}>
                              <Text
                                variant="labelSmall"
                                style={[
                                  styles.modelInitDescription,
                                  {color: theme.colors.primary},
                                ]}>
                                {l10n.settings.openCLDocsLink}
                              </Text>
                              <LinkExternalIcon
                                width={12}
                                height={12}
                                stroke={theme.colors.primary}
                                style={styles.linkIcon}
                              />
                            </TouchableOpacity>
                          </View>
                        )}
                    </View>

                    {/* Context Size */}
                    <View style={styles.modelInitItemContainer}>
                      <Text variant="titleMedium" style={styles.textLabel}>
                        {l10n.settings.contextSize}
                      </Text>
                      <TextInput
                        ref={inputRef}
                        testID="context-size-input"
                        style={[
                          styles.textInput,
                          !isValidInput && styles.invalidInput,
                        ]}
                        keyboardType="numeric"
                        value={contextSize}
                        onChangeText={handleContextSizeChange}
                        placeholder={t(l10n.settings.contextSizePlaceholder, {
                          minContextSize:
                            modelStore.MIN_CONTEXT_SIZE.toString(),
                        })}
                      />
                      {!isValidInput && (
                        <Text style={styles.errorText}>
                          {t(l10n.settings.invalidContextSizeError, {
                            minContextSize:
                              modelStore.MIN_CONTEXT_SIZE.toString(),
                          })}
                        </Text>
                      )}
                      <Text
                        variant="labelSmall"
                        style={styles.modelInitDescription}>
                        {l10n.settings.modelReloadNotice}
                      </Text>
                    </View>

                    {/* Advanced Settings */}
                    <List.Accordion
                      testID="advanced-settings-accordion"
                      title={l10n.settings.advancedSettings}
                      titleStyle={styles.accordionTitle}
                      theme={{
                        ...theme,
                        colors: {...theme.colors, background: 'transparent'},
                      }}
                      style={styles.advancedAccordion}
                      expanded={showAdvancedSettings}
                      onPress={() =>
                        setShowAdvancedSettings(!showAdvancedSettings)
                      }>
                      <View style={styles.advancedSettingsContent}>
                        {/* Batch Size Slider */}
                        <View style={styles.modelInitItemContainer}>
                          <InputSlider
                            testID="batch-size-slider"
                            label={l10n.settings.batchSize}
                            value={modelStore.contextInitParams.n_batch}
                            onValueChange={value =>
                              modelStore.setNBatch(Math.round(value))
                            }
                            min={1}
                            max={4096}
                            step={1}
                          />
                          <Text
                            variant="labelSmall"
                            style={styles.modelInitDescription}>
                            {t(l10n.settings.batchSizeDescription, {
                              batchSize:
                                modelStore.contextInitParams.n_batch.toString(),
                              effectiveBatch:
                                modelStore.contextInitParams.n_batch >
                                modelStore.contextInitParams.n_ctx
                                  ? ` (${l10n.settings.effectiveLabel}: ${modelStore.contextInitParams.n_ctx})`
                                  : '',
                            })}
                          </Text>
                        </View>

                        {/* Physical Batch Size Slider */}
                        <View style={styles.modelInitItemContainer}>
                          <InputSlider
                            testID="ubatch-size-slider"
                            label={l10n.settings.physicalBatchSize}
                            value={modelStore.contextInitParams.n_ubatch}
                            onValueChange={value =>
                              modelStore.setNUBatch(Math.round(value))
                            }
                            min={1}
                            max={4096}
                            step={1}
                          />
                          <Text
                            variant="labelSmall"
                            style={styles.modelInitDescription}>
                            {t(l10n.settings.physicalBatchSizeDescription, {
                              physicalBatchSize:
                                modelStore.contextInitParams.n_ubatch.toString(),
                              effectivePhysicalBatch:
                                modelStore.contextInitParams.n_ubatch >
                                Math.min(
                                  modelStore.contextInitParams.n_batch,
                                  modelStore.contextInitParams.n_ctx,
                                )
                                  ? ` (${l10n.settings.effectiveLabel}: ${Math.min(
                                      modelStore.contextInitParams.n_batch,
                                      modelStore.contextInitParams.n_ctx,
                                    )})`
                                  : '',
                            })}
                          </Text>
                        </View>

                        {/* Thread Count Slider */}
                        <View style={styles.modelInitItemContainer}>
                          <InputSlider
                            testID="thread-count-slider"
                            label={l10n.settings.cpuThreads}
                            value={modelStore.contextInitParams.n_threads}
                            onValueChange={value =>
                              modelStore.setNThreads(Math.round(value))
                            }
                            min={1}
                            max={modelStore.max_threads}
                            step={1}
                          />
                          <Text
                            variant="labelSmall"
                            style={styles.modelInitDescription}>
                            {t(l10n.settings.cpuThreadsDescription, {
                              threads:
                                modelStore.contextInitParams.n_threads.toString(),
                              maxThreads: modelStore.max_threads.toString(),
                            })}
                          </Text>
                        </View>

                        {/* Image Max Tokens Slider */}
                        <View style={styles.modelInitItemContainer}>
                          <InputSlider
                            testID="image-max-tokens-slider"
                            label={l10n.settings.imageMaxTokens}
                            value={
                              modelStore.contextInitParams.image_max_tokens ??
                              512
                            }
                            onValueChange={value =>
                              modelStore.setImageMaxTokens(Math.round(value))
                            }
                            min={256}
                            max={4096}
                            step={1}
                          />
                          <Text
                            variant="labelSmall"
                            style={styles.modelInitDescription}>
                            {t(l10n.settings.imageMaxTokensDescription, {
                              tokens: (
                                modelStore.contextInitParams.image_max_tokens ??
                                512
                              ).toString(),
                              effectiveTokens:
                                (modelStore.contextInitParams
                                  .image_max_tokens ?? 512) >
                                modelStore.contextInitParams.n_ctx
                                  ? ` (${l10n.settings.effectiveLabel}: ${modelStore.contextInitParams.n_ctx})`
                                  : '',
                            })}
                          </Text>
                        </View>

                        {/* Flash Attention Type */}
                        <View style={styles.modelInitItemContainer}>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {l10n.settings.flashAttention}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.modelInitDescription}>
                            {Platform.OS === 'ios'
                              ? l10n.settings.flashAttentionIOSDescription
                              : l10n.settings.flashAttentionAndroidDescription}
                          </Text>
                          <SegmentedButtons
                            value={
                              modelStore.contextInitParams.flash_attn_type ??
                              (Platform.OS === 'ios' ? 'auto' : 'off')
                            }
                            onValueChange={value =>
                              modelStore.setFlashAttnType(
                                value as 'auto' | 'on' | 'off',
                              )
                            }
                            density="high"
                            buttons={(() => {
                              const currentDeviceId = getCurrentDeviceId();
                              const currentDevice = deviceOptions.find(
                                opt => opt.id === currentDeviceId,
                              );
                              const validTypes =
                                currentDevice?.valid_flash_attn_types || [
                                  'auto',
                                  'on',
                                  'off',
                                ];

                              return [
                                {
                                  value: 'auto',
                                  label: l10n.settings.flashAttentionAuto,
                                  disabled: !validTypes.includes('auto'),
                                },
                                {
                                  value: 'on',
                                  label: l10n.settings.flashAttentionOn,
                                  disabled: !validTypes.includes('on'),
                                },
                                {
                                  value: 'off',
                                  label: l10n.settings.flashAttentionOff,
                                  disabled: !validTypes.includes('off'),
                                },
                              ];
                            })()}
                            style={styles.segmentedButtons}
                          />
                        </View>

                        <CacheTypeMenuRow
                          menu={keyCacheMenu}
                          styles={styles}
                          testID="key-cache-type-button"
                          label={l10n.settings.keyCacheType}
                          description={
                            flashAttnOff
                              ? l10n.settings.keyCacheTypeDisabledDescription
                              : l10n.settings.keyCacheTypeDescription
                          }
                          value={modelStore.contextInitParams.cache_type_k}
                          valueLabel={getCacheTypeLabel(
                            modelStore.contextInitParams.cache_type_k,
                            false,
                          )}
                          options={cacheTypeKOptions}
                          disabled={flashAttnOff}
                          onSelect={value => modelStore.setCacheTypeK(value)}
                        />

                        <CacheTypeMenuRow
                          menu={valueCacheMenu}
                          styles={styles}
                          testID="value-cache-type-button"
                          label={l10n.settings.valueCacheType}
                          description={
                            flashAttnOff
                              ? l10n.settings.valueCacheTypeDisabledDescription
                              : l10n.settings.valueCacheTypeDescription
                          }
                          value={modelStore.contextInitParams.cache_type_v}
                          valueLabel={getCacheTypeLabel(
                            modelStore.contextInitParams.cache_type_v,
                            true,
                          )}
                          options={cacheTypeVOptions}
                          disabled={flashAttnOff}
                          onSelect={value => modelStore.setCacheTypeV(value)}
                        />

                        {/* Speculative Decoding (draft model) */}
                        {/* 这一项内部套了开关行（和其它页一样是两层），
                      所以用通用的容器样式，间距才和别处一致 */}
                        <View style={styles.settingItemContainer}>
                          <View style={styles.switchContainer}>
                            <View style={styles.textContainer}>
                              <Text
                                variant="titleMedium"
                                style={styles.textLabel}>
                                {l10n.settings.speculativeDecoding}
                              </Text>
                              <Text
                                variant="labelSmall"
                                style={styles.modelInitDescription}>
                                {l10n.settings.speculativeDecodingDescription}
                              </Text>
                            </View>
                            <Switch
                              testID="speculative-decoding-switch"
                              value={speculativeEnabled}
                              accessibilityLabel={
                                l10n.settings.speculativeDecoding
                              }
                              accessibilityHint={
                                l10n.settings.speculativeDecodingDescription
                              }
                              onValueChange={value =>
                                modelStore.setSpeculativeEnabled(value)
                              }
                            />
                          </View>
                          {showSpeculativeNoEffectNote && (
                            <Text
                              variant="labelSmall"
                              style={styles.modelInitDescription}
                              testID="speculative-no-effect-note">
                              {l10n.settings.speculativeNotMTPCapable}
                            </Text>
                          )}
                        </View>

                        {speculativeEnabled && (
                          <>
                            {/* Draft Model Picker: full-row control — model names
                          are too long to share a row with the title. */}
                            <View style={styles.modelInitItemContainer}>
                              <Text
                                variant="titleMedium"
                                style={styles.textLabel}>
                                {l10n.settings.speculativeDraftModel}
                              </Text>
                              <Text
                                variant="labelSmall"
                                style={styles.modelInitDescription}>
                                {l10n.settings.speculativeDraftModelDescription}
                              </Text>
                              <View style={styles.fullRowControl}>
                                <View>
                                  <Button
                                    ref={draftModelButtonRef}
                                    mode="outlined"
                                    onPress={handleDraftModelPress}
                                    style={[
                                      {
                                        borderWidth: 1,
                                        borderColor: buttonRing(theme),
                                      },
                                      styles.menuButton,
                                    ]}
                                    contentStyle={styles.buttonContent}
                                    testID="speculative-draft-model-picker"
                                    accessibilityLabel={`${
                                      l10n.settings.speculativeDraftModel
                                    }, ${
                                      selectedDraftModel?.name ??
                                      l10n.settings.speculativeDraftModelNone
                                    }`}
                                    accessibilityHint={
                                      l10n.settings
                                        .speculativeDraftModelDescription
                                    }
                                    icon={({size, color}) => (
                                      <Icon
                                        source="chevron-down"
                                        size={size}
                                        color={color}
                                      />
                                    )}>
                                    {selectedDraftModel?.name ??
                                      l10n.settings.speculativeDraftModelNone}
                                  </Button>
                                  <Menu
                                    visible={showDraftModelMenu}
                                    onDismiss={() =>
                                      setShowDraftModelMenu(false)
                                    }
                                    anchor={draftModelAnchor}
                                    selectable>
                                    <Menu.Item
                                      style={styles.menu}
                                      label={
                                        l10n.settings.speculativeDraftModelNone
                                      }
                                      selected={!selectedDraftModel}
                                      onPress={() => {
                                        modelStore.setSelectedDraftModel(
                                          undefined,
                                        );
                                        setShowDraftModelMenu(false);
                                      }}
                                    />
                                    {eligibleDraftModels.map(model => (
                                      <Menu.Item
                                        key={model.id}
                                        style={styles.menu}
                                        label={model.name}
                                        selected={
                                          model.id === selectedDraftModel?.id
                                        }
                                        onPress={() => {
                                          modelStore.setSelectedDraftModel(
                                            model.id,
                                          );
                                          setShowDraftModelMenu(false);
                                        }}
                                      />
                                    ))}
                                  </Menu>
                                </View>
                              </View>
                              {draftPickIgnoredNote !== undefined && (
                                <Text
                                  variant="labelSmall"
                                  style={styles.modelInitDescription}
                                  testID="speculative-draft-model-ignored-note">
                                  {draftPickIgnoredNote}
                                </Text>
                              )}
                            </View>

                            {/* Draft GPU Layers Slider */}
                            <View style={styles.modelInitItemContainer}>
                              <Text
                                variant="titleMedium"
                                style={styles.textLabel}>
                                {l10n.settings.speculativeDraftNGpuLayers}
                              </Text>
                              <Text
                                variant="labelSmall"
                                style={styles.modelInitDescription}>
                                {
                                  l10n.settings
                                    .speculativeDraftNGpuLayersDescription
                                }
                              </Text>
                              <InputSlider
                                testID="speculative-draft-gpu-layers-slider"
                                accessibilityLabel={
                                  l10n.settings.speculativeDraftNGpuLayers
                                }
                                value={
                                  modelStore.contextInitParams
                                    .spec_draft_n_gpu_layers ?? 99
                                }
                                onValueChange={value =>
                                  modelStore.setSpecDraftNGpuLayers(
                                    Math.round(value),
                                  )
                                }
                                min={0}
                                max={99}
                                step={1}
                              />
                            </View>

                            <CacheTypeMenuRow
                              menu={draftKeyCacheMenu}
                              styles={styles}
                              testID="speculative-draft-key-cache-button"
                              label={l10n.settings.speculativeDraftKeyCacheType}
                              description={
                                draftMode === 'off'
                                  ? l10n.settings
                                      .speculativeDraftCacheTypeInactiveDescription
                                  : undefined
                              }
                              value={
                                modelStore.contextInitParams
                                  .spec_draft_cache_type_k
                              }
                              valueLabel={getDraftCacheTypeLabel(
                                modelStore.contextInitParams
                                  .spec_draft_cache_type_k,
                                false,
                              )}
                              options={draftCacheTypeKOptions}
                              disabled={draftMode === 'off'}
                              onSelect={value =>
                                modelStore.setSpecDraftCacheTypeK(value)
                              }
                            />

                            <CacheTypeMenuRow
                              menu={draftValueCacheMenu}
                              styles={styles}
                              testID="speculative-draft-value-cache-button"
                              label={
                                l10n.settings.speculativeDraftValueCacheType
                              }
                              description={
                                draftMode === 'off'
                                  ? l10n.settings
                                      .speculativeDraftCacheTypeInactiveDescription
                                  : undefined
                              }
                              value={
                                modelStore.contextInitParams
                                  .spec_draft_cache_type_v
                              }
                              valueLabel={getDraftCacheTypeLabel(
                                modelStore.contextInitParams
                                  .spec_draft_cache_type_v,
                                true,
                              )}
                              options={draftCacheTypeVOptions}
                              disabled={draftMode === 'off'}
                              onSelect={value =>
                                modelStore.setSpecDraftCacheTypeV(value)
                              }
                            />
                          </>
                        )}
                      </View>
                    </List.Accordion>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}
            {/* 分组：内存 */}
            {subPage === 'memory' && (
              <>
                {/* Memory Settings */}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Title title={l10n.settings.memorySettings} />
                  <Card.Content style={styles.cardContent}>
                    <View style={styles.settingItemContainer}>
                      {/* Use Memory Lock */}
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {l10n.settings.useMlock}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {l10n.settings.useMlockDescription}
                          </Text>
                        </View>
                        <Switch
                          testID="use-mlock-switch"
                          value={modelStore.contextInitParams.use_mlock}
                          onValueChange={value => modelStore.setUseMlock(value)}
                        />
                      </View>
                    </View>

                    {/* Memory Mapping */}
                    <View style={styles.settingItemContainer}>
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {l10n.settings.useMmap}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {l10n.settings.useMmapDescription}
                          </Text>
                        </View>
                        <Switch
                          testID="use-mmap-switch"
                          value={
                            modelStore.contextInitParams.use_mmap !== 'false' &&
                            modelStore.contextInitParams.use_mmap !== 'smart'
                          }
                          onValueChange={value =>
                            modelStore.setUseMmap(value ? 'true' : 'false')
                          }
                        />
                      </View>
                    </View>

                    {/* Enable Weight Repacking (Android only) */}
                    {Platform.OS === 'android' && (
                      <View style={styles.settingItemContainer}>
                        <View style={styles.switchContainer}>
                          <View style={styles.textContainer}>
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              {l10n.settings.weightRepacking}
                            </Text>
                            <Text
                              variant="labelSmall"
                              style={styles.textDescription}>
                              {l10n.settings.weightRepackingDescription}
                            </Text>
                          </View>
                          <Switch
                            testID="weight-repacking-switch"
                            value={
                              !(
                                modelStore.contextInitParams.no_extra_bufts ??
                                false
                              )
                            }
                            onValueChange={value =>
                              modelStore.setNoExtraBufts(!value)
                            }
                          />
                        </View>
                      </View>
                    )}

                    <Text variant="labelSmall" style={styles.textDescription}>
                      {l10n.settings.modelReloadNotice}
                    </Text>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}
            {/* 分组：模型加载 */}
            {subPage === 'loading' && (
              <>
                {/* Model Loading Settings */}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Title title={l10n.settings.modelLoadingSettings} />
                  <Card.Content style={styles.cardContent}>
                    <View style={styles.settingItemContainer}>
                      {/* Auto Offload/Load */}
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {l10n.settings.autoOffloadLoad}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {l10n.settings.autoOffloadLoadDescription}
                          </Text>
                        </View>
                        <Switch
                          testID="auto-offload-load-switch"
                          value={modelStore.useAutoRelease}
                          onValueChange={value =>
                            modelStore.updateUseAutoRelease(value)
                          }
                        />
                      </View>

                      {/* Auto Navigate to Chat */}
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {l10n.settings.autoNavigateToChat}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {l10n.settings.autoNavigateToChatDescription}
                          </Text>
                        </View>
                        <Switch
                          testID="auto-navigate-to-chat-switch"
                          value={uiStore.autoNavigatetoChat}
                          onValueChange={value =>
                            uiStore.setAutoNavigateToChat(value)
                          }
                        />
                      </View>
                    </View>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}
            {/* 分组：联网 */}
            {subPage === 'search' && (
              <>
                {/* Internet Search */}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}
                  testID="internet-search-card">
                  {isLiquidGlass ? (
                    <PillLabel radius={16} style={styles.glassPageTitle}>
                      <Text style={styles.glassPageTitleText}>
                        {l10n.settings.internetSearch.title}
                      </Text>
                    </PillLabel>
                  ) : (
                    <Card.Title title={l10n.settings.internetSearch.title} />
                  )}
                  <Card.Content style={styles.cardContent}>
                    <View style={styles.settingItemContainer}>
                      <Text variant="labelSmall" style={styles.textDescription}>
                        {l10n.settings.internetSearch.description}
                      </Text>

                      {/* First-enable consent gate / revoke affordance */}
                      {!searchHasConsent ? (
                        <View
                          testID="internet-search-consent"
                          style={styles.consentContainer}>
                          {renderSectionLabel(
                            l10n.settings.internetSearch.consentTitle,
                          )}
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {l10n.settings.internetSearch.consentDescription}
                          </Text>
                          <Button
                            testID="internet-search-consent-accept"
                            mode="contained"
                            onPress={() => searchProviderStore.setConsent(true)}
                            style={[
                              {borderWidth: 1, borderColor: buttonRing(theme)},
                              styles.consentButton,
                            ]}>
                            {l10n.settings.internetSearch.consentAccept}
                          </Button>
                        </View>
                      ) : (
                        <View
                          testID="internet-search-consent-given"
                          style={styles.consentContainer}>
                          {renderSectionLabel(
                            l10n.settings.internetSearch.consentGivenTitle,
                          )}
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {
                              l10n.settings.internetSearch
                                .consentGivenDescription
                            }
                          </Text>
                          <Button
                            testID="internet-search-consent-revoke"
                            mode="outlined"
                            onPress={() =>
                              searchProviderStore.setConsent(false)
                            }
                            style={[
                              {borderWidth: 1, borderColor: buttonRing(theme)},
                              styles.consentButton,
                            ]}>
                            {l10n.settings.internetSearch.consentRevoke}
                          </Button>
                        </View>
                      )}

                      {/* Provider picker */}
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          {renderSectionLabel(
                            l10n.settings.internetSearch.providerLabel,
                          )}
                        </View>
                        <View style={styles.menuContainer}>
                          <Button
                            ref={searchProviderButtonRef}
                            testID="search-provider-selector-button"
                            mode="outlined"
                            onPress={handleSearchProviderPress}
                            style={[
                              {borderWidth: 1, borderColor: buttonRing(theme)},
                              styles.menuButton,
                            ]}
                            contentStyle={styles.buttonContent}
                            icon={({size, color}) => (
                              <Icon
                                source="chevron-down"
                                size={size}
                                color={color}
                              />
                            )}>
                            {activeSearchProvider?.label ??
                              activeSearchProviderId}
                          </Button>
                          <Menu
                            visible={showSearchProviderMenu}
                            onDismiss={() => setShowSearchProviderMenu(false)}
                            anchor={searchProviderAnchor}
                            selectable>
                            {searchProviderStore.providers.map(provider => (
                              <Menu.Item
                                key={provider.id}
                                testID={`search-provider-option-${provider.id}`}
                                disabled={!provider.selectable}
                                style={styles.menu}
                                label={
                                  provider.selectable
                                    ? provider.label
                                    : `${provider.label} (${l10n.settings.internetSearch.providerGated})`
                                }
                                selected={
                                  provider.id === activeSearchProviderId
                                }
                                onPress={() => {
                                  searchProviderStore.setActiveProvider(
                                    provider.id as SearchProviderId,
                                  );
                                  setShowSearchProviderMenu(false);
                                }}
                              />
                            ))}
                          </Menu>
                        </View>
                      </View>

                      {/* Per-provider BYOK key entry — only for providers that need a key */}
                      {activeRequiresKey && (
                        <View style={styles.switchContainer}>
                          <View style={styles.textContainer}>
                            {renderSectionLabel(
                              l10n.settings.internetSearch.keyLabel,
                            )}
                            <Text
                              variant="labelSmall"
                              style={styles.textDescription}>
                              {searchProviderStore.hasKey(
                                activeSearchProviderId,
                              )
                                ? t(l10n.settings.internetSearch.keyIsSet, {
                                    provider:
                                      activeSearchProvider?.label ??
                                      activeSearchProviderId,
                                  })
                                : t(l10n.settings.internetSearch.keyNotSet, {
                                    provider:
                                      activeSearchProvider?.label ??
                                      activeSearchProviderId,
                                  })}
                            </Text>
                            {!searchHasConsent && (
                              <Text
                                variant="labelSmall"
                                style={styles.textDescription}>
                                {l10n.settings.internetSearch.consentRequired}
                              </Text>
                            )}
                          </View>
                          <Button
                            testID="search-provider-key-button"
                            mode="outlined"
                            disabled={!searchHasConsent}
                            onPress={() => setShowSearchKeySheet(true)}
                            style={[
                              {borderWidth: 1, borderColor: buttonRing(theme)},
                              styles.menuButton,
                            ]}>
                            {searchProviderStore.hasKey(activeSearchProviderId)
                              ? l10n.settings.internetSearch.updateKeyButton
                              : l10n.settings.internetSearch.setKeyButton}
                          </Button>
                        </View>
                      )}

                      {/* Result-count control */}
                      <View style={styles.textContainer}>
                        {renderSectionLabel(
                          l10n.settings.internetSearch.resultCountLabel,
                        )}
                        <InputSlider
                          testID="search-result-count-slider"
                          accessibilityLabel={
                            l10n.settings.internetSearch.resultCountLabel
                          }
                          value={searchProviderStore.resultCount}
                          onValueChange={value =>
                            searchProviderStore.setResultCount(
                              Math.round(value),
                            )
                          }
                          min={1}
                          max={8}
                          step={1}
                        />
                        <Text
                          variant="labelSmall"
                          style={styles.textDescription}>
                          {l10n.settings.internetSearch.resultCountDescription}
                        </Text>
                      </View>
                    </View>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}
            {/* 分组：AI 服务（所有云端能力集中在此） */}
            {subPage === 'api' && (
              <>
                {/* 总说明 */}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <Text style={styles.textDescription}>
                      这里集中管理 OnDevice Kit
                      的所有云端能力。每项都可单独开启；不开启时，对应功能仍使用本地离线能力。开启后，相关请求会把必要数据发送到你填写的服务地址。
                    </Text>
                  </Card.Content>
                </SurfaceCard>

                {/* 云端 AI 对话 */}
                {renderGroupTitle('云端 AI 对话')}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <Text style={styles.textDescription}>
                      兼容 OpenAI 格式的对话接口（DeepSeek / OpenAI /
                      通义千问等）。开启后对话走云端；关闭则用本地模型。
                    </Text>
                    {apiStore.secretBlocked && (
                      <Text
                        style={[
                          styles.textDescription,
                          {color: theme.colors.error},
                        ]}>
                        检测到运行环境风险（Frida / Xposed
                        等注入框架），为保护密钥，云端对话已停用。本地离线推理不受影响。
                      </Text>
                    )}
                    <View style={styles.settingItemContainer}>
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text style={styles.textLabel}>启用云端对话</Text>
                          <Text style={styles.textDescription}>
                            关闭时使用本地离线模型
                          </Text>
                        </View>
                        <Switch
                          testID="api-service-switch"
                          value={apiStore.enabled}
                          onValueChange={value => apiStore.setEnabled(value)}
                        />
                      </View>
                      <FrostedInput
                        label="服务地址 (Base URL)"
                        value={apiStore.baseUrl}
                        onChangeText={text => apiStore.setBaseUrl(text)}
                        style={styles.textInput}
                        autoCapitalize="none"
                        keyboardType="url"
                        placeholder="https://api.deepseek.com"
                      />
                      <FrostedInput
                        label="API Key"
                        value={apiStore.apiKey}
                        onChangeText={text => apiStore.setApiKey(text)}
                        style={styles.textInput}
                        autoCapitalize="none"
                        secureTextEntry
                        placeholder="sk-..."
                      />
                      <FrostedInput
                        label="模型名"
                        value={apiStore.model}
                        onChangeText={text => apiStore.setModel(text)}
                        style={styles.textInput}
                        autoCapitalize="none"
                        placeholder="deepseek-chat"
                      />
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text style={styles.textLabel}>测试连接</Text>
                          <Text
                            style={[
                              styles.textDescription,
                              chatTest
                                ? {
                                    color: chatTest.ok
                                      ? theme.colors.primary
                                      : theme.colors.error,
                                  }
                                : null,
                            ]}>
                            {chatTest ? chatTest.msg : '验证地址与密钥是否可用'}
                          </Text>
                        </View>
                        <Button
                          mode="outlined"
                          onPress={handleTestChat}
                          loading={testingChat}
                          disabled={testingChat}
                          style={[
                            {borderWidth: 1, borderColor: buttonRing(theme)},
                            styles.menuButton,
                          ]}>
                          测试连接
                        </Button>
                      </View>
                    </View>
                  </Card.Content>
                </SurfaceCard>

                {/* 云端语音合成 */}
                {renderGroupTitle('云端语音合成')}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <Text style={styles.textDescription}>
                      兼容 OpenAI
                      的语音接口（/v1/audio/speech）。云端音色更自然，需要联网与
                      API Key；关闭时用本机引擎。设置后在「生成语音」页生效。
                    </Text>
                    <View style={styles.settingItemContainer}>
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text style={styles.textLabel}>启用云端语音</Text>
                          <Text style={styles.textDescription}>
                            关闭时使用本机语音引擎
                          </Text>
                        </View>
                        <Switch
                          value={cloudTTSStore.enabled}
                          onValueChange={value =>
                            cloudTTSStore.setEnabled(value)
                          }
                        />
                      </View>
                      <FrostedInput
                        label="服务地址 (Base URL)"
                        value={cloudTTSStore.baseUrl}
                        onChangeText={text => cloudTTSStore.setBaseUrl(text)}
                        style={styles.textInput}
                        autoCapitalize="none"
                        keyboardType="url"
                        placeholder="https://api.openai.com"
                      />
                      <FrostedInput
                        label="API Key"
                        value={cloudTTSStore.apiKey}
                        onChangeText={text => cloudTTSStore.setApiKey(text)}
                        style={styles.textInput}
                        autoCapitalize="none"
                        secureTextEntry
                        placeholder="sk-..."
                      />
                      <FrostedInput
                        label="模型名"
                        value={cloudTTSStore.model}
                        onChangeText={text => cloudTTSStore.setModel(text)}
                        style={styles.textInput}
                        autoCapitalize="none"
                        placeholder="tts-1"
                      />
                      <FrostedInput
                        label="音色"
                        value={cloudTTSStore.voice}
                        onChangeText={text => cloudTTSStore.setVoice(text)}
                        style={styles.textInput}
                        autoCapitalize="none"
                        placeholder="alloy"
                      />
                      <FrostedInput
                        label="语速（0.25 ~ 4）"
                        value={String(cloudTTSStore.speed)}
                        onChangeText={text => {
                          const n = parseFloat(text);
                          if (!isNaN(n)) {
                            cloudTTSStore.setSpeed(n);
                          }
                        }}
                        style={styles.textInput}
                        keyboardType="numeric"
                        placeholder="1"
                      />
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text style={styles.textLabel}>测试连接</Text>
                          <Text
                            style={[
                              styles.textDescription,
                              ttsTest
                                ? {
                                    color: ttsTest.ok
                                      ? theme.colors.primary
                                      : theme.colors.error,
                                  }
                                : null,
                            ]}>
                            {ttsTest ? ttsTest.msg : '验证地址与密钥是否可用'}
                          </Text>
                        </View>
                        <Button
                          mode="outlined"
                          onPress={handleTestTts}
                          loading={testingTts}
                          disabled={testingTts}
                          style={[
                            {borderWidth: 1, borderColor: buttonRing(theme)},
                            styles.menuButton,
                          ]}>
                          测试连接
                        </Button>
                      </View>
                    </View>
                  </Card.Content>
                </SurfaceCard>

                {/* 云端图像生成与增强 */}
                {renderGroupTitle('云端图像生成与增强')}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <Text style={styles.textDescription}>
                      连接 Stable Diffusion WebUI（Automatic1111 / Forge 等）的
                      HTTP
                      接口。可指向局域网电脑或云端服务；出图在「生成图片」页，增强在「图像增强」页。
                    </Text>
                    <View style={styles.settingItemContainer}>
                      <FrostedInput
                        label="生成服务地址"
                        value={imageGenStore.serverUrl}
                        onChangeText={text => imageGenStore.setServerUrl(text)}
                        style={styles.textInput}
                        autoCapitalize="none"
                        keyboardType="url"
                        placeholder="http://192.168.1.56:7860"
                      />
                      <FrostedInput
                        label="增强服务地址"
                        value={imageGenStore.enhanceCloudUrl}
                        onChangeText={text =>
                          imageGenStore.setEnhanceCloudUrl(text)
                        }
                        style={styles.textInput}
                        autoCapitalize="none"
                        keyboardType="url"
                        placeholder="https://xxx/sdapi/v1/img2img"
                      />
                      <FrostedInput
                        label="增强服务密钥（可选）"
                        value={imageGenStore.enhanceCloudKey}
                        onChangeText={text =>
                          imageGenStore.setEnhanceCloudKey(text)
                        }
                        style={styles.textInput}
                        autoCapitalize="none"
                        secureTextEntry
                        placeholder="留空表示不需要鉴权"
                      />
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text style={styles.textLabel}>测试连接</Text>
                          <Text
                            style={[
                              styles.textDescription,
                              imgTest
                                ? {
                                    color: imgTest.ok
                                      ? theme.colors.primary
                                      : theme.colors.error,
                                  }
                                : null,
                            ]}>
                            {imgTest ? imgTest.msg : '验证生成服务是否可达'}
                          </Text>
                        </View>
                        <Button
                          mode="outlined"
                          onPress={handleTestImage}
                          loading={testingImg}
                          disabled={testingImg}
                          style={[
                            {borderWidth: 1, borderColor: buttonRing(theme)},
                            styles.menuButton,
                          ]}>
                          测试连接
                        </Button>
                      </View>
                    </View>
                  </Card.Content>
                </SurfaceCard>

                {/* 联网搜索 */}
                {renderGroupTitle('联网搜索')}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <Text style={styles.textDescription}>
                      让助手联网查询最新信息。内置 DuckDuckGo
                      免费源，无需密钥即可使用；也可配置 Tavily / Brave / Exa
                      获得更精准的结果。
                      {'\n'}云端对话：当前 Pal
                      启用「联网搜索」能力后，云端回复会先自动联网查询，再基于结果作答（不需要加载本地模型）。
                    </Text>
                    {searchProviderStore.secretBlocked && (
                      <Text
                        style={[
                          styles.textDescription,
                          {color: theme.colors.error},
                        ]}>
                        检测到运行环境风险，付费搜索源的密钥已停用；内置免费搜索不受影响。
                      </Text>
                    )}
                    <View style={styles.switchContainer}>
                      <View style={styles.textContainer}>
                        <Text style={styles.textLabel}>当前供应商</Text>
                        <Text style={styles.textDescription}>
                          {activeSearchProvider?.label ??
                            activeSearchProviderId}{' '}
                          · 每次 {searchProviderStore.resultCount} 条结果
                        </Text>
                      </View>
                      <Button
                        mode="outlined"
                        onPress={() => setSubPage('search')}
                        style={[
                          {borderWidth: 1, borderColor: buttonRing(theme)},
                          styles.menuButton,
                        ]}>
                        配置
                      </Button>
                    </View>
                  </Card.Content>
                </SurfaceCard>

                {/* Hugging Face 令牌 */}
                {renderGroupTitle('Hugging Face 令牌')}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <Text style={styles.textDescription}>
                      用于访问受限（Gated）模型与私有仓库。令牌保存在本机密钥库，仅发送给
                      huggingface.co。下载前请核实模型许可。
                    </Text>
                    <View style={styles.settingItemContainer}>
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text style={styles.textLabel}>
                            {hfStore.isTokenPresent
                              ? '已设置令牌'
                              : '未设置令牌'}
                          </Text>
                          <Text style={styles.textDescription}>
                            {hfStore.isTokenPresent
                              ? '下载受限模型时会用到'
                              : '设置后才能下载受限模型'}
                          </Text>
                        </View>
                        <Button
                          mode="outlined"
                          onPress={() => setShowHfTokenDialog(true)}
                          style={[
                            {borderWidth: 1, borderColor: buttonRing(theme)},
                            styles.menuButton,
                          ]}>
                          {hfStore.isTokenPresent ? '更新' : '设置'}
                        </Button>
                      </View>
                      {hfStore.isTokenPresent && (
                        <>
                          <View style={styles.switchContainer}>
                            <View style={styles.textContainer}>
                              <Text style={styles.textLabel}>启用令牌</Text>
                              <Text style={styles.textDescription}>
                                联网请求会带上此令牌
                              </Text>
                            </View>
                            <Switch
                              value={hfStore.useHfToken}
                              onValueChange={value =>
                                hfStore.setUseHfToken(value)
                              }
                            />
                          </View>
                          <View style={styles.switchContainer}>
                            <View style={styles.textContainer}>
                              <Text style={styles.textLabel}>测试连接</Text>
                              <Text
                                style={[
                                  styles.textDescription,
                                  tokenTest
                                    ? {
                                        color: tokenTest.ok
                                          ? theme.colors.primary
                                          : theme.colors.error,
                                      }
                                    : null,
                                ]}>
                                {tokenTest
                                  ? tokenTest.ok
                                    ? t(l10n.settings.tokenTestSuccess, {
                                        username: tokenTest.username || '',
                                      })
                                    : t(l10n.settings.tokenTestFailedMessage, {
                                        reason: tokenTest.reason || '',
                                      })
                                  : l10n.settings.testConnectionDescription}
                              </Text>
                            </View>
                            <Button
                              mode="outlined"
                              onPress={handleTestToken}
                              loading={testingToken}
                              disabled={testingToken}
                              style={[
                                {
                                  borderWidth: 1,
                                  borderColor: buttonRing(theme),
                                },
                                styles.menuButton,
                              ]}>
                              测试连接
                            </Button>
                          </View>
                        </>
                      )}
                    </View>
                  </Card.Content>
                </SurfaceCard>

                {/* 远程模型服务器（说明） */}
                {renderGroupTitle('远程模型服务器')}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <Text style={styles.textDescription}>
                      连接自建的 llama.cpp / OpenAI 兼容服务器（可带 API
                      Key）。当前已配置 {serverStore.servers.length} 台。
                    </Text>
                    <View style={styles.switchContainer}>
                      <View style={styles.textContainer}>
                        <Text style={styles.textLabel}>添加远端模型</Text>
                        <Text style={styles.textDescription}>
                          填一个服务地址即可拉取它的模型列表
                        </Text>
                      </View>
                      <Button
                        testID="ai-service-add-remote-model"
                        mode="outlined"
                        onPress={() => setShowRemoteModelSheet(true)}
                        style={[
                          {
                            borderWidth: 1,
                            borderColor: buttonRing(theme),
                          },
                          styles.menuButton,
                        ]}>
                        添加
                      </Button>
                    </View>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}
            {/* 分组：账户 */}
            {subPage === 'account' && (
              <>
                {/* API 设置 */}
                {renderGroupTitle(l10n.settings.apiSettingsTitle)}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <View style={styles.settingItemContainer}>
                      {/* Hugging Face Token */}
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {l10n.settings.huggingFaceTokenLabel}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {hfStore.isTokenPresent
                              ? l10n.settings.tokenIsSetDescription
                              : l10n.settings.setTokenDescription}
                          </Text>
                        </View>
                        <Button
                          mode="outlined"
                          onPress={() => setShowHfTokenDialog(true)}
                          style={[
                            {borderWidth: 1, borderColor: buttonRing(theme)},
                            styles.menuButton,
                          ]}>
                          {hfStore.isTokenPresent
                            ? l10n.common.update
                            : l10n.settings.setTokenButton}
                        </Button>
                      </View>

                      {/* Use HF Token Switch */}
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <Text variant="titleMedium" style={styles.textLabel}>
                            {l10n.settings.useHfTokenLabel}
                          </Text>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {l10n.settings.useHfTokenDescription}
                          </Text>
                        </View>
                        <Switch
                          testID="use-hf-token-switch"
                          value={hfStore.useHfToken}
                          disabled={!hfStore.isTokenPresent}
                          onValueChange={value => hfStore.setUseHfToken(value)}
                        />
                      </View>

                      {/* 测试连接：验证令牌有效性，避免下载时反复报错 */}
                      {hfStore.isTokenPresent && (
                        <View style={styles.switchContainer}>
                          <View style={styles.textContainer}>
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              {l10n.settings.testConnection}
                            </Text>
                            <Text
                              variant="labelSmall"
                              style={styles.textDescription}>
                              {tokenTest
                                ? tokenTest.ok
                                  ? t(l10n.settings.tokenTestSuccess, {
                                      username: tokenTest.username || '',
                                    })
                                  : t(l10n.settings.tokenTestFailedMessage, {
                                      reason: tokenTest.reason || '',
                                    })
                                : l10n.settings.testConnectionDescription}
                            </Text>
                          </View>
                          <Button
                            mode="outlined"
                            onPress={handleTestToken}
                            loading={testingToken}
                            disabled={testingToken || !hfStore.isTokenPresent}
                            style={[
                              {borderWidth: 1, borderColor: buttonRing(theme)},
                              styles.menuButton,
                            ]}>
                            {testingToken
                              ? l10n.settings.testingConnection
                              : l10n.settings.testConnectionButton}
                          </Button>
                        </View>
                      )}

                      {/* 清除令牌：从本机安全存储移除，之后下载私有模型不再带凭证 */}
                      {hfStore.isTokenPresent && (
                        <View style={styles.switchContainer}>
                          <View style={styles.textContainer}>
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              清除令牌
                            </Text>
                            <Text
                              variant="labelSmall"
                              style={styles.textDescription}>
                              从本机安全存储中移除令牌，之后下载私有模型将不再携带凭证
                            </Text>
                          </View>
                          <Button
                            testID="hf-clear-token-button"
                            mode="outlined"
                            textColor={theme.colors.error}
                            onPress={() =>
                              Alert.alert(
                                '清除令牌',
                                '确定要从本机移除 Hugging Face 令牌吗？',
                                [
                                  {text: '取消', style: 'cancel'},
                                  {
                                    text: '清除',
                                    style: 'destructive',
                                    onPress: () => {
                                      hfStore.clearToken();
                                      setTokenTest(null);
                                    },
                                  },
                                ],
                              )
                            }
                            style={[
                              {
                                borderWidth: 1,
                                borderColor: theme.colors.error,
                              },
                              styles.menuButton,
                            ]}>
                            清除
                          </Button>
                        </View>
                      )}
                    </View>
                  </Card.Content>
                </SurfaceCard>

                {/* 令牌安全与合规须知 */}
                {renderGroupTitle(l10n.settings.hfComplianceTitle)}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    <Text style={styles.complianceText}>
                      {l10n.settings.hfComplianceSecurity}
                    </Text>
                    <Text style={styles.complianceText}>
                      {l10n.settings.hfComplianceLicense}
                    </Text>
                    <Text style={styles.complianceText}>
                      {l10n.settings.hfComplianceGated}
                    </Text>
                    <Button
                      mode="outlined"
                      onPress={() =>
                        Linking.openURL(
                          'https://huggingface.co/settings/tokens',
                        )
                      }
                      style={[
                        {borderWidth: 1, borderColor: buttonRing(theme)},
                        styles.menuButton,
                        styles.complianceAction,
                      ]}>
                      前往 Hugging Face 令牌管理页
                    </Button>
                  </Card.Content>
                </SurfaceCard>

                {/* Cache & Storage Settings - iOS only (for Shortcuts) */}
                {Platform.OS === 'ios' &&
                  renderGroupTitle(l10n.settings.cacheStorageTitle)}
                {Platform.OS === 'ios' && (
                  <SurfaceCard
                    scaleOnAnyTouch
                    paper
                    elevation={2}
                    style={styles.card}>
                    <Card.Content style={styles.cardContent}>
                      <View style={styles.settingItemContainer}>
                        {/* Clear Shortcuts Caches */}
                        <View style={styles.switchContainer}>
                          <View style={styles.textContainer}>
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              {l10n.settings.clearPalCaches}
                            </Text>
                            <Text
                              variant="labelSmall"
                              style={styles.textDescription}>
                              {l10n.settings.clearPalCachesDescription}
                            </Text>
                          </View>
                          <Button
                            mode="outlined"
                            onPress={async () => {
                              try {
                                const cacheInfo = await getSessionCacheInfo();

                                if (cacheInfo.fileCount === 0) {
                                  Alert.alert(
                                    l10n.settings.clearPalCaches,
                                    l10n.settings.noCachesToClear,
                                  );
                                  return;
                                }

                                const formattedSize = formatBytes(
                                  cacheInfo.totalSizeBytes,
                                );
                                const confirmMessage = t(
                                  l10n.settings.clearCachesConfirmMessage,
                                  {
                                    fileCount: cacheInfo.fileCount.toString(),
                                    size: formattedSize,
                                  },
                                );

                                Alert.alert(
                                  l10n.settings.clearCachesConfirmTitle,
                                  confirmMessage,
                                  [
                                    {
                                      text: l10n.common.cancel,
                                      style: 'cancel',
                                    },
                                    {
                                      text: l10n.settings.clearCachesButton,
                                      style: 'destructive',
                                      onPress: async () => {
                                        try {
                                          const deletedCount =
                                            await clearAllSessionCaches();
                                          const successMessage = t(
                                            l10n.settings.clearCachesSuccess,
                                            {count: deletedCount.toString()},
                                          );
                                          Alert.alert(
                                            l10n.settings.clearPalCaches,
                                            successMessage,
                                          );
                                        } catch (error) {
                                          console.error(
                                            'Failed to clear caches:',
                                            error,
                                          );
                                          Alert.alert(
                                            l10n.settings.clearPalCaches,
                                            l10n.settings.clearCachesError,
                                          );
                                        }
                                      },
                                    },
                                  ],
                                );
                              } catch (error) {
                                console.error(
                                  'Failed to get cache info:',
                                  error,
                                );
                                Alert.alert(
                                  l10n.settings.clearPalCaches,
                                  l10n.settings.clearCachesError,
                                );
                              }
                            }}
                            style={[
                              {borderWidth: 1, borderColor: buttonRing(theme)},
                              styles.menuButton,
                            ]}>
                            {l10n.settings.clearCachesButton}
                          </Button>
                        </View>
                      </View>
                    </Card.Content>
                  </SurfaceCard>
                )}

                <PurchasesCard onSignInPress={() => setShowAuthSheet(true)} />
              </>
            )}
            {/* 分组：数据 */}
            {subPage === 'data' && (
              <>
                {/* Export Options */}
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Title title={l10n.settings.exportOptions} />
                  <Card.Content style={styles.cardContent}>
                    <View style={styles.settingItemContainer}>
                      {/* Legacy Export */}
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <View style={styles.labelWithIconContainer}>
                            <ShareIcon
                              width={20}
                              height={20}
                              style={styles.settingIcon}
                              stroke={theme.colors.onSurface}
                            />
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              {l10n.settings.exportLegacyChats}
                            </Text>
                          </View>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            {l10n.settings.exportLegacyChatsDescription}
                          </Text>
                        </View>
                        <Button
                          mode="outlined"
                          onPress={async () => {
                            try {
                              await exportLegacyChatSessions();
                            } catch {
                              Alert.alert(
                                'Export Error',
                                'Failed to export legacy chat sessions. The file may not exist.',
                              );
                            }
                          }}
                          style={[
                            {borderWidth: 1, borderColor: buttonRing(theme)},
                            styles.menuButton,
                          ]}>
                          {l10n.settings.exportButton}
                        </Button>
                      </View>
                    </View>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}
            {/* 布局 */}
            {subPage === 'layout' && (
              <>
                <SurfaceCard
                  scaleOnAnyTouch
                  paper
                  elevation={0}
                  style={styles.card}>
                  <Card.Title title="资源下载按钮" />
                  <Card.Content style={styles.cardContent}>
                    <View style={styles.settingItemContainer}>
                      <View style={styles.switchContainer}>
                        <View style={styles.textContainer}>
                          <View style={styles.labelWithIconContainer}>
                            <ShareIcon
                              width={20}
                              height={20}
                              style={styles.settingIcon}
                              stroke={theme.colors.onSurface}
                            />
                            <Text
                              variant="titleMedium"
                              style={styles.textLabel}>
                              主页显示「模型下载直达」
                            </Text>
                          </View>
                          <Text
                            variant="labelSmall"
                            style={styles.textDescription}>
                            开启后，主页快捷入口下方显示模型下载直达入口
                          </Text>
                        </View>
                        <Switch
                          value={uiStore.showDownloadEntry}
                          onValueChange={v => uiStore.setShowDownloadEntry(v)}
                        />
                      </View>
                    </View>
                  </Card.Content>
                </SurfaceCard>
              </>
            )}
          </KeyboardAwareScrollView>
        </TouchableWithoutFeedback>
      </Animated.View>
      <HFTokenSheet
        isVisible={showHfTokenDialog}
        onDismiss={() => setShowHfTokenDialog(false)}
        onSave={() => setShowHfTokenDialog(false)}
      />
      <RemoteModelSheet
        isVisible={showRemoteModelSheet}
        onDismiss={() => setShowRemoteModelSheet(false)}
      />
      <SearchProviderKeySheet
        isVisible={showSearchKeySheet}
        providerId={activeSearchProviderId}
        providerLabel={activeSearchProvider?.label ?? activeSearchProviderId}
        onDismiss={() => setShowSearchKeySheet(false)}
      />
      {showAuthSheet && (
        <AuthSheet
          isVisible={showAuthSheet}
          onClose={() => {
            setShowAuthSheet(false);
            if (!authService.isAuthenticated) {
              purchaseStore.cancelLinkRequest();
            }
          }}
        />
      )}

      {/* 界面风格选择器：通用 Popover 组件 */}
      <Popover
        visible={showStylePicker}
        onClose={closeStylePicker}
        anchorPosition={styleAnchor}
        popoverWidth={200}>
        {STYLE_OPTIONS.map(opt => {
          const active = uiStore.themeStyle === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              testID={`style-option-${opt.value}`}
              style={[styles.langItem, active && styles.sheetItemActive]}
              onPress={() => {
                uiStore.setThemeStyle(opt.value);
                closeStylePicker();
              }}
              accessibilityRole="button">
              <Text style={styles.langItemLabel}>{opt.label}</Text>
              {active && (
                <Icon source="check" size={18} color={theme.colors.secondary} />
              )}
            </TouchableOpacity>
          );
        })}
      </Popover>

      {/* 界面语言选择器：贴在「界面语言」那行下拉箭头正下方的小面板，列表可翻页 */}
      <Modal
        visible={showLanguagePicker}
        transparent
        statusBarTranslucent
        animationType="none"
        onRequestClose={closeLanguagePicker}>
        <TouchableWithoutFeedback onPress={closeLanguagePicker}>
          <View style={styles.langSheetOverlay}>
            <TouchableWithoutFeedback>
              <Animated.View
                style={[
                  styles.langSheet,
                  // 量出来的锚点：右上角对齐那一行的右沿、顶在它正下方
                  langAnchor
                    ? {top: langAnchor.top, right: langAnchor.right}
                    : null,
                  {
                    opacity: langPicker.anim,
                    // 只有 MIUIX 风格才带这个「弹出来」的缩放；标准风格时
                    // anim 直接是 1，视觉上等于没有动画。
                    transform: [
                      {
                        scale: langPicker.anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.9, 1],
                        }),
                      },
                    ],
                  },
                ]}>
                <SurfaceCard
                  scaleOnAnyTouch
                  style={styles.langSheetSurface}
                  glassType="regular"
                  tint={dialogGlassTint(theme)}
                  tintOpacity={0.34}
                  blur
                  blurAmount={40}
                  blurRounds={4}
                  forceFrosted>
                  <Animated.ScrollView
                    style={styles.langSheetScroll}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                    scrollEventThrottle={16}
                    onScroll={Animated.event(
                      [{nativeEvent: {contentOffset: {y: langScrollY}}}],
                      {useNativeDriver: true},
                    )}
                    onScrollBeginDrag={showLangIndicator}
                    onScrollEndDrag={hideLangIndicator}
                    onMomentumScrollEnd={hideLangIndicator}
                    onContentSizeChange={(_w, h) =>
                      setLangScroll(prev => ({...prev, content: h}))
                    }
                    onLayout={e => {
                      const h = e.nativeEvent?.layout?.height;
                      if (h != null) {
                        setLangScroll(prev => ({...prev, view: h}));
                      }
                    }}>
                    {languageOptions.map(opt => {
                      const active = uiStore.language === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          testID={`language-option-${opt.value}`}
                          style={[
                            styles.langItem,
                            active && styles.sheetItemActive,
                          ]}
                          onPress={() => {
                            uiStore.setLanguage(opt.value as AvailableLanguage);
                            closeLanguagePicker();
                          }}
                          accessibilityRole="button">
                          <Text style={styles.langItemLabel}>{opt.label}</Text>
                          {active && (
                            <Icon
                              source="check"
                              size={18}
                              color={theme.colors.secondary}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </Animated.ScrollView>

                  {/* 划动时出现在右侧的指示标：淡入 → 跟随滚动 → 松手后淡出 */}
                  {langIndicatorHeight > 0 ? (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        styles.langIndicator,
                        {
                          height: langIndicatorHeight,
                          opacity: langIndicatorOpacity,
                          transform: [
                            {
                              translateY: Animated.multiply(
                                langScrollY,
                                (langScroll.view - langIndicatorHeight) /
                                  Math.max(
                                    1,
                                    langScroll.content - langScroll.view,
                                  ),
                              ),
                            },
                          ],
                        },
                      ]}
                    />
                  ) : null}
                </SurfaceCard>
              </Animated.View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* 关键色选择器：右上角小面板（与语言/风格同款） */}
      <Modal
        visible={showKeyColorPicker}
        transparent
        statusBarTranslucent
        animationType="none"
        onRequestClose={closeKeyColorPicker}>
        <TouchableWithoutFeedback onPress={closeKeyColorPicker}>
          <View style={styles.langSheetOverlay}>
            <TouchableWithoutFeedback>
              <Animated.View
                style={[
                  styles.langSheet,
                  keyColorAnchor
                    ? {top: keyColorAnchor.top, right: keyColorAnchor.right}
                    : null,
                  {
                    opacity: keyColorPicker.anim,
                    transform: [
                      {
                        scale: keyColorPicker.anim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.9, 1],
                        }),
                      },
                    ],
                  },
                ]}>
                <SurfaceCard
                  scaleOnAnyTouch
                  style={styles.langSheetSurface}
                  glassType="regular"
                  tint={dialogGlassTint(theme)}
                  tintOpacity={0.34}
                  blur
                  blurAmount={40}
                  blurRounds={4}
                  forceFrosted>
                  <KeyboardAwareScrollView
                    style={styles.langSheetScroll}
                    showsVerticalScrollIndicator={false}
                    bounces={false}>
                    {KEY_COLORS.map(opt => {
                      const active = uiStore.keyColor === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.label}
                          testID={`key-color-${opt.label}`}
                          style={[
                            styles.langItem,
                            active && styles.sheetItemActive,
                          ]}
                          onPress={() => {
                            uiStore.setKeyColor(opt.value);
                            closeKeyColorPicker();
                          }}
                          accessibilityRole="button">
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                            }}>
                            <View
                              style={{
                                width: 14,
                                height: 14,
                                borderRadius: 7,
                                marginRight: 8,
                                backgroundColor:
                                  opt.value ?? theme.colors.secondary,
                              }}
                            />
                            <Text style={styles.langItemLabel}>
                              {opt.label}
                            </Text>
                          </View>
                          {active && (
                            <Icon
                              source="check"
                              size={18}
                              color={theme.colors.secondary}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </KeyboardAwareScrollView>
                </SurfaceCard>
              </Animated.View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
});
