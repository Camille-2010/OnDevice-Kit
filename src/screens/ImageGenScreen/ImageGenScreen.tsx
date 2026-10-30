import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import {Card, Icon, ProgressBar, Text} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {observer} from 'mobx-react';
import {useNavigation} from '@react-navigation/native';
import {ROUTES} from '../../utils/navigationConstants';

import {useTheme} from '../../hooks';
import {BackButton} from '../../components/BackButton';
import {AnimatedSheet} from '../../components/AnimatedSheet';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Entrance} from '../../components/Entrance';
import {KeyboardAwareScrollView} from 'react-native-keyboard-controller';
import {SectionLabel} from '../../components/SectionLabel';
import {
  headerBg,
  cardRadius,
  headerBottomRadius,
  headerTranslucent,
  glassButton,
  dialogGlassTint,
} from '../../theme/cards';
import {HEADER_EXTRA, HEADER_HEIGHT} from '../../theme/cards';
import {
  SurfaceCard,
  GlassTextField,
  GlassSurface,
} from '../../components/GlassSurface';
import {PillLabel} from '../../components/PillLabel';
import {SheetGlass} from '../../components/SheetGlass';
import {
  imageGenStore,
  uiStore,
  SAMPLERS,
  SCHEDULERS,
  RUNTIMES,
} from '../../store';
import {pick, types} from '@react-native-documents/picker';
import {
  addSdGenProgressListener,
  sdGenAvailable,
  sdGenCancel,
  sdGenGenerate,
  sdGenIsReady,
  type SdGenBackend,
  type SdGenProgress,
} from '../../specs/NativeSdGen';

/**
 * 滑块尺寸（dp）。
 *
 * 原来用的是 @react-native-community/slider 的原生控件，默认那个小圆点
 * 在高密度屏上几乎看不见、也抓不住。这一版改成自绘（下方 sliderHit/
 * sliderTrackBg/sliderThumb），好处是轨道粗细、滑块大小、按下反馈都能
 * 完全控制 —— 滑块做成「按钮」质感，触控命中区也放宽到 44dp。
 */
const SLIDER_THUMB_SIZE = 22;
const SLIDER_TRACK_HEIGHT = 8;

/**
 * 参数行：自绘滑块（本地 state 控制，松手才同步 store）。
 *
 * 【必须是模块级组件，不能定义在 ImageGenScreen 函数体里】
 * 内联定义的组件每次父级重渲染都会变成一个「全新的组件类型」，
 * React 认为组件类型变了 → 整棵子树卸载重挂 → 松手写 store 时整行闪一下。
 */
type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValue: (v: number) => void;
  stepText?: string;
  styles: ReturnType<typeof createStyles>;
};

const SliderRow: React.FC<SliderRowProps> = ({
  label,
  value,
  min,
  max,
  step,
  onValue,
  stepText,
  styles,
}) => {
  const [local, setLocal] = React.useState(value);
  // 最新值放 ref 里给松手时读：写 store 必须发生在事件回调里，
  // 绝不能塞进 setState 的 updater（updater 是在渲染阶段执行的，
  // 那等于渲染中改 MobX store，会被 mobx-react 拦下来报错）。
  const localRef = React.useRef(value);
  localRef.current = local;
  // 轨道宽度必须是 state 而不是 ref：
  // ref 改了不会触发重渲染，滑块位置会一直停在 0（值不同但都贴左边）。
  const [trackW, setTrackW] = React.useState(0);
  const trackWRef = React.useRef(0);
  trackWRef.current = trackW;
  // 外部 value 变了（store 被别处改动）要同步回本地，否则会一直停在旧值
  React.useEffect(() => {
    setLocal(value);
    localRef.current = value;
  }, [value]);
  // 归一化到 0~1，交给自绘轨道/滑块渲染
  const pct = max > min ? (local - min) / (max - min) : 0;
  const width = trackW;
  const [dragging, setDragging] = React.useState(false);

  // 手势方向判定用的 ref：
  //   startXRef/startYRef 按下时的落点（没有横向拖动时当成「点击」，按这个点跳值）
  //   horizontalRef       是否已判定成「在拖滑块」（横向位移明显大于纵向）
  const startXRef = React.useRef(0);
  const startYRef = React.useRef(0);
  const horizontalRef = React.useRef(false);

  const applyFromX = (x: number) => {
    const w = trackWRef.current;
    if (w <= 0) {
      return;
    }
    // Thumb 中心对齐指针：往左半个 thumb 宽度，让点击落在滑块上更准
    const ratio = Math.min(1, Math.max(0, (x - SLIDER_THUMB_SIZE / 2) / w));
    const raw = min + ratio * (max - min);
    const snapped = step > 0 ? Math.round(raw / step) * step : raw;
    const next = Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
    localRef.current = next;
    setLocal(next);
  };

  return (
    <SurfaceCard style={styles.sliderRow} tintOpacity={0.28} rimWidth={1.6}>
      <View style={styles.sliderHeader}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderValue}>{local}</Text>
      </View>
      <View
        style={styles.sliderHit}
        onLayout={e => {
          setTrackW(e.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // 随时允许父级 ScrollView 抢走手势：竖着划页面时不能被滑块卡住
        onResponderTerminationRequest={() => true}
        onResponderGrant={e => {
          // 按下时只记落点，**先不改数值** ——
          // 否则手指一碰到滑块就把参数改掉了，这是误触的根源
          startXRef.current = e.nativeEvent.locationX;
          startYRef.current = e.nativeEvent.locationY;
          horizontalRef.current = false;
        }}
        onResponderMove={e => {
          if (!horizontalRef.current) {
            // 用 locationX/Y 相对按下点算位移（View 的 responder 回调
            // 类型上不给 gestureState，只能自己算）
            const dx = e.nativeEvent.locationX - startXRef.current;
            const dy = e.nativeEvent.locationY - startYRef.current;
            // 只有横向位移超过阈值、并且明显大于纵向，才认定是在拖滑块；
            // 否则直接放行，交给 ScrollView 去滚页面（数值一动不动）
            if (Math.abs(dx) <= 6 || Math.abs(dx) <= Math.abs(dy)) {
              return;
            }
            horizontalRef.current = true;
            setDragging(true);
          }
          applyFromX(e.nativeEvent.locationX);
        }}
        onResponderRelease={() => {
          setDragging(false);
          if (!horizontalRef.current) {
            // 全程没有横向拖动 → 当成点击，跳到按下的那个位置
            applyFromX(startXRef.current);
          }
          // 直接在事件回调里同步 store。这里不能写成
          // setLocal(cur => { onValue(cur); return cur; })——
          // updater 由 React 在渲染阶段执行，等于渲染中改 MobX store。
          onValue(localRef.current);
        }}
        onResponderTerminate={() => {
          setDragging(false);
          // 被 ScrollView 抢走手势：只有真的横向拖过才提交，纯滚动不提交
          if (horizontalRef.current) {
            onValue(localRef.current);
          }
          horizontalRef.current = false;
        }}>
        {/* 轨道底 */}
        <View style={styles.sliderTrackBg} />
        {/* 已调节部分 */}
        <View
          style={[
            styles.sliderTrackFill,
            {width: `${Math.round(pct * 1000) / 10}%`},
          ]}
        />
        {/* 滑块：加大加粗成「按钮」质感，按下时再放大一档 */}
        <View
          pointerEvents="none"
          style={[
            styles.sliderThumb,
            dragging ? styles.sliderThumbActive : null,
            {
              left: Math.max(
                0,
                Math.min(
                  width - SLIDER_THUMB_SIZE,
                  pct * width - SLIDER_THUMB_SIZE / 2,
                ),
              ),
            },
          ]}
        />
      </View>
      {stepText ? (
        <PillLabel style={styles.sliderHintPill} radius={11} rimWidth={1.4}>
          <Text style={styles.sliderHint}>{stepText}</Text>
        </PillLabel>
      ) : null}
    </SurfaceCard>
  );
};

/**
 * 图像生成页（Local Dream 风格）。
 *
 * 布局自上而下：预览图 → 提示词 → 参数 → 生成按钮 → 服务设置 → 历史。
 * 所有参数都会真的发到 Stable Diffusion 服务端，不是摆设。
 */
export const ImageGenScreen: React.FC = observer(() => {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  // 液态玻璃风格下按钮 = 半透明玻璃底 + 高光描边（非玻璃风格展开空对象）
  const glassBtnOutlined = glassButton(theme);
  const glassBtnFilled = glassButton(theme, 'filled');
  // 液态玻璃风格开关（顶栏/胶囊等需要按风格分支的地方用）
  const glassOn = uiStore.themeStyle === 'liquid-glass';
  // 弹窗面板玻璃化（第三版）：玻璃模式下面板本体完全透明，
  // 玻璃由 SheetBody（GlassSurface）画 —— 半透明底色方案采样源仍是
  // 近白面板，内部卡片显白、没有折射感（用户截图反馈）。
  // sheetStyle 类型是 ViewStyle | ViewStyle[]，不接 null → 非玻璃模式给空对象
  const glassSheet: ViewStyle = glassOn
    ? {backgroundColor: 'transparent', paddingHorizontal: 0, paddingBottom: 0}
    : {};
  // 弹窗内小卡片（芯片 / 模型卡）：白色 tint，与磨砂灰面板拉开层次。
  // 深色主题下白卡会刺眼，维持默认玻璃色调。
  const sheetCardTint = theme.dark ? undefined : '#FFFFFF';
  const sheetCardTintOpacity = theme.dark ? 0.28 : 0.8;
  const navigation = useNavigation<any>();
  const store = imageGenStore;
  // 顶部栏要画到系统状态栏底下，必须知道状态栏真实高度
  const insets = useSafeAreaInsets();

  const [probeMsg, setProbeMsg] = useState<string | null>(null);
  // 参数默认折叠：常用流程只有「填提示词 → 点生成」，
  // 步数/CFG/种子这些属于进阶调节，需要时再展开
  const [showParams, setShowParams] = useState(false);
  const [showServer, setShowServer] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  // 本机模型下载：直链输入框（下载完成后清空）
  const [dlUrl, setDlUrl] = useState('');
  const cloudMode = store.mode === 'cloud';
  // 种子用输入框，本地存字符串：-1 在界面上显示成空（= 每次随机）
  const [seedText, setSeedText] = useState(
    store.seed >= 0 ? String(store.seed) : '',
  );

  const latest = store.history[0];
  const previewUri = latest?.uri;

  // 顶部栏底色：规则与主页头部保持一致
  //   - 开了液态玻璃：半透明浅色（内容从下面透出来）
  //   - 否则：headerBg（surface 浅灰面）
  // 顶栏底色统一走 headerTranslucent：玻璃风格下半透明（透出根层壁纸），
  // 其他风格自动回落实底（零视觉变化）。
  const headerBackground = headerTranslucent(theme, headerBg(theme));

  const onProbe = async () => {
    setProbeMsg('正在连接…');
    // 连上就把可用模型一起拉回来并自动选中 —— 用户不用再点一次「读取」
    const ok = await store.detectCloudModels();
    setProbeMsg(
      ok
        ? `连接成功，检测到 ${store.serverModels.length} 个可用模型${
            store.serverModels.length
              ? `：${store.serverModels.slice(0, 3).join('、')}`
              : ''
          }`
        : `连接失败：${store.cloudDetectError || '未知原因'}`,
    );
  };

  // 进页面自动检测一次云端模型（有地址才发请求，避免空转）
  useEffect(() => {
    if (store.serverUrl.trim() && store.serverModels.length === 0) {
      store.detectCloudModels();
    }
    // 只在挂载时跑一次：后续由「测试连接 / 重新检测」触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 地址被改动后自动重新检测（防抖 900ms）：换个服务器不必再手动点按钮
  useEffect(() => {
    const url = store.serverUrl.trim();
    if (!url) {
      return;
    }
    const timer = setTimeout(() => {
      store.detectCloudModels();
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.serverUrl]);

  // 从手机里挑一个 .gguf 导入到私有目录
  const onImportLocalModel = async () => {
    try {
      const [f] = await pick({type: [types.allFiles]});
      if (f?.uri) {
        await store.importLocalModel(f.uri, f.name ?? undefined);
      }
    } catch {
      // 用户取消选择：不提示
    }
  };

  const onDownloadLocal = async () => {
    const model = await store.downloadLocalModel(dlUrl);
    if (model) {
      setDlUrl('');
    }
  };

  // 种子输入：只收数字，留空表示 -1（每次随机），会真的写进请求
  const onSeedChange = (t: string) => {
    // SD 服务端的种子是 uint32；超出范围 A1111 会直接拒请求，这里封顶。
    const SEED_MAX = 4294967295;
    const digits = t.replace(/[^0-9]/g, '').slice(0, 10);
    setSeedText(digits);
    const n = Number(digits);
    store.setSeed(
      digits === '' || !Number.isFinite(n) ? -1 : Math.min(n, SEED_MAX),
    );
  };

  // 打开「可用模型」面板（和左上角模型入口同一套逻辑）
  const openModelPicker = () => {
    setShowModelPicker(true);
    if (cloudMode && store.serverModels.length === 0 && !store.cloudDetecting) {
      store.detectCloudModels();
    }
  };

  // 顶栏右侧：运行位置切换（云端 / 本机）。
  // 选中项用主色（蓝）实心填充 + onPrimary 文字/图标，未选中透明 ——
  // 一眼看出当前「图在哪算」。竖向由 header 的 alignItems:'center' 居中。
  const modeToggle = (
    <View style={styles.modeSwitch}>
      <TouchableOpacity
        activeOpacity={0.8}
        style={[styles.modeChip, cloudMode && styles.modeChipActive]}
        onPress={() => store.setMode('cloud')}
        accessibilityRole="button"
        accessibilityState={{selected: cloudMode}}>
        <Icon
          source="cloud-outline"
          size={18}
          color={
            cloudMode ? theme.colors.onPrimary : theme.colors.onSurfaceVariant
          }
        />
        <Text
          style={[styles.modeChipText, cloudMode && styles.modeChipTextActive]}>
          云端
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        activeOpacity={0.8}
        style={[styles.modeChip, !cloudMode && styles.modeChipActive]}
        onPress={() => store.setMode('local')}
        accessibilityRole="button"
        accessibilityState={{selected: !cloudMode}}>
        <Icon
          source="cellphone"
          size={18}
          color={
            !cloudMode ? theme.colors.onPrimary : theme.colors.onSurfaceVariant
          }
        />
        <Text
          style={[
            styles.modeChipText,
            !cloudMode && styles.modeChipTextActive,
          ]}>
          本机
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={{flex: 1}}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          {/*
          顶部栏放在 ScrollView 内部、作为内容第一个子元素 ——
          和主页完全一致：向上翻页时整条会跟着内容一起滚走，而不是钉在顶部。
          液态玻璃风格下走真玻璃（页面内可采到壁纸）；其他风格保持半透明实底。
        */}
          {glassOn ? (
            <GlassSurface
              backdrop="wallpaper"
              radii={{
                tl: 0,
                tr: 0,
                br: headerBottomRadius(),
                bl: headerBottomRadius(),
              }}
              style={[
                styles.header,
                {
                  height: HEADER_HEIGHT + insets.top + HEADER_EXTRA,
                  paddingTop: insets.top + 8,
                  paddingBottom: HEADER_EXTRA,
                },
              ]}>
              <BackButton onPress={() => navigation.goBack()} iconSize={20} />
              <Text style={styles.headerTitle}>图像生成</Text>
              <View style={styles.headerSpacer} />
              {modeToggle}
            </GlassSurface>
          ) : (
            <View
              style={[
                styles.header,
                {
                  height: HEADER_HEIGHT + insets.top + HEADER_EXTRA,
                  paddingTop: insets.top,
                  paddingBottom: HEADER_EXTRA,
                  // 底色规则与主页头部一致（磨砂/液态玻璃/普通）
                  backgroundColor: headerBackground,
                },
              ]}>
              <BackButton onPress={() => navigation.goBack()} iconSize={20} />
              <Text style={styles.headerTitle}>图像生成</Text>
              <View style={styles.headerSpacer} />
              {modeToggle}
            </View>
          )}

          <View style={styles.content}>
            {/* 1. 模型/参数行（「下拉状态栏」）：玻璃胶囊 */}
            <View style={styles.toolbar}>
              <PillLabel style={styles.toolbarPill} radius={21}>
                <TouchableOpacity
                  style={styles.toolbarLeft}
                  hitSlop={8}
                  onPress={openModelPicker}>
                  <Icon
                    source="menu"
                    size={22}
                    color={theme.colors.onSurface}
                  />
                  <Text style={styles.toolbarLabel} numberOfLines={1}>
                    {cloudMode
                      ? store.modelName || '选择云端模型'
                      : store.activeLocalModel?.name || '选择本机模型'}
                  </Text>
                  <Icon
                    source="chevron-down"
                    size={18}
                    color={theme.colors.onSurfaceVariant}
                  />
                </TouchableOpacity>
              </PillLabel>
              {cloudMode ? (
                <PillLabel style={styles.toolbarPillRight} radius={21}>
                  <TouchableOpacity
                    style={styles.toolbarRight}
                    onPress={() => setShowParams(s => !s)}
                    hitSlop={8}>
                    <Text style={styles.toolbarParam} numberOfLines={1}>
                      {store.width}×{store.height} · {store.steps}步 · CFG{' '}
                      {store.guidance}
                    </Text>
                    <Icon
                      source={showParams ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={theme.colors.primary}
                    />
                  </TouchableOpacity>
                </PillLabel>
              ) : null}
            </View>

            {/* 2. 预览（云端） */}
            {cloudMode ? (
              <Entrance index={0} screenKey="imagegen">
                {/* rimOnly：生成图保持清晰，只描一圈玻璃高光边 */}
                <GlassSurface rimOnly style={styles.previewWrap}>
                  <View style={styles.sourceBadge}>
                    <Icon
                      source="cloud-outline"
                      size={12}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text style={styles.sourceBadgeText}>云端</Text>
                  </View>
                  {previewUri ? (
                    <Image
                      source={{uri: previewUri}}
                      style={styles.preview}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={styles.previewEmpty}>
                      <Text style={styles.previewEmptyTitle}>
                        还没有生成过图像
                      </Text>
                      <Text style={styles.previewEmptyDesc}>
                        填好提示词和服务地址后点下面的按钮，出图时间取决于电脑/服务器的显卡。
                      </Text>
                    </View>
                  )}
                  {store.isGenerating ? (
                    <View style={styles.previewMask}>
                      <ActivityIndicator color={theme.colors.primary} />
                      <Text style={styles.previewMaskText}>
                        {store.status || '正在生成…'}
                      </Text>
                    </View>
                  ) : null}
                </GlassSurface>
              </Entrance>
            ) : null}

            {/* 2. 提示词 */}
            <Entrance index={1} screenKey="imagegen">
              <SectionLabel title="提示词" style={styles.sectionLabel} />
              <SurfaceCard paper elevation={0} style={styles.card}>
                <Card.Content style={styles.cardContent}>
                  <Text style={styles.inputLabel}>正向提示词</Text>
                  <GlassTextField
                    multiline
                    numberOfLines={3}
                    value={store.positivePrompt}
                    onChangeText={v => store.setPositivePrompt(v)}
                    style={styles.promptGlass}
                    inputStyle={styles.promptInput}
                    placeholder="例如：sky, white clouds, ultra-detailed"
                  />

                  <Text style={styles.inputLabel}>负向提示词</Text>
                  <GlassTextField
                    multiline
                    numberOfLines={3}
                    value={store.negativePrompt}
                    onChangeText={v => store.setNegativePrompt(v)}
                    style={styles.promptGlass}
                    inputStyle={styles.promptInput}
                    placeholder="不想出现的内容"
                  />
                </Card.Content>
              </SurfaceCard>
            </Entrance>

            {/* 4. 生成（云端） */}
            {cloudMode ? (
              <Entrance index={3} screenKey="imagegen">
                {store.error ? (
                  <SurfaceCard
                    style={styles.errorBox}
                    tint="#EF4444"
                    tintOpacity={0.12}>
                    <Text style={styles.errorText}>{store.error}</Text>
                    {/*
                只有「模型确实已就绪、能正常使用」时才不显示这句提示。
                未选模型、服务端没有这个权重、还没读到列表 —— 任一情况都会提示。
              */}
                    {!store.modelReady ? (
                      <Text style={styles.errorHint}>
                        请点击
                        <Text
                          style={styles.errorHintLink}
                          onPress={openModelPicker}>
                          选择云端模型
                        </Text>
                        ，或从服务端重新检测。
                      </Text>
                    ) : null}
                  </SurfaceCard>
                ) : null}
                <Button
                  mode="contained"
                  style={[styles.genBtn, glassBtnFilled]}
                  textColor={theme.colors.primary}
                  loading={store.isGenerating}
                  disabled={store.isGenerating}
                  onPress={() => store.generate()}>
                  {store.isGenerating ? '生成中…' : '云端生成图像'}
                </Button>
              </Entrance>
            ) : null}

            {/* 4b. 本机：模型管理（下载 / 导入）+ CPU 出图 */}
            {!cloudMode ? (
              <Entrance index={3} screenKey="imagegen">
                <SectionLabel title="本机模型" style={styles.sectionLabel} />
                <SurfaceCard paper elevation={0} style={styles.card}>
                  <Card.Content style={styles.cardContent}>
                    {store.localModels.length === 0 ? (
                      <PillLabel style={styles.serverHintPill} radius={15}>
                        <Text style={styles.serverHint}>
                          还没有本机模型。SD1.5 的 .gguf 权重约
                          1GB，下载后才能真正在手机上出图。
                        </Text>
                      </PillLabel>
                    ) : (
                      store.localModels.map(m => {
                        const active = store.activeLocalModel?.id === m.id;
                        return (
                          <TouchableOpacity
                            key={m.id}
                            style={[
                              styles.localModelRow,
                              active && styles.localModelRowActive,
                            ]}
                            onPress={() => store.setLocalModel(m.id)}
                            activeOpacity={0.75}>
                            <Icon
                              source={
                                active ? 'radiobox-marked' : 'radiobox-blank'
                              }
                              size={18}
                              color={
                                active
                                  ? theme.colors.primary
                                  : theme.colors.onSurfaceVariant
                              }
                            />
                            <View style={styles.localModelBody}>
                              <Text
                                style={styles.localModelName}
                                numberOfLines={1}>
                                {m.name}
                              </Text>
                              <Text style={styles.localModelMeta}>
                                {m.sizeBytes
                                  ? `${(m.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB`
                                  : '大小未知'}{' '}
                                · 本机
                              </Text>
                            </View>
                            <TouchableOpacity
                              hitSlop={8}
                              onPress={() => store.removeLocalModel(m.id)}>
                              <Icon
                                source="trash-can-outline"
                                size={18}
                                color={theme.colors.onSurfaceVariant}
                              />
                            </TouchableOpacity>
                          </TouchableOpacity>
                        );
                      })
                    )}

                    {/* 一键去「模型」页下载：那边会按本机档位自动选一个
                        适配的 SD1.5 GGUF（低/中端 Q4_0，高端 Q8_0）。 */}
                    <Button
                      mode="contained"
                      style={[styles.jumpBtn, glassBtnFilled]}
                      textColor={theme.colors.primary}
                      icon="download"
                      onPress={() => navigation.navigate(ROUTES.MODELS)}>
                      去模型页下载（自动适配本机）
                    </Button>

                    <GlassTextField
                      label="模型直链（.gguf）"
                      value={dlUrl}
                      onChangeText={setDlUrl}
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.inputGlass}
                      inputStyle={styles.inputText}
                      placeholder="https://…/sd15-q4_0.gguf"
                    />
                    <View style={styles.localBtnRow}>
                      <Button
                        mode="outlined"
                        style={[styles.localBtn, glassBtnOutlined]}
                        onPress={onImportLocalModel}>
                        从文件导入
                      </Button>
                      <Button
                        mode="contained"
                        style={[styles.localBtn, glassBtnFilled]}
                        textColor={theme.colors.primary}
                        loading={store.downloadingLocal}
                        disabled={!dlUrl.trim() || store.downloadingLocal}
                        onPress={onDownloadLocal}>
                        下载模型
                      </Button>
                    </View>
                    {store.downloadingLocal ? (
                      <View style={styles.dlProgressWrap}>
                        <ProgressBar
                          progress={store.downloadProgress}
                          indeterminate={store.downloadIndeterminate}
                          color={theme.colors.primary}
                        />
                        <Text style={styles.probeMsg}>
                          {store.downloadName} ·{' '}
                          {store.downloadIndeterminate
                            ? '下载中…（服务器未报告大小）'
                            : `${Math.round(store.downloadProgress * 100)}%`}
                        </Text>
                      </View>
                    ) : null}
                  </Card.Content>
                </SurfaceCard>

                {store.error ? (
                  <SurfaceCard
                    style={styles.errorBox}
                    tint="#EF4444"
                    tintOpacity={0.12}>
                    <Text style={styles.errorText}>{store.error}</Text>
                  </SurfaceCard>
                ) : null}

                <LocalCpuGen
                  prompt={store.positivePrompt}
                  modelPath={store.activeLocalModel?.path}
                />
              </Entrance>
            ) : null}

            {/* 5. 服务设置（仅云端；可折叠，收起时也能看到当前地址） */}
            {cloudMode ? (
              <Entrance index={4} screenKey="imagegen">
                {/* 折叠标题行：整行垫玻璃胶囊（可点击展开/收起） */}
                <PillLabel style={styles.collapsePill} radius={22}>
                  <TouchableOpacity
                    onPress={() => setShowServer(s => !s)}
                    activeOpacity={0.7}
                    style={styles.collapseHeader}>
                    <View style={styles.collapseLeft}>
                      <View
                        style={[styles.collapseBar, styles.collapseBarSmall]}
                      />
                      <Text style={styles.collapseTitle}>服务</Text>
                    </View>
                    <View style={styles.collapseRight}>
                      <Text
                        style={[
                          styles.collapseSummary,
                          !store.serverUrl && styles.collapseSummaryWarn,
                        ]}
                        numberOfLines={1}>
                        {store.serverUrl
                          ? `${store.serverUrl}${
                              store.serverModels.length > 0
                                ? ` · ${store.serverModels.length} 个模型`
                                : ''
                            }`
                          : '未设置 · 点这里填写'}
                      </Text>
                      <Icon
                        source={showServer ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={theme.colors.onSurfaceVariant}
                      />
                    </View>
                  </TouchableOpacity>
                </PillLabel>
                {/* 服务模块的说明文字：浮在壁纸上 → 玻璃胶囊 */}
                <PillLabel style={styles.notePill} radius={15}>
                  <Text style={styles.serviceNote}>
                    所有参数都会真的发给服务端；出图时间取决于服务端显卡
                  </Text>
                </PillLabel>
                {showServer ? (
                  <Entrance index={0} screenKey="imagegen">
                    <SurfaceCard paper elevation={0} style={styles.card}>
                      <Card.Content style={styles.cardContent}>
                        <Text style={styles.inputLabel}>
                          Stable Diffusion 服务地址
                        </Text>
                        <GlassTextField
                          value={store.serverUrl}
                          onChangeText={v => store.setServerUrl(v)}
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.inputGlass}
                          inputStyle={styles.inputText}
                          placeholder="http://192.168.1.56:7860"
                        />
                        <Text style={styles.serverHint}>
                          电脑上跑 Automatic1111 / SD.Next / Forge，启动加
                          --listen --api；手机和电脑同一 Wi-Fi。连不上多半是
                          Windows 防火墙没放行这个端口。
                        </Text>
                        <Button
                          mode="outlined"
                          style={[styles.testBtn, glassBtnOutlined]}
                          onPress={onProbe}>
                          测试连接
                        </Button>
                        {probeMsg ? (
                          <Text style={styles.probeMsg}>{probeMsg}</Text>
                        ) : null}
                      </Card.Content>
                    </SurfaceCard>
                  </Entrance>
                ) : null}
              </Entrance>
            ) : null}

            {/* 6. 历史（云端出图记录） */}
            {cloudMode ? (
              <Entrance index={5} screenKey="imagegen">
                <View style={styles.historyHeader}>
                  <SectionLabel
                    title={`历史（${store.history.length}）`}
                    style={styles.sectionLabel}
                  />
                  {store.history.length > 0 ? (
                    <PillLabel style={styles.clearPill} radius={12}>
                      <TouchableOpacity onPress={() => store.clearHistory()}>
                        <Text style={styles.clearText}>清空</Text>
                      </TouchableOpacity>
                    </PillLabel>
                  ) : null}
                </View>
                {store.history.length === 0 ? (
                  <PillLabel style={styles.emptyHistoryPill} radius={12}>
                    <Text style={styles.emptyHistory}>
                      生成过的图会出现在这里
                    </Text>
                  </PillLabel>
                ) : (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.historyStrip}>
                    {store.history.map(item => (
                      // rimOnly：缩略图保持清晰，只描玻璃边
                      <GlassSurface
                        key={item.id}
                        rimOnly
                        style={styles.thumbWrap}>
                        <Image
                          source={{uri: item.uri}}
                          style={styles.thumb}
                          resizeMode="cover"
                        />
                        <Text style={styles.thumbMeta} numberOfLines={1}>
                          {item.width}×{item.height} · {item.steps}步
                        </Text>
                      </GlassSurface>
                    ))}
                  </ScrollView>
                )}
              </Entrance>
            ) : null}

            <View style={{height: 40}} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 参数设置弹窗 */}
      <AnimatedSheet
        visible={showParams}
        onClose={() => setShowParams(false)}
        inPage
        sheetStyle={[styles.modalSheet, glassSheet]}>
        <SheetGlass>
          {/* 内容可滚动，整块面板高度封顶在屏幕中线略上一点。
            KeyboardAwareScrollView：聚焦种子输入框时自动滚到可见区
            （配合 AnimatedSheet 的键盘 marginBottom 避让） */}
          <KeyboardAwareScrollView
            style={styles.modalScrollView}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.modalScroll}>
            <SectionLabel title="采样器" style={styles.modalSectionLabel} />
            <View style={styles.chipWrap}>
              {SAMPLERS.map(s => {
                const active = store.sampler === s;
                return (
                  <SurfaceCard
                    key={s}
                    onPress={() => store.setSampler(s)}
                    tint={active ? theme.colors.secondary : sheetCardTint}
                    tintOpacity={active ? 0.42 : sheetCardTintOpacity}
                    rimWidth={1.6}
                    style={[styles.chip, active && styles.chipActive]}>
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}>
                      {s}
                    </Text>
                  </SurfaceCard>
                );
              })}
            </View>

            <SectionLabel title="调度器" style={styles.modalSectionLabel} />
            <View style={styles.chipWrap}>
              {SCHEDULERS.map(s => {
                const active = store.scheduler === s;
                return (
                  <SurfaceCard
                    key={s}
                    onPress={() => store.setScheduler(s)}
                    tint={active ? theme.colors.secondary : sheetCardTint}
                    tintOpacity={active ? 0.42 : sheetCardTintOpacity}
                    rimWidth={1.6}
                    style={[styles.chip, active && styles.chipActive]}>
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}>
                      {s}
                    </Text>
                  </SurfaceCard>
                );
              })}
            </View>

            <SectionLabel title="参数" style={styles.modalSectionLabel} />
            <SliderRow
              label="采样步数"
              value={store.steps}
              min={1}
              max={50}
              step={1}
              onValue={v => store.setSteps(Math.round(v))}
              stepText="越高越细，也越慢"
              styles={styles}
            />
            <SliderRow
              label="引导强度 CFG"
              value={store.guidance}
              min={1}
              max={20}
              step={0.5}
              onValue={v => store.setGuidance(v)}
              stepText="越高越贴提示词"
              styles={styles}
            />
            <SliderRow
              label="宽度"
              value={store.width}
              min={256}
              max={1024}
              step={64}
              onValue={v => store.setSize(Math.round(v), store.height)}
              stepText="64 的倍数"
              styles={styles}
            />
            <SliderRow
              label="高度"
              value={store.height}
              min={256}
              max={1024}
              step={64}
              onValue={v => store.setSize(store.width, Math.round(v))}
              stepText="64 的倍数"
              styles={styles}
            />

            <SectionLabel title="Runtime" style={styles.modalSectionLabel} />
            <View style={styles.chipWrap}>
              {RUNTIMES.map(r => {
                const active = store.runtime === r;
                return (
                  <SurfaceCard
                    key={r}
                    onPress={() => store.setRuntime(r)}
                    tint={active ? theme.colors.secondary : sheetCardTint}
                    tintOpacity={active ? 0.42 : sheetCardTintOpacity}
                    rimWidth={1.6}
                    style={[styles.chip, active && styles.chipActive]}>
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}>
                      {r}
                    </Text>
                  </SurfaceCard>
                );
              })}
            </View>

            <SliderRow
              label="批量张数"
              value={store.batchSize}
              min={1}
              max={8}
              step={1}
              onValue={v => store.setBatchSize(Math.round(v))}
              styles={styles}
            />

            <SectionLabel title="高清修复" style={styles.modalSectionLabel} />
            <View style={styles.chipWrap}>
              {[false, true].map(v => {
                const active = store.hiresFix === v;
                return (
                  <SurfaceCard
                    key={String(v)}
                    onPress={() => store.setHiresFix(v)}
                    tint={active ? theme.colors.secondary : sheetCardTint}
                    tintOpacity={active ? 0.42 : sheetCardTintOpacity}
                    rimWidth={1.6}
                    style={[styles.chip, active && styles.chipActive]}>
                    <Text
                      style={[
                        styles.chipText,
                        active && styles.chipTextActive,
                      ]}>
                      {v ? '开' : '关'}
                    </Text>
                  </SurfaceCard>
                );
              })}
            </View>
            {/* 去噪强度：打开高清修复后才真正参与计算 */}
            <SliderRow
              label="Denoise 去噪强度"
              value={store.denoise}
              min={0}
              max={1}
              step={0.05}
              onValue={v => store.setDenoise(v)}
              stepText={`配合高清修复使用（放大 ${store.hiresScale}×）`}
              styles={styles}
            />
            <SliderRow
              label="放大倍数"
              value={store.hiresScale}
              min={1}
              max={2}
              step={0.05}
              onValue={v => store.setHiresScale(v)}
              stepText="高清修复的放大比例"
              styles={styles}
            />

            <SectionLabel
              title="随机种子（可选）"
              style={styles.modalSectionLabel}
            />
            <GlassTextField
              value={seedText}
              onChangeText={onSeedChange}
              keyboardType="number-pad"
              tint={dialogGlassTint(theme)}
              style={styles.seedGlass}
              inputStyle={styles.seedText}
              placeholder="留空 = 每次随机"
            />
          </KeyboardAwareScrollView>

          {/* 页脚：恢复默认参数 / 确定 */}
          <View style={styles.modalFooter}>
            <PillLabel
              style={styles.footerPill}
              radius={15}
              rimWidth={1.4}
              tintOpacity={0.6}>
              <TouchableOpacity
                style={styles.footerBtn}
                onPress={() => {
                  store.resetParams();
                  setSeedText('');
                }}>
                <Icon source="restore" size={16} color={theme.colors.error} />
                <Text style={styles.footerReset}>恢复默认参数</Text>
              </TouchableOpacity>
            </PillLabel>
            <PillLabel
              style={styles.footerPill}
              radius={15}
              rimWidth={1.4}
              tintOpacity={0.6}>
              <TouchableOpacity
                style={styles.footerBtn}
                onPress={() => setShowParams(false)}>
                <Text style={styles.footerConfirm}>确定</Text>
              </TouchableOpacity>
            </PillLabel>
          </View>
        </SheetGlass>
      </AnimatedSheet>

      {/* 模型选择弹窗 */}
      <AnimatedSheet
        visible={showModelPicker}
        onClose={() => setShowModelPicker(false)}
        inPage
        sheetStyle={[styles.modalSheet, glassSheet]}>
        <SheetGlass>
          <View style={styles.modelTitleRow}>
            <PillLabel style={styles.modalTitlePill} radius={20} rimWidth={1.4}>
              <Text style={styles.modalTitle}>选择模型</Text>
            </PillLabel>
            <TouchableOpacity
              hitSlop={8}
              disabled={store.cloudDetecting}
              onPress={() => store.detectCloudModels()}>
              <PillLabel style={styles.refreshPill} radius={12} rimWidth={1.4}>
                <Text style={styles.modelRefresh}>
                  {store.cloudDetecting ? '检测中…' : '重新检测云端'}
                </Text>
              </PillLabel>
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.modalScrollView}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.modalScroll}>
            {/* ── 云端：服务端真实存在的 checkpoint ── */}
            <View style={styles.modelSectionHead}>
              <Icon
                source="cloud-outline"
                size={16}
                color={theme.colors.primary}
              />
              <Text style={styles.modelSectionTitle}>云端 · 电脑/服务器</Text>
              <Text style={styles.modelSectionCount}>
                {store.serverModels.length}
              </Text>
            </View>
            {store.serverModels.length === 0 ? (
              <Text style={styles.modelSectionHint}>
                {store.cloudDetecting
                  ? '正在自动检测可用模型…'
                  : store.cloudDetectError
                    ? `未连上服务端：${store.cloudDetectError}`
                    : '填好服务地址后会自动检测服务端已装的模型'}
              </Text>
            ) : (
              store.serverModels.map(name => {
                const active = cloudMode && store.modelName === name;
                return (
                  <SurfaceCard
                    key={`cloud-${name}`}
                    activeOpacity={0.75}
                    onPress={() => {
                      store.setModel(name);
                      store.setMode('cloud');
                    }}
                    tint={sheetCardTint}
                    tintOpacity={sheetCardTintOpacity}
                    rimWidth={1.6}
                    style={[
                      styles.modelCard,
                      active && styles.modelCardActive,
                    ]}>
                    <View style={styles.modelCardMain}>
                      <View style={styles.modelNameRow}>
                        <Text style={styles.modelName} numberOfLines={1}>
                          {name}
                        </Text>
                        <View style={styles.modelTag}>
                          <Text style={styles.modelTagText}>云端</Text>
                        </View>
                      </View>
                      <Text style={styles.modelDesc}>
                        服务端已安装的 checkpoint
                      </Text>
                    </View>
                    {active ? (
                      <View
                        style={[
                          styles.modelStatePill,
                          styles.modelStatePillActive,
                        ]}>
                        <Text
                          style={[
                            styles.modelStatePillText,
                            styles.modelStatePillActiveText,
                          ]}>
                          使用中
                        </Text>
                      </View>
                    ) : null}
                  </SurfaceCard>
                );
              })
            )}

            {/* ── 本机：下载/导入到手机的权重 ── */}
            <View style={[styles.modelSectionHead, styles.modelSectionHeadGap]}>
              <Icon source="cellphone" size={16} color={theme.colors.primary} />
              <Text style={styles.modelSectionTitle}>本机 · 手机</Text>
              <Text style={styles.modelSectionCount}>
                {store.localModels.length}
              </Text>
            </View>
            {store.localModels.length === 0 ? (
              <Text style={styles.modelSectionHint}>
                还没有本机模型。填下面的直链下载一个 .gguf，或从手机里导入。
              </Text>
            ) : (
              store.localModels.map(m => {
                const active =
                  !cloudMode && store.activeLocalModel?.id === m.id;
                return (
                  <SurfaceCard
                    key={`local-${m.id}`}
                    activeOpacity={0.75}
                    onPress={() => {
                      store.setLocalModel(m.id);
                      store.setMode('local');
                    }}
                    tint={sheetCardTint}
                    tintOpacity={sheetCardTintOpacity}
                    rimWidth={1.6}
                    style={[
                      styles.modelCard,
                      active && styles.modelCardActive,
                    ]}>
                    <View style={styles.modelCardMain}>
                      <View style={styles.modelNameRow}>
                        <Text style={styles.modelName} numberOfLines={1}>
                          {m.name}
                        </Text>
                        <View style={styles.modelTag}>
                          <Text style={styles.modelTagText}>本机</Text>
                        </View>
                      </View>
                      <View style={styles.modelMetaRow}>
                        <Icon
                          source="database"
                          size={13}
                          color={theme.colors.onSurfaceVariant}
                        />
                        <Text style={styles.modelMeta}>
                          {m.sizeBytes
                            ? `${(m.sizeBytes / 1024 / 1024 / 1024).toFixed(2)}GB`
                            : '大小未知'}
                        </Text>
                      </View>
                    </View>
                    {active ? (
                      <View
                        style={[
                          styles.modelStatePill,
                          styles.modelStatePillActive,
                        ]}>
                        <Text
                          style={[
                            styles.modelStatePillText,
                            styles.modelStatePillActiveText,
                          ]}>
                          使用中
                        </Text>
                      </View>
                    ) : null}
                  </SurfaceCard>
                );
              })
            )}

            {/* 本机模型下载 / 导入：选模型时就能直接补权重，不用先跳去本机页 */}
            <GlassTextField
              label="本机模型直链（.gguf）"
              value={dlUrl}
              onChangeText={setDlUrl}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.inputGlass}
              inputStyle={styles.inputText}
              placeholder="https://…/sd15-q4_0.gguf"
            />
            <View style={styles.localBtnRow}>
              <Button
                mode="outlined"
                style={[styles.localBtn, glassBtnOutlined]}
                onPress={onImportLocalModel}>
                从文件导入
              </Button>
              <Button
                mode="contained"
                style={[styles.localBtn, glassBtnFilled]}
                textColor={theme.colors.primary}
                loading={store.downloadingLocal}
                disabled={!dlUrl.trim() || store.downloadingLocal}
                onPress={onDownloadLocal}>
                下载到本机
              </Button>
            </View>
            {store.downloadingLocal ? (
              <View style={styles.dlProgressWrap}>
                <ProgressBar
                  progress={store.downloadProgress}
                  indeterminate={store.downloadIndeterminate}
                  color={theme.colors.primary}
                />
                <Text style={styles.probeMsg}>
                  {store.downloadName} ·{' '}
                  {store.downloadIndeterminate
                    ? '下载中…（服务器未报告大小）'
                    : `${Math.round(store.downloadProgress * 100)}%`}
                </Text>
              </View>
            ) : null}
          </ScrollView>
          <PillLabel style={styles.modelNotePill} radius={15} rimWidth={1.4}>
            <Text style={styles.modelNote}>
              {cloudMode
                ? store.serverModels.length > 0
                  ? `云端已检测到 ${store.serverModels.length} 个权重，点卡片即切换`
                  : '云端模型由服务端自动上报；连不上时这里会给出原因'
                : '点本机模型即切到手机本地出图；没有权重可在下方直接下载或导入'}
            </Text>
          </PillLabel>
          <View style={styles.modalFooter}>
            {cloudMode ? (
              <PillLabel
                style={styles.footerPill}
                radius={15}
                rimWidth={1.4}
                tintOpacity={0.6}>
                <TouchableOpacity
                  style={styles.footerBtn}
                  onPress={() => store.setModel('')}>
                  <Text style={styles.footerReset}>跟随服务端当前模型</Text>
                </TouchableOpacity>
              </PillLabel>
            ) : (
              <PillLabel
                style={styles.footerPill}
                radius={15}
                rimWidth={1.4}
                tintOpacity={0.6}>
                <TouchableOpacity
                  style={styles.footerBtn}
                  onPress={() => store.setMode('cloud')}>
                  <Text style={styles.footerReset}>切到云端出图</Text>
                </TouchableOpacity>
              </PillLabel>
            )}
            <PillLabel
              style={styles.footerPill}
              radius={15}
              rimWidth={1.4}
              tintOpacity={0.6}>
              <TouchableOpacity
                style={styles.footerBtn}
                onPress={() => setShowModelPicker(false)}>
                <Text style={styles.footerConfirm}>确定</Text>
              </TouchableOpacity>
            </PillLabel>
          </View>
        </SheetGlass>
      </AnimatedSheet>
    </View>
  );
});

/** 分辨率预设（按需：先小后大）。 */
const RES_PRESETS = [256, 320, 384, 512] as const;
/** 步数预设。 */
const STEP_PRESETS = [4, 6, 8, 10] as const;

/**
 * 估算耗时（秒）。实测基准（某骁龙8+机型，Mali-G710 OpenCL）：
 *   GPU：256×256 / 4 步 ≈ 73s（采样 54s + VAE 解码 18s）
 *   CPU：256×256 / 4 步 ≈ 110s（采样 69s + VAE 解码 41s）
 * 采样随「像素×步数」线性，解码随「像素」线性。仅用于给用户预期，非精确值。
 */
function estimateSeconds(
  size: number,
  steps: number,
  backend: SdGenBackend,
): number {
  const pf = (size * size) / (256 * 256);
  if (backend === 'gpu') {
    return Math.round(54 * pf * (steps / 4) + 18 * pf);
  }
  return Math.round(69 * pf * (steps / 4) + 41 * pf);
}

function fmtDuration(sec: number): string {
  if (!sec || sec <= 0) {
    return '0 秒';
  }
  if (sec < 60) {
    return `${Math.round(sec)} 秒`;
  }
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
}

/**
 * 手机本地出图。自包含组件。
 * 走原生模块 SdGen 调 stable-diffusion.cpp（sd-cli，OpenCL 构建，随 APK 内置）。
 * 后端可选：gpu（默认，自动：有 OpenCL GPU 走 GPU，无则回退 CPU）/ cpu（强制纯 CPU）。
 * 体验增强：就绪预检、按需分辨率、真实进度条 + ETA、可取消。
 */
const LocalCpuGen: React.FC<{prompt: string; modelPath?: string}> = ({
  prompt,
  modelPath,
}) => {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [size, setSize] = useState<number>(256);
  const [steps, setSteps] = useState<number>(4);
  const [backend, setBackend] = useState<SdGenBackend>('gpu');
  const [ready, setReady] = useState<boolean | null>(null);
  const [prog, setProg] = useState<SdGenProgress | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const busyRef = useRef(false);

  const est = estimateSeconds(size, steps, backend);

  // 预加载：进入即检查本地模块 + 模型是否就绪（结果缓存到 ready，避免每次点都查）
  useEffect(() => {
    let alive = true;
    if (!modelPath) {
      setReady(false);
      return () => {
        alive = false;
      };
    }
    sdGenIsReady(modelPath)
      .then(ok => alive && setReady(ok))
      .catch(() => alive && setReady(false));
    return () => {
      alive = false;
    };
  }, [modelPath]);

  // 订阅原生进度事件
  useEffect(() => {
    const off = addSdGenProgressListener(p => {
      if (busyRef.current) {
        setProg(p);
      }
    });
    return off;
  }, []);

  // 运行中每秒刷新「已用时间」，让用户知道还在动
  useEffect(() => {
    if (!busy) {
      return;
    }
    const t = setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(t);
  }, [busy, startedAt]);

  if (!sdGenAvailable()) {
    return null;
  }

  const run = async () => {
    if (busy) {
      return;
    }
    if (!prompt.trim()) {
      setMsg('请先填写正向提示词');
      return;
    }
    if (ready === false) {
      setMsg(
        modelPath
          ? '本地模块或模型未就绪（需要 sd-cli + 模型文件）'
          : '请先在上面选择或下载一个本机模型',
      );
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setImg(null);
    setProg(null);
    setMsg('');
    setStartedAt(Date.now());
    setElapsed(0);
    try {
      const uri = await sdGenGenerate(prompt, {
        steps,
        threads: 8,
        width: size,
        height: size,
        modelPath,
        backend,
      });
      setImg(uri);
      setMsg(
        `本地生成完成（${size}×${size} / ${steps} 步 · ${
          backend === 'gpu' ? 'GPU' : 'CPU'
        }）`,
      );
    } catch (e: any) {
      if (e?.code === 'CANCELLED') {
        setMsg('已取消');
      } else {
        setMsg('本地生成失败：' + (e?.message ?? String(e)));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      setProg(null);
    }
  };

  const pct =
    prog?.total && prog?.step != null
      ? Math.min(1, Math.max(0, prog.step / prog.total))
      : undefined;
  const stageText = prog?.message ?? (busy ? '准备中…' : '');

  // 玻璃芯片：液态玻璃底 + 选中态（淡蓝）。选中态的描边/底/字色必须在这里
  // 用 theme 现算（localCpuStyles 是模块级 StyleSheet，拿不到 theme）。
  const glassOn = uiStore.themeStyle === 'liquid-glass';
  // 选中 = 淡蓝：与图像增强页保持一致 —— secondary（蓝）描边 + 蓝字；
  // 玻璃模式的浅蓝底由 SurfaceCard 的 secondary tint 提供（见下方 tintOpacity），
  // 非玻璃风格用浅蓝容器底。描边收到 1.5px，避免厚边+浓底显得「颜色溢出边框」。
  const activeText = theme.colors.secondary;
  const cpuChip = (active: boolean) => [
    localCpuStyles.chip,
    active && {
      borderWidth: 1.5,
      borderColor: theme.colors.secondary,
      backgroundColor: glassOn ? undefined : theme.colors.secondaryContainer,
    },
  ];

  return (
    <View style={localCpuStyles.wrap}>
      <PillLabel style={localCpuStyles.badgePill} radius={12} rimWidth={1.4}>
        <View style={localCpuStyles.badgeRow}>
          <Icon source="cellphone" size={13} color={theme.colors.primary} />
          <Text
            style={[localCpuStyles.badgeText, {color: theme.colors.primary}]}>
            {backend === 'gpu' ? '本机 · 手机 GPU' : '本机 · 手机 CPU'}
          </Text>
        </View>
      </PillLabel>
      {ready === false ? (
        <PillLabel
          style={localCpuStyles.hintPill}
          tint="#EF4444"
          tintOpacity={0.14}
          radius={15}>
          <Text style={[localCpuStyles.hint, {color: theme.colors.error}]}>
            {modelPath
              ? '本地模块或模型未就绪（需要 sd-cli + 模型文件）'
              : '请先在上方选择或下载一个本机模型'}
          </Text>
        </PillLabel>
      ) : null}

      <PillLabel style={localCpuStyles.labelPill} radius={12}>
        <Text
          style={[
            localCpuStyles.label,
            {color: theme.colors.onSurfaceVariant},
          ]}>
          后端
        </Text>
      </PillLabel>
      <View style={localCpuStyles.row}>
        {(['gpu', 'cpu'] as const).map(b => {
          const active = backend === b;
          return (
            <SurfaceCard
              key={b}
              disabled={busy}
              onPress={() => setBackend(b)}
              tint={active ? theme.colors.secondary : undefined}
              tintOpacity={active ? 0.26 : undefined}
              rimWidth={1.6}
              style={cpuChip(active)}>
              <Text
                style={[
                  localCpuStyles.chipText,
                  active && {color: activeText, fontWeight: '700'},
                ]}>
                {b === 'gpu' ? '手机 GPU' : 'CPU'}
              </Text>
            </SurfaceCard>
          );
        })}
      </View>
      {backend === 'gpu' ? (
        <PillLabel style={localCpuStyles.hintPill} radius={15}>
          <Text
            style={[
              localCpuStyles.hint,
              {color: theme.colors.onSurfaceVariant},
            ]}>
            自动选择：有 OpenCL GPU（Mali/Adreno）走 GPU，否则回退 CPU
          </Text>
        </PillLabel>
      ) : null}

      <PillLabel style={localCpuStyles.labelPill} radius={12}>
        <Text
          style={[
            localCpuStyles.label,
            {color: theme.colors.onSurfaceVariant},
          ]}>
          分辨率
        </Text>
      </PillLabel>
      <View style={localCpuStyles.row}>
        {RES_PRESETS.map(s => {
          const active = size === s;
          return (
            <SurfaceCard
              key={s}
              disabled={busy}
              onPress={() => setSize(s)}
              tint={active ? theme.colors.secondary : undefined}
              tintOpacity={active ? 0.26 : undefined}
              rimWidth={1.6}
              style={cpuChip(active)}>
              <Text
                style={[
                  localCpuStyles.chipText,
                  active && {color: activeText, fontWeight: '700'},
                ]}>
                {s}
              </Text>
            </SurfaceCard>
          );
        })}
      </View>

      <PillLabel style={localCpuStyles.labelPill} radius={12}>
        <Text
          style={[
            localCpuStyles.label,
            {color: theme.colors.onSurfaceVariant},
          ]}>
          步数
        </Text>
      </PillLabel>
      <View style={localCpuStyles.row}>
        {STEP_PRESETS.map(s => {
          const active = steps === s;
          return (
            <SurfaceCard
              key={s}
              disabled={busy}
              onPress={() => setSteps(s)}
              tint={active ? theme.colors.secondary : undefined}
              tintOpacity={active ? 0.26 : undefined}
              rimWidth={1.6}
              style={cpuChip(active)}>
              <Text
                style={[
                  localCpuStyles.chipText,
                  active && {color: activeText, fontWeight: '700'},
                ]}>
                {s}
              </Text>
            </SurfaceCard>
          );
        })}
      </View>

      <PillLabel style={localCpuStyles.notePill} radius={15}>
        <Text
          style={[localCpuStyles.est, {color: theme.colors.onSurfaceVariant}]}>
          {backend === 'gpu'
            ? `预计 ${fmtDuration(est)}（${size}×${size} / ${steps} 步，手机 GPU；无 OpenCL 的机型回退 CPU 会更慢）`
            : `预计 ${fmtDuration(est)}（${size}×${size} / ${steps} 步，纯 CPU）`}
        </Text>
      </PillLabel>

      <Button
        mode="contained"
        icon={busy ? 'close' : backend === 'gpu' ? 'gpu' : 'cellphone'}
        style={[localCpuStyles.btn, glassButton(theme, 'filled')]}
        textColor={theme.colors.primary}
        onPress={busy ? () => sdGenCancel() : run}>
        {busy ? '取消' : backend === 'gpu' ? '本地 GPU 生成' : '本地 CPU 生成'}
      </Button>

      {busy ? (
        <View style={localCpuStyles.progressWrap}>
          <ProgressBar
            progress={pct ?? 0}
            indeterminate={pct == null}
            color={theme.colors.primary}
          />
          <PillLabel style={localCpuStyles.notePill} radius={15}>
            <Text
              style={[
                localCpuStyles.progText,
                {color: theme.colors.onSurfaceVariant},
              ]}>
              {stageText}
              {prog?.sPerIt ? ` · ${prog.sPerIt.toFixed(1)}s/步` : ''}
              {prog?.etaSec && prog.etaSec > 0
                ? ` · 剩余约 ${fmtDuration(prog.etaSec)}`
                : ''}
              {` · 已用 ${fmtDuration(elapsed)}`}
            </Text>
          </PillLabel>
        </View>
      ) : null}

      {msg ? (
        <PillLabel style={localCpuStyles.hintPill} radius={15}>
          <Text
            style={[
              localCpuStyles.hint,
              {color: theme.colors.onSurfaceVariant},
            ]}>
            {msg}
          </Text>
        </PillLabel>
      ) : null}
      {img ? (
        <Image
          source={{uri: img}}
          style={localCpuStyles.preview}
          resizeMode="contain"
        />
      ) : null}
    </View>
  );
};

const localCpuStyles = StyleSheet.create({
  wrap: {marginTop: 10},
  btn: {borderRadius: 14},
  preview: {width: '100%', height: 320, marginTop: 8, borderRadius: 12},
  label: {fontSize: 12},
  // 参数小标题外的扁平液态玻璃胶囊（margin 移到胶囊外层）
  labelPill: {alignSelf: 'flex-start', marginTop: 8, marginBottom: 4},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  // 玻璃芯片：底色由 SurfaceCard 的玻璃色调决定（液态玻璃下是半透明玻璃，
  // 标准风格下回退成实色）。标准风格需要可见的实底，这里补一层极淡底；
  // 选中态的描边/底/字色在 LocalCpuGen 里用 theme 现算（模块级拿不到 theme）。
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#00000010',
    // 裁剪：Android 上父 View 的 borderRadius 不裁剪子层，玻璃 tint 会从
    // 圆角/边框处溢出（用户反馈「颜色溢出边框」）。加 overflow 后按圆角裁掉。
    overflow: 'hidden',
  },
  chipText: {fontSize: 13, fontWeight: '600'},
  // 小字玻璃胶囊（撑满换行）：行距/字号交给内部 Text，间距由胶囊控制
  hintPill: {alignSelf: 'stretch', marginTop: 8, marginBottom: 4},
  notePill: {alignSelf: 'stretch', marginTop: 10, marginBottom: 4},
  est: {fontSize: 12, lineHeight: 17},
  progressWrap: {marginTop: 10},
  progText: {fontSize: 12, lineHeight: 17},
  hint: {fontSize: 12, lineHeight: 17},
  // 本机标识：和云端预览左上角那枚「云端」胶囊呼应
  badgePill: {alignSelf: 'flex-start', marginBottom: 4},
  badgeRow: {flexDirection: 'row', alignItems: 'center', gap: 4},
  badgeText: {fontSize: 12, fontWeight: '700'},
});

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: 'transparent'},
    // ScrollView 本体不带内边距，让顶部栏能整条通栏铺满
    scroll: {paddingBottom: 0},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      // 具体高度/内边距在 JSX 里用 insets.top / HEADER_EXTRA 覆盖
      // 底色也在 JSX 里按「液态玻璃 / 磨砂 / 普通」计算后传入
      // 底部两角圆角，与主页顶部栏保持一致
      borderBottomLeftRadius: headerBottomRadius(),
      borderBottomRightRadius: headerBottomRadius(),
      // 和下面内容之间留一点缝隙（同主页头部）
      marginBottom: 10,
      overflow: 'hidden',
    },
    headerTitle: {
      // 比主页标题(23)略小一档，配合矮一截的顶部栏
      fontSize: 21,
      fontWeight: '800',
      color: theme.colors.onSurface,
      // 原来只写了 marginLeft: 4，标题紧贴返回按钮、上下也没做视觉对齐，
      // 看起来就是「光标和文字没对齐」。返回按钮自带 marginRight:10，
      // 这里不再叠加，避免间距过宽；另外给一个接近字号的 lineHeight，
      // 让标题的文字基线和按钮中心落在同一条线上。
      marginLeft: 0,
      lineHeight: 26,
    },
    headerSpacer: {flex: 1},
    content: {paddingHorizontal: 16, paddingTop: 4},
    toolbar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    toolbarLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
    },
    toolbarLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.onSurface,
      flexShrink: 1,
    },
    toolbarRight: {flexDirection: 'row', alignItems: 'center', gap: 4},
    // 工具栏两颗玻璃胶囊（模型行 / 参数行）；左侧模型名会长，允许收缩
    toolbarPill: {paddingVertical: 9, flexShrink: 1},
    toolbarPillRight: {paddingVertical: 9},
    toolbarParam: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      maxWidth: 200,
    },
    // ── 顶栏右侧：运行位置切换（云端 / 本机）──
    // 胶囊分段控件；靠右由 headerSpacer(flex:1) 顶过去，竖向由 header
    // 的 alignItems:'center' 居中。
    modeSwitch: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      padding: 3,
      borderRadius: 999,
      backgroundColor: theme.dark
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(11,12,17,0.06)',
    },
    modeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
    },
    // 选中项：主色（蓝）实心填充
    modeChipActive: {backgroundColor: theme.colors.primary},
    modeChipText: {
      fontSize: 13.5,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
    },
    modeChipTextActive: {color: theme.colors.onPrimary},
    // 预览左上角的来源角标
    sourceBadge: {
      position: 'absolute',
      top: 8,
      left: 8,
      zIndex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      backgroundColor: theme.colors.surfaceVariant,
    },
    sourceBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
    },
    // ── 本机模型列表 ──
    localModelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    localModelRowActive: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surfaceVariant,
    },
    localModelBody: {flex: 1, minWidth: 0},
    localModelName: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    localModelMeta: {
      fontSize: 11,
      marginTop: 2,
      color: theme.colors.onSurfaceVariant,
    },
    localBtnRow: {flexDirection: 'row', gap: 10, marginTop: 10},
    localBtn: {flex: 1, borderRadius: 14},
    // 独立整行按钮（非并排），不设 flex:1 以免在纵向布局里被拉伸
    jumpBtn: {borderRadius: 14, marginTop: 8, marginBottom: 2},
    dlProgressWrap: {marginTop: 10},
    // ── 模型弹窗分区标题 ──
    modelSectionHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 2,
      marginBottom: 8,
    },
    modelSectionHeadGap: {marginTop: 18},
    modelSectionTitle: {
      flex: 1,
      fontSize: 13,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    modelSectionCount: {
      fontSize: 11,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
    },
    modelSectionHint: {
      fontSize: 12,
      lineHeight: 18,
      marginBottom: 10,
      color: theme.colors.onSurfaceVariant,
    },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      // 玻璃模式下面板本体透明（玻璃由 SheetBody 画，见组件定义）；
      // 非玻璃模式用实底
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderBottomLeftRadius: 20,
      borderBottomRightRadius: 20,
      // 底部离屏 5%：弹窗整体上移（用户要求「拉到屏幕 2/3 处」），
      // 底部不再贴屏幕底边 —— 玻璃板四角都是圆的，浮在底边上方
      bottom: '5%',
      // 顶部/底部内边距：内容与玻璃板边框别挨太近
      paddingTop: 18,
      paddingBottom: 20,
      // 左右内边距放在面板上，滚动区和页脚共用（模型选择弹窗也复用这个样式）
      paddingHorizontal: 20,
      // 面板最高到屏幕 2/3 处（用户要求「拉到屏幕的 2/3 处」），
      // 配合 bottom:5% 整体上移；再长就在内部滚动
      maxHeight: '66%',
    },
    // 滚动区：左右内边距已由面板提供，这里不再重复
    modalScroll: {paddingBottom: 4},
    // 弹窗内小节标题（SectionLabel 自带胶囊）
    modalSectionLabel: {marginBottom: 10},
    // flexShrink:1 是关键 —— 内容超过面板 maxHeight 时让滚动区收缩，
    // 否则 ScrollView 会按内容高度撑开、把页脚顶出屏幕
    modalScrollView: {flexShrink: 1},
    modalHandle: {
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.outlineVariant,
      alignSelf: 'center',
      marginBottom: 16,
    },
    modalTitlePill: {alignSelf: 'flex-start', marginBottom: 24},
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    modalEmpty: {fontSize: 14, color: theme.colors.onSurfaceVariant},
    modelTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      // 顶部留白：SheetGlass 没有顶部内边距，不加的话「可用模型」会贴着
      // 玻璃板顶边（用户反馈「位置太上了、和弹窗挨住了」）
      paddingTop: 10,
      marginBottom: 10,
    },
    modelRefresh: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.secondary,
    },
    modelCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      // 与上一张玻璃卡的间距：8 → 10
      marginBottom: 10,
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
    },
    modelCardActive: {
      borderColor: theme.colors.secondary,
      backgroundColor: theme.colors.secondaryContainer,
    },
    modelCardMain: {flex: 1, flexShrink: 1},
    modelNameRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
    modelName: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
      flexShrink: 1,
    },
    modelTag: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 6,
      backgroundColor: theme.colors.surfaceVariant,
    },
    modelTagText: {
      fontSize: 10,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
    },
    modelDesc: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    modelMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 4,
    },
    modelMeta: {
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
      marginRight: 6,
    },
    modelMissing: {fontSize: 11, color: theme.colors.onSurfaceVariant},
    // 模型状态胶囊：未下载（描边）/ 使用中（实底强调色）
    modelStatePill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
    },
    modelStatePillText: {
      fontSize: 11,
      fontWeight: '600',
      color: theme.colors.onSurfaceVariant,
    },
    modelStatePillActive: {
      backgroundColor: theme.colors.secondary,
      borderColor: theme.colors.secondary,
    },
    modelStatePillActiveText: {
      color: '#FFFFFF',
      fontWeight: '700',
    },
    modelNote: {
      flex: 1,
      fontSize: 11,
      lineHeight: 16,
      color: theme.colors.onSurfaceVariant,
    },
    // 模型弹窗底部说明胶囊（撑满换行）+ 「从服务端读取」小胶囊
    modelNotePill: {alignSelf: 'stretch', marginTop: 14},
    refreshPill: {paddingVertical: 4},
    // 页脚：左「恢复默认参数」右「确定」
    modalFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 12,
      marginTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.outlineVariant,
    },
    footerBtn: {flexDirection: 'row', alignItems: 'center', gap: 4},
    footerPill: {paddingVertical: 6},
    footerReset: {fontSize: 14, fontWeight: '600', color: theme.colors.error},
    footerConfirm: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.secondary,
    },
    seedGlass: {
      borderRadius: 12,
      backgroundColor: theme.colors.background,
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 8,
      marginTop: 2,
    },
    seedText: {fontSize: 14, paddingVertical: 4},

    previewWrap: {
      width: '100%',
      aspectRatio: 1,
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.surfaceVariant,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
    },
    preview: {width: '100%', height: '100%'},
    previewEmpty: {alignItems: 'center', paddingHorizontal: 24},
    previewEmptyTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
    },
    previewEmptyDesc: {
      fontSize: 12,
      lineHeight: 18,
      marginTop: 6,
      textAlign: 'center',
      color: theme.colors.onSurfaceVariant,
      opacity: 0.8,
    },
    previewMask: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(255,255,255,0.72)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    previewMaskText: {
      fontSize: 13,
      marginTop: 8,
      color: theme.colors.onSurfaceVariant,
    },

    sectionLabel: {marginTop: 22, marginBottom: 10},

    /* 可折叠标题：左边竖杠 + 标题，右边当前值摘要 + 展开箭头 */
    collapseHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    // 「服务」折叠行整行垫玻璃胶囊
    collapsePill: {
      alignSelf: 'stretch',
      marginTop: 20,
      marginBottom: 10,
      paddingVertical: 6,
    },
    collapseLeft: {flexDirection: 'row', alignItems: 'center'},
    collapseBar: {
      width: 4,
      height: 14,
      borderRadius: 2,
      alignSelf: 'center',
      // Android 中文 Text 不带 lineHeight 时字形视觉中心偏下（16号字约 2dp），
      // 用负margin 把竖杠提上来和文字对齐，原理同 SectionLabel。
      marginBottom: 6.1,
      marginRight: 8,
      backgroundColor: theme.colors.secondary,
    },
    // 「服务」这条用的是 15 号字，比上面 16 号的参数标题小一档，
    // 需要的上提量也小 —— 把 marginBottom 收小，蓝杠就往下落一点点
    collapseBarSmall: {
      marginBottom: 3.5,
    },
    collapseTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    collapseRight: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      marginLeft: 10,
    },
    collapseSummary: {
      fontSize: 12,
      marginRight: 4,
      color: theme.colors.onSurfaceVariant,
      flexShrink: 1,
    },
    collapseSummaryWarn: {color: '#D97706'},
    card: {borderRadius: cardRadius(), backgroundColor: theme.colors.surface},
    cardContent: {paddingVertical: 14, paddingHorizontal: 16},
    inputLabel: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 8,
      color: theme.colors.onSurface,
    },
    // 提示词输入框：磨砂加强档（GlassTextField 外层玻璃容器）
    promptGlass: {
      borderRadius: 12,
      backgroundColor: theme.colors.background,
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 8,
      marginBottom: 14,
    },
    promptInput: {fontSize: 13, minHeight: 80, paddingVertical: 12},
    // 服务地址输入框（同上，单行）
    inputGlass: {
      borderRadius: 12,
      backgroundColor: theme.colors.background,
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 8,
      marginBottom: 12,
    },
    inputText: {fontSize: 14, paddingVertical: 4},
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: 8,
      paddingLeft: 0,
    },
    input: {
      marginBottom: 14,
      fontSize: 13,
      borderRadius: 12,
      minHeight: 80,
      paddingVertical: 12,
    },

    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    sliderRow: {
      // 上下各留一点内边距，让「参数名 / 数值 / 底部小字」整体
      // 往卡片垂直中心靠，不再贴着上下边框（只动纵向，不影响左右）
      paddingVertical: 7,
      paddingHorizontal: 10,
      // 与上一张玻璃卡的间距：6 → 10（用户反馈玻璃元素挨太近）
      marginBottom: 10,
      borderRadius: cardRadius(),
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
    },
    sliderHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: -4,
      // 只让文字往卡片中心收，不影响下面的滑轨宽度
      marginHorizontal: 6,
    },
    sliderLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    sliderValue: {fontSize: 15, fontWeight: '800', color: theme.colors.primary},
    // 自绘滑块的触控层：高度给到 44dp（触控最小尺寸），视觉轨道只有中间一条，
    // 所以「看得见的细」和「按得住」不冲突
    sliderHit: {
      height: 38,
      justifyContent: 'center',
    },
    sliderTrackBg: {
      height: SLIDER_TRACK_HEIGHT,
      borderRadius: SLIDER_TRACK_HEIGHT / 2,
      backgroundColor: theme.colors.outlineVariant,
    },
    sliderTrackFill: {
      position: 'absolute',
      height: SLIDER_TRACK_HEIGHT,
      borderRadius: SLIDER_TRACK_HEIGHT / 2,
      backgroundColor: theme.colors.primary,
    },
    // 滑块做成按钮质感：白底圆块 + 主色描边 + 阴影，22dp 大小好按住
    sliderThumb: {
      position: 'absolute',
      width: SLIDER_THUMB_SIZE,
      height: SLIDER_THUMB_SIZE,
      borderRadius: SLIDER_THUMB_SIZE / 2,
      backgroundColor: theme.dark ? '#E2E8F0' : '#FFFFFF',
      // 珠子缩小后描边同步收细，否则显得又黑又笨
      borderWidth: 2.5,
      borderColor: theme.colors.primary,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 4,
      shadowOffset: {width: 0, height: 2},
      elevation: 3,
    },
    sliderThumbActive: {
      transform: [{scale: 1.12}],
      shadowOpacity: 0.28,
      elevation: 6,
    },
    sliderHint: {
      fontSize: 11,
      fontWeight: '500',
      color: theme.colors.onSurfaceVariant,
    },
    // 滑块底部提示小字的玻璃胶囊（贴字宽）
    sliderHintPill: {
      alignSelf: 'flex-start',
      marginTop: 6,
      marginHorizontal: 6,
    },
    stepLabel: {fontSize: 14, fontWeight: '600', color: theme.colors.onSurface},
    stepControl: {flexDirection: 'row', alignItems: 'center'},
    stepBtn: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.secondaryContainer,
    },
    stepBtnText: {fontSize: 18, color: theme.colors.onSurface},
    stepValueWrap: {minWidth: 92, alignItems: 'center'},
    stepValue: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    stepHint: {fontSize: 10, color: theme.colors.onSurfaceVariant},

    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 6,
    },
    chip: {
      // 调大：用户反馈「高清修复的开/关」点击不方便
      // （新尺寸下高 ≈34，radius 17 = 一半，仍是标准胶囊）
      paddingHorizontal: 16,
      paddingVertical: 9,
      // ⚠️ 不能写 999：超过高度一半时 SVG 的 rx 不钳制，两端渲染成椭圆弧
      borderRadius: 17,
      backgroundColor: theme.colors.surfaceVariant,
    },
    chipActive: {
      backgroundColor: theme.colors.secondaryContainer,
      borderWidth: 1,
      borderColor: theme.colors.secondary,
    },
    chipText: {fontSize: 12, color: theme.colors.onSurfaceVariant},
    chipTextActive: {color: theme.colors.onSurface, fontWeight: '700'},

    genBtn: {marginTop: 22, borderRadius: 20, paddingVertical: 6},
    // 「服务」模块下的说明文字（原来在生成按钮下方）
    serviceNote: {
      flex: 1,
      fontSize: 11,
      lineHeight: 17,
      color: theme.colors.onSurfaceVariant,
      opacity: 0.85,
    },
    // 服务说明小字胶囊（撑满、内部换行）
    notePill: {alignSelf: 'stretch', marginBottom: 10},
    errorBox: {
      borderRadius: cardRadius(),
      padding: 12,
      marginTop: 22,
      backgroundColor: 'rgba(239,68,68,0.12)',
    },
    errorText: {fontSize: 12, lineHeight: 18, color: '#B91C1C'},
    // 追加的引导句：整句红字，其中「加载模型」四个字是蓝色可点
    errorHint: {fontSize: 12, lineHeight: 18, marginTop: 4, color: '#B91C1C'},
    errorHintLink: {color: theme.colors.secondary, fontWeight: '700'},

    serverHint: {
      fontSize: 11,
      lineHeight: 17,
      color: theme.colors.onSurfaceVariant,
    },
    // 本机模型空态说明小字玻璃胶囊（撑满换行）
    serverHintPill: {marginTop: 4, marginBottom: 12},
    testBtn: {borderRadius: 20},
    probeMsg: {
      fontSize: 12,
      marginTop: 10,
      lineHeight: 18,
      color: theme.colors.onSurfaceVariant,
    },

    historyHeader: {flexDirection: 'row', alignItems: 'flex-end'},
    clearText: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    // 「清空」小胶囊
    clearPill: {paddingVertical: 4, marginBottom: 10},
    emptyHistory: {
      flex: 1,
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      opacity: 0.8,
    },
    // 历史空状态小胶囊（贴字宽）
    emptyHistoryPill: {alignSelf: 'flex-start'},
    historyStrip: {gap: 10, paddingRight: 16},
    // rimOnly 玻璃边容器：圆角 + 裁剪，照片保持清晰
    thumbWrap: {width: 108, borderRadius: 12, overflow: 'hidden'},
    thumb: {
      width: 108,
      height: 108,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceVariant,
    },
    thumbMeta: {
      fontSize: 10,
      marginTop: 4,
      color: theme.colors.onSurfaceVariant,
    },
  });

export default ImageGenScreen;
