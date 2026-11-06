import { buildDataset } from '../../app/build-analysis/data/dataset';
import { createOptimizationOperations } from '../../app/build-analysis/operations/optimize';
import { createStatOperations } from '../../app/build-analysis/operations/optimize-stats';
import { loadRandomPools } from '../../app/core/random-option-catalog';
import type { AnalysisCancel, AnalysisRequest, AnalysisResponse } from '../../app/build-analysis/browser-protocol';
import type { AnalysisRuntime } from '../../app/build-analysis/runtime';
import { resolveBuild } from '../../app/build-analysis/engine/build-input';
import { applyPatch } from '../../app/build-analysis/engine/variants';
import { EQUIPMENT_SLOTS } from '../../app/app-config/equipment-slots';
import { constraintSpecSchema, goalSpecSchema } from '../../app/build-analysis/engine/goal-spec';

/** Isolated stateful engine: a search cannot mutate the calculator currently on screen. */
let controller: AbortController | undefined;
globalThis.onmessage = async ({ data }: MessageEvent<AnalysisRequest | AnalysisCancel>) => {
  if ('type' in data && data.type === 'cancel') { controller?.abort(); return; }
  const request = data as AnalysisRequest;
  data = request;
  controller = new AbortController();
  try {
    await loadRandomPools();
    const dataset = buildDataset(data.sources, async () => data.descriptions);
    const runtime: AnalysisRuntime = {
      appOrigin: data.origin, shortenerUrl: '', defaultTargetId: 21077,
      limits: { maxOptimizeCandidates: 40, maxTableMonsters: 20, maxCompareBuilds: 4,
        maxVariants: 100, maxContributions: 60, maxSearchMs: data.maxSearchMs, maxSolves: data.maxSolves },
    };
    if (data.mode === 'acquisition' || data.mode === 'acquisitionItem') {
      // Own chunk: the catalog is fetched only when the player opens the panel. No solver, no damage evaluation.
      const { createAcquisitionOperations } = await import('../../app/build-analysis/operations/acquisition');
      const acquisition = createAcquisitionOperations(dataset, runtime);
      const result = data.mode === 'acquisition'
        ? await acquisition.brief({ original: data.args.original, final: applyPatch(data.args.original, data.args.patch) })
        : await acquisition.assess({ itemId: data.args.itemId });
      globalThis.postMessage({ result } satisfies AnalysisResponse);
      return;
    }
    const ops = createOptimizationOperations(dataset, runtime);
    let result: Record<string, any>;
    switch (data.mode) {
      case 'build': {
        // The MCP validates these at its transport; the UI request is held to the same schemas before the core sees it.
        const { goal, constraints } = data.args;
        result = await ops.optimizeBuild({ ...data.args, ...(goal ? { goal: goalSpecSchema.parse(goal) } : {}), ...(constraints ? { constraints: constraintSpecSchema.parse(constraints) } : {}), execution: { signal: controller.signal, onCheckpoint: checkpoint => {
          const suggestedModel = resolveBuild(applyPatch(data.args.build, checkpoint['patch'] as any), dataset).model;
          const targetId = data.args.target?.monsterId ?? (data.mode === 'build' ? data.args.targets?.[0]?.monsterId : undefined) ?? runtime.defaultTargetId;
          globalThis.postMessage({ checkpoint: { ...checkpoint, suggestedModel, analysisTarget: { id: targetId, name: dataset.monsters[targetId]?.name } } } satisfies AnalysisResponse);
        } } });
        break;
      }
      case 'slot': result = await ops.scanSlot(data.args); break;
      case 'stats': result = await createStatOperations(dataset, runtime).optimizeStats(data.args); break;
      case 'explain': result = await ops.explainDamage(data.args); break;
    }
    // UI-only projection: keep the exact sockets/rolls used to measure each suggestion.
    if (result['patch']) result['suggestedModel'] = resolveBuild(applyPatch(data.args.build, result['patch']), dataset).model;
    if (result['suggestedModel']) {
      const before = resolveBuild(data.args.build, dataset).model as Record<string, any>;
      const after = result['suggestedModel'];
      const label = (value: any) => typeof value === 'number' && dataset.items[value] ? dataset.items[value].name : value ?? '';
      result['equipmentChanges'] = EQUIPMENT_SLOTS.flatMap(slot => {
        const keys = [slot.key, `${slot.key}Refine`, `${slot.key}Grade`, ...slot.cardFields, ...slot.enchantFields.filter(Boolean)];
        const rows = keys.filter(key => (before[key] ?? '') !== (after[key] ?? '')).map(key => ({ field: key, before: label(before[key]), after: label(after[key]) }));
        for (const index of slot.optionIndexes) if ((before['rawOptionTxts']?.[index] ?? '') !== (after['rawOptionTxts']?.[index] ?? '')) {
          rows.push({ field: `bonus ${index}`, before: before['rawOptionTxts']?.[index] ?? '', after: after['rawOptionTxts']?.[index] ?? '' });
        }
        return rows.length ? [{ slot: slot.key, before: label(before[slot.key]), after: label(after[slot.key]), rows }] : [];
      });
    }
    if (data.mode === 'slot') for (const row of result['ranking'] ?? []) {
      if (row.patch) row.suggestedModel = resolveBuild(applyPatch(data.args.build, row.patch), dataset).model;
    }
    const targetId = data.args.target?.monsterId ?? (data.mode === 'build' ? data.args.targets?.[0]?.monsterId : undefined) ?? runtime.defaultTargetId;
    result['analysisTarget'] = { id: targetId, name: dataset.monsters[targetId]?.name };
    globalThis.postMessage({ result } satisfies AnalysisResponse);
  } catch (error) {
    globalThis.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies AnalysisResponse);
  }
};
