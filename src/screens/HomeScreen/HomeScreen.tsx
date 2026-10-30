import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  BackHandler,
  ImageBackground,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {Text} from 'react-native-paper';
import LinearGradient from 'react-native-linear-gradient';
import {Icon3D} from '../../components/Icon3D';
import {Icon3DName} from '../../assets/icons3d';
import {AppIcon, AppIconName} from '../../components/AppIcon';
import {SectionLabel} from '../../components/SectionLabel';
import {GlassSurface, SurfaceCard} from '../../components/GlassSurface';
import {dialogGlassTint} from '../../theme/cards';
import {Entrance} from '../../components/Entrance';
import {observer} from 'mobx-react';

import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {modelStore, serverStore, uiStore} from '../../store';
import {useNavigation} from '@react-navigation/native';
import {NavigationProp} from '@react-navigation/native';
import {DURATION, EASE} from '../../theme/motion';

import {pickDistinctHomeBannerImages, HOME_BANNER_IMAGES} from './bannerImages';
import {motionTiming} from '../../utils/disableMotion';
import {useScrollMemory} from '../../utils/scrollMemory';

interface HomeScreenProps {
  onStartChat: () => void;
  // 语音合成（TTS）与音色转换（RVC）是两个页面，分别对应宫格里的两格。
  // 以前两者共用 onOpenVoice，点哪一格都进同一个占位页。
  onOpenTts: () => void;
  onOpenVoiceChange: () => void;
  onOpenVoiceClone: () => void;
  onOpenVision: () => void;
  onOpenMore: () => void;
  /** 快捷入口「图像增强」：跳到对应的二级页 */
  onOpenImageEnhance: () => void;
  /** 主页宫格「GPT-SoVITS」：跳到对应的二级页 */
  onOpenGptSovits: () => void;
  header?: React.ReactNode;
}

// 模型下载直达：类别 -> 浏览器直达下载页
const DOWNLOAD_MODELS: {
  title: string;
  desc: string;
  icon3d: Icon3DName;
  url: string;
}[] = [
  {
    title: '对话模型',
    desc: '通用聊天与问答，导入即可对话',
    icon3d: 'chat',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF',
  },
  {
    title: '图像识别模型',
    desc: '看图片、识内容，多模态对话',
    icon3d: 'vision',
    url: 'https://huggingface.co/Qwen/Qwen2-VL-2B-Instruct-GGUF',
  },
  {
    title: '语音转写模型',
    desc: '把语音转成文字，本地离线识别',
    icon3d: 'asr',
    url: 'https://huggingface.co/ggerganov/whisper.cpp',
  },
  {
    title: '语音合成模型',
    desc: '把文字变成语音，本地离线播报',
    icon3d: 'tts',
    url: 'https://huggingface.co/rhasspy/piper-voices',
  },
  {
    title: '音色转换模型',
    desc: '转换声音音色，实现角色配音',
    icon3d: 'voice',
    url: 'https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI',
  },
];

// 8 宫格：4 列 × 2 行（使用用户提供的 3D 图标）
const QUICK_ITEMS: {
  key: string;
  title: string;
  icon3d: Icon3DName;
  desc: string;
  action:
    | 'chat'
    | 'vision'
    | 'imagegen'
    | 'tts'
    | 'voiceChange'
    | 'voiceClone'
    | 'gptsovits'
    | 'settings'
    | 'more';
  /** 图标本身颜色偏淡的，单独把虚化减轻一点，否则会淡到看不见 */
  strongIcon?: boolean;
}[] = [
  {
    key: 'chat',
    title: '对话',
    icon3d: 'chat',
    desc: '聊天问答，多轮上下文',
    action: 'chat',
  },
  {
    key: 'image',
    title: '图像识别',
    icon3d: 'vision',
    desc: '拍照选图，识别内容',
    action: 'vision',
    strongIcon: true,
  },
  {
    key: 'imagegen',
    title: '生成图片',
    icon3d: 'imagegen',
    desc: '文字生成图片，本地出图',
    action: 'imagegen',
    strongIcon: true,
  },
  {
    key: 'tts',
    title: '生成语音',
    icon3d: 'tts',
    desc: '输入文字，生成语音朗读',
    action: 'tts',
  },
  {
    key: 'rvc',
    title: '音色转换',
    icon3d: 'voice',
    desc: '转换音色，角色配音',
    action: 'voiceChange',
  },
  {
    key: 'voiceClone',
    title: '语音克隆',
    icon3d: 'asr',
    desc: '录一段音频，克隆它的音色',
    action: 'voiceClone',
  },
  {
    key: 'gptsovits',
    title: 'GPT-SoVITS',
    icon3d: 'models',
    desc: '连接 GPT-SoVITS 引擎，按角色包合成语音',
    action: 'gptsovits',
  },
  {
    key: 'more',
    title: '更多',
    icon3d: 'more',
    desc: '全部功能与工具入口',
    action: 'more',
    strongIcon: true,
  },
];

// 按时间生成问候语
const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 6) {
    return '夜深了';
  }
  if (h < 11) {
    return '早上好';
  }
  if (h < 14) {
    return '中午好';
  }
  if (h < 18) {
    return '下午好';
  }
  return '晚上好';
};

/**
 * 轮播页码点。
 *
 * 对齐 BAVoice 的 Carousel 指示器：切换时**不是**硬切样式，而是把
 * 「未选中 → 选中」当作一段过渡动画跑完 —— 宽度 6→16、不透明度 0.45→1。
 *
 * 为什么用 JS 驱动（useNativeDriver: false）：
 *   这里动的是 `width`（布局属性），原生驱动不支持；而且只有 3 个点，
 *   每帧重排的成本可以忽略。颜色/透明度本来也只能 JS 驱动。
 *
 * 时长/缓动取 BAVoice 的 Fast(220) + EmphasizedDecelerate ——
 * 指示器级别的微调用它，和底部 Tab 指示器同一档位。
 */
const BannerDot: React.FC<{active: boolean}> = ({active}) => {
  const theme = useTheme();
  const styles = createStyles({theme, frosted: uiStore.frosted});
  const t = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    motionTiming(t, {
      toValue: active ? 1 : 0,
      duration: DURATION.fast,
      easing: EASE.emphasizedDecelerate,
      useNativeDriver: false,
    }).start();
  }, [active, t]);

  const width = t.interpolate({
    inputRange: [0, 1],
    outputRange: [6, 16],
  });
  const opacity = t.interpolate({
    inputRange: [0, 1],
    outputRange: [0.45, 1],
  });

  return <Animated.View style={[styles.dotBase, {width, opacity}]} />;
};

export const HomeScreen: React.FC<HomeScreenProps> = observer(
  ({
    onStartChat,
    onOpenTts,
    onOpenVoiceChange,
    onOpenVoiceClone,
    onOpenVision,
    onOpenMore,
    onOpenGptSovits,
    onOpenImageEnhance,
    header,
  }: HomeScreenProps) => {
    const theme = useTheme();
    const navigation = useNavigation<NavigationProp<any>>();
    const frosted = uiStore.frosted;
    const styles = createStyles({theme, frosted});
    // 进「对话」时 HomeScreen 会被卸载（App.tsx 里 homeSub 切换），
    // 返回时重新挂载 —— 用记忆的偏移量无动画滚回去，避免弹回顶部。
    const scroll = useScrollMemory('home');
    const {width: winWidth} = useWindowDimensions();
    // 功能宫格列宽：手机(2列 48%)、≥600 宽(3列)、≥900(4列)
    const funcCardWidth =
      winWidth >= 900 ? '23.5%' : winWidth >= 600 ? '31.5%' : '48%';
    const [pickerVisible, setPickerVisible] = useState(false);
    const [slideIndex, setSlideIndex] = useState(0);
    // Animated.ScrollView 是「值」，不能直接当类型参数用；它的 ref 就是 ScrollView
    const bannerRef = useRef<ScrollView>(null);
    const scrollX = useRef(new Animated.Value(0)).current;

    // 「模型类型选择」弹层开着时，硬件返回键只关弹层，
    // 不要直接退回主页（RN 的 Modal 默认不拦返回键，事件会冒泡到
    // App 的 BackHandler —— 用户实测「弹窗开着按返回，直接回主页」）。
    useEffect(() => {
      if (Platform.OS !== 'android' || !pickerVisible) {
        return;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setPickerVisible(false);
        return true;
      });
      return () => sub.remove();
    }, [pickerVisible]);

    // 4 秒自动翻页，循环
    useEffect(() => {
      bannerRef.current?.scrollTo({x: 1 * (winWidth - 32), animated: false});
      const timer = setInterval(() => {
        setSlideIndex(prev => {
          let next = prev + 1;
          if (next >= 5) {
            // 无感知跳回
            bannerRef.current?.scrollTo({
              x: 1 * (winWidth - 32),
              animated: false,
            });
            next = 1;
          } else {
            bannerRef.current?.scrollTo({
              x: next * (winWidth - 32),
              animated: true,
            });
          }
          return next;
        });
      }, 5000);
      return () => clearInterval(timer);
    }, [winWidth]);

    const slideWidth = winWidth - 32;

    const modelCount = modelStore.availableModels.length;
    const hasAvailableModels = modelCount > 0;
    const activeModelName = modelStore.activeModel?.name;

    // 「状态」右栏「云端」的数据：远程服务器 + 已拉取到的远程模型 + 用户选中的云端模型
    const cloudModelCount = Array.from(
      serverStore.serverModels.values(),
    ).reduce((n, list) => n + list.length, 0);
    const selectedCloud = serverStore.userSelectedModels[0];
    const activeCloudName = selectedCloud
      ? (serverStore.serverModels
          .get(selectedCloud.serverId)
          ?.find(m => m.id === selectedCloud.remoteModelId)?.id ??
        selectedCloud.remoteModelId)
      : undefined;

    // 快捷入口主卡：固定为「图像增强」（本地超分/去噪/锐化），不随模型状态变化
    const primaryLabel = '图像增强';
    const primaryDesc = '超分、去噪、锐化，本地离线';
    const primaryIcon: AppIconName = 'image';
    const primaryAction = onOpenImageEnhance;

    // 顶部横幅轮播内容
    const banners: {
      key: string;
      colors: string[];
      title: string;
      sub: string;
    }[] = [
      {
        key: 'greet',
        colors: ['#4F8DF7', '#7C5CF6'],
        title: getGreeting(),
        sub: '欢迎使用 OnDevice Kit，全部功能本地离线运行',
      },
      {
        key: 'model',
        colors: ['#0EA5E9', '#10B981'],
        title: hasAvailableModels ? '模型已就绪' : '还没有本地模型',
        sub: hasAvailableModels
          ? `当前模型：${activeModelName ?? '已导入'}`
          : '去「模型管理」导入，或用下载直达一键跳转',
      },
      {
        key: 'cloud',
        colors: ['#F59E0B', '#EC4899'],
        title: '云端可选',
        sub: '也能接入云端 API，本地与云端随时切换',
      },
    ];

    // 轮播卡背景图：完全随机。
    // 每翻到某一张卡，就给它重新抽一张图（与另外两张不重复），
    // 所以连续翻页时每张卡显示的都是随机图片。
    const [bannerImages, setBannerImages] = useState<
      Record<string, number | null>
    >(() => {
      const picked = pickDistinctHomeBannerImages(banners.length);
      const map: Record<string, number | null> = {};
      banners.forEach((b, i) => {
        map[b.key] = picked[i] ?? null;
      });
      return map;
    });

    // 给第 idx 张卡（banners 下标）重抽一张背景图，保证与其它卡不重复
    const reshuffleBannerImage = (idx: number) => {
      const key = banners[idx]?.key;
      if (!key) {
        return;
      }
      setBannerImages(prev => {
        const others = banners
          .filter(b => b.key !== key)
          .map(b => prev[b.key])
          .filter((v): v is number => v != null);
        const candidates = HOME_BANNER_IMAGES.filter(
          id => !others.includes(id),
        );
        if (!candidates.length) {
          return prev;
        }
        const next = candidates[Math.floor(Math.random() * candidates.length)];
        return {...prev, [key]: next};
      });
    };

    // 翻页落定后给当前卡重抽随机图。
    // 渲染数组是 [cloud, greet, model, cloud, greet]（首尾为克隆位），
    // 渲染位下标 -> 卡片下标 = (pos - 1 + n) % n
    useEffect(() => {
      const bannerIdx = (slideIndex - 1 + banners.length) % banners.length;
      if (bannerIdx >= 0 && bannerIdx < banners.length) {
        reshuffleBannerImage(bannerIdx);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slideIndex]);

    const openDownload = async (url: string) => {
      setPickerVisible(false);
      try {
        await Linking.openURL(url);
      } catch {
        // 浏览器打开失败时静默关闭弹层
      }
    };

    const runAction = (action: string) => {
      switch (action) {
        case 'chat':
          onStartChat();
          break;
        case 'vision':
          onOpenVision();
          break;
        case 'imagegen':
          navigation.navigate('ImageGen');
          break;
        case 'tts':
          onOpenTts();
          break;
        case 'voiceChange':
          onOpenVoiceChange();
          break;
        case 'voiceClone':
          onOpenVoiceClone();
          break;
        case 'gptsovits':
          onOpenGptSovits();
          break;
        case 'settings':
          navigation.navigate('Settings');
          break;
        case 'more':
          onOpenMore();
          break;
      }
    };

    const onBannerScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      let idx = Math.round(e.nativeEvent.contentOffset.x / slideWidth);
      // 手动翻到头副本（0）-> 无感知回真第 3 张（index 3）
      if (idx <= 0) {
        bannerRef.current?.scrollTo({x: 3 * slideWidth, animated: false});
        idx = 3;
      }
      // 手动翻到尾副本（4）-> 无感知回真第 1 张（index 1）
      if (idx >= 4) {
        bannerRef.current?.scrollTo({x: 1 * slideWidth, animated: false});
        idx = 1;
      }
      setSlideIndex(idx);
    };

    // 页面背景（壁纸）已移到 App 根层的全局 ImageBackground —— 所有页面共用同一张，
    // 这里的根容器只要透明即可。

    return (
      <ImageBackground
        // 壁纸由 App 根层的全局 ImageBackground 提供（所有页面共用同一张），
        // 这里不再单独画一张，避免同一张图被渲染两遍。
        source={undefined}
        resizeMode="cover"
        style={[styles.root, {backgroundColor: 'transparent'}]}>
        <ScrollView
          ref={scroll.ref}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onScroll={scroll.onScroll}
          scrollEventThrottle={16}
          onContentSizeChange={scroll.onContentSizeChange}
          showsVerticalScrollIndicator={false}>
          {header}
          <View style={styles.container}>
            {/* 1. 顶部圆形横幅：问候语轮播 + 页码点 */}
            <Entrance index={0} style={styles.bannerWrap} screenKey="home">
              <Animated.ScrollView
                ref={bannerRef}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onBannerScrollEnd}
                onScroll={Animated.event(
                  [{nativeEvent: {contentOffset: {x: scrollX}}}],
                  {useNativeDriver: false},
                )}>
                {[banners[2], ...banners, banners[0]].map((b, i) => {
                  const bg = bannerImages[b.key];
                  if (bg != null) {
                    /**
                     * 轮播卡 = 一张真正的玻璃卡：
                     *   背景图 + 暗色蒙版垫在**玻璃下面**（同级的兄弟节点），
                     *   玻璃盖在它们之上 → 玻璃采样到的背景就是这张图（被柔化+染色），
                     *   文字放在玻璃**里面** → 不会被拍进背景、不会出鬼影。
                     */
                    return (
                      <View
                        key={`${b.key}_${i}`}
                        style={[styles.bannerSlide, {width: slideWidth}]}>
                        <ImageBackground
                          source={bg}
                          resizeMode="cover"
                          style={StyleSheet.absoluteFill}
                        />
                        <LinearGradient
                          colors={['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.42)']}
                          start={{x: 0, y: 0}}
                          end={{x: 0, y: 1}}
                          style={StyleSheet.absoluteFill}
                        />
                        <GlassSurface
                          style={StyleSheet.absoluteFill}
                          radius={0}
                          backdrop="wallpaper"
                          // 只画玻璃边：照片必须**一点也不糊**，玻璃只留一圈高光
                          rimOnly>
                          <View style={styles.bannerTextWrap}>
                            <Text style={styles.bannerTitle}>{b.title}</Text>
                            <Text style={styles.bannerSub}>{b.sub}</Text>
                          </View>
                        </GlassSurface>
                      </View>
                    );
                  }
                  // 没有可用图片时的兜底：原渐变 + 玻璃
                  return (
                    <View
                      key={`${b.key}_${i}`}
                      style={[styles.bannerSlide, {width: slideWidth}]}>
                      <LinearGradient
                        colors={b.colors}
                        start={{x: 0, y: 0}}
                        end={{x: 1, y: 1}}
                        style={StyleSheet.absoluteFill}
                      />
                      <GlassSurface
                        style={StyleSheet.absoluteFill}
                        radius={0}
                        backdrop="wallpaper"
                        rimOnly>
                        <View style={styles.bannerTextWrap}>
                          <Text style={styles.bannerTitle}>{b.title}</Text>
                          <Text style={styles.bannerSub}>{b.sub}</Text>
                        </View>
                      </GlassSurface>
                    </View>
                  );
                })}
              </Animated.ScrollView>
              <View style={styles.dotsRow} pointerEvents="none">
                {banners.map((b, i) => (
                  <BannerDot key={b.key} active={i + 1 === slideIndex} />
                ))}
              </View>
            </Entrance>

            {/* 2. 公告卡 */}
            <Entrance index={1} screenKey="home">
              <SurfaceCard style={styles.noticeCard} backdrop="wallpaper">
                <View style={styles.noticeTitleRow}>
                  <View style={styles.noticeBar} />
                  <Text style={styles.noticeTitle}>
                    Hi，欢迎使用 OnDevice Kit
                  </Text>
                </View>
                <Text style={styles.noticeDesc}>
                  既能本地运行，也能接入云端。需要模型时，到「模型管理」导入本地
                  GGUF 文件即可。
                </Text>
              </SurfaceCard>
            </Entrance>

            {/* 3. 全部功能：卡片宫格（与下方「快捷入口」同款卡片设计） */}
            <Entrance index={2} screenKey="home">
              <SectionLabel title="功能" style={styles.sectionLabel} />
              <View style={styles.funcGrid}>
                {/* 平板/折叠屏展开：按可用宽度升列（手机 2 列 → 宽屏 3/4 列），
                    宽度用百分比保持相对 funcGrid，避免 press-scale 包装层
                    重新计算布局（见下面 SurfaceCard 的注释）。 */}
                {QUICK_ITEMS.map(item => (
                  // ⚠️ 这里**不能**再给每格套 <Entrance>。
                  // funcGrid 是 row + wrap + space-between，funcCard 宽度 48%；
                  // 一旦套一层 Animated.View，包装层就成了 flex item，
                  // 卡片变成「占包装层宽度的 48%」，而包装层宽度又由内容决定 ——
                  // 布局会直接塌掉。想要宫格错峰只能改 Entrance 把 style 透传到
                  // 包装层、再让卡片 100% 占满，那属于改布局，不做。
                  <SurfaceCard
                    key={item.key}
                    style={[styles.funcCard, {width: funcCardWidth}]}
                    onPress={() => runAction(item.action)}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    backdrop="wallpaper">
                    <Text style={styles.featureTitle}>{item.title}</Text>
                    <Text style={styles.featureDesc}>{item.desc}</Text>
                    <View
                      style={[
                        styles.featureIconWrap,
                        styles.funcIconWrap,
                        item.strongIcon ? styles.funcIconStrong : null,
                      ]}>
                      <Icon3D name={item.icon3d} size={62} />
                    </View>
                  </SurfaceCard>
                ))}
              </View>
            </Entrance>

            {/* 4. 快捷入口 */}
            <Entrance index={3} screenKey="home">
              <SectionLabel title="快捷入口" style={styles.sectionLabel} />
              <View style={styles.twoCards}>
                <SurfaceCard
                  style={styles.featureCard}
                  onPress={primaryAction}
                  accessibilityRole="button"
                  backdrop="wallpaper">
                  <Text style={styles.featureTitle}>{primaryLabel}</Text>
                  <Text style={[styles.featureDesc, styles.quickDesc]}>
                    {primaryDesc}
                  </Text>
                  <View style={styles.featureIconWrap}>
                    <AppIcon name={primaryIcon} size={68} color="#3B82F6" />
                  </View>
                </SurfaceCard>

                {uiStore.showDownloadEntry && (
                  <SurfaceCard
                    style={styles.featureCard}
                    onPress={() => setPickerVisible(true)}
                    accessibilityRole="button"
                    backdrop="wallpaper">
                    <Text style={styles.featureTitle}>模型下载直达</Text>
                    <Text style={[styles.featureDesc, styles.quickDesc]}>
                      GitHub · HuggingFace 直达页面
                    </Text>
                    <View style={styles.featureIconWrap}>
                      <AppIcon name="download" size={68} color="#8B5CF6" />
                    </View>
                  </SurfaceCard>
                )}
              </View>
            </Entrance>

            {/* 5. 状态：左右两个模块（本地 / 云端） */}
            <Entrance index={4} screenKey="home">
              <SectionLabel title="状态" style={styles.sectionLabel} />
              <View style={styles.statusRow}>
                <SurfaceCard style={styles.statusCard} backdrop="wallpaper">
                  <Text style={styles.statusTitle}>本地</Text>
                  <View style={styles.statusItem}>
                    <Text style={styles.statusLabel}>当前模型</Text>
                    <Text
                      style={[styles.statusValue, styles.statusModelName]}
                      numberOfLines={2}>
                      {activeModelName ?? '未选择'}
                    </Text>
                  </View>
                  <View style={styles.statusItem}>
                    <Text style={styles.statusLabel}>可用模型</Text>
                    <Text style={styles.statusValue}>{modelCount} 个</Text>
                  </View>
                </SurfaceCard>

                <SurfaceCard style={styles.statusCard} backdrop="wallpaper">
                  <Text style={styles.statusTitle}>云端</Text>
                  <View style={styles.statusItem}>
                    <Text style={styles.statusLabel}>当前模型</Text>
                    <Text
                      style={[styles.statusValue, styles.statusModelName]}
                      numberOfLines={2}>
                      {activeCloudName ?? '未选择'}
                    </Text>
                  </View>
                  <View style={styles.statusItem}>
                    <Text style={styles.statusLabel}>可用模型</Text>
                    <Text style={styles.statusValue}>{cloudModelCount} 个</Text>
                  </View>
                </SurfaceCard>
              </View>
            </Entrance>

            {/* 模型下载直达：类别选择弹层 */}
            {/* 保持原样：RN Modal + 平台 fade。
              曾试过换成 AnimatedDialog（BAVoice scaleFade），但那条路要给遮罩
              加 `opacity` 动画 —— Android 上会让卡片文字进离屏合成层，
              字形边缘会变（视觉要求「不能有任何界面视觉变化」），故回退。 */}
            <Modal
              visible={pickerVisible}
              transparent
              animationType="fade"
              onRequestClose={() => setPickerVisible(false)}>
              <View style={styles.modalOverlay}>
                <TouchableOpacity
                  style={StyleSheet.absoluteFill}
                  activeOpacity={1}
                  onPress={() => setPickerVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="关闭模型类型选择"
                />
                {/* RN Modal 独立窗口采不到壁纸：与其他弹窗统一走磨砂玻璃；
                    非玻璃风格下 SurfaceCard 还原成原实底 View，零视觉变化 */}
                <SurfaceCard
                  style={styles.modalCard}
                  glassType="regular"
                  tint={dialogGlassTint(theme)}
                  tintOpacity={0.34}
                  blur
                  blurAmount={50}
                  blurRounds={6}
                  forceFrosted>
                  <Text style={styles.modalTitle}>选择模型类型</Text>
                  <Text style={styles.modalSubtitle}>
                    点击后跳转浏览器直达下载页
                  </Text>
                  {DOWNLOAD_MODELS.map((m, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={styles.modalItem}
                      onPress={() => openDownload(m.url)}>
                      <Icon3D name={m.icon3d} size={36} />
                      <View style={styles.modalTextWrap}>
                        <Text style={styles.modalItemTitle}>{m.title}</Text>
                        <Text style={styles.modalItemDesc}>{m.desc}</Text>
                      </View>
                      <AppIcon
                        name="openNew"
                        size={18}
                        color={theme.colors.onSurfaceVariant}
                      />
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={styles.modalCancel}
                    onPress={() => setPickerVisible(false)}>
                    <Text style={styles.modalCancelText}>取消</Text>
                  </TouchableOpacity>
                </SurfaceCard>
              </View>
            </Modal>
          </View>
        </ScrollView>
      </ImageBackground>
    );
  },
);
