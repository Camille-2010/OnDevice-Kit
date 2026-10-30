import {StyleSheet} from 'react-native';
import {EdgeInsets} from 'react-native-safe-area-context';
import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme, insets: EdgeInsets) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: 'transparent',
    },
    container: {
      flexGrow: 1,
      padding: theme.spacing.default,
      paddingBottom: theme.spacing.default + insets.bottom,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borders.default,
      overflow: 'hidden',
      shadowColor: theme.colors.shadow,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    header: {
      padding: theme.spacing.default * 2,
      backgroundColor: theme.colors.surfaceContainerHighest,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.surfaceVariant,
    },
    headerContent: {
      gap: theme.spacing.default,
    },
    title: {
      ...theme.fonts.headlineLarge,
      color: theme.colors.onSurface,
      marginBottom: theme.spacing.default / 2,
      letterSpacing: -0.5,
    },
    description: {
      color: theme.colors.onSurfaceVariant,
      marginBottom: theme.spacing.default,
      lineHeight: 24,
    },
    versionContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.default / 2,
    },
    versionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceContainerHigh,
      paddingHorizontal: theme.spacing.default,
      paddingVertical: theme.spacing.default / 2,
      borderRadius: theme.borders.default,
      gap: theme.spacing.default / 2,
      borderWidth: 1,
      borderColor: theme.colors.surfaceVariant,
    },
    versionText: {
      ...theme.fonts.bodyMedium,
      color: theme.colors.onSurface,
    },
    llamaBuildText: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
      marginTop: theme.spacing.default / 2,
      opacity: 0.7,
    },
    section: {
      padding: theme.spacing.default * 2,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.surfaceVariant,
    },
    sectionTitle: {
      ...theme.fonts.titleMedium,
      color: theme.colors.onSurface,
      marginBottom: theme.spacing.default,
    },
    actionButton: {
      borderWidth: 1,
      borderColor: theme.colors.surfaceVariant,
    },
    // GitHub Star 主操作：填充玻璃更醒目，略加高
    starButton: {
      paddingVertical: 6,
    },
    glassInput: {
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: theme.colors.background,
    },
    glassInputText: {
      ...theme.fonts.bodyMedium,
      color: theme.colors.onSurface,
    },
    orText: {
      ...theme.fonts.bodyMedium,
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      marginVertical: theme.spacing.default,
      opacity: 0.7,
    },
    feedbackButtonContent: {
      flexDirection: 'row-reverse',
    },
    feedbackForm: {
      padding: theme.spacing.default,
    },
    field: {
      marginBottom: theme.spacing.default,
    },
    label: {
      ...theme.fonts.labelMedium,
      color: theme.colors.onSurface,
      marginBottom: theme.spacing.default / 2,
    },
    segmentedButtons: {
      marginTop: theme.spacing.default / 2,
    },
    submitButton: {
      marginTop: theme.spacing.default,
    },
    secondaryButtons: {
      flexDirection: 'row',
    },
    legalRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: theme.spacing.default * 1.5,
      gap: theme.spacing.default / 2,
    },
    legalLink: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
    },
    legalSeparator: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
      opacity: 0.5,
    },
    /* ---- 文字套液态玻璃胶囊（PillLabel）---- */
    // 整段说明：铺满宽度、上下留白
    textPill: {
      alignSelf: 'stretch',
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    pillGap: {
      marginBottom: 10,
    },
    // 胶囊内的说明正文（flex:1 才会在胶囊宽度内换行）
    pillText: {
      flex: 1,
      color: theme.colors.onSurfaceVariant,
      lineHeight: 22,
    },
    // 胶囊内的小字（版本号等）
    pillSmallText: {
      flex: 1,
      color: theme.colors.onSurfaceVariant,
      fontSize: 12,
      opacity: 0.75,
    },
    // 小节标题做成小 chip
    chipPill: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
      paddingHorizontal: 10,
    },
    pillTitle: {
      color: theme.colors.onSurface,
      fontSize: 16,
      fontWeight: '700',
    },
    // 居中的「或通过」胶囊
    centerPill: {
      alignSelf: 'stretch',
      justifyContent: 'center',
      paddingVertical: 8,
    },
    pillOrText: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
      opacity: 0.7,
    },
    // 底部隐私/条款：整行居中
    legalPill: {
      alignSelf: 'stretch',
      justifyContent: 'center',
      paddingVertical: 8,
    },
  });
