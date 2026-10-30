import React, {useMemo} from 'react';
import {useTheme} from '../../hooks';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {StyleProp, View, ViewStyle} from 'react-native';
import {uiStore} from '../../store';

interface ActionsProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export const Actions = ({children, style}: ActionsProps) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const containerStyle: StyleProp<ViewStyle> = useMemo(() => {
    return {
      flexDirection: 'row',
      justifyContent: 'space-between',
      // 液态玻璃主题下透明：露出弹窗自身的玻璃面板/背景，
      // 不再出现一条不透明的白条压在玻璃上。
      backgroundColor:
        uiStore.themeStyle === 'liquid-glass'
          ? 'transparent'
          : theme.colors.background,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10 + insets.bottom,
      gap: 10,
    };
  }, [theme, insets]);

  return <View style={[containerStyle, style]}>{children}</View>;
};
