import { expect, it } from 'vitest';
import items from '../../../src/assets/demo/data/item.json';
import { ExtraOptionTable } from '../../../src/app/constants/extra-option-table';
import { randomOptionReferencesFor } from './random-options';

it('audits every explicit item and every weapon/shadow with generic option fields', () => {
  for (const item of Object.values(items)) {
    // Imported previews have no random-option reference yet.
    if ((item as { preRelease?: boolean }).preRelease) continue;
    if (ExtraOptionTable[item.aegisName] || item.itemTypeId === 1 || item.itemTypeId === 10) {
      expect(randomOptionReferencesFor(item.id), String(item.id)).toBeDefined();
    }
  }
});

it('links Temporal mantles to the actual combiner and slot bounds, keeping upstream provenance', () => {
  const audit = randomOptionReferencesFor(20963)!;
  const ref = audit.references.find(ref => ref.group === 'TIME_UNSEAL_KEY')!;
  expect(ref.origin).toBe('Time_Unseal_Key');
  expect(ref.identityMatched).toBe(true);
  expect(ref.pool?.Slots?.length).toBeGreaterThan(0);
  expect(ref.url).toContain(audit.revision);
  expect(ref.options?.['VAR_MAXHPPERCENT']?.calculatorKey).toBe('hpPercent');
});

it('keeps missing regional pools and empty clearing groups explicit', () => {
  expect(randomOptionReferencesFor(410233)?.status).toBe('not-found');
  const ref = randomOptionReferencesFor(400465)!.references.find(ref => ref.group === 'Group_0')!;
  expect(ref.groupDefined).toBe(true);
  expect(ref.hasRollPool).toBe(false);
  expect(ref.pool).toBeUndefined();
});
