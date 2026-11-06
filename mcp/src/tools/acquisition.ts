/** MCP schema and envelope only; the lookup lives in build-analysis. */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config';
import { Dataset } from '../data/dataset';
import { compactBuildSchema } from '../engine/build-input';
import { Shortener } from '../engine/share';
import { json, registerJsonTool } from './helpers';
import type { AcquisitionArgs } from 'src/app/build-analysis/operations/acquisition';
import { loadAcquisitionOperations } from './acquisition-operations';

/** Same ceiling as the operation's own check; the operation module is not imported here (see below). */
const MAX_BUILDS = 10;

export function registerAcquisitionTools(server: McpServer, dataset: Dataset, shortener?: Shortener): void {
  // The acquisition catalog is ~0.8 MB of JSON. Imported on first use, the bundler keeps it in its own chunk, so the other
  // tools and the Worker's startup never pay for it.
  let operations: Promise<ReturnType<typeof import('src/app/build-analysis/operations/acquisition').createAcquisitionOperations>> | undefined;
  const load = () => operations ??= loadAcquisitionOperations().then(m => m.createAcquisitionOperations(dataset, config, shortener));
  registerJsonTool<AcquisitionArgs>(server, 'get_acquisition', {
    title: 'Como obter itens e encantamentos',
    description:
      'USE para saber como obter item ou encantamento (`itemId`), os drops de um monstro (`monsterId`) ou os equipamentos de builds (`builds`, com `share`). ' +
      'Devolve rotas, materiais, chances, período LATAM, lacunas e fontes. Por componente: `availability` (confirmed|unconfirmed|expired_only|future_only|none), `chance` (certain|known|unknown|none), `exceptional`, `insufficient`. ' +
      'Sem rota NÃO é impossível; `unknown` NÃO é 0% nem 100%. Sem preço nem ranking.',
    inputSchema: {
      itemId: z.number().int().positive().optional(),
      monsterId: z.number().int().positive().optional(),
      builds: z.array(compactBuildSchema).min(1).max(MAX_BUILDS).optional(),
      asOf: z.string().max(10).optional().describe('AAAA-MM-DD; padrão hoje.'),
    },
  }, async args => json(await (await load()).assess(args)));
}
