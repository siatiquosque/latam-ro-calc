import { Dataset } from '../data/dataset';
import { BuildInput } from '../engine/build-input';
import { resolveIfShort, Shortener } from '../engine/share';
import { AnalysisRuntime } from '../runtime';

/** Input/target resolution shared by all operations, independent of result presentation. */
export function createBuildContext(config: Pick<AnalysisRuntime, 'shortenerUrl' | 'defaultTargetId'>, shortener?: Shortener) {
  const normalizeShare = async (input: BuildInput, resolver = shortener): Promise<BuildInput> =>
    input.share ? { ...input, share: await resolveIfShort(input.share, config.shortenerUrl, resolver) } : input;

  function resolveTarget(dataset: Dataset, monsterId?: number) {
    const id = monsterId ?? config.defaultTargetId;
    const monster = dataset.monsters[id];
    if (!monster) throw new Error(`Monstro ${id} não tem bloco de atributos no calculador e não pode ser alvo. Use search_monsters.`);
    return { id, monster };
  }

  return { normalizeShare, resolveTarget };
}
