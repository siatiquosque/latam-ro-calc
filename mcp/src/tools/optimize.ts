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
import { BuildInput, buildInputSchema, ITEM_ID_KEYS, MAIN_ITEM_SLOTS, resolveBuild, ResolvedBuild } from '../engine/build-input';
import { DEFAULT_METRICS, Metric, METRICS, Metrics, readMetrics } from '../engine/metrics';
import { buildShareUrl, Shortener, toPreset } from '../engine/share';
import { solveWithInput } from '../engine/solve';
import { applyPatch, BuildPatch, decodeOnce, patchSchema } from '../engine/variants';
import { complementChoices, damageContext, keptSockets, relevantKeys, searchComplements } from '../engine/complements';
import { partnerIndex } from '../engine/item-partners';
import { pacing } from '../engine/pacing';
import { normalizeShare, resolveTarget, targetSchema } from './calculate';
import { compact, json, registerJsonTool } from './helpers';

type TargetArg = z.infer<typeof targetSchema>;

const metricEnum = z.enum(METRICS);

const variantSchema = z.object({
  label: z.string().min(1).max(80).describe('Nome curto para reconhecer a variante na resposta.'),
  patch: patchSchema.describe('Só o que muda em relação à build base. Mapas (gear, stats, skills, options) mesclam por chave.'),
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
      'Resolve de uma vez várias variações de uma mesma build (trocar peça, carta, encantamento, buff, atributo, habilidade) e devolve as métricas de cada uma, ordenadas. ' +
      'Cada variante é só o que muda: `patch` tem o mesmo formato dos overrides de `build` e mescla por chave sobre a base. ' +
      '`require` descarta quem não cumpre um piso ou teto (ex.: hp mínimo). `rotationDps` usa a `rotation` da build. ' +
      `Máximo de ${config.limits.maxVariants} variantes por chamada.`,
    inputSchema: {
      build: buildInputSchema,
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
    target?: TargetArg;
    effects?: string[];
    parts?: ('stages' | 'contributions' | 'warnings')[];
    metric?: 'dps' | 'max' | 'rotationDps';
    maxContributions?: number;
  }>(server, 'explain_damage', {
    title: 'Explicar o dano de uma build',
    description:
      'Mostra de onde vem o dano: `stages` são as etapas da fórmula com o valor depois de cada uma; `contributions` diz quanto a métrica cai se cada peça, carta, buff, passiva ou consumível sair ' +
      '(retirar uma peça também desfaz os conjuntos e combos dela); `warnings` aponta efeitos que o número não conta — itens com script vazio e procs não ativados, com o ganho de ativá-los.',
    inputSchema: {
      build: buildInputSchema,
      target: targetSchema,
      effects: z.array(z.string()).optional(),
      parts: z.array(z.enum(['stages', 'contributions', 'warnings', 'refine'])).optional().describe('Padrão: stages, contributions e warnings. `refine` mostra o ganho de +1 e +2 refinos em cada peça (custo: uma conta por peça e nível).'),
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

    if (want.has('warnings')) out['warnings'] = notModelled(baseline.rb, baseline.solved.calc, baseline.metrics['max'], base, dataset, monster, effects);

    return json(out);
  });

  registerJsonTool<{
    build: BuildInput;
    target?: TargetArg;
    targets?: { monsterId: number; weight?: number }[];
    effects?: string[];
    objective?: Metric;
    slots?: string[];
    lock?: string[];
    exclude?: number[];
    candidates?: Record<string, number[]>;
    combos?: boolean;
    pairs?: string[][];
    countProcs?: boolean;
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
      'Percorre os slots de equipamento trocando a peça que mais melhora a métrica e repete até nada melhorar (subida de encosta). ' +
      'Testa equipamentos e seus complementos legais: cartas por categoria, encantamentos por posição e bônus aleatórios de catálogos regionais. ' +
      'Com `combos` (padrão) também testa trocas de **duas peças juntas** quando o script de uma cita a outra (conjuntos), que uma troca isolada não enxerga. ' +
      '`targets` mede contra vários monstros com peso (ex.: um Médio e um Grande: a penalidade de tamanho só aparece no Grande); `candidates` fixa os itens a testar num slot; ' +
      '`lock` trava slots, `exclude` proíbe itens, `require` impõe pisos (ex.: hp mínimo). Devolve o caminho das trocas com o ganho de cada uma e um `patch` pronto para `evaluate_variants`. ' +
      '`pairs` testa dois slots trocados juntos mesmo sem conjunto que os ligue. `procs` na resposta mostra o ganho de cada proc ainda não contado (passe-o em `effects` para a busca contá-lo). '
      + 'Busca heurística limitada pelo orçamento, sem garantia global. Pools aleatórios desconhecidos não são inventados. Confira a cobertura e o orçamento retornados.',
    inputSchema: {
      build: buildInputSchema,
      target: targetSchema,
      targets: z.array(z.object({ monsterId: z.number().int(), weight: z.number().positive().optional() })).min(1).max(5).optional()
        .describe('Alvos com peso (padrão 1). Vale para max, min e dps; as demais métricas não dependem do alvo.'),
      effects: z.array(z.string()).optional(),
      objective: metricEnum.optional().describe('O que maximizar. Padrão: dps.'),
      slots: z.array(z.string()).optional().describe('Slots a percorrer. Padrão: equipamentos e peças sombrias.'),
      lock: z.array(z.string()).optional().describe('Slots que não mudam.'),
      exclude: z.array(z.number().int()).optional().describe('Ids de itens que não podem entrar.'),
      candidates: z.record(z.string(), z.array(z.number().int()).max(60)).optional().describe('Itens a testar por slot, no lugar da seleção automática. Ex.: { "boot": [470069, 470115, 470094] }.'),
      combos: z.boolean().optional().default(true).describe('Testar também trocas de duas peças ligadas por um conjunto.'),
      pairs: z.array(z.tuple([z.string(), z.string()])).max(6).optional().describe('Pares de slots a trocar juntos mesmo sem conjunto que os ligue, ex.: [["garment","boot"]]. Testa os melhores candidatos de cada slot em todas as combinações, depois da busca normal.'),
      detail: z.boolean().optional().default(false).describe('Inclui também os ids de candidatos por slot e as alternativas que perderam (várias centenas de tokens a mais).'),
      countProcs: z.boolean().optional().default(false).describe('Conta, em cada build testada, todos os procs que ela oferece (inclusive os de peças recém-trocadas), em vez de só os de `effects`. Dobra o custo dos cálculos de builds com procs.'),
      complements: z.boolean().optional().default(true).describe('Buscar também cartas, encantamentos e rolagens catalogadas. false preserva a busca somente de peças.'),
      refine: z.number().int().min(0).max(20).optional().describe('Refino das peças novas. Padrão: o refino atual do slot.'),
      maxGrade: z.enum(['none', 'D', 'C', 'B', 'A']).optional().describe('Teto de grau: testa sem grau e todos os graus até o limite. A build base também deve respeitar o teto. Sem este parâmetro, peças novas ficam sem grau.'),
      candidatesPerSlot: z.number().int().min(1).max(60).optional().default(12),
      rounds: z.number().int().min(1).max(4).optional().default(2),
      maxSolves: z.number().int().min(10).optional().describe('Teto de cálculos desta chamada; o servidor impõe o dele.'),
      require: z.array(requireSchema).optional(),
    },
  }, async ({ build, target, targets, effects = [], objective = 'dps', slots, lock = [], exclude = [], candidates, combos = true, pairs = [], countProcs = false, detail = false, complements = true, refine, maxGrade, candidatesPerSlot = 12, rounds = 2, maxSolves, require: rules = [] }) => {
    const budget = Math.min(maxSolves ?? config.limits.maxSolves, config.limits.maxSolves);
    const pace = pacing(config.limits.maxSearchMs);
    const shown: Metric[] = [...new Set<Metric>([objective, 'max', 'dps', 'hp'])];
    const wanted: Metric[] = [...new Set<Metric>([...shown, ...rules.map((r) => r.metric)])];

    const base = decodeOnce(await normalizeShare(build, shortener));
    const aims = (targets ?? [{ monsterId: target?.monsterId ?? config.defaultTargetId }]).map((aim) => ({
      monster: resolveTarget(dataset, aim.monsterId).monster,
      weight: (aim as { weight?: number }).weight ?? 1,
    }));
    const monster = aims[0].monster;
    const more = aims.slice(1);
    const baseline = evaluate(base, undefined, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
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
        pools.set(slot, candidates[slot].filter((id) => (id !== worn || (maxGrade !== undefined && canGradeItem(dataset.items[id]))) && !banned.has(id) && eligible(id, slot)));
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
      pools.set(slot, ranked);
      if (maxGrade !== undefined && canGradeItem(dataset.items[worn]) && !banned.has(worn)) ranked.unshift(worn);
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
        const grades = maxGrade !== undefined && canGradeItem(dataset.items[item]) ? GRADES.slice(0, gradeLimit + 1)
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

    const patchFor = (move: Move): BuildPatch => ({
      gear: Object.fromEntries(move.changes.flatMap(([target, id]) => [
        [target, id],
        ...(refine !== undefined ? [[`${target}Refine`, refine]] : []),
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

    for (let round = 0; round < rounds && !exhausted; round++) {
      let improved = false;
      for (const [slotIndex, slot] of walk.entries()) {
        if (searchedAt.get(slot) === version) continue;
        let best: Chosen | null = null;
        const seen: { to: [string, number][]; grades: Record<string, string>; value: number; against: number }[] = [];
        considered.set(slot, seen);
        const moves = movesFor(slot);
        const remainingSlots = walk.length - slotIndex + (rounds - round - 1) * walk.length;
        const completionBudget = Math.max(0, Math.min(48, Math.floor((budget - solves) / Math.max(1, remainingSlots) / Math.max(1, moves.length)) - 1));
        for (const move of moves) {
          await pace.breathe();
          const key = moveKey(move);
          if (solvedMoves.has(key)) continue;
          if (outOfBudget()) { exhausted = true; break; }
          solves++;
          solvedMoves.add(key);
          try {
            let patch = patchFor(move);
            let tried = evaluate(current, patch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs);
            if (complements) {
              const fields = move.changes.flatMap(([target, id]) => complementsFor(target, id));
              const refined = searchComplements({ patch, result: tried }, fields, objective, candidatePatch => {
                if (outOfBudget()) { exhausted = true; return null; }
                solves++;
                try { return evaluate(current, candidatePatch, dataset, monster, effects, wanted, more, aims[0].weight, countProcs); }
                catch { return null; }
              }, completionBudget);
              patch = refined.patch;
              tried = refined.result;
            }
            const candidate = tried.metrics[objective];
            if (candidate !== undefined && meets(tried.metrics, rules)) seen.push({ to: move.changes, grades: move.grades, value: candidate, against: value });
            if (candidate !== undefined && meets(tried.metrics, rules) && (!best || candidate > best.value)) best = { move, patch, value: candidate, metrics: tried.metrics, rb: tried.rb };
          } catch {
            /* a candidate that does not resolve is simply not a candidate */
          }
        }
        // 0,1% is the floor: below it the "gain" is rounding in the engine, and the walk would chase noise.
        if (!exhausted) searchedAt.set(slot, version);
        if (best && best.value > value * 1.001) { accept(best); improved = true; version++; solvedMoves.clear(); }
        if (exhausted) break;
      }
      if (!improved) break;
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

    // Procs the search did not count, measured on the build it ended with: a piece may be worth more when its proc is on.
    const procs: { effect: string; label?: string; gainPct: number | null }[] = [];
    let countedProcs: string[] | undefined;
    try {
      const last = evaluate(current, undefined, dataset, monster, effects, [objective], [], 1, countProcs);
      if (countProcs) countedProcs = last.solved.effects;
      else for (const chance of ((last.solved.calc.chanceList ?? []) as any[]).filter(chance => chance?.name && !effects.includes(chance.name)).slice(0, 10)) {
        if (outOfBudget()) break;
        solves++;
        const withProc = evaluate(current, undefined, dataset, monster, [...effects, chance.name], [objective]).metrics[objective];
        procs.push({ effect: chance.name, label: chance.label, gainPct: deltaPct(withProc, value) });
      }
    } catch { /* the report is optional */ }

    return json({
      objective,
      maxGrade,
      targets: aims.length > 1 ? aims.map((aim, i) => ({ monsterId: (targets ?? [])[i]?.monsterId, name: aim.monster.name, weight: aim.weight })) : undefined,
      baseline: roundMetrics(baseline.metrics, shown),
      final: roundMetrics(metrics, shown),
      deltaPct: Object.fromEntries(shown.map((k) => [k, deltaPct(metrics[k], baseline.metrics[k])])),
      steps,
      solves,
      stopped: exhausted ? 'orçamento de cálculos ou de tempo esgotado: o resultado pode estar incompleto' : 'convergiu',
      candidates: Object.fromEntries([...pools].map(([slot, ids]) => [slot, ids.length])),
      context: damageContext(baseline.solved.calc),
      ...(skippedNotInLatam.length ? { skippedNotInLatam } : {}),
      patch: changes,
      share: shareOf(rb),
      ...(detail ? {
        candidateIds: Object.fromEntries(pools),
        alternatives: Object.fromEntries([...considered].flatMap(([slot, rows]) => {
          const top = rows
            .filter((row) => row.to.some(([target, id]) => rb.model[target] !== id))
            .sort((a, b) => b.value - a.value).slice(0, 3)
            .map((row) => ({ to: row.to.map(([target, id]) => itemLabel(dataset, id, row.grades[target])), vsBuildThenPct: deltaPct(row.value, row.against) }));
          return top.length ? [[slot, top]] : [];
        })),
      } : {}),
      ...(countedProcs?.length ? { countedProcs } : {}),
      ...unconfirmed(rb, changes, dataset),
      ...(procs.length ? { procs: { note: 'Ganho de DPS ao ativar cada proc na build final; a busca só conta os procs passados em `effects`.', options: procs } } : {}),
      complementSearch: {
        enabled: complements,
        ...(complements && !skillId ? { skillEnchants: 'A build não tem habilidade ofensiva escolhida (`atkSkill`): encantamentos e cartas específicos de habilidade não são ranqueados.' } : {}),
        // Names stay out of the answer: `uncatalogued_pools` lists them on demand.
        uncataloguedRandomItems: (() => {
          const ids = [...new Set([...pools.values()].flat().concat(walk.map(slot => rb.model[slot])))].filter(id => id && !randomOptionCatalogFor(id)
            && (ExtraOptionTable[dataset.items[id]?.aegisName] || dataset.items[id]?.itemTypeId === 1 || dataset.items[id]?.itemTypeId === 10));
          return { count: ids.length, ...(ids.length ? { sample: ids.slice(0, 8), see: 'uncatalogued_pools' } : {}) };
        })(),
        note: 'Itens sem pool confirmado ficam fora da busca de rolagens. Orçamento: até 48 cálculos de complementos por movimento.',
      },
      note: 'Heurística (peças, conjuntos, graus e complementos); patch/link incluem cartas, encantamentos e rolagens. Não prova ótimo global.',
      ...(baseline.rb.warnings.length ? { warnings: baseline.rb.warnings } : {}),
    });
  });

  registerJsonTool<{ itemId: number; query?: string; limit?: number; detail?: boolean }>(server, 'slot_options', {
    title: 'O que uma peça aceita',
    description:
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
function notModelled(
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
    }));
  }

  return warnings;
}
