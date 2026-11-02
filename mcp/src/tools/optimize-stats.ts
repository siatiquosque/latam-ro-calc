/** MCP schemas and JSON envelopes only; calculations and searches live in build-analysis. */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config';
import { Dataset } from '../data/dataset';
import { BuildInput, compactBuildSchema } from '../engine/build-input';
import { Metric, METRICS } from '../engine/metrics';
import { Shortener } from '../engine/share';
import { targetSchema } from './calculate';
import { requireSchema } from './optimize';
import { json, registerJsonTool } from './helpers';
import { createStatOperations } from 'src/app/build-analysis/operations/optimize-stats';

const MAIN = ['str', 'agi', 'vit', 'int', 'dex', 'luk'] as const;

const TRAITS = ['pow', 'sta', 'wis', 'spl', 'con', 'crt'] as const;

export function registerStatTools(server: McpServer, dataset: Dataset, shortener?: Shortener): void {
  const operations = createStatOperations(dataset, config, shortener);
  registerJsonTool<{
    build: BuildInput;
    target?: z.infer<typeof targetSchema>;
    effects?: string[];
    objective?: Metric;
    lock?: string[];
    require?: z.infer<typeof requireSchema>[];
    maxSolves?: number;
  }>(server, 'optimize_stats', {
    title: 'Redistribuir os pontos de atributo',
    description:
      'Redistribui atributos base/traits após escolher equipamentos. Requer build legal; respeita pontos e limites da classe, lock e require. ' +
      'Maximiza a métrica, exceto hitsToKill (minimiza). Cache não consome maxSolves; interrupções trazem complete:false e stoppedReason. ' +
      'Heurística por pares, sem prova de ótimo global.',
    inputSchema: {
      build: compactBuildSchema,
      target: targetSchema,
      effects: z.array(z.string()).optional(),
      objective: z.enum(METRICS).optional().describe('Métrica a melhorar; hitsToKill minimiza. Padrão: dps.'),
      lock: z.array(z.enum([...MAIN, ...TRAITS])).optional().describe('Atributos que não mudam.'),
      require: z.array(requireSchema).optional(),
      maxSolves: z.number().int().min(10).optional().describe('Teto de avaliações novas, incluindo a base; cache não consome. O servidor impõe o dele.'),
    },
  }, (args) => operations.optimizeStats(args).then(json));
}
