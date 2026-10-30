import React, {useRef} from 'react';
import {StyleSheet, TouchableOpacity, Animated} from 'react-native';
import {AppIcon} from './AppIcon';

import {useTheme} from '../hooks';
import {motionSpring} from '../utils/disableMotion';
import {
  headerBg,
  HEADER_ICON_SIZE,
  HEADER_MODULE_SIZE,
  headerModuleRadius,
  headerTranslucent,
} from '../theme/cards';

interface Props {
  onPress: () => void;
  /** 图标大小，默认用全局 HEADER_ICON_SIZE；个别页面可以传小一点 */
  iconSize?: number;
}

export const BackButton: React.FC<Props> = ({onPress, iconSize}) => {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    motionSpring(scale, {toValue: 0.85, useNativeDriver: true}).start();
  };
  const onPressOut = () => {
    motionSpring(scale, {toValue: 1, useNativeDriver: true}).start();
  };

  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="返回">
      <Animated.View
        style={[
          styles.inner,
          {
            backgroundColor: headerTranslucent(theme, headerBg(theme)),
            borderColor: theme.colors.outlineVariant,
            borderRadius: headerModuleRadius(),
            transform: [{scale}],
          },
        ]}>
        <AppIcon
          name="back"
          size={iconSize ?? HEADER_ICON_SIZE + 2}
          color={theme.colors.onSurface}
          strokeWidth={2}
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  btn: {
    width: HEADER_MODULE_SIZE,
    height: HEADER_MODULE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  inner: {
    width: HEADER_MODULE_SIZE,
    height: HEADER_MODULE_SIZE,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
