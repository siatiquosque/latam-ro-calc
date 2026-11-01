/** Shared plumbing for tool handlers. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config';
import { Shortener, shortenShareUrl } from '../engine/share';

/** MCP tool results carry text content; ours is always JSON, compact: indentation is tokens the reader never needed. */
export const json = (payload: unknown, isError = false) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  ...(isError ? { isError: true as const } : {}),
});

/** Turn a thrown error into a tool result rather than a transport-level failure, so the
 *  agent can read what went wrong and correct its arguments. */
export const fail = (error: unknown) => json({ error: error instanceof Error ? error.message : String(error) }, true);

/** Drop undefined entries so they don't serialize as noise. */
export const compact = <T extends Record<string, any>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const shorteners = new WeakMap<McpServer, Shortener | undefined>();
/** Records how this server reaches the shortener, before any tool is registered. */
export const useShortener = (server: McpServer, shortener?: Shortener): void => { shorteners.set(server, shortener); };

/** Build links in a tool result are long (the whole build rides in the URL), so hand out the short form when a shortener is configured. */
async function shortenShares<R>(result: R, shortener?: Shortener): Promise<R> {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content?.[0];
  if (!config.shortenerUrl || content?.type !== 'text' || !content.text) return result;
  const prefix = config.appOrigin.replace(/\/+$/, '') + '/s/';
  const pattern = /("(?:share|url)":\s*")(https?:\/\/[^"]+)(")/g;
  const urls = [...new Set([...content.text.matchAll(pattern)].map(m => m[2]).filter(url => url.startsWith(prefix)))];
  if (!urls.length) return result;
  const short = new Map(await Promise.all(urls.map(async url => [url, await shortenShareUrl(url, config.shortenerUrl, undefined, shortener)] as const)));
  content.text = content.text.replace(pattern, (all, open, url, close) => short.has(url) ? open + short.get(url) + close : all);
  return result;
}

/**
 * Register a tool whose errors become readable JSON results. The specs parse
 * `data.error`, which the SDK's default text error would not produce.
 */
export function registerJsonTool<A>(
  server: McpServer,
  name: string,
  config: Parameters<McpServer['registerTool']>[1],
  handler: (args: A) => unknown | Promise<unknown>,
): void {
  server.registerTool(name, config as any, (async (args: A) => {
    try {
      return await shortenShares(await handler(args), shorteners.get(server));
    } catch (error) {
      return fail(error);
    }
  }) as any);
}

/** The paginated envelope every search tool returns, including the "there's more" hint. */
export const paged = <T, R>(key: string, total: number, rows: T[], offset: number, map: (row: T) => R) => {
  const shown = rows.length;
  const rest = total - offset - shown;
  return {
    total,
    shown,
    offset,
    [key]: rows.map(map),
    ...(rest > 0 ? { hint: `Mais ${rest} resultados: use offset=${offset + shown}.` } : {}),
  };
};
