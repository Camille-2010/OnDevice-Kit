import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';
import {
  headerBg,
  cardBg,
  cardRadius,
  HEADER_MODULE_SIZE,
  HEADER_TITLE_SIZE,
  HEADER_TITLE_WEIGHT,
  headerBottomRadius,
  headerModuleRadius,
  sectionAccent,
  headerTranslucent,
} from '../../theme/cards';

export const createStyles = (theme: Theme, isRounded: boolean = false) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    container: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 28,
    },
    contentTransition: {
      flex: 1,
    },
    scrollViewContent: {
      paddingVertical: isRounded ? 5 : 16,
      paddingHorizontal: isRounded ? 5 : 16,
    },
    card: {
      marginVertical: isRounded ? 4 : 8,
      borderRadius: cardRadius(),
      backgroundColor: cardBg(theme),
      elevation: 0,
      shadowColor: '#000',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: {width: 0, height: 0},
    },
    cardContent: {
      paddingVertical: isRounded ? 10 : 14,
      paddingHorizontal: isRounded ? 10 : 16,
    },
    cardContentExpanded: {
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    /* 「文本转语音」二级页专用：卡片放大，只在这一页用，不影响其它页面。 */
    speechCardContent: {
      paddingVertical: isRounded ? 28 : 24,
      paddingHorizontal: isRounded ? 20 : 18,
    },
    /* 内层那一行归零，避免和上面的 padding 叠加后反而算不清 */
    speechItemContainer: {
      marginVertical: 0,
    },
    /* 主题模式那三个选项所在的卡片：去掉灰底，只留里面的方格 */
    cardTransparent: {
      backgroundColor: 'transparent',
      marginVertical: 0,
    },
    /* 主题模式卡片的内部留白：左右归零让方格撑满整宽（和上下卡片对齐），
       顶部归零让它整体往上靠，底部留一点和下面小字拉开 */
    themeModeCardContent: {
      paddingTop: 0,
      paddingBottom: 12,
      paddingHorizontal: 0,
    },
    /* 「外观与个性化」下面那张卡片：行距和上下留白都收紧，整体更扁 */
    switchContainerCompact: {
      marginVertical: 6,
    },
    cardContentCompact: {
      paddingVertical: 4,
      paddingHorizontal: 16,
    },
    /* 「外观与个性化」这行小字：和上下两张卡片拉开距离（只用于主题二级页） */
    groupTitleSpaced: {
      marginTop: 20,
      marginBottom: 10,
    },
    switchContainerExpanded: {
      marginVertical: 14,
    },
    groupTitle: {
      fontSize: isRounded ? 16 : 17,
      color: theme.colors.onSurface,
      fontWeight: '700',
      // 去掉不对称的上下 margin：在 flexDirection:row + alignItems:center 的
      // groupHeading 里，这些垂直 margin 会把文字整体下推 ~4dp，导致蓝杠
      // 中心比文字中心偏高。间距改由 groupHeading 的 margin 统一负责。
      // includeFontPadding:false + lineHeight 让行盒贴合字形，蓝杠精确居中。
      lineHeight: isRounded ? 22 : 23,
      includeFontPadding: false,
    },
    groupHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: isRounded ? 10 : 22,
      marginBottom: isRounded ? 4 : 10,
      paddingLeft: 1,
    },
    groupMarker: {
      width: 4,
      height: isRounded ? 18 : 15,
      borderRadius: 2,
      backgroundColor: sectionAccent(),
      marginRight: 8,
    },
    /* 液态玻璃下的「小标题」玻璃胶囊：和上下的大玻璃卡片拉开足够间距，
       否则两块玻璃会糊成一片、分不清层级（用户明确要求不要挨太近）。
       只在液态玻璃下使用（由 SettingsScreen 的 renderGroupTitle 控制）。 */
    glassSectionTitle: {
      marginTop: 18,
      marginBottom: 14,
      marginLeft: 2,
    },
    /* 卡片内的小标题玻璃胶囊：比卡片之间的大标题更紧凑，避免把控件挤散 */
    glassSectionLabel: {
      marginTop: 14,
      marginBottom: 8,
      marginLeft: 2,
      alignSelf: 'flex-start',
    },
    glassSectionTitleText: {
      fontSize: isRounded ? 14 : 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
      includeFontPadding: false,
      lineHeight: isRounded ? 20 : 21,
    },
    /* 玻璃胶囊内的「蓝杠」：保留原来小标题前面的蓝色光标（关键色），
       只是从卡片外挪到胶囊里，避免换成胶囊后把那道蓝杠丢掉了 */
    glassSectionTitleInner: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    glassSectionTitleMarker: {
      width: 4,
      height: isRounded ? 13 : 14,
      borderRadius: 2,
      backgroundColor: sectionAccent(),
      marginRight: 7,
    },
    settingsGroup: {
      borderRadius: cardRadius(),
      paddingHorizontal: 14,
      backgroundColor: cardBg(theme),
      overflow: 'hidden',
      marginBottom: 2,
    },
    groupDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.outlineVariant,
      marginLeft: 54,
    },
    accountCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      paddingHorizontal: 18,
      paddingVertical: 18,
      marginBottom: 6,
    },
    accountAvatar: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: theme.colors.secondaryContainer,
      alignItems: 'center',
      justifyContent: 'center',
    },
    accountTextWrap: {
      flex: 1,
      marginLeft: 12,
    },
    accountName: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    accountMeta: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    settingItemContainer: {
      marginVertical: isRounded ? 5 : 7,
    },
    /* 「模型初始化设置」二级页专用：每个选项之间留更大一点的间隔。
       这些选项原先共用上面的 settingItemContainer —— 而它在圆角主题下
       marginVertical 是 0，各选项会直接粘在一起。这页选项最多（设备、
       上下文长度，展开高级设置后还有一批滑块），每条又都带输入框或
       小字说明，挤在一起不好读，所以单独给一档更松的间距。
       只作用于这一页，其它二级页不受影响。 */
    modelInitItemContainer: {
      marginVertical: isRounded ? 10 : 13,
    },
    /* 同上：选项内部「小字说明」和它上方控件之间的距离也拉开一点点。
       注意颜色要一并带过来 —— 这个样式是整体替换 textDescription 的，
       漏掉 color 会退回默认的深色文字。 */
    modelInitDescription: {
      color: theme.colors.onSurfaceVariant,
      marginTop: isRounded ? 6 : 6,
    },
    /* 「模型初始化设置」页：页面内那两处重复标题去掉后，把卡片自己的
       上边距也收掉，内容整体再往上顶一点 */
    modelInitCard: {
      marginTop: 0,
    },
    /* 同页：文字整体往右挪一点点（左边多留 6dp，右边保持原样） */
    modelInitCardContent: {
      paddingVertical: isRounded ? 10 : 14,
      paddingLeft: isRounded ? 12 : 22,
      paddingRight: isRounded ? 6 : 16,
    },
    switchContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginVertical: isRounded ? 5 : 7,
    },
    textContainer: {
      flex: 1,
      marginRight: 16,
    },
    labelWithIconContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: isRounded ? 4 : 4,
    },
    settingIcon: {
      // 这里千万别写死宽高：行内图标 size 是 17~20，写死 14 会把图标裁掉
      //（「关键色」的调色盘之前只画出左上角，就是这个原因）
      marginRight: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    textLabel: {
      color: theme.colors.onSurface,
      fontSize: 18,
      fontWeight: '700',
    },
    textDescription: {
      color: theme.colors.onSurfaceVariant,
      marginTop: isRounded ? 4 : 4,
    },
    /* 账户页「令牌安全与合规须知」卡片里的多段说明文字 */
    complianceText: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 13,
      lineHeight: 20,
      marginBottom: 10,
    },
    /* 合规卡片底部「前往令牌管理页」按钮 */
    complianceAction: {
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    divider: {
      marginVertical: 12,
    },
    slider: {
      //marginVertical: 8,
      //height: 40,
    },
    textInput: {
      marginVertical: 8,
    },
    invalidInput: {
      borderColor: theme.colors.error,
      borderWidth: 1,
    },
    errorText: {
      color: theme.colors.error,
      marginTop: 4,
    },
    // Cap the value side of a settings row so a long value label ellipsizes
    // inside the button instead of squeezing the flex title/description
    // column into a sliver.
    menuContainer: {
      position: 'relative',
      flexShrink: 1,
      maxWidth: '55%',
    },
    menuButton: {
      minWidth: 100,
      maxWidth: '100%',
    },
    // A control too wide to share its row (e.g. the draft-model picker, whose
    // values are model filenames) sits under the title/description instead.
    // Also keeps the menu anchor at the row's left edge, on-screen.
    fullRowControl: {
      marginTop: 8,
      alignSelf: 'flex-start',
      maxWidth: '100%',
    },
    consentContainer: {
      marginVertical: 8,
    },
    consentButton: {
      alignSelf: 'flex-end',
      marginTop: 12,
    },
    buttonContent: {
      flexDirection: 'row-reverse',
      justifyContent: 'space-between',
    },
    advancedSettingsButton: {
      marginVertical: 8,
    },
    advancedSettingsContent: {
      marginTop: 8,
    },
    advancedAccordion: {
      height: 55,
      //backgroundColor: theme.colors.surface,
    },
    accordionTitle: {
      fontSize: 14,
      color: theme.colors.secondary,
    },
    // Floor, not a fixed width: dropdown items size to their longest label
    // (the outer menu clamps at 90% screen and item titles ellipsize past it).
    menu: {
      minWidth: 170,
    },
    linkContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
    },
    linkIcon: {
      marginLeft: 4,
    },
    segmentedButtons: {
      marginVertical: isRounded ? 8 : 8,
    },
    segmentedSettingContainer: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    segmentedSettingTextContainer: {
      width: '100%',
      marginRight: 0,
      marginBottom: 8,
      flexGrow: 0,
      flexShrink: 1,
    },
    segmentedSettingControl: {
      width: '100%',
    },
    segOuterBox: {
      // 去掉外框：黑边在玻璃卡片上会显出一道黑杠，靠选中胶囊本身区分即可
      borderRadius: 12,
      padding: 4,
      flexDirection: 'row',
    },
    segBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      // 预留 1px 边框位：选中态只换 borderColor，避免出现 1px 位移
      borderWidth: 1,
      borderColor: 'transparent',
    },
    segBtnActive: {
      // 选中态：只保留柔和的强调底色胶囊（不描边，蓝框在液态玻璃上太突兀）
      backgroundColor: theme.colors.secondaryContainer,
    },
    segBtnText: {
      fontSize: 14,
      color: theme.colors.onSurfaceVariant,
      // Android 默认 includeFontPadding:true 会在文字上方多留一段 ascent
      // 空白，使字形在垂直居中的框里偏上（用户反馈“那三个文字有点靠上了”）。
      // 关掉 font padding + 固定行高，让字形在 segBtn 里真正垂直居中。
      includeFontPadding: false,
      textAlignVertical: 'center',
      lineHeight: 20,
    },
    segBtnTextActive: {
      color: theme.colors.secondary,
      fontWeight: '700',
    },
    /* 二级页顶部栏：与主屏幕顶部栏完全一致（浅灰底 + 左对齐大标题）
       高度由 SettingsScreen 里的内联样式补上状态栏高度 + HEADER_EXTRA */
    subHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      backgroundColor: headerTranslucent(theme, headerBg(theme)),
      borderBottomLeftRadius: headerBottomRadius(),
      borderBottomRightRadius: headerBottomRadius(),
      overflow: 'hidden',
    },
    subHeaderBack: {
      width: HEADER_MODULE_SIZE,
      height: HEADER_MODULE_SIZE,
      borderRadius: headerModuleRadius(),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.outlineVariant,
      backgroundColor: theme.colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    subHeaderTitle: {
      flex: 1,
      fontSize: HEADER_TITLE_SIZE,
      fontWeight: HEADER_TITLE_WEIGHT,
      color: theme.colors.onSurface,
    },
    subHeaderSpacer: {
      width: HEADER_MODULE_SIZE,
    },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: isRounded ? 56 : 76,
      paddingHorizontal: 2,
      paddingVertical: isRounded ? 8 : 13,
    },
    entryIcon: {
      width: 44,
      height: 44,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.secondaryContainer,
    },
    // BAVoice 风格：设置页一级入口用纯线条图标（无色块底）
    entryIconPlain: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 2,
    },
    entryTextWrap: {
      flex: 1,
      marginLeft: 12,
      minWidth: 0,
    },
    entryTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    entryValue: {
      fontSize: 13,
      color: theme.colors.onSurfaceVariant,
      marginLeft: 6,
      flexShrink: 0,
      maxWidth: 220,
    },
    descBarWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 2,
    },
    descBar: {
      width: 3,
      height: 12,
      borderRadius: 2,
      backgroundColor: theme.colors.secondary,
      marginRight: 6,
    },
    entryDesc: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    detailIntro: {
      backgroundColor: cardBg(theme),
      borderRadius: cardRadius(),
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 10,
    },
    detailIntroText: {
      fontSize: 13,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 18,
    },
    detailHeading: {
      fontSize: 28,
      lineHeight: 36,
      color: theme.colors.onSurface,
      fontWeight: '700',
      marginTop: 8,
      marginBottom: 18,
      marginLeft: 4,
    },
    /* 主题页大标题「主题」玻璃化：液态玻璃下是玻璃胶囊，其余风格保持原样大标题 */
    glassPageTitle: {
      marginTop: 8,
      marginBottom: 18,
      marginLeft: 4,
    },
    glassPageTitleText: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.onSurface,
      includeFontPadding: false,
    },
    themePreview: {
      borderWidth: 1,
      borderRadius: 26,
      padding: 14,
      height: 206,
      marginBottom: 28,
      justifyContent: 'space-between',
    },
    themePreviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    themePreviewBrand: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    themePreviewBrandMark: {
      width: 22,
      height: 22,
      borderRadius: 6,
      marginRight: 7,
    },
    glassStyleDescription: {
      width: '100%',
      color: theme.colors.onSurfaceVariant,
      marginTop: 4,
      lineHeight: 16,
    },
    themePreviewBrandText: {
      fontSize: 13,
      fontWeight: '700',
    },
    themePreviewMain: {
      flexDirection: 'row',
      gap: 9,
      flex: 1,
      marginTop: 12,
    },
    themePreviewCard: {
      flex: 1,
      borderRadius: 16,
      padding: 12,
      justifyContent: 'space-between',
    },
    themePreviewCardTop: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    themePreviewAvatar: {
      width: 32,
      height: 32,
      borderRadius: 11,
    },
    themePreviewLines: {
      flex: 1,
      marginLeft: 8,
      gap: 6,
    },
    themePreviewLine: {
      height: 6,
      borderRadius: 3,
      width: '75%',
      opacity: 0.8,
    },
    themePreviewLineShort: {
      height: 5,
      borderRadius: 3,
      width: '52%',
      opacity: 0.65,
    },
    themePreviewWideLine: {
      height: 34,
      borderRadius: 10,
      opacity: 0.72,
    },
    themePreviewButton: {
      height: 20,
      width: '58%',
      borderRadius: 10,
    },
    themePreviewSideCard: {
      width: '29%',
      borderRadius: 16,
      padding: 10,
      justifyContent: 'center',
      gap: 12,
    },
    themePreviewSideLine: {
      height: 8,
      borderRadius: 4,
    },

    /* 界面风格：右侧当前值 */
    styleValueWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      marginLeft: 12,
    },
    styleValueText: {
      color: theme.colors.onSurfaceVariant,
      marginRight: 6,
    },
    /* 关键色：右侧当前值 + 小色点 */
    keyColorValueWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      marginLeft: 12,
    },
    keyColorDot: {
      width: 16,
      height: 16,
      borderRadius: 8,
      marginRight: 6,
    },
    keyColorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    keyColorSwatch: {
      width: 22,
      height: 22,
      borderRadius: 11,
      marginRight: 10,
    },
    /* 界面风格选择器（点击后弹出的浮动面板） */
    sheetOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15,23,42,0.45)',
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
      paddingBottom: 28,
    },
    sheetCard: {
      backgroundColor: cardBg(theme),
      borderRadius: 22,
      paddingVertical: 14,
      paddingHorizontal: 12,
    },
    sheetTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: theme.colors.onSurfaceVariant,
      paddingHorizontal: 8,
      paddingBottom: 8,
    },
    sheetItem: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    sheetItemActive: {
      backgroundColor: theme.dark
        ? 'rgba(255,255,255,0.06)'
        : 'rgba(41,124,242,0.08)',
    },
    sheetItemTextWrap: {
      flex: 1,
    },
    sheetItemTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.colors.onSurface,
    },
    sheetItemDesc: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 3,
      lineHeight: 16,
    },

    /* 界面语言选择器：贴在「界面语言」那行下拉箭头正下方的小面板 */
    langSheetOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15,23,42,0.35)',
    },
    langSheet: {
      position: 'absolute',
      width: 210,
      maxHeight: 280,
    },
    // 面板本体：非玻璃模式用 cardBg 实底；玻璃模式下 SurfaceCard 会剥掉底色换真玻璃
    langSheetSurface: {
      backgroundColor: cardBg(theme),
      borderRadius: 16,
      paddingVertical: 5,
      paddingHorizontal: 4,
      overflow: 'hidden',
      flexShrink: 1,
    },
    // 语言列表可翻页：高度跟着内容走，超过 langSheet 的 maxHeight 就内部滚动
    langSheetScroll: {
      flexGrow: 0,
      flexShrink: 1,
    },
    langItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderRadius: 12,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    langItemLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    // 划动时出现在列表右侧的细指示标
    langIndicator: {
      position: 'absolute',
      right: 1,
      top: 5,
      width: 3,
      borderRadius: 2,
      backgroundColor: theme.dark
        ? 'rgba(236,239,244,0.32)'
        : 'rgba(11,12,17,0.28)',
    },

    // 页面背景：缩略图横排 + 当前效果大图
    bgThumbRow: {
      paddingVertical: 4,
      gap: 10,
      paddingRight: 4,
    },
    bgThumbCard: {
      width: 96,
      height: 128,
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.colors.outlineVariant,
      position: 'relative',
    },
    bgThumb: {
      width: '100%',
      height: '100%',
    },
    bgThumbCheck: {
      position: 'absolute',
      right: 6,
      top: 6,
      width: 20,
      height: 20,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 当前效果预览：固定高度外框 + 内部图片 cover 铺满（与首页效果一致，
    // 既不露白也不异常裁切；高度由 JS 按屏幕比例计算后注入）
    bgEffectWrap: {
      width: '100%',
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: theme.dark
        ? 'rgba(255,255,255,0.06)'
        : 'rgba(17,24,39,0.04)',
    },
    bgEffectImg: {
      width: '100%',
      height: '100%',
    },
  });
