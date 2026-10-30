import {StyleSheet} from 'react-native';

import {Theme} from '../../../utils/types';
import {uiStore} from '../../../store';
import {
  ADD_BUTTON_SIDE,
  PILL_BAR_BOTTOM,
  PILL_BAR_HEIGHT,
  headerBg,
  pillRadius,
} from '../../../theme/cards';

export const createStyles = (theme: Theme) => {
  const isDark = uiStore.effectiveColorScheme === 'dark';

  return StyleSheet.create({
    // 铺满父容器（ModelsScreen 根 View），自身不吃触摸 ——
    // 只有展开时的 backdrop 和里面的按钮响应，其余区域点击穿透给列表。
    container: {
      ...StyleSheet.absoluteFillObject,
    },
    // 展开时的透明背板：点它收起菜单。
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'transparent',
    },
    // 菜单列：贴在主按钮正上方、右对齐，数组顺序 = 自上而下。
    menu: {
      position: 'absolute',
      right: ADD_BUTTON_SIDE,
      bottom: PILL_BAR_BOTTOM + PILL_BAR_HEIGHT + 12,
      alignItems: 'flex-end',
      gap: 10,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    // 标签玻璃胶囊：和 48px 图标钮严格等高，上下沿齐平。
    // ⚠️ 两个坑：
    // 1. PillLabel 基础样式自带 alignSelf:'flex-start'（顶对齐）——图标钮
    //    放大到 48px 后，34px 高的胶囊会贴在行顶部，文字比图标高出一截。
    //    必须在这里覆盖成 stretch。
    // 2. 圆角必须是高度的一半（24）——原生玻璃会把圆角再乘一次屏幕
    //    密度，传 999 会渲染成椭圆（见 ReactNativeLiquidGlassView）。
    actionLabelGlass: {
      height: 48,
      alignSelf: 'stretch',
      paddingHorizontal: 14,
    },
    actionLabelText: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.onSurface,
    },
    // 图标钮玻璃圆壳：48px → 圆角必须是 24（一半），不能 999
    // （原生玻璃会把圆角再乘一次屏幕密度，999 会渲染成椭圆）。
    actionIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      // 非玻璃模式的浅灰回退底（玻璃模式下会被 SurfaceCard 剥掉）
      backgroundColor: isDark
        ? 'rgba(255,255,255,0.10)'
        : 'rgba(125,125,128,0.13)',
    },
    // 「添加模型」主按钮：贴在屏幕右下角。
    // 高度跟胶囊栏共用 PILL_BAR_HEIGHT，底距共用 PILL_BAR_BOTTOM，
    // 所以两者的上下沿严格对齐、看着是一条线上的。
    // 液态玻璃模式下玻璃质感由 SurfaceCard 提供（backgroundColor 被剥掉），
    // 标准模式用实心底 +  Elevation 回退。
    fab: {
      position: 'absolute',
      right: ADD_BUTTON_SIDE,
      bottom: PILL_BAR_BOTTOM,
      width: PILL_BAR_HEIGHT,
      height: PILL_BAR_HEIGHT,
      // 圆角 = 半径（玻璃模式 pillRadius()=32 → 正圆；标准模式 12）
      borderRadius: pillRadius(),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: headerBg(theme),
      elevation: 8,
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 14,
      shadowOffset: {width: 0, height: 5},
    },
    fabHit: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
};
