import { APP_VERSION } from 'src/app/core/app-version';
import { Dataset } from '../data/dataset';
import { BuildInput, resolveBuild } from '../engine/build-input';
import { Shortener } from '../engine/share';
import { synergyIndex } from '../engine/synergies';
import { synergyPatchBuilder, SynergyPatchConstraints } from '../engine/synergy-patches';
import { decodeOnce } from '../engine/variants';
import { equippedSources, itemContext } from '../engine/item-context';
import { AnalysisRuntime } from '../runtime';
import { createBuildContext } from './context';

export interface FindSynergiesArgs extends SynergyPatchConstraints {
  build?: BuildInput;
  itemIds?: number[];
  bonusKeys?: string[];
  limit?: number;
  offset?: number;
  includePatches?: boolean;
  target?: { monsterId?: number };
}

export function createSynergyOperations(dataset: Dataset, config: AnalysisRuntime, shortener?: Shortener) {
  const { normalizeShare, resolveTarget } = createBuildContext(config, shortener);
  return {
    async findSynergies({ build, itemIds = [], bonusKeys, limit = 12, offset = 0, includePatches = false, target, ...constraints }: FindSynergiesArgs) {
      if (!build && !itemIds.length) throw new Error('Informe build ou itemIds para consultar conjuntos relacionados.');
      if (includePatches && !build) throw new Error('includePatches requer build para validar posições, restrições e condições.');
      const base = build ? decodeOnce(await normalizeShare(build)) : undefined;
      const resolved = base ? resolveBuild(base, dataset) : undefined;
      const context = resolved ? itemContext(dataset, resolved) : dataset;
      const builder = includePatches ? synergyPatchBuilder(context, base!, resolveTarget(dataset, target?.monsterId).monster, constraints,
        Date.now() + config.limits.maxSearchMs, Math.min(50, config.limits.maxSolves)) : undefined;
      const worn = new Set<number>(resolved ? equippedSources(resolved).map(source => source.id) : []);
      const ids = [...new Set([...itemIds, ...worn])];
      const index = synergyIndex(context);
      const matching = index.forItems(ids).filter(rule => context.itemIndex.get(rule.sourceItemId)?.latam && (!bonusKeys?.length || bonusKeys.includes(rule.bonusKey)));
      return {
        engineVersion: APP_VERSION,
        indexVersion: 2,
        total: matching.length,
        offset,
        groups: matching.slice(offset, offset + limit).map(rule => ({
          ...rule,
          ...(builder ? builder.forRule(rule) : {}),
          sourceConfidence: context.items[rule.sourceItemId]?.custom ? 'user-defined' : 'authoritative-catalog',
          source: { itemId: rule.sourceItemId, path: `script.${rule.bonusKey}`, origin: context.items[rule.sourceItemId]?.custom ? 'request-custom-item' : 'calculator-catalog' },
          sourceEquipped: resolved ? worn.has(rule.sourceItemId) : undefined,
          allOf: rule.allOf.map(group => ({ anyOf: group.anyOf.map(option => ({
            ...option,
            items: option.itemIds.map(id => ({ id, name: context.itemIndex.get(id)?.name, latam: context.items[id]?.custom ? undefined : context.itemIndex.get(id)?.latam ?? false, custom: context.items[id]?.custom || undefined })),
            equipped: resolved ? option.itemIds.some(id => worn.has(id)) : undefined,
          })) })),
          equipmentRequirementsMet: resolved ? worn.has(rule.sourceItemId) && rule.allOf.every(group => group.anyOf.some(option => option.itemIds.some(id => worn.has(id)))) : undefined,
        })),
        ...(offset + limit < matching.length ? { nextOffset: offset + limit } : {}),
        ...(builder ? { patchEvaluations: builder.evaluations } : {}),
        coverage: {
          conditions: 'equipment-and-structured-conditions',
          catalog: 'authoritative',
          customItems: resolved?.customItems.length ?? 0,
          patches: builder ? 'validated-when-found' : 'not-requested',
          note: 'Catálogo e motor são a referência; personalizados vêm só desta build. allOf/anyOf preservam requisitos; conditions expõe predicados estruturados, unparsedExpression preserva a sintaxe ainda não decomposta. equipmentRequirementsMet só confere equipamentos. O motor verifica a expressão completa dos patches; mudanças de refino/grau/stats/skills exigem allowChanges explícito. Não promete melhor dano ou patch mínimo; not-found não prova impossibilidade. Itens sem bônus são válidos.',
        },
      };
    },
  };
}
