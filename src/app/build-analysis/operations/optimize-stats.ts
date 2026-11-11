/** Transport-free build operations. Browser UI and MCP call these same implementations. */

import { z } from 'zod';
import { zeroDamageReason } from '../engine/zero-damage';
import { BaseStateCalculator } from 'src/app/core/base-state-calculator';
import { Dataset } from '../data/dataset';
import { resolveBuild, BuildInput } from '../engine/build-input';
import { Metric } from '../engine/metrics';
import { pacing } from '../engine/pacing';
import { Shortener } from '../engine/share';
import { BuildPatch, decodeOnce } from '../engine/variants';
import { targetSchema } from './calculate';
import { createBuildContext } from './context';
import { createOptimizationOperations, deltaPct, meets, requireSchema, roundMetrics } from './optimize';
import { evaluationCache } from '../engine/evaluate';
import { validateBuild } from '../engine/validate';
import { AnalysisRuntime } from '../runtime';

const MAIN = ['str', 'agi', 'vit', 'int', 'dex', 'luk'] as const;

const TRAITS = ['pow', 'sta', 'wis', 'spl', 'con', 'crt'] as const;

const CAP = { main: 130, trait: 100 } as const;

const mainCost: number[] = Array.from({ length: CAP.main + 1 }, (_, level) =>
  new BaseStateCalculator().setMainStatusLevels([level]).calculate().summary.usedPoint);

interface Group {
  name: 'main' | 'trait';
  stats: readonly string[];
  floor: number;
  cap: number;
  cost: (level: number) => number;
  budget: number;
}

type Levels = Record<string, number>;

export type OptimizeStatsArgs = {
    build: BuildInput;
    target?: z.infer<typeof targetSchema>;
    effects?: string[];
    objective?: Metric;
    lock?: string[];
    require?: z.infer<typeof requireSchema>[];
    maxSolves?: number;
  };

export function createStatOperations(dataset: Dataset, config: AnalysisRuntime, shortener?: Shortener) {

  const { normalizeShare, resolveTarget } = createBuildContext(config, shortener);
  const { shareOf } = createOptimizationOperations(dataset, config, shortener);

async function optimizeStats({ build, target, effects = [], objective = 'dps', lock = [], require: rules = [], maxSolves }: OptimizeStatsArgs) {
    const budgetCap = Math.min(maxSolves ?? config.limits.maxSolves, config.limits.maxSolves);
    const pace = pacing(config.limits.maxSearchMs);
    const base = decodeOnce(await normalizeShare(build, shortener));
    const validation = validateBuild(base, dataset);
    if (!validation.valid) throw new Error(`Build inválida para redistribuir atributos: ${validation.errors.slice(0, 3).map(issue => `${issue.code}: ${issue.message}`).join(' ')} Use validate_build e corrija a entrada.`);
    if (lock.some(stat => ![...MAIN, ...TRAITS].includes(stat as never))) throw new Error('lock contém atributo desconhecido.');
    const { monster } = resolveTarget(dataset, target?.monsterId);
    const wanted: Metric[] = [...new Set<Metric>([objective, 'max', 'dps', 'hp', ...rules.map((rule) => rule.metric)])];
    const memo = evaluationCache();
    const start = memo.evaluate(base, undefined, dataset, monster, effects, wanted);
    const startValue = start.metrics[objective];
    if (!startValue) throw new Error(`A build não produz ${objective} para otimizar: ${zeroDamageReason(start.rb.model)}`);
    const score = (value: number) => objective === 'hitsToKill' ? -value : value;

    const model = start.rb.model as unknown as Levels;
    const points = new BaseStateCalculator().setClass(start.rb.char).setLevel(model['level'])
      .setMainStatusLevels(MAIN.map((stat) => model[stat])).setTraitStatusLevels(TRAITS.map((stat) => model[stat])).calculate().summary;
    const groups: Group[] = [
      { name: 'main', stats: MAIN, floor: 1, cap: Math.min(CAP.main, start.rb.char.maxBaseStat), cost: (level) => mainCost[Math.min(level, CAP.main)], budget: points.totalPoint },
    ];
    if (start.rb.char.isAllowTraitStat()) {
      groups.push({ name: 'trait', stats: TRAITS, floor: 0, cap: CAP.trait, cost: (level) => level, budget: points.totalTraitPoint });
    }

    const levels: Levels = Object.fromEntries([...MAIN, ...TRAITS].map((stat) => [stat, model[stat] ?? 0]));
    const frozen = new Set(lock);
    let value = score(startValue);
    let metrics = start.metrics;
    let exhausted = false;
    const run = (candidate: Levels) => {
      if (memo.misses >= budgetCap || pace.timeUp()) { exhausted = true; return null; }
      try {
        const patch: BuildPatch = { stats: candidate };
        const result = memo.evaluate(base, patch, dataset, monster, effects, wanted);
        const metric = result.metrics[objective];
        return { value: metric === undefined ? undefined : score(metric), metrics: result.metrics, ok: meets(result.metrics, rules) };
      } catch { return null; }
    };
    const used = (group: Group, at: Levels) => group.stats.reduce((sum, stat) => sum + group.cost(at[stat]), 0);
    /** Raise `stat` as far as the points allow, up to `most` levels. */
    const raise = (group: Group, at: Levels, stat: string, most: number): Levels => {
      const next = { ...at };
      while (next[stat] - at[stat] < most && next[stat] < group.cap && used(group, { ...next, [stat]: next[stat] + 1 }) <= group.budget) next[stat]++;
      return next;
    };

    for (const group of groups) {
      const movable = group.stats.filter((stat) => !frozen.has(stat));
      for (let step = 8; step >= 1 && !exhausted;) {
        await pace.breathe();
        const reference = value;
        const gain = new Map<string, number>();
        const loss = new Map<string, number>();
        for (const stat of movable) {
          const up = raise(group, levels, stat, step);
          if (up[stat] > levels[stat]) {
            const r = run(up);
            if (r?.value !== undefined) gain.set(stat, r.value - reference);
          }
          if (levels[stat] - step >= group.floor) {
            const r = run({ ...levels, [stat]: levels[stat] - step });
            if (r?.value !== undefined) loss.set(stat, r.value - reference);
          }
        }
        // First-order guess: take from the stat that hurts least (or from the unspent points), give to the one that helps most.
        // The best few guesses are then verified with a real calculation.
        const pairs = movable
          .flatMap((to) => [...movable, null].filter((from) => from !== to).map((from) => ({ to, from, guess: (gain.get(to) ?? 0) + (from ? loss.get(from) ?? -Infinity : 0) })))
          .filter((pair) => Number.isFinite(pair.guess))
          .sort((a, b) => b.guess - a.guess)
          .slice(0, 3);
        let best: { at: Levels; value: number; metrics: typeof metrics } | null = null;
        for (const { to, from } of pairs) {
          const freed = from ? { ...levels, [from]: levels[from] - step } : { ...levels };
          const at = raise(group, freed, to, step * 2);
          if (at[to] === levels[to]) continue;
          const r = run(at);
          if (r?.ok && r.value !== undefined && r.value > (best?.value ?? value + Math.abs(value) * 0.001)) best = { at, value: r.value, metrics: r.metrics };
        }
        if (best) {
          Object.assign(levels, best.at);
          value = best.value;
          metrics = best.metrics;
        } else {
          step = Math.floor(step / 2);
        }
      }
    }

    const changes = Object.fromEntries([...MAIN, ...TRAITS].filter((stat) => levels[stat] !== model[stat]).map((stat) => [stat, { from: model[stat], to: levels[stat] }]));
    const finalBuild = resolveBuild({ ...base, stats: { ...base.stats, ...levels } }, dataset);
    const finalValidation = validateBuild({ ...base, stats: { ...base.stats, ...levels } }, dataset);
    if (!finalValidation.valid) throw new Error(`A redistribuição não passou na validação: ${finalValidation.errors.map(issue => issue.code).join(', ')}.`);
    if (!meets(metrics, rules)) throw new Error('Nenhuma redistribuição encontrada atende a require neste orçamento.');
    const shown: Metric[] = [...new Set<Metric>([objective, 'max', 'dps', 'hp'])];

    return {
      objective,
      baseline: roundMetrics(start.metrics, shown),
      final: roundMetrics(metrics, shown),
      deltaPct: Object.fromEntries(shown.map((metric) => [metric, deltaPct(metrics[metric], start.metrics[metric])])),
      changes,
      points: groups.map((group) => ({ group: group.name, budget: group.budget, used: used(group, levels), before: used(group, model) })),
      patch: { stats: Object.fromEntries(Object.keys(changes).map((stat) => [stat, levels[stat]])) },
      share: shareOf(finalBuild),
      solves: memo.misses,
      evaluations: { uniqueEvaluations: memo.misses, cacheHits: memo.hits },
      complete: !exhausted,
      stoppedReason: exhausted ? memo.misses >= budgetCap ? 'maxSolves' : 'deadline' : 'converged',
      stopped: exhausted ? 'orçamento de cálculos ou de tempo esgotado: o resultado pode estar incompleto' : 'convergiu',
      note: 'Busca heurística por pares de atributos, com limites da classe e custos do simulador; não prova ótimo global. Contadores medem avaliações novas, não os solves internos de cada passo de rotação.',
    };
  }

return { optimizeStats };
}
