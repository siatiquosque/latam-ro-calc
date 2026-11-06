import type { DatasetSources } from './data/dataset';
import type { OptimizeBuildArgs, ScanSlotArgs, ExplainDamageArgs } from './operations/optimize';
import type { OptimizeStatsArgs } from './operations/optimize-stats';

/** One immutable build snapshot per run. No MCP envelopes or credentials cross this boundary. */
export type AnalysisRequest = {
  sources: DatasetSources;
  descriptions: Record<string, string>;
  origin: string;
  maxSearchMs: number;
  maxSolves: number;
} & (
  | { mode: 'build'; args: OptimizeBuildArgs }
  | { mode: 'slot'; args: ScanSlotArgs }
  | { mode: 'stats'; args: OptimizeStatsArgs }
  | { mode: 'explain'; args: ExplainDamageArgs }
);

export type AnalysisCancel = { type: 'cancel' };
export type AnalysisResponse = { result?: Record<string, any>; checkpoint?: Record<string, any>; error?: string };
