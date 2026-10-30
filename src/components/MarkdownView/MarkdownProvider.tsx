import React, {useMemo} from 'react';

import {
  RenderHTMLConfigProvider,
  TRenderEngineProvider,
  defaultSystemFonts,
} from 'react-native-render-html';

import {useTheme} from '../../hooks';

import {CodeRenderer} from './CodeRenderer';
import {createTagsStyles} from './styles';
import {tableHTMLElementModels, tableRenderers} from './TableRenderers';

/**
 * Hosts the heavy parts of react-native-render-html once for the app:
 *
 * - `TRenderEngineProvider` owns the parser + style engine
 *   (tagsStyles, customHTMLElementModels, systemFonts). Rebuilds only
 *   when theme changes — NOT on every token during streaming.
 * - `RenderHTMLConfigProvider` owns the per-tag renderer overrides and
 *   default text props. Stable across the app lifetime.
 *
 * Components that render markdown should sit under this provider and
 * use `<RenderHTMLSource>` (lightweight, per-instance) instead of the
 * combined `<RenderHTML>` — which would mount its own engine + config
 * on every render and trigger the library's "costly tree rerenders"
 * warning during streaming.
 *
 * See https://stackoverflow.com/a/68966121 — the maintainer's canonical
 * guidance on splitting providers from sources.
 */

// Module-level constants — never change → never invalidate the engine.
const SYSTEM_FONTS = defaultSystemFonts;
// 2026-10-27：用户要求「长按可复制 / 自定义选取内容复制」。
// 打开文本可选中，长按文字即可唤出系统选择手柄 + 复制菜单；
// 同时保留 ChatView 原有的长按操作菜单（复制/重新生成/编辑）。
const DEFAULT_TEXT_PROPS = {
  selectable: true,
  userSelect: 'text' as const,
};

// Renderer map at module scope so its identity is stable across every
// render of MarkdownProvider (the library's useProfiler warns when this
// reference changes between renders). Component functions inside the
// map can still call hooks — they're rendered as part of the React tree,
// not stored as data.
const renderers = {
  code: (props: any) => <CodeRenderer {...props} />,
  ...tableRenderers,
};

export const MarkdownProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const theme = useTheme();
  const tagsStyles = useMemo(() => createTagsStyles(theme), [theme]);

  return (
    <TRenderEngineProvider
      tagsStyles={tagsStyles}
      customHTMLElementModels={tableHTMLElementModels}
      systemFonts={SYSTEM_FONTS}>
      <RenderHTMLConfigProvider
        defaultTextProps={DEFAULT_TEXT_PROPS}
        renderers={renderers}>
        {children}
      </RenderHTMLConfigProvider>
    </TRenderEngineProvider>
  );
};
