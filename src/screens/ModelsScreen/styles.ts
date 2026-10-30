import {StyleSheet} from 'react-native';
import {Theme} from '../../utils/types';
import {PILL_BAR_BOTTOM, PILL_BAR_HEIGHT} from '../../theme/cards';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
    },
    container: {
      flex: 1,
      padding: 2,
      backgroundColor: 'transparent',
    },
    listContainer: {
      paddingBottom: 150,
    },
    /**
     * 「正在复制模型」的悬浮提示。
     * ⚠️ 以前用 Paper 的 Snackbar，它贴在屏幕最底部 —— 正好被悬浮胶囊导航栏
     * （PILL_BAR_HEIGHT=64 + 底部 36）整个盖住，用户完全看不到进度。
     * 现在抬到胶囊栏上方，并且改成和全局一致的玻璃胶囊。
     */
    copyingOverlay: {
      position: 'absolute',
      left: 24,
      right: 24,
      bottom: PILL_BAR_BOTTOM + PILL_BAR_HEIGHT + 16,
      alignItems: 'center',
    },
    copyingPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      height: 44,
      borderRadius: 22,
      paddingHorizontal: 18,
      overflow: 'hidden',
    },
    copyingText: {
      fontSize: 13,
      fontWeight: '500',
    },
    header: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outlineVariant,
    },
    filterContainer: {
      flexDirection: 'row',
      padding: 4,
      gap: 1,
      justifyContent: 'flex-end',
    },
    filterIcon: {
      borderRadius: 8,
      marginHorizontal: 2,
    },
  });
