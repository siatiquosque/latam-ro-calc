/** Transport-free build operations. Browser UI and MCP call these same implementations. */

import { strictShape } from '../engine/strict-object';
import { z } from 'zod';
import { CompareState } from 'src/app/core/compare-state';
import { collectConsumables } from 'src/app/core/calculator-controller';
import { round } from 'src/app/utils';
import { Dataset } from '../data/dataset';
import { SLOT_TAGS } from '../data/slot-classifier';
import { plainItemDesc } from '../data/text';
import { BuildInput, ITEM_ID_KEYS, MAIN_ITEM_SLOTS, relatedItemKeys, ResolvedBuild, resolveBuild } from '../engine/build-input';
import { projectResult } from '../engine/project';
import { buildShareUrl, parseShare, resolveIfShort, Shortener, shortenShareUrl, toPreset } from '../engine/share';
import { solve } from '../engine/solve';
import { applyPatch, BuildPatch, decodeOnce } from '../engine/variants';
import { complementChoices, damageContext, REACHABLE_REFINE, relevantKeys, searchComplements, swapPatch } from '../engine/complements';
import { pacing } from '../engine/pacing';
import { CHECK_DUMMIES, isUndefended } from '../engine/dummies';
import { SKILL_ID_BY_NAME } from 'src/app/skills';
import { MVP_CARD_IDS } from 'src/app/constants/mvp-cards';
import { AnalysisRuntime } from '../runtime';
import { compact } from './compact';
import { constraintSpecSchema, ConstraintSpec, slotOfField } from '../engine/goal-spec';
import { equipmentLocks } from '../engine/equipment-locks';
import { constraintViolations } from '../engine/feasibility';
import { introducesHeadConflict } from '../engine/validate';
import { createBuildContext } from './context';

// A bare id is the common slip; read it as the monster it names.
export const targetSchema = z.preprocess((value) => (typeof value === 'number' ? { monsterId: value } : value), strictShape({ monsterId: z.number().int().optional().describe('Id do monstro alvo. Veja search_monsters.') }, 'target')).describe('Alvo {"monsterId": id}.').optional();

type TargetArg = z.infer<typeof targetSchema>;

const deltaPct = (value: number, base: number): number | null => (base ? round(((value - base) / base) * 100, 2) : null);

const dpsAndMax = (calc: any): { dps: number; max: number } => {
  const dmg = calc.getTotalSummary().dmg ?? {};
  return { dps: dmg.skillDps ?? 0, max: dmg.skillMaxDamage ?? 0 };
};

export type CalculateArgs = { build: BuildInput; target?: TargetArg; effects?: string[]; include?: ('bonuses' | 'tables')[] };

export type DamageTableArgs = { build: BuildInput; monsterIds: number[] };

export type CompareBuildsArgs = { builds: BuildInput[]; target?: TargetArg; labels?: string[] };

export type OptimizeSlotArgs = {
    constraints?: ConstraintSpec;
    build: BuildInput;
    slot: string;
    candidates?: number[];
    slotTag?: (typeof SLOT_TAGS)[number];
    query?: string;
    target?: TargetArg;
    limit?: number;
    complements?: boolean;
    refine?: number;
    maxGrade?: 'none' | 'D' | 'C' | 'B' | 'A';
    excludeMvpCards?: boolean;
  };

export type ParseShareLinkArgs = { share: string; raw?: boolean };

export type ShareLinkArgs = { build: BuildInput; compare?: { slots: string[]; gear: Record<string, any> }; short?: boolean };

export type ItemDescriptionArgs = { id: number };

export function createCalculationOperations(dataset: Dataset, config: AnalysisRuntime, shortener?: Shortener) {

  const { normalizeShare, resolveTarget } = createBuildContext(config, shortener);

const shareOf = (rb: ResolvedBuild, compare?: CompareState | null) => buildShareUrl(toPreset(rb.model, rb.char), config.appOrigin, compare, rb.customItems);

function resolveCandidates(
  dataset: Dataset,
  classId: number,
  opts: { candidates?: number[]; slotTag?: (typeof SLOT_TAGS)[number]; query?: string; excludeMvpCards?: boolean },
): { ids: number[]; eligible: number } {
  const max = config.limits.maxOptimizeCandidates;
  let eligible: number;
  let ids: number[];
  if (opts.candidates?.length) {
    // Explicit ids: only the MVP exclusion applies; the caller chose the rest.
    ids = opts.excludeMvpCards ? opts.candidates.filter((id) => !MVP_CARD_IDS.has(id)) : opts.candidates;
    eligible = ids.length;
  } else {
    if (!opts.slotTag) throw new Error('Informe `candidates` ou `slotTag` para escolher o que testar.');
    const char = dataset.classes.newInstance(classId);
    const found = dataset.itemIndex.search({ slot: opts.slotTag, query: opts.query, limit: max, excludeMvpCards: opts.excludeMvpCards }, char);
    ids = found.rows.map((r) => r.id);
    eligible = found.total;
  }

  if (!ids.length) throw new Error('Nenhum candidato encontrado para esse slot.');
  return { ids: ids.slice(0, max), eligible };
}

async function calculate({ build, target, effects, include }: CalculateArgs) {
      const input = await normalizeShare(build, shortener);
      const rb = resolveBuild(input, dataset);
      const { id: targetId, monster } = resolveTarget(dataset, target?.monsterId);
      const calc = solve(rb, dataset, monster, effects ?? []);
      return projectResult(calc, rb, { include, targetId, share: shareOf(rb), effects });
    }

async function damageTable({ build, monsterIds }: DamageTableArgs) {
    const input = await normalizeShare(build, shortener);
    const rb = resolveBuild(input, dataset);
    const skillValue = rb.model.selectedAtkSkill;
    // Same flag solve() feeds runChain: HP Increase Potion (L) changes max HP, so
    // hardcoding false here would make this tool disagree with `calculate`.
    const { usedHpL } = collectConsumables(rb.model, rb.items);
    const rows: any[] = [];

    // Seed the solve with the first id we actually have data for: the loop reports
    // unknown ids as per-row errors, so an unknown one in position 0 must not throw
    // away every other row.
    const seedId = monsterIds.find((id) => dataset.monsters[id]);
    if (seedId === undefined) throw new Error('Nenhum dos monstros informados tem bloco de atributos no calculador.');

    // One full solve, then re-target cheaply — changing the monster does not
    // invalidate the gear bonus pass, so runChain per target would be wasteful.
    const calc = solve(rb, dataset, dataset.monsters[seedId]);
    for (const id of monsterIds) {
      const monster = dataset.monsters[id];
      if (!monster) {
        rows.push({ id, error: 'sem bloco de atributos no calculador' });
        continue;
      }
      const dmg: any = calc.setMonster(monster).prepareAllItemBonus().calcDmgWithExtraBonus({ skillValue, isUseHpL: usedHpL });
      rows.push({
        id,
        name: monster.name,
        level: monster.stats?.level,
        hp: monster.stats?.health,
        min: dmg.skillMinDamage,
        max: dmg.skillMaxDamage,
        dps: dmg.skillDps,
        hitsToKill: dmg.skillHitKill,
      });
    }

    return {
      skill: skillValue,
      rows,
      share: shareOf(rb),
      ...(rb.warnings.length ? { warnings: rb.warnings } : {}),
    };
  }

async function compareBuilds({ builds, target, labels }: CompareBuildsArgs) {
    const inputs = await Promise.all(builds.map((build) => normalizeShare(build, shortener)));
    const { id: targetId, monster } = resolveTarget(dataset, target?.monsterId);
    const results = inputs.map((input, i) => {
      const rb = resolveBuild(input, dataset);
      const calc = solve(rb, dataset, monster);
      const out = projectResult(calc, rb, { targetId, share: shareOf(rb) });
      return { label: labels?.[i] ?? `Build ${i + 1}`, dps: out['damage'].skill.dps ?? 0, result: out };
    });

    const ranked = [...results].sort((a, b) => b.dps - a.dps);
    const best = ranked[0];
    return {
      best: best.label,
      ranking: ranked.map((r) => ({
        label: r.label,
        dps: r.dps,
        max: r.result['damage'].skill.max,
        deltaPct: deltaPct(r.dps, best.dps) ?? 0,
        share: r.result['share'],
      })),
      details: Object.fromEntries(results.map((r) => [r.label, r.result])),
    };
  }

async function optimizeSlot({ build, slot, candidates, slotTag, query, target, limit = 10, complements = true, refine, maxGrade, excludeMvpCards = false, constraints }: OptimizeSlotArgs) {
    if (constraints) constraints = constraintSpecSchema.parse(constraints);
    const input = await normalizeShare(build, shortener);
    if (!ITEM_ID_KEYS.includes(slot)) {
      // Without this the override is silently skipped and every candidate solves to
      // the baseline, producing a confident ranking of identical numbers.
      throw new Error(`"${slot}" não é um slot de equipamento. Use um destes: ${MAIN_ITEM_SLOTS.join(', ')}.`);
    }

    const baseRb = resolveBuild(input, dataset);
    const locks = equipmentLocks(baseRb.model, constraints);
    const inherited = new Set(constraintViolations(constraints ?? {}, dataset, baseRb.model, baseRb.model).map(v => `${v.code}:${v.message}`));
    const classId = baseRb.model.class;
    const { monster } = resolveTarget(dataset, target?.monsterId);

    const { ids: requested, eligible } = resolveCandidates(dataset, classId, { candidates, slotTag, query, excludeMvpCards });
    const bannedComplements = excludeMvpCards ? new Set<number>(MVP_CARD_IDS) : new Set<number>();
    const skippedNotInLatam = requested.filter((id) => !dataset.itemIndex.get(id)?.latam);
    const ids = requested.filter((id) => dataset.itemIndex.get(id)?.latam && locks.permitsItem(slot, id));
    if (!ids.length && !constraints) throw new Error(`Nenhum candidato disponível no LATAM (fora do LATAM: ${skippedNotInLatam.join(', ')}).`);

    const baseSolved = solve(baseRb, dataset, monster);
    const baseDps = dpsAndMax(baseSolved).dps;
    const keys = relevantKeys(baseSolved);
    const skillId = SKILL_ID_BY_NAME[String(baseRb.model.selectedAtkSkill ?? '').split('==')[0] as keyof typeof SKILL_ID_BY_NAME];
    if (skillId) keys.push(String(skillId), `cd__${skillId}`, `chance__${skillId}`);

    // Decode the share token once — resolveBuild would re-decompress it per candidate.
    const perCandidate = decodeOnce(input);
    const pace = pacing(config.limits.maxSearchMs);
    // About 400 calculations in all for the sockets: 48 each for a handful of candidates, fewer when there are dozens.
    const socketBudget = complements ? Math.min(48, Math.floor(400 / ids.length)) : 0;
    const measure = (patch: BuildPatch) => {
      // Gear changes invalidate the bonus pass, so each candidate needs a full solve.
      if (introducesHeadConflict(perCandidate, patch, dataset)) throw new Error('head slot conflict');
      if (!locks.permits(patch)) throw new Error('locked field changed');
      const rb = resolveBuild(applyPatch(perCandidate, patch), dataset);
      if (constraintViolations(constraints ?? {}, dataset, baseRb.model, rb.model).some(v => !inherited.has(`${v.code}:${v.message}`))) throw new Error('constraint violated');
      const { dps, max } = dpsAndMax(solve(rb, dataset, monster));
      return { rb, dps, max, metrics: { dps, max } as Record<string, number | undefined> };
    };

    const scored: any[] = [];
    let stoppedEarly = false;
    for (const id of ids) {
      await pace.breathe();
      if (pace.timeUp()) { stoppedEarly = true; break; }
      // The new piece keeps only the sockets it has; the old piece's rolls do not carry over.
      const worn = baseRb.model[slot] === id;
      // Ideal refine and grade unless the caller capped them; the worn piece gets them too, so its own upgrade shows.
      let patch: BuildPatch = locks.preserve(swapPatch(dataset, baseRb, slot, id, { refine, maxGrade }));
      let tried;
      try { tried = measure(patch); } catch { continue; }
      const bare = tried.dps;
      // When a field pins the worn piece, the remaining fields are still open.
      if (socketBudget > 0 && (!worn || constraints?.lockedFields?.some(field => slotOfField(field) === slot))) {
        const refined = searchComplements({ patch, result: tried }, locks.choices(complementChoices(dataset, slot, id, keys, bannedComplements)), 'dps', (candidate) => {
          try { return measure(candidate); } catch { return null; }
        }, socketBudget);
        patch = refined.patch;
        tried = refined.result;
      }
      const gear = (patch.gear ?? {}) as Record<string, unknown>;
      const sockets = relatedItemKeys(slot).flatMap((key) => typeof gear[key] === 'number' ? [`${key}: ${dataset.itemIndex.get(gear[key] as number)?.name ?? gear[key]}`] : []);
      scored.push({
        id,
        name: dataset.itemIndex.get(id)?.name ?? String(id),
        dps: round(tried.dps, 2),
        max: tried.max,
        deltaDps: round(tried.dps - baseDps, 2),
        deltaPct: deltaPct(tried.dps, baseDps),
        ...(sockets.length ? { sockets } : {}),
        ...(socketBudget > 0 && !worn ? { withoutSockets: round(bare, 2) } : {}),
        patch,
      });
    }

    scored.sort((a, b) => b.dps - a.dps);
    const top = scored.slice(0, limit);
    const winner = top[0];
    const currentId = baseRb.model[slot];

    // Arm the comparison so the link opens on the app's current → simulado view.
    // The app rebuilds a compared slot's related fields from model2 alone and merges
    // the result over the main model, so any card/enchant left out here would come
    // back as null — and the simulated side would not match the DPS ranked above.
    // Only main slots can be compared; the picker has no row for a card slot.
    const winnerGear = (winner?.patch.gear ?? {}) as Record<string, unknown>;
    const compare: CompareState | null =
      winner && MAIN_ITEM_SLOTS.includes(slot)
        ? {
            itemNames: [slot],
            model2: {
              [slot]: winner.id,
              [`${slot}Refine`]: (winnerGear[`${slot}Refine`] as number | undefined) ?? baseRb.model[`${slot}Refine`] ?? 0,
              [`${slot}Grade`]: (winnerGear[`${slot}Grade`] as string | undefined) ?? baseRb.model[`${slot}Grade`] ?? null,
              ...Object.fromEntries(relatedItemKeys(slot).map((k) => [k, k in winnerGear ? winnerGear[k] ?? null : baseRb.model[k] ?? null])),
            },
          }
        : null;

    // Against a target with no defenses penetration and TEN cannot show: repeat the winner against defended dummies.
    const context = damageContext(baseSolved);
    const defendedCheck = winner && isUndefended(context.target) ? CHECK_DUMMIES.flatMap((id) => {
      try {
        const dummy = resolveTarget(dataset, id).monster;
        const before = dpsAndMax(solve(baseRb, dataset, dummy)).dps;
        const after = dpsAndMax(solve(resolveBuild(applyPatch(perCandidate, winner.patch), dataset), dataset, dummy)).dps;
        return [{ target: dummy.name, id, current: round(before, 2), winner: round(after, 2), deltaPct: deltaPct(after, before) }];
      } catch { return []; }
    }) : undefined;

    return {
      slot,
      current: { id: currentId || null, name: currentId ? dataset.itemIndex.get(currentId)?.name : null, dps: round(baseDps, 2) },
      tested: scored.length,
      testedCandidates: scored.length,
      // Candidates (and the worn piece's own upgrade) are measured at the ideal refine/grade below, with their best sockets; `current` is the build as it came in the link.
      basis: `ganho sobre a build como veio no link; cada candidato testado com refino +${refine ?? REACHABLE_REFINE}, grau ${maxGrade ?? 'A'}${complements ? ' e os melhores soquetes' : ' e sem soquetes'}. Não é comparável a scan_slot (peça atual afinada) nem a evaluate_variants (refino e grau da peça atual).`,
      eligibleCandidates: eligible,
      // A best-of-slot claim is only valid when every eligible candidate was measured.
      complete: !stoppedEarly && scored.length === eligible,
      ranking: top.map(({ patch, ...row }) => row),
      share: shareOf(baseRb, compare),
      complements,
      limits: { refine: refine ?? REACHABLE_REFINE, maxGrade: maxGrade ?? 'A' },
      context,
      ...(defendedCheck?.length ? { defendedCheck: { note: 'O alvo não tem defesas: o primeiro colocado contra dummies com defesa de chefe.', rows: defendedCheck } } : {}),
      ...(skippedNotInLatam.length ? { skippedNotInLatam } : {}),
      ...(stoppedEarly ? { stopped: 'tempo esgotado: parte dos candidatos não foi testada' } : {}),
      ...(baseRb.warnings.length ? { warnings: baseRb.warnings } : {}),
    };
  }

async function parseShareLink({ share, raw }: ParseShareLinkArgs) {
    const decoded = parseShare(await resolveIfShort(share, config.shortenerUrl, shortener));
    const rb = resolveBuild({ preset: decoded.preset, customItems: (decoded.items ?? []).map((item) => ({ ...item })) }, dataset);
    const model = rb.model;

    const nameOf = (id: number) => rb.items[id]?.name ?? dataset.itemIndex.get(id)?.name ?? `#${id} (desconhecido)`;
    // Only the keys that actually hold equipment — a numeric-key sweep would also
    // report `aspdPotion` and `pet` as equipped pieces.
    const gear: Record<string, any> = {};
    for (const key of ITEM_ID_KEYS) {
      const value = model[key];
      if (typeof value !== 'number' || value <= 0 || !rb.items[value]) continue;
      gear[key] = compact({ id: value, name: nameOf(value), refine: model[`${key}Refine`] || undefined });
    }

    const compare = decoded.compare
      ? {
          slots: decoded.compare.itemNames,
          items: Object.fromEntries(
            Object.entries(decoded.compare.model2)
              .filter(([, v]) => typeof v === 'number' && (v as number) > 0 && rb.items[v as number])
              .map(([k, v]) => [k, { id: v, name: nameOf(v as number) }]),
          ),
        }
      : null;

    return {
      summary: `${rb.classInfo?.name ?? model.class} nível ${model.level}/${model.jobLevel}, ${Object.keys(gear).length} peça(s) equipada(s)${compare ? `, comparando ${compare.slots.join(', ')}` : ''}.`,
      build: {
        class: model.class,
        className: rb.classInfo?.name,
        level: model.level,
        jobLevel: model.jobLevel,
        stats: { str: model.str, agi: model.agi, vit: model.vit, int: model.int, dex: model.dex, luk: model.luk, pow: model.pow, sta: model.sta, wis: model.wis, spl: model.spl, con: model.con, crt: model.crt },
        atkSkill: model.selectedAtkSkill,
        consumables: (model.consumables ?? []).filter(Boolean).map((id: number) => ({ id, name: nameOf(id) })),
      },
      gear,
      compare,
      /** Re-emit this (with overrides) into any other tool. */
      ...(raw ? { buildInput: { preset: decoded.preset, customItems: (decoded.items ?? []).map((item) => ({ ...item })) } } : {}),
      ...(rb.warnings.length ? { warnings: rb.warnings } : {}),
    };
  }

async function shareLink({ build, compare, short }: ShareLinkArgs) {
    const rb = resolveBuild(await normalizeShare(build, shortener), dataset);
    const state: CompareState | null = compare ? { itemNames: compare.slots, model2: compare.gear } : null;
    const url = shareOf(rb, state);
    const finalUrl = short ? await shortenShareUrl(url, config.shortenerUrl, undefined, shortener) : url;
    return compact({
        url: finalUrl,
        note: short && finalUrl === url ? 'O encurtador não respondeu; devolvendo a URL longa.' : undefined,
        warnings: rb.warnings.length ? rb.warnings : undefined,
      });
  }

async function itemDescription({ id }: ItemDescriptionArgs) {
    const rec = dataset.itemIndex.record(id);
    const desc = plainItemDesc(await dataset.description(id));
    if (!desc) return { error: `Sem descrição para o item ${id}.` };
    return { id, name: dataset.itemIndex.get(id)?.name, description: desc, inCalcDb: !!rec };
  }

return { calculate, damageTable, compareBuilds, optimizeSlot, parseShareLink, shareLink, itemDescription, normalizeShare, resolveTarget };
}
