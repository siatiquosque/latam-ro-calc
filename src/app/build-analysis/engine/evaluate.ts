/** Shared evaluation of resolved builds. No search strategy or MCP transport belongs here. */
import { APP_VERSION } from 'src/app/core/app-version';
import { Dataset } from '../data/dataset';
import { BuildInput, ResolvedBuild, resolveBuild } from './build-input';
import { Metric, Metrics, readMetrics } from './metrics';
import { ProcPolicy, procUptime } from './proc';
import { Calculator } from 'src/app/core/calculator';
import { solveWithInput } from './solve';
import { applyPatch, BuildPatch } from './variants';
import { countedEngineCall, JobBudget } from './job-budget';

export function evaluate(
  base: BuildInput,
  patch: BuildPatch | undefined,
  dataset: Dataset,
  monster: any,
  effects: string[],
  wanted: readonly Metric[],
  more: { monster: any; weight: number }[] = [],
  weight = 1,
  autoProcs: ProcPolicy = false,
  jobBudget?: JobBudget,
  forbiddenEffects: readonly string[] = [],
) {
  return evaluateResolved(resolveBuild(patch ? applyPatch(base, patch) : base, dataset), base, patch, dataset, monster, effects, wanted, more, weight, autoProcs, jobBudget, forbiddenEffects);
}

type Evaluation = ReturnType<typeof evaluate>;

/**
 * Calls made to the calculation engine (`solveWithInput`) since the process started. One evaluation is one build against one
 * target; it costs one call, or more with extra targets or an averaged proc policy. Read it as a difference around the work
 * being measured (the engine is synchronous, so nothing else interleaves inside a single evaluation).
 */
export { engineCallCount } from './job-budget';
const solveCounted = (budget: JobBudget | undefined, ...args: Parameters<typeof solveWithInput>) => countedEngineCall(budget, () => solveWithInput(...args));

/**
 * `evaluate` for a build the caller already resolved. The search asks about the same build many times (a card tried in the
 * quick pass and again in the full one, a worn piece met again on the next round: about a quarter of all the calculations of
 * a real search were repeats), so it keeps what it measured: the metrics are a pure function of the resolved build, the
 * target and the effects. A repeat costs the key, not the ~5 ms calculation, and does not count against the budget.
 * `solved` (the live calculator) is only there on a fresh calculation: anything that reads it uses `fresh`.
 */
export function evaluationCache(limit = 4000) {
  const store = new Map<string, { metrics: Metrics; procEvaluation: Evaluation['procEvaluation'] }>();
  const datasetIds = new WeakMap<Dataset, number>();
  let nextDatasetId = 0;
  // Sort object keys only. Slot sides and array order (buffs, effects, enchants) retain their semantics.
  const canonical = (value: unknown) => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
  // Targets and the proc policy are read-only objects shared by every evaluation of a search (the policy's item
  // table alone is most of the key): each one's part of the key is built once per object.
  const sharedKeys = new WeakMap<object, string>();
  const sharedKey = (value: any, build: () => unknown = () => value) => {
    if (!value || typeof value !== 'object') return canonical(build());
    let key = sharedKeys.get(value);
    if (key === undefined) sharedKeys.set(value, key = canonical(build()));
    return key;
  };
  const copyProcs = (value: Evaluation['procEvaluation']) => ({ counted: [...value.counted], uncounted: [...value.uncounted] });
  const cache = {
    hits: 0,
    /** Calculations the cache did not have (what the budget pays for). */
    misses: 0,
    /** Completed cache misses; a budget interruption never becomes a cached result. */
    completed: 0,
    evaluate(base: BuildInput, patch: BuildPatch | undefined, dataset: Dataset, monster: any, effects: string[], wanted: readonly Metric[], more: { monster: any; weight: number }[] = [], weight = 1, autoProcs: ProcPolicy = false, jobBudget?: JobBudget, forbiddenEffects: readonly string[] = []): Evaluation {
      const rb = resolveBuild(patch ? applyPatch(base, patch) : base, dataset);
      if (!datasetIds.has(dataset)) datasetIds.set(dataset, nextDatasetId++);
      const policy = sharedKey(autoProcs, () => typeof autoProcs === 'object'
        ? { mode: autoProcs.mode, hitsPerSecond: autoProcs.hitsPerSecond, metadata: [...autoProcs.metadata].sort(([a], [b]) => a - b) }
        : autoProcs);
      const key = canonical([APP_VERSION, datasetIds.get(dataset), sharedKey(monster), effects, wanted, more.map(entry => [sharedKey(entry.monster), entry.weight]), weight, policy, forbiddenEffects, rb.model, rb.customItems ?? []]);
      const known = store.get(key);
      if (known) {
        cache.hits++;
        return { rb, solved: undefined as unknown as Evaluation['solved'], metrics: { ...known.metrics }, procEvaluation: copyProcs(known.procEvaluation) };
      }
      cache.misses++;
      const result = evaluateResolved(rb, base, patch, dataset, monster, effects, wanted, more, weight, autoProcs, jobBudget, forbiddenEffects);
      cache.completed++;
      if (store.size >= limit) store.delete(store.keys().next().value as string);
      store.set(key, { metrics: { ...result.metrics }, procEvaluation: copyProcs(result.procEvaluation) });

      return result;
    },
  };

  return cache;
}

/** The solved calculator with another set of chances switched on: the pass that applies them, alone. */
function withChances(calc: Calculator, chances: string[], skillValue: string, jobBudget?: JobBudget): Calculator {
  return countedEngineCall(jobBudget, () => calc.setSelectedChances(chances).recalcExtraBonus(skillValue));
}

function evaluateResolved(
  rb: ResolvedBuild,
  base: BuildInput,
  patch: BuildPatch | undefined,
  dataset: Dataset,
  monster: any,
  effects: string[],
  wanted: readonly Metric[],
  more: { monster: any; weight: number }[],
  weight: number,
  autoProcs: ProcPolicy,
  jobBudget?: JobBudget,
  forbiddenEffects: readonly string[] = [],
) {
  let first = solveCounted(jobBudget, rb, dataset, monster, effects);
  if (autoProcs === true) {
    // Procs only exist on the calculator after a solve, and a swapped-in piece brings its own: count whatever this build offers.
    const offered = ((first.calc.chanceList ?? []) as any[]).map(chance => chance?.name).filter((name): name is string => !!name && !effects.includes(name) && !forbiddenEffects.includes(name));
    if (offered.length) { effects = [...effects, ...offered]; first = solveCounted(jobBudget, rb, dataset, monster, effects); }
  }
  const solved = { ...first, rb, effects };
  const metrics = readMetrics(solved, wanted, jobBudget);
  const procEvaluation: { counted: string[]; uncounted: string[] } = { counted: [], uncounted: [] };
  if (autoProcs === true) procEvaluation.counted = effects.filter(effect => (first.calc.chanceList ?? []).some(chance => chance.name === effect));
  if (typeof autoProcs === 'object') {
    const offered = (first.calc.chanceList ?? []).filter(chance => chance?.name && !effects.includes(chance.name) && !forbiddenEffects.includes(chance.name));
    const known = offered.map(chance => ({ chance, data: chance.ratePct && chance.durationSeconds ? chance : autoProcs.metadata.get(chance.itemId) }))
      .filter(entry => entry.data?.ratePct && entry.data?.durationSeconds);
    // Enumerate independent on/off states exactly for up to three known procs. Never assume an unknown proc is permanent.
    const counted = known.slice(0, 3);
    procEvaluation.counted = counted.map(entry => entry.chance.name);
    procEvaluation.uncounted = offered.map(chance => chance.name).filter(name => !procEvaluation.counted.includes(name));
    const damageMetrics = wanted.filter(metric => ['dps', 'avgHit', 'rotationDps', 'burstDps'].includes(metric));
    for (const metric of damageMetrics) metrics[metric] = 0;
    for (let mask = 0; mask < 2 ** counted.length; mask++) {
      let probability = 1;
      const active = [...effects];
      counted.forEach(({ chance, data }, index) => {
        const uptime = procUptime(data.ratePct, data.durationSeconds, autoProcs.hitsPerSecond);
        probability *= mask & 2 ** index ? uptime : 1 - uptime;
        if (mask & 2 ** index) active.push(chance.name);
      });
      // A proc state differs from the solved build only in the chances it switches on, and only the calculator's
      // extra-bonus pass reads them: redo that pass on the loaded calculator instead of solving the whole build again.
      const stateInput = { ...first.input, selectedChances: active };
      const state = mask === 0 ? readMetrics(solved, damageMetrics, jobBudget)
        : readMetrics({ calc: withChances(first.calc, active, stateInput.selectedAtkSkill, jobBudget), input: stateInput, rb, effects: active }, damageMetrics, jobBudget);
      for (const metric of damageMetrics) if (state[metric] !== undefined) metrics[metric] += probability * state[metric];
    }
    // Leave the calculator on the solved build itself, as callers read it.
    if (counted.length) first.calc.setSelectedChances(effects).recalcExtraBonus(first.input.selectedAtkSkill);
  }

  // Further targets re-target the same calculator (the gear pass does not change with the monster), and
  // only the damage figures depend on it. Done last: it leaves the calculator on the final target.
  if (more.length) {
    const fields = wanted.filter(metric => ['max', 'min', 'dps', 'avgHit', 'rotationDps', 'burstDps'].includes(metric));
    const sums: Record<string, number> = Object.fromEntries(fields.map(key => [key, (metrics[key] ?? 0) * weight]));
    let total = weight;
    for (const aim of more) {
      const next = evaluate(base, patch, dataset, aim.monster, effects, wanted, [], 1, autoProcs, jobBudget, forbiddenEffects);
      for (const key of fields) sums[key] += (next.metrics[key] ?? 0) * aim.weight;
      total += aim.weight;
    }
    for (const key of fields) if (metrics[key] !== undefined) metrics[key] = sums[key] / total;
  }

  return { rb, solved, metrics, procEvaluation };
}
