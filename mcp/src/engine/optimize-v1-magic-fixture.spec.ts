import { expect, it } from 'vitest';
import { decodeReplay } from 'rrfparser';
import { loadReplayFixture } from 'src/app/replay/__tests__/load-fixture';
import { replayToModel } from 'src/app/replay/replay-to-model';
import { loadDatasetFromDisk } from '../data/dataset.node';

it('imports the recorded Magus equipment and recorded traits without omitted items or sockets', () => {
  const replay: any = decodeReplay(loadReplayFixture('mg-pazzolino-field-arrow.rrf'));
  const imported = replayToModel(replay, loadDatasetFromDisk().items);
  expect(imported.summary.equippedCount).toBe(19);
  expect(imported.summary.skippedItems).toEqual([]);
  expect(imported.summary.skippedCards).toBe(0);
  expect(imported.summary.skippedOptions).toBe(0);
  expect(imported.summary.traits).toMatchObject({ sta: 39, wis: 39, spl: 100 });
  expect(imported.summary.learnedSkillCount).toBeGreaterThan(0);
});
