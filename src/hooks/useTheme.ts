import {useTheme as usePaperTheme, MD3Theme} from 'react-native-paper';
import {useColorScheme} from 'react-native';

import {uiStore} from '../store';

import {Theme} from '../utils/types';
import {buildTheme} from '../utils/theme';

/**
 * Consumes the active design-system Theme.
 *
 * Reads the selected color scheme and system appearance, language (reactive
 * inside an `observer`), and `usePaperTheme()`. The `usePaperTheme()` call is load-
 * bearing: it subscribes the consumer to Paper's ThemeContext, which is
 * the React-context path that re-renders NON-`observer` consumers (and
 * consumers behind `React.memo` / navigator boundaries) when the provider
 * theme changes. `App` (an `observer`) feeds `useTheme()`'s result to
 * `<PaperProvider theme={...}>`, so a colorScheme/language change updates
 * the provider theme and propagates through context to every consumer.
 *
 * Memoization: built themes are cached in a WeakMap keyed first on the
 * Paper theme identity (so a changed provider theme can never return a
 * stale merge) then on `${mode}:${language}`. This restores referential
 * stability across renders that don't change any of those inputs —
 * important on hot UI surfaces (chat) where downstream `useMemo` deps
 * would otherwise re-fire every render. The WeakMap lets stale Paper-theme
 * buckets be garbage-collected.
 */
const themeCache = new WeakMap<MD3Theme, Map<string, Theme>>();

/** #RRGGBB + 透明度 -> rgba()，给「关键色」派生容器色用 */
const withAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) {
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const useTheme = (): Theme => {
  const paperTheme = usePaperTheme<MD3Theme>();
  const systemColorScheme = useColorScheme();
  const mode =
    uiStore.colorScheme === 'system'
      ? systemColorScheme === 'dark'
        ? 'dark'
        : 'light'
      : uiStore.colorScheme;
  const language = uiStore.language;
  // 关键色参与缓存键：换色时才会重新构建主题，其余情况保持引用稳定
  const keyColor = uiStore.keyColor;
  const key = `${mode}:${language}:${keyColor ?? 'default'}`;

  let byKey = themeCache.get(paperTheme);
  if (byKey === undefined) {
    byKey = new Map();
    themeCache.set(paperTheme, byKey);
  }

  let cached = byKey.get(key);
  if (cached === undefined) {
    let built = {
      ...paperTheme,
      ...buildTheme({mode, language}),
    } as Theme;
    cached = keyColor
      ? {
          ...built,
          colors: {
            ...built.colors,
            // 强调色 = 关键色；选中态的淡底同步派生，保证整条链一致
            secondary: keyColor,
            secondaryContainer: withAlpha(
              keyColor,
              mode === 'dark' ? 0.3 : 0.16,
            ),
          },
        }
      : built;
    byKey.set(key, cached);
  }
  return cached;
};
