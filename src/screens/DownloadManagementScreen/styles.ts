import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';
import {cardBg, cardRadius} from '../../theme/cards';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 140,
    },

    /* 总览：已下载 / 占用空间 / 下载中 */
    overview: {
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      paddingVertical: 16,
      paddingHorizontal: 8,
      marginBottom: 14,
    },
    overviewRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    overviewItem: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    overviewNum: {
      fontSize: 20,
      fontWeight: '800',
      color: theme.colors.onSurface,
    },
    overviewLabel: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    overviewDivider: {
      width: StyleSheet.hairlineWidth,
      height: 28,
      backgroundColor: theme.colors.outlineVariant,
    },

    /* 通用卡片 */
    card: {
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      paddingVertical: 6,
      paddingHorizontal: 14,
      marginBottom: 14,
    },
    emptyText: {
      fontSize: 13,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 18,
      paddingVertical: 12,
    },

    /* 分区标题（液态玻璃用胶囊、其它风格用纯文字带标记） */
    section: {
      marginTop: 6,
      marginBottom: 2,
    },
    sectionTitle: {
      alignSelf: 'flex-start',
      marginBottom: 8,
    },
    sectionTitleInner: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    sectionTitleMarker: {
      width: 3,
      height: 14,
      borderRadius: 2,
      backgroundColor: theme.colors.secondary,
      marginRight: 8,
    },
    sectionTitleText: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    sectionTitlePlain: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
      marginLeft: 2,
    },
    sectionTitleMarkerPlain: {
      width: 3,
      height: 14,
      borderRadius: 2,
      backgroundColor: theme.colors.secondary,
      marginRight: 8,
    },
    sectionTitleTextPlain: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },

    /* 一行：名称 + 体积 / 状态 + 右侧操作 */
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.outlineVariant,
    },
    rowMain: {
      flex: 1,
      marginRight: 12,
    },
    rowTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    rowSub: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 3,
    },
    rowActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },

    /* 文本按钮 */
    actionBtn: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.primary,
    },
    actionBtnDanger: {
      color: theme.colors.error,
    },
    actionBtnDisabled: {
      color: theme.colors.onSurfaceVariant,
      opacity: 0.5,
    },

    /* 进度条 */
    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
    },
    progressTrack: {
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.surfaceVariant,
      marginTop: 6,
      overflow: 'hidden',
      width: '100%',
    },
    progressFill: {
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.colors.secondary,
    },
    progressText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.colors.onSurfaceVariant,
      marginLeft: 8,
      minWidth: 38,
      textAlign: 'right',
    },
  });
