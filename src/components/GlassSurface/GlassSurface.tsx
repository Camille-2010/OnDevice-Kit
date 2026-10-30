import React, {useCallback, useRef, useState} from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import Svg, {Defs, LinearGradient, Path, Rect, Stop} from 'react-native-svg';
import {Card as PaperCard} from 'react-native-paper';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {cardRadius, glassTint} from '../../theme/cards';
import {motionSpring} from '../../utils/disableMotion';
import {PRESS_SCALE, SPRING_PRESS} from '../../theme/motion';
import {uiStore} from '../../store';

/**
 * 卡片按压缩放总开关。false = 关闭（排查布局问题用）；
 * 打开后 SurfaceCard 会在液态玻璃下按住放大。之前它导致主页宫格/图像增强
 * 等页面布局异常，先关掉确保全局布局正确，稳定后再逐页开启。
 */
const GLASS_PRESS_SCALE = true;

/**
 * 全 App 统一的「玻璃表面」容器。
 *
 * 两种形态，按系统版本**自动识别**，不需要用户设置：
 *   · Android 13+（API 33）→ 原生 AGSL 液态玻璃
 *     （RuntimeShader 做折射 + 色散 + 模糊，GPU 实时，iOS 26 那套观感）
 *   · Android 13 以下 → **磨砂**：半透明色调 + 边缘高光描边
 *     （不跑任何原生模糊 —— API 29 的原生模糊走 RenderScript（CPU），
 *      一屏多个玻璃视图必然掉帧；磨砂在纯色/壁纸背景下的观感差异很小，代价接近 0）
 *
 * 玻璃**只改表面质感，不改任何几何尺寸**（圆角仍用调用方自己的 borderRadius）。
 */

let uid = 0;

/**
 * 玻璃边缘高光的描边宽度。
 *
 * ⚠️ 这里只控制**卡片**（玻璃面）的边缘高光，按钮的高光走 `buttonRing`
 * （`src/theme/cards.ts`），两者互相独立。
 *
 * 卡片的高光要克制：1.7 太抢眼（用户反馈卡片高光该降下来），
 * 1.1 是「能看出有一圈边、但不抢内容」的值。
 */
const RIM_STROKE = 1.3;

/** '#RRGGBB' + alpha → 'rgba(r, g, b, a)'（磨砂路径需要带透明度的颜色） */
const hexToRgba = (hex: string, a: number): string => {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map(c => c + c)
          .join('')
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

/** 当前设备是否支持原生 AGSL 液态玻璃 */
export const hasNativeGlass = (): boolean =>
  Platform.OS === 'android' &&
  Number.parseInt(String(Platform.Version), 10) >= 33;

export type GlassSurfaceProps = {
  /** 圆角；不传则沿用调用方 style 里的 borderRadius */
  radius?: number;
  /**
   * 自定义玻璃色调（十六进制）。不传则用默认中性灰。
   * 典型用途：用户气泡要保持深青色底 + 白字，不能套浅色玻璃。
   */
  tint?: string;
  /** 自定义色调的不透明度（0~1） */
  tintOpacity?: number;
  /**
   * 只画玻璃边（不模糊、不染色）。
   *
   * 用在「里面本来就是一张清晰照片」的场景（比如首页轮播卡）：
   * 真玻璃会把照片糊掉，而这里要的是**照片一点不糊 + 一圈玻璃边**。
   */
  rimOnly?: boolean;
  /**
   * 分角圆角（顶栏这类只有一个/两个角是圆的场景）。
   * 传了就以它为准，忽略 radius。
   */
  radii?: {tl?: number; tr?: number; br?: number; bl?: number};
  /**
   * 边缘高光描边宽度，默认 RIM_STROKE(1.1)。
   * 玻璃叠玻璃的场景（弹窗面板上的卡片/胶囊）调大到 ~1.6，
   * 让相邻玻璃层之间有清晰可辨的边界。
   */
  rimWidth?: number;
  /**
   * 玻璃背后是什么：
   *  - 'wallpaper' 背后是彩色壁纸（主页）→ 通透 75%
   *  - 'solid'     背后是纯色底（其余页面）→ 通透 55%
   */
  backdrop?: 'wallpaper' | 'solid';
  /**
   * 原生玻璃类型：
   *  - 'clear'   清透（默认，以折射为主）
   *  - 'regular' 更磨砂（模糊更重，适合文字直接压在花哨壁纸上的场景）
   */
  glassType?: 'clear' | 'regular';
  /**
   * 磨砂路径（Android 13 以下）是否叠加一层**真实模糊**。
   *
   * 默认 false：磨砂原本只靠半透明色调，一屏几十个玻璃视图时
   * 任何真模糊都不划算。但**弹窗面板**是个例外——它面积大、
   * 文字直接压在背后的壁纸/页面内容上，没有模糊背景会明显干扰阅读
   * （用户反馈「弹窗被背景干扰看不清」）。所以只给面板开这个开关。
   *
   * 模糊由 BlurView（QmBlurView：原生 box blur + 8× 降采样）实现，
   * 不是 RenderScript，API 29 上也够快；一屏只有一两个时才建议开。
   */
  blur?: boolean;
  /** 模糊强度 0~100（默认 40）。越大越糊、背景干扰越少 */
  blurAmount?: number;
  /** 模糊迭代次数 1~15（默认 6），越多越平滑、CPU 成本线性上升 */
  blurRounds?: number;
  /**
   * 强制走磨砂路径（即使设备支持原生 AGSL 玻璃）。
   *
   * 为什么需要：弹窗用的是 `AnimatedSheet inPage`（页面内绝对定位覆盖层）。
   * 在部分 ROM（实测小米 HyperOS / API 34）上，原生 LiquidGlassView 在
   * 这种覆盖层里**采样不到背景**，整块面板渲染成透明 —— 弹窗内容与背后的
   * 页面文字叠在一起，完全看不清（用户反馈「只有小米手机上这样」）。
   * 磨砂路径不依赖原生抓屏，只做半透明色 + 模糊，任何 ROM 都稳定。
   */
  forceFrosted?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
};

export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  radius,
  radii,
  tint,
  tintOpacity,
  rimOnly = false,
  backdrop = 'solid',
  glassType = 'clear',
  rimWidth = RIM_STROKE,
  blur = false,
  blurAmount = 40,
  blurRounds = 6,
  forceFrosted = false,
  style,
  children,
}) => {
  const theme = useTheme();
  const flat = (StyleSheet.flatten([style]) ?? {}) as ViewStyle;
  // borderRadius 可能是百分比/动画值，SVG 的 rx 只吃数字
  const r =
    typeof radius === 'number'
      ? radius
      : typeof flat.borderRadius === 'number'
        ? flat.borderRadius
        : cardRadius();
  /**
   * 玻璃色调的不透明度（越低越透）。
   *
   * 原本分两档：背后有壁纸 0.25（通透 75%）、背后纯色 0.45（通透 55%）。
   * 现在壁纸铺到了**每一个页面**（见 App.tsx 的 screenLayout），
   * 「背后纯色」这种场景已经不存在；0.45 的白会让设置页这类浅底页
   * 显得一片惨白（用户反馈「特别亮」），所以统一到 0.25。
   */
  const baseAlpha = backdrop === 'wallpaper' ? 0.28 : 0.38;
  const alpha = tintOpacity ?? baseAlpha;
  const tintColor = tint ?? (theme.dark ? '#1C2027' : '#F1F2F7');

  // 分角圆角：优先用 radii，其次 radius，最后取 style 里的 borderRadius
  const hasCorners = !!radii;
  const tl = radii?.tl ?? r;
  const tr = radii?.tr ?? r;
  const br = radii?.br ?? r;
  const bl = radii?.bl ?? r;
  const cornerStyle = hasCorners
    ? {
        borderTopLeftRadius: tl,
        borderTopRightRadius: tr,
        borderBottomRightRadius: br,
        borderBottomLeftRadius: bl,
      }
    : {borderRadius: r};
  // 每个实例用独立渐变 id，避免同屏多个玻璃卡片的 SVG 渐变互相覆盖
  const gradId = useRef(`glassRim${uid++}`).current;
  const [size, setSize] = useState({w: 0, h: 0});
  const onLayout = useCallback(
    (e: {nativeEvent: {layout: {width: number; height: number}}}) => {
      const {width, height} = e.nativeEvent.layout;
      setSize(prev =>
        prev.w === width && prev.h === height ? prev : {w: width, h: height},
      );
    },
    [],
  );

  /**
   * 边缘高光描边：上亮下暗的渐变描边。
   * 这是「液态玻璃」辨识度最高的一层（iOS 26 / HyperOS 都有），
   * 真玻璃和磨砂两种形态都能加，成本极低。
   */
  /** 分角圆角的描边路径（按描边宽度的一半内缩，保证描边完整可见） */
  const cornerPath = (() => {
    const inset = rimWidth / 2;
    const w = size.w - rimWidth;
    const h = size.h - rimWidth;
    const x0 = inset;
    const y0 = inset;
    const x1 = x0 + w;
    const y1 = y0 + h;
    const a = (rx: number, sweep: number, ex: number, ey: number) =>
      `A ${rx} ${rx} 0 0 ${sweep} ${ex} ${ey}`;
    return [
      `M ${x0 + tl} ${y0}`,
      `L ${x1 - tr} ${y0}`,
      a(tr, 1, x1, y0 + tr),
      `L ${x1} ${y1 - br}`,
      a(br, 1, x1 - br, y1),
      `L ${x0 + bl} ${y1}`,
      a(bl, 1, x0, y1 - bl),
      `L ${x0} ${y0 + tl}`,
      a(tl, 1, x0 + tl, y0),
      'Z',
    ].join(' ');
  })();

  const rim =
    size.w > 0 && size.h > 0 ? (
      <Svg
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        width={size.w}
        height={size.h}>
        <Defs>
          {/*
            高光渐变：用 **6 个档位** 而不是 3 个。

            只有 3 个档位时，SVG 在档位之间是线性插值，亮→暗会出现两道
            「折线」，肉眼能看出高光在中途突然变淡（过渡生硬）。
            密度更高的档位让衰减接近指数曲线，从上到下是连续变暗的，
            同时整体亮度抬高一档 —— 每张卡片/按键的最外一圈高光更明显。
          */}
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop
              offset="0"
              stopColor={
                theme.dark ? 'rgba(255,255,255,0.46)' : 'rgba(255,255,255,0.88)'
              }
            />
            <Stop
              offset="0.12"
              stopColor={
                theme.dark ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.72)'
              }
            />
            <Stop
              offset="0.30"
              stopColor={
                theme.dark ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.44)'
              }
            />
            <Stop
              offset="0.50"
              stopColor={
                theme.dark ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.24)'
              }
            />
            <Stop
              offset="0.72"
              stopColor={
                theme.dark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.14)'
              }
            />
            <Stop
              offset="1"
              stopColor={
                theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.10)'
              }
            />
          </LinearGradient>
        </Defs>
        {hasCorners ? (
          <Path
            d={cornerPath}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={rimWidth}
          />
        ) : (
          <Rect
            x={rimWidth / 2}
            y={rimWidth / 2}
            width={Math.max(size.w - rimWidth, 0)}
            height={Math.max(size.h - rimWidth, 0)}
            rx={r}
            ry={r}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={rimWidth}
          />
        )}
      </Svg>
    ) : null;

  // 只要玻璃边：照片保持原样清晰，只在最上层描一圈高光
  if (rimOnly) {
    return (
      // overflow:'hidden'：Android 上父 View 的 borderRadius 不裁剪子 View，
      // 没有它 tint 绝对定位层会从圆角处溢出来（用户反馈「颜色溢出玻璃栏」）
      <View
        style={[style, cornerStyle, {overflow: 'hidden'}]}
        onLayout={onLayout}>
        {children}
        {rim}
      </View>
    );
  }

  if (!forceFrosted && hasNativeGlass()) {
    // 原生 AGSL 玻璃：色调由着色器处理（glassOpacity 越低越透）
    // 容错：原生模块没打进当前 APK（或该 ROM 不支持）时 LiquidGlassView
    // 会是 undefined，直接渲染会抛「Element type is invalid」红屏。
    // 取不到就回到下面的磨砂路径——同样有玻璃观感、且任何 ROM 都稳定。
    try {
      const Native = require('@sbaiahmed1/react-native-blur').LiquidGlassView;
      if (Native) {
        return (
          <Native
            glassType={glassType}
            // 默认用中性灰（MIUIX 卡片面）。纯白 tint 会在浅色壁纸下泛白刺眼。
            glassTintColor={tintColor}
            glassOpacity={alpha}
            // 必须关：isInteractive 默认 true，Android 上它会注册自己的触摸监听
            // （做 iOS 风格的 press-scale），把 touch 吞掉，导致父级手势收不到。
            isInteractive={false}
            style={[style, cornerStyle]}
            onLayout={onLayout}>
            {children}
            {rim}
          </Native>
        );
      }
    } catch {
      // 落到磨砂路径
    }
  }

  // 磨砂：半透明色调 + 高光描边（默认不跑真模糊）
  //
  // blur=true 时在色调层**下面**再叠一层 BlurView：先把背后的壁纸/页面
  // 内容糊掉，再盖色调 → 弹窗读起来是一块磨砂玻璃板而不是「半透明塑料片」。
  // 顺序很关键：模糊必须在色调**之下**，否则模糊会被色调一起压掉。
  //
  // 按需 require + 容错：原生模块没打进当前 APK 时 BlurView 为 undefined，
  // 直接渲染会抛「Element type is invalid」红屏。这里取不到就退化为不模糊，
  // 保证弹窗照常可用（只是没有模糊层）。
  let BlurView: any = null;
  if (blur) {
    try {
      const mod = require('@sbaiahmed1/react-native-blur');
      BlurView = mod?.BlurView ?? null;
    } catch {
      BlurView = null;
    }
  }
  const frosted = (
    <View
      style={[style, cornerStyle, {overflow: 'hidden'}]}
      onLayout={onLayout}>
      {BlurView ? (
        <BlurView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          // 用 blurType 控制模糊层的叠加色；'regular' 在 Android 上是
          // 一层很淡的白（argb 35），不会额外把面板提亮。
          blurType="regular"
          blurAmount={blurAmount}
          blurRounds={blurRounds}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            ...cornerStyle,
            backgroundColor: tint
              ? hexToRgba(tint, alpha)
              : glassTint(theme, backdrop),
          },
        ]}
      />
      {children}
      {rim}
    </View>
  );

  return frosted;
};

/**
 * 卡片包装器：**界面风格 = 液态玻璃** 时渲染成玻璃，否则保持原样。
 *
 * 这样每个页面只要把 `<View style={styles.card}>` / `<TouchableOpacity style={styles.card}>`
 * 换成 `<SurfaceCard style={styles.card}>`，就能在两种风格间自动切换，
 * 而「标准 / MIUIX」两个选项的观感**一点不变**。
 *
 * ⚠️ 内容必须放在玻璃**里面**：原生玻璃在抓取背景快照时会排除自己的子树，
 * 如果内容是玻璃的兄弟节点，文字会被拍进背景、再被着色器折射一次，
 * 就会出现「文字后面有一层鬼影」。
 */
export const SurfaceCard: React.FC<{
  style?: StyleProp<ViewStyle>;
  backdrop?: 'wallpaper' | 'solid';
  radius?: number;
  /** 原元素是 react-native-paper 的 <Card>（非玻璃模式要还原成纸卡外观） */
  paper?: boolean;
  elevation?: number;
  /** 自定义玻璃色调（见 GlassSurface） */
  tint?: string;
  tintOpacity?: number;
  /** 原生玻璃类型：'regular' = 更磨砂（模糊更重），默认 'clear' */
  glassType?: 'clear' | 'regular';
  /** 边缘高光描边宽度（玻璃叠玻璃时加大以区分层级） */
  rimWidth?: number;
  /** 磨砂路径叠加真实模糊（见 GlassSurface 的 blur） */
  blur?: boolean;
  blurAmount?: number;
  blurRounds?: number;
  /**
   * 强制走磨砂路径（即使设备支持原生 AGSL 玻璃）。
   *
   * 弹窗面板默认走这一档：原生 LiquidGlassView 在部分 ROM（实测小米
   * HyperOS / API 34）的覆盖层里采样不到背景 → 面板渲染成透明、内容看不清。
   * 磨砂路径不依赖抓屏，只用半透明色调 + 真实模糊，任何 ROM 都稳定，
   * 而且 blur 才会真正生效（原生路径下 blur 是被忽略的）。
   */
  forceFrosted?: boolean;
  /** TouchableOpacity 的按压透明度（透传给内层触摸层） */
  activeOpacity?: number;
  /** paper <Card> 的内层容器样式（玻璃模式下套在内容外层） */
  contentStyle?: StyleProp<ViewStyle>;
  /** 单独关掉这张卡的按压缩放（某些页布局会被撑坏时用） */
  noPressScale?: boolean;
  /** 卡内任意触摸（含子级可点行）都让整张卡缩放（设置页那种“行在卡里”的场景） */
  scaleOnAnyTouch?: boolean;
  accessibilityState?: {
    disabled?: boolean;
    selected?: boolean;
    checked?: boolean;
  };
  onPress?: () => void;
  disabled?: boolean;
  accessibilityRole?: 'button' | 'none';
  accessibilityLabel?: string;
  testID?: string;
  children?: React.ReactNode;
}> = observer(
  ({
    style,
    backdrop = 'solid',
    radius,
    paper = false,
    elevation,
    tint,
    tintOpacity,
    glassType,
    rimWidth,
    blur,
    blurAmount,
    blurRounds,
    forceFrosted,
    activeOpacity,
    contentStyle,
    noPressScale,
    scaleOnAnyTouch,
    accessibilityState,
    onPress,
    disabled,
    accessibilityRole,
    accessibilityLabel,
    testID,
    children,
  }) => {
    // 界面风格 = 液态玻璃 / MIUIX 时渲染成玻璃，标准风格保持原样实底。
    // 之前只有液态玻璃才渲染玻璃、MIUIX 只是圆角+蓝杠；现在 MIUIX 也走玻璃，
    // 磨砂（真实模糊）由下方 frostedOn 控制（仅 MIUIX + 磨砂选项开启时生效）。
    const glassOn = uiStore.themeStyle !== 'standard';

    // 按压放大（仅液态玻璃）：可点/不可点玻璃都放大，松手回弹。
    // 用原生驱动只跑 transform，且绝不带 easing（RN 0.82 原生驱动带 easing 会报错）。
    const press = useRef(new Animated.Value(0)).current;
    const runPress = (to: number) => {
      if (!glassOn) {
        return;
      }
      motionSpring(press, {
        toValue: to,
        ...SPRING_PRESS,
        useNativeDriver: true,
      }).start();
    };
    const pressScale = press.interpolate({
      inputRange: [0, 1],
      outputRange: [1, PRESS_SCALE],
    });

    const flat = (StyleSheet.flatten([style]) ?? {}) as ViewStyle;

    // 玻璃模式下要剥掉样式里的 backgroundColor（玻璃自带色调），圆角沿用原样
    const {backgroundColor: _bg, ...rest} = flat;
    void _bg; // 仅用于从 rest 中剥掉 backgroundColor

    /**
     * 按压缩放需要在玻璃外面套一层 Pressable + Animated.View（放大的必须是整块
     * 玻璃）。但外层一旦成为新的 flex item，卡片自带的 `width:'48%'` /
     * `flex:1`（主页宫格、并排卡）就会相对这层重新计算 → 布局塌掉。
     * 所以把「布局类」样式（flex / 宽高 / 外边距 / 对齐 / 定位）拆出来挂到外层
     * Pressable 上，玻璃只保留视觉 + 内边距并 flex:1 填满外层。
     */
    const {
      flex,
      flexGrow,
      flexShrink,
      flexBasis,
      alignSelf,
      width,
      height,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      margin,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      marginHorizontal,
      marginVertical,
      position,
      top,
      bottom,
      left,
      right,
      zIndex,
      ...innerStyle
    } = rest;
    const layoutStyle: ViewStyle = {
      flex,
      flexGrow,
      flexShrink,
      flexBasis,
      alignSelf,
      width,
      height,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      margin,
      marginTop,
      marginBottom,
      marginLeft,
      marginRight,
      marginHorizontal,
      marginVertical,
      position,
      top,
      bottom,
      left,
      right,
      zIndex,
    };

    /**
     * paper 的 <Card> 会给子元素注入 index/total/siblings/borderRadiusStyles，
     * <Card.Content> 靠这些算「首/末/独占」的内边距。
     * 换成 SurfaceCard 后没有纸卡做这件事，这里补上同样的注入，
     * 否则卡片的上下内边距会和原来不一样（布局就变了）。
     */
    // 只有 paper 的 <Card.Content> / <Card.Title> 依赖 index/total/siblings
    // 来算「首/末/独占」的内边距，普通 View 卡片不需要 —— 而且**不能**给它们注入
    // 这些额外 props（会一路传到原生视图上）。
    let content = children;
    if (paper) {
      const total = React.Children.count(children);
      const siblings = React.Children.map(children, child =>
        React.isValidElement(child) && child.type
          ? ((child.type as {displayName?: string}).displayName ?? null)
          : null,
      );
      const borderRadiusStyles = {
        borderRadius:
          typeof flat.borderRadius === 'number' ? flat.borderRadius : undefined,
      };
      content = React.Children.map(children, (child, index) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, {
              index,
              total,
              siblings,
              borderRadiusStyles,
            })
          : child,
      );
    }

    if (!glassOn) {
      // 非玻璃模式：原样渲染，样式里的 backgroundColor 照旧生效
      if (paper) {
        return (
          <PaperCard
            elevation={(elevation ?? 0) as 0 | 1 | 2 | 3 | 4 | 5}
            style={style}
            contentStyle={contentStyle}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole={accessibilityRole}
            accessibilityLabel={accessibilityLabel}
            accessibilityState={accessibilityState}
            testID={testID}>
            {content}
          </PaperCard>
        );
      }
      if (onPress) {
        return (
          <TouchableOpacity
            style={style}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole={accessibilityRole ?? 'button'}
            accessibilityLabel={accessibilityLabel}
            accessibilityState={accessibilityState}
            testID={testID}>
            {children}
          </TouchableOpacity>
        );
      }
      return (
        <View style={style} testID={testID}>
          {children}
        </View>
      );
    }

    // 按压放大由外层 Pressable 驱动 → 放大分支用不带触摸层的 body。
    const body = contentStyle ? (
      <View style={contentStyle}>{content}</View>
    ) : (
      content
    );

    // 纯玻璃（无按压缩放）分支：onPress 必须由内层 TouchableOpacity 处理，
    // 否则卡片点了没反应（之前把内层去掉、又关掉外层 Pressable 就点了没反应）。
    const pressInner = onPress ? (
      <TouchableOpacity
        style={styles.pressFill}
        onPress={onPress}
        activeOpacity={activeOpacity}
        disabled={disabled}
        accessibilityRole={accessibilityRole ?? 'button'}
        accessibilityLabel={accessibilityLabel}
        accessibilityState={accessibilityState}
        testID={testID}>
        {content}
      </TouchableOpacity>
    ) : (
      content
    );
    const plainBody = contentStyle ? (
      <View style={contentStyle}>{pressInner}</View>
    ) : (
      pressInner
    );

    // 顶栏这类「只有下两角是圆的」需要通过 radii 传分角圆角，
    // 否则 GlassSurface 会按统一的 cardRadius 把四个角都磨圆。
    const hasCornerRadii =
      flat.borderTopLeftRadius !== undefined ||
      flat.borderTopRightRadius !== undefined ||
      flat.borderBottomLeftRadius !== undefined ||
      flat.borderBottomRightRadius !== undefined;
    const radiiProp = hasCornerRadii
      ? {
          tl: (flat.borderTopLeftRadius as number) ?? 0,
          tr: (flat.borderTopRightRadius as number) ?? 0,
          br: (flat.borderBottomRightRadius as number) ?? 0,
          bl: (flat.borderBottomLeftRadius as number) ?? 0,
        }
      : undefined;

    // ── 低版本系统的玻璃质感 ──
    // API<33（鸿蒙 5.0 以下、多数华为平板）没有 AGSL 原生玻璃，磨砂路径
    // 只能给「弹窗等单个大面板」开实时模糊；普通卡片一屏几十张同时 blur
    // 在低端机实测 100% 掉帧（中位 97ms/帧 vs 不开 7ms），因此卡片维持
    // 「半透明 tint + 高光描边」的轻磨砂，模糊仅弹窗/大面板使用。
    // 磨砂（真实模糊）仅在「MIUIX 风格 + 磨砂选项开启」时生效；
    // 液态玻璃风格走原生 AGSL（不强制磨砂路径），标准风格不渲染玻璃。
    // MIUIX 强制走磨砂路径（原生 AGSL 在部分 ROM 隐形，磨砂路径稳定可见）。
    const frostedOn = uiStore.themeStyle === 'rounded' && uiStore.frosted;
    const cardBlur = blur ?? frostedOn;
    const cardBlurAmount = blurAmount;
    const cardBlurRounds = blurRounds;
    const cardForceFrosted = forceFrosted ?? uiStore.themeStyle === 'rounded';

    // 诊断开关：false = 关掉卡片按压缩放（排查图像增强等页布局被撑坏时用）。
    if (!glassOn || !GLASS_PRESS_SCALE || noPressScale) {
      return (
        <GlassSurface
          style={rest}
          backdrop={backdrop}
          radius={radius}
          radii={radiiProp}
          tint={tint}
          tintOpacity={tintOpacity}
          glassType={glassType}
          rimWidth={rimWidth}
          blur={cardBlur}
          blurAmount={cardBlurAmount}
          blurRounds={cardBlurRounds}
          forceFrosted={cardForceFrosted}>
          {plainBody}
        </GlassSurface>
      );
    }

    // 液态玻璃：布局样式挂外层 Pressable（真正的 flex item），玻璃 flex:1 填满它；
    // 整块玻璃套一层 Animated.View 驱动放大；onPress 提到 Pressable 这一层。
    return (
      <Pressable
        style={layoutStyle}
        onPressIn={() => runPress(1)}
        onPressOut={() => runPress(0)}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole={
          onPress ? (accessibilityRole ?? 'button') : accessibilityRole
        }
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{...accessibilityState, disabled}}
        testID={testID}>
        <Animated.View
          {...(scaleOnAnyTouch
            ? {
                onTouchStart: () => runPress(1),
                onTouchEnd: () => runPress(0),
                onTouchCancel: () => runPress(0),
              }
            : {})}
          style={{flexGrow: 1, transform: [{scale: pressScale}]}}>
          <GlassSurface
            style={[innerStyle, {flexGrow: 1}]}
            backdrop={backdrop}
            radius={radius}
            radii={radiiProp}
            tint={tint}
            tintOpacity={tintOpacity}
            glassType={glassType}
            rimWidth={rimWidth}
            blur={cardBlur}
            blurAmount={cardBlurAmount}
            blurRounds={cardBlurRounds}
            forceFrosted={cardForceFrosted}>
            {body}
          </GlassSurface>
        </Animated.View>
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  // 玻璃模式下，触摸层铺满整张卡片（内容在它里面 → 会被背景快照排除）
  pressFill: {
    flex: 1,
  },
});
