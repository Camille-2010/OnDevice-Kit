import {StyleSheet} from 'react-native';

import {Theme} from '../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {},
    label: {
      color: theme.colors.onSurface,
      // 标题和下面的滑块之间留一点缝。原来完全贴在一起（没有 marginBottom），
      // 设置页「高级设置」里一连串滑块叠着看特别挤。
      marginBottom: 6,
    },
    description: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 4,
      marginBottom: 8,
    },
    controlRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    sliderContainer: {
      flex: 1,
      marginRight: 8,
    },
    slider: {},
    textInput: {},
    disabledTextInput: {
      opacity: 0.7,
      backgroundColor: theme.colors.surfaceDisabled,
    },
    rangeContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    rangeLabel: {
      ...theme.fonts.bodySmall,
      color: theme.colors.onSurfaceVariant,
    },
    disabledText: {
      color: theme.colors.onSurfaceDisabled,
    },
  });
