import {StyleSheet} from 'react-native';

import {Theme} from '../../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      // 与主页一致的扁平卡片：大圆角、无边框、无阴影，只靠底色区分层次。
      // （主页的宫格/区块卡都是这个语言：cardBg + 20~25 圆角 + 不描边。）
      borderRadius: 20,
      margin: 6,
      backgroundColor: theme.colors.surface,
    },
    cardContent: {
      paddingBottom: 6,
      paddingTop: 0,
      //paddingHorizontal: 12,
    },
    downloadProgressContainer: {
      marginHorizontal: 18,
      marginTop: 6,
      marginBottom: 12,
    },
    progressBar: {
      height: 8,
      borderRadius: 5,
    },
    downloadSpeed: {
      textAlign: 'right',
      fontSize: 12,
      marginTop: 4,
    },
    warningContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      marginBottom: 12,
    },
    warningContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
    },
    warningIcon: {
      margin: 0,
    },
    warningText: {
      color: theme.colors.error,
      fontSize: 12,
      flex: 1,
      flexWrap: 'wrap',
    },
    visionToggleContainer: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 12,
      gap: 8,
    },
    compactHeader: {
      // 收紧内边距，让头部更紧凑（图标与模型名挨得更近）
      paddingHorizontal: 14,
      // 纵向从 9 收到 6：卡片整体矮一点（上下各省 3px），横向不动
      paddingVertical: 6,
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
      gap: 6,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    modelTypeIcon: {
      flexShrink: 0,
      // 彩色圆底：让类型图标本身就是一个可辨识的色块，和后面的类型标签
      // 属于同一套色彩语言
      width: 28,
      height: 28,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 类型图标外层玻璃胶囊：padding 收成 0，让玻璃紧贴 28×28 图标
    modelTypeIconGlass: {
      paddingHorizontal: 0,
      paddingVertical: 0,
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 模型类型文字标注（图像 / 文本）：小圆角 chip，紧贴在模型名前面
    typeBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 6,
      marginRight: 4,
      flexShrink: 0,
    },
    typeBadgeVision: {
      backgroundColor: theme.colors.secondaryContainer,
    },
    typeBadgeText: {
      backgroundColor: theme.colors.surfaceVariant,
    },
    typeBadgeLabel: {
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 16,
    },
    typeBadgeLabelVision: {
      color: theme.colors.secondary,
    },
    // 语音模型（ASR/TTS）：青绿色，和图像的紫、文本的灰区分开
    typeBadgeAudio: {
      backgroundColor: 'rgba(16,185,129,0.16)',
    },
    typeBadgeLabelAudio: {
      color: theme.dark ? '#34D399' : '#0F766E',
    },
    typeBadgeLabelText: {
      color: theme.colors.onSurfaceVariant,
    },
    compactModelName: {
      //fontSize: 16,
      //fontWeight: '600',
      color: theme.colors.onSurface,
      flex: 1,
    },
    sizeInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      marginRight: 8,
    },
    sizeInfoText: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginLeft: 4,
    },
    serverLink: {
      flexDirection: 'row',
      alignItems: 'center',
      marginRight: 8,
    },
    serverLinkText: {
      fontSize: 12,
      color: theme.colors.primary,
      marginLeft: 4,
      textDecorationLine: 'underline',
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    detailsContent: {
      paddingHorizontal: 18,
      paddingBottom: 18,
      gap: 12,
    },
    descriptionContainer: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16, // rounded-2xl
      padding: 12,
    },
    descriptionText: {
      fontSize: 14,
      color: theme.colors.onSurface,
      lineHeight: 20, // leading-relaxed
    },
    technicalDetailsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
    },
    technicalDetailCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16, // rounded-2xl
      padding: 10,
      flex: 1,
      minWidth: '45%', // Approximate 2-column grid
    },
    technicalDetailLabel: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginBottom: 3,
    },
    technicalDetailValue: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.onSurface,
    },
    hfLinkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: theme.colors.surface,
      borderRadius: 16, // rounded-2xl
      borderWidth: 2,
      borderColor: theme.colors.primaryContainer,
    },
    hfLinkContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    hfLinkText: {
      fontSize: 12,
      color: theme.colors.primary,
      marginLeft: 8,
    },
    // Action buttons section
    actionButtonsContainer: {
      paddingHorizontal: 14,
      // 10 → 8：底部留白收 2px，按钮本身高度不变
      paddingBottom: 8,
    },
    actionButtonsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8, // gap-2 equivalent
      // 主按钮占满剩余宽度，两个图标按钮靠右并排
      justifyContent: 'space-between',
    },
    primaryActionButton: {
      // 参考 App：加载按钮占满剩余宽度、浅灰药丸底 + 深色字（不是主色实心）。
      // 玻璃模式下这条 backgroundColor 会被 SurfaceCard 剥掉、改用玻璃；
      // 非玻璃模式仍作为浅灰底回退。
      // ⚠️ 圆角必须是半高：999 会让原生 LiquidGlassView 的
      // convertDpToPx(999)×3.5 远超半高，圆角弧互相重叠成椭圆。
      // 2026-10-29：高度 36 → 44、加 1px 描边，让「加载/卸载」这枚可点选的
      // 按键更醒目、点击区更大（用户要求「按键卡片框加大、更方便点击」）。
      flexGrow: 1,
      flexShrink: 1,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      height: 44,
      // label 的 marginVertical 已被清零（见 ModelCard.tsx），
      // 内容只有一行高，必须让它在 44px 里垂直居中，否则会贴顶偏上。
      justifyContent: 'center',
      backgroundColor: theme.dark
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(125,125,128,0.13)',
    },
    // 加载按钮被 SurfaceCard 玻璃包裹后，里面的 paper <Button> 必须透明，
    // 由外层玻璃提供质感；同时撑满整颗药丸、文字垂直居中。
    primaryActionButtonFill: {
      backgroundColor: 'transparent',
      borderWidth: 0,
      borderColor: 'transparent',
      flex: 1,
      alignSelf: 'stretch',
      height: '100%',
      justifyContent: 'center',
    },
    // 文件名 + 右侧信息图标那一行
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      // 纵向 12 / 6 → 8 / 4：卡片更扁，图标与文字本身尺寸不变
      paddingTop: 8,
      paddingBottom: 4,
    },
    titleText: {
      flex: 1,
      fontSize: 15,
      fontWeight: '700',
    },
    // ℹ️ / ⚙ / 🗑 统一：圆形浅灰底
    // ⚠️ 圆角必须是尺寸的一半（36→18），不能用 999 —— 原生玻璃会把
    // 999 再乘一次屏幕密度，圆角爆炸成椭圆（见 primaryActionButton 注释）。
    titleInfoButton: {
      width: 32,
      height: 32,
      padding: 0,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.dark
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(125,125,128,0.13)',
    },
    // 元信息 chips：大小 · 日期 · 类型
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
      paddingHorizontal: 14,
      // 8 → 6：chip 之间的高度不变，只是底部留白小一点
      paddingBottom: 6,
    },
    metaChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: theme.dark
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(125,125,128,0.13)',
    },
    // 玻璃胶囊版 metaChip：padding 收成和原来一致，radius 由 PillLabel 控制
    metaChipGlass: {
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    metaChipText: {
      fontSize: 11.5,
      color: theme.colors.onSurfaceVariant,
    },
    // 类型 chip 按类别上色：视觉=绿、文本=蓝、投影=琥珀、语音=青。
    // 2026-10-22：背景色改由玻璃胶囊的 tint 提供（见 ModelCard.tsx 的
    // chipTone），这里只保留文字色。
    metaChipVisionText: {
      color: theme.dark ? '#34D399' : '#047857',
    },
    // 文本 = 蓝色玻璃胶囊，文字用同色系深/浅蓝保证在蓝玻璃上可读
    metaChipTextBlue: {
      color: theme.dark ? '#93C5FD' : '#1D4ED8',
    },
    metaChipProjectionText: {
      color: theme.dark ? '#FBBF24' : '#B45309',
    },
    metaChipAudioText: {
      color: theme.dark ? '#2DD4BF' : '#0F766E',
    },
    draftOnlyHint: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 8,
    },
    iconButton: {
      // 圆形浅灰底，和加载按钮同一套语言
      // ⚠️ 圆角必须是尺寸的一半（36→18），不能用 999 —— 原生玻璃会把
      // 999 再乘一次屏幕密度，圆角爆炸成椭圆（见 primaryActionButton 注释）。
      width: 36,
      height: 36,
      padding: 0,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.dark
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(125,125,128,0.13)',
    },
    visionToggleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    visionToggleLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    visionToggleLabel: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.onSurface,
    },
    visionHelpText: {
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
      fontStyle: 'italic',
    },
    projectionModelsContainer: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 12,
    },
    warningButton: {
      paddingVertical: 6,
      paddingHorizontal: 8,
      backgroundColor: theme.colors.errorContainer,
      borderRadius: 6,
      marginTop: 8,
    },
    warningButtonText: {
      fontSize: 12,
      color: theme.colors.onErrorContainer,
      textAlign: 'center',
    },
    storageErrorText: {
      marginHorizontal: 20,
    },
    fullModelNameContainer: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 12,
    },
    fullModelNameLabel: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginBottom: 4,
      fontWeight: '500',
    },
    fullModelNameText: {
      fontSize: 14,
      color: theme.colors.onSurface,
      lineHeight: 20,
    },
  });
