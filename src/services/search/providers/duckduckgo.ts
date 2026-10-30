import type {SearchProvider, SearchHit, SearchOptions} from '../types';
import {fetchText} from './http';

/**
 * Keyless built-in search via DuckDuckGo's server-rendered HTML endpoint.
 * No API key, no account — works out of the box. We parse the result markup
 * (title / url / snippet) ourselves because there's no free JSON API.
 *
 * Results link through DuckDuckGo's `//duckduckgo.com/l/?uddg=<enc>` redirect;
 * the real URL lives in the `uddg` query param, so we unwrap it.
 */

const ENDPOINT = 'https://html.duckduckgo.com/html/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );

const stripTags = (s: string): string => s.replace(/<[^>]*>/g, '');

/** Unwrap a DuckDuckGo `uddg` redirect (or a protocol-relative href) to a real URL. */
const resolveUrl = (href: string): string => {
  const trimmed = href.trim();
  const uddg = trimmed.match(/[?&]uddg=([^&]+)/);
  if (uddg) {
    try {
      return decodeURIComponent(uddg[1]);
    } catch {
      /* fall through */
    }
  }
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  return trimmed;
};

export class DuckDuckGoProvider implements SearchProvider {
  readonly id = 'duckduckgo' as const;

  constructor(_getKey: () => string) {
    // Keyless by design — the key accessor is accepted for interface parity
    // but never consulted.
  }

  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    const url = `${ENDPOINT}?q=${encodeURIComponent(query)}`;
    const html = await fetchText(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });

    // Each result begins with `class="result__a"`; split and parse per chunk.
    const chunks = html.split('class="result__a"');
    const hits: SearchHit[] = [];
    for (let i = 1; i < chunks.length && hits.length < opts.maxResults; i++) {
      const chunk = chunks[i];

      const hrefMatch = chunk.match(/href="([^"]*)"/);
      const titleMatch = chunk.match(/href="[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      if (!hrefMatch || !titleMatch) {
        continue;
      }

      const url = resolveUrl(hrefMatch[1]);
      if (!url || !/^https?:\/\//.test(url)) {
        continue;
      }

      let title = stripTags(titleMatch[1]);
      title = decodeEntities(title).replace(/\s+/g, ' ').trim();

      const snippetMatch = chunk.match(
        /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/,
      );
      let snippet = '';
      if (snippetMatch) {
        snippet = decodeEntities(stripTags(snippetMatch[1]))
          .replace(/\s+/g, ' ')
          .trim();
      }

      if (!title) {
        continue;
      }

      hits.push({title, url, snippet});
    }

    return hits;
  }
}
