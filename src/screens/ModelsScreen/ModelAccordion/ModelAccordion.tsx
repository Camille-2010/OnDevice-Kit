import React from 'react';
import {StyleSheet} from 'react-native';

import {List} from 'react-native-paper';
import {observer} from 'mobx-react-lite';

import {useTheme} from '../../../hooks';

import {createStyles} from './styles';
import {SurfaceCard} from '../../../components/GlassSurface';

import {modelStore} from '../../../store';

interface ModelAccordionProps {
  group: any;
  expanded: boolean;
  onPress: () => void;
  children: React.ReactNode;
  description?: string;
  /**
   * 关掉点击反馈（Android 水波纹）。
   *
   * Paper 的 List.Accordion 点击动画只有这一处：内部的 TouchableRipple。
   * 箭头本身没有动画 —— 它只是 chevron-down / chevron-up 换图标（Paper
   * 5.14 的实现，源码里直接 MaterialCommunityIcon，没有旋转动画）。
   * 所以把 rippleColor 设成 transparent 就等于「完全没有点击动画」。
   */
  flatPress?: boolean;
}

export const ModelAccordion: React.FC<ModelAccordionProps> = observer(
  ({group, expanded, onPress, children, description, flatPress}) => {
    const theme = useTheme();
    const {colors} = theme;
    const activeModel = modelStore.activeModel;
    const activeGroup = activeModel && activeModel.type === group.type;
    const styles = createStyles(theme);

    const accordionStyles = StyleSheet.flatten([
      styles.accordion,
      // 透明：真正的玻璃背景由外层 SurfaceCard 提供（大胶囊液态玻璃）。
      {backgroundColor: 'transparent'},
      activeGroup && {
        borderColor: colors.primary,
      },
    ]);

    return (
      <SurfaceCard
        style={[
          styles.accordionWrapper,
          activeGroup && {borderWidth: 1.5, borderColor: colors.primary},
        ]}
        backdrop="wallpaper"
        radius={16}>
        <List.Accordion
          testID={`model-accordion-${group.type}`}
          title={group.type}
          titleStyle={StyleSheet.flatten([
            styles.accordionTitle,
            {color: colors.secondary},
          ])}
          description={description}
          descriptionStyle={styles.accordionDescription}
          expanded={expanded}
          onPress={onPress}
          rippleColor={flatPress ? 'transparent' : undefined}
          theme={{
            ...theme,
            colors: {...theme.colors, background: 'transparent'},
          }}
          style={accordionStyles}>
          {children}
        </List.Accordion>
      </SurfaceCard>
    );
  },
);
