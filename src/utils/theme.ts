import {
  MD3DarkTheme,
  DefaultTheme as PaperLightTheme,
  configureFonts,
} from 'react-native-paper';

import {Theme} from './types';
import {
  type Mode,
  resolveTokens,
  resolveTypographyForLocale,
} from '../theme/tokens';
import {type AvailableLanguage} from '../locales';

// Theme mode is resolved from the selected color scheme before reaching the
// builder, so the token layer only handles concrete light/dark modes.

/**
 * Legacy Inter weight map. Preserved verbatim — `ChatInput/styles.ts`
 * still imports `fontStyles` directly; the export will be removed in a
 * later cleanup phase once consumers migrate to `theme.typography.*`.
 */
export const fontStyles = {
  regular: {fontFamily: 'Inter-Regular'},
  medium: {fontFamily: 'Inter-Medium'},
  bold: {fontFamily: 'Inter-Bold'},
  thin: {fontFamily: 'Inter-Thin'},
  light: {fontFamily: 'Inter-Light'},
  semibold: {fontFamily: 'Inter-SemiBold'},
  extraBold: {fontFamily: 'Inter-ExtraBold'},
};

const baseFontVariants = configureFonts({
  config: {...fontStyles.regular},
});

const customVariants = {
  // Add custom variants:
  bold: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.bold,
  },
  medium: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.medium,
  },
  thin: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.thin,
  },
  light: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.light,
  },
  semibold: {
    ...baseFontVariants.bodyMedium,
    ...fontStyles.semibold,
  },
} as const;

const configuredFonts = configureFonts({
  config: {
    ...baseFontVariants,
    ...customVariants,
    displayMedium: {
      ...baseFontVariants.displayMedium,
      ...fontStyles.bold,
    },
    titleSmall: {
      ...baseFontVariants.titleSmall,
      ...fontStyles.medium,
    },
  },
});

/**
 * Build a Theme for a given (mode, language) pair.
 *
 * `mode` selects the token binding (light vs dark). `language` selects the
 * locale-aware typography surface (Fraunces → Inter for non-Latin scripts).
 *
 * The output is a superset:
 *   - `colors`: every MD3 key Paper expects, sourced from the tokens
 *     module (values copied verbatim from today's createBaseColors +
 *     createSemanticColors output).
 *   - `typography`, `radius`, `stroke`: new surface — what later
 *     per-screen restyle work migrates consumers to.
 *   - `fonts`, `spacing.default`, `borders`, `insets`, `icons`: legacy
 *     surface preserved verbatim — pinned to today's values so the ~18
 *     MD3-typescale consumers + 4 spacing.default consumers continue to
 *     render unchanged.
 *   - Non-color/non-font Paper internals (`isV3`, `dark`, `roundness`,
 *     `animation`): inherited via `...baseTheme` spread.
 *
 * The two surfaces do NOT cross-feed: the legacy `fonts` block is
 * constructed from `configureFonts(...)` exactly as today, NOT derived
 * from `theme.typography.*`.
 */
export const buildTheme = ({
  mode,
  language,
}: {
  mode: Mode;
  language: AvailableLanguage;
}): Theme => {
  const baseTheme = mode === 'dark' ? MD3DarkTheme : PaperLightTheme;
  const tokens = resolveTokens(mode);
  const localeTypography = resolveTypographyForLocale(language);

  return {
    ...baseTheme,
    colors: {
      // Keep any Paper-internal keys (e.g. elevation tints) the tokens
      // module doesn't explicitly enumerate.
      ...baseTheme.colors,
      // Token-resolved color surface — same values as today's
      // createBaseColors + createSemanticColors output.
      ...tokens.colors,
    },
    borders: {
      // 参考 App 的视觉：全圆角。消息气泡 / 输入框统一用 20 的胶囊级圆角，
      // 其他卡片类元素 14。直角在这些地方一律不再出现。
      inputBorderRadius: 22,
      // 2026-10-27：用户要求气泡「角都变圆」——从 20 提到 24，
      // 单行消息接近胶囊、多行消息四角也明显更圆。
      messageBorderRadius: 24,
      default: 14,
    },
    // Legacy fonts surface — preserved VERBATIM.
    // Components that read `theme.fonts.bodyMedium`, `theme.fonts.titleSmall`,
    // `theme.fonts.titleMediumLight`, etc., see the exact same shape and
    // values as before this slice.
    fonts: {
      ...baseTheme.fonts,
      ...configuredFonts,
      titleMediumLight: {
        ...fontStyles.regular,
        fontSize: 16,
        lineHeight: 22,
      },
      dateDividerTextStyle: {
        ...fontStyles.extraBold,
        color: tokens.colors.onSurface,
        fontSize: 12,
        lineHeight: 16,
        opacity: 0.4,
      },
      emptyChatPlaceholderTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 16,
        lineHeight: 24,
        ...fontStyles.medium,
      },
      inputTextStyle: {
        fontSize: 16,
        lineHeight: 24,
        ...fontStyles.medium,
      },
      // 2026-10-20 气泡改版：用户气泡深青底(#1D6E75)白字，
      // 助手气泡浅灰底深字。与 Message/styles.ts 的 BUBBLE_* 保持一致。
      receivedMessageBodyTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 16,
        lineHeight: 24,
        ...fontStyles.medium,
      },
      receivedMessageCaptionTextStyle: {
        color: tokens.colors.onSurfaceVariant,
        fontSize: 12,
        lineHeight: 16,
        ...fontStyles.medium,
      },
      receivedMessageLinkDescriptionTextStyle: {
        color: tokens.colors.onSurfaceVariant,
        fontSize: 14,
        lineHeight: 20,
        ...fontStyles.regular,
      },
      receivedMessageLinkTitleTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 16,
        lineHeight: 22,
        ...fontStyles.extraBold,
      },
      sentMessageBodyTextStyle: {
        color: '#FFFFFF',
        fontSize: 16,
        lineHeight: 24,
        ...fontStyles.medium,
      },
      sentMessageCaptionTextStyle: {
        color: 'rgba(255,255,255,0.72)',
        fontSize: 12,
        lineHeight: 16,
        ...fontStyles.medium,
      },
      sentMessageLinkDescriptionTextStyle: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 14,
        lineHeight: 20,
        ...fontStyles.regular,
      },
      sentMessageLinkTitleTextStyle: {
        color: '#FFFFFF',
        fontSize: 16,
        lineHeight: 22,
        ...fontStyles.extraBold,
      },
      userAvatarTextStyle: {
        color: tokens.colors.onSurface,
        fontSize: 12,
        lineHeight: 16,
        ...fontStyles.extraBold,
      },
      userNameTextStyle: {
        fontSize: 12,
        lineHeight: 16,
        ...fontStyles.extraBold,
      },
    },
    insets: {
      messageInsetsHorizontal: 20,
      messageInsetsVertical: 10,
    },
    // Spacing is the token scale + the legacy `default` key.
    // `default === spacing.m === 16` matches today's `theme.spacing.default`.
    spacing: {
      ...tokens.spacing,
      default: 16,
    },
    radius: tokens.radius,
    stroke: tokens.stroke,
    typography: localeTypography,
    icons: {},
  };
};

// En-locale snapshot exports — used by jest fixtures and any non-React
// caller that doesn't have access to `useTheme()`. Locale-swapped values
// are only observable via the hook.
export const lightTheme = buildTheme({mode: 'light', language: 'en'});
export const darkTheme = buildTheme({mode: 'dark', language: 'en'});
