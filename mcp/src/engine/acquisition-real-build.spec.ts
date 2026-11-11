import { describe, expect, it } from 'vitest';
import { resolveBuild } from 'src/app/build-analysis/engine/build-input';
import { assessAcquisition } from 'src/app/build-analysis/acquisition/assess';
import { loadDatasetFromDisk } from '../data/dataset.node';

describe('acquisition on a real resolved build', () => {
  it('reads a real resolved build without changing public BuildInput', () => {
    const resolved = resolveBuild({ class: 4255, gear: { headUpper: 19482, headUpperEnchant1: 29080 } }, loadDatasetFromDisk());
    const result = assessAcquisition(resolved, 'LATAM', { asOf: '2026-11-05' });
    expect(result.diagnostics.find((d: any) => d.aspect === 'enchant')?.status).toBe('difficult');
  });
});
