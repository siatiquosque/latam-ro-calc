import { Dataset } from '../data/dataset';
import { BuildInput } from '../engine/build-input';
import { resolveBuild } from 'src/app/build-analysis/engine/build-input';

const BASE_STATS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'] as const;

/**
 * A build that starts empty has every attribute at 1, so its damage is tiny and every percentage gain over it is inflated
 * (an AI answering from it reported "+1534%"). The numbers still rank options against each other; they are not a result.
 */
export function buildNote(dataset: Dataset, build: BuildInput | undefined): string | undefined {
  try {
    const model = resolveBuild(build ?? {}, dataset).model as unknown as Record<string, number | undefined>;
    if (BASE_STATS.every(stat => (model[stat] ?? 1) <= 1)) {
      return 'Build sem atributos (todos em 1): o dano e os ganhos em % servem só para comparar opções entre si, não como resultado real. '
        + 'Passe o link da build; sem ele, use `optimize_stats` para distribuir os atributos e preencha `gear` e as passivas antes de comparar peças. Contra chefe com defesa, uma build nua pode dar dano 0 e nenhum ranking.';
    }
  } catch { /* a build that does not resolve fails in the tool itself, with its own message */ }
  return undefined;
}

/** `result` with the note first, when there is one. Results that are not plain objects pass through unchanged. */
export function withBuildNote<T>(dataset: Dataset, build: BuildInput | undefined, result: T): T {
  const note = buildNote(dataset, build);
  if (!note || !result || typeof result !== 'object' || Array.isArray(result)) return result;
  return { aviso: note, ...result } as T;
}
