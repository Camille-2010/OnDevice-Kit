import {Animated, Pressable, Text, View} from 'react-native';
import React, {useContext, useEffect, useMemo, useState} from 'react';

import {Icon} from 'react-native-paper';

import {useTheme} from '../../../hooks';
import {L10nContext} from '../../../utils';
import {CloudPlusIcon} from '../../../assets/icons';
import {createStyles} from './styles';
import {motionSpring} from '../../../utils/disableMotion';
import {pillRadius} from '../../../theme/cards';
import {SurfaceCard} from '../../../components/GlassSurface';
import {GlassIconButton} from '../../../components/GlassIconButton';
import {PillLabel} from '../../../components/PillLabel';
import {PressFeedback} from '../../../components/PressFeedback';

/**
 * 「添加模型」FAB 菜单当前是否展开。
 *
 * 为什么是模块级变量而不是 React state：
 * 自定义菜单不拦硬件返回键，返回事件会冒泡到 App 那一层的
 * BackHandler（那里看到 activeTab==='models' 就 switchTab('home')），
 * 于是「菜单开着按返回」变成了「直接回主页」。
 * 试图在 FABGroup 里 addEventListener 抢先处理是**不可靠的** ——
 * 实测祖先组件的监听总是先跑。唯一稳的办法是让 App 那一层能查到
 * 这个标志，查到就先收菜单、不切 Tab。
 */
export let fabMenuOpen = false;
export const setFabMenuOpen = (v: boolean) => {
  fabMenuOpen = v;
};

interface FABGroupProps {
  onAddLocalModel: () => void;
  onAddRemoteModel: () => void;
  onManageServers?: () => void;
  hasServers?: boolean;
}

interface ActionItem {
  testID: string;
  label: string;
  onPress: () => void;
  renderIcon: (color: string) => React.ReactNode;
}

export const FABGroup: React.FC<FABGroupProps> = ({
  onAddLocalModel,
  onAddRemoteModel,
  onManageServers,
  hasServers,
}) => {
  const [open, setOpen] = useState(false);

  // 同步到模块级标志，供 App 的 BackHandler 查询。
  // 放在 effect 里而不是渲染期直接赋值：渲染期写外部变量在并发渲染下不安全。
  useEffect(() => {
    setFabMenuOpen(open);
    // 卸载时清零，否则标志会一直留着，之后按返回都被这里吞掉
    return () => setFabMenuOpen(false);
  }, [open]);
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const styles = createStyles(theme);

  // 数组顺序 = 视觉自上而下（本地 → 远端 → 管理服务器）。
  const actions = useMemo<ActionItem[]>(() => {
    const items: ActionItem[] = [
      {
        testID: 'local-fab',
        label: l10n.models.buttons.addLocalModel,
        onPress: onAddLocalModel,
        renderIcon: (color: string) => (
          <Icon source="folder-plus" size={28} color={color} />
        ),
      },
      {
        testID: 'remote-fab',
        label: l10n.settings.addRemoteModel,
        onPress: onAddRemoteModel,
        renderIcon: (color: string) => (
          <CloudPlusIcon width={28} height={28} stroke={color} />
        ),
      },
    ];
    if (hasServers && onManageServers) {
      items.push({
        testID: 'manage-servers-fab',
        label: l10n.settings.manageServers,
        onPress: onManageServers,
        renderIcon: (color: string) => (
          <Icon source="server-network" size={28} color={color} />
        ),
      });
    }
    return items;
  }, [l10n, onAddLocalModel, onAddRemoteModel, onManageServers, hasServers]);

  // 图标旋转进度：open 0 -> 1。用 spring 而不是 timing，收尾带一点点回弹，
  // 和按钮本身的按压缩放（PressFeedback 内置）形成一个连贯的动作。
  const spin = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    motionSpring(spin, {
      toValue: open ? 1 : 0,
      friction: 8,
      tension: 90,
      useNativeDriver: true,
    }).start();
  }, [open, spin]);

  // 菜单项整体显隐进度。展开时挂载、收起时等动画走完再卸载，
  // 这样出入场都有动画，且收起后不会在无障碍树里留隐藏按钮。
  const progress = React.useRef(new Animated.Value(0)).current;
  const [itemsMounted, setItemsMounted] = useState(false);
  React.useEffect(() => {
    if (open) {
      setItemsMounted(true);
    }
    const anim = motionSpring(progress, {
      toValue: open ? 1 : 0,
      friction: 9,
      tension: 100,
      useNativeDriver: true,
    });
    anim.start(({finished}: {finished: boolean}) => {
      if (finished && !open) {
        setItemsMounted(false);
      }
    });
    return () => anim.stop();
  }, [open, progress]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '135deg'],
  });

  return (
    <View style={styles.container} pointerEvents="box-none" testID="fab-group">
      {/* 展开时的全屏透明背板：点任意处收起菜单（不挡壁纸） */}
      {open ? (
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        />
      ) : null}

      {itemsMounted ? (
        <View style={styles.menu} pointerEvents="box-none">
          {actions.map(item => (
            <Animated.View
              key={item.testID}
              style={[
                styles.actionRow,
                {
                  opacity: progress,
                  transform: [
                    {
                      translateY: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [10, 0],
                      }),
                    },
                  ],
                },
              ]}>
              {/* 标签：玻璃胶囊（与图标钮等高，radius=半高） */}
              <PillLabel radius={24} style={styles.actionLabelGlass}>
                <Text style={styles.actionLabelText}>{item.label}</Text>
              </PillLabel>
              {/* 图标钮：玻璃圆壳 */}
              <GlassIconButton
                testID={item.testID}
                onPress={item.onPress}
                accessibilityLabel={item.label}
                glassStyle={styles.actionIcon}>
                {item.renderIcon(theme.colors.onSurfaceVariant)}
              </GlassIconButton>
            </Animated.View>
          ))}
        </View>
      ) : null}

      {/* 主按钮：液态玻璃模式是玻璃方块；标准模式回退实心底 */}
      <SurfaceCard
        style={styles.fab}
        radius={pillRadius()}
        backdrop="wallpaper">
        <PressFeedback
          testID="fab-toggle"
          onPress={() => setOpen(o => !o)}
          scaleTo={0.9}
          glowOpacity={0.12}
          style={styles.fabHit}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close menu' : 'Open menu'}>
          {/* 展开时整枚图标转 135°：＋ 的旋转过渡让「展开/收起」的
              因果关系一眼就懂（不是硬切图标） */}
          <Animated.View style={[styles.iconWrap, {transform: [{rotate}]}]}>
            <Icon source="plus" size={28} color={theme.colors.onSurface} />
          </Animated.View>
        </PressFeedback>
      </SurfaceCard>
    </View>
  );
};
