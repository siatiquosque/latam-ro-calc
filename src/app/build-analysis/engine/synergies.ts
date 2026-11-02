import { itemBonusScriptEntries } from 'src/app/models/item.model';
import { Dataset } from '../data/dataset';
import { readVisualItemRule, VisualCondition } from 'src/app/core/custom-item-visual-script';

/** Equipment requirements keep the engine's AND-of-ORs semantics; unresolved names are never silently dropped. */
export interface SynergyRequirement {
  reference: string;
  itemIds: number[];
}

export interface SynergyRule {
  id: string;
  sourceItemId: number;
  bonusKey: string;
  expression: string;
  allOf: { anyOf: SynergyRequirement[] }[];
  /** Complete original clauses not interpreted by this equipment dependency index. */
  remainingExpression: string;
  conditions: VisualCondition[];
  conditionCoverage: 'equipment-only' | 'structured' | 'partial';
  unparsedExpression?: string;
}

const indexes = new WeakMap<Dataset, ReturnType<typeof buildSynergyIndex>>();

function buildSynergyIndex(dataset: Dataset) {
  // Match the motor's English display-name spelling, including case, rather than a fuzzy name search.
  const byName = new Map<string, number[]>();
  for (const item of Object.values(dataset.items)) {
    const name = String(item.enName ?? item.name ?? '').replace(/\[\d]$/, '').trim();
    byName.set(name, [...new Set([...(byName.get(name) ?? []), Number(item.id)])]);
  }
  const rules: SynergyRule[] = [];
  const byItem = new Map<number, SynergyRule[]>();
  for (const [rawId, item] of Object.entries(dataset.items)) {
    // Alias records do not declare a second copy of the same rules.
    const id = Number(rawId);
    if (id !== Number(item.id)) continue;
    for (const [key, expressions] of itemBonusScriptEntries(item.script)) {
      for (const [position, expression] of expressions.entries()) {
        const allOf: SynergyRule['allOf'] = [];
        const remainingExpression = expression.replace(/EQUIP(_ID)?\[([^\]]+)]/g, (clause, ids: string | undefined, body: string) => {
          if (ids && !/^\d+(?:(?:&&|\|\|)\d+)*$/.test(body)) return clause;
          for (const group of body.split('&&')) allOf.push({ anyOf: group.split('||').map(reference => ({
            reference,
            itemIds: ids ? [Number(reference)] : [...(byName.get(reference) ?? [])],
          })) });
          return '';
        });
        const parsed = readVisualItemRule(key, remainingExpression);
        if (!allOf.length && !parsed.conditions.length && !parsed.readOnly) continue;
        const rule: SynergyRule = {
          id: `item:${id}:${key}:${position}`, sourceItemId: id, bonusKey: key, expression, allOf, remainingExpression,
          conditions: parsed.conditions,
          conditionCoverage: parsed.readOnly ? 'partial' : parsed.conditions.length ? 'structured' : 'equipment-only',
          ...(parsed.readOnly ? { unparsedExpression: remainingExpression } : {}),
        };
        rules.push(rule);
        const involved = new Set([id, ...allOf.flatMap(group => group.anyOf.flatMap(option => option.itemIds))]);
        for (const involvedId of involved) byItem.set(involvedId, [...(byItem.get(involvedId) ?? []), rule]);
      }
    }
  }
  return { rules, forItems: (ids: number[]) => [...new Set(ids.flatMap(id => byItem.get(id) ?? []))] };
}

/** Derived from the shipped scripts; scoped to the immutable dataset, shared by any caller. No DPS or search here. */
export function synergyIndex(dataset: Dataset) {
  let known = indexes.get(dataset);
  if (!known) { known = buildSynergyIndex(dataset); indexes.set(dataset, known); }
  return known;
}
