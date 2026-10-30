import * as React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {Icon3D} from '../../components/Icon3D';
import {Entrance} from '../../components/Entrance';
import {Icon3DName} from '../../assets/icons3d';
import {AppIcon} from '../../components/AppIcon';
import {PillLabel} from '../../components/PillLabel';
import {cardBg, cardRadius} from '../../theme/cards';
import {useTheme} from '../../hooks';
import {useScrollMemory} from '../../utils/scrollMemory';
import {SurfaceCard} from '../../components/GlassSurface';

// 每个 key 唯一对应一个真实页面/路由。
// 注意：以前这里 6 行里有 5 行都写 key:'voice'，导致「生成图片/音色克隆/云端AI服务」
// 点进去全是同一个语音合成占位页。现已一一对应。
export type MoreKey =
  | 'list'
  | 'vision'
  | 'imagegen'
  | 'imageEnhance'
  | 'voiceClone'
  | 'tts'
  | 'voiceChange'
  | 'gptsovits'
  | 'cloudApi';

interface MoreScreenProps {
  onOpen: (key: MoreKey) => void;
  header?: React.ReactNode;
}

// 更多页：每行一个功能卡片（3D 图标 + 标题 + 说明 + 右箭头）
const MORE_ITEMS: {
  key: MoreKey;
  title: string;
  desc: string;
  icon3d: Icon3DName;
}[] = [
  {
    key: 'vision',
    title: '图像识别',
    desc: '本地识别图片内容',
    icon3d: 'vision',
  },
  {
    key: 'imagegen',
    title: '生成图片',
    desc: '支持SD和FLUX系列',
    icon3d: 'imagegen',
  },
  {
    key: 'imageEnhance',
    title: '图像增强',
    desc: '超分、去噪、锐化与色彩增强',
    icon3d: 'imageenhance',
  },
  {
    key: 'voiceClone',
    title: '语音克隆',
    desc: '提取音色特征，用其音色输出语音',
    icon3d: 'asr',
  },
  {
    key: 'tts',
    title: '生成语音',
    desc: '输入文字，用本机引擎念出来',
    icon3d: 'tts',
  },
  {
    key: 'voiceChange',
    title: '音色转换',
    desc: '导入音频，替换任意音色',
    icon3d: 'voice',
  },
  {
    key: 'gptsovits',
    title: 'GPT-SoVITS',
    desc: '连接 GPT-SoVITS 引擎，按角色包合成语音',
    icon3d: 'models',
  },
  {
    key: 'cloudApi',
    title: '云端AI服务',
    desc: '兼容Open AI等格式接口',
    icon3d: 'settings',
  },
];

const MoreScreen: React.FC<MoreScreenProps> = ({
  onOpen,
  header,
}: MoreScreenProps) => {
  const theme = useTheme();
  const styles = createStyles(theme);
  // 进二级页时本组件会被卸载（renderMore 按 moreSub 做 switch），
  // 返回时重新挂载 —— 用记忆的偏移量无动画滚回去，等价于「没离开过」。
  const scroll = useScrollMemory('more');

  return (
    <ScrollView
      ref={scroll.ref}
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      onScroll={scroll.onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={scroll.onContentSizeChange}>
      {header}
      <View style={styles.content}>
        {/* 浮空小字：垫液态玻璃胶囊（margin 移到胶囊上，字体不变） */}
        <PillLabel style={styles.subtitleWrap}>
          <Text style={styles.subtitle}>
            图像、语音与云端服务，全部工具入口
          </Text>
        </PillLabel>
        {/* 一行一张卡：第一行 图标紧贴标题，第二行 小字+右箭头 */}
        {MORE_ITEMS.map((item, idx) => (
          <Entrance key={item.key} index={idx + 1} screenKey="more">
            <SurfaceCard style={styles.card} onPress={() => onOpen(item.key)}>
              {/* 左图标列 + 右文字列：图标列纵向居中（卡片中间），文字列起点
                  仍是 42（34 占位 + 8 间距），所以文字位置完全不动。 */}
              <View style={styles.row}>
                <View style={styles.iconCol}>
                  <Icon3D name={item.icon3d} size={40} />
                </View>
                <View style={styles.textCol}>
                  <Text style={styles.title}>{item.title}</Text>
                  <View style={styles.descRow}>
                    <Text style={styles.desc} numberOfLines={1}>
                      {item.desc}
                    </Text>
                    <AppIcon
                      name="chevronRight"
                      size={18}
                      color={theme.colors.onSurfaceVariant}
                    />
                  </View>
                </View>
              </View>
            </SurfaceCard>
          </Entrance>
        ))}
      </View>
    </ScrollView>
  );
};

const createStyles = (theme: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    content: {
      padding: 16,
      paddingTop: 8,
      // 给底部悬浮胶囊栏留出空间
      paddingBottom: 126,
    },
    // 滚动容器本身不留边距，顶部栏才能整条填满左右
    scrollContent: {
      paddingBottom: 0,
    },
    pageTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: theme.colors.onSurface,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 15,
      color: theme.colors.onSurfaceVariant,
    },
    /* 胶囊容器的下间距（原 subtitle 的 marginBottom 移到这里） */
    subtitleWrap: {
      marginBottom: 18,
    },
    /* 一行一张卡：左图标列 + 右文字列（标题 / 小字+右箭头） */
    card: {
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 10,
    },
    // 左图标列 + 右文字列
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 8,
    },
    // 图标列：固定 34 宽（文字起点 = 34 + 8 = 42，保持不变）；
    // 纵向 stretch + 居中 → 图标落在卡片垂直中间（比贴着标题时往下一点）。
    iconCol: {
      width: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 文字列：标题 + 说明，纵向居中，和图标对齐
    textCol: {
      flex: 1,
      justifyContent: 'center',
    },
    title: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    // 第二行：小字 + 右箭头（已在文字列内，无需再缩进）
    descRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 4,
    },
    desc: {
      flex: 1,
      fontSize: 12.5,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 16,
    },
  });

export default MoreScreen;
