/**
 * `optimize_stats`: where the stat points should go. Equipment search leaves the allocation of the link
 * untouched, and a few points moved between stats are often worth more than a piece of gear.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BaseStateCalculator } from 'src/app/core/base-state-calculator';
import { config } from '../config';
import { Dataset } from '../data/dataset';
import { resolveBuild, BuildInput, compactBuildSchema } from '../engine/build-input';
import { Metric, METRICS } from '../engine/metrics';
import { pacing } from '../engine/pacing';
import { Shortener } from '../engine/share';
import { BuildPatch, decodeOnce } from '../engine/variants';
import { normalizeShare, resolveTarget, targetSchema } from './calculate';
import { deltaPct, evaluate, meets, requireSchema, roundMetrics, shareOf } from './optimize';
import { json, registerJsonTool } from './helpers';

const MAIN = ['str', 'agi', 'vit', 'int', 'dex', 'luk'] as const;
const TRAITS = ['pow', 'sta', 'wis', 'spl', 'con', 'crt'] as const;
/** Game limits: 130 for the six base stats, 100 for the traits. */
const CAP = { main: 130, trait: 100 } as const;

/** Cumulative points a base stat has cost at each level, from the app's own calculator. */
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

export function registerStatTools(server: McpServer, dataset: Dataset, shortener?: Shortener): void {
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
      'USE depois de escolher as peças, para redistribuir atributos. NÃO use para trocar equipamento. ' +
      'Move pontos entre os atributos (FOR/AGI/VIT/INT/DES/SOR e, nas classes de 4ª, POD/STA/SAB/FEI/CON/CRV) para maximizar a métrica, ' +
      'sem gastar mais do que o nível permite (o custo dos atributos base cresce com o nível do atributo; o das traits é 1 por nível). ' +
      'Pontos ainda não gastos entram na conta. `lock` trava atributos; `require` impõe pisos (ex.: hp mínimo). ' +
      'Subida de encosta por trocas entre pares, limitada pelo orçamento de cálculos: não prova o ótimo global.',
    inputSchema: {
      build: compactBuildSchema,
      target: targetSchema,
      effects: z.array(z.string()).optional(),
      objective: z.enum(METRICS).optional().describe('O que maximizar. Padrão: dps.'),
      lock: z.array(z.enum([...MAIN, ...TRAITS])).optional().describe('Atributos que não mudam.'),
      require: z.array(requireSchema).optional(),
      maxSolves: z.number().int().min(10).optional().describe('Teto de cálculos desta chamada; o servidor impõe o dele.'),
    },
  }, async ({ build, target, effects = [], objective = 'dps', lock = [], require: rules = [], maxSolves }) => {
    const budgetCap = Math.min(maxSolves ?? config.limits.maxSolves, config.limits.maxSolves);
    const pace = pacing(config.limits.maxSearchMs);
    const base = decodeOnce(await normalizeShare(build, shortener));
    const { monster } = resolveTarget(dataset, target?.monsterId);
    const wanted: Metric[] = [...new Set<Metric>([objective, 'max', 'dps', 'hp', ...rules.map((rule) => rule.metric)])];
    const start = evaluate(base, undefined, dataset, monster, effects, wanted);
    const startValue = start.metrics[objective];
    if (!startValue) throw new Error(`A build não produz ${objective} para otimizar.`);

    const model = start.rb.model as unknown as Levels;
    const points = new BaseStateCalculator().setClass(start.rb.char).setLevel(model['level'])
      .setMainStatusLevels(MAIN.map((stat) => model[stat])).setTraitStatusLevels(TRAITS.map((stat) => model[stat])).calculate().summary;
    const groups: Group[] = [
      { name: 'main', stats: MAIN, floor: 1, cap: CAP.main, cost: (level) => mainCost[Math.min(level, CAP.main)], budget: Math.max(points.totalPoint, points.usedPoint) },
    ];
    if (start.rb.char.isAllowTraitStat()) {
      groups.push({ name: 'trait', stats: TRAITS, floor: 0, cap: CAP.trait, cost: (level) => level, budget: Math.max(points.totalTraitPoint, points.usedTraitPoint) });
    }

    const levels: Levels = Object.fromEntries([...MAIN, ...TRAITS].map((stat) => [stat, model[stat] ?? 0]));
    const frozen = new Set(lock);
    let solves = 1;
    let value = startValue;
    let metrics = start.metrics;
    let exhausted = false;
    const run = (candidate: Levels) => {
      if (solves >= budgetCap || pace.timeUp()) { exhausted = true; return null; }
      solves++;
      try {
        const patch: BuildPatch = { stats: candidate };
        const result = evaluate(base, patch, dataset, monster, effects, wanted);
        return { value: result.metrics[objective], metrics: result.metrics, ok: meets(result.metrics, rules) };
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
          if (r?.ok && r.value !== undefined && r.value > (best?.value ?? value * 1.001)) best = { at, value: r.value, metrics: r.metrics };
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
    const shown: Metric[] = [...new Set<Metric>([objective, 'max', 'dps', 'hp'])];

    return json({
      objective,
      baseline: roundMetrics(start.metrics, shown),
      final: roundMetrics(metrics, shown),
      deltaPct: Object.fromEntries(shown.map((metric) => [metric, deltaPct(metrics[metric], start.metrics[metric])])),
      changes,
      points: groups.map((group) => ({ group: group.name, budget: group.budget, used: used(group, levels), before: used(group, model) })),
      patch: { stats: Object.fromEntries(Object.keys(changes).map((stat) => [stat, levels[stat]])) },
      share: shareOf(finalBuild),
      solves,
      stopped: exhausted ? 'orçamento de cálculos ou de tempo esgotado: o resultado pode estar incompleto' : 'convergiu',
      note: 'Busca heurística por trocas entre pares de atributos; tetos de 130 (base) e 100 (traits) e custos do próprio simulador. Confirme os limites no jogo.',
    });
  });
}
