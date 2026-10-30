import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import {motionTiming} from '../utils/disableMotion';
import {SurfaceCard} from './GlassSurface';
import {useTheme} from '../hooks';
import {dialogGlassTint} from '../theme/cards';

const {width: SCREEN_W} = Dimensions.get('window');

interface PopoverProps {
  visible: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<View>;
  anchorPosition?: {top: number; right: number};
  children: React.ReactNode;
  popoverWidth?: number;
}

export const Popover: React.FC<PopoverProps> = ({
  visible,
  onClose,
  anchorRef,
  anchorPosition,
  children,
  popoverWidth = 200,
}) => {
  const [pos, setPos] = useState<{x: number; y: number}>({x: 0, y: 0});
  const [renderModal, setRenderModal] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const theme = useTheme();

  useEffect(() => {
    if (visible) {
      // 展开：先渲染 Modal，再播动画
      setRenderModal(true);
      if (anchorPosition) {
        setPos({
          x: SCREEN_W - anchorPosition.right - popoverWidth,
          y: anchorPosition.top - 47,
        });
      } else if (anchorRef?.current) {
        anchorRef.current.measureInWindow((x, y) => {
          setPos({x, y});
        });
      }
      motionTiming(anim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      // 收起：先播动画，完成后再卸载 Modal
      motionTiming(anim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setRenderModal(false);
      });
    }
  }, [visible, anchorRef, anchorPosition, anim, popoverWidth]);

  if (!renderModal) return null;

  const popX = Math.min(Math.max(pos.x, 8), SCREEN_W - popoverWidth - 8);
  const popY = pos.y;

  return (
    <Modal
      transparent
      visible={renderModal}
      animationType="none"
      onRequestClose={onClose}>
      <Pressable style={styles.mask} onPress={onClose} />
      <Animated.View
        style={[
          styles.popover,
          {
            left: popX,
            top: popY,
            width: popoverWidth,
            opacity: anim,
            transform: [
              {
                scale: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.8, 1],
                }),
              },
            ],
          },
        ]}>
        <SurfaceCard
          style={styles.popoverSurface}
          glassType="regular"
          tint={dialogGlassTint(theme)}
          tintOpacity={0.34}
          blur
          blurAmount={40}
          blurRounds={4}
          forceFrosted>
          {children}
        </SurfaceCard>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  mask: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  popover: {
    position: 'absolute',
  },
  // 面板本体：非玻璃模式白底 + 细边；玻璃模式下 SurfaceCard 会剥掉底色换真玻璃
  popoverSurface: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
});
