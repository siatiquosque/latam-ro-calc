import { EQUIPMENT_SLOTS } from 'src/app/app-config/equipment-slots';
import { ItemTypeEnum } from 'src/app/constants/item-type.enum';
import { MVP_CARD_IDS } from 'src/app/constants/mvp-cards';
import { Dataset } from '../data/dataset';
import { BuildInput, ITEM_ID_KEYS, MAIN_ITEM_SLOTS, relatedItemKeys, resolveBuild } from './build-input';
import { socketOptions, swapPatch } from './complements';
import { solve } from './solve';
import { SynergyRule } from './synergies';
import { validateBuild } from './validate';
import { applyPatch, BuildPatch } from './variants';
import { conditionPatch, ConditionChanges } from './synergy-conditions';
import { equippedSources } from './item-context';

export interface SynergyPatchConstraints extends ConditionChanges {
  lock?: string[];
  exclude?: number[];
  mvpPolicy?: 'allow' | 'exclude-new' | 'none';
}

/** Bounded prerequisite placement, not a damage optimizer. The motor verifies the complete original expression. */
export function synergyPatchBuilder(dataset: Dataset, base: BuildInput, monster: any, constraints: SynergyPatchConstraints, deadline: number, maxEvaluations: number) {
  const initial = resolveBuild(base, dataset);
  const initialSources = equippedSources(initial);
  const wornIds = new Set(initialSources.map(source => source.id));
  const locks = new Set(constraints.lock ?? []);
  for (const slot of locks) if (!MAIN_ITEM_SLOTS.includes(slot) && !ITEM_ID_KEYS.includes(slot) && !initialSources.some(source => source.field === slot)) throw new Error(`Slot travado desconhecido: ${slot}.`);
  const excluded = new Set(constraints.exclude ?? []);
  let nodes = 0;
  let evaluations = 0;
  const expired = () => nodes >= 2000 || evaluations >= maxEvaluations || Date.now() >= deadline;
  const allowed = (id: number) => !!dataset.items[id] && dataset.itemIndex.get(id)?.latam && !excluded.has(id)
    && (!MVP_CARD_IDS.has(id) || constraints.mvpPolicy !== 'none' && (constraints.mvpPolicy !== 'exclude-new' || wornIds.has(id)));

  return {
    get evaluations() { return evaluations; },
    forRule(rule: SynergyRule) {
      let lastError: string | undefined;
      const groups = [[rule.sourceItemId], ...rule.allOf.map(group => [...new Set(group.anyOf.flatMap(option => option.itemIds))])]
        .map(ids => ids.filter(allowed))
        // Place parents before cards/enchants, so a later parent swap never clears a required socket.
        .sort((a, b) => Number(!a.some(id => dataset.itemIndex.get(id)?.slotTags?.some(tag => MAIN_ITEM_SLOTS.includes(tag))))
          - Number(!b.some(id => dataset.itemIndex.get(id)?.slotTags?.some(tag => MAIN_ITEM_SLOTS.includes(tag)))));
      const visit = (index: number, patch: BuildPatch, reserved: Set<string>): { patch: BuildPatch; activation: { active: boolean; value: number; field: string; monsterId: number } } | undefined => {
        if (expired()) return undefined;
        nodes++;
        const input = applyPatch(base, patch);
        let rb: ReturnType<typeof resolveBuild>;
        try { rb = resolveBuild(input, dataset); } catch { return undefined; }
        const breaksLock = (candidate: typeof rb) => {
          const sources = equippedSources(candidate);
          return [...locks].some(slot => [slot, `${slot}Refine`, `${slot}Grade`, ...relatedItemKeys(slot)].some(field => candidate.model[field] !== initial.model[field])
            || sources.find(source => source.field === slot)?.id !== initialSources.find(source => source.field === slot)?.id
            || JSON.stringify(candidate.model.customAttachments?.[slot]) !== JSON.stringify(initial.model.customAttachments?.[slot]));
        };
        if (breaksLock(rb)) return undefined;
        if (index === groups.length) {
          const sources = equippedSources(rb);
          if (sources.some(source => excluded.has(source.id))) return undefined;
          if (!validateBuild(input, dataset, { excludeMvpCards: constraints.mvpPolicy === 'none' }).valid) return undefined;
          const fields = sources.filter(source => source.id === rule.sourceItemId).map(source => source.field);
          if (!groups.every(ids => sources.some(source => ids.includes(source.id)))) return undefined;
          const check = (candidate: typeof rb, candidatePatch: BuildPatch) => {
            if (expired()) return undefined;
            evaluations++;
            try {
              const calc = solve(candidate, dataset, monster);
              for (const field of fields) {
                const parent = EQUIPMENT_SLOTS.find(slot => slot.key === field || slot.cardFields.includes(field as ItemTypeEnum) || slot.enchantFields.includes(field as ItemTypeEnum));
                const customParent = /^(.+)Custom(?:Card|Enchant)\d+$/.exec(field)?.[1];
                const owner = customParent ?? parent?.key;
                const refine = owner ? candidate.model.customAttachments?.[owner]?.refine ?? candidate.model[`${owner}Refine`] ?? 0 : 0;
                const activation = calc.evaluateItemRule(field as ItemTypeEnum, rule.expression, refine);
                if (activation.active) return { patch: candidatePatch, activation: { ...activation, field, monsterId: monster.id } };
              }
            } catch (error) { lastError = String(error); }
            return undefined;
          };
          const current = check(rb, patch);
          if (current) return current;
          for (const field of fields) {
            const adjustment = conditionPatch(rb, field, rule, constraints);
            if (!Object.keys(adjustment).length) continue;
            const adjusted = applyPatch(patch, adjustment);
            const adjustedInput = applyPatch(base, adjusted);
            let candidate: typeof rb;
            try { candidate = resolveBuild(adjustedInput, dataset); } catch { continue; }
            if (breaksLock(candidate) || !validateBuild(adjustedInput, dataset, { excludeMvpCards: constraints.mvpPolicy === 'none' }).valid) continue;
            const result = check(candidate, adjusted);
            if (result) return result;
          }
          return undefined;
        }
        const ids = groups[index];
        const existing = equippedSources(rb).filter(source => ids.includes(source.id)).map(source => source.field);
        if (existing.length) {
          for (const field of existing) {
            const result = visit(index + 1, patch, new Set([...reserved, field]));
            if (result) return result;
          }
          return undefined;
        }
        for (const id of ids) {
          const tags = dataset.itemIndex.get(id)?.slotTags ?? [];
          const placements: { field: string; parent: string; patch: BuildPatch }[] = [];
          for (const slot of EQUIPMENT_SLOTS) {
            if (dataset.itemIndex.get(id)?.slotTags?.includes(slot.key as never)) {
              // New equipment starts at +0/no grade; finding a set must not silently buy upgrades.
              placements.push({ field: slot.key, parent: slot.key, patch: swapPatch(dataset, rb, slot.key, id, { refine: 0, maxGrade: 'none' }) });
            }
            if (!rb.items[rb.model[slot.key]]?.custom && (tags.includes('enchant') || tags.some(tag => tag.endsWith('Card')))) {
              for (const option of socketOptions(dataset, slot.key, rb.model[slot.key])) {
                if (option.ids.includes(id)) placements.push({ field: option.field, parent: slot.key, patch: { gear: { [option.field]: id } } });
              }
            }
          }
          for (const placement of placements) {
            if (locks.has(placement.field) || locks.has(placement.parent) || reserved.has(placement.field)) continue;
            const next = applyPatch(patch, placement.patch);
            const result = visit(index + 1, next, new Set([...reserved, placement.field]));
            if (result) return result;
          }
        }
        return undefined;
      };
      const result = visit(0, {}, new Set());
      return result ? { patchStatus: 'available' as const, ...result }
        : { patchStatus: expired() ? 'budget-limited' as const : lastError ? 'failed' as const : 'not-found' as const,
          patchReason: lastError ?? 'Nenhum patch validado encontrado neste limite com as mudanças autorizadas. Predicados não estruturados permanecem em unparsedExpression; not-found não prova impossibilidade.' };
    },
  };
}
