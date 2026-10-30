import React, {useEffect, useRef, useState} from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {Text} from 'react-native-paper';
import {GlassButton as Button} from '../../components/GlassButton';
import {SafeAreaView} from 'react-native-safe-area-context';
import {observer} from 'mobx-react';
import {launchImageLibrary} from 'react-native-image-picker';
import Slider from '@react-native-community/slider';
import {WebView} from 'react-native-webview';
import ImageView from 'react-native-image-viewing';
import Share from 'react-native-share';
import * as RNFS from '@dr.pogodin/react-native-fs';

import {useTheme} from '../../hooks';
import {Theme} from '../../utils/types';
import {Entrance} from '../../components/Entrance';
import {imageGenStore, uiStore} from '../../store';
import {ENHANCE_MODES, EnhanceModeKey} from '../../services/imageEnhance/modes';
import {SR_MODELS, getSRModel, modelUrls} from '../../services/superRes/models';
import {buildSuperResHtml} from '../../services/superRes/enhanceHtml';
import {runTile, base64ToBytes} from '../../services/superRes/superResService';
import {SurfaceCard, GlassTextField} from '../../components/GlassSurface';
import {glassButton} from '../../theme/cards';

/**
 * 图像增强 —— 两条路：
 *   · 本地超分：真·本地 ONNX 模型（Real-ESRGAN / Real-CUGAN / Anime4K），
 *     端侧推理，不联网。模型首次使用自动下载，之后离线可用。
 *   · 云端：复用已配置的 SD 服务端，走 /sdapi/v1/img2img
 */

type Engine = 'local' | 'cloud';

// 默认 Real-CUGAN 2x：实测对静态动漫图最合适
// （animevideov3 是视频模型，单张静图会被抹平）
const DEFAULT_SR_MODEL_ID = 'cugan-2x-conservative';

const CLOUD_PROMPT_BY_MODE: Record<EnhanceModeKey, string> = {
  upscale: 'high resolution, sharp details',
  denoise: 'clean, noise free, smooth',
  sharpen: 'sharp, crisp edges, detailed',
  color: 'vivid colors, rich contrast',
  face: 'natural face, clear skin, detailed eyes',
};

// 段标题：玻璃小条（每个模块的标题都玻璃化，不裸贴壁纸）
const SectionTitle: React.FC<{
  children: React.ReactNode;
  styles: any;
  inline?: boolean;
}> = ({children, styles, inline}) => (
  <SurfaceCard
    noPressScale
    style={inline ? styles.titlePillInline : styles.titlePill}>
    <Text style={styles.sectionTitle}>{children}</Text>
  </SurfaceCard>
);

export const ImageEnhanceScreen: React.FC = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  // 液态玻璃风格下按钮 = 半透明玻璃底 + 高光描边（非玻璃风格展开空对象）
  const glassBtnOutlined = glassButton(theme);
  const glassBtnFilled = glassButton(theme, 'filled');
  const glassBtnText = theme.colors.primary;
  // 玻璃模式下分段容器透明：只留「选中项」的蓝色胶囊，避免整条容器渲染成
  // 一块玻璃胶囊、未选中项底下露出一个「白色椭圆」（用户反馈的问题）。
  const glassOn = uiStore.themeStyle === 'liquid-glass';

  const [engine, setEngine] = useState<Engine>('local');
  const [imageUri, setImageUri] = useState<string | null>(null);
  // 云端模式的状态
  const [modes, setModes] = useState<EnhanceModeKey[]>(['upscale', 'sharpen']);
  // 本地 / 云端共用的「强度」
  const [strength, setStrength] = useState(60);
  // 云端模式倍率
  const [scale, setScale] = useState<2 | 4>(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [resultUri, setResultUri] = useState<string | null>(null);
  const [html, setHtml] = useState<string>('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{
    w: number;
    h: number;
    type: string;
  } | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // 分块进度
  const [tileDone, setTileDone] = useState(0);
  const [tileTotal, setTileTotal] = useState(0);
  const [outInfo, setOutInfo] = useState<{w: number; h: number} | null>(null);
  // 本次运行的尺寸说明（是否降采样、为什么）
  const [sizeNote, setSizeNote] = useState('');
  // 本地超分：当前选中的模型
  // 默认回到「上次用过」的超分模型（持久化在 imageGenStore）；
  // 没有记录或记录已失效时，回落到内置默认模型。
  const [selectedModelId, setSelectedModelId] = useState<string>(() => {
    const saved = imageGenStore.enhanceSrModelId;
    return saved && SR_MODELS.some(m => m.id === saved)
      ? saved
      : DEFAULT_SR_MODEL_ID;
  });
  // 模型列表按「力度由高到低」排，默认项不在首位 → 首屏自动滚到选中项
  const chipScrollRef = useRef<ScrollView>(null);
  const chipScrolledRef = useRef(false);

  const webRef = useRef<WebView>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 运行中锁模型选择 / 支持中止
  const cancelRef = useRef(false);
  const selectedModelRef = useRef(getSRModel(selectedModelId));

  useEffect(() => {
    selectedModelRef.current = getSRModel(selectedModelId);
  }, [selectedModelId]);

  // 记住选择：下次打开图像增强默认回到这个模型
  useEffect(() => {
    if (selectedModelId) {
      imageGenStore.setEnhanceSrModelId(selectedModelId);
    }
  }, [selectedModelId]);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  const level = strengthLevel(strength);
  const cloudReady = imageGenStore.enhanceCloudUrl.trim().length > 0;
  const selectedModel = getSRModel(selectedModelId);

  /** 把 base64 写到缓存文件，返回 file:// uri（预览用文件，解码快、不卡）。 */
  const base64ToFile = async (base64: string, ext: string): Promise<string> => {
    const path = `${RNFS.CachesDirectoryPath}/enh_${Date.now()}.${ext}`;
    await RNFS.writeFile(path, base64, 'base64');
    return `file://${path}`;
  };

  /** data:image/xxx;base64,... → 缓存文件 file:// */
  const dataUriToFile = async (dataUri: string): Promise<string> => {
    const m = dataUri.match(/^data:image\/([a-zA-Z]+);base64,(.*)$/);
    if (!m) {
      return dataUri;
    }
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    return base64ToFile(m[2], ext);
  };

  const toggleMode = (m: EnhanceModeKey) =>
    setModes(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m],
    );

  const pickImage = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        // 原图长边留到 1280：强度拉到 80% 以上时才有真实的输入可用
        // （之前限 1024，强度过 80 就是白拉，输入根本涨不上去）
        maxWidth: 1280,
        maxHeight: 1280,
        quality: 0.9,
        includeBase64: true,
      });
      const asset = result.assets?.[0];
      if (asset?.uri) {
        const base64 = asset.base64 ?? null;
        setImageBase64(base64);
        setImageMeta({
          w: asset.width ?? 0,
          h: asset.height ?? 0,
          type: asset.type ?? 'image/jpeg',
        });
        // 用缓存文件显示：点开放大时不用再解码大段 base64，不卡
        let displayUri = asset.uri;
        if (base64) {
          try {
            const ext = (asset.type ?? '').includes('png') ? 'png' : 'jpg';
            displayUri = await base64ToFile(base64, ext);
          } catch {
            displayUri = asset.uri;
          }
        }
        setImageUri(displayUri);
        setResultUri(null);
        setErr(null);
      }
    } catch (e) {
      Alert.alert('选图失败', String(e));
    }
  };

  // WebView 与 RN 的通信（分块协议 v3）：
  //   'ready'    → 前端算好分块计划（总块数、输出尺寸）
  //   'tile'     → 送来一块 RGB，RN 推理后回 'tileOut'
  //   'progress' → 已完成块数
  //   'result'   → 拼接完成的最终图（或错误）
  const onWebMessage = async (e: {nativeEvent: {data: string}}) => {
    let msg: any;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    const model = selectedModelRef.current;

    if (msg.kind === 'ready') {
      setTileTotal(msg.total as number);
      setTileDone(0);
      setOutInfo({w: msg.outW as number, h: msg.outH as number});
      setStatus(`超分中 0/${msg.total} 块…`);
      return;
    }

    if (msg.kind === 'tile') {
      if (cancelRef.current) {
        // 已点「停止」：不再推理，也不再回包（WebView 侧已自行收尾）
        return;
      }
      if (!model) {
        return;
      }
      try {
        const out = await runTile(
          model,
          {
            idx: msg.idx as number,
            w: msg.w as number,
            h: msg.h as number,
            rgb: base64ToBytes(msg.data as string),
          },
          f => {
            if (f < 1) {
              setStatus(`正在下载模型 ${Math.round(f * 100)}%…`);
            }
          },
        );
        if (cancelRef.current) {
          return;
        }
        webRef.current?.postMessage(JSON.stringify({kind: 'tileOut', ...out}));
      } catch (error) {
        if (cancelRef.current) {
          return;
        }
        const text = String((error as Error)?.message ?? error);
        setBusy(false);
        setStatus('');
        setErr('推理失败：' + text);
        webRef.current?.postMessage(
          JSON.stringify({kind: 'tileErr', idx: msg.idx, error: text}),
        );
      }
      return;
    }

    if (msg.kind === 'progress') {
      const done = msg.done as number;
      const total = msg.total as number;
      setTileDone(done);
      setTileTotal(total);
      setStatus(`超分中 ${done}/${total} 块…`);
      // 每块都续命，避免大图被整体超时打断
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setBusy(false);
        setStatus('');
        setErr('处理超时：单块耗时过长，可降低强度或换小图');
      }, 180000);
      return;
    }

    if (msg.kind === 'result') {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      cancelRef.current = false;
      if (msg.error) {
        // 「已停止」是用户主动中止，不算失败
        if (String(msg.error).includes('已停止')) {
          setErr(null);
          setStatus('');
        } else {
          setErr(msg.error as string);
          setStatus('');
        }
        setBusy(false);
      } else {
        try {
          setResultUri(await dataUriToFile(msg.dataURL as string));
        } catch {
          setResultUri(msg.dataURL as string);
        }
        setBusy(false);
        setStatus('');
      }
    }
  };

  const runLocal = async () => {
    if (!imageUri) {
      Alert.alert('请先选择图片');
      return;
    }
    if (!imageBase64) {
      Alert.alert('图片未就绪', '请重新选择图片（需要读取到 base64 数据）');
      return;
    }
    const model = getSRModel(selectedModelId);
    if (!model) {
      Alert.alert('请选择一个超分模型');
      return;
    }
    setErr(null);
    setResultUri(null);
    setBusy(true);
    cancelRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setStatus('准备中…');
    setTileDone(0);
    setTileTotal(0);
    try {
      // 尺寸策略（关键，直接决定清晰度）：
      //   输入上限 = 512 + 强度×768（512~1280）—— 与模型倍率**解耦**，
      //     这样同一强度下 ×2 和 ×4 模型拿到的输入一样大，不会「×4 特别糊」。
      //   输出硬上限 = 3840px 长边（防止 ×4 把手机内存/桥撑爆）。
      //     原来是 3000：×4 模型输入被压到 750px，1280 的原图先降采样到 750
      //     再放大 → 发软（用户反馈「有点糊」）。抬到 3840 后 ×4 输入可到
      //     ~960px，细节明显更多、更清晰。
      //   输入 = min(原图, 输入上限, 输出硬上限/倍率)
      // 上一版的坑：输入 = 输出上限/倍率 → ×4 模型被压到 486px，等于先糊再放大。
      const OUTPUT_HARD_CAP = 3840;
      const inputCap = 512 + Math.round((strength / 100) * 768); // 512~1280
      const byScale = Math.floor(OUTPUT_HARD_CAP / model.scale);
      const srcMax = Math.max(imageMeta?.w ?? 0, imageMeta?.h ?? 0) || 0;
      let maxSide =
        srcMax > 0
          ? Math.min(srcMax, inputCap, byScale)
          : Math.min(inputCap, byScale);

      const CORE = 192;
      // 块数预算随强度线性增长：60% → 24 块（默认），100% → 40 块（上限）
      const TILE_BUDGET = Math.max(4, Math.round((40 * strength) / 100));
      // 网格是 w×h 的整数块，往往凑不出正好 24（正方形会是 25 或 16），
      // 所以留 20% 容差，宁可多算一两块，也不要把边长砍掉一档。
      const MAX_TILES = Math.round(TILE_BUDGET * 1.2);
      const estimate = (side: number) => {
        const ratio = srcMax > 0 ? side / srcMax : 1;
        const w = Math.max(1, Math.round((imageMeta?.w ?? side) * ratio));
        const h = Math.max(1, Math.round((imageMeta?.h ?? side) * ratio));
        return Math.ceil(w / CORE) * Math.ceil(h / CORE);
      };
      // 超出块数预算就用二分找「刚好不超」的最大边长。
      // 之前用 ×0.9 步进，缩一格就从 25 块掉到 16 块，画质白白损失。
      if (estimate(maxSide) > MAX_TILES) {
        let lo = Math.min(CORE, maxSide);
        let hi = maxSide;
        for (let i = 0; i < 24 && hi - lo > 1; i++) {
          const mid = Math.round((lo + hi) / 2);
          if (estimate(mid) > MAX_TILES) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        maxSide = lo;
      }

      // 如实告诉用户有没有被降采样（这是「糊」的直接原因）
      const planned = estimate(maxSide);
      if (srcMax > 0 && maxSide < srcMax - 1) {
        const byTiles = maxSide < Math.min(inputCap, byScale) - 1;
        const why = byTiles
          ? `${strength}% 强度只允许约 ${TILE_BUDGET} 块`
          : `×${model.scale} 模型输出上限 ${OUTPUT_HARD_CAP}px`;
        setSizeNote(
          `输入 ${maxSide}px（原图 ${srcMax}px，受${why}限制），约 ${planned} 块。` +
            '想更清晰请提高强度。',
        );
      } else {
        setSizeNote('');
      }

      setHtml(
        buildSuperResHtml(imageBase64, {
          maxSide,
          norm: model.norm,
          scale: model.scale,
          core: CORE,
          overlap: 16,
          mime: imageMeta?.type ?? 'image/jpeg',
        }),
      );
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        setBusy(false);
        setStatus('');
        setErr('处理超时：模型首次下载较慢，可降低强度或换小图再试');
      }, 180000);
    } catch (e) {
      setBusy(false);
      setErr(String(e));
    }
  };

  /** 中止本次超分：置取消位 → 通知 WebView → 立刻解锁界面 */
  const stopRun = () => {
    if (!busy) {
      return;
    }
    cancelRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try {
      webRef.current?.postMessage(JSON.stringify({kind: 'cancel'}));
    } catch {
      // WebView 已卸载也无所谓，界面直接收尾
    }
    setBusy(false);
    setStatus('');
    setErr(null);
    setTileDone(0);
    setTileTotal(0);
  };

  const runCloud = async () => {
    if (!cloudReady) {
      setBusy(false);
      Alert.alert(
        '云端未配置',
        '请先在「云端服务」里填写云端增强服务地址（A1111 兼容，形如 https://你的云端/sdapi）。',
      );
      return;
    }
    const denoise = 0.12 + (strength / 100) * 0.38;
    const prompt =
      'high quality, detailed, ' +
      modes.map(m => CLOUD_PROMPT_BY_MODE[m]).join(', ');
    const uri = await imageGenStore.enhanceImg2Img(
      imageBase64 as string,
      {
        denoise,
        prompt,
        width: imageMeta?.w || undefined,
        height: imageMeta?.h || undefined,
      },
      {
        baseUrl: imageGenStore.enhanceCloudUrl,
        apiKey: imageGenStore.enhanceCloudKey,
      },
    );
    if (uri) {
      try {
        setResultUri(await dataUriToFile(uri));
      } catch {
        setResultUri(uri);
      }
    } else {
      setErr(imageGenStore.error ?? '增强失败');
    }
    setBusy(false);
  };

  const run = async () => {
    if (!imageUri) {
      Alert.alert('请先选择图片');
      return;
    }
    if (engine === 'local') {
      await runLocal();
      return;
    }
    if (modes.length === 0) {
      Alert.alert('请至少选择一个增强项');
      return;
    }
    if (!imageBase64) {
      Alert.alert('图片未就绪', '请重新选择图片（需要读取到 base64 数据）');
      return;
    }
    setErr(null);
    setResultUri(null);
    setBusy(true);
    try {
      await runCloud();
    } catch (e) {
      setBusy(false);
      setErr(String(e));
    }
  };

  const download = async () => {
    if (!resultUri) {
      return;
    }
    try {
      const fname = `ImageEnhance_${Date.now()}.png`;
      // resultUri 通常是 file://；万一还是 data URI 就先落一次盘
      let srcPath = resultUri.replace('file://', '');
      if (resultUri.startsWith('data:')) {
        const m = resultUri.match(/^data:image\/[a-zA-Z]+;base64,(.*)$/);
        srcPath = `${RNFS.CachesDirectoryPath}/enh_dl_${Date.now()}.png`;
        await RNFS.writeFile(srcPath, m ? m[1] : '', 'base64');
      }

      // 优先存到「下载」目录；无权限时退回系统分享（可保存到相册）
      try {
        const dest = `${RNFS.DownloadDirectoryPath}/${fname}`;
        await RNFS.copyFile(srcPath, dest);
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
                type: 'image/png',
                failOnCancel: false,
              }),
          },
          {text: '好'},
        ]);
        return;
      } catch {
        // 无存储权限时退回分享
      }

      await Share.open({
        url: resultUri,
        type: 'image/png',
        filename: fname,
        failOnCancel: false,
      });
    } catch (e) {
      Alert.alert('下载失败', String(e));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* 引擎选择 */}
        <Entrance index={0}>
          <SectionTitle styles={styles}>处理方式</SectionTitle>
          <SurfaceCard style={[styles.segment, glassOn && styles.segmentGlass]}>
            {(
              [
                {k: 'local' as Engine, t: '本地超分'},
                {k: 'cloud' as Engine, t: '云端'},
              ] as const
            ).map(item => (
              <Pressable
                key={item.k}
                onPress={() => setEngine(item.k)}
                disabled={busy}
                style={[
                  styles.segItem,
                  engine === item.k && styles.segItemOn,
                  busy && styles.segItemDisabled,
                ]}>
                <Text
                  style={[
                    styles.segText,
                    engine === item.k && styles.segTextOn,
                  ]}>
                  {item.t}
                </Text>
              </Pressable>
            ))}
          </SurfaceCard>
          <SurfaceCard style={styles.hintPill}>
            <Text style={styles.engineHint}>
              {engine === 'local'
                ? '本地超分：真·端侧 ONNX 模型，离线可用，不联网（首次自动下载模型）'
                : cloudReady
                  ? `云端：已连接 ${imageGenStore.enhanceCloudUrl}`
                  : '云端：请在下方填写「云端服务」地址（A1111 兼容的云端 SD API）'}
            </Text>
          </SurfaceCard>
          {engine === 'cloud' ? (
            <SurfaceCard style={styles.cloudConfigCard}>
              <Text style={styles.cloudConfigLabel}>云端服务地址</Text>
              <GlassTextField
                tintOpacity={0.68}
                value={imageGenStore.enhanceCloudUrl}
                onChangeText={v => imageGenStore.setEnhanceCloudUrl(v)}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.cloudInput}
                inputStyle={styles.cloudInputText}
                placeholder="https://your-cloud/sdapi"
              />
              <Text style={styles.cloudConfigLabel}>API 密钥（可选）</Text>
              <GlassTextField
                tintOpacity={0.68}
                value={imageGenStore.enhanceCloudKey}
                onChangeText={v => imageGenStore.setEnhanceCloudKey(v)}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={styles.cloudInput}
                inputStyle={styles.cloudInputText}
                placeholder="需要 Bearer Token 时才填"
              />
            </SurfaceCard>
          ) : null}
        </Entrance>

        {/* 选择图片 */}
        <Entrance index={1}>
          <SectionTitle styles={styles}>选择图片</SectionTitle>
          <Button
            mode="outlined"
            icon="image"
            onPress={pickImage}
            style={[styles.pickBtn, glassBtnOutlined]}
            disabled={busy}>
            {imageUri ? '重新选择图片' : '从相册选择'}
          </Button>
          {imageUri ? (
            <Pressable onPress={() => setPreviewUri(imageUri)}>
              <Image
                source={{uri: imageUri}}
                style={styles.preview}
                resizeMode="contain"
              />
            </Pressable>
          ) : (
            <SurfaceCard style={styles.placeholder}>
              <Text style={styles.placeholderText}>尚未选择图片</Text>
            </SurfaceCard>
          )}
        </Entrance>

        {engine === 'local' ? (
          /* ===== 本地超分：模型选择 ===== */
          <Entrance index={2}>
            <SectionTitle styles={styles}>超分模型</SectionTitle>
            <ScrollView
              ref={chipScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}>
              {SR_MODELS.map(m => {
                const on = m.id === selectedModelId;
                return (
                  // onLayout 要挂在 ScrollView 的直接子元素上；
                  // SurfaceCard 不透传 onLayout，所以外包一层 View 量位置
                  <View
                    key={m.id}
                    onLayout={e => {
                      // 首次布局时把选中项滚进视野（默认模型排在中段）
                      if (on && !chipScrolledRef.current) {
                        chipScrolledRef.current = true;
                        const x = e.nativeEvent.layout.x;
                        chipScrollRef.current?.scrollTo({
                          x: Math.max(0, x - 12),
                          animated: false,
                        });
                      }
                    }}>
                    <SurfaceCard
                      onPress={() => setSelectedModelId(m.id)}
                      disabled={busy}
                      contentStyle={styles.chipInner}
                      style={[
                        styles.chip,
                        on && styles.chipOn,
                        busy && !on && styles.segItemDisabled,
                      ]}>
                      <Text
                        style={[styles.chipLabel, on && styles.chipLabelOn]}>
                        {m.label}
                      </Text>
                      <Text
                        style={[styles.chipScale, on && styles.chipScaleOn]}>
                        ×{m.scale} · {m.family}
                      </Text>
                    </SurfaceCard>
                  </View>
                );
              })}
            </ScrollView>
            {busy ? (
              <SurfaceCard style={styles.hintPill}>
                <Text style={styles.lockHint}>
                  超分进行中，暂不能切换模型（可点「停止」后再换）
                </Text>
              </SurfaceCard>
            ) : null}
            {selectedModel ? (
              <SurfaceCard style={styles.modelInfo}>
                <Text style={styles.modelDesc}>{selectedModel.desc}</Text>
                <Text style={styles.modelStrength}>
                  擅长：{selectedModel.strength}
                </Text>
                <Text style={styles.modelMeta}>
                  {modelUrls(selectedModel).length === 0
                    ? `需手动导入 ${selectedModel.file}`
                    : selectedModel.size
                      ? `首次使用需下载 ${(
                          selectedModel.size / 1048576
                        ).toFixed(1)} MB（之后离线可用）`
                      : '首次使用需下载（之后离线可用）'}
                </Text>
              </SurfaceCard>
            ) : null}
          </Entrance>
        ) : (
          /* ===== 云端：增强项 ===== */
          <Entrance index={2}>
            <SectionTitle styles={styles}>增强项</SectionTitle>
            {ENHANCE_MODES.map(m => {
              const on = modes.includes(m.key);
              return (
                <SurfaceCard
                  key={m.key}
                  onPress={() => toggleMode(m.key)}
                  contentStyle={styles.modeRowInner}
                  style={[styles.modeRow, on && styles.modeRowOn]}>
                  <View style={styles.modeText}>
                    <Text style={styles.modeLabel}>{m.label}</Text>
                    <Text style={styles.modeDesc}>{m.desc}</Text>
                  </View>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                </SurfaceCard>
              );
            })}
          </Entrance>
        )}

        {/* 放大倍数（云端模式显示；本地由模型固定） */}
        {engine === 'cloud' ? (
          <Entrance index={3}>
            <SectionTitle styles={styles}>放大倍数</SectionTitle>
            <SurfaceCard
              style={[styles.segment, glassOn && styles.segmentGlass]}>
              {([2, 4] as const).map(s => {
                const enabled = modes.includes('upscale');
                return (
                  <Pressable
                    key={s}
                    disabled={!enabled}
                    onPress={() => setScale(s)}
                    style={[
                      styles.segItem,
                      scale === s && enabled && styles.segItemOn,
                      !enabled && styles.segItemDisabled,
                    ]}>
                    <Text
                      style={[
                        styles.segText,
                        scale === s && enabled && styles.segTextOn,
                      ]}>
                      {s}×
                    </Text>
                  </Pressable>
                );
              })}
            </SurfaceCard>
            <SurfaceCard style={styles.hintPill}>
              <Text style={styles.subHint}>
                {modes.includes('upscale')
                  ? '放大后长边上限 2048px（受手机内存限制，4× 可能被封顶）'
                  : '勾选「超分辨率」后可选放大倍数'}
              </Text>
            </SurfaceCard>
          </Entrance>
        ) : (
          <Entrance index={3}>
            <SectionTitle styles={styles}>输出倍率</SectionTitle>
            <SurfaceCard style={styles.hintPill}>
              <Text style={styles.subHint}>
                由所选模型固定为 ×{selectedModel?.scale ?? '-'}
                （可在上方切换模型）
              </Text>
            </SurfaceCard>
          </Entrance>
        )}

        {/* 强度 */}
        <Entrance index={4}>
          <View style={[styles.rowBetween, {marginTop: 14}]}>
            <SectionTitle styles={styles} inline>
              处理强度
            </SectionTitle>
            <Text style={styles.valueText}>
              {level.label} · {strength}%
            </Text>
          </View>
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={5}
            value={strength}
            disabled={busy}
            onValueChange={setStrength}
            minimumTrackTintColor={theme.colors.primary}
            maximumTrackTintColor={theme.colors.surfaceVariant}
            thumbTintColor={theme.colors.primary}
          />
          <SurfaceCard style={styles.hintPill}>
            <Text style={styles.subHint}>
              {engine === 'local'
                ? '强度决定输入尺寸与分块数：60% 约 24 块，100% 最多 40 块（块越多越清晰、越慢）'
                : level.hint}
            </Text>
          </SurfaceCard>
          {engine === 'local' && sizeNote ? (
            <SurfaceCard style={styles.hintPill}>
              <Text style={styles.warnText}>{sizeNote}</Text>
            </SurfaceCard>
          ) : null}
        </Entrance>

        {/* 开始 / 停止 */}
        <Entrance index={5}>
          <Button
            mode="contained"
            icon="auto-fix"
            onPress={run}
            loading={busy}
            disabled={busy || !imageUri}
            style={[styles.startBtn, glassBtnFilled]}
            textColor={glassBtnText}>
            {busy
              ? tileTotal > 0
                ? `超分中 ${tileDone}/${tileTotal} 块…`
                : status || '正在增强…'
              : '开始增强'}
          </Button>
          {busy ? (
            <Button
              mode="outlined"
              icon="stop"
              onPress={stopRun}
              style={[styles.stopBtn, glassBtnOutlined]}>
              停止
            </Button>
          ) : null}
          {err ? (
            <SurfaceCard
              tint="#EF4444"
              tintOpacity={0.14}
              style={styles.errorPill}>
              <Text style={styles.errorText}>{err}</Text>
            </SurfaceCard>
          ) : null}
        </Entrance>

        {/* 结果 */}
        {resultUri ? (
          <Entrance index={6}>
            <SectionTitle styles={styles}>增强结果</SectionTitle>
            <Pressable onPress={() => setPreviewUri(resultUri)}>
              <Image
                source={{uri: resultUri}}
                style={styles.result}
                resizeMode="contain"
              />
            </Pressable>
            <SurfaceCard style={styles.hintPill}>
              <Text style={styles.subHint}>
                {outInfo
                  ? `输出 ${outInfo.w}×${outInfo.h}px（${tileTotal} 块推理拼接）`
                  : '点击图片可放大查看'}
              </Text>
            </SurfaceCard>
            <Button
              mode="contained"
              icon="download"
              onPress={download}
              style={[styles.downloadBtn, glassBtnFilled]}
              textColor={glassBtnText}>
              下载到手机
            </Button>
          </Entrance>
        ) : null}
      </ScrollView>

      {/* 点击图片放大预览 */}
      <ImageView
        images={previewUri ? [{uri: previewUri}] : []}
        imageIndex={0}
        visible={!!previewUri}
        onRequestClose={() => setPreviewUri(null)}
      />

      {/* 隐藏 WebView：本地超分在这里做图像前后处理 */}
      <WebView
        ref={webRef}
        // 安全收紧：html 是本地拼接的模板 + data URI 图片，没有远程加载
        // 的需要。originWhitelist=['*'] 会让模板里万一被注入的远程跳转
        // 生效；锁到 about:blank + 导航白名单，只许本地文档存在。
        source={{
          html: html || '<html><body></body></html>',
          baseUrl: 'about:blank',
        }}
        onMessage={onWebMessage}
        javaScriptEnabled
        originWhitelist={['about:blank']}
        onShouldStartLoadWithRequest={req => req.url === 'about:blank'}
        style={styles.web}
      />
    </SafeAreaView>
  );
});

function strengthLevel(v: number): {label: string; hint: string} {
  if (v < 34) {
    return {label: '轻度', hint: '尽量保真，只做轻微改善'};
  }
  if (v < 67) {
    return {label: '中等', hint: '效果与保真平衡'};
  }
  return {label: '重度', hint: '效果更明显，可能改变原图细节'};
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {flex: 1, backgroundColor: 'transparent'},
    container: {padding: 16, paddingBottom: 40},
    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onBackground,
    },
    // 段标题玻璃小条：每个模块的标题也玻璃化（紧凑、贴字宽）
    titlePill: {
      marginTop: 14,
      marginBottom: 10,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
      alignSelf: 'flex-start',
    },
    // 行内标题玻璃条（处理强度：标题与数值同一行）
    titlePillInline: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 12,
    },
    segment: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      backgroundColor: theme.colors.surface,
      // 玻璃模式下由 SurfaceCard 画玻璃，半径用「半高」（≈21）而非 999，
      // 避免原生玻璃把 999 折算成超大像素导致圆角弧重叠成椭圆。
      borderRadius: 21,
      padding: 4,
    },
    segItem: {
      paddingHorizontal: 26,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: 'transparent',
    },
    segItemOn: {backgroundColor: theme.colors.secondary},
    // 玻璃模式下分段容器透明：只留选中项的蓝色胶囊，未选中项不再露出白胶囊
    segmentGlass: {backgroundColor: 'transparent'},
    segItemDisabled: {opacity: 0.4},
    segText: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
    },
    segTextOn: {color: '#FFFFFF'},
    engineHint: {
      fontSize: 12.5,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 18,
    },
    pickBtn: {marginBottom: 12, borderRadius: 12},
    preview: {
      width: '100%',
      height: 200,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
    },
    placeholder: {
      width: '100%',
      height: 150,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    placeholderText: {color: theme.colors.onSurfaceVariant},
    // SurfaceCard 玻璃模式下内容先经 TouchableOpacity（pressFill flex:1），
    // 横排要在这一层补，否则两个 Text 会被竖着排
    chipInner: {flexDirection: 'column', gap: 2},
    // 模型 chips
    chipRow: {gap: 10, paddingVertical: 4},
    chip: {
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderWidth: 1.5,
      borderColor: theme.colors.outlineVariant,
      minWidth: 130,
    },
    chipOn: {
      borderColor: theme.colors.secondary,
      backgroundColor: theme.colors.secondaryContainer,
    },
    chipLabel: {
      fontSize: 13.5,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    chipLabelOn: {color: theme.colors.secondary},
    chipScale: {
      fontSize: 11.5,
      color: theme.colors.onSurfaceVariant,
      marginTop: 3,
    },
    chipScaleOn: {color: theme.colors.secondary},
    modelInfo: {
      marginTop: 10,
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 12,
    },
    modelDesc: {
      fontSize: 13,
      color: theme.colors.onSurface,
      lineHeight: 18,
    },
    modelStrength: {
      fontSize: 12.5,
      color: theme.colors.primary,
      marginTop: 6,
      lineHeight: 17,
      fontWeight: '600',
    },
    modelMeta: {
      fontSize: 11.5,
      color: theme.colors.onSurfaceVariant,
      marginTop: 6,
      lineHeight: 16,
    },
    // 云端模式（沿用旧布局）
    modeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 10,
    },
    modeRowOn: {
      borderWidth: 1.5,
      borderColor: theme.colors.secondary,
      backgroundColor: theme.colors.secondaryContainer,
    },
    // 玻璃模式下 onPress 卡的内容被 TouchableOpacity 包一层，横排在这层补
    modeRowInner: {flexDirection: 'row', alignItems: 'center'},
    modeText: {flex: 1, marginRight: 12},
    modeLabel: {
      fontSize: 14.5,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    modeDesc: {
      fontSize: 12.5,
      color: theme.colors.onSurfaceVariant,
      marginTop: 3,
      lineHeight: 17,
    },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.colors.outlineVariant,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkOn: {
      backgroundColor: theme.colors.secondary,
      borderColor: theme.colors.secondary,
    },
    checkMark: {color: '#FFFFFF', fontSize: 14, lineHeight: 16},
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    valueText: {fontSize: 14, fontWeight: '700', color: theme.colors.primary},
    subHint: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 17,
    },
    // 小字说明统一垫的液态玻璃 pill（每一行小字都包起来，不裸贴壁纸）
    hintPill: {
      marginTop: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
    },
    // 错误提示用红色玻璃 pill
    errorPill: {
      marginTop: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
    },
    // 云端服务配置卡（玻璃）
    cloudConfigCard: {
      marginTop: 10,
      padding: 12,
      borderRadius: 12,
    },
    cloudConfigLabel: {
      fontSize: 12.5,
      fontWeight: '600',
      color: theme.colors.onSurface,
      marginBottom: 6,
      marginTop: 4,
    },
    cloudInput: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 4,
      backgroundColor: theme.colors.background,
    },
    cloudInputText: {fontSize: 13, color: theme.colors.onSurface},
    startBtn: {marginTop: 24, borderRadius: 14, paddingVertical: 4},
    stopBtn: {marginTop: 10, borderRadius: 14},
    lockHint: {
      fontSize: 12,
      color: theme.colors.primary,
      lineHeight: 17,
    },
    errorText: {
      color: theme.colors.error,
      fontSize: 13,
      lineHeight: 18,
    },
    warnText: {
      color: theme.colors.primary,
      fontSize: 12,
      lineHeight: 17,
    },
    result: {
      width: '100%',
      height: 260,
      borderRadius: 12,
      backgroundColor: theme.colors.surface,
    },
    downloadBtn: {marginTop: 12, borderRadius: 14},
    web: {
      position: 'absolute',
      width: 2,
      height: 2,
      opacity: 0.01,
      left: 0,
      bottom: 0,
    },
  });
