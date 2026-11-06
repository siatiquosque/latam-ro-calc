import type { DatasetSources } from './data/dataset';
import type { BuildInput } from './engine/build-input';
import type { BuildPatch } from './engine/variants';
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
  /** Acquisition of what `patch` changes in `original`; read-only, never re-solves damage. */
  | { mode: 'acquisition'; args: { original: BuildInput; patch: BuildPatch } }
  /** Full routes and sources of one item, for the detail view. */
  | { mode: 'acquisitionItem'; args: { itemId: number } }
);

export type AnalysisResponse = { result?: Record<string, any>; error?: string };
