/**
 * The tools that let an agent search for a better build instead of only reading one:
 * `evaluate_variants` (many patched builds in one call), `explain_damage` (where the damage
 * comes from, and what the number leaves out) and `slot_options` (what a piece accepts).
 *
 * They all sit on the same primitive — resolve a build, solve it, read metrics — so the
 * numbers agree with `calculate` and `optimize_slot`, which they complement.
 *
 * Every solve is synchronous (see engine/solve.ts): nothing here may `await` between
 * building a calculator and reading it.
 */
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ItemOptionMap } from 'src/app/constants/item-options-table';
import { ExtraOptionTable } from 'src/app/constants/extra-option-table';
import { randomOptionCatalogFor, randomPoolTier } from 'src/app/core/random-option-catalog';
import { enchantPoolsFor } from 'src/app/core/equipment-slot-derivation';
import { ItemTypeEnum } from 'src/app/constants/item-type.enum';
import { collectConsumables } from 'src/app/core/calculator-controller';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { canUsedByClass, round } from 'src/app/utils';
import { canGradeItem } from 'src/app/utils/can-grade';
import { config } from '../config';
import { Dataset } from '../data/dataset';
import { compactCatalog, compactUpstream, randomOptionReferencesFor } from '../data/random-options';
import { ItemRow } from '../data/item-index';
import { SlotTag } from '../data/slot-classifier';
import { BuildInput, compactBuildSchema, ITEM_ID_KEYS, MAIN_ITEM_SLOTS, relatedItemKeys, resolveBuild, ResolvedBuild } from '../engine/build-input';
import { DEFAULT_METRICS, Metric, METRICS, Metrics, objectiveFor, Profile, readMetrics } from '../engine/metrics';
import { buildShareUrl, Shortener, toPreset } from '../engine/share';
import { solveWithInput } from '../engine/solve';
import { applyPatch, BuildPatch, compactPatchSchema, decodeOnce } from '../engine/variants';
import { complementChoices, damageContext, keptSockets, REACHABLE_REFINE, relevantKeys, searchComplements, swapPatch } from '../engine/complements';
import { partnerIndex } from '../engine/item-partners';
import { pacing } from '../engine/pacing';
import { procData, procEstimate } from '../engine/proc';
import { CHECK_DUMMIES, isUndefended } from '../engine/dummies';
import { AspdPotionList, AspdPotionStackable } from 'src/app/constants/aspd-potion-list';
import { normalizeShare, resolveTarget, targetSchema } from './calculate';
import { compact, json, registerJsonTool } from './helpers';

type TargetArg = z.infer<typeof targetSchema>;

const metricEnum = z.enum(METRICS);

const variantSchema = z.object({
  label: z.string().min(1).max(80).describe('Nome curto para reconhecer a variante na resposta.'),
  patch: compactPatchSchema.describe('Só o que muda em relação à build base. Mapas (gear, stats, skills, options) mesclam por chave.'),
});

export const requireSchema = z.object({
  metric: metricEnum,
  min: z.number().optional(),
  max: z.number().optional(),
});

/** One build, solved: the metrics asked for and the resolved build they came from. */
export function evaluate(
  base: BuildInput,
  patch: BuildPatch | undefined,
  dataset: Dataset,
  monster: any,
  effects: string[],
  wanted: readonly Metric[],
  more: { monster: any; weight: number }[] = [],
  weight = 1,
  autoProcs = false,
) {
  const rb = resolveBuild(patch ? applyPatch(base, patch) : base, dataset);
  let first = solveWithInput(rb, dataset, monster, effects);
  if (autoProcs) {
    // Procs only exist on the calculator after a solve, and a swapped-in piece brings its own: count whatever this build offers.
    const offered = ((first.calc.chanceList ?? []) as any[]).map(chance => chance?.name).filter((name): name is string => !!name && !effects.includes(name));
    if (offered.length) { effects = [...effects, ...offered]; first = solveWithInput(rb, dataset, monster, effects); }
  }
  const solved = { ...first, rb, effects };
  const metrics = readMetrics(solved, wanted);

  // Further targets re-target the same calculator (the gear pass does not change with the monster), and
  // only the damage figures depend on it. Done last: it leaves the calculator on the final target.
  if (more.length) {
    const skillValue = (rb.model as any).selectedAtkSkill;
    const { usedHpL } = collectConsumables(rb.model as any, rb.items);
    const fields = { max: ['skillMaxDamage', 'effectedSkillDamageMax'], min: ['skillMinDamage', 'effectedSkillDamageMin'], dps: ['skillDps', 'effectedSkillDps'] } as const;
    const sums: Record<string, number> = Object.fromEntries(Object.keys(fields).map((k) => [k, (metrics[k as keyof typeof fields] ?? 0) * weight]));
    let total = weight;
    for (const aim of more) {
      const dmg: any = solved.calc.setMonster(aim.monster).prepareAllItemBonus().calcDmgWithExtraBonus({ skillValue, isUseHpL: usedHpL });
      for (const [key, [plain, effected]] of Object.entries(fields)) sums[key] += ((effects.length > 0 && typeof dmg[effected] === 'number' ? dmg[effected] : dmg[plain]) ?? 0) * aim.weight;
      total += aim.weight;
    }
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) if (metrics[key] !== undefined) metrics[key] = sums[key] / total;
  }

  return { rb, solved, metrics };
}

/** Rolls placed from the rAthena (kRO) pool: the LATAM server tends to follow kRO, but no regional source confirms it. */
function unconfirmed(rb: ResolvedBuild, changes: BuildPatch, dataset: Dataset) {
  const rolled = changes.options ?? {};
  const rows = [...ItemOptionMap].flatMap(([slot, indexes]) => {
    const id = Number((rb.model as unknown as Record<string, unknown>)[slot]);
    const options = indexes.filter(index => rolled[String(index)]).map(index => rolled[String(index)]);
    return id > 0 && options.length && randomPoolTier(id) === 'rathena' ? [{ slot, item: itemLabel(dataset, id), options }] : [];
  });
  return rows.length ? { unconfirmedRolls: { note: 'Pool do rAthena (kRO), não confirmado no LATAM.', rows } } : {};
}

/** "Nome (id) C": enough to read a step and to reuse the id, without a nested object per item. */
export const itemLabel = (dataset: Dataset, id: number, grade?: string): string =>
  `${dataset.itemIndex.get(id)?.name ?? '?'} (${id})${grade ? ` ${grade}` : ''}`;

export const shareOf = (rb: ResolvedBuild): string => buildShareUrl(toPreset(rb.model, rb.char), config.appOrigin, null, rb.customItems);

export const deltaPct = (value: number | undefined, base: number | undefined): number | null =>
  value === undefined || !base ? null : round(((value - base) / base) * 100, 2);

/** `value` against the bounds of a `require` clause; a metric the build cannot report fails it. */
export const meets = (metrics: Metrics, rules: z.infer<typeof requireSchema>[]): boolean =>
  rules.every(({ metric, min, max }) => {
    const value = metrics[metric];

    return value !== undefined && (min === undefined || value >= min) && (max === undefined || value <= max);
  });

export const roundMetrics = (metrics: Metrics, keep: readonly Metric[]): Metrics =>
  Object.fromEntries(keep.filter((k) => metrics[k] !== undefined).map((k) => [k, round(metrics[k]!, 2)])) as Metrics;

/** aegisName → id, built once per dataset: the enchant pools name their entries by aegisName. */
const aegisIndexes = new WeakMap<Dataset, Map<string, number>>();
function aegisIndex(dataset: Dataset): Map<string, number> {
  let index = aegisIndexes.get(dataset);
  if (!index) {
    index = new Map();
    for (const [id, item] of Object.entries(dataset.items)) if (item?.aegisName) index.set(item.aegisName, Number(id));
    aegisIndexes.set(dataset, index);
  }

  return index;
}

/** The slots `optimize_build` walks by default: everything that carries stats, not the costumes. */
const SEARCH_SLOTS = [
  'weapon', 'shield', 'headUpper', 'headMiddle', 'headLower', 'armor', 'garment', 'boot', 'accLeft', 'accRight',
  'shadowWeapon', 'shadowShield', 'shadowArmor', 'shadowBoot', 'shadowEarring', 'shadowPendant',
] as const;

const GRADES = ['', 'D', 'C', 'B', 'A'] as const;

export function registerOptimizationTools(server: McpServer, dataset: Dataset, shortener?: Shortener): void {
  registerJsonTool<{
    build: BuildInput;
    target?: TargetArg;
    effects?: string[];
    variants: { label: string; patch: BuildPatch }[];
    metrics?: Metric[];
    require?: z.infer<typeof requireSchema>[];
    sortBy?: Metric;
    limit?: number;
  }>(server, 'evaluate_variants', {
    title: 'Avaliar variantes de uma build',
    description:
      'USE para testar hipóteses que você já tem (dezenas de trocas de uma vez, em uma chamada). NÃO use para descobrir candidatos: para isso `scan_slot` ou `optimize_build`. ' +
      'Resolve de uma vez várias variações de uma mesma build (trocar peça, carta, encantamento, buff, atributo, habilidade) e devolve as métricas de cada uma, ordenadas. ' +
      'Cada variante é só o que muda: `patch` tem o mesmo formato dos overrides de `build` e mescla por chave sobre a base. ' +
      '`require` descarta quem não cumpre um piso ou teto (ex.: hp mínimo). `rotationDps` usa a `rotation` da build. ' +
      `Máximo de ${config.limits.maxVariants} variantes por chamada.`,
    inputSchema: {
      build: compactBuildSchema,
      target: targetSchema,
      effects: z.array(z.string()).optional().describe('Efeitos de proc a ativar em todas as variantes (veja `availableEffects` de `calculate`).'),
      variants: z.array(variantSchema).min(1),
      metrics: z.array(metricEnum).optional().describe(`O que devolver. Padrão: ${DEFAULT_METRICS.join(', ')}.`),
      require: z.array(requireSchema).optional(),
      sortBy: metricEnum.optional().describe('Métrica de ordenação (maior primeiro). Padrão: dps.'),
      limit: z.number().int().min(1).max(50).optional().default(10),
    },
  }, async ({ build, target, effects = [], variants, metrics, require: rules = [], sortBy = 'dps', limit = 10 }) => {
    if (variants.length > config.limits.maxVariants) {
      throw new Error(`No máximo ${config.limits.maxVariants} variantes por chamada (recebi ${variants.length}). Divida em lotes.`);
    }
    const shown: Metric[] = [...new Set<Metric>([...(metrics ?? DEFAULT_METRICS), sortBy])];
    const wanted: Metric[] = [...new Set<Metric>([...shown, ...rules.map((r) => r.metric)])];

    const base = decodeOnce(await normalizeShare(build, shortener));
    const { monster } = resolveTarget(dataset, target?.monsterId);
    const baseline = evaluate(base, undefined, dataset, monster, effects, wanted);

    const scored: { label: string; rb: ResolvedBuild; metrics: Metrics }[] = [];
    const errors: { label: string; error: string }[] = [];
    let belowRequire = 0;
    for (const variant of variants) {
      try {
        const { rb, metrics: values } = evaluate(base, variant.patch, dataset, monster, effects, wanted);
        if (meets(values, rules)) scored.push({ label: variant.label, rb, metrics: values });
        else belowRequire++;
      } catch (error) {
        errors.push({ label: variant.label, error: error instanceof Error ? error.message : String(error) });
      }
    }

    scored.sort((a, b) => (b.metrics[sortBy] ?? -Infinity) - (a.metrics[sortBy] ?? -Infinity));

    return json({
      sortedBy: sortBy,
      baseline: roundMetrics(baseline.metrics, shown),
      tested: variants.length,
      results: scored.slice(0, limit).map((entry, rank) =>
        compact({
          label: entry.label,
          metrics: roundMetrics(entry.metrics, shown),
          deltaPct: Object.fromEntries(shown.map((k) => [k, deltaPct(entry.metrics[k], baseline.metrics[k])])),
          warnings: entry.rb.warnings.length ? entry.rb.warnings : undefined,
          emptySockets: emptySocketsOf(dataset, baseline.rb, entry.rb),
          // A link costs a compression pass, so only the front of the ranking gets one.
          share: rank < 3 ? shareOf(entry.rb) : undefined,
        }),
      ),
      discarded: { belowRequire, invalid: errors.length },
      ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
      ...(baseline.rb.warnings.length ? { warnings: baseline.rb.warnings } : {}),
    });
  });


  registerJsonTool<{
    build: BuildInput;
    slot: string;
    target?: TargetArg;
    effects?: string[];
    objective?: Metric;
    profile?: Profile;
    base?: 'current' | 'tuned';
    query?: string;
    limit?: number;
    topSockets?: number;
    refine?: number;
    maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
    maxSolves?: number;
  }>(server, 'scan_slot', {
    title: 'Varrer um slot inteiro',
    description:
      'USE para achar a peça improvável de um slot ou conferir se algo fora do óbvio vence. NÃO use para montar a build inteira (`optimize_build`) nem para comparar poucos ids (`optimize_slot`). ' +
      'Mede, com o motor real, TODOS os itens do LATAM que a classe e o nível podem usar naquele slot (centenas, em segundos), sem filtrar por palavra-chave: ' +
      'serve para achar a peça improvável que nenhuma busca por bônus traria. O resto da build fica como está no link. ' +
      '`base: "tuned"` (padrão) compara contra a peça atual já com os melhores cartas, encantamentos e rolagens; `"current"` compara contra ela como veio. ' +
      'Os `topSockets` melhores da varredura nua recebem a busca de cartas, encantamentos e rolagens catalogadas e o ranking final usa esses valores. ' +
      'Cada linha traz os parceiros de conjunto (outros slots) para testar em `evaluate_variants`. Refino e grau seguem o padrão ideal (+12, A) ou os tetos passados.',
    inputSchema: {
      build: compactBuildSchema,
      slot: z.string().describe('Slot a varrer, ex.: "weapon", "armor", "boot", "accLeft", "headMiddle".'),
      target: targetSchema,
      effects: z.array(z.string()).optional(),
      objective: metricEnum.optional().describe('O que maximizar. Padrão: o do `profile`.'),
      profile: z.enum(['sustained', 'burst']).optional().describe('`sustained` (padrão) ou `burst`; veja `optimize_build`.'),
      base: z.enum(['current', 'tuned']).optional().default('tuned'),
      query: z.string().optional().describe('Restringe a varredura a itens cujo nome contém o texto.'),
      limit: z.number().int().min(1).max(40).optional().default(15),
      topSockets: z.number().int().min(0).max(25).optional().default(12).describe('Quantos dos melhores recebem a busca de soquetes e rolagens. 0 = só a varredura nua.'),
      refine: z.number().int().min(0).max(20).optional().describe('Refino testado. Padrão +12.'),
      maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional().describe('Grau testado. Padrão A.'),
      maxSolves: z.number().int().min(10).optional().describe('Teto de cálculos desta chamada; o servidor impõe o dele.'),
    },
  }, async ({ build, slot, target, effects = [], objective: objectiveArg, profile = 'sustained', base: baseMode = 'tuned', query, limit = 15, topSockets = 12, refine, maxGrade, maxSolves }) => {
    if (!MAIN_ITEM_SLOTS.includes(slot)) throw new Error(`"${slot}" não é um slot de equipamento. Use um destes: ${MAIN_ITEM_SLOTS.join(', ')}.`);
    const budget = Math.min(maxSolves ?? config.limits.maxSolves, config.limits.maxSolves);
    const pace = pacing(config.limits.maxSearchMs);
    const input = decodeOnce(await normalizeShare(build, shortener));
    const { monster } = resolveTarget(dataset, target?.monsterId);
    const hasRotation = (((resolveBuild(input, dataset).model as { rotation?: string[] }).rotation) ?? []).length > 0;
    const objective: Metric = objectiveArg ?? objectiveFor(profile, hasRotation);
    const wanted: Metric[] = [objective, 'dps', 'max'];
    const baseline = evaluate(input, undefined, dataset, monster, effects, wanted);
    const baseValue = baseline.metrics[objective];
    if (!baseValue) throw new Error(`A build não produz ${objective} para varrer.`);

    const rb = baseline.rb;
    const worn = (rb.model as Record<string, any>)[slot] as number;
    const canWear = canUsedByClass(rb.char);
    const found = dataset.itemIndex.search({ slot: slot as SlotTag, maxLevel: rb.model.level, inCalcDb: true, limit: 4000, query }, rb.char).rows
      .map((row) => row.id)
      .filter((id) => dataset.items[id] && canWear(dataset.items[id]) && (dataset.items[id].requiredLevel ?? 0) <= rb.model.level);

    const keys = relevantKeys(baseline.solved.calc);
    const skillId = SKILL_ID_BY_NAME[String(rb.model.selectedAtkSkill ?? '').split('==')[0] as keyof typeof SKILL_ID_BY_NAME];
    if (skillId) keys.push(String(skillId), `cd__${skillId}`, `chance__${skillId}`);

    let solves = 1;
    let stopped = false;
    const run = (patch: BuildPatch) => {
      if (solves >= budget || pace.timeUp()) { stopped = true; return null; }
      solves++;
      try { return evaluate(input, patch, dataset, monster, effects, wanted); } catch { return null; }
    };

    // 1) Every candidate, bare (the ideal refine and grade, no sockets).
    const bare: { id: number; patch: BuildPatch; value: number }[] = [];
    for (const id of found) {
      await pace.breathe();
      const patch = swapPatch(dataset, rb, slot, id, { refine, maxGrade });
      const result = run(patch);
      const value = result?.metrics[objective];
      if (result && value !== undefined) bare.push({ id, patch, value });
      if (stopped) break;
    }
    bare.sort((a, b) => b.value - a.value);

    // 2) Sockets. Ranking the bare pieces cannot see a piece whose value is in its cards and enchants (a Soqueira Vil Invernal is
    //    "equal" to the Invernal until it is enchanted), so it is done in two stages: a quick pass over every piece that has
    //    sockets or enchants and is not hopeless bare, then the full search on the best of those.
    const tune = (id: number, patch: BuildPatch, value: number, effort: number) => {
      const first = run(patch);
      if (!first) return { patch, value, result: undefined };
      const tuned = searchComplements({ patch, result: first }, complementChoices(dataset, slot, id, keys, new Set()), objective, (candidate) => run(candidate), effort);

      return { patch: tuned.patch, value: tuned.result.metrics[objective] ?? value, result: tuned.result };
    };
    const hasSockets = (id: number) => {
      const item = dataset.items[id];
      const pools = enchantPoolsFor(item) as (string[] | null | undefined)[] | undefined;

      return (item?.slots ?? 0) > 0 || !!pools?.some((pool) => pool?.length);
    };
    const bestBare = bare[0]?.value ?? 0;
    const QUICK_LIMIT = 60;
    const quickPool = [...new Map([
      ...bare.slice(0, topSockets),
      ...bare.filter((entry) => hasSockets(entry.id) && entry.value >= 0.4 * bestBare).slice(0, QUICK_LIMIT),
    ].map((entry) => [entry.id, entry])).values()];
    let finalists = bare.slice(0, topSockets);
    if (topSockets > 0) {
      const quick: { id: number; patch: BuildPatch; value: number }[] = [];
      for (const entry of quickPool) {
        await pace.breathe();
        const out = tune(entry.id, entry.patch, entry.value, 8);
        quick.push({ id: entry.id, patch: entry.patch, value: out.value });
      }
      quick.sort((a, b) => b.value - a.value);
      finalists = quick.slice(0, topSockets);
    }
    if (worn > 0 && !finalists.some((entry) => entry.id === worn)) {
      const wornPatch = swapPatch(dataset, rb, slot, worn, { refine, maxGrade });
      const first = run(wornPatch);
      if (first && first.metrics[objective] !== undefined) finalists.push({ id: worn, patch: wornPatch, value: first.metrics[objective]! });
    }
    const bareOf = new Map(bare.map((entry) => [entry.id, entry.value]));
    const tunedRows: { id: number; patch: BuildPatch; value: number; bare: number }[] = [];
    for (const entry of finalists) {
      await pace.breathe();
      const out = topSockets > 0 ? tune(entry.id, bare.find((candidate) => candidate.id === entry.id)?.patch ?? entry.patch, entry.value, 24) : { patch: entry.patch, value: entry.value };
      tunedRows.push({ id: entry.id, patch: out.patch, value: out.value, bare: bareOf.get(entry.id) ?? entry.value });
    }
    const wornRow = tunedRows.find((row) => row.id === worn);
    const reference = baseMode === 'tuned' && wornRow ? wornRow.value : baseValue;
    tunedRows.sort((a, b) => b.value - a.value);
    const partners = partnerIndex(dataset);

    const top = tunedRows.slice(0, limit).map((row) => {
      const gear = (row.patch.gear ?? {}) as Record<string, unknown>;
      const sockets = relatedItemKeys(slot).flatMap((key) => typeof gear[key] === 'number' ? [`${key}: ${dataset.itemIndex.get(gear[key] as number)?.name ?? gear[key]}`] : []);
      const setPartners = partners.of(row.id).flatMap((partner) => {
        const partnerSlot = partners.slotOf(partner);
        return partnerSlot && partnerSlot !== slot ? [{ id: partner, name: dataset.itemIndex.get(partner)?.name, slot: partnerSlot }] : [];
      }).slice(0, 3);

      return compact({
        id: row.id,
        name: dataset.itemIndex.get(row.id)?.name,
        value: round(row.value, 2),
        deltaPct: deltaPct(row.value, reference),
        bare: topSockets > 0 ? round(row.bare, 2) : undefined,
        worn: row.id === worn ? true : undefined,
        sockets: sockets.length ? sockets : undefined,
        partners: setPartners.length ? setPartners : undefined,
      });
    });

    return json({
      slot,
      objective,
      reference: { item: worn ? itemLabel(dataset, worn) : null, value: round(reference, 2), basis: baseMode === 'tuned' && wornRow ? 'peça atual com os melhores soquetes' : 'build como veio no link' },
      scanned: bare.length,
      eligible: found.length,
      ranking: top,
      share: shareOf(rb),
      context: damageContext(baseline.solved.calc),
      solves,
      ...(stopped ? { stopped: `orçamento de cálculos ou de tempo esgotado (${solves} de ${budget}): ${found.length - bare.length} itens não foram medidos. Use \`query\` para restringir ou aumente \`maxSolves\`.` } : {}),
      note: 'Cada item entra no resto da build como ela está; conjuntos que dependem de outro slot aparecem em `partners` e só valem testados juntos (`evaluate_variants` ou `optimize_build` com `pairs`).',
    });
  });

  registerJsonTool<{
    build: BuildInput;
    target?: TargetArg;
    effects?: string[];
    parts?: ('stages' | 'contributions' | 'warnings')[];
    metric?: 'dps' | 'max' | 'rotationDps';
    maxContributions?: number;
  }>(server, 'explain_damage', {
    title: 'Explicar o dano de uma build',
    description:
      'USE para entender uma build antes de mexer nela: onde está o dano, o que cada peça vale, o que o número não conta e, com `upgrades`, onde investir refino, grau ou encantamento. NÃO use para buscar trocas. ' +
      'Mostra de onde vem o dano: `stages` são as etapas da fórmula com o valor depois de cada uma; `contributions` diz quanto a métrica cai se cada peça, carta, buff, passiva ou consumível sair ' +
      '(retirar uma peça também desfaz os conjuntos e combos dela); `warnings` aponta efeitos que o número não conta — itens com script vazio e procs não ativados, com o ganho de ativá-los.',
    inputSchema: {
      build: compactBuildSchema,
      target: targetSchema,
      effects: z.array(z.string()).optional(),
      parts: z.array(z.enum(['stages', 'contributions', 'warnings', 'refine', 'upgrades'])).optional().describe('Padrão: stages, contributions e warnings. `upgrades` ordena o que vale mais investir: refino, grau, nível de cada encantamento e encantar um soquete vazio. `refine` mostra o ganho de +1 e +2 refinos em cada peça (custo: uma conta por peça e nível).'),
      metric: z.enum(['dps', 'max', 'rotationDps']).optional().describe('Em que medir as contribuições. Padrão: dps.'),
      maxContributions: z.number().int().min(1).max(100).optional().default(25),
    },
  }, async ({ build, target, effects = [], parts, metric = 'dps', maxContributions = 25 }) => {
    const want = new Set(parts ?? ['stages', 'contributions', 'warnings']);
    const base = decodeOnce(await normalizeShare(build, shortener));
    const { monster } = resolveTarget(dataset, target?.monsterId);

    const baseline = evaluate(base, undefined, dataset, monster, effects, [metric, 'max']);
    const out: Record<string, unknown> = { metric, value: round(baseline.metrics[metric] ?? 0, 2) };

    if (want.has('stages')) {
      const trace = (baseline.solved.calc.getTotalSummary() as any).dmg?.skillFormulaTrace;
      out['stages'] = (trace?.max ?? []).map((step: any) => compact({ label: step.label, value: step.value, keys: step.keys }));
    }

    if (want.has('contributions')) out['contributions'] = contributions(base, baseline.rb, baseline.metrics[metric], metric, monster, effects, dataset, maxContributions);

    if (want.has('refine')) out['refine'] = refineGains(base, baseline.rb, baseline.metrics[metric], metric, monster, effects, dataset);

    if (want.has('upgrades')) out['upgrades'] = upgradeGains(base, baseline.rb, baseline.metrics[metric], metric, monster, effects, dataset, relevantKeys(baseline.solved.calc));

    if (want.has('warnings')) out['warnings'] = await notModelled(baseline.rb, baseline.solved.calc, baseline.metrics['max'], base, dataset, monster, effects);

    return json(out);
  });

  registerJsonTool<{
    build: BuildInput;
    target?: TargetArg;
    targets?: { monsterId: number; weight?: number }[];
    effects?: string[];
    objective?: Metric;
    profile?: Profile;
    slots?: string[];
    lock?: string[];
    exclude?: number[];
    candidates?: Record<string, number[]>;
    combos?: boolean;
    pairs?: string[][];
    countProcs?: boolean;
    procHitsPerSecond?: number;
    levelChecks?: boolean;
    detail?: boolean;
    complements?: boolean;
    refine?: number;
    maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
    candidatesPerSlot?: number;
    rounds?: number;
    maxSolves?: number;
    require?: z.infer<typeof requireSchema>[];
  }>(server, 'optimize_build', {
    title: 'Procurar uma build melhor',
    description:
      'USE como primeira resposta para melhorar uma build inteira (peças, cartas, encantamentos, rolagens, refino e grau). NÃO use para um slot só com candidatos conhecidos (`optimize_slot`), nem para varrer tudo de um slot (`scan_slot`), nem para atributos (`optimize_stats`). ' +
      'Percorre os slots de equipamento trocando a peça que mais melhora a métrica e repete até nada melhorar (subida de encosta). ' +
      'Testa equipamentos e seus complementos legais: cartas por categoria, encantamentos por posição e bônus aleatórios de catálogos regionais. ' +
      'Com `combos` (padrão) também testa trocas de **duas peças juntas** quando o script de uma cita a outra (conjuntos), que uma troca isolada não enxerga. ' +
      '`targets` mede contra vários monstros com peso (ex.: um Médio e um Grande: a penalidade de tamanho só aparece no Grande); `candidates` fixa os itens a testar num slot; ' +
      '`lock` trava slots, `exclude` proíbe itens, `require` impõe pisos (ex.: hp mínimo). Devolve o caminho das trocas com o ganho de cada uma e um `patch` pronto para `evaluate_variants`. ' +
      '`pairs` testa dois slots trocados juntos mesmo sem conjunto que os ligue. `procs` na resposta mostra o ganho de cada proc ainda não contado (passe-o em `effects` para a busca contá-lo). '
      + 'Busca heurística limitada pelo orçamento, sem garantia global. Pools aleatórios desconhecidos não são inventados. Confira a cobertura e o orçamento retornados.',
    inputSchema: {
      build: compactBuildSchema,
      target: targetSchema,
      targets: z.array(z.object({ monsterId: z.number().int(), weight: z.number().positive().optional() })).min(1).max(5).optional()
        .describe('Alvos com peso (padrão 1). Vale para max, min e dps; as demais métricas não dependem do alvo.'),
      effects: z.array(z.string()).optional(),
      objective: metricEnum.optional().describe('O que maximizar. Padrão: o do `profile`.'),
      profile: z.enum(['sustained', 'burst']).optional().describe('Que tipo de build buscar. `sustained` (padrão): o ciclo da rotação em regime, onde ASPD, conjuração e pós-conjuração contam (`rotationDps`, ou `dps` sem rotação). `burst`: a abertura da rotação com as recargas livres (`burstDps`, ou `avgHit` sem rotação). A resposta traz os dois perfis para a build base e a final.'),
      slots: z.array(z.string()).optional().describe('Slots a percorrer. Padrão: equipamentos e peças sombrias.'),
      lock: z.array(z.string()).optional().describe('Slots que não mudam.'),
      exclude: z.array(z.number().int()).optional().describe('Ids de itens que não podem entrar.'),
      candidates: z.record(z.string(), z.array(z.number().int()).max(60)).optional().describe('Itens a testar por slot, no lugar da seleção automática. Ex.: { "boot": [470069, 470115, 470094] }.'),
      combos: z.boolean().optional().default(true).describe('Testar também trocas de duas peças ligadas por um conjunto.'),
      pairs: z.array(z.tuple([z.string(), z.string()])).max(6).optional().describe('Pares de slots a trocar juntos mesmo sem conjunto que os ligue, ex.: [["garment","boot"]]. Testa os melhores candidatos de cada slot em todas as combinações, depois da busca normal.'),
      detail: z.boolean().optional().default(false).describe('Resposta completa: contexto do alvo, candidatos por slot (ids), alternativas que perderam, as notas que explicam cada bloco e o resumo da busca de complementos (centenas de tokens a mais). O padrão traz só os números, o caminho e os `alerts`.'),
      levelChecks: z.boolean().optional().default(true).describe('Para as peças que mudaram, compara a nova com a atual no refino e grau que você tem hoje e também nos ideais (`levelCheck`): mostra a peça que só vence evoluída, ou que vence agora e perde depois. false economiza cálculos.'),
      procHitsPerSecond: z.number().min(0.1).max(30).optional().describe('Ataques por segundo para estimar a média dos procs (cada ataque rola a chance). Sem isso, mostra 1, 3 e 5 por segundo; mais alvos atingidos por habilidade em área contam como mais ataques.'),
      countProcs: z.boolean().optional().default(false).describe('Conta, em cada build testada, todos os procs que ela oferece (inclusive os de peças recém-trocadas), em vez de só os de `effects`. Dobra o custo dos cálculos de builds com procs.'),
      complements: z.boolean().optional().default(true).describe('Buscar também cartas, encantamentos e rolagens catalogadas. false preserva a busca somente de peças.'),
      refine: z.number().int().min(0).max(20).optional().describe('Refino das peças testadas (inclusive as que a build já usa). Padrão: +12, o teto alcançável (acima disso é endgame alto); informe um valor, até +20, para mudar.'),
      maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional().describe('Teto de grau. Padrão: grau A, o ideal, nas peças que aceitam grau (inclusive as que a build já usa). Informe só para limitar: então testa sem grau e todos os graus até o teto, e a build base também deve respeitá-lo.'),
      candidatesPerSlot: z.number().int().min(1).max(60).optional().default(12),
      rounds: z.number().int().min(1).max(4).optional().default(2),
      maxSolves: z.number().int().min(10).optional().describe('Teto de cálculos desta chamada; o servidor impõe o dele.'),
      require: z.array(requireSchema).optional(),
    },
  }, async ({ build, target, targets, effects = [], objective: objectiveArg, profile = 'sustained', slots, lock = [], exclude = [], candidates, combos = true, pairs = [], countProcs = false, procHitsPerSecond, levelChecks = true, detail = false, complements = true, refine, maxGrade, candidatesPerSlot = 12, rounds = 2, maxSolves, require: rules = [] }) => {
    const requestedBudget = Math.min(maxSolves ?? config.limits.maxSolves, config.limits.maxSolves);
    const pace = pacing(config.limits.maxSearchMs);
    const base = decodeOnce(await normalizeShare(build, shortener));
    const hasRotation = (((resolveBuild(base, dataset).model as { rotation?: string[] }).rotation) ?? []).length > 0;
    const objective: Metric = objectiveArg ?? objectiveFor(profile, hasRotation);
    // A rotation costs a calculation per step: search on the chosen skill's DPS and measure only the finalists on the real objective.
    const proxy: Metric | undefined = objective === 'rotationDps' || objective === 'burstDps' ? 'dps' : undefined;
    const rankMetric: Metric = proxy ?? objective;
    const profileObjectives = { sustained: objectiveFor('sustained', hasRotation), burst: objectiveFor('burst', hasRotation) };
    const shown: Metric[] = [...new Set<Metric>([objective, 'max', 'dps', 'hp'])];
    const wanted: Metric[] = [...new Set<Metric>([...shown, ...rules.map((r) => r.metric)])];
    const searchWanted: Metric[] = proxy ? [...new Set<Metric>([...wanted.filter((metric) => metric !== objective), proxy])] : wanted;

    const aims = (targets ?? [{ monsterId: target?.monsterId ?? config.defaultTargetId }]).map((aim) => ({
      monster: resolveTarget(dataset, aim.monsterId).monster,
      weight: (aim as { weight?: number }).weight ?? 1,
    }));
    const monster = aims[0].monster;
    const more = aims.slice(1);
    const baseline = evaluate(base, undefined, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
    // The search is capped by time as well as by calculations, and a calculation costs 6 ms or 45 ms depending on the build (a
    // rotation solves every step). Size the budget to what fits, so the effort is spread over the slots instead of the clock
    // cutting the walk short after the first ones.
    const probeStart = Date.now();
    evaluate(base, undefined, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
    const msPerCalculation = Math.max(1, Date.now() - probeStart);
    const budget = Math.min(requestedBudget, Math.max(80, Math.floor((0.8 * config.limits.maxSearchMs) / msPerCalculation)));
    const gradeLimit = maxGrade === 'none' ? 0 : GRADES.indexOf(maxGrade as typeof GRADES[number]);
    if (maxGrade !== undefined) {
      const above = MAIN_ITEM_SLOTS.filter(slot => GRADES.indexOf(baseline.rb.model[`${slot}Grade`] ?? '') > gradeLimit);
      if (above.length) throw new Error(`A build base excede o grau máximo ${maxGrade}: ${above.join(', ')}. Ajuste os graus da base antes da busca; slots travados também devem respeitar o teto.`);
    }
    const baseValue = baseline.metrics[objective];
    if (!baseValue) throw new Error(`A build não produz ${objective} para otimizar.`);

    const locked = new Set(lock);
    const walk = (slots ?? SEARCH_SLOTS).filter((slot) => !locked.has(slot));
    const badPair = pairs.find(([a, b]) => a === b || ![a, b].every(slot => walk.includes(slot)));
    if (badPair) throw new Error(`Par ${badPair.join('+')} inválido: dois slots diferentes, ambos entre os percorridos e não travados.`);
    const unknown = [...walk, ...Object.keys(candidates ?? {})].filter((slot) => !MAIN_ITEM_SLOTS.includes(slot));
    if (unknown.length) throw new Error(`Não são slots de equipamento: ${unknown.join(', ')}. Use: ${MAIN_ITEM_SLOTS.join(', ')}.`);

    // Candidates are fixed once, from the baseline's own formula: which items could matter, best-matching first.
    const keys = relevantKeys(baseline.solved.calc, aims.map(aim => aim.monster));
    const skillId = SKILL_ID_BY_NAME[String(baseline.rb.model.selectedAtkSkill ?? '').split('==')[0] as keyof typeof SKILL_ID_BY_NAME];
    if (skillId) keys.push(String(skillId), `cd__${skillId}`, `chance__${skillId}`);
    const banned = new Set(exclude);
    const partners = partnerIndex(dataset);
    const skippedNotInLatam: number[] = [];
    const complementPools = new Map<string, BuildPatch[][]>();
    const complementsFor = (slot: string, id: number) => {
      const key = `${slot}:${id}`;
      if (!complementPools.has(key)) complementPools.set(key, complementChoices(dataset, slot, id, keys, banned));
      return complementPools.get(key)!;
    };
    const canWear = canUsedByClass(baseline.rb.char);
    const eligible = (id: number, slot: string) => {
      const item = dataset.items[id];
      return !!item && canWear(item) && (item.requiredLevel ?? 0) <= baseline.rb.model.level
        && !!dataset.itemIndex.get(id)?.latam
        && !!dataset.itemIndex.get(id)?.slotTags.includes(slot as SlotTag);
    };
    const pools = new Map<string, number[]>();
    for (const slot of walk) {
      const worn = baseline.rb.model[slot];
      if (candidates?.[slot]) {
        skippedNotInLatam.push(...candidates[slot].filter((id) => !dataset.itemIndex.get(id)?.latam));
        pools.set(slot, candidates[slot].filter((id) => (id !== worn || maxGrade === undefined || canGradeItem(dataset.items[id])) && !banned.has(id) && eligible(id, slot)));
        continue;
      }
      const common = { slot: slot as SlotTag, maxLevel: baseline.rb.model.level, inCalcDb: true, limit: 400 };
      const found = new Map<number, ItemRow>();
      const searches = [dataset.itemIndex.search({ ...common, bonus: keys, bonusMode: 'any' }, baseline.rb.char)];
      if (skillId) searches.push(dataset.itemIndex.search({ ...common, skill: String(skillId) }, baseline.rb.char));
      for (const { rows } of searches) for (const row of rows) found.set(row.id, row);

      const matches = (id: number): number => Object.keys(dataset.items[id]?.script ?? {}).filter((key) => keys.includes(key)).length;
      const ranked = [...found.values()]
        .filter((row) => row.id !== worn && !banned.has(row.id))
        .sort((a, b) => matches(b.id) - matches(a.id) || (b.reqLv ?? 0) - (a.reqLv ?? 0))
        .slice(0, candidatesPerSlot)
        .map((row) => row.id);
      // Upgrades of the worn piece: the same script at a higher level (Soqueira Invernal → Vil Invernal) differs only in sockets and
      // enchants, which no script key shows, so the keyword search never offers it.
      const wornScript = worn > 0 ? JSON.stringify(dataset.items[worn]?.script ?? {}) : '';
      if (wornScript && wornScript !== '{}') {
        const wornLevel = dataset.items[worn]?.requiredLevel ?? 0;
        const siblings = dataset.itemIndex.search({ ...common, limit: 4000 }, baseline.rb.char).rows
          .filter((row) => row.id !== worn && !ranked.includes(row.id) && !banned.has(row.id) && (row.reqLv ?? 0) >= wornLevel
            && JSON.stringify(dataset.items[row.id]?.script ?? {}) === wornScript && dataset.items[row.id]?.attack === dataset.items[worn]?.attack)
          .sort((a, b) => (b.reqLv ?? 0) - (a.reqLv ?? 0)).slice(0, 3).map((row) => row.id);
        ranked.push(...siblings);
      }
      pools.set(slot, ranked);
      if ((maxGrade === undefined || canGradeItem(dataset.items[worn])) && worn > 0 && !banned.has(worn)) ranked.unshift(worn);
    }

    // A piece the build already wears can name a partner that completes a set (the Garra Primordial-LT
    // names the Bota Primordial-LT): that partner is a candidate for its own slot, whatever its own script says.
    if (combos && !candidates) {
      for (const key of ITEM_ID_KEYS) {
        const id = baseline.rb.model[key];
        if (typeof id !== 'number' || id <= 0) continue;
        for (const partner of partners.of(id)) {
          const slot = partners.slotOf(partner);
          if (slot && walk.includes(slot) && eligible(partner, slot) && baseline.rb.model[slot] !== partner && !banned.has(partner) && !pools.get(slot)?.includes(partner)) pools.get(slot)!.push(partner);
        }
      }
    }

    interface Move { anchor: string; changes: [string, number][]; grades: Record<string, string> }
    /** One move per grade combination the cap allows; a new item never inherits the old item's grade. */
    const expandMove = (anchor: string, changes: [string, number][]): Move[] => {
      let variants: Record<string, string>[] = [{}];
      for (const [slot, item] of changes) {
        // No cap given: the ideal, grade A (a higher grade never takes a bonus away). A cap: every grade up to it.
        const grades = canGradeItem(dataset.items[item]) ? (maxGrade !== undefined ? GRADES.slice(0, gradeLimit + 1) : ['A'])
          : [rb.model[slot] === item ? rb.model[`${slot}Grade`] ?? '' : ''];
        variants = variants.flatMap(v => grades.map(grade => ({ ...v, [slot]: grade })));
      }
      return variants.map(grades => ({ anchor, changes, grades }));
    };
    const movesFor = (anchor: string): Move[] => {
      const moves: Move[] = [];
      const seen = new Set<string>();
      const add = (changes: [string, number][]) => {
        for (const move of expandMove(anchor, changes)) {
          // The worn piece at its own refine and grade is the baseline: only worth a calculation when its sockets are searched.
          if (!complements && move.changes.every(([slot, item]) => rb.model[slot] === item && (refineFor(slot, item) === undefined || rb.model[`${slot}Refine`] === refineFor(slot, item))
            && move.grades[slot] === (rb.model[`${slot}Grade`] ?? ''))) continue;
          const id = move.changes.map(([slot, item]) => `${slot}:${item}:${move.grades[slot]}`).sort().join('|');
          if (!seen.has(id)) { seen.add(id); moves.push(move); }
        }
      };
      for (const item of [...new Set([...(complements && baseline.rb.model[anchor] ? [baseline.rb.model[anchor]] : []), ...(pools.get(anchor) ?? [])])]) {
        add([[anchor, item]]);
        if (!combos) continue;
        for (const partner of partners.of(item)) {
          const slot = partners.slotOf(partner);
          if (slot && slot !== anchor && walk.includes(slot) && eligible(partner, slot) && !banned.has(partner)) add([[anchor, item], [slot, partner]]);
        }
      }

      return moves;
    };

    /** The ideal refine unless the caller capped it; pieces with no refine field are left alone. */
    const refineFor = (target: string, item: number): number | undefined => refine ?? (`${target}Refine` in rb.model
      ? (rb.model[target] === item ? Math.max(REACHABLE_REFINE, rb.model[`${target}Refine`] ?? 0) : REACHABLE_REFINE) : undefined);
    const patchFor = (move: Move): BuildPatch => ({
      gear: Object.fromEntries(move.changes.flatMap(([target, id]) => [
        [target, id],
        ...(refineFor(target, id) !== undefined ? [[`${target}Refine`, refineFor(target, id)]] : []),
        // A new item is not automatically the old item's grade.
        ...(`${target}Grade` in rb.model || canGradeItem(dataset.items[id]) ? [[`${target}Grade`, move.grades[target]]] : []),
        ...keptSockets(dataset, rb, target, id).clear.map((key) => [key, null]),
      ])),
      options: Object.fromEntries(move.changes.flatMap(([target, id]) => rb.model[target] === id ? []
        : (ItemOptionMap.get(target as ItemTypeEnum) ?? []).map(index => [String(index), null]))),
    });

    let solves = 1;
    const outOfBudget = () => solves >= budget || pace.timeUp();
    let current = base;
    let value = baseValue;
    let metrics = baseline.metrics;
    let rb = baseline.rb;
    let changes: BuildPatch = { gear: {} };
    const steps: Record<string, unknown>[] = [];
    /** For each slot, how its alternatives scored the last time the slot was evaluated: what lost, and by how much. */
    const considered = new Map<string, { to: [string, number][]; grades: Record<string, string>; value: number; against: number }[]>();
    let exhausted = false;

    type Chosen = { move: Move; patch: BuildPatch; value: number; metrics: Metrics; rb: ResolvedBuild };
    const accept = (best: Chosen) => {
      const swaps = best.move.changes.map(([target, id]) => {
        const from = rb.model[target];
        const { dropped } = keptSockets(dataset, rb, target, id);

        return {
          slot: target,
          from: from ? itemLabel(dataset, from, rb.model[`${target}Grade`]) : null,
          to: itemLabel(dataset, id, best.move.grades[target]),
          ...(dropped.length ? { dropped } : {}),
        };
      });
      steps.push({
        ...(swaps.length > 1 ? { combo: swaps } : swaps[0]),
        gainPct: deltaPct(best.value, value),
        totalPct: deltaPct(best.value, baseValue),
      });
      current = applyPatch(current, best.patch);
      changes = applyPatch(changes, best.patch);
      value = best.value;
      metrics = best.metrics;
      rb = best.rb;
    };

    // The build only changes when a move is accepted. A slot already searched against the current build, and a combined
    // move already solved against it from another slot, would give the same numbers again: skip them (exact, not a cut).
    let version = 0;
    const searchedAt = new Map<string, number>();
    const solvedMoves = new Set<string>();
    const moveKey = (move: Move) => move.changes.map(([slot, item]) => `${slot}:${item}:${move.grades[slot]}`).sort().join('|');

    // Round -1 tunes what the build already wears (best cards, enchants and catalogued rolls) before anything is compared with it:
    // otherwise a worn piece the link left bare loses to a replacement that the walk happened to reach first.
    for (let round = complements ? -1 : 0; round < rounds && !exhausted; round++) {
      const tuning = round < 0;
      let improved = false;
      for (const [slotIndex, slot] of walk.entries()) {
        if (searchedAt.get(slot) === version) continue;
        let best: Chosen | null = null;
        const seen: { to: [string, number][]; grades: Record<string, string>; value: number; against: number }[] = [];
        if (!tuning) considered.set(slot, seen);
        const moves = tuning ? movesFor(slot).filter((move) => move.changes.length === 1 && move.changes[0][1] === rb.model[slot]) : movesFor(slot);
        if (!moves.length) continue;
        const remainingSlots = walk.length - slotIndex + (rounds - round - 1) * walk.length;
        const share = Math.max(0, Math.floor((budget - solves) / Math.max(1, remainingSlots)));
        // Three stages, so every candidate is judged with the same care as the piece it competes with: all of them bare, a quick
        // search of sockets and rolls for the best dozen, the full search for the best few. A small even share for each candidate
        // (what this used to give) cannot find the right enchant among eight, and the worn piece, which had the full search, won.
        const quickEffort = tuning ? 0 : Math.max(4, Math.min(8, Math.floor(share / (2 * Math.max(1, Math.min(12, moves.length))))));
        const fullEffort = Math.max(0, Math.min(48, tuning ? share - 1 : Math.floor(share / 4)));
        const solveFor = (candidatePatch: BuildPatch) => {
          if (outOfBudget()) { exhausted = true; return null; }
          solves++;
          try { return evaluate(current, candidatePatch, dataset, monster, effects, searchWanted, more, aims[0].weight, countProcs); } catch { return null; }
        };
        type Tried = ReturnType<typeof evaluate>;
        const entries: { move: Move; patch: BuildPatch; tried: Tried; fields: BuildPatch[][] }[] = [];
        for (const move of moves) {
          await pace.breathe();
          const key = moveKey(move);
          if (solvedMoves.has(key)) continue;
          if (outOfBudget()) { exhausted = true; break; }
          solves++;
          solvedMoves.add(key);
          try {
            const patch = patchFor(move);
            const tried = evaluate(current, patch, dataset, monster, effects, searchWanted, more, aims[0].weight, countProcs);
            entries.push({ move, patch, tried, fields: complements ? move.changes.flatMap(([target, id]) => complementsFor(target, id)) : [] });
          } catch {
            /* a candidate that does not resolve is simply not a candidate */
          }
        }
        const valueOf = (entry: { tried: Tried }) => entry.tried.metrics[rankMetric] ?? -Infinity;
        const refineEntry = (entry: (typeof entries)[number], effort: number) => {
          if (effort <= 0 || !entry.fields.length) return;
          const refined = searchComplements({ patch: entry.patch, result: entry.tried }, entry.fields, rankMetric, solveFor, effort);
          entry.patch = refined.patch;
          entry.tried = refined.result;
        };
        if (complements && !exhausted) {
          entries.sort((x, y) => valueOf(y) - valueOf(x));
          if (!tuning) {
            // Pieces with sockets first: a bare tie says nothing about them.
            const withSockets = entries.filter((entry) => entry.fields.length);
            for (const entry of withSockets.slice(0, 12)) { await pace.breathe(); refineEntry(entry, quickEffort); }
            entries.sort((x, y) => valueOf(y) - valueOf(x));
          }
          for (const entry of entries.filter((candidate) => candidate.fields.length).slice(0, tuning ? 1 : 3)) { await pace.breathe(); refineEntry(entry, fullEffort); }
        }
        // With a rotation the ranking above used the chosen skill's DPS (a third of the cost); only the best few are measured on
        // the real objective, and only those can be accepted.
        let contenders = entries;
        if (proxy) {
          entries.sort((x, y) => valueOf(y) - valueOf(x));
          contenders = [];
          for (const entry of entries.slice(0, tuning ? 1 : 3)) {
            if (outOfBudget()) { exhausted = true; break; }
            solves++;
            try { entry.tried = evaluate(current, entry.patch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs); contenders.push(entry); } catch { /* not a candidate */ }
          }
        }
        for (const entry of contenders) {
          const candidate = entry.tried.metrics[objective];
          if (candidate === undefined || !meets(entry.tried.metrics, rules)) continue;
          seen.push({ to: entry.move.changes, grades: entry.move.grades, value: candidate, against: value });
          if (!best || candidate > best.value) best = { move: entry.move, patch: entry.patch, value: candidate, metrics: entry.tried.metrics, rb: entry.tried.rb };
        }
        // 0,1% is the floor: below it the "gain" is rounding in the engine, and the walk would chase noise.
        if (!exhausted && !tuning) searchedAt.set(slot, version);
        if (best && best.value > value * 1.001) {
          accept(best); improved = true; version++; solvedMoves.clear();
          if (tuning) steps[steps.length - 1]['atual'] = true;
        }
        if (exhausted) break;
      }
      if (!improved && !tuning) break;
    }

    // Pairs the user names: the best few candidates of each slot, every combination, applied only if both together beat the build.
    const PAIR_TOP = 4;
    for (const [first, second] of pairs) {
      if (exhausted) break;
      const top = (slot: string) => (pools.get(slot) ?? []).filter(id => id !== rb.model[slot]).slice(0, PAIR_TOP);
      let best: Chosen | null = null;
      search: for (const a of top(first)) for (const b of top(second)) for (const move of expandMove(first, [[first, a], [second, b]])) {
        await pace.breathe();
        if (outOfBudget()) { exhausted = true; break search; }
        solves++;
        try {
          const patch = patchFor(move);
          const tried = evaluate(current, patch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
          const candidate = tried.metrics[objective];
          if (candidate !== undefined && meets(tried.metrics, rules) && (!best || candidate > best.value)) best = { move, patch, value: candidate, metrics: tried.metrics, rb: tried.rb };
        } catch { /* not a candidate */ }
      }
      if (best && best.value > value * 1.001) accept(best);
    }


    // The walk compares everything at the ideal refine and grade. A piece can lose to the worn one at the level the player has
    // today and win once both are raised (a better enchant, a bonus that unlocks at a grade), or the other way round: for the
    // slots that changed, and the best runner-up, measure both levels against the worn piece, each tuned the same way.
    const levelCheck: Record<string, unknown>[] = [];
    if (levelChecks && complements) {
      const original = baseline.rb.model as Record<string, any>;
      const levelBudget = 12;
      const gradeIdeal = (id: number) => (canGradeItem(dataset.items[id]) ? (maxGrade === undefined ? 'A' : maxGrade === 'none' ? '' : maxGrade) : undefined);
      /** `base` with `id` in `slot` at the player's current refine and grade ('now') or at the ideal ones, sockets and rolls tuned. */
      const valueAt = (slot: string, id: number, level: 'now' | 'ideal'): number | undefined => {
        if (outOfBudget()) { exhausted = true; return undefined; }
        const worn = original[slot] === id;
        const refineTo = level === 'now' ? original[`${slot}Refine`] : refineFor(slot, id);
        const gradeTo = level === 'now' ? (canGradeItem(dataset.items[id]) ? original[`${slot}Grade`] ?? '' : undefined) : gradeIdeal(id);
        const patch: BuildPatch = {
          gear: Object.fromEntries([
            ...(worn ? [] : [[slot, id], ...keptSockets(dataset, baseline.rb, slot, id).clear.map((key) => [key, null])]),
            ...(refineTo !== undefined && `${slot}Refine` in original ? [[`${slot}Refine`, refineTo]] : []),
            ...(gradeTo !== undefined && (`${slot}Grade` in original || canGradeItem(dataset.items[id])) ? [[`${slot}Grade`, gradeTo]] : worn ? [] : [[`${slot}Grade`, '']]),
          ]),
          ...(worn ? {} : { options: Object.fromEntries((ItemOptionMap.get(slot as ItemTypeEnum) ?? []).map((index) => [String(index), null])) }),
        };
        try {
          solves++;
          const first = evaluate(base, patch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
          const tuned = searchComplements({ patch, result: first }, complementsFor(slot, id), objective, (candidatePatch) => {
            if (outOfBudget()) { exhausted = true; return null; }
            solves++;
            try { return evaluate(base, candidatePatch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs); } catch { return null; }
          }, levelBudget);
          return tuned.result.metrics[objective];
        } catch { return undefined; }
      };
      const changedSlots = walk.filter((slot) => rb.model[slot] !== original[slot]);
      for (const slot of changedSlots) {
        await pace.breathe();
        const worn = original[slot] as number;
        const rivals = [rb.model[slot] as number, ...[...(considered.get(slot) ?? [])]
          .filter((row) => row.to.length === 1 && row.to[0][1] !== worn && row.to[0][1] !== rb.model[slot])
          .sort((a, b) => b.value - a.value).map((row) => row.to[0][1])].filter((id, index, all) => id > 0 && all.indexOf(id) === index).slice(0, 3);
        const wornNow = worn > 0 ? valueAt(slot, worn, 'now') : baseline.metrics[objective];
        const wornIdeal = worn > 0 ? valueAt(slot, worn, 'ideal') : baseline.metrics[objective];
        if (wornNow === undefined || wornIdeal === undefined) continue;
        const rows = rivals.flatMap((id) => {
          const now = valueAt(slot, id, 'now');
          const ideal = valueAt(slot, id, 'ideal');
          if (now === undefined || ideal === undefined) return [];
          const nowPct = deltaPct(now, wornNow);
          const idealPct = deltaPct(ideal, wornIdeal);
          const better = (pct: number | null) => (pct ?? 0) > 0.1;
          return [{ item: itemLabel(dataset, id), now: nowPct, evolved: idealPct,
            verdict: better(nowPct) && better(idealPct) ? 'melhor nos dois níveis' : !better(nowPct) && better(idealPct) ? 'só vence evoluída' : better(nowPct) ? 'vence agora, perde evoluída' : 'não vence' }];
        });
        if (rows.length) levelCheck.push({ slot, worn: worn > 0 ? itemLabel(dataset, worn) : null, rows });
      }
    }


    // Both kinds of build side by side: a piece can win the opening and lose the long fight.
    const profiles = Object.fromEntries((['sustained', 'burst'] as const).map((name) => {
      const metric = profileObjectives[name];
      try {
        const before = evaluate(base, undefined, dataset, monster, effects, [metric]).metrics[metric];
        const after = evaluate(current, undefined, dataset, monster, effects, [metric]).metrics[metric];
        return [name, compact({ metric, baseline: before === undefined ? undefined : round(before, 2), final: after === undefined ? undefined : round(after, 2), deltaPct: deltaPct(after, before) })];
      } catch { return [name, { metric }]; }
    }));

    // What the ranking cannot see on its own: a target without defenses, an objective that ignores crits, an ASPD potion left out.
    const context = damageContext(baseline.solved.calc);
    const defendedCheck = isUndefended(context.target) ? CHECK_DUMMIES.flatMap((id) => {
      try {
        const dummy = resolveTarget(dataset, id).monster;
        const before = evaluate(base, undefined, dataset, dummy, effects, [objective]).metrics[objective];
        const after = evaluate(current, undefined, dataset, dummy, effects, [objective]).metrics[objective];
        return [compact({ target: dummy.name, id, baseline: before === undefined ? undefined : round(before, 2), final: after === undefined ? undefined : round(after, 2), deltaPct: deltaPct(after, before) })];
      } catch { return []; }
    }) : undefined;
    const objectiveNote = objective === 'max'
      ? '`max` é o golpe máximo, sem média de crítico nem de acerto: builds que dependem de crítico aparecem erradas. Prefira `dps`, `avgHit` (dano médio por golpe) ou `rotationDps`.'
      : objective === 'dps' && ((rb.model as { rotation?: string[] }).rotation?.length ?? 0) > 1
        ? 'A build tem uma rotação: `rotationDps` mede o ciclo inteiro (buffs, recargas); `dps` mede só a habilidade escolhida.' : undefined;
    let aspdPotionCheck: Record<string, unknown> | undefined;
    if (!['max', 'min', 'hitsToKill'].includes(objective)) {
      try {
        const now = evaluate(current, undefined, dataset, monster, effects, [objective, 'aspd']);
        if ((now.metrics.aspd ?? 0) < 193 && now.metrics[objective]) {
          const options = [...AspdPotionList, ...AspdPotionStackable].flatMap((potion) => {
            if (potion.value === (current as { aspdPotion?: number }).aspdPotion) return [];
            const gain = deltaPct(evaluate(current, { aspdPotion: potion.value }, dataset, monster, effects, [objective]).metrics[objective], now.metrics[objective]);
            return gain !== null && gain > 0.5 ? [{ potion: potion.label, id: potion.value, gainPct: gain }] : [];
          }).sort((a, b) => b.gainPct - a.gainPct).slice(0, 3);
          if (options.length) aspdPotionCheck = { aspd: now.metrics.aspd, note: 'Ganho de trocar a poção de velocidade de ataque da build final (a busca de peças não a escolhe).', options };
        }
      } catch { /* optional report */ }
    }

    // Procs the search did not count, measured on the build it ended with: a piece may be worth more when its proc is on.
    const procs: { effect: string; label?: string; gainPct: number | null; average?: ReturnType<typeof procEstimate> }[] = [];
    let countedProcs: string[] | undefined;
    try {
      const last = evaluate(current, undefined, dataset, monster, effects, [objective], [], 1, countProcs);
      if (countProcs) countedProcs = last.solved.effects;
      else for (const chance of ((last.solved.calc.chanceList ?? []) as any[]).filter(chance => chance?.name && !effects.includes(chance.name)).slice(0, 10)) {
        if (outOfBudget()) break;
        solves++;
        const withProc = evaluate(current, undefined, dataset, monster, [...effects, chance.name], [objective]).metrics[objective];
        const gainPct = deltaPct(withProc, value);
        const average = procEstimate(await procData(dataset, chance), gainPct, procHitsPerSecond);
        procs.push({ effect: chance.name, label: chance.label, gainPct, ...(average ? { average } : {}) });
      }
    } catch { /* the report is optional */ }

    const uncatalogued = (() => {
      const ids = [...new Set([...pools.values()].flat().concat(walk.map(slot => rb.model[slot])))].filter(id => id && !randomOptionCatalogFor(id)
        && (ExtraOptionTable[dataset.items[id]?.aegisName] || dataset.items[id]?.itemTypeId === 1 || dataset.items[id]?.itemTypeId === 10));
      return { count: ids.length, ...(ids.length ? { sample: ids.slice(0, 8), see: 'uncatalogued_pools' } : {}) };
    })();
    const limitsNote = (refine === undefined || maxGrade === undefined) ? `Sem teto informado, as peças entram com o refino alcançável e o grau ideais (+${REACHABLE_REFINE}, A; acima de +${REACHABLE_REFINE} é endgame alto); passe \`refine\` e/ou \`maxGrade\` para mudar.` : undefined;

    // The answer is short by default: the numbers, the path, and the few things that change how to read them (`alerts`). The
    // explanations and the target block come with `detail` (and are in the `guide` tool).
    const alerts = [
      context.undefendedNote,
      context.classNote,
      context.hint,
      ...(context.breakpoints?.notes ?? []),
      objectiveNote,
      ...(complements && !skillId ? ['Sem habilidade ofensiva escolhida (`atkSkill`): encantamentos e cartas de habilidade não são ranqueados.'] : []),
      ...(uncatalogued.count ? [`${uncatalogued.count} item(ns) sem pool de rolagens confirmado ficam fora da busca de rolagens (\`uncatalogued_pools\`).`] : []),
      limitsNote,
    ].filter((entry): entry is string => !!entry);

    return json({
      objective,
      baseline: roundMetrics(baseline.metrics, shown),
      final: roundMetrics(metrics, shown),
      deltaPct: Object.fromEntries(shown.map((k) => [k, deltaPct(metrics[k], baseline.metrics[k])])),
      steps,
      patch: changes,
      share: shareOf(rb),
      profiles,
      // The weighted figure hides that a build can be strong on one kind of target and weak on another: show each.
      perTarget: aims.length > 1 ? aims.map((aim, i) => {
        const before = evaluate(base, undefined, dataset, aim.monster, effects, [objective]).metrics[objective];
        const after = evaluate(current, undefined, dataset, aim.monster, effects, [objective]).metrics[objective];
        return compact({ monsterId: (targets ?? [])[i]?.monsterId, name: aim.monster.name, class: aim.monster.type, baseline: before === undefined ? undefined : round(before, 2), final: after === undefined ? undefined : round(after, 2), deltaPct: deltaPct(after, before) });
      }) : undefined,
      ...(defendedCheck?.length ? { defendedCheck: detail ? { note: 'O alvo não tem defesas; o resultado em dummies com defesa de chefe mostra o que a penetração e a TEN valem de verdade.', rows: defendedCheck } : defendedCheck } : {}),
      ...(levelCheck.length ? { levelCheck: detail ? { note: '`now`: ganho da peça sobre a atual, ambas no refino e grau que você tem hoje; `evolved`: o mesmo com as duas no refino e grau ideais. Cada lado com os melhores cartas, encantamentos e rolagens.', slots: levelCheck } : levelCheck } : {}),
      ...(aspdPotionCheck ? { aspdPotionCheck } : {}),
      ...unconfirmed(rb, changes, dataset),
      ...(procs.length ? { procs: detail ? { note: 'Ganho de DPS com o proc ligado o tempo todo (`gainPct`) e a média esperada (`average`: tempo ativo e ganho médio por ataques por segundo). A busca só conta os procs passados em `effects`; um proc de chance baixa rende bem menos que o ganho ligado, e uma peça sem proc pode ser mais estável contra chefe.', options: procs } : procs } : {}),
      ...(countedProcs?.length ? { countedProcs } : {}),
      ...(skippedNotInLatam.length ? { skippedNotInLatam } : {}),
      ...(alerts.length ? { alerts } : {}),
      solves,
      limits: { refine: refine ?? REACHABLE_REFINE, maxGrade: maxGrade ?? 'A' },
      ...(exhausted ? { stopped: `orçamento de cálculos ou de tempo esgotado (${solves} de ${budget}): pode haver trocas melhores que a busca não alcançou. Restrinja \`slots\`, fixe \`candidates\`, use \`complements: false\` ou aumente \`maxSolves\` para a busca caber.` } : {}),
      ...(baseline.rb.warnings.length ? { warnings: baseline.rb.warnings } : {}),
      ...(detail ? {
        context,
        targets: aims.length > 1 ? aims.map((aim, i) => ({ monsterId: (targets ?? [])[i]?.monsterId, name: aim.monster.name, weight: aim.weight })) : undefined,
        candidates: Object.fromEntries([...pools].map(([slot, ids]) => [slot, ids.length])),
        candidateIds: Object.fromEntries(pools),
        alternatives: Object.fromEntries([...considered].flatMap(([slot, rows]) => {
          const top = rows
            .filter((row) => row.to.some(([target, id]) => rb.model[target] !== id))
            .sort((a, b) => b.value - a.value).slice(0, 3)
            .map((row) => ({ to: row.to.map(([target, id]) => itemLabel(dataset, id, row.grades[target])), vsBuildThenPct: deltaPct(row.value, row.against) }));
          return top.length ? [[slot, top]] : [];
        })),
        complementSearch: { enabled: complements, uncataloguedRandomItems: uncatalogued, note: 'Itens sem pool confirmado ficam fora da busca de rolagens. Orçamento: até 48 cálculos de complementos por movimento.' },
        note: 'Heurística (peças, conjuntos, graus e complementos); patch/link incluem cartas, encantamentos e rolagens. Antes de comparar, a peça que a build já usa é ajustada com os melhores cartas, encantamentos e rolagens catalogadas (passos com `atual`), mesmo que o link não os traga. Não prova ótimo global.',
      } : {}),
    });
  });

  registerJsonTool<{ itemId: number; query?: string; limit?: number; detail?: boolean }>(server, 'slot_options', {
    title: 'O que uma peça aceita',
    description:
      'USE antes de montar variantes à mão, para não chutar ids. ' +
      'Para um item equipável, lista os encantamentos que cada soquete aceita (com id e nome) e diz qual categoria de cartas procurar em `search_items`. ' +
      'Evita chutar ids ao montar variantes. Use `query` para filtrar os encantamentos pelo nome.',
    inputSchema: {
      itemId: z.number().int(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional().default(40),
      detail: z.boolean().optional().default(false).describe('Devolve os pools brutos do rAthena e do catálogo (milhares de tokens); o padrão é um resumo.'),
    },
  }, async ({ itemId, query, limit = 40, detail = false }) => {
    const item = dataset.items[itemId];
    if (!item) throw new Error(`Item ${itemId} não está no banco do calculador.`);

    const needle = (query ?? '').trim().toLowerCase();
    const aegis = aegisIndex(dataset);

    const pools = enchantPoolsFor(item) as (string[] | null | undefined)[] | undefined;
    const randomCapacity = item.itemTypeId === 1 ? 3 : item.itemTypeId === 10 ? 2 : ExtraOptionTable[item.aegisName] ?? 0;
    const randomCatalog = randomOptionCatalogFor(itemId);
    const randomReferences = randomOptionReferencesFor(itemId);
    const randomPositions = (dataset.itemIndex.get(itemId)?.slotTags ?? [])
      .filter(slot => MAIN_ITEM_SLOTS.includes(slot))
      .map(slot => ({ slot, positions: (ItemOptionMap.get(slot as ItemTypeEnum) ?? []).slice(0, randomCapacity) }));
    const enchants = (pools ?? []).flatMap((pool, index) => {
      if (!pool?.length) return [];
      const options = [...new Set(pool)]
        .map((aegisName) => ({ id: aegis.get(aegisName), name: aegisName }))
        .filter((o): o is { id: number; name: string } => o.id !== undefined)
        .map((o) => ({ id: o.id, name: dataset.itemIndex.get(o.id)?.name ?? o.name }))
        .filter((o) => !needle || o.name.toLowerCase().includes(needle));

      return [{ position: index, total: options.length, options: options.slice(0, limit), ...(options.length > limit ? { truncated: true } : {}) }];
    }).reduce<{ position: number; positions?: number[]; total: number; options: { id: number; name: string }[]; truncated?: boolean }[]>((groups, entry) => {
      // Sockets that offer the same list (Automatron's three) are said once, not three times.
      const same = groups.find(group => group.options.length === entry.options.length && group.options.every((o, i) => o.id === entry.options[i].id));
      if (same) same.positions = [...(same.positions ?? [same.position]), entry.position];
      else groups.push(entry);
      return groups;
    }, []);

    return json(compact({
      id: itemId,
      name: dataset.itemIndex.get(itemId)?.name ?? item.name,
      cardSlots: item.slots || 0,
      cardSearch: 'search_items com `slot` = weaponCard, headCard, shieldCard, armorCard, garmentCard, bootCard ou accCard.',
      enchants,
      ...(randomCapacity || randomReferences?.references.length ? { randomOptions: {
        capacity: randomCapacity, slots: randomPositions,
        validation: randomCatalog ? 'reference-ranges' : 'capacity-only', poolSource: randomPoolTier(itemId), automaticRollSearch: !!randomCatalog,
        ...(randomCatalog ? { catalog: detail ? randomCatalog : compactCatalog(randomCatalog) } : {}),
        ...(randomReferences ? { upstream: detail ? randomReferences : compactUpstream(randomReferences) } : {}),
        input: 'Passe options com o número da posição e o bônus rolado (ex.: "melee:5"). optimize_build busca rolagens só com catalog. `detail: true` devolve os pools brutos.',
      } } : {}),
      ...(pools ? {} : { note: randomCapacity
        ? 'Esta peça usa bônus aleatórios, não itens de encantamento. Declare as rolagens em options ao comparar configurações.'
        : 'Esta peça não tem soquetes de encantamento no calculador.' }),
    }));
  });
}

interface Removal {
  kind: 'gear' | 'active' | 'passive' | 'buff' | 'consumable';
  name: string;
  detail?: string;
  patch: BuildPatch;
}

/** Everything in the build that can be taken out on its own, in a stable order. */
function removals(rb: ResolvedBuild, dataset: Dataset): Removal[] {
  const model: any = rb.model;
  const list: Removal[] = [];

  for (const key of ITEM_ID_KEYS) {
    const id = model[key];
    if (typeof id !== 'number' || id <= 0 || !rb.items[id]) continue;
    list.push({ kind: 'gear', name: rb.items[id].name ?? String(id), detail: key, patch: { gear: { [key]: null } } });
  }
  for (const [kind, map, field] of [
    ['active', model.activeSkillMap, 'active'],
    ['passive', model.passiveSkillMap, 'passive'],
    ['buff', model.skillBuffMap, 'buffs'],
  ] as const) {
    for (const [name, level] of Object.entries((map ?? {}) as Record<string, number>)) {
      if (typeof level === 'number' && level > 0) list.push({ kind, name, detail: `Nv ${level}`, patch: { skills: { [field]: { [name]: 0 } } } });
    }
  }
  for (const id of (model.consumables ?? []) as number[]) {
    list.push({ kind: 'consumable', name: dataset.itemIndex.get(id)?.name ?? String(id), patch: { consumables: (model.consumables as number[]).filter((c) => c !== id) } });
  }

  return list;
}

function contributions(
  base: BuildInput,
  rb: ResolvedBuild,
  baseValue: number | undefined,
  metric: Metric,
  monster: any,
  effects: string[],
  dataset: Dataset,
  max: number,
) {
  if (!baseValue) return { error: `A build não produz ${metric} para comparar.` };

  const all = removals(rb, dataset);
  const limit = Math.min(max, config.limits.maxContributions);
  const rows = all.slice(0, config.limits.maxContributions).map((removal) => {
    const { metrics } = evaluate(base, removal.patch, dataset, monster, effects, [metric]);

    return compact({
      kind: removal.kind,
      name: removal.name,
      detail: removal.detail,
      // Negative: the build loses this much without it. Positive: it is hurting the number.
      withoutPct: deltaPct(metrics[metric] ?? 0, baseValue),
    });
  });
  rows.sort((a, b) => Math.abs((b.withoutPct as number) ?? 0) - Math.abs((a.withoutPct as number) ?? 0));

  return {
    note: 'Retirar uma peça também desfaz os conjuntos e combos dela; o valor é o efeito da peça inteira.',
    rows: rows.slice(0, limit),
    ...(all.length > rows.length ? { truncated: `${all.length - rows.length} itens ficaram de fora do limite de ${config.limits.maxContributions}` } : {}),
  };
}

/**
 * Pieces a variant put in that have card slots or enchant sockets left empty. Two pieces can tie bare and differ a lot once
 * socketed (a Soqueira Vil Invernal against the Invernal), so a variant that swaps one in without filling it understates it.
 */
function emptySocketsOf(dataset: Dataset, before: ResolvedBuild, after: ResolvedBuild): string[] | undefined {
  const model = after.model as Record<string, any>;
  const rows = MAIN_ITEM_SLOTS.flatMap((slot) => {
    const id = model[slot];
    if (typeof id !== 'number' || id <= 0 || id === (before.model as Record<string, any>)[slot]) return [];
    const item = dataset.items[id];
    const keys = relatedItemKeys(slot);
    const cardsFree = Math.max(0, (item?.slots ?? 0) - keys.filter((key) => /Card\d?$/.test(key) && model[key] > 0).length);
    const pools = (enchantPoolsFor(item) as (string[] | null | undefined)[] | undefined) ?? [];
    const enchantsFree = Math.max(0, pools.filter((pool) => pool?.length).length - keys.filter((key) => /Enchant\d$/.test(key) && model[key] > 0).length);

    return cardsFree || enchantsFree ? [`${slot} (${dataset.itemIndex.get(id)?.name}): ${cardsFree} slot(s) de carta e ${enchantsFree} encantamento(s) vazios`] : [];
  });

  return rows.length ? rows : undefined;
}

/** The same enchant at other levels ("Cristal Invernal (Grau Físico 4)", "Thanos Spell (Fighter) Lv.2"), by name stem. */
const enchantFamilies = new WeakMap<Dataset, Map<string, { id: number; level: number }[]>>();
function enchantLevels(dataset: Dataset, id: number): { id: number; level: number }[] {
  let families = enchantFamilies.get(dataset);
  const stemOf = (name: string): { stem: string; level: number } | undefined => {
    const match = /^(.*\D)\s*(?:Lv\.?\s*)?(\d+)\)?$/.exec(name.trim());
    return match ? { stem: match[1].replace(/\s*Lv\.?$/i, '').trim(), level: Number(match[2]) } : undefined;
  };
  if (!families) {
    families = new Map();
    for (const [key, item] of Object.entries(dataset.items)) {
      if (!dataset.itemIndex.get(Number(key))?.slotTags?.includes('enchant' as SlotTag)) continue;
      const parsed = stemOf(String(item?.name ?? ''));
      if (parsed) families.set(parsed.stem, [...(families.get(parsed.stem) ?? []), { id: Number(key), level: parsed.level }]);
    }
    enchantFamilies.set(dataset, families);
  }
  const own = stemOf(String(dataset.items[id]?.name ?? ''));
  return own ? (families.get(own.stem) ?? []).filter((entry) => entry.id !== id).sort((a, b) => a.level - b.level) : [];
}

/**
 * Where the next investment pays most, one change at a time over the current build: refine up (+1 and to the reachable +12), grade up
 * (next and A), an enchant to the next level and to its top level, and a new enchant in an empty socket. They are
 * single steps, comparable with each other; combined steps can differ when refine and grade unlock bonuses together
 * (test those with `evaluate_variants`). Cost, failure chance and materials are not counted.
 */
function upgradeGains(base: BuildInput, rb: ResolvedBuild, baseValue: number | undefined, metric: Metric, monster: any, effects: string[], dataset: Dataset, keys: string[]) {
  if (!baseValue) return { error: `A build não produz ${metric} para comparar.` };
  const model: any = rb.model;
  const gain = (patch: BuildPatch) => {
    try { return deltaPct(evaluate(base, patch, dataset, monster, effects, [metric]).metrics[metric], baseValue); } catch { return null; }
  };
  const rows: { slot: string; name?: string; action: string; gainPct: number }[] = [];
  const add = (slot: string, action: string, patch: BuildPatch) => {
    const value = gain(patch);
    if (value !== null) rows.push({ slot, name: dataset.itemIndex.get(model[slot])?.name, action, gainPct: value });
  };
  for (const slot of MAIN_ITEM_SLOTS) {
    const id = model[slot];
    if (typeof id !== 'number' || id <= 0) continue;
    const refine: number = model[`${slot}Refine`] ?? 0;
    if (`${slot}Refine` in model && refine < 20) {
      add(slot, `refino +${refine + 1}${refine >= REACHABLE_REFINE ? ' (endgame alto)' : ''}`, { gear: { [`${slot}Refine`]: refine + 1 } });
      if (refine < REACHABLE_REFINE - 1) add(slot, `refino +${REACHABLE_REFINE}`, { gear: { [`${slot}Refine`]: REACHABLE_REFINE } });
    }
    if (canGradeItem(dataset.items[id])) {
      const at = GRADES.indexOf(model[`${slot}Grade`] ?? '');
      if (at < GRADES.length - 1) add(slot, `grau ${GRADES[at + 1]}`, { gear: { [`${slot}Grade`]: GRADES[at + 1] } });
      if (at < GRADES.length - 2) add(slot, 'grau A', { gear: { [`${slot}Grade`]: 'A' } });
    }
    for (const key of relatedItemKeys(slot).filter((field) => /Enchant\d$/.test(field))) {
      const carried = model[key];
      if (typeof carried !== 'number' || carried <= 0) continue;
      const own = enchantLevels(dataset, carried);
      const current = Number(/(\d+)\)?$/.exec(String(dataset.items[carried]?.name ?? ''))?.[1] ?? 0);
      const higher = own.filter((entry) => entry.level > current);
      if (higher[0]) add(slot, `encantamento ${dataset.items[carried]?.name} → nível ${higher[0].level}`, { gear: { [key]: higher[0].id } });
      const top = higher[higher.length - 1];
      if (top && top !== higher[0]) add(slot, `encantamento ${dataset.items[carried]?.name} → nível máximo ${top.level}`, { gear: { [key]: top.id } });
    }
    // An empty enchant socket: the best of the few legal enchants the piece accepts, scored by the build's own formula.
    for (const choices of complementChoices(dataset, slot, id, keys, new Set())) {
      const key = Object.keys(choices[0]?.gear ?? {})[0] ?? '';
      if (!/Enchant\d$/.test(key) || model[key] > 0) continue;
      const best = choices.flatMap((choice) => {
        const id = (choice.gear as Record<string, unknown> | undefined)?.[key];
        const value = typeof id === 'number' ? gain(choice) : null;
        return typeof id === 'number' && value !== null ? [{ id, value }] : [];
      }).sort((a, b) => b.value - a.value)[0];
      if (best && best.value > 0) rows.push({ slot, name: dataset.itemIndex.get(id)?.name, action: `encantar (${key}): ${dataset.items[best.id]?.name}`, gainPct: best.value });
    }
  }
  rows.sort((a, b) => b.gainPct - a.gainPct);
  return { note: 'Cada linha é uma mudança isolada sobre a build atual, na métrica pedida; não conta custo, chance de falha nem materiais. Combinações podem render mais (teste em `evaluate_variants`).', ranked: rows.slice(0, 25) };
}

/** What one and two more refine levels would add on each worn piece: where the next upgrade is worth the most. */
function refineGains(base: BuildInput, rb: ResolvedBuild, baseValue: number | undefined, metric: Metric, monster: any, effects: string[], dataset: Dataset) {
  if (!baseValue) return { error: `A build não produz ${metric} para comparar.` };
  const model: any = rb.model;
  const rows = MAIN_ITEM_SLOTS.filter((slot) => model[slot] > 0 && `${slot}Refine` in model && (model[`${slot}Refine`] ?? 0) < 20).flatMap((slot) => {
    const refine: number = model[`${slot}Refine`] ?? 0;
    const gain = (levels: number) => deltaPct(evaluate(base, { gear: { [`${slot}Refine`]: Math.min(20, refine + levels) } }, dataset, monster, effects, [metric]).metrics[metric], baseValue);
    try {
      return [{ slot, name: dataset.itemIndex.get(model[slot])?.name, refine, plus1Pct: gain(1), ...(refine < 19 ? { plus2Pct: gain(2) } : {}) }];
    } catch { return []; }
  }).sort((a, b) => (b.plus1Pct ?? 0) - (a.plus1Pct ?? 0));

  return { note: 'Ganho de cada peça sozinha, sobre a build atual; não considera chance de falha nem custo.', rows };
}

/** Effects the number leaves out, so an agent does not recommend a piece for what it does not count. */
async function notModelled(
  rb: ResolvedBuild,
  calc: any,
  baseMax: number | undefined,
  base: BuildInput,
  dataset: Dataset,
  monster: any,
  effects: string[],
  ) {
  const model: any = rb.model;
  const warnings: Record<string, unknown>[] = [];

  for (const key of ITEM_ID_KEYS) {
    const id = model[key];
    const item = typeof id === 'number' ? rb.items[id] : undefined;
    // Costume pieces are visual: an empty script there is the norm, not a gap.
    if (!item || /^costume(Upper|Middle|Lower|Garment)$/.test(key) || key === 'pet' || key === 'ammo') continue;
    if (!item.script || Object.keys(item.script).length === 0) {
      warnings.push({ type: 'emptyScript', slot: key, id, name: item.name, note: 'Sem bônus no calculador: se a peça tem efeito no jogo, ele não entra no número.' });
    }
  }

  const available = ((calc.chanceList ?? []) as any[]).filter((chance) => !effects.includes(chance?.name)).slice(0, 10);
  for (const chance of available) {
    const { metrics } = evaluate(base, undefined, dataset, monster, [...effects, chance.name], ['max']);
    warnings.push(compact({
      type: 'proc',
      name: chance.name,
      label: chance.label,
      gainMaxPct: deltaPct(metrics['max'], baseMax),
      note: 'Efeito de proc fora da conta. Passe o nome em `effects` para contá-lo.',
      average: procEstimate(await procData(dataset, chance), deltaPct(metrics['max'], baseMax)),
    }));
  }

  return warnings;
}
