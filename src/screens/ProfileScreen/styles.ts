import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';
import {cardBg, cardRadius} from '../../theme/cards';

export const createStyles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    // 滚动容器本身不留左右边距，顶部栏才能整条填满左右
    scrollContent: {
      paddingBottom: 0,
    },
    container: {
      paddingHorizontal: 16,
      paddingTop: 10,
      // 给底部悬浮胶囊栏留出空间
      paddingBottom: 126,
    },

    /* 头像 + 名字（封面已去掉，整体上移） */
    identityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 2,
      paddingHorizontal: 6,
    },
    avatar: {
      width: 76,
      height: 76,
      borderRadius: 38,
      backgroundColor: '#E8C547',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 3,
      borderColor: theme.colors.background,
    },
    identityText: {
      flex: 1,
      marginLeft: 12,
    },
    name: {
      fontSize: 20,
      fontWeight: '800',
      color: theme.colors.onSurface,
    },
    meta: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    metaPill: {
      marginTop: 4,
    },

    /* 统计：整条合并为一个大液态玻璃栏（小字胶囊保留在内部） */
    statsBar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 18,
      paddingVertical: 14,
      paddingHorizontal: 4,
      marginTop: 20,
    },
    statItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    statDivider: {
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: theme.colors.outlineVariant,
    },
    statNum: {
      fontSize: 20,
      fontWeight: '800',
      color: theme.colors.onSurface,
    },
    statLabel: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
    },
    statLabelPill: {
      alignSelf: 'center',
      marginTop: 3,
    },

    /* 标签：原为描边胶囊，现统一为液态玻璃小胶囊 */
    chipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 22,
      gap: 8,
    },
    chipPill: {},
    chipText: {
      fontSize: 12,
      color: theme.colors.onSurface,
      fontWeight: '500',
    },

    /* 常用入口小卡 */
    infoRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 20,
    },
    infoCard: {
      flex: 1,
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      paddingHorizontal: 13,
      paddingVertical: 15,
      // 接近正方形、略长（原 124 太高）
      minHeight: 112,
    },
    infoTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.onSurface,
      // 文字推到底部，上方让给居中的图标水印
      marginTop: 'auto',
    },
    infoDesc: {
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
      marginTop: 4,
      lineHeight: 15,
    },
    /* 功能卡图标水印：去掉图标底色，改成大而淡的水印；
       绝对定位铺满卡片、水平居中、垂直居中偏上（paddingBottom 上移），
       尺寸留足边距，不贴卡片边缘 */
    infoIconWatermark: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      // 卡片高度不变(112)；图标 fixed 72dp（不随屏宽放大），再往上移、
      // 提高不透明度让图标更清楚（用户反馈「看不清」）。
      paddingBottom: 28,
      opacity: 0.68,
    },

    footer: {
      textAlign: 'center',
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
    },
    footerPill: {
      alignSelf: 'center',
      marginTop: 26,
    },
  });
