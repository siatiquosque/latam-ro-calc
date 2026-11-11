import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { resolveBuild } from './build-input';
import { solve } from './solve';

it('shared Inquisitor build wwGlfR reproduces 204.056 max HP with all equipment', () => {
  const dataset = loadDatasetFromDisk();
  const preset = JSON.parse(readFileSync('mcp/src/engine/__tests__/fixtures/inquisitor-geared-hp.json', 'utf8'));
  const build = resolveBuild({ preset }, dataset);
  const calc = solve(build, dataset, dataset.monsters['21077']);
  expect(calc.getTotalSummary().calc.maxHp).toBe(204056);
});

it('the same build without its weapon reproduces Fogueira 5 at 8.364.528 damage', () => {
  const dataset = loadDatasetFromDisk();
  const preset = JSON.parse(readFileSync('mcp/src/engine/__tests__/fixtures/inquisitor-geared-hp.json', 'utf8'));
  const build = resolveBuild({ preset, gear: { weapon: null }, atkSkill: 'Third Flame Bomb==5' }, dataset);
  const summary = solve(build, dataset, dataset.monsters['21077']).getTotalSummary();
  expect(summary.dmg.skillMinDamage).toBe(8364528);
  expect(summary.dmg.skillMaxDamage).toBe(8364528);
  expect(summary.dmg.basicMinDamage).toBe(8140);
  expect(summary.dmg.basicMaxDamage).toBe(8140);
  expect(summary.dmg.criMinDamage).toBe(15576);
  expect(summary.dmg.criMaxDamage).toBe(15576);
});
