import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';
import {cardBg, cardRadius} from '../../theme/cards';

export const createStyles = ({
  theme,
  frosted,
}: {
  theme: Theme;
  frosted: boolean;
}) => {
  // BAVoice 风格：黑色胶囊小节标题（深色主题下反色，保证可见）
  const pillBg = theme.dark ? '#E2E8F0' : '#111827';
  const pillFg = theme.dark ? '#0F172A' : '#FFFFFF';
  // 首页卡片底色：
  //  - 磨砂开：半透明（白卡 0.62 alpha），让背景图透出，与顶栏同透明
  //  - 磨砂关：实底（浅色白 / 深色面），恢复「纯白背景」观感
  const homeCard = frosted
    ? theme.dark
      ? 'rgba(28, 28, 32, 0.62)'
      : 'rgba(255, 255, 255, 0.62)'
    : theme.dark
      ? theme.colors.surface
      : '#FFFFFF';

  return StyleSheet.create({
    root: {
      flex: 1,
    },
    scroll: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    // 滚动容器本身不留左右边距，这样顶部栏能整条填满左右两边
    scrollContent: {
      paddingBottom: 0,
      // 平板：内容不拉满全宽，收窄居中（壁纸/玻璃仍是整屏）
      maxWidth: 760,
      width: '100%',
      alignSelf: 'center',
    },
    container: {
      paddingHorizontal: 16,
      paddingTop: 10,
      // 给底部悬浮胶囊栏留出空间，内容可以滚到它下面
      paddingBottom: 126,
    },
    /* 分页容器：横向 paging 的外层，给它撑满可用高度 */
    pagerPage: {
      flex: 1,
    },
    /* 单页内容：原来 container 的职责搬到这里 */
    pageBody: {
      paddingHorizontal: 16,
      paddingTop: 10,
      // 底部留够：胶囊栏 + 页码点，内容都能滚上来
      paddingBottom: 126,
    },

    /* 1. 顶部大横幅（圆角轮播 + 页码点） */
    bannerWrap: {
      width: '100%',
      borderRadius: 24,
      overflow: 'hidden',
    },
    bannerSlide: {
      height: 186,
      // 内边距挪到 bannerTextWrap（文字在玻璃层内，背景图在玻璃层下）
    },
    /** 玻璃卡里的文字容器：保留原来的内边距与底部对齐 */
    bannerTextWrap: {
      flex: 1,
      paddingHorizontal: 22,
      paddingVertical: 24,
      justifyContent: 'flex-end',
    },
    bannerTitle: {
      color: '#FFFFFF',
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    bannerSub: {
      color: 'rgba(255,255,255,0.92)',
      fontSize: 13,
      marginTop: 8,
      lineHeight: 19,
    },
    dotsRow: {
      position: 'absolute',
      right: 16,
      bottom: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.45)',
    },
    dotActive: {
      width: 16,
      backgroundColor: '#FFFFFF',
    },
    /**
     * 动画版页码点的基础形状。
     *
     * 纯白底 + 由动画驱动 opacity，正好还原原来两种静态样式：
     *   未选中：白色 × 0.45 = rgba(255,255,255,0.45)
     *   选中：  白色 × 1.00 = #FFFFFF
     * 宽度 6→16 由 BannerDot 的 Animated 值给出，所以这里不写 width。
     */
    dotBase: {
      height: 6,
      borderRadius: 3,
      backgroundColor: '#FFFFFF',
    },

    /* 2. 公告卡：蓝色竖杠 + 标题 + 说明 */
    noticeCard: {
      width: '100%',
      backgroundColor: homeCard,
      borderRadius: 25,
      paddingHorizontal: 15,
      paddingVertical: 10,
      marginTop: 15,
    },
    noticeTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    noticeBar: {
      width: 4,
      height: 18,
      borderRadius: 2,
      backgroundColor: '#3B82F6',
      marginRight: 9,
    },
    noticeTitle: {
      color: theme.colors.onSurface,
      fontSize: 18,
      fontWeight: '800',
    },
    noticeDesc: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 12,
      marginTop: 4,
      lineHeight: 16,
    },

    /* 3. 功能宫格：两列卡片，视觉与下方「快捷入口」的 featureCard 保持一致 */
    funcGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 12,
    },
    // 更矮：图标改成右下角的「虚化水印」，不再单独占一行高度
    funcCard: {
      width: '48%',
      backgroundColor: homeCard,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 74,
      justifyContent: 'center',
      // ⚠️ 不要 overflow:'hidden'。Android 上它会建一个裁剪层，
      // 卡片里右下角那个 Icon3D 水印（尺寸大于卡片）会让触摸被这层吃掉 ——
      // 实测点宫格卡片完全没反应，去掉就正常了。
      // 圆角由 borderRadius 自己裁，观感不受影响。
      overflow: 'visible',
    },

    /* 4. 小节标题（蓝色竖杠样式，见 SectionLabel 组件） */
    sectionLabel: {
      marginTop: 24,
      marginBottom: 12,
    },
    /* 黑色胶囊小节标题（保留备用） */
    sectionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: pillBg,
      borderRadius: 14,
      paddingHorizontal: 13,
      paddingVertical: 8,
      marginTop: 24,
      marginBottom: 12,
      gap: 6,
    },
    sectionPillText: {
      color: pillFg,
      fontSize: 13,
      fontWeight: '700',
    },

    /* 5. 快捷入口：两张并排卡 */
    twoCards: {
      flexDirection: 'row',
      gap: 15,
    },
    // 更矮：文字居中，图标虚化后沉到右下角当水印
    featureCard: {
      flex: 1,
      backgroundColor: homeCard,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 88,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    // 「功能」宫格与「快捷入口」两张卡共用这套文字样式：
    // 整体再小一档，标题加粗回来（15/700），都稍微透明一点
    featureTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
      opacity: 0.9,
    },
    featureDesc: {
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 15,
      marginTop: 3,
      opacity: 0.9,
    },
    // 只给「快捷入口」两张卡的描述文字用：小字再淡一档
    quickDesc: {
      opacity: 0.72,
    },
    // 「快捷入口」两张卡的水印图标：竖直居中于卡片、横向仍贴右
    // （「功能」宫格会再用 funcIconWrap 覆盖位置与透明度）
    featureIconWrap: {
      position: 'absolute',
      right: 4,
      top: 0,
      bottom: 0,
      // 竖向居中 → 图标落在卡片中间（不再沉在右下角）
      justifyContent: 'center',
      opacity: 0.2,
    },
    // 「功能」宫格专用：比快捷入口的再大一点、横向略往左、虚化更轻
    // （图标已去掉玻璃底、只留彩色线条，所以透明度可以再给足一点）
    //
    // ⚠️ 横向 right 留出内缩：卡片是玻璃面板（GlassSurface 内部有
    // overflow:'hidden'），图标贴边会被圆角裁掉一块。
    // 纵向用 top:0/bottom:0 + justifyContent:'center' 让图标居中于卡片。
    // opacity 从 0.52 提到 0.85：之前太淡，看着像「模糊」。
    funcIconWrap: {
      right: 8,
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      opacity: 0.85,
    },
    // 图像识别 / 更多 这两个图标线条本来颜色就浅，单独再减轻虚化
    funcIconStrong: {
      opacity: 1,
    },

    /* 6. 状态：左右两个模块（本地 / 云端），两栏严格等高 */
    statusRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      gap: 15,
    },
    statusCard: {
      flex: 1,
      backgroundColor: homeCard,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    statusTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
      opacity: 0.9,
      marginBottom: 10,
    },
    statusItem: {
      marginBottom: 10,
    },
    statusLabel: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    statusValue: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
      marginTop: 2,
    },
    // 「当前模型」写全名可能换行：固定预留两行高度，
    // 左右两栏的「可用模型」行位就能对齐，卡片也是等高
    statusModelName: {
      lineHeight: 19,
      minHeight: 38,
    },

    /* 模型下载直达：类别选择弹层 */
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15,23,42,0.55)',
      justifyContent: 'center',
      paddingHorizontal: 28,
    },
    modalCard: {
      backgroundColor: cardBg(theme),
      borderRadius: 20,
      paddingVertical: 20,
      paddingHorizontal: 18,
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.onSurface,
      textAlign: 'center',
    },
    modalSubtitle: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      marginTop: 4,
      marginBottom: 6,
    },
    modalItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceVariant,
      borderRadius: cardRadius(),
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginTop: 10,
    },
    modalTextWrap: {
      flex: 1,
      marginLeft: 12,
    },
    modalItemTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    modalItemDesc: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
      lineHeight: 16,
    },
    modalCancel: {
      marginTop: 14,
      paddingVertical: 11,
      borderRadius: 14,
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceVariant,
    },
    modalCancelText: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.onSurfaceVariant,
    },
  });
};
