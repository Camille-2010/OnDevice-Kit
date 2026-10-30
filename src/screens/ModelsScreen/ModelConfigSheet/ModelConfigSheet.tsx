import React, {useState} from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  Modal,
  useWindowDimensions,
} from 'react-native';
import {Text} from 'react-native-paper';
import {observer} from 'mobx-react-lite';

import {useTheme} from '../../../hooks';
import {Model} from '../../../utils/types';
import {buttonRing, cardRadius, dialogGlassTint} from '../../../theme/cards';
import {SurfaceCard} from '../../../components/GlassSurface';

import {LoadConfigActions, LoadConfigSection} from './LoadConfigSection';
import {
  SessionConfigActions,
  SessionConfigSection,
} from './SessionConfigSection';
import {VisionConfigSection} from './VisionConfigSection';

type TabKey = 'load' | 'session' | 'vision';

const TABS: {key: TabKey; label: string}[] = [
  {key: 'load', label: '加载配置'},
  {key: 'session', label: '会话配置'},
  {key: 'vision', label: '视觉配置'},
];

/**
 * 模型参数面板：加载配置 / 会话配置 / 视觉配置。
 *
 * 三者的区别很重要，UI 上用分段控件分开，避免用户把「影响加载的」
 * 和「影响生成的」混为一谈：
 *  · 加载配置   —— 读GGUF / 建context 时读取一次，改完要重载才生效
 *  · 会话配置   —— 新建会话时读取的采样参数（只对新会话生效）
 *  · 视觉配置   —— mmproj 的绑定状态
 */
export const ModelConfigSheet: React.FC<{
  visible: boolean;
  model: Model;
  onClose: () => void;
  onPickExistingVision: () => void;
}> = observer(({visible, model, onClose, onPickExistingVision}) => {
  const theme = useTheme();
  const [tab, setTab] = useState<TabKey>('load');
  const {height: windowHeight} = useWindowDimensions();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.center} pointerEvents="box-none">
        {/*
        ⚠️ card 必须自带底色 + 圆角。
        原来是 `backgroundColor: 'transparent'`，而 LoadConfigSection /
        SessionConfigSection / VisionConfigSection 三个 tab 内部**都只有
        文字和滑块**，没有自己的卡片面 —— 于是弹窗内容直接浮在「被压暗的
        页面」上，文字和背后的模型列表糊在一起，看起来就是弹窗坏了。

        结构（对齐参考图）：
          ┌ 标题 + 副标题            × ┐   ← 固定，不滚动
          ├ 分段标签页 ───────────────┤   ← 固定，不滚动
          ├ 内容（可滚动）────────────┤
          └ 底部操作条 ──────────────┘   ← 固定，不滚动
      */}
        <SurfaceCard
          glassType="regular"
          tint={dialogGlassTint(theme)}
          // 不透明度与其他弹窗统一为 0.34：真实模糊层透出来才是毛玻璃
          // （见 SheetGlass 的统一注释），0.45 偏灰暗（用户反馈「磨砂太暗」）。
          // forceFrosted：强制磨砂路径，blur 才会真正生效（原生 AGSL 路径下
          // blur 被忽略），并避开小米 HyperOS 覆盖层采样透明的坑。
          tintOpacity={0.34}
          blur
          blurAmount={50}
          blurRounds={6}
          forceFrosted
          style={[
            st.card,
            {
              // 弹窗面用「页面底色」，里面每一项再用 cardBg（浅灰）做成卡片，
              // 这样内外的层次关系和主界面一致（页面 → 卡片）。
              // 液态玻璃下这层底色会被剥掉、换成真玻璃（带边缘高光）。
              backgroundColor: theme.colors.background,
              // 四个角更圆融：在主题圆角基础上再 +8
              //（rounded 风格 18 → 26，standard 风格 12 → 20）
              borderRadius: cardRadius() + 8,
              // 用**窗口像素**的定高（不是 CSS 百分比——Modal 里百分比
              // 解析不到父容器高度）。定高 + 内部 ScrollView flex:1 →
              // 内容超了就在剩余空间里滚动，底部操作条永远完整可见；
              // 配合外层 justifyContent:'center' + 上下留白，弹窗稳定
              // 居中、不贴顶/底边（用户反馈「底部被挡住了」）。
              height: Math.round(windowHeight * 0.6),
            },
          ]}>
          {/* 标题区：固定在卡片顶部，不参与滚动 */}
          <View style={st.header}>
            <View style={st.headerText}>
              <Text
                numberOfLines={1}
                style={{
                  color: theme.colors.onSurface,
                  fontSize: 17,
                  lineHeight: 21,
                  fontWeight: '700',
                }}>
                {model.name || model.filename}
              </Text>
              <Text
                style={{
                  color: theme.colors.onSurfaceVariant,
                  fontSize: 12,
                  lineHeight: 16,
                }}>
                配置模型参数
              </Text>
            </View>
            <TouchableOpacity
              testID="config-close-button"
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="关闭"
              style={st.closeBtn}>
              <Text
                style={{
                  color: theme.colors.onSurfaceVariant,
                  fontSize: 18,
                  lineHeight: 20,
                }}>
                ×
              </Text>
            </TouchableOpacity>
          </View>
          <View
            style={[st.divider, {backgroundColor: theme.colors.outlineVariant}]}
          />

          <View style={st.tabBar}>
            {TABS.map(t => {
              const active = tab === t.key;
              return (
                <TouchableOpacity
                  key={t.key}
                  testID={`config-tab-${t.key}`}
                  onPress={() => setTab(t.key)}
                  style={[
                    st.tabItem,
                    // 液态玻璃下每个分段按键都描一圈高光（其他风格为 transparent）
                    {borderColor: buttonRing(theme)},
                    active && {
                      // 选中段用主色淡染（不再用实底，和玻璃面板统一）
                      backgroundColor: 'rgba(59,130,246,0.16)',
                      borderColor: theme.colors.outlineVariant,
                    },
                  ]}>
                  <Text
                    style={{
                      fontSize: 12,
                      color: active
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant,
                      fontWeight: active ? '700' : '500',
                    }}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <ScrollView
            style={st.scroll}
            contentContainerStyle={st.scrollContent}
            keyboardShouldPersistTaps="handled">
            {tab === 'load' ? <LoadConfigSection model={model} /> : null}
            {tab === 'session' ? <SessionConfigSection model={model} /> : null}
            {tab === 'vision' ? (
              <VisionConfigSection
                model={model}
                onPickExisting={onPickExistingVision}
              />
            ) : null}
          </ScrollView>

          {/* 底部操作条：固定在卡片底部，不随内容滚动 */}
          {tab === 'load' || tab === 'session' ? (
            <View
              style={[
                st.footer,
                {borderTopColor: theme.colors.outlineVariant},
              ]}>
              {tab === 'load' ? (
                <LoadConfigActions model={model} />
              ) : (
                <SessionConfigActions model={model} />
              )}
            </View>
          ) : null}
        </SurfaceCard>
      </View>
    </Modal>
  );
});

const st = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  center: {
    flex: 1,
    // 垂直居中。之前改成 flex-start + paddingTop:64，在低端机（屏幕高、
    // 弹层矮）上会顶到顶部，观感像"贴着头"，用户反馈太靠上 —— 改回居中。
    justifyContent: 'center',
    // 28 → 18：窗口在「稍微变宽一点」，左右各多出 10px
    paddingHorizontal: 18,
    // 上下留白：让居中的卡片离屏幕顶/底各留一段，避免底部被手势栏/
    // 屏幕边缘挡住（用户反馈「底部被挡住了」）。
    paddingVertical: 36,
  },
  card: {
    // 底色/圆角/高度都由 JSX 按主题与窗口尺寸注入（这里拿不到 theme）
    // 高度 = 窗口像素的 60% 定高，**不是百分比**：Modal 里百分比高解析不到
    // 父容器高度，卡片会按内容撑开、底部被屏幕裁掉。定高 + 内部 ScrollView
    // flex:1 → 底部操作条始终完整可见。
    flexShrink: 1,
    // 圆角裁掉滚动内容，避免内容在圆角处露出来
    overflow: 'hidden',
  },
  // 标题区（固定）
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    // 上下留白收紧：14/10 -> 10/7（固定区不占中间滚动空间）
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 7,
    gap: 10,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  closeBtn: {
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 12,
    // 12/10 → 10/8：标签页上下留白收紧
    // 8/6：标签页上下留白再收一点
    marginTop: 8,
    marginBottom: 6,
    padding: 3,
    borderRadius: 14,
    gap: 6,
    backgroundColor: 'rgba(125,125,128,0.12)',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    // 10 → 8：分段控件本身矮一点
    paddingVertical: 6,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  scroll: {
    // 父级 card 是**定高**（height = 0.6×窗高），所以用 flex:1：
    // flexBasis:0 + flexGrow:1 → ScrollView 精确填满「定高减去 标题/
    // 标签页/底部操作条」后的剩余空间，内容超出就在这块区域里滚动，
    // 底部操作条因此永远贴在卡片底部、完整可见。
    // （之前用 flexShrink:1，ScrollView 不收缩、把底部操作条顶出屏幕
    //  → 用户反馈「底部被挡住了」。）
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  // 底部操作条（固定）：两个按钮并排一行，省竖向空间
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    // 上下留白收紧：8/12 -> 6/8
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
});
