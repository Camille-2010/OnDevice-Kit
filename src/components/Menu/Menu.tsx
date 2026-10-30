import React, {useState} from 'react';

import {
  Divider,
  Menu as PaperMenu,
  MenuProps as PaperMenuProps,
} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {uiStore} from '../../store';
import {GlassSurface} from '../GlassSurface';

import {createStyles} from './styles';
import {MenuItem, MenuItemProps} from './MenuItem';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

const Separator = () => {
  const theme = useTheme();
  const styles = createStyles(theme);
  return <Divider style={styles.separator} />;
};

const GroupSeparator = () => {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <PaperMenu.Item
      title=""
      style={[
        styles.groupSeparator,
        {backgroundColor: theme.colors.menuGroupSeparator},
      ]}
      disabled
    />
  );
};

export interface MenuProps extends Omit<PaperMenuProps, 'theme' | 'children'> {
  children?: React.ReactNode;
  selectable?: boolean;
}

export const Menu: React.FC<MenuProps> & {
  Item: typeof MenuItem;
  GroupSeparator: typeof GroupSeparator;
  Separator: typeof Separator;
} = ({children, selectable = false, ...menuProps}) => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [hasActiveSubmenu, setHasActiveSubmenu] = useState(false);
  const statusBarHeight = useSafeAreaInsets().top;

  const handleSubmenuOpen = () => setHasActiveSubmenu(true);
  const handleSubmenuClose = () => setHasActiveSubmenu(false);

  // Guard: don't open menu with no children (prevents PaperMenu layout hang)
  const effectiveVisible =
    menuProps.visible && React.Children.toArray(children).length > 0;
  // 液态玻璃：面板换成真玻璃（paper 的 Surface 底色必须让出来）。
  // uiStore?. 防御：不少单测对 store 模块做部分 mock（不导出 uiStore），
  // 直接读会在任何渲染到 Menu 的组件里抛 undefined.themeStyle。
  const glassOn = uiStore?.themeStyle === 'liquid-glass';

  const items = React.Children.map(children, child => {
    if (!React.isValidElement<MenuItemProps>(child)) {
      return child;
    }

    // Only pass submenu props to MenuItem components, not to Separator or GroupSeparator
    if (child.type === MenuItem) {
      return React.cloneElement(child, {
        onSubmenuOpen: handleSubmenuOpen,
        onSubmenuClose: handleSubmenuClose,
        selectable,
      });
    }

    return child;
  });

  return (
    <PaperMenu
      {...menuProps}
      visible={effectiveVisible}
      style={[
        styles.menu,
        hasActiveSubmenu && styles.menuWithSubmenu,
        glassOn && styles.menuGlass,
        menuProps.style,
      ]}
      statusBarHeight={statusBarHeight}
      contentStyle={[
        styles.content,
        hasActiveSubmenu && styles.contentWithSubmenu,
        glassOn && styles.contentGlass,
      ]}>
      {glassOn ? (
        <GlassSurface radius={12} style={styles.glassPanel}>
          {items}
        </GlassSurface>
      ) : (
        items
      )}
    </PaperMenu>
  );
};

Menu.Item = MenuItem;
Menu.GroupSeparator = GroupSeparator;
Menu.Separator = Separator;
