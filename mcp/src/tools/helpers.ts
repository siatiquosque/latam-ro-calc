/** Shared plumbing for tool handlers. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadRandomPools } from 'src/app/core/random-option-catalog';
import { config } from '../config';
import { strictShape } from 'src/app/build-analysis/engine/strict-object';
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
 * Searches hold tens of MB each while they run (solve memo, candidate pools) and burn CPU for tens of seconds. The VPS caps the Node
 * heap at 256 MB, and three searches interleaving at an await killed the process (out of memory) while one alone fits. So these run one
 * at a time; others wait, and past a short queue the call is refused with a message the AI can act on instead of stalling the client.
 */
const HEAVY_TOOLS = new Set(['optimize_build', 'optimize_slot', 'optimize_stats', 'scan_slot', 'find_synergies']);
const MAX_QUEUED = 3;
let heavyTail: Promise<unknown> = Promise.resolve();
let heavyWaiting = 0;

async function runHeavy<T>(task: () => Promise<T>): Promise<T> {
  if (heavyWaiting >= MAX_QUEUED) {
    throw new Error('Servidor ocupado com outras buscas longas. Tente de novo em instantes, ou use evaluate_variants/calculate, que respondem na hora.');
  }
  heavyWaiting++;
  const run = heavyTail.then(task, task);
  heavyTail = run.then(() => undefined, () => undefined);
  try { return await run; } finally { heavyWaiting--; }
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
  // ChatGPT reads these three hints as required and frames a tool without them as one that writes. Everything here only reads
  // or calculates; a tool that differs says so in its own `annotations`.
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, ...(config as { annotations?: object }).annotations };
  // A misspelled argument ("targets" for "target", "classId" for "class") used to be dropped without a word and the tool answered about
  // the default instead. Refusing it names the field, which is the one thing an AI can fix on its own.
  const shape = (config as { inputSchema?: unknown }).inputSchema;
  const inputSchema = shape && !(shape as { _zod?: unknown })._zod && typeof shape === 'object' ? strictShape(shape as z.ZodRawShape, `a ferramenta ${name}`) : shape;
  server.registerTool(name, { ...config, ...(inputSchema ? { inputSchema } : {}), annotations } as any, (async (args: A) => {
    try {
      await loadRandomPools();
      const run = async () => shortenShares(await handler(args), shorteners.get(server));
      return await (HEAVY_TOOLS.has(name) ? runHeavy(run) : run());
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
