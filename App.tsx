// 全局动画总开关（各组件自己判断并跳过动画）

import * as React from 'react';
import {useEffect} from 'react';
import {
  Appearance,
  AppState,
  Dimensions,
  BackHandler,
  Animated,
  PanResponder,
  Platform,
  StyleSheet,
  StatusBar,
  Text,
  TouchableOpacity,
  UIManager,
  View,
  ImageBackground,
  LogBox,
} from 'react-native';

// 底部胶囊「整栏」按压缩放：模块级共享值，任一 tab 按下时整条胶囊一起放大。
const BAR_PRESS_SCALE = new Animated.Value(1);

import {observer} from 'mobx-react';
import {isHydrated} from 'mobx-persist-store';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  useIsFocused,
  useNavigation,
} from '@react-navigation/native';
import {Provider as PaperProvider} from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import {BottomSheetModalProvider} from '@gorhom/bottom-sheet';
import {createDrawerNavigator} from '@react-navigation/drawer';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {BackButton} from './src/components/BackButton';
import {SceneEnterShell} from './src/components/SceneEnterShell';
import {GestureHandlerRootView} from 'react-native-gesture-handler';

import {purchaseStore, ttsStore, uiStore} from './src/store';
import {useTheme} from './src/hooks';
import {useDeepLinking} from './src/hooks/useDeepLinking';
import {Theme} from './src/utils/types';
import {
  ADD_BUTTON_GAP,
  ADD_BUTTON_SIDE,
  HEADER_EXTRA,
  HEADER_HEIGHT,
  HEADER_ICON_SIZE,
  HEADER_MODULE_SIZE,
  HEADER_TITLE_SIZE,
  HEADER_TITLE_WEIGHT,
  headerBg,
  frostedSurface,
  headerBottomRadius,
  headerModuleRadius,
  PILL_BAR_BOTTOM,
  PILL_BAR_HEIGHT,
  PILL_BAR_SIDE,
  pillRadius,
} from './src/theme/cards';
// 动画参数（时长/缓动/弹簧/位移比例）—— 数值取自 BAVoice，只影响动画
import {
  EASE,
  OFFSET,
  SPRING_DAMPED_DRAG,
  SPRING_LIQUID_INDICATOR,
  SPRING_PAGER_SNAP,
  SPRING_TAB_ICON,
  SPRING_PRESS,
  LIQUID,
  TAB_STATE,
  TRANSITION,
} from './src/theme/motion';

import {l10n, initLocale} from './src/locales';
import {L10nContext} from './src/utils';
import {ROUTES} from './src/utils/navigationConstants';
import {getCurrentPageBackground} from './src/theme/pageBackgrounds';
import {headerTranslucent, wallpaperScrim} from './src/theme/cards';
import {SurfaceCard} from './src/components/GlassSurface';
import {GlassSheen} from './src/components/GlassSheen';
import {DisclaimerGate} from './src/components/DisclaimerGate';
import {
  fabMenuOpen,
  setFabMenuOpen,
} from './src/screens/ModelsScreen/FABGroup/FABGroup';
import {
  ScreenActiveProvider,
  ScreenActiveProviderDeferred,
} from './src/utils/ScreenActive';

import {
  SidebarContent,
  ModelsHeaderRight,
  PalHeaderRight,
  HeaderLeft,
  AppWithMigration,
  TTSSetupSheet,
  TTSErrorDialog,
  DownloadOverlay,
  HubRunSheetHost,
} from './src/components';
import {MarkdownProvider} from './src/components/MarkdownView';
import {
  AutomationBridge,
  BenchmarkRunnerScreen,
  fakeStore,
} from './src/__automation__';
import {
  ChatScreen,
  HomeScreen,
  ModelsScreen,
  SettingsScreen,
  DownloadManagementScreen,
  BenchmarkScreen,
  AboutScreen,
  VisionScreen,
  VisionModelsScreen,
  ImageGenScreen,
  ImageEnhanceScreen,
  VoiceScreen,
  VoiceChangeScreen,
  VoiceCloneScreen,
  GptSovitsScreen,

  // Dev tools screen. Only available in debug mode.
  DevToolsScreen,
} from './src/screens';
import PalsScreen from './src/screens/PalsScreen';
import MoreScreen, {MoreKey} from './src/screens/MoreScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import {tabIconSmall} from './src/assets/tabicons/tabIconsSmall';
import {tabIconDark} from './src/assets/tabicons/tabIconsDark';
import {
  MOTION_ENABLED,
  motionTiming,
  motionSpring,
} from './src/utils/disableMotion';

// Check if app is in debug mode
const isDebugMode = __DEV__;

/**
 * 双槽位「滑动翻页」总开关。
 *
 * false = 关闭整条翻页路径：
 *   · 内容区 / 底栏胶囊都不接管滑动切换手势
 *   · 切 Tab 变成直接换页（一次状态提交），不跑两页位移
 *   · 换页后仍会重播目标页的入场动画（Entrance 淡入 + 上移）
 *
 * 关闭原因：双槽位翻页的状态机边界情况太多 —— 切后台、手势被系统打断、
 * 动画收尾期并发写入、二级页与翻页同时发生……任何一个没处理干净，
 * 表现都是「两页并排 / 内容重叠 / 露白」。几何不变量
 * `back - cur === 屏宽` 本身成立，问题全在状态耦合上。
 *
 * 整套实现（startFlip / animateFlip / settleFlip / 手势 / 闸门）都保留着，
 * 想恢复时把它改成 true 即可，不需要重写。
 */
const FLIP_ENABLED = false;

// react-native-iap 在没有 Play Store / 未登录的设备上会 console.error
// （getAvailablePurchases 抛 service-disconnected）。这是预期情况，
// 不需要在开发时弹 LogBox；release 版本本来也不显示。
LogBox.ignoreLogs(['[RN-IAP]']);

// 开启 Android 布局动画（页面切换轻量动画，120ms 极短不卡手）
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

if (__E2E__) {
  fakeStore.restore();
}

const Drawer = createDrawerNavigator();

const screenWidth = Dimensions.get('window').width;

// 液态玻璃：按需加载原生玻璃库（@sbaiahmed1/react-native-blur）。
// 放在 lazy require 里，这样默认的「MIUIX/标准」风格完全不受影响；
// 万一原生模块加载失败，返回 null，自动回退到磨砂半透明。
//
// 用 LiquidGlassView 而不是手搓 BlurView：
//   · Android 13+ → 库自带的原生「液态玻璃」
//     （Android 端是 AGSL 着色器：折射 + 色散 + 模糊，就是 iOS 26/27 那套）
//   · Android 13 以下 → **不跑原生模糊**，统一走磨砂（见下面说明）
/**
 * 取「原生液态玻璃」组件；**取不到就返回 null**（调用方回退到磨砂实底）。
 *
 * 只有 Android 13+（API 33）才有原生 AGSL 液态玻璃（RuntimeShader 做折射+色散+模糊）。
 * 更低版本**一律不跑任何原生模糊**，统一走磨砂（半透明 tint + 高光描边）：
 *   · API 29 的原生模糊走 RenderScript（CPU），一屏多个玻璃视图必然掉帧；
 *   · 磨砂在纯色/壁纸背景下的观感差异很小，代价却接近 0。
 */
let _glassComponent: any = null;
const getGlassComponent = (): any => {
  if (_glassComponent === null) {
    try {
      const ver = Number.parseInt(String(Platform.Version), 10);
      if (ver < 33) {
        _glassComponent = false;
      } else {
        const lib = require('@sbaiahmed1/react-native-blur');
        _glassComponent = lib.LiquidGlassView;
      }
    } catch {
      _glassComponent = false;
    }
  }
  return _glassComponent || null;
};

/**
 * 低版本 Android 走 BlurView 时的性能参数。
 *
 * 背景（读 qmdeve BlurViewGroup 的原生实现得出的）：
 *   · blurAmount  → 映射成模糊半径 radius = amount（0~100）
 *   · blurRounds  → 原生 box-blur 的「遍数」，每遍都是一次完整位图遍历，
 *                   所以它是 CPU 成本的直接乘数。库默认 5 遍。
 *   · downsample  → 库内部写死 8 倍降采样（这块已经很省了）
 *
 * 延迟的真正大头是 blurRounds=5 —— 5 遍全图遍历在低端机上算不完，
 * 帧就掉了，表现为「玻璃里的内容慢一拍」。降到 2 遍：
 *   · CPU 成本直接降到 2/5
 *   · 视觉上仍然足够柔和（叠 5 遍只是为了更接近高斯，2 遍肉眼差别很小）
 *
 * blurAmount 也从库默认的 70 降到 26：半径越大，每遍要摸的邻域越大。
 */
// ⚠️ 这两个常量已随「Android 13 以下不跑原生模糊」的策略一起废弃：
// 低版本统一走磨砂（半透明 tint + 高光描边），不再需要调模糊半径和遍数。

// 底部 Tab 样式（liquidGlass = 液态玻璃底栏）
const createTabStyles = (theme: Theme, liquidGlass: boolean) => {
  return StyleSheet.create({
    tabContainer: {
      flex: 1,
      // 透明：壁纸由 App 根层的 ImageBackground 提供，四个 Tab 共用同一张
      backgroundColor: 'transparent',
    },
    // 顶部栏：整条填满左右，底色铺到屏幕最上沿（含系统状态栏那一段）
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      height: HEADER_HEIGHT,
      // 玻璃风格下半透明（透出壁纸），其他风格回落成原来的 surface 实底
      backgroundColor: headerTranslucent(theme, headerBg(theme)),
      marginBottom: 10,
      borderBottomLeftRadius: headerBottomRadius(),
      borderBottomRightRadius: headerBottomRadius(),
      // 「光效」开启时流动光带要在顶栏里被裁住
      overflow: 'hidden',
    },
    headerTitle: {
      fontSize: HEADER_TITLE_SIZE,
      fontWeight: HEADER_TITLE_WEIGHT,
      color: theme.colors.onSurface,
      letterSpacing: 0.2,
    },
    headerSpacer: {
      flex: 1,
    },
    // 侧边栏入口（只在「我的」页出现），跟右边的设置按钮同款模块
    headerMenu: {
      marginRight: 10,
    },
    // 「模块」图标按钮：浅色圆角方块
    headerAction: {
      width: HEADER_MODULE_SIZE,
      height: HEADER_MODULE_SIZE,
      borderRadius: headerModuleRadius(),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outlineVariant,
    },
    headerRight: {
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    tabContent: {
      flex: 1,
    },
    // 翻页槽位：铺满整个内容区。必须绝对定位 —— 否则两个页面会纵向排下来。
    // 备用槽不用 display:none，就停在屏幕外（translateX = ±屏宽）：
    // 布局已经算好，翻页时只改 transform，成本几乎为零。
    pageSlot: {
      ...StyleSheet.absoluteFillObject,
    },
    // 悬浮胶囊栏：定位交给外层的 float / dock 两层壳，本体只负责外观
    pillBar: {
      flexDirection: 'row',
      height: PILL_BAR_HEIGHT,
      backgroundColor: liquidGlass
        ? theme.dark
          ? 'rgba(30, 41, 59, 0.78)'
          : 'rgba(255, 255, 255, 0.76)'
        : theme.colors.surface,
      borderRadius: pillRadius(),
      borderWidth: liquidGlass ? StyleSheet.hairlineWidth : 0,
      borderColor: liquidGlass
        ? theme.dark
          ? 'rgba(226, 232, 240, 0.16)'
          : 'rgba(255, 255, 255, 0.42)'
        : 'transparent',
      paddingVertical: 3,
      paddingHorizontal: 6,
      // ⚠️ 半透明底（液态玻璃）不能开 Android elevation：
      // 透明视图的阴影会被画进视图内部，表现为「图标/文字上蒙了一层灰影」。
      // 只有实底（非液态玻璃）才保留投影。
      elevation: liquidGlass ? 0 : 8,
      shadowColor: '#000',
      shadowOpacity: liquidGlass ? 0 : 0.1,
      shadowRadius: 14,
      shadowOffset: {width: 0, height: 5},
      overflow: 'hidden',
    },
    // 悬浮胶囊栏：绝对定位浮在内容之上，四周内容照常滚动显示
    pillBarLayer: {
      position: 'absolute',
      left: PILL_BAR_SIDE,
      right: PILL_BAR_SIDE,
      bottom: PILL_BAR_BOTTOM,
    },
    // 模型页专用：右侧让位给「添加模型」按钮，左侧再往左收 16。
    // 按钮宽度现在 = PILL_BAR_HEIGHT（和按钮自身高度、胶囊栏高度同一个值），
    // 所以这里也必须用 PILL_BAR_HEIGHT 算，否则右边界会少算 8dp、和按钮叠在一起。
    pillBarShifted: {
      left: PILL_BAR_SIDE - 16,
      right: ADD_BUTTON_SIDE + PILL_BAR_HEIGHT + ADD_BUTTON_GAP,
    },
    // 顶部高光：不要用实线。
    // 胶囊两端是圆角，直线不跟着弯，在高分屏上会看成一条突兀的白线。
    // 这里只留一个空容器，真正的柔光由里面两端渐隐的 LinearGradient 画。
    pillBarHighlight: {
      position: 'absolute',
      top: 1,
      left: 22,
      right: 22,
      height: StyleSheet.hairlineWidth,
    },
    // 底部反光：同样改成柔光，不再用实线
    pillBarHighlightBottom: {
      position: 'absolute',
      bottom: 1,
      left: 34,
      right: 34,
      height: StyleSheet.hairlineWidth,
    },
    // 流动光效的光带样式在 GlassSheen 组件旁的 sheenStyles 里
    // 真·液态玻璃底栏：不设 backgroundColor，让原生模糊透出来，只用 overlayColor 轻微染色
    pillBarGlass: {
      flexDirection: 'row',
      height: PILL_BAR_HEIGHT,
      borderRadius: pillRadius(),
      borderWidth: StyleSheet.hairlineWidth,
      // 描边也调淡一点：白边太亮会让人觉得「玻璃发白、不够透」
      borderColor: theme.dark
        ? 'rgba(226, 232, 240, 0.2)'
        : 'rgba(255, 255, 255, 0.34)',
      paddingVertical: 3,
      paddingHorizontal: 6,
      overflow: 'hidden',
      // ⚠️ 玻璃底是全透明的，不能开 elevation —— 阴影会画进视图内部，
      // 图标和文字上会出现一层灰影（深色主题下最明显）。
      // 层次感交给 borderColor + 上下高光条，不靠投影。
      elevation: 0,
      shadowOpacity: 0,
    },
    // 4 个 Tab 的容器：撑满胶囊内容区，给滑动指示器提供定位上下文。
    // 指示器和 Tab 同级，指示器 absolute 在本容器内，Tab onLayout 的
    // x/width 也是相对本容器，两边坐标系一致，换算不需要再补偿 padding。
    pillItemsWrap: {
      flex: 1,
      flexDirection: 'row',
    },
    // 选中态胶囊背景（滑动指示器）：绝对定位、宽度由外部按 Tab 测量设定。
    // 圆角用 999 自动收成高度一半，不写死数字，以后调栏高它自己跟着变。
    // 背景色（浅蓝胶囊）由 CustomTabBar 按主题传入，这里只定形状/定位。
    pillIndicator: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      borderRadius: 999,
    },
    pillItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 3,
      // 选中态的高亮块由滑动指示器（pillIndicator）画，这里不再铺底色，
      // 否则会和新指示器叠成两层。圆角保留只是兜底，正常看不到。
      borderRadius: (PILL_BAR_HEIGHT - 6) / 2,
    },
    // 选中态不再改背景（交给指示器），只作为「当前项」的标记保留。
    // 图标放大/变色、文字变色都在 PillItem 内部按 isActive 做。
    pillActive: {},
    pillIcon: {
      // 图标容器上限 30px（低端机不放大位图，避免发虚）；放大只走 transform
      width: 30,
      height: 30,
      resizeMode: 'contain',
    },
    pillLabel: {
      fontSize: 9,
      marginTop: 1,
      color: theme.colors.onSurfaceVariant,
    },
    // 二级页顶部栏：磨砂质感（半透明白 + 极细描边，不再用实色圆角块）
    subHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 48,
      paddingHorizontal: 12,
      backgroundColor: theme.dark
        ? 'rgba(28,32,39,0.72)'
        : 'rgba(255,255,255,0.72)',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.dark
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(11,12,17,0.08)',
      borderBottomLeftRadius: headerBottomRadius(),
      borderBottomRightRadius: headerBottomRadius(),
      overflow: 'hidden',
    },
    subBack: {
      fontSize: 14,
      color: theme.colors.secondary,
      paddingVertical: 4,
      paddingRight: 10,
    },
    subTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
  });
};

// 底部 4 个 Tab 的图标（用户提供的玻璃质感图，base64 内嵌小图）
type TabIcon = string;
// 底部 Tab 图标：浅色用原图；深色用压暗版（去掉浅色玻璃在深色底上的白光晕）
const tabIconsFor = (dark: boolean): Record<TabKey, TabIcon> => {
  const src = dark ? tabIconDark : tabIconSmall;
  return {
    home: src.home,
    models: src.models,
    more: src.more,
    profile: src.profile,
  };
};

// 单个胶囊 Tab：iOS 27 风格的物理弹簧（damping/stiffness 而不是旧式 speed/bounciness）
const PillItem: React.FC<{
  label: string;
  icon: TabIcon;
  isActive: boolean;
  theme: Theme;
  styles: ReturnType<typeof createTabStyles>;
  onPress: () => void;
  /** 按下去时把触点回传出去，用来在胶囊上散开光效 */
  onTouchLight?: (e: any, fallbackLocalX: number) => void;
  /** 布局测量：把自身在胶囊内容区里的 x/width 上报父级，驱动滑动指示器 */
  onMeasure?: (x: number, width: number) => void;
}> = ({
  label,
  icon,
  isActive,
  theme,
  styles,
  onPress,
  onTouchLight,
  onMeasure,
}) => {
  // 记下自己在胶囊里的位置：万一事件里拿不到 pageX，就用它当退路
  const itemBox = React.useRef({x: 0, w: 0});
  // 选中放大 —— 严格用 BAVoice 的 TAB_STATE.selectedScale（1.08）。
  // 初值也必须用同一个数，否则首帧会从 1.1 弹到 1.08，有一跳。
  const activeScale = React.useRef(
    new Animated.Value(isActive ? TAB_STATE.selectedScale : 1),
  ).current;
  // 按下缩放：与全站统一 —— 按住放大、松手回弹。
  const pressScale = React.useRef(new Animated.Value(1)).current;
  const color = isActive
    ? theme.colors.secondary
    : theme.colors.onSurfaceVariant;

  React.useEffect(() => {
    // 对齐 BAVoice：TAB_STATE.selectedScale = 1.08（原来是 1.1）。
    // 用 springFromCompose(0.7, StiffnessMedium) 代替 speed/bounciness，
    // 换算成物理三件套后回弹量才真的对应 dampingRatio 0.7。
    motionSpring(activeScale, {
      toValue: isActive ? TAB_STATE.selectedScale : 1,
      ...SPRING_TAB_ICON,
      useNativeDriver: true,
    }).start();
  }, [activeScale, isActive]);

  const pressIn = () => {
    motionSpring(pressScale, {
      toValue: 1.15,
      // tab 内容放大一圈
      ...SPRING_PRESS,
      useNativeDriver: true,
    }).start();
    // 整条胶囊一起轻微放大
    motionSpring(BAR_PRESS_SCALE, {
      toValue: 1.08,
      ...SPRING_PRESS,
      useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    motionSpring(pressScale, {
      toValue: 1,
      ...SPRING_PRESS,
      useNativeDriver: true,
    }).start();
    motionSpring(BAR_PRESS_SCALE, {
      toValue: 1,
      ...SPRING_PRESS,
      useNativeDriver: true,
    }).start();
  };

  return (
    <TouchableOpacity
      style={[styles.pillItem, isActive ? styles.pillActive : null]}
      onPress={onPress}
      onLayout={e => {
        const {x, width} = e.nativeEvent.layout;
        itemBox.current = {x, w: width};
        onMeasure?.(x, width);
      }}
      onPressIn={e => {
        pressIn();
        // 只用来触发散光，不参与图标的任何表现
        onTouchLight?.(e, itemBox.current.x + itemBox.current.w / 2);
      }}
      onPressOut={pressOut}
      accessibilityRole="button"
      accessibilityState={isActive ? {selected: true} : {}}>
      <Animated.View
        style={{alignItems: 'center', transform: [{scale: pressScale}]}}>
        <Animated.Image
          source={{uri: icon}}
          style={[styles.pillIcon, {transform: [{scale: activeScale}]}]}
        />
        <Text style={[styles.pillLabel, {color}]}>{label}</Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

/**
 * CustomTabBar —— 完全自定义的底部胶囊 Tab 栏（不用 React Navigation 默认 TabBar）。
 *
 * 【为什么不用默认 TabBar】
 *   默认 TabBar 的选中态是「整块变色 + 图标位移」，做不出「一颗胶囊滑过去」的
 *   效果；而且它的 tabBarButton 会拦手势、样式穿透麻烦。这里自己画：
 *   Tab 仍按 flex:1 等宽平分，选中背景是一颗绝对定位的「指示器胶囊」，
 *   垫在图标下面滑。切换时只动 translateX，零布局重排，原生驱动，不卡。
 *
 * 【Android 10 低端机的取舍】
 *   · 不用 @react-native-screens/blur 之类的重型模糊库 —— 它们在新架构 +
 *     低端 GPU 上掉帧明显。玻璃感靠「半透明底 + 高光渐变 + 光带」画出来，
 *     这部分在 MainTabs（LiquidGlass / GlassSheen / TouchLight）。
 *   · 动画只用 transform / opacity，native driver；不动 width/height
 *     （新架构下 Animated 不支持，见 moveIndicator 注释）。
 *
 * 【交互】
 *   · 选中：浅蓝胶囊背景滑过去（LiquidIndicator 弹簧，带轻微过冲），
 *          图标 spring 放大 1.08 倍（BAVoice 的 TAB_STATE.selectedScale）、颜色变深
 *   · 未选中：背景透明、图标原样
 *   · 按下：图标轻微压缩到 0.88，松手弹簧回弹（见 PillItem）
 */

const CustomTabBar: React.FC<{
  tabs: {key: TabKey; label: string; icon: TabIcon}[];
  activeKey: TabKey;
  onSelect: (key: TabKey) => void;
  styles: ReturnType<typeof createTabStyles>;
  /** 选中胶囊的浅蓝背景色（按主题/液态玻璃开关由外部算好传入） */
  indicatorColor: string;
  onTouchLight?: (e: any, fallbackLocalX: number) => void;
  /**
   * 外层的手势水平位移（PanResponder 实时驱动，松手后弹回 0）。
   * 指示器位置 = 基准位置 + panX × (tab间距/屏宽)，实现「跟着手指走」。
   */
  panX?: Animated.Value;
  screenWidth: number;
}> = ({
  tabs,
  activeKey,
  onSelect,
  styles,
  indicatorColor,
  onTouchLight,
  panX,
  screenWidth,
}) => {
  const theme = useTheme();
  const tabBoxes = React.useRef<
    Partial<Record<TabKey, {x: number; w: number}>>
  >({});
  // 基准位置：切 Tab 时 200ms ease-in-out 滑到目标 Tab
  const baseX = React.useRef(new Animated.Value(0)).current;
  const indReady = React.useRef(false);
  // 指示器宽度用「百分比 + content-box padding」而不是测量值：「模型」页
  // 底栏右侧要让位给添加按钮（pillBarShifted），bar 变窄、tab 也跟着窄。
  // 用测量值校正不可靠（useEffect 比 onLayout 先跑），实测出现过指示器
  // 留着旧宽度、宽得盖住两三个 tab。百分比相对 wrap，bar 宽窄自动跟随，
  // 从根上不会错；padding 用 content-box 向左右各撑 4dp，视觉上更「托住」
  // 当前项（content-box 下 padding 不计入 width，border-box = 25% + 8）。
  const [tabSpacing, setTabSpacing] = React.useState(0);
  const activeRef = React.useRef(activeKey);
  activeRef.current = activeKey;
  const IND_WIDEN = 8;
  const itemPercent = `${100 / tabs.length}%` as `${number}%`;

  // 手势偏移比例：内容滑一屏（screenWidth）对应指示器滑一个 Tab 间距。
  // 注意是**减**：手指左滑时内容左移（右侧的下一个 Tab 露出来），指示器
  // 应该朝右（下一个 Tab 的方向）走 —— 两者方向相反才是正确的跟手。
  // 之前写成加号，蓝胶囊会和内容同向移动，看起来完全不对。
  const ratio =
    tabSpacing > 0 && screenWidth > 0 ? tabSpacing / screenWidth : 0;
  const indicatorX = React.useMemo(() => {
    if (panX && ratio > 0) {
      return Animated.subtract(baseX, Animated.multiply(panX, ratio));
    }
    return baseX;
  }, [baseX, panX, ratio]);

  const moveIndicator = React.useCallback(
    (key: TabKey, animate: boolean) => {
      let box = tabBoxes.current[key];
      // 兜底：这个 Tab 还没 onLayout（或被原生玻璃视图吞了布局回调）时，
      // 用已测量 Tab 的宽度按等宽估算位置。没有这个兜底，一旦测量不到，
      // 指示器会停在 width=0 / x=0，表现为「只有透明、没有滑动」。
      if (!box) {
        const measured = (Object.keys(tabBoxes.current) as TabKey[])
          .map(k => tabBoxes.current[k])
          .filter(Boolean) as {x: number; w: number}[];
        if (measured.length > 0) {
          const w = measured[0].w;
          const idx = tabs.findIndex(t => t.key === key);
          box = {x: idx * w, w};
        } else {
          return;
        }
      }
      if (box.w > 0) {
        setTabSpacing(box.w);
      }
      if (!animate || !indReady.current) {
        // 首次定位不走动画：避免冷启动时指示器从左边滑进来。
        // 减 IND_WIDEN/2：content-box 下 padding 向右撑，border-box 左缘贴着
        // 布局左缘；不减这 4dp，胶囊整体右偏 4dp，中心对不上图标中心。
        baseX.setValue(box.x - IND_WIDEN / 2);
        indReady.current = true;
        return;
      }
      // 对齐 BAVoice：液态指示器用 LiquidIndicator
      //（dampingRatio 0.62 / StiffnessLow）——低阻尼，滑到位时会**过冲**
      // 一点点再收回，是「液体被甩过去」的观感，而不是匀速滑到底。
      // 原来 200ms Easing.inOut(Easing.ease) 收尾干脆但显得「硬」。
      motionSpring(baseX, {
        toValue: box.x - IND_WIDEN / 2,
        ...SPRING_LIQUID_INDICATOR,
        useNativeDriver: false,
      }).start();
    },
    [baseX, tabs],
  );

  const onTabMeasure = React.useCallback(
    (key: TabKey, x: number, width: number) => {
      const prev = tabBoxes.current[key];
      tabBoxes.current[key] = {x, w: width};
      if (width > 0) {
        setTabSpacing(width);
      }
      if (key !== activeRef.current) {
        return;
      }
      // 当前 Tab 的位置/宽度变了就重算一次。最典型的场景：切到「模型」页时
      // 底栏右侧要让位给「添加模型」按钮（pillBarShifted），bar 变窄、tab
      // 变窄 —— 而 React 的 useEffect 比 onLayout 先跑，moveIndicator 用的
      // 是旧宽度，指示器就停在错的位置上。这里补一次无动画校正。
      // 只在手势已归位（panX 回到 0）时校正，避免拖拽中途被瞬移打断。
      const boxChanged = !prev || prev.x !== x || prev.w !== width;
      const settled = !panX || (panX as any).__getValue?.() === 0;
      if (!indReady.current || (boxChanged && settled)) {
        moveIndicator(key, false);
      }
    },
    [moveIndicator, panX],
  );

  // 切 Tab → 指示器平滑滑过去。延一帧再算：bar 的宽窄变化
  // （pillBarShifted）要先反映到各 Tab 的 onLayout / tabBoxes，
  // 否则用的是切换前的旧测量值，位置会偏。
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => {
      moveIndicator(activeKey, indReady.current);
    });
    return () => cancelAnimationFrame(raf);
  }, [activeKey, moveIndicator]);

  // 液态拉伸：严格对齐 BAVoice 的 Motion.kt ——
  //     stretch = (1 + distance * 0.18).coerceAtMost(1.18)
  // 其中 distance = |panX| / tabSpacing，即「拖过了几个 Tab 的宽度」。
  //
  // ⚠️ 两个关键点，之前都写错了：
  //   1) 必须是**线性**的：1 + d*0.18。原来写成 travel²*0.18，
  //      拖动前半程几乎不拉伸、后半程突然暴起，液体的连续性断了。
  //   2) 必须**钳到 1.18**。原来没有上限，快速甩动时 travel 可以到 3~4，
  //      胶囊会被拉成一条横贯整栏的细线，完全不是液体的样子。
  //
  // 用 interpolate 的 clamp 实现：在 ±1 个 Tab 距离内线性增长，
  // 超过就锁死在 stretchMax。
  const indicatorScaleX = React.useMemo(() => {
    if (!panX || tabSpacing <= 0) {
      return undefined;
    }
    const travel = Animated.divide(panX, tabSpacing);
    return travel.interpolate({
      inputRange: [-2, -1, 0, 1, 2],
      outputRange: [
        LIQUID.stretchMax,
        1 + LIQUID.stretchPerTab,
        1,
        1 + LIQUID.stretchPerTab,
        LIQUID.stretchMax,
      ],
      extrapolate: 'clamp',
    });
  }, [panX, tabSpacing]);

  return (
    <View style={styles.pillItemsWrap}>
      {/* 指示器垫在图标下面；pointerEvents 关掉，不拦点击 */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pillIndicator,
          {
            backgroundColor: indicatorColor,
            width: itemPercent,
            paddingHorizontal: IND_WIDEN / 2,
            // content-box：padding 向左右各撑 4dp，不计入 width，
            // 所以 border-box = 一个 tab 宽 + 8，且随 bar 宽窄自适应
            boxSizing: 'content-box',
            transform: [
              {translateX: indicatorX},
              ...(indicatorScaleX ? [{scaleX: indicatorScaleX}] : []),
            ],
          },
        ]}
      />
      {tabs.map(tab => (
        <PillItem
          key={tab.key}
          label={tab.label}
          icon={tab.icon}
          isActive={tab.key === activeKey}
          theme={theme}
          styles={styles}
          onPress={() => onSelect(tab.key)}
          onTouchLight={onTouchLight}
          onMeasure={(x, w) => onTabMeasure(tab.key, x, w)}
        />
      ))}
    </View>
  );
};

/**
 * 触碰光效：手指按到胶囊栏时，从触点向外散开一大片纯白光，逐渐消失。
 *
 * 用 3 个同心圆叠出「径向渐变」的柔和衰减（react-native-linear-gradient
 * 只支持线性，做不出径向），整组只动 scale + opacity，走原生驱动。
 * 父级 overflow:hidden 会把它裁在胶囊里，所以看起来是光在玻璃里扩散。
 */
const TOUCH_LIGHT_R = 240; // 最大扩散半径（dp）—— 放得很大，扫过整个胶囊

const TouchLight: React.FC<{
  x: number;
  dark: boolean;
  onDone: () => void;
}> = ({x, dark, onDone}) => {
  const t = React.useRef(new Animated.Value(0)).current;
  // onDone 放进 ref，避免它变化导致动画重跑
  const doneRef = React.useRef(onDone);
  doneRef.current = onDone;

  React.useEffect(() => {
    // ⚠️ 这里必须去掉 easing。
    //
    // RN 0.82 新架构下：Animated.timing 同时带 easing + useNativeDriver:true
    // 时，驱动层会报
    //   "Interpolation property 'easing' is not supported by native animated module"
    // （E 级警告，出现在 Metro 黄色浮层里）。
    //
    // 替代方案：把「慢起快停」的曲线换成**分段线性**——
    // 前 55% 的时间走完 88% 的进度（快），后 45% 走完剩下 12%（慢收）。
    // 肉眼与原来的 Easing.out(cubic) 几乎无差别，但完全落在原生驱动
    // 支持的能力范围内。总时长仍是 1200ms，观感不变。
    Animated.sequence([
      motionTiming(t, {
        toValue: 0.88,
        duration: 660,
        useNativeDriver: true,
      }),
      motionTiming(t, {
        toValue: 1,
        duration: 540,
        useNativeDriver: true,
      }),
    ]).start(() => doneRef.current());
  }, [t]);

  // 光斑用一张「径向渐变贴图」来画，而不是叠同心圆。
  // 原因：每个圆都是实心硬边，层与层之间必然留台阶，叠多少层都消不掉；
  // 贴图是真正连续的渐变，缩放到 480dp 也不会有分层。
  // 贴图本身是满 alpha 的白，峰值亮度由下面 glow 的 opacity 控制。
  // 注意：胶囊底色已接近纯白（#FAFCFF），白光铺在空白处几乎看不出，
  // 真正显形的是它扫过深色图标和文字、把内容冲淡的那一刻。

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        touchLightStyles.wrap,
        {
          left: x - TOUCH_LIGHT_R,
          opacity: t.interpolate({
            // 前 10% 淡入，后面一路淡出到底，尾巴拉长、消失得自然
            inputRange: [0, 0.1, 0.55, 1],
            outputRange: [0, 1, 0.45, 0],
          }),
          transform: [
            {
              scale: t.interpolate({
                inputRange: [0, 1],
                outputRange: [0.12, 1],
              }),
            },
          ],
        },
      ]}>
      <Animated.Image
        source={require('./src/assets/effects/touchGlow.png')}
        style={[touchLightStyles.glow, {opacity: dark ? 0.34 : 0.72}]}
        resizeMode="cover"
      />
    </Animated.View>
  );
};

const touchLightStyles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: '50%',
    marginTop: -TOUCH_LIGHT_R,
    width: TOUCH_LIGHT_R * 2,
    height: TOUCH_LIGHT_R * 2,
  },
  glow: {
    width: '100%',
    height: '100%',
  },
});

/**
 * 液态玻璃上的「流动光效」。
 *
 * 做法：一条斜向的白色渐变光带，在胶囊内从左到右缓慢扫过，
 * 扫完停一会儿再重来。整段动画只动 translateX，走原生驱动，
 * 不产生任何 JS 帧开销。
 *
 * 父容器必须 overflow: hidden（pillBarGlass 已经有），光带才会被裁在胶囊里。
 */
// 底部 Tab 类型
type TabKey = 'home' | 'models' | 'more' | 'profile';

/** 底部 4 个 Tab 的顺序：手势左右滑、切换方向判定都用这一份 */
const TAB_KEYS: TabKey[] = ['home', 'models', 'more', 'profile'];

/**
 * 转场时的「地板透明度」：淡出只淡到这个值，绝不淡到 0。
 *
 * 淡到 0 的那一帧整屏内容消失，露出页面底色（浅色主题 #FAF9FF），
 * 肉眼看就是「先闪一下白屏，然后才有动画」。留 0.45 的内容在，
 * 观感变成「快速压暗一下再弹回来」，既没有白闪也还有转场感。
 */
const PAGE_FADE_FLOOR = 0.45;
/** 转场 busy 的兜底复位时间：比两段动画总时长（80 + 220 = 300ms）多一点 */
const TRANSITION_FALLBACK_MS = 700;

/**
 * 二级页顶部栏 —— 形式与主页完全一致：
 * 同样的底色规则（液态玻璃/磨砂/普通）、同样的高度与内边距、
 * 同样的底部圆角与下间距、同样的标题字号字重。
 *
 * 左侧是「返回」，右侧可以塞一个模块按钮。它**不作为导航头**，
 * 而是由页面自己当作内容的第一个子元素渲染，所以向上翻页时会跟着滚走。
 */
const SubPageHeader: React.FC<{
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
}> = observer(({title, onBack, right}) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const liquidGlass = uiStore.themeStyle === 'liquid-glass';
  const subStyles = createTabStyles(theme, liquidGlass);

  // 与主屏幕顶部栏（headerFor）**完全同构**：同一个 SurfaceCard、同一套
  // 几何（高度/内边距/下圆角/下间距）、同一段光效 —— 保证液态玻璃风格下
  // 二级页顶栏和主页顶栏看起来是同一块玻璃，不会一个高一个低、一个透一个实。
  return (
    <SurfaceCard
      style={[
        subStyles.header,
        {
          height: HEADER_HEIGHT + insets.top + HEADER_EXTRA,
          paddingTop: insets.top,
          paddingBottom: HEADER_EXTRA,
        },
      ]}>
      {uiStore.sheenEffect ? (
        <>
          <View pointerEvents="none" style={subStyles.pillBarHighlight}>
            <LinearGradient
              colors={
                theme.dark
                  ? [
                      'rgba(248,250,252,0)',
                      'rgba(248,250,252,0.2)',
                      'rgba(248,250,252,0)',
                    ]
                  : [
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.45)',
                      'rgba(255,255,255,0)',
                    ]
              }
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <GlassSheen dark={theme.dark} />
        </>
      ) : null}
      {onBack ? (
        <BackButton onPress={onBack} iconSize={HEADER_ICON_SIZE} />
      ) : null}
      <Text style={subStyles.headerTitle}>{title}</Text>
      <View style={subStyles.headerSpacer} />
      {right}
    </SurfaceCard>
  );
});

/**
 * 「模型管理」二级页入口：把 SubPageHeader 作为页面内容的第一个子元素
 * 传给 ModelsScreen（它会把 header 放进 FlatList 的 ListHeaderComponent，
 * 随内容一起滚走），不再走导航器级 header —— 后者会在状态栏区域额外
 * 垫高，和 SubPageHeader 自带的 insets.top 叠加造成顶部错位。
 */
const ModelsScreenWithSubHeader: React.FC = () => {
  const navigation = useNavigation<any>();
  return (
    <ModelsScreen
      header={
        <SubPageHeader
          title="模型管理"
          onBack={() => navigation.goBack()}
          right={<ModelsHeaderRight />}
        />
      }
    />
  );
};

// 自定义底部 4 Tab 导航（首页/模型/更多/我的），悬浮胶囊样式，零额外依赖
const MainTabs: React.FC = observer(() => {
  const [activeTab, setActiveTab] = React.useState<TabKey>('home');
  const [moreSub, setMoreSub] = React.useState<MoreKey>('list');
  const [homeSub, setHomeSub] = React.useState<'main' | 'chat'>('main');
  const navigation = useNavigation<any>();
  const theme = useTheme();
  // 液态玻璃：由「界面风格 → 液态玻璃」统一控制
  const liquidGlass = uiStore.themeStyle === 'liquid-glass';
  const tabStyles = createTabStyles(theme, liquidGlass);
  const isFocused = useIsFocused();
  // 状态栏已设为 translucent（见文件顶部 <StatusBar>），App 会画到状态栏底下，
  // 所以这里的 insets.top 就是系统状态栏的真实高度，用它给顶部栏让位，
  // 文字和图标的位置保持不变。
  const insets = useSafeAreaInsets();
  // 内容层的两个动画量，**刻意全程保持 JS 驱动**（useNativeDriver: false）。
  //
  // 原因：跟手拖动必须逐帧 setValue。而一个 Animated.Value 一旦被
  // setValue 写过，再拿它去跑 useNativeDriver:true 的动画会直接抛错
  // （"AnimatedValue has been moved to native"），动画不执行、值就
  // **永久停在偏移位置** —— 表现正是「所有页面 UI 都错位」。
  // （之前 panDX 被 setValue 之后又用原生驱动播归位动画，就是这个坑。）
  //
  // 位移只挂在这一层薄壳上，不触发内容重建，JS 驱动的开销可以忽略。
  // 真正的卡顿从来不是动画本身，而是新页面 mount 那一瞬的阻塞。
  const contentOpacity = React.useRef(new Animated.Value(1)).current;
  // 指示器的手势偏移：只喂给 CustomTabBar 内部的插值，不直接上屏，
  // 所以它可以继续走原生驱动（不进布局树、不引发重渲染）。
  const panX = React.useRef(new Animated.Value(0)).current;
  const exitOpacity = React.useRef(new Animated.Value(1)).current;
  const transitionBusy = React.useRef(false);
  // transitionBusy 的兜底定时器：防止它因为卡顿/被打断而永久停在 true，
  // 那会让所有二级页打不开、返回键失效。
  const busyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // 二级页转场专用位移。和 panDX 分开：
  // panDX 被手势 setValue 逐帧写过，永远只能是 JS 驱动；二级页转场
  // 不需要跟手，用独立的 subDX 就能全程原生驱动，不再和 mount 抢线程。
  const subDX = React.useRef(new Animated.Value(0)).current;

  // ── 左右翻页（pager）──────────────────────────────────────────
  // 同一时刻渲染两页，两个**固定槽位**（slot0 / slot1）各自铺满整屏、
  // 位移互补，任何拖动进度下都拼满 —— 白屏从结构上不可能再发生。
  //
  // 为什么是「固定槽位 + 前后互换」而不是「当前页/目标页」两个变量：
  // 后者在翻页收尾时必须把目标页从槽位 B 搬到槽位 A，React 做不到，
  // 只能卸载重挂 —— 那一下既跳位又会把两页短暂叠在一起（实测可见）。
  // 固定槽位下，目标页一直待在原槽位不动，翻完只把 frontSlot 指针一翻，
  // **组件实例原地复用**：不卸载、不重挂、不跳位、不叠加。
  const [slots, setSlots] = React.useState<[TabKey | null, TabKey | null]>([
    'home',
    null,
  ]);
  // 哪个槽位是当前页。另一个槽位就是翻页时的目标页位置。
  const [frontSlot, setFrontSlot] = React.useState<0 | 1>(0);
  // 正在翻页吗？翻页时两个槽位都要可见；翻完/取消后，备用槽位
  // display:none（不参与布局、不渲染，但**组件实例仍在**，所以来回滑
  // 零挂载）。参考图里被挤走的那页就是留在屏外不卸载的。
  const [flipping, setFlipping] = React.useState(false);
  // 两个槽位的 X 位移。注意 slotX1 的初值必须是 **+屏宽**，不能是 0：
  // 两个槽位都铺满整屏，如果初始都在 0，两块页面会完全重叠，
  // 表现为首页白屏（实测就是这个）。备用槽停在屏幕外，翻页时只改
  // transform，布局早已算好，成本几乎为零。
  const slotX0 = React.useRef(new Animated.Value(0)).current;
  const slotX1 = React.useRef(new Animated.Value(screenWidth)).current;
  const slotX = React.useMemo<[Animated.Value, Animated.Value]>(
    () => [slotX0, slotX1],
    [slotX0, slotX1],
  );
  // 翻页方向与进度（0=没在翻）。用 ref 存：手势回调里要同步读，
  // 放 state 会慢一帧，跟手立刻就不跟了。
  const dragDir = React.useRef<-1 | 0 | 1>(0);
  const dragProgress = React.useRef(0);
  const pageWidth = screenWidth;

  // 页面切换 = 方向感「翻页」：
  //   前进（进子页）从右侧滑入，返回（‹ 返回）从左侧滑入。
  //   先「压暗 + 反向微位移」，切换内容后再「弹亮 + 归位」。
  //
  // 三条铁律（都是踩过坑换来的，别改回去）：
  //
  // 1) 动画一律 useNativeDriver: false。位移层必须 setValue（跟手），
  //    一旦和原生驱动混用会抛 "has been moved to native"，动画不执行、
  //    值永久停在偏移位置 = 整页 UI 错位。
  // 2) opacity 绝不归零。归零那一帧整屏透明、露出页面底色（浅色主题
  //    #FAF9FF），就是「闪一下白屏」。入场交给 Entrance 的 0.55 地板透明度。
  // 3) 不用 React.startTransition。它会把一次渲染拆成多片提交，每片都要
  //    重新布局 —— 主观感受是「卡好几下」，比不切更糟。
  const transitionContent = (
    update: () => void,
    direction: -1 | 1 = 1,
    enterKey: string = 'home',
  ) => {
    // 动画全关：直接换内容，不播任何淡入淡出 / 位移
    if (!MOTION_ENABLED) {
      update();
      return;
    }
    // ⚠️ transitionBusy 必须「一定」会被复位。
    // 旧实现在两层动画回调的末尾才置回 false，中间还夹了一个
    // requestAnimationFrame —— 卡顿导致那一帧迟迟不来、或者动画被
    // 新一次手势打断，busy 就永久停在 true，之后所有二级页都打不开、
    // 返回键也失效（用户实测「打开了退不出来」）。
    // 现在改成「无条件兜底」：无论如何都在安全时间内复位。
    if (transitionBusy.current) {
      return;
    }
    transitionBusy.current = true;
    if (busyTimer.current) {
      clearTimeout(busyTimer.current);
    }
    busyTimer.current = setTimeout(() => {
      transitionBusy.current = false;
      busyTimer.current = null;
    }, TRANSITION_FALLBACK_MS);

    // 进子页时页面上只剩当前这一页，把备用槽位收起来（否则两页同时在场）
    setFlipping(false);

    // ⚠️ 光 setFlipping(false) 不够，必须把 slotX 也归位。
    //
    // 二级页只有**一个**页面在场。如果此刻正好有翻页在途中
    //（用户一边拖一边点卡片，或者上次翻页的弹簧还在收尾），
    // slotX[frontSlot] 会停在 -屏宽*进度 上 —— 于是二级页带着这个偏移
    // 显示，左边露白、内容整体错位。
    //
    // 这里的归位是「收拢到单页」的语义：前台归 0、备用槽推到屏外，
    // 不改变 frontSlot，所以显示的仍然是当前页。
    closeFlipGate();
    dragDir.current = 0;
    dragProgress.current = 0;
    slotX[0].stopAnimation();
    slotX[1].stopAnimation();
    slotX[frontSlot].setValue(0);
    slotX[frontSlot === 0 ? 1 : 0].setValue(pageWidth);
    panX.stopAnimation();
    panX.setValue(0);

    // ⚠️ 只用一段动画，别拆成「退场 + 入场」两段。
    //
    // 两段的写法要求第二段用 fromValue 指定起点，而**原生驱动的
    // Animated.Value 不支持 fromValue**（会被静默忽略），也没有 setValue
    // 可用（一写就退化成 JS 驱动）。实测结果就是：第二段起点错、第一段的
    // 残留值还挂着，subDX 卡在错误位移上，页面看着「没切换」——
    // 也就是点卡片打不开二级页。
    //
    // 合成一段之后，起点由当前值自然承接、终点明确，全程原生驱动。
    // 入场动画交给 Entrance 自己做（它已经按 screenKey 精确重播）。
    // ⚠️ 顺序很重要：先 update() 改 React state，**等这一批 state 提交完**
    // 再动 MobX。以前把 uiStore.replayScreenEnter() 紧跟在 update() 后面
    // 同步执行，MobX 的 observer 通知会插进 React 的批处理中间，
    // 把 setActiveTab / setMoreSub 这批更新搅乱 —— 表现就是
    // 「对话、生成图片能打开（它们不走这条路），其他卡片全打不开」。
    update();
    // 方向性转场：对齐 BAVoice 的 slideHorizontal。
    //
    // 原实现虽然收了 direction 参数，但**完全没用**——进退场都只把 subDX
    // 从当前值抹到 0，等于「所有二级页都从同一个方向出现」。BAVoice 的
    // 规则是：前进时新页从右侧推入、旧页左移 1/4；返回时反过来。
    //
    // 这里把方向落到 subDX 的起始值上：
    //   direction = +1（前进）→ subDX 从 +屏宽*0.25 出发，滑到 0
    //   direction = -1（返回）→ subDX 从 -屏宽*0.25 出发，滑到 0
    // 与此同时 opacity 从 0.45 抬到 1（不用 0，避免露出页面底色造成白闪）。
    subDX.stopAnimation();
    subDX.setValue(direction * pageWidth * Math.abs(OFFSET.hExit));
    contentOpacity.stopAnimation();
    contentOpacity.setValue(PAGE_FADE_FLOOR);

    Animated.parallel([
      motionTiming(contentOpacity, {
        toValue: 1,
        duration: TRANSITION.subPage,
        easing: EASE.emphasizedDecelerate,
        // ⚠️ 必须是 false：上面刚对 contentOpacity 做过 setValue。
        // 一个 Animated.Value 一旦被 setValue 写过，再拿它跑
        // useNativeDriver:true 会抛 "AnimatedValue has been moved to native"，
        // 动画不执行、值永久停在 0.45 透明度 —— 表现为整页发灰。
        useNativeDriver: false,
      }),
      motionTiming(subDX, {
        toValue: 0,
        duration: TRANSITION.subPage,
        easing: EASE.emphasizedDecelerate,
        // 同理：subDX 被 setValue 指定起点，只能走 JS 驱动。
        useNativeDriver: false,
      }),
    ]).start(() => {
      // state 已提交，这时再通知入场动画重播（只影响目标页）
      uiStore.replayScreenEnter(enterKey);
      // 正常收尾：清掉兜底定时器
      if (busyTimer.current) {
        clearTimeout(busyTimer.current);
        busyTimer.current = null;
      }
      transitionBusy.current = false;
    });
  };

  const switchHomeSub = (k: 'main' | 'chat') => {
    transitionContent(() => setHomeSub(k), k === 'main' ? -1 : 1, 'home');
  };

  const switchMoreSub = (k: MoreKey) => {
    // 「云端AI服务」的配置项就在设置页里，不再单独建一个子页
    if (k === 'cloudApi') {
      navigation.navigate(ROUTES.SETTINGS);
      return;
    }
    transitionContent(() => setMoreSub(k), k === 'list' ? -1 : 1, 'more');
  };

  const [moreSubFromHome, setMoreSubFromHome] = React.useState(false);
  const openMoreSub = (k: MoreKey, fromHome = false) => {
    transitionContent(
      () => {
        setActiveTab('more');
        setHomeSub('main');
        setMoreSub(k);
        setMoreSubFromHome(fromHome);
        // ⚠️ slots 也必须同步。渲染层读的是 slots[i] 而不是 activeTab，
        // 不同步的话 activeTab 变了、槽位还是旧的 —— 表现就是
        // 「点了卡片、state 也执行了，但页面不切换」。
        // 这里只有一页在场（另一个槽位留着当返回缓存），
        // 位移归位：前台槽 0、备用槽 +屏宽。
        setSlots(['more', null]);
        setFrontSlot(0);
        setFlipping(false);
        slotX[0].setValue(0);
        slotX[1].setValue(pageWidth);
      },
      1,
      // 用二级页名当 key，只有这一页的 Entrance 会重播
      k,
    );
  };
  // 从二级页返回：如果是从首页进来的，回首页；否则回更多 tab 的 list
  const backFromMoreSub = () => {
    const goHome = moreSubFromHome;
    transitionContent(
      () => {
        setMoreSub('list');
        if (goHome) {
          setActiveTab('home');
          setMoreSubFromHome(false);
        }
        // 同步槽位（渲染层读的是 slots[i] 不是 activeTab）
        const target: TabKey = goHome ? 'home' : 'more';
        setSlots([target, null]);
        setFrontSlot(0);
        setFlipping(false);
        slotX[0].setValue(0);
        slotX[1].setValue(pageWidth);
      },
      -1,
      goHome ? 'home' : 'more',
    );
  };

  /** 切到某个 Tab 时的状态落地（点击和手势共用） */
  const applyTab = (key: TabKey) => {
    setActiveTab(key);
    setHomeSub('main');
    if (key !== 'more') {
      setMoreSub('list');
    }
  };

  /**
   * 翻页动画是否正在跑。
   *
   * ⚠️ 这个闸门是必需的，不是可选优化。
   *
   * 背景：翻页补完动画用的是 **spring**，它的尾巴比 tween 长得多
   * （tween 固定 320ms，spring 常常要 500–800ms 才算收敛）。尾巴期间
   * `flipping` 仍是 true、两页都参与渲染、slotX 还在被逐帧写入。
   *
   * 如果这段时间里用户又拖了一下：
   *   · onPanResponderMove 会看到 dragDir !== 0 → 跳过 startFlip
   *     → startFlip 里的 `stopAnimation()` 不会执行
   *   · 但 move 回调里的 `slotX[...].setValue(...)` 照样在写
   *   → 旧的 spring 和新的 setValue 同时操作同一个 Animated.Value，
   *     值互相覆盖，位置错乱。
   *
   * 换 tween 时这个窗口短到几乎踩不到，所以是「偶尔」出现；
   * 换 spring 后窗口变长，问题才暴露出来。
   *
   * 有了 flipRunning 这道闸门：动画没落定之前不允许发起新翻页，
   * 新手势直接被忽略，等价于「动画期间底栏不可点」——这也符合翻页动画
   * 期间本就不该接受新交互的直觉。
   */
  const flipRunning = React.useRef(false);
  /**
   * 「补完动画正在收尾」的同步标记。
   *
   * 和 flipRunning 的区别：
   *   flipRunning 由 animateFlip 置位、动画回调复位；
   *   settling 专门用来挡住**新手势**，在 applyDrag 里同步判断。
   *
   * 为什么还要单独一个：flipGateTimer 的 900ms 兜底会在弹簧可能还没收敛时
   * 就把 flipRunning 清掉。那个瞬间如果用户又开始拖，applyDrag 会看到
   * dragDir === 0，误以为「空闲」→ 直接 startFlip → 而旧弹簧仍在写 slotX
   * → 两页位置互相覆盖，就是用户看到的「页面错乱」。
   * 这里在收尾期间同步拒绝新手势，从源头断掉并发写入。
   */
  const settling = React.useRef(false);
  // 闸门兜底定时器：spring 回调在极端情况下（动画被系统挂起、App 切后台、
  // Native 崩溃重启 JS）可能永远不来。没有兜底的话 flipRunning 会卡在
  // true 永不翻转，表现为「翻页功能彻底失灵，比错乱更难接受」。
  const flipGateTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const closeFlipGate = React.useCallback(() => {
    if (flipGateTimer.current) {
      clearTimeout(flipGateTimer.current);
      flipGateTimer.current = null;
    }
    flipRunning.current = false;
    // ⚠️ 兜底路径也要清 settling，否则一旦定时器先于回调触发，
    // settling 会永远停在 true，翻页再也起不来。
    settling.current = false;
  }, []);

  React.useEffect(
    () => () => {
      if (flipGateTimer.current) {
        clearTimeout(flipGateTimer.current);
      }
    },
    [],
  );

  /** 翻页动画结束：把 frontSlot 指针翻到目标页所在的槽位。
   *
   * ⚠️ 三条铁律：
   * 1) 绝对不能顺手复位 slotX —— setValue 是同步的、setState 是异步的，
   *    在 React 提交前那一帧两页会被一起拉回原位 visibly 重叠（旧 bug）。
   * 2) 旧槽位**不清空**。它留着当「返回缓存」，于是 home↔models 来回滑
   *    第二次开始零挂载 —— 这正是参考图里那种随手滑的感觉。
   * 3) 目标页原地不动、位移本来就是 0，所以只是指针一翻，组件实例复用。
   */
  const finishFlip = React.useCallback(
    (key: TabKey) => {
      setFrontSlot(frontSlot === 0 ? 1 : 0);
      setFlipping(false);
      applyTab(key);
      dragDir.current = 0;
      dragProgress.current = 0;
      // ⚠️ 这里**不要**调 uiStore.replayScreenEnter()。
      // 翻页过程里两页都是 active=false（Entrance 不播动画），翻完也不该
      // 再补播一次 —— 那正是用户看到的「翻完后又来一遍旧加载动画」。
    },
    [frontSlot],
  );

  /** 开始一次翻页：把目标页放进「备用槽位」，并摆好两页的起始位移。
   *  当前页此刻仍然满屏在位，只是另一边开始露出目标页 —— 白屏无从出现。 */
  const startFlip = React.useCallback(
    (dir: -1 | 1, target: TabKey) => {
      const back = frontSlot === 0 ? 1 : 0;
      setSlots(prev =>
        prev[back] === target
          ? prev // 备用槽里已经是这一页 → 直接复用，连渲染都不用重
          : (() => {
              const next: [TabKey | null, TabKey | null] = [prev[0], prev[1]];
              next[back] = target;
              return next;
            })(),
      );
      setFlipping(true);
      dragDir.current = dir;
      dragProgress.current = 0;
      slotX[frontSlot].stopAnimation();
      slotX[back].stopAnimation();
      slotX[frontSlot].setValue(0);
      slotX[back].setValue(dir * pageWidth);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frontSlot],
  );

  /** 取消翻页：当前页弹回原位。备用槽里那一页**留着不卸载**，
   *  下次想翻过去时直接复用，等于预热。 */
  const cancelFlip = React.useCallback(() => {
    setFlipping(false);
    dragDir.current = 0;
    dragProgress.current = 0;
    // 闸门复位：补完动画已结束，允许下一次翻页
    closeFlipGate();
  }, [closeFlipGate]);

  /** 统一的全屏左右翻页动画：dir=+1 前进（左滑），-1 后退（右滑）。
   *  两页各自从各自的起点滑到终点，全程严丝合缝铺满屏幕。 */
  const animateFlip = React.useCallback(
    (
      dir: -1 | 1,
      fromProgress: number,
      toProgress: number,
      onDone: () => void,
    ) => {
      const w = pageWidth;
      const cur = slotX[frontSlot];
      const back = slotX[frontSlot === 0 ? 1 : 0];
      // 顺序很重要：先停掉可能还在跑的动画，再把起点摆到当前进度
      // （拖动松手时从手指离开的位置接续，不跳），最后才启动补完动画。
      cur.stopAnimation();
      back.stopAnimation();
      cur.setValue(-dir * w * fromProgress);
      back.setValue(dir * w * (1 - fromProgress));
      // 补完期间上闸：防止用户在这个窗口里再次拖动，
      // 造成「旧弹簧 + 新 setValue」同时写同一个值 → 页面错乱。
      closeFlipGate();
      flipRunning.current = true;
      // 同步挡新手势（applyDrag 里判断）。closeFlipGate 会一起清掉。
      settling.current = true;
      // 兜底：spring 收敛时间上限约 900ms（含过冲尾巴）。
      // 超时无条件放闸，宁可让极端情况下的并发重演，也不能把功能卡死。
      // ⚠️ 这里必须**两个标记一起清**。只清 flipRunning 的话，一旦回调丢失，
      // settling 会永远停在 true —— applyDrag 每次都提前 return，
      // 表现为「翻页彻底失灵」，比错乱更难接受。
      flipGateTimer.current = setTimeout(() => {
        flipRunning.current = false;
        settling.current = false;
        flipGateTimer.current = null;
      }, 900);
      Animated.parallel([
        // ⚠️ 两条动画必须用**完全相同**的弹簧参数。
        //
        // 不变量：back - cur === w（两页始终紧贴，屏幕被铺满）。
        //   cur  = 0 + (-dir*w)*p(t)
        //   back = dir*w + (-dir*w)*p(t)
        //   back - cur = dir*w  →  恒等于 w，**与 p(t) 的形状无关**。
        // 所以换成带过冲的 spring 也不会撕裂；只要两条用同一组参数，
        // 任何时刻的进度 p 都相同，接缝永远严丝合缝。
        //
        // 对齐 BAVoice：翻页吸附用 PagerSnap（dampingRatio 0.82 /
        // StiffnessMediumLow）。相比原来的 320ms tween，末端会有约 1%
        // 的轻微过冲 —— 正是「液态」手感的来源，也是原版的观感。
        motionSpring(cur, {
          toValue: -dir * w * toProgress,
          ...SPRING_PAGER_SNAP,
          useNativeDriver: false,
        }),
        motionSpring(back, {
          toValue: dir * w * (1 - toProgress),
          ...SPRING_PAGER_SNAP,
          useNativeDriver: false,
        }),
      ]).start(({finished}) => {
        // ⚠️ 无论 finished 真假都要放闸。
        // finished=false 通常是被 stopAnimation 打断（比如翻页途中切后台），
        // 此时如果不复位，flipRunning 会永远卡在 true —— 之后所有翻页
        // 都被闸门挡掉，表现为「再也翻不动了」。
        closeFlipGate();
        if (finished) {
          onDone();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frontSlot, closeFlipGate],
  );

  const switchTab = (key: TabKey) => {
    // ── 翻页总开关 ──────────────────────────────────────────────
    //
    // FLIP_ENABLED = false 时：
    //   · 不接管任何滑动翻页手势（内容区、底栏胶囊都不接管）
    //   · 切 Tab 走「直接换页」：一次状态提交换掉内容，不跑双槽位位移
    //   · 入场动画仍然保留（replayScreenEnter → Entrance 淡入上移）
    //
    // 这么做是因为双槽位翻页的边界情况太多（后台切换、手势打断、
    // 动画收尾期并发写入……），任何一个没处理干净就是「页面错乱」。
    // 几何不变量 back - cur === 屏宽 本身是对的，但状态机太脆。
    // 整套代码保留着，改回 true 就能恢复（含底栏拖动）。
    if (!FLIP_ENABLED || !MOTION_ENABLED) {
      if (key === activeTab) {
        if (key === 'home' && homeSub === 'chat') {
          switchHomeSub('main');
        }
        return;
      }
      // 归位：前台槽 0、备用槽推到屏外。备用槽此时不渲染内容，
      // 但仍归位一次，避免残留值影响以后恢复翻页。
      slotX[0].stopAnimation();
      slotX[1].stopAnimation();
      slotX[0].setValue(0);
      slotX[1].setValue(pageWidth);
      setSlots([key, null]);
      setFrontSlot(0);
      setFlipping(false);
      dragDir.current = 0;
      dragProgress.current = 0;
      applyTab(key);
      // 换页后让目标页的内容入场动画重播（这是关掉翻页后唯一的动效）
      uiStore.replayScreenEnter(key);
      return;
    }
    // ⚠️ 有翻页动画正在收尾时，忽略新的 Tab 切换。
    // 上一次的 spring 还在写 slotX，这里直接重排槽位会和它抢同一个
    // Animated.Value，表现为「页面错乱」。等它落定（最多 900ms）即可，
    // 用户感受不到延迟 —— 动画期间本来就不该响应二次输入。
    if (flipRunning.current) {
      return;
    }
    if (key === activeTab) {
      if (key === 'home' && homeSub === 'chat') {
        switchHomeSub('main');
      }
      return;
    }
    const fromIdx = TAB_KEYS.indexOf(activeTab);
    const toIdx = TAB_KEYS.indexOf(key);
    const dir: -1 | 1 = toIdx >= fromIdx ? 1 : -1;

    // 跨多页（例如从侧边栏直接跳）就直切，连翻好几页反而晃眼。
    // 直切时先把旧槽位推到屏幕外，否则新旧两页会在同一帧并排出现。
    if (Math.abs(toIdx - fromIdx) !== 1) {
      // 两个槽位都要停：备用槽可能还挂着上一次翻页的残留动画。
      slotX[0].stopAnimation();
      slotX[1].stopAnimation();
      slotX[frontSlot].setValue(-dir * pageWidth);
      setSlots([key, null]);
      setFrontSlot(0);
      setFlipping(false);
      dragDir.current = 0;
      dragProgress.current = 0;
      // 前台槽（现在是 slot0）归 0，备用槽 slot1 归 +屏宽 ——
      // 都归 0 的话两页会完全重叠，直切也会白屏。
      slotX[0].setValue(0);
      slotX[1].setValue(pageWidth);
      applyTab(key);
      uiStore.replayScreenEnter(key);
      return;
    }

    // 目标页先挂上来，再从 0 翻到 1 —— 和手势拖动走的是同一套动画。
    // 注意这里**不**调 replayScreenEnter：翻页期间两个槽位 active=false，
    // Entrance 本来就不会播，补一次只会让翻完多一轮动画。
    startFlip(dir, key);
    requestAnimationFrame(() => {
      animateFlip(dir, 0, 1, () => finishFlip(key));
    });
  };

  // 物理返回键：对话子页/更多子页先回各自一级页，避免误退出 App
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isFocused) {
        return false;
      }
      // 模型页的「添加模型」FAB 菜单开着时，先收菜单，不切 Tab。
      // 这个标志由 FABGroup 维护 —— 在那里注册监听抢不过祖先组件，
      // 只能在 App 这一层查。
      if (activeTab === 'models' && fabMenuOpen) {
        setFabMenuOpen(false);
        return true;
      }
      if (activeTab === 'home' && homeSub === 'chat') {
        switchHomeSub('main');
        return true;
      }
      if (activeTab === 'more' && moreSub !== 'list') {
        backFromMoreSub();
        return true;
      }
      if (activeTab !== 'home') {
        switchTab('home');
        return true;
      }
      if (transitionBusy.current) {
        return true;
      }
      transitionBusy.current = true;
      // ⚠️ 去掉 easing：RN 0.82 新架构下 timing 带 easing +
      // useNativeDriver:true 会报 "Interpolation property 'easing' is not
      // supported by native animated module"。这里只是退出前 150ms 的
      // 淡出，线性与 in(quad) 的差别在这点时长内看不出来。
      motionTiming(exitOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(({finished}) => {
        if (finished) {
          BackHandler.exitApp();
        } else {
          transitionBusy.current = false;
        }
      });
      return true;
    });
    return () => sub.remove();
    // 依赖不含 backFromMoreSub/switchHomeSub/switchTab 是刻意的：它们是
    // 每次渲染重建的普通函数，加进依赖会让 BackHandler 订阅每帧重挂；
    // activeTab/moreSub 等真实状态变化时 effect 本就会重订阅、拿到新闭包。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, exitOpacity, homeSub, isFocused, moreSub]);

  // 消费「待打开的更多子页」请求。
  // 下载管理等页面（与 MainTabs 同级的 Drawer 页面）想跳进「更多」tab 里的
  // 某个子功能（gptsovits / voiceChange …）时，自己无法直接 navigate 到这些
  // 二级页（它们不是独立路由，只是 MainTabs 的内部 state），只能先
  // uiStore.requestMoreSub(key)，由这里切到更多 tab + 开子页，然后立刻清掉，
  // 避免重复触发。
  React.useEffect(() => {
    const key = uiStore.pendingMoreSub;
    if (!key) {
      return;
    }
    // 先清后开：即使 openMoreSub 内部抛错也不会死循环重触发
    uiStore.clearPendingMoreSub();
    openMoreSub(key as MoreKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiStore.pendingMoreSub]);

  // 更多页的二级页统一壳。
  // 「生成图片」「生成语音」「语音克隆」「音色转换」现在把顶部栏交给页面自己
  // 渲染（放在内容最前面，所以会跟着滚走，和主页一致）；
  // 只有「图像识别」还用这里的固定头部。
  const moreSubShell = (title: string, children: React.ReactNode) => (
    <View style={tabStyles.tabContent}>
      <SubPageHeader title={title} onBack={backFromMoreSub} />
      {children}
    </View>
  );

  // 二级页自带顶部栏的壳（页面负责把 header 放进自己的 ScrollView）
  const subPageShell = (children: React.ReactNode) => (
    <View style={tabStyles.tabContent}>{children}</View>
  );

  const subHeader = (title: string) => (
    <SubPageHeader title={title} onBack={backFromMoreSub} />
  );

  const renderMore = () => {
    // 二级页统一套一层「延迟激活」：首帧让 Entrance 全部停在完成态，
    // 先把整棵组件树 + FlatList 首屏布局画出来，下一帧再统一播入场动画。
    // 低端机上这一步是「进二级页卡一下」和「顺畅浮上来」的分界线。
    const shell = (children: React.ReactNode) => (
      <ScreenActiveProviderDeferred active={moreSub !== 'list'}>
        {children}
      </ScreenActiveProviderDeferred>
    );

    switch (moreSub) {
      case 'vision':
        return shell(moreSubShell('图像识别', <VisionScreen />));
      case 'tts':
        return shell(
          subPageShell(<VoiceScreen header={subHeader('生成语音')} />),
        );
      case 'voiceClone':
        return shell(
          subPageShell(<VoiceCloneScreen header={subHeader('语音克隆')} />),
        );
      case 'voiceChange':
        return shell(
          subPageShell(<VoiceChangeScreen header={subHeader('音色转换')} />),
        );
      case 'gptsovits':
        return shell(
          subPageShell(<GptSovitsScreen header={subHeader('GPT-SoVITS')} />),
        );
      case 'imagegen':
        // 生成图片自己有顶部栏（同样在 ScrollView 内），不需要外壳再包一层
        return shell(subPageShell(<ImageGenScreen />));
      case 'imageEnhance':
        return shell(moreSubShell('图像增强', <ImageEnhanceScreen />));
      case 'cloudApi':
        // 云端服务配置就在设置页里，不重复造壳，由switchMoreSub 直接跳设置
        return null;
      default:
        return (
          <MoreScreen
            header={headerFor('more')}
            onOpen={key => switchMoreSub(key)}
          />
        );
    }
  };

  const renderHome = () => {
    if (homeSub === 'chat') {
      return (
        <View style={tabStyles.tabContent}>
          <ChatScreen onBackToHome={() => switchHomeSub('main')} />
        </View>
      );
    }
    return (
      <HomeScreen
        header={headerFor('home')}
        onStartChat={() => switchHomeSub('chat')}
        onOpenTts={() => openMoreSub('tts', true)}
        onOpenVoiceChange={() => openMoreSub('voiceChange', true)}
        onOpenVoiceClone={() => openMoreSub('voiceClone', true)}
        onOpenVision={() => openMoreSub('vision', true)}
        onOpenGptSovits={() => openMoreSub('gptsovits', true)}
        onOpenImageEnhance={() => openMoreSub('imageEnhance', true)}
        onOpenMore={() => switchTab('more')}
      />
    );
  };

  // 深色模式换压暗版图标，保证两种主题下观感一致
  const tabIcons = tabIconsFor(theme.dark);
  const tabs: {
    key: TabKey;
    label: string;
    icon: TabIcon;
    render: () => React.ReactNode;
  }[] = [
    {
      key: 'home',
      label: '首页',
      icon: tabIcons.home,
      render: renderHome,
    },
    {
      key: 'models',
      label: '模型',
      icon: tabIcons.models,
      render: () => <ModelsScreen header={headerFor('models')} />,
    },
    {
      key: 'more',
      label: '更多',
      icon: tabIcons.more,
      render: renderMore,
    },
    {
      key: 'profile',
      label: '我的',
      icon: tabIcons.profile,
      render: () => <ProfileScreen header={headerFor('profile')} />,
    },
  ];

  const tabByKey = (k: TabKey) => tabs.find(t => t.key === k) ?? tabs[0];
  // 槽位里的页面（可能为空槽）
  const slotPage = (i: 0 | 1) => {
    const k = slots[i];
    return k ? tabByKey(k).render() : null;
  };
  const isSubPage = homeSub === 'chat' || moreSub !== 'list';

  // ── 左右滑动手势切换 Tab（跟手）──────────────────────────────
  // 手指拖着两页一起平移（当前页退场、目标页进场），指示器按比例跟着走；
  // 松手时位移过三成（或甩得快）就翻过去，否则弹回原位。
  // 只在主 Tab 页启用手势；子页（对话 / 更多二级页）不启用，避免和内部
  // 滚动、侧滑返回打架。垂直滚动不抢：|dx| > |dy|×1.2 才接管。

  /**
   * 兜底：翻页过程中 App 切到后台，动画会被系统挂起且不一定恢复。
   * 回来时如果 dragDir 还停在非 0，两页就会并排卡死。统一强制落定。
   */
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        return;
      }
      // ⚠️ 这里同时看两个标志位。
      //
      // 只看 dragDir 是不够的：切后台发生在「松手之后、补完动画跑一半」
      // 这段窗口时，dragDir 已经被 settleFlip 归零，但 slotX 上仍然挂着
      // 一个 spring —— 那个 spring 的 JS 回调在后台不会执行，
      // finishFlip 也就永远不会调用，frontSlot 停在旧值、flipping 卡在 true。
      // 回前台就是两页并排 / 位置错乱。
      //
      // flipRunning 覆盖的正是这段「已归零但动画未落定」的窗口。
      if (dragDir.current !== 0 || flipRunning.current) {
        dragDir.current = 0;
        dragProgress.current = 0;
        setFlipping(false);
        closeFlipGate();
        // 掐掉所有还在跑的位移/阻尼动画，否则它们会在回前台后继续写值。
        slotX[0].stopAnimation();
        slotX[1].stopAnimation();
        // ⚠️ 必须按 frontSlot 归位，**不能**硬编码 0 / 1。
        //
        // 原来写死 `slotX[0]=0; slotX[1]=屏宽`，等于假设「前台永远是 slot0」。
        // 但翻过一次页后 frontSlot 就变成 1 了 —— 这时切后台再回来，
        // 前台页（在 slot1）被推到 +屏宽 之外，slot0 里那个旧页却停在 0，
        // 就是用户看到的「两页并排 / 露白 / 内容错位」。
        //
        // 按 frontSlot 归位则不改变当前页：前台归 0，备用槽推到屏外。
        slotX[frontSlot].setValue(0);
        slotX[frontSlot === 0 ? 1 : 0].setValue(pageWidth);
        panX.stopAnimation();
        panX.setValue(0);
      }
    });
    return () => sub.remove();
    // frontSlot 必须进依赖：否则回调里拿到的是首帧那个 0，
    // 又退化成「硬编码前台槽」。pageWidth 同理（横竖屏切换后要重新归位）。
  }, [panX, closeFlipGate, frontSlot, slotX, pageWidth]);

  /**
   * 收尾：不管是正常松手还是被系统中断，都走这里落定。
   * 分支：没在翻（边界阻尼）→ 弹回；翻了 → 过半翻过去 / 不到弹回来。
   *
   * `fromBar` 标记这次手势来自底栏胶囊。
   *
   * ⚠️ 为什么底栏必须单独处理速度阈值：
   *   `g.vx` 是**手势坐标系**里的速度。内容区是屏像素/秒，底栏是胶囊
   *   像素/秒，两者量级差 `barDragScale` 倍（约 4~8 倍）。
   *   原来统一用 `|vx| > 0.5` 判「甩了一下」—— 对底栏来说，手指轻点时
   *   那 6px 抖动产生的速度就已经远大于 0.5，于是**点一下 Tab 就翻一页**，
   *   页面乱跳。所以底栏只认进度，不认速度。
   */
  const settleFlip = (g: {dx: number; vx: number}, fromBar = false) => {
    const idx = TAB_KEYS.indexOf(activeTab);
    const dir = dragDir.current;

    if (dir === 0) {
      // 只是边界阻尼，弹回去。
      //
      // ⚠️ 这里必须用 SPRING_DAMPED_DRAG（dampingRatio 1.0，临界阻尼），
      // 不能用 SPRING_PAGER_SNAP（0.82，带回弹）。
      // 边界是「已经拉到头的硬墙」，回弹会让人以为还能再拉一点；
      // 临界阻尼是「一下收住」，这才是 BAVoice 的边界手感。
      // 原来用 PAGER_SNAP，和注释写的「不来回弹」正好相反。
      Animated.parallel([
        motionSpring(slotX[frontSlot], {
          toValue: 0,
          ...SPRING_DAMPED_DRAG,
          useNativeDriver: false,
        }),
        motionSpring(panX, {
          toValue: 0,
          ...SPRING_LIQUID_INDICATOR,
          useNativeDriver: false,
        }),
      ]).start();
      return;
    }

    // 过半就翻过去，否则弹回原页。
    //
    // 内容区：速度大时给个更低的门槛，轻轻一甩也算数 —— 这是滑动手势该有的手感。
    // 底栏：**只认进度**。胶囊上的速度量级小得多，任何一次轻点抖动都会
    //       被当成「甩」→ 点 Tab 却翻页，页面乱跳。
    const passed = fromBar
      ? dragProgress.current > 0.3
      : dragProgress.current > 0.3 || Math.abs(g.vx) > 0.5;
    const target = TAB_KEYS[idx + dir];
    const from = dragProgress.current;

    if (passed && target) {
      // 接着手指离开的位置补完剩下的行程，不会跳
      animateFlip(dir, from, 1, () => finishFlip(target));
    } else {
      animateFlip(dir, from, 0, () => cancelFlip());
    }
    // 指示器的偏移始终弹回 0（和内容归位同步）。
    // ⚠️ 必须用和 slotX 同一套物理弹簧参数（SPRING_LIQUID_INDICATOR），
    // 不能用 speed/bounciness —— 两套参数收敛时间不同，指示器和内容
    // 就会一先一后落定，中途看着像「指示器掉队」。
    motionSpring(panX, {
      toValue: 0,
      ...SPRING_LIQUID_INDICATOR,
      useNativeDriver: false,
    }).start();
  };

  // 底栏实测宽度。用来把「在胶囊上拖了多远」换算成「翻了多远」：
  // 胶囊一个 Tab 的宽度 ≈ 一页，所以拖动一个 Tab 宽就翻一整页。
  const barWidth = React.useRef(0);

  /**
   * 跟手拖拽的唯一入口。
   *
   * `dx` 是**换算到内容坐标系**的位移（内容区直接就是手指位移；
   * 底栏要按「一个 Tab 宽 = 一页」放大后再传进来）。
   *
   * 之所以两处共用一份：
   *   · 位移 / 进度 / 指示器偏移 / 边界阻尼必须完全同步，各写一份必然跑偏；
   *   · panX.setValue(dx) 里 panX 的单位就是内容像素 —— 指示器通过
   *     `baseX - panX * (tabSpacing/pageWidth)` 折算，所以只要 dx 是内容
   *     坐标系的值，底栏拖动时指示器也正好跟着手指走。
   */
  const applyDrag = React.useCallback(
    (dx: number, rawDx: number = dx) => {
      // 上一次翻页的弹簧还在收尾 → 直接拒绝。
      //
      // ⚠️ 这里必须用 settling 这个 ref，不能用 flipping 状态：
      // flipping 是 React state，在手势回调里读到的是**上一帧**的值，挡不住。
      // 收尾期间任何 setValue 都会和还在跑的 spring 抢同一个 Animated.Value，
      // 值互相覆盖 —— 就是「两页位置错乱」的直接原因。
      if (dragDir.current === 0 && settling.current) {
        return;
      }

      const idx = TAB_KEYS.indexOf(activeTab);
      const w = pageWidth;

      // 方向还没定：先判断有没有相邻页可翻。
      //
      // ⚠️ 这里用 rawDx 判门槛和阻尼，不用放大后的 dx。
      // 底栏的 dx 被 barDragScale 放大了约 7 倍，如果拿它当门槛，
      // 手指动 1px 就会起翻页；拿它算边界阻尼，页面会窜出 1/4 屏。
      // 内容区两者相同（rawDx 缺省等于 dx），行为不变。
      if (dragDir.current === 0) {
        if (Math.abs(rawDx) < 8) {
          return;
        }
        const dir: -1 | 1 = rawDx < 0 ? 1 : -1;
        const target = TAB_KEYS[idx + dir];
        if (!target) {
          // 到头了：当前页跟着手指走一小段，给「拉不动」的物理反馈
          slotX[frontSlot].setValue(rawDx * 0.35);
          panX.setValue(rawDx * 0.35);
          return;
        }
        // 立刻把目标页挂到另一个槽位。当前页仍然满屏在位，只是
        // 右/左边开始露出目标页 —— 看到的是「第二页跟着一起来」，不是白屏。
        startFlip(dir, target);
      }

      const dir = dragDir.current;
      const p = Math.max(0, Math.min(1, (-dx / w) * dir));
      dragProgress.current = p;
      // 100% 跟手：位移直接由 dx 决定，中间不经过任何状态
      slotX[frontSlot].setValue(-dir * w * p);
      slotX[frontSlot === 0 ? 1 : 0].setValue(dir * w * (1 - p));
      panX.setValue(dx);
    },

    [activeTab, panX, slotX, pageWidth, frontSlot, startFlip],
  );

  /**
   * 底栏拖动 → 内容位移的放大系数。
   *
   * 胶囊总宽约等于 4 个 Tab，直接拿手指位移当内容位移的话，
   * 在胶囊上根本拖不满一屏（最多拖出 1/5 页），松手永远弹回 ——
   * 表现就是「滑栏没反应」。
   *
   * BAVoice 的 LiquidBottomTabs 是**按 Tab 计距**的：
   * 指示器移动一个 Tab 宽 = 翻一页。这里照这个语义换算。
   */
  const barDragScale = React.useCallback(() => {
    const tabs = Math.max(1, TAB_KEYS.length);
    // 兜底：还没量到宽度时按屏宽估一个（不会比真实值小太多）
    const total = barWidth.current > 0 ? barWidth.current : pageWidth;
    const perTab = Math.max(48, total / tabs);
    return pageWidth / perTab;
  }, [pageWidth]);

  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        // ⚠️ flipRunning 是第一道闸门（animateFlip 里设的）。
        // 上一次翻页的 spring 还在跑时，这里直接不接管手势 —— 它的尾巴
        // 期间 slotX 仍在被逐帧写入，此时再叠一层 setValue 就是错乱。
        onMoveShouldSetPanResponder: (_e, g) =>
          // ⚠️ 翻页关闭时这里必须为 false，否则手势照旧接管、
          // 逐帧 setValue 仍然在写 slotX，只是没有动画收尾 —— 更乱。
          FLIP_ENABLED &&
          MOTION_ENABLED &&
          !flipRunning.current &&
          !isSubPage &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.2 &&
          Math.abs(g.dx) > 8,
        onPanResponderMove: (_e, g) => applyDrag(g.dx),
        onPanResponderRelease: (_e, g) => {
          settleFlip(g);
        },
        /**
         * ⚠️ 这个回调千万别漏。
         * 手势被系统中断时（父/子 ScrollView 夺权、来电、通知栏下拉、
         * Android 返回键打断……）走的是 onPanResponderTerminate，
         * **不会**触发 onPanResponderRelease。
         * 漏掉它 = dragDir 永远停在非 0、翻页动画永远不播，
         * 两页就永久并排卡在中间（用户实测就是这个现象）。
         */
        onPanResponderTerminate: (_e, g) => {
          settleFlip(g);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyDrag, isSubPage, panX, slotX, frontSlot],
  );

  /**
   * 底栏专用手势：在胶囊上左右拖 = 切页（BAVoice 的 LiquidBottomTabs）。
   *
   * 和内容区手势的区别只有两点：
   *   1) 位移先乘 barDragScale，让「拖一个 Tab 宽」等于「翻一整页」；
   *   2) 接管阈值低一点（6px）—— 胶囊本身窄，用 8px 会觉得「滑不动」。
   *
   * 轻点不受影响：只在真正移动后才接管，手指没动时事件仍然落到里面的
   * PillItem，onPress / 触点散光照常。
   */
  const barPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        /**
         * ⚠️ 必须用 capture 阶段申请，不能只靠冒泡。
         *
         * 胶囊里每个 Tab 都是可点的（Pressable / Touchable）。手指按下时
         * **子节点先成为 responder**；之后父级想在冒泡阶段接管，得等子节点
         * 通过 onResponderTerminationRequest 主动让出。Pressable 默认会放行，
         * 但一旦它进入按压/长按态就可能不放 —— 表现就是「滑胶囊时灵时不灵」。
         *
         * capture 是自上而下先问父级，因此横向拖动一定先被这里拿到。
         *
         * ⚠️ 阈值必须是 12px，不能是 6px。
         * 6px 太小：正常轻点 Tab 时手指抖动轻松超过 6px，于是「点一下」
         * 被当成拖动接管 —— 轻点事件被吞掉（PillItem 收不到 onPress），
         * 同时还会起一次翻页再弹回，看起来就是「点 Tab 页面乱跳」。
         * 12px 高于日常抖动，轻点能稳稳落到 Tab 上。
         */
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          FLIP_ENABLED &&
          MOTION_ENABLED &&
          !flipRunning.current &&
          !isSubPage &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.5 &&
          Math.abs(g.dx) > 12,
        onMoveShouldSetPanResponder: (_e, g) =>
          FLIP_ENABLED &&
          MOTION_ENABLED &&
          !flipRunning.current &&
          !isSubPage &&
          Math.abs(g.dx) > Math.abs(g.dy) * 1.5 &&
          Math.abs(g.dx) > 12,
        onPanResponderMove: (_e, g) => applyDrag(g.dx * barDragScale(), g.dx),
        onPanResponderRelease: (_e, g) => {
          settleFlip(g, true);
        },
        onPanResponderTerminate: (_e, g) => {
          settleFlip(g, true);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applyDrag, barDragScale, isSubPage],
  );
  // 原生液态玻璃组件（Android 13+ 才有；更低版本为 null → 走磨砂的 pillBar 分支）
  const LiquidGlass = liquidGlass ? getGlassComponent() : null;

  // ── 触碰光效：手指按到胶囊栏，从触点散开一圈光 ──────────────
  // 事件挂在最外层壳上（touch 事件会从里面的按钮冒泡上来，
  // 所以既拿得到触点，又不会抢走按钮的点击）。
  const barRef = React.useRef<View>(null);
  const barOriginX = React.useRef(0);
  const rippleSeq = React.useRef(0);
  const [ripples, setRipples] = React.useState<{id: number; x: number}[]>([]);

  const spawnRipple = (e: any, fallbackLocalX: number) => {
    const ne = e?.nativeEvent;
    // 新老架构下 nativeEvent 的形状不完全一致，这里把可能的字段都试一遍
    const pageX =
      ne?.pageX ?? ne?.touches?.[0]?.pageX ?? ne?.changedTouches?.[0]?.pageX;
    // 拿得到绝对坐标就按手指位置，拿不到就退回到该项的中心
    const x =
      typeof pageX === 'number' ? pageX - barOriginX.current : fallbackLocalX;
    rippleSeq.current += 1;
    const id = rippleSeq.current;
    // 最多同时留 3 个，连点时不会越堆越多
    setRipples(prev => [...prev.slice(-2), {id, x}]);
  };

  const removeRipple = React.useCallback((id: number) => {
    setRipples(prev => prev.filter(r => r.id !== id));
  }, []);

  const touchLights = ripples.map(r => (
    <TouchLight
      key={r.id}
      x={r.x}
      dark={theme.dark}
      onDone={() => removeRipple(r.id)}
    />
  ));

  // 选中胶囊的浅蓝背景色：液态玻璃时半透明蓝，普通模式用主题容器色
  const indicatorColor = liquidGlass
    ? theme.dark
      ? 'rgba(147, 197, 253, 0.24)'
      : 'rgba(96, 165, 250, 0.18)'
    : theme.colors.secondaryContainer;

  // 底部 Tab 栏整体交给 CustomTabBar（滑动指示器 + 按压反馈都在里面）
  const pillItems = (
    <CustomTabBar
      tabs={tabs}
      activeKey={activeTab}
      onSelect={switchTab}
      styles={tabStyles}
      indicatorColor={indicatorColor}
      onTouchLight={spawnRipple}
      panX={panX}
      screenWidth={screenWidth}
    />
  );

  // 顶部栏：标题靠最左，右侧是「模块」样式的设置按钮；
  // 作为页面内容的第一个子元素渲染，所以向下滚动时会跟着内容一起往上消失。
  //
  // ⚠️ 必须是「按 Tab 生成」的函数，不能是共享的单一 element。
  // 翻页时两个槽位同时在场、共用同一个 element 的话，两页顶栏会长得
  // 一模一样（都是当前页的标题），拖到一半就露馅了。
  // 顶栏也走玻璃：SurfaceCard 在非玻璃风格下还原成原来的实底 View，
  // 液态玻璃风格下换成真·玻璃（下两角按 MIUIX 的 20 磨圆，上两角留直角）。
  const headerFor = (key: TabKey) => (
    <SurfaceCard
      style={[
        tabStyles.header,
        {
          height: HEADER_HEIGHT + insets.top + HEADER_EXTRA,
          paddingTop: insets.top,
          paddingBottom: HEADER_EXTRA,
          // 磨砂开启时，首页顶栏与卡片同透明（0.62 alpha），关闭时恢复实底
          backgroundColor:
            key === 'home' && uiStore.frosted
              ? frostedSurface(theme)
              : headerBg(theme),
        },
      ]}>
      {/* 光效：顶栏同样叠加流动高光带，和底栏保持一致。
          由「设置 → 光效」开关控制（与玻璃无关，两种模式都能开）。 */}
      {uiStore.sheenEffect ? (
        <>
          <View pointerEvents="none" style={tabStyles.pillBarHighlight}>
            <LinearGradient
              colors={
                theme.dark
                  ? [
                      'rgba(248,250,252,0)',
                      'rgba(248,250,252,0.2)',
                      'rgba(248,250,252,0)',
                    ]
                  : [
                      'rgba(255,255,255,0)',
                      'rgba(255,255,255,0.45)',
                      'rgba(255,255,255,0)',
                    ]
              }
              start={{x: 0, y: 0}}
              end={{x: 1, y: 0}}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <GlassSheen dark={theme.dark} />
        </>
      ) : null}
      {key === 'profile' && (
        <TouchableOpacity
          style={[tabStyles.headerAction, tabStyles.headerMenu]}
          onPress={() => (navigation as any).openDrawer?.()}
          accessibilityRole="button"
          accessibilityLabel="打开侧边栏">
          <Icon
            name="menu"
            size={HEADER_ICON_SIZE}
            color={theme.colors.onSurface}
          />
        </TouchableOpacity>
      )}
      <Text style={tabStyles.headerTitle}>
        {key === 'home' ? 'OnDevice Kit' : tabs.find(t => t.key === key)?.label}
      </Text>
      <View style={tabStyles.headerSpacer} />
      <TouchableOpacity
        style={tabStyles.headerAction}
        onPress={() => navigation.navigate('Settings')}
        accessibilityRole="button"
        accessibilityLabel="设置">
        <Icon
          name="cog-outline"
          size={HEADER_ICON_SIZE}
          color={theme.colors.onSurface}
        />
      </TouchableOpacity>
    </SurfaceCard>
  );

  return (
    <Animated.View style={[tabStyles.tabContainer, {opacity: exitOpacity}]}>
      {/*
        翻页容器：手势挂在这一层。
        内层是**两个固定槽位**（key 固定为 slot0/slot1，所以组件实例
        原地复用，翻页收尾只是把 frontSlot 指针一翻 —— 不卸载、不重挂、
        不会跳位，也不会出现两页并排重叠）。
        两个槽位各自 absoluteFill 铺满整屏、位移互补，任何进度下都拼满，
        底色永远露不出来。
        panDX 这一层留给「进二级页」的转场（那时只有一个页面在场）。
      */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          tabStyles.tabContent,
          {
            // contentOpacity / subDX 都用 setValue 指定过起点 → 全程 JS 驱动。
            // 注意这里**不能**用 panDX：它被手势逐帧 setValue 写过，
            // 而 subDX 只在转场开始/结束时写两次，量级完全不同，不会互相干扰。
            opacity: contentOpacity,
            transform: [{translateX: subDX}],
          },
        ]}>
        {/*
          两个固定槽位（key 固定 → 组件实例原地复用）。

          ⚠️ 备用槽**不要 display:none**，就让它停在屏幕外（translateX = ±屏宽）。
          display:none 的话每次翻页都要重做一遍全量布局 + FlatList 重新渲染
          item，这才是「翻页不流畅」的真正大头；停在屏幕外则布局早已算好，
          翻页只改一个 transform，几乎零成本 —— 也就等于「预渲染好了」。

          两个槽位各自 absoluteFill 铺满、位移互补，任何进度下都拼满 ——
          底色永远露不出来，白屏在结构上不可能发生。

          ScreenActiveProvider：翻页期间给两个槽位都传 active=false，
          让 Entrance **跳过内容入场动画**。翻页本身就是页面级动画，
          内容再叠一层几十个区块的淡入上移只会抢线程（卡），
          而且翻完还会再播一遍（用户说的「旧加载动画」）。
        */}
        {[0, 1].map(i => (
          <ScreenActiveProvider
            key={`slot${i}`}
            active={i === frontSlot && !flipping}>
            <Animated.View
              style={[
                tabStyles.pageSlot,
                {transform: [{translateX: slotX[i]}]},
              ]}>
              {slotPage(i as 0 | 1)}
            </Animated.View>
          </ScreenActiveProvider>
        ))}
      </Animated.View>
      {!isSubPage && (
        // 外层壳负责定位（浮在内容之上），内层只负责外观
        <View
          ref={barRef}
          // measureInWindow 拿到胶囊的绝对左端 + 宽度：
          // 左端用来把 pageX 换算成局部坐标（触点散光），
          // 宽度用来把「在胶囊上拖了多远」换算成「翻了多远」（barDragScale）。
          onLayout={() =>
            barRef.current?.measureInWindow((x, _y, w) => {
              barOriginX.current = x;
              if (w > 0) {
                barWidth.current = w;
              }
            })
          }
          // 手势也挂到胶囊栏上：直接在底部栏左右拖同样能翻页。
          // BAVoice 的 LiquidBottomTabs 就是这个交互 —— 指示器跟着手指走，
          // 松手吸附到最近的 Tab。
          // 轻点不受影响：要水平移动超过 6px 才接管，轻点仍由里面的
          // PillItem 收到并触发 onPress/散光。
          {...barPanResponder.panHandlers}
          style={[
            tabStyles.pillBarLayer,
            activeTab === 'models' ? tabStyles.pillBarShifted : null,
          ]}>
          {/* 整条胶囊一起放大：只包可见内容，外层带测量 ref 的 View 不动 */}
          <Animated.View style={{transform: [{scale: BAR_PRESS_SCALE}]}}>
            {LiquidGlass ? (
              // ⚠️ 图标/文字必须作为 LiquidGlass 的 **React 子视图**渲染：
              // 原生玻璃抓背景快照时只排除「自己的子树」，内容一旦是玻璃的
              // 兄弟节点，就会被拍进背景、再被着色器模糊折射一次 —— 真图标
              // 底下垫一层自己的模糊鬼影，看起来就是「图标发糊」。
              <LiquidGlass
                // 原生 AGSL 玻璃（GPU 实时折射，Android 13+ 才有）
                // regular = 磨砂档（背景先糊 18px 再折射）。Tab 图标是半透明
                // 的玻璃质感位图，若用 clear 档（背景只糊 4px），图标像素里
                // 透出来的是几乎没糊、还被折射扭过的锐利壁纸 —— 图标显糊。
                glassType="regular"
                glassTintColor={theme.dark ? '#0F172A' : '#FFFFFF'}
                // 数值越低越透（0=全透，1=完全不透）。这次整体调低一档，
                // 让背后的内容透出来更多。
                glassOpacity={theme.dark ? 0.26 : 0.18}
                // 必须关：isInteractive 默认 true，Android 上它会注册自己的
                // 触摸监听（做 iOS 风格的 press-scale），把 touch 吞掉，
                // 导致挂在外壳上的滑动手势完全收不到 —— 表现为「滑栏没反应」。
                isInteractive={false}
                style={tabStyles.pillBarGlass}>
                <View pointerEvents="none" style={tabStyles.pillBarHighlight}>
                  <LinearGradient
                    colors={
                      theme.dark
                        ? [
                            'rgba(248,250,252,0)',
                            'rgba(248,250,252,0.2)',
                            'rgba(248,250,252,0)',
                          ]
                        : [
                            'rgba(255,255,255,0)',
                            'rgba(255,255,255,0.45)',
                            'rgba(255,255,255,0)',
                          ]
                    }
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 0}}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
                <View
                  pointerEvents="none"
                  style={tabStyles.pillBarHighlightBottom}>
                  <LinearGradient
                    colors={
                      theme.dark
                        ? [
                            'rgba(226,232,240,0)',
                            'rgba(226,232,240,0.1)',
                            'rgba(226,232,240,0)',
                          ]
                        : [
                            'rgba(255,255,255,0)',
                            'rgba(255,255,255,0.28)',
                            'rgba(255,255,255,0)',
                          ]
                    }
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 0}}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
                {/* 流动光效：光带在胶囊内缓缓扫过（放在图标下面，不挡点击） */}
                {uiStore.sheenEffect ? <GlassSheen dark={theme.dark} /> : null}
                {pillItems}
                {/* 触碰光效：必须放在图标「上面」——
                  胶囊底色接近纯白，白光铺在空白处看不出；
                  它真正显形的地方是扫过深色图标和文字时把内容冲淡，
                  所以一定要盖在 pillItems 之上，不能垫在下面。 */}
                {touchLights}
              </LiquidGlass>
            ) : (
              <View style={tabStyles.pillBar}>
                <View pointerEvents="none" style={tabStyles.pillBarHighlight}>
                  <LinearGradient
                    colors={
                      theme.dark
                        ? [
                            'rgba(248,250,252,0)',
                            'rgba(248,250,252,0.2)',
                            'rgba(248,250,252,0)',
                          ]
                        : [
                            'rgba(255,255,255,0)',
                            'rgba(255,255,255,0.45)',
                            'rgba(255,255,255,0)',
                          ]
                    }
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 0}}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
                <View
                  pointerEvents="none"
                  style={tabStyles.pillBarHighlightBottom}>
                  <LinearGradient
                    colors={
                      theme.dark
                        ? [
                            'rgba(226,232,240,0)',
                            'rgba(226,232,240,0.1)',
                            'rgba(226,232,240,0)',
                          ]
                        : [
                            'rgba(255,255,255,0)',
                            'rgba(255,255,255,0.28)',
                            'rgba(255,255,255,0)',
                          ]
                    }
                    start={{x: 0, y: 0}}
                    end={{x: 1, y: 0}}
                    style={StyleSheet.absoluteFill}
                  />
                </View>
                {uiStore.sheenEffect ? <GlassSheen dark={theme.dark} /> : null}
                {pillItems}
                {touchLights}
              </View>
            )}
          </Animated.View>
        </View>
      )}
    </Animated.View>
  );
});

// Component that handles deep linking - must be inside NavigationContainer
const DeepLinkHandler = () => {
  useDeepLinking();
  return null;
};

// Branches between the OnboardingStack (first-launch flow) and the main
// Drawer.Navigator. Both children mount under the same provider tree —
// switching does NOT remount providers above this point.
//
// The hydration check is belt-and-suspenders. AppWithMigrationWrapper
// already gates render on `isHydrated(uiStore)`, but reading the same
// observable here keeps the contract local and survives refactors of the
// outer gate.
type SwitchPointProps = {drawer: React.ReactNode};
const SwitchPoint: React.FC<SwitchPointProps> = observer(({drawer}) => {
  if (!isHydrated(uiStore)) {
    return null;
  }
  // 引导页已下线：无论首次安装还是重装，直接进主界面
  return <>{drawer}</>;
});

const App = observer(() => {
  const theme = useTheme();

  // 导航容器自己的背景色：跟随我们的主题，避免抽屉页切换那一帧
  // 露出导航库自带的灰白底（DefaultTheme 的 background = rgb(242,242,242)）。
  const navTheme = React.useMemo(() => {
    const base: any = theme.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: !!theme.dark,
      colors: {
        ...base.colors,
        // 液态玻璃风格下导航容器必须透明，否则它会把根层壁纸整块盖掉
        // （顶栏是半透明的，后面就只能看到这层近白色 → 顶栏发白没玻璃感）。
        background:
          uiStore.themeStyle === 'liquid-glass'
            ? 'transparent'
            : theme.colors.background,
        card:
          uiStore.themeStyle === 'liquid-glass'
            ? 'transparent'
            : theme.colors.background,
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, uiStore.themeStyle]);
  const styles = createStyles(theme);
  // 全局壁纸：所有页面共用这一张（首页和二级页背后都是它）
  const currentPageBg = getCurrentPageBackground();
  const currentL10n = l10n[uiStore.language];

  // Initialize locale with the current language
  React.useEffect(() => {
    initLocale(uiStore.language);
  }, []);

  // Initialize TTS store (memory gate + AppState/session listeners).
  // Fire-and-forget: `init()` is idempotent and swallows its own errors.
  React.useEffect(() => {
    ttsStore.init().catch(() => {
      // init() swallows its own errors; catch to satisfy no-floating-promises.
    });
  }, []);

  React.useEffect(() => {
    purchaseStore
      .start(__E2E__ ? {store: fakeStore, beforeInit: fakeStore.restore} : {})
      .catch(error => console.warn('Purchase recovery failed:', error));
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar
        // 让 App 画到系统状态栏「底下」。不加 translucent 时，Android 会把
        // 窗口整体压在状态栏下方（insets.top 读到 0），顶部栏底色就顶不到屏幕最上沿。
        translucent
        barStyle={theme.dark ? 'light-content' : 'dark-content'}
        // 必须用 transparent，不能填「顶部栏同色」：
        // 这个属性在各家 ROM 上行为不一致 —— 有的照单全收（于是灰底状态栏
        // 和半透明磨砂顶栏之间就裂出一条灰边），有的直接忽略。
        // 填 transparent 后两种 ROM 都统一成「露出 App 自己的顶栏」，不会再有缝。
        backgroundColor="transparent"
      />
      {__E2E__ ? <AutomationBridge /> : null}
      <SafeAreaProvider>
        <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
          <PaperProvider theme={theme}>
            <L10nContext.Provider value={currentL10n}>
              <MarkdownProvider>
                {/*
                  首次安装：未同意《用户协议与免责声明》前**不挂载主应用**
                  （不是盖一层浮层），只渲染声明页；同意后持久化标记，之后
                  正常进入。E2E 自动化构建直接跳过，避免测试被拦。
                */}
                {!__E2E__ && !uiStore.disclaimerAccepted ? (
                  <DisclaimerGate onAccept={() => uiStore.acceptDisclaimer()} />
                ) : (
                  /*
                  给导航容器一份和我们主题一致的 theme。
                  不传的话它会用自带的 DefaultTheme（背景 rgb(242,242,242)），
                  抽屉页挂载/切换的那一帧露出的是这个灰白底 —— 又一处白闪来源。
                */
                  <NavigationContainer theme={navTheme}>
                    <DeepLinkHandler />
                    <BottomSheetModalProvider>
                      {/*
                      ⚠️ 壁纸**不能**放在这一层（导航容器外面）。
                      原生液态玻璃抓背景时，抓的是「最近的 rnscreens Screen 子树」，
                      放在 Screen 外面的图层抓不到 → 玻璃里一片空白，
                      折射/色散效果就完全看不出来了。
                      壁纸统一由下面 Drawer.Navigator 的 screenLayout 注入到每个 Screen 内部。
                    */}
                      {/*
                      根层壁纸：铺在导航容器**外面**，给「顶栏」「透明缝隙」做视觉底。
                      ⚠️ 它抓不到玻璃（玻璃只采样 Screen 子树），所以玻璃的效果靠
                      Drawer 的 screenLayout（把壁纸再注入到每个 Screen 内部）。
                      两层壁纸是同一张图，视觉上完全重合。
                    */}
                      <View
                        pointerEvents="none"
                        style={StyleSheet.absoluteFill}>
                        <ImageBackground
                          source={currentPageBg.source}
                          resizeMode="cover"
                          style={StyleSheet.absoluteFill}
                        />
                        <View
                          style={[
                            StyleSheet.absoluteFill,
                            {backgroundColor: wallpaperScrim(theme)},
                          ]}
                        />
                      </View>
                      <SwitchPoint
                        drawer={
                          <Drawer.Navigator
                            backBehavior="initialRoute"
                            /*
                            每个 Screen 内层都垫一张全局壁纸：
                            所有页面（首页 / 抽屉各二级页 / 覆盖层子页）背后的图一致，
                            且玻璃能抓到它做折射。
                          */
                            screenLayout={({children}) => (
                              <View style={styles.wallpaperLayer}>
                                <ImageBackground
                                  source={currentPageBg.source}
                                  resizeMode="cover"
                                  style={StyleSheet.absoluteFill}
                                />
                                {/* 淡蒙版：压一点壁纸的锐度，深色文字才读得清
                                  （不加的话「推荐模型」这类直接压在壁纸上的字会糊） */}
                                <View
                                  style={[
                                    StyleSheet.absoluteFill,
                                    {backgroundColor: wallpaperScrim(theme)},
                                  ]}
                                />
                                <View style={styles.wallpaperContent}>
                                  {/* Drawer 路由之间没有自带转场：
                                      聚焦时给场景一层淡入上浮的入场动画，
                                      设置/关于/下载管理等页不再瞬间硬切。 */}
                                  <SceneEnterShell>{children}</SceneEnterShell>
                                </View>
                              </View>
                            )}
                            screenOptions={{
                              headerLeft: () => <HeaderLeft />,
                              drawerStyle: {
                                width:
                                  screenWidth > 400 ? 320 : screenWidth * 0.8,
                              },
                              headerStyle: {
                                // 玻璃风格：半透明顶栏，透出根层壁纸（近似磨砂玻璃）。
                                // ⚠️ 这里不能用真玻璃视图 —— 顶栏在 scene 之上，
                                // 而壁纸在 scene 内，玻璃抓不到背景就是一片空白亮白。
                                backgroundColor: headerTranslucent(theme),
                              },
                              headerTintColor: theme.colors.onBackground,
                              headerTitleStyle: styles.headerTitle,
                              drawerType: 'slide',
                              swipeEnabled: false,
                              // 以下四项是 @react-navigation/drawer v6 的写法，
                              // 本项目用的是 v7，这些字段在 v7 里已被移除（TS 报错）。
                              //   animationEnabled  -> v7 没有等价开关
                              //   transitionSpec    -> 同上
                              //   overlayEnabled    -> 改用 overlayColor
                              //   cardStyle         -> 改名 sceneStyle
                              overlayColor: 'transparent',
                              sceneStyle: {
                                // 透明：让全局壁纸层透上来
                                backgroundColor: 'transparent',
                              },
                            }}
                            drawerContent={props => (
                              <SidebarContent {...props} />
                            )}>
                            <Drawer.Screen
                              name={ROUTES.CHAT}
                              component={MainTabs}
                              options={{
                                headerShown: false,
                              }}
                            />
                            <Drawer.Screen
                              name={ROUTES.PALS}
                              component={PalsScreen}
                              options={{
                                headerRight: () => <PalHeaderRight />,
                                headerStyle: styles.headerWithoutDivider,
                                title: currentL10n.screenTitles.pals,
                              }}
                            />
                            <Drawer.Screen
                              name={ROUTES.MODELS}
                              component={ModelsScreenWithSubHeader}
                              options={{
                                // 顶栏由页面自己当第一个子元素渲染（与其它二级页
                                // 一致，见 SubPageHeader 注释）。此前用导航器级
                                // header: 状态栏区域被导航器额外垫高、SubPageHeader
                                // 又自带 insets.top，双重让位后顶栏错位、看起来
                                // 像被截了一块（2026-10-23 真机截图确认）。
                                headerShown: false,
                                headerStyle: styles.headerWithoutDivider,
                                title: currentL10n.screenTitles.models,
                              }}
                            />
                            <Drawer.Screen
                              name={ROUTES.BENCHMARK}
                              component={BenchmarkScreen}
                              options={{
                                headerStyle: styles.headerWithoutDivider,
                                title: currentL10n.screenTitles.benchmark,
                              }}
                            />
                            <Drawer.Screen
                              name={ROUTES.SETTINGS}
                              component={SettingsScreen}
                              options={{
                                // 与主屏幕顶部栏保持一致：浅灰底、左对齐大标题、底部圆角
                                headerStyle: {
                                  backgroundColor: headerBg(theme),
                                  borderBottomLeftRadius: headerBottomRadius(),
                                  borderBottomRightRadius: headerBottomRadius(),
                                },
                                headerTitleAlign: 'left',
                                headerTitleStyle: {
                                  fontSize: HEADER_TITLE_SIZE,
                                  fontWeight: HEADER_TITLE_WEIGHT,
                                  color: theme.colors.onSurface,
                                },
                                title: currentL10n.screenTitles.settings,
                                // 隐藏左侧 Drawer 汉堡按钮，设置页内用自绘返回导航
                                headerLeft: () => null,
                              }}
                            />
                            <Drawer.Screen
                              name={ROUTES.APP_INFO}
                              component={AboutScreen}
                              options={{
                                // 顶栏改由页面内玻璃 SubHeader 渲染（与主页一致）
                                headerShown: false,
                                headerStyle: styles.headerWithoutDivider,
                                title: currentL10n.screenTitles.appInfo,
                              }}
                            />

                            {/* Only show Dev Tools screen in debug mode */}
                            {isDebugMode && (
                              <Drawer.Screen
                                name={ROUTES.DEV_TOOLS}
                                component={DevToolsScreen}
                                options={{
                                  headerStyle: styles.headerWithoutDivider,
                                  title: 'Dev Tools',
                                }}
                              />
                            )}

                            {/* 视觉模型选择页：从图像识别页「去加载模型」进入 */}
                            <Drawer.Screen
                              name={ROUTES.VISION_MODELS}
                              component={VisionModelsScreen}
                              options={{
                                headerStyle: styles.headerWithoutDivider,
                                headerShown: false,
                                drawerItemStyle: {display: 'none'},
                              }}
                            />

                            {/*
                              下载管理：统一管控所有已下载的本地模型
                              （对话 / 视觉投影 / 语音合成引擎等）。
                              从「我的 → 下载管理」进入，不进侧边栏。
                            */}
                            <Drawer.Screen
                              name={ROUTES.DOWNLOADS}
                              component={DownloadManagementScreen}
                              options={{
                                headerStyle: styles.headerWithoutDivider,
                                headerShown: false,
                                drawerItemStyle: {display: 'none'},
                              }}
                            />

                            {/* 图像生成页：从首页「生成图片」进入 */}
                            <Drawer.Screen
                              name={ROUTES.IMAGE_GEN}
                              component={ImageGenScreen}
                              options={{
                                headerStyle: styles.headerWithoutDivider,
                                headerShown: false,
                                drawerItemStyle: {display: 'none'},
                              }}
                            />

                            {/*
                          E2E-only deep-link-driven benchmark matrix runner.
                          Hidden from the drawer sidebar via
                          drawerItemStyle:{display:'none'}; reachable only by
                          the deep link pocketpal://e2e/benchmark in the e2e
                          flavor build (see useDeepLinking cold-launch effect
                          and android/app/src/e2e/AndroidManifest.xml).
                        */}
                            {__E2E__ && (
                              <Drawer.Screen
                                name={ROUTES.BENCHMARK_RUNNER}
                                component={BenchmarkRunnerScreen}
                                options={{
                                  headerStyle: styles.headerWithoutDivider,
                                  title: 'Benchmark Runner',
                                  drawerItemStyle: {display: 'none'},
                                }}
                              />
                            )}
                          </Drawer.Navigator>
                        }
                      />
                      <TTSSetupSheet />
                      <TTSErrorDialog />
                      <DownloadOverlay />
                      <HubRunSheetHost />
                    </BottomSheetModalProvider>
                  </NavigationContainer>
                )}
              </MarkdownProvider>
            </L10nContext.Provider>
          </PaperProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      // 根视图必须自己铺底色：安卓主题是 DayNight，系统处于深色时
      // windowBackground 是黑的，一旦有哪条像素没被内容覆盖就会露出黑边。
      backgroundColor: theme.colors.background,
    },
    /**
     * 全局壁纸层：铺在整个 App 底下。
     * 所有页面的根容器底色都改成了 transparent，壁纸从这一层透上来。
     */
    wallpaperLayer: {
      flex: 1,
    },
    /** 壁纸之上的内容层（导航容器） */
    wallpaperContent: {
      flex: 1,
    },
    headerWithoutDivider: {
      elevation: 0,
      shadowOpacity: 0,
      // 玻璃风格下加一条很淡的高光边，顶栏才有「玻璃边缘」的辨识度
      borderBottomWidth: uiStore.themeStyle === 'liquid-glass' ? 0.5 : 0,
      borderBottomColor: 'rgba(255,255,255,0.65)',
      backgroundColor: headerTranslucent(theme, headerBg(theme)),
    },
    headerWithDivider: {
      backgroundColor: headerTranslucent(theme, headerBg(theme)),
    },
    headerTitle: {
      ...theme.fonts.titleSmall,
    },
  });

// Neutral background-only hold, rendered until mobx-persist-store has
// loaded UIStore from AsyncStorage. It is a single full-screen View whose
// only meaningful property is backgroundColor, resolved from the system
// color scheme. Deliberately carries NO branding, NO Text, NO
// SafeAreaProvider, NO insets, and NO spinner: a flat colored View has
// nothing to match against either native launch surface (iOS has a branded
// storyboard, Android has no native launch screen), so it cannot diverge
// from native on any axis and reads simply as "app launching".
const splashStyles = StyleSheet.create({
  light: {flex: 1, backgroundColor: '#FFFFFF'},
  dark: {flex: 1, backgroundColor: '#0F172A'},
});

const HydrationHold = () => (
  <View
    testID="hydration-splash"
    style={
      Appearance.getColorScheme() === 'dark'
        ? splashStyles.dark
        : splashStyles.light
    }
  />
);

// Wrap the App component with AppWithMigration to show migration UI when
// needed. Gates the first render of any theme-consuming subtree on
// mobx-persist-store hydration so persisted `language` and `colorScheme`
// are observed on first paint.
//
// The gate must wrap App itself (App calls useTheme() BEFORE <PaperProvider>
// mounts), so AppWithMigrationWrapper — which sits above App and has no
// theme dependency — is the chosen host. While unhydrated it renders the
// neutral background-only hold above.
const AppWithMigrationWrapper = observer(() => {
  const hydrated = isHydrated(uiStore);

  // hydration 完成后再跑：出厂默认「浅色 + MIUIX」要落到已安装的实例上。
  // 带持久化标记，只执行一次，之后用户自己的选择不会再被覆盖。
  React.useEffect(() => {
    if (hydrated) {
      uiStore.applyUiDefaultsOnce();
      // 随机壁纸默认开启（一次性，不覆盖用户后续选择）
      uiStore.applyRandomBgDefaultOnce();
    }
  }, [hydrated]);

  if (!hydrated) {
    return <HydrationHold />;
  }
  return (
    <AppWithMigration>
      <App />
    </AppWithMigration>
  );
});

export default AppWithMigrationWrapper;
