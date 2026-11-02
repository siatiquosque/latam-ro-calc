/** Execution policy belongs to the caller, never to the MCP transport. */
export interface AnalysisRuntime {
  appOrigin: string;
  shortenerUrl: string;
  defaultTargetId: number;
  limits: {
    maxOptimizeCandidates: number;
    maxTableMonsters: number;
    maxCompareBuilds: number;
    maxVariants: number;
    maxContributions: number;
    maxSolves: number;
    maxSearchMs: number;
  };
}
