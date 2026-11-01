/**
 * `evaluate_variants`, `explain_damage` and `slot_options`, called the way an agent would:
 * through a real in-memory MCP client.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import { resolveBuild } from '../engine/build-input';
import { solve } from '../engine/solve';
import { config } from '../config';

const dataset = loadDatasetFromDisk();
let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res: any = await client.callTool({ name, arguments: args });
  const text = res.content[0].text as string;
  return { data: JSON.parse(text), bytes: text.length, isError: !!res.isError };
};

/** An Inquisidor 236/50, bare-handed but for a weapon, on the neutral dummy. */
const BUILD = {
  class: 4262, level: 236, jobLevel: 50,
  stats: { str: 120, agi: 50, vit: 120, int: 80, dex: 120, luk: 63, pow: 100, con: 43 },
  gear: { weapon: 560026, weaponRefine: 11 },
  atkSkill: 'Explosion Blaster==5',
  skills: { active: { 'Total Spirit': 15, 'Powerful Faith': 5 } },
};

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'spec', version: '1.0.0' });
  await Promise.all([createMcpServer(dataset).connect(serverTransport), client.connect(clientTransport)]);
});

describe('evaluate_variants', () => {
  it('agrees with `calculate` on the baseline and ranks the variants best first', async () => {
    const { data: calculated } = await call('calculate', { build: BUILD });
    const { data, isError } = await call('evaluate_variants', {
      build: BUILD,
      variants: [
        { label: 'sem Mantra', patch: { skills: { active: { 'Powerful Faith': 0 } } } },
        { label: 'mais POD', patch: { stats: { pow: 130 } } },
        { label: 'sem arma', patch: { gear: { weapon: null } } },
      ],
      metrics: ['max', 'dps', 'hp'],
    });

    expect(isError).toBe(false);
    expect(data.baseline.max).toBe(calculated.damage.skill.max);
    expect(data.tested).toBe(3);
    expect(data.results.map((r: any) => r.label)).toEqual(['mais POD', 'sem Mantra', 'sem arma']);
    expect(data.results[0].deltaPct.dps).toBeGreaterThan(0);
    expect(data.results[2].deltaPct.dps).toBeLessThan(data.results[1].deltaPct.dps);
    // The first three results carry a link to open in the simulator.
    expect(data.results[0].share).toMatch(/\/s\//);
  });

  it('drops the variants that fail `require`, and says how many', async () => {
    const { data: all } = await call('evaluate_variants', {
      build: BUILD,
      variants: [{ label: 'base', patch: {} }, { label: 'mais VIT', patch: { stats: { vit: 130 } } }],
      metrics: ['hp'],
    });
    const hpBase = all.baseline.hp;

    const { data } = await call('evaluate_variants', {
      build: BUILD,
      variants: [{ label: 'base', patch: {} }, { label: 'mais VIT', patch: { stats: { vit: 130 } } }],
      metrics: ['hp'],
      require: [{ metric: 'hp', min: hpBase + 1 }],
    });
    expect(data.results.map((r: any) => r.label)).toEqual(['mais VIT']);
    expect(data.discarded).toEqual({ belowRequire: 1, invalid: 0 });
  });

  it('reports a variant it cannot resolve without failing the batch', async () => {
    const { data, isError } = await call('evaluate_variants', {
      build: BUILD,
      variants: [{ label: 'ok', patch: {} }, { label: 'classe inexistente', patch: { class: 999999 } }],
    });
    expect(isError).toBe(false);
    expect(data.results).toHaveLength(1);
    expect(data.discarded.invalid).toBe(1);
    expect(data.errors[0].label).toBe('classe inexistente');
  });

  it('refuses a batch over the limit', async () => {
    const variants = Array.from({ length: 101 }, (_, i) => ({ label: `v${i}`, patch: {} }));
    const { data, isError } = await call('evaluate_variants', { build: BUILD, variants });
    expect(isError).toBe(true);
    expect(data.error).toMatch(/No máximo 100/);
  });

  it('reads the rotation DPS from the build\'s rotation', async () => {
    const { data } = await call('evaluate_variants', {
      build: { ...BUILD, rotation: ['Explosion Blaster==5', 'First Brand==5'] },
      variants: [{ label: 'só a Mão Explosiva', patch: { rotation: ['Explosion Blaster==5'] } }],
      metrics: ['dps', 'rotationDps'],
    });
    expect(data.baseline.rotationDps).toBeGreaterThan(0);
    expect(data.results[0].metrics.rotationDps).toBeGreaterThan(0);
    expect(data.baseline.rotationDps).not.toBe(data.results[0].metrics.rotationDps);
  });
});

describe('explain_damage', () => {
  it('lists the formula stages, what each piece is worth and what the number leaves out', async () => {
    const { data, isError } = await call('explain_damage', {
      // Fogueira carries 20% of the HP máx., so the VIT proc moves it; Mão Explosiva would not notice.
      build: { ...BUILD, atkSkill: 'Third Flame Bomb==5', gear: { ...BUILD.gear, boot: 470073, bootRefine: 11 } },
      metric: 'max',
    });

    expect(isError).toBe(false);
    expect(data.stages.length).toBeGreaterThan(3);
    expect(data.stages.every((s: any) => typeof s.label === 'string' && typeof s.value === 'number')).toBe(true);

    const weapon = data.contributions.rows.find((r: any) => r.detail === 'weapon');
    expect(weapon.withoutPct).toBeLessThan(-10);
    const mantra = data.contributions.rows.find((r: any) => r.name === 'Powerful Faith');
    expect(mantra.withoutPct).toBeLessThan(0);

    // The VIT boot's proc is not in the number; the warning says how much it would add.
    const proc = data.warnings.find((w: any) => w.type === 'proc' && /Vitality|VIT/.test(w.name));
    expect(proc.gainMaxPct).toBeGreaterThan(0);
  });

  it('can be asked for the stages alone', async () => {
    const { data } = await call('explain_damage', { build: BUILD, parts: ['stages'] });
    expect(Object.keys(data).sort()).toEqual(['metric', 'stages', 'value']);
  });
});

describe('slot_options', () => {
  it('exposes sourced upstream pools and generic weapon capacity without claiming regional validation', async () => {
    const { data: raw } = await call('slot_options', { itemId: 2963, detail: true });
    expect(raw.randomOptions.upstream.references[0].group).toBe('GEFFEN_MAGIC_SCROLL2');
    expect(raw.randomOptions.upstream.references[0].pool.Slots.length).toBeGreaterThan(0);
    const { data } = await call('slot_options', { itemId: 2963 });
    expect(data.randomOptions.upstream.groups[0].group).toBe('GEFFEN_MAGIC_SCROLL2');
    expect(data.randomOptions.upstream.groups[0].slots[0].every((entry: string) => /^\??[A-Za-z_]+( \d+(-\d+)?)?$/.test(entry))).toBe(true);
    expect(data.randomOptions.validation).toBe('capacity-only');
    expect(data.randomOptions.automaticRollSearch).toBe(false);
    const weapon = (await call('slot_options', { itemId: 560026 })).data;
    expect(weapon.randomOptions.capacity).toBe(3);
    expect(weapon.randomOptions.slots.some(slot => slot.positions.length === 3)).toBe(true);
  });
  it('reads the bROWiki pool of an item it covers, e.g. the Manto Branco Físico', async () => {
    const { data } = await call('slot_options', { itemId: 480812 });
    expect(data.randomOptions.validation).toBe('reference-ranges');
    expect(data.randomOptions.catalog.source).toContain('browiki.org');
    expect(data.randomOptions.catalog.profiles[0].combiner).toBe('Sobrecarga Temporal');
    expect(data.randomOptions.catalog.profiles[0].positions).toHaveLength(2);
    expect(data.randomOptions.catalog.profiles[0].positions[0]).toContain('def 30-100');
  });
  it('exposes Loki random-option positions instead of implying it cannot be enhanced', async () => {
    const { data } = await call('slot_options', { itemId: 410233 });
    expect(data.randomOptions.capacity).toBe(2);
    expect(data.randomOptions.validation).toBe('reference-ranges');
    expect(data.randomOptions.catalog.profiles).toHaveLength(4);
    expect(data.randomOptions.slots.find((s: any) => s.slot === 'headMiddle').positions).toHaveLength(2);
    expect(data.note).toContain('bônus aleatórios');
    const build = { ...BUILD, gear: { ...BUILD.gear, headMiddle: 410233 } };
    const position = data.randomOptions.slots.find((s: any) => s.slot === 'headMiddle').positions[0];
    const variants = (await call('evaluate_variants', {
      build, variants: [{ label: 'rolled bonus', patch: { options: { [String(position)]: 'atk:5' } } }], metrics: ['max'],
    })).data;
    const rb = resolveBuild({ ...build, options: { [String(position)]: 'atk:5' } }, dataset);
    const calc = solve(rb, dataset, dataset.monsters['21077']);
    expect(variants.results[0].metrics.max).toBe(calc.getTotalSummary().dmg.skillMaxDamage);
    expect(variants.results[0].metrics.max).toBeGreaterThan(variants.baseline.max);
    const invalid = await call('evaluate_variants', {
      build, variants: [{ label: 'invalid roll', patch: { options: { [String(position)]: 'atk:999' } } }],
    });
    expect(invalid.data.discarded.invalid).toBe(1);
  });
  const names = (data: any) => data.enchants.flatMap((e: any) => e.options.map((o: any) => o.name));

  it('offers B-VIT to both Automatron accessories, and B-FOR only to the A one', async () => {
    const left = (await call('slot_options', { itemId: 490025, limit: 100 })).data;
    const right = (await call('slot_options', { itemId: 490024, limit: 100 })).data;

    expect(names(left)).toContain('B-VIT');
    expect(names(right)).toContain('B-VIT');
    expect(names(right)).toContain('B-FOR');
    expect(names(left)).not.toContain('B-FOR');
    expect(left.enchants[0].options[0].id).toBeGreaterThan(0);
  });

  it('filters by name and says when a piece takes no enchant', async () => {
    const { data } = await call('slot_options', { itemId: 490025, query: 'vit' });
    expect(names(data).every((n: string) => /vit/i.test(n))).toBe(true);

    const plain = (await call('slot_options', { itemId: 2301 })).data;
    expect(plain.error ?? plain.note).toBeTruthy();
  });
});

describe('optimize_build', () => {
  it('searches Loki rolls and reproduces the complete winning build from its share and patch', async () => {
    const base = { ...BUILD, gear: { ...BUILD.gear, headMiddle: 410233, headLower: 420210 } };
    const { data, isError } = await call('optimize_build', {
      build: base, slots: ['headMiddle'], candidates: { headMiddle: [] }, objective: 'max', maxSolves: 100,
    });
    expect(isError).toBe(false);
    expect(data.complementSearch.enabled).toBe(true);
    expect(Object.keys(data.patch.options ?? {}).length).toBeGreaterThan(0);
    expect(data.final.max).toBeGreaterThan(data.baseline.max);
    const reread = (await call('calculate', { build: { share: data.share } })).data;
    expect(reread.damage.skill.max).toBe(data.final.max);
    const variants = (await call('evaluate_variants', { build: base, variants: [{ label: 'completo', patch: data.patch }], metrics: ['max'] })).data;
    expect(variants.results[0].metrics.max).toBe(data.final.max);
  });
  it('fills cards and legal enchantments on the worn boot without requiring a gear replacement', async () => {
    const base = { ...BUILD, gear: { ...BUILD.gear, boot: 470094, bootRefine: 11 } };
    const { data, isError } = await call('optimize_build', {
      build: base, slots: ['boot'], candidates: { boot: [] }, objective: 'max', maxSolves: 100,
    });
    expect(isError).toBe(false);
    expect(data.patch.gear.bootCard).toBeGreaterThan(0);
    expect(Object.keys(data.patch.gear).some(key => key.startsWith('bootEnchant'))).toBe(true);
    const reread = (await call('calculate', { build: { share: data.share } })).data;
    expect(reread.damage.skill.max).toBe(data.final.max);
  });
  it('searches grades only up to the requested ceiling, including grading the worn item', async () => {
    const base = { ...BUILD, gear: { ...BUILD.gear, boot: 470094, bootRefine: 11 } };
    const capped = (await call('optimize_build', { complements: false, build: base, slots: ['boot'], candidates: { boot: [470094] }, maxGrade: 'C', objective: 'max' })).data;
    expect(capped.patch.gear.bootGrade).toBe('C');
    const reread = (await call('calculate', { build: { share: capped.share } })).data;
    expect(reread.damage.skill.max).toBe(capped.final.max);
    const ungraded = (await call('optimize_build', { complements: false, build: base, slots: ['boot'], candidates: { boot: [470094] }, maxGrade: 'none', objective: 'max' })).data;
    expect(ungraded.steps).toEqual([]);
    const above = await call('optimize_build', { complements: false, build: { ...base, gear: { ...base.gear, bootGrade: 'A' } }, slots: ['boot'], maxGrade: 'C' });
    expect(above.isError).toBe(true);
    expect(above.data.error).toContain('excede o grau máximo');
  });

  it('keeps the real build comparisons sensitive to grade, set partners and target size', async () => {
    const build = JSON.parse(readFileSync('mcp/src/engine/__tests__/fixtures/inquisitor-optimization.json', 'utf8'));
    const shadows = [
      { label: 'POD pair', patch: { gear: { shadowWeapon: 24751, shadowShield: 24752, shadowWeaponRefine: 10, shadowShieldRefine: 10 } } },
      { label: 'POD and Infinity', patch: { gear: { shadowWeapon: 24751, shadowShield: 24733, shadowWeaponRefine: 10, shadowShieldRefine: 10 } } },
    ];
    const medium = (await call('evaluate_variants', { build, target: { monsterId: 21077 }, variants: shadows, sortBy: 'max' })).data;
    const large = (await call('evaluate_variants', { build, target: { monsterId: 21066 }, variants: shadows, sortBy: 'max' })).data;
    expect(medium.results[0].label).toBe('POD pair');
    expect(large.results[0].label).toBe('POD and Infinity');
    const variants = [[470069, '', 'Eden'], [470094, '', 'LT ungraded'], [470094, 'A', 'LT A']].map(([id, grade, label]) => ({
      label, patch: { gear: { boot: id, bootRefine: 11, bootGrade: grade, bootEnchant0: null, bootEnchant1: null, bootEnchant2: null, bootEnchant3: null } },
    }));
    const boots = (await call('evaluate_variants', { build, variants, sortBy: 'max' })).data;
    expect(boots.results.map((r: any) => r.label)).toEqual(['LT A', 'Eden', 'LT ungraded']);
  });

  it('discovers English-named and reverse-declared set partners', async () => {
    const boots = (await call('optimize_build', { complements: false, build: BUILD, slots: ['boot'], objective: 'max', candidatesPerSlot: 1, detail: true })).data;
    expect(boots.candidateIds.boot).toContain(470094); // Hero Boots-LT [1], named by the weapon.
    const loki = (await call('optimize_build', { complements: false,
      build: { ...BUILD, gear: { ...BUILD.gear, headMiddle: 410233 } },
      slots: ['headLower'], objective: 'max', candidatesPerSlot: 1, detail: true,
    })).data;
    expect(loki.candidateIds.headLower).toContain(420210); // Only Selo de Copas declares the combo.
  });

  it('removes old random options and grade from replacement pieces and returns a reproducible patch', async () => {
    const base = { ...WEAK, gear: { ...WEAK.gear, bootGrade: 'A' }, options: { '38': 'hpPercent:1' } };
    const result = (await call('optimize_build', { complements: false, build: base, slots: ['boot'], candidates: { boot: [470069] }, objective: 'max' })).data;
    expect(result.patch.gear.bootGrade).toBe('');
    const comparison = (await call('evaluate_variants', { build: base, variants: [{ label: 'patch', patch: result.patch }], metrics: ['max'] })).data;
    expect(comparison.results[0].metrics.max).toBe(result.final.max);
    expect(result.patch.options).toBeDefined();
  });
  /** A build with weak boots and a weak garment, so a search has something to find. */
  const WEAK = { ...BUILD, gear: { ...BUILD.gear, boot: 22005, bootRefine: 4, garment: 20964, garmentRefine: 8 } };

  it('improves the objective, and the link it returns reads back as the number it reported', async () => {
    const { data, isError } = await call('optimize_build', { complements: false, build: WEAK, slots: ['boot', 'garment'], objective: 'max' });

    expect(isError).toBe(false);
    expect(data.steps.length).toBeGreaterThan(0);
    expect(data.final.max).toBeGreaterThan(data.baseline.max);
    expect(data.deltaPct.max).toBeGreaterThan(0);
    expect(data.stopped).toBe('convergiu');
    expect(Object.keys(data.patch.gear).every((slot) => ['boot', 'garment'].some(parent => slot.startsWith(parent)))).toBe(true);

    // What the search reported is what `calculate` reads off the build it handed back.
    const { data: reread } = await call('calculate', { build: { share: data.share } });
    expect(reread.damage.skill.max).toBe(data.final.max);

    // The patch is ready for `evaluate_variants`, and lands on the same number.
    const { data: variants } = await call('evaluate_variants', { build: WEAK, variants: [{ label: 'sugestão', patch: data.patch }], metrics: ['max'] });
    expect(variants.results[0].metrics.max).toBe(data.final.max);
  });

  it('leaves locked slots and excluded items alone', async () => {
    const free = (await call('optimize_build', { complements: false, build: WEAK, slots: ['boot'], objective: 'max' })).data;
    const winner = free.patch.gear.boot;
    expect(winner).toBeGreaterThan(0);

    const locked = (await call('optimize_build', { complements: false, build: WEAK, slots: ['boot'], lock: ['boot'], objective: 'max' })).data;
    expect(locked.steps).toEqual([]);
    expect(locked.patch.gear).toEqual({});

    const excluded = (await call('optimize_build', { complements: false, build: WEAK, slots: ['boot'], exclude: [winner], objective: 'max' })).data;
    expect(excluded.patch.gear.boot).not.toBe(winner);
  });

  it('respects `require` and the solve budget, and says so', async () => {
    const strict = (await call('optimize_build', { complements: false, build: WEAK, slots: ['boot'], objective: 'max', require: [{ metric: 'hp', min: 10_000_000 }] })).data;
    expect(strict.steps).toEqual([]);

    const capped = (await call('optimize_build', { complements: false, build: WEAK, slots: ['boot', 'garment'], objective: 'max', maxSolves: 10 })).data;
    expect(capped.solves).toBeLessThanOrEqual(10);
    expect(capped.stopped).toMatch(/orçamento/);
  });

  it('refuses a slot that is not equipment', async () => {
    const { data, isError } = await call('optimize_build', { complements: false, build: WEAK, slots: ['mochila'] });
    expect(isError).toBe(true);
    expect(data.error).toMatch(/Não são slots de equipamento/);
  });
});

describe('optimize_build pairs and procs', () => {
  const WEAK = { ...BUILD, gear: { ...BUILD.gear, boot: 22005, bootRefine: 4, garment: 20964, garmentRefine: 8 } };

  it('tries two slots together when asked, and the link still reproduces the reported number', async () => {
    const { data, isError } = await call('optimize_build', {
      complements: false, combos: false, rounds: 1, build: WEAK, slots: ['boot', 'garment'], objective: 'max',
      candidates: { boot: [470094, 470069], garment: [480174, 480306] }, pairs: [['boot', 'garment']],
    });
    expect(isError).toBe(false);
    expect(data.final.max).toBeGreaterThan(data.baseline.max);
    const reread = (await call('calculate', { build: { share: data.share } })).data;
    expect(reread.damage.skill.max).toBe(data.final.max);
  });
  it('rejects a pair that is not two searched slots', async () => {
    for (const pairs of [[['boot', 'boot']], [['boot', 'weapon']]]) {
      const { data, isError } = await call('optimize_build', { build: WEAK, slots: ['boot', 'garment'], pairs });
      expect(isError).toBe(true);
      expect(data.error).toMatch(/Par .* inválido/);
    }
  });
  it('reports what each uncounted proc would add on the final build', async () => {
    // The VIT Bota Desconhecida carries a proc that is only counted when asked for.
    const procBuild = { ...BUILD, gear: { ...BUILD.gear, boot: 470073, bootRefine: 15 } };
    const args = { complements: false, build: procBuild, slots: ['garment'], objective: 'max', candidatesPerSlot: 1 };
    const { data } = await call('optimize_build', args);
    expect(data.procs.options.length).toBeGreaterThan(0);
    for (const proc of data.procs.options) expect(typeof proc.effect).toBe('string');
    const first = data.procs.options[0].effect;
    const counted = (await call('optimize_build', { ...args, effects: [first] })).data;
    expect(counted.procs?.options.map((p: any) => p.effect) ?? []).not.toContain(first);
  });
  it('counts the procs every tested build offers when asked, and says which', async () => {
    const procBuild = { ...BUILD, gear: { ...BUILD.gear, boot: 470073, bootRefine: 15 } };
    const { data, isError } = await call('optimize_build', { complements: false, build: procBuild, slots: ['garment'], objective: 'max', candidatesPerSlot: 1, countProcs: true });
    expect(isError).toBe(false);
    expect(data.countedProcs.length).toBeGreaterThan(0);
    expect(data.procs).toBeUndefined();
  });
});

describe('optimize_stats', () => {
  // POD (the stat this skill scales with) starved, the points parked in STA and SAB.
  const WASTED = { ...BUILD, stats: { ...BUILD.stats, pow: 40, sta: 60, wis: 40 } };

  it('moves the points to what the skill scales with, within the points the level allows', async () => {
    const { data, isError } = await call('optimize_stats', { build: WASTED, objective: 'max', lock: ['con'] });
    expect(isError).toBe(false);
    expect(data.final.max).toBeGreaterThan(data.baseline.max);
    expect(data.changes.pow.to).toBeGreaterThan(data.changes.pow.from);
    expect(data.changes.con).toBeUndefined();
    for (const group of data.points) expect(group.used).toBeLessThanOrEqual(group.budget);
    const reread = (await call('calculate', { build: { share: data.share } })).data;
    expect(reread.damage.skill.max).toBe(data.final.max);
    const variants = (await call('evaluate_variants', { build: WASTED, variants: [{ label: 'sugestão', patch: data.patch }], metrics: ['max'] })).data;
    expect(variants.results[0].metrics.max).toBe(data.final.max);
  });
  it('respects a floor on another metric', async () => {
    const floor = (await call('calculate', { build: WASTED })).data.stats.maxHp as number;
    const { data } = await call('optimize_stats', { build: WASTED, objective: 'max', require: [{ metric: 'hp', min: floor }] });
    expect(data.final.hp).toBeGreaterThanOrEqual(floor);
  });
});

describe('explain_damage refine', () => {
  it('ranks the worn pieces by what one more refine level adds', async () => {
    const { data, isError } = await call('explain_damage', { build: { ...BUILD, gear: { ...BUILD.gear, boot: 470094, bootRefine: 7 } }, parts: ['refine'] });
    expect(isError).toBe(false);
    expect(data.stages).toBeUndefined();
    const rows = data.refine.rows as { slot: string; plus1Pct: number; plus2Pct?: number; refine: number }[];
    expect(rows.map((row) => row.slot)).toEqual(expect.arrayContaining(['weapon', 'boot']));
    expect(rows.find((row) => row.slot === 'weapon')!.plus1Pct).toBeGreaterThan(0);
    expect(rows.map((row) => row.plus1Pct)).toEqual([...rows.map((row) => row.plus1Pct)].sort((a, b) => b - a));
  });
});

describe('optimize_build alternatives', () => {
  it('shows the runners-up of each slot, never the piece that won', async () => {
    const WEAK = { ...BUILD, gear: { ...BUILD.gear, boot: 22005, bootRefine: 4 } };
    const { data } = await call('optimize_build', { complements: false, build: WEAK, slots: ['boot'], objective: 'max', candidatesPerSlot: 4, detail: true });
    const worn = data.patch.gear.boot ?? 22005;
    expect(data.alternatives.boot.length).toBeGreaterThan(0);
    expect(data.alternatives.boot.length).toBeLessThanOrEqual(3);
    for (const alt of data.alternatives.boot) expect(alt.to.every((label: string) => label.includes(`(${worn})`))).toBe(false);
    const gains = data.alternatives.boot.map((alt: any) => alt.vsBuildThenPct);
    expect(gains).toEqual([...gains].sort((a: number, b: number) => b - a));
  });
});

describe('search time allowance', () => {
  it('stops with the best build so far when the wall-clock allowance runs out', async () => {
    const saved = config.limits.maxSearchMs;
    config.limits.maxSearchMs = 1;
    try {
      const { data, isError } = await call('optimize_build', { build: BUILD });
      expect(isError).toBe(false);
      expect(data.stopped).toMatch(/tempo/);
      expect(data.final.dps).toBeGreaterThanOrEqual(data.baseline.dps);
      const stats = (await call('optimize_stats', { build: BUILD })).data;
      expect(stats.stopped).toMatch(/tempo/);
    } finally { config.limits.maxSearchMs = saved; }
  });
});

describe('answers stay short by default', () => {
  it('leaves candidate ids, alternatives and raw pools out unless asked', async () => {
    const { data } = await call('optimize_build', { complements: false, build: BUILD, slots: ['boot'], candidatesPerSlot: 2 });
    expect(data.candidateIds).toBeUndefined();
    expect(data.alternatives).toBeUndefined();
    expect(data.complementSearch.uncataloguedRandomItems.count).toBeGreaterThanOrEqual(0);
    expect(typeof (data.steps[0]?.to ?? data.steps[0]?.combo?.[0]?.to ?? '')).toBe('string');
  });
  it('merges sockets that offer the same enchants and sends compact JSON', async () => {
    const res: any = await client.callTool({ name: 'slot_options', arguments: { itemId: 490024 } });
    const text = res.content[0].text as string;
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
    expect(JSON.parse(text).enchants).toHaveLength(1);
    expect(JSON.parse(text).enchants[0].positions).toEqual([1, 2, 3]);
  });
});

describe('optimize_build with rAthena pools', () => {
  // Anel Intensificador Físico: no regional pool, but the rAthena reference has one.
  const RING = { ...BUILD, gear: { ...BUILD.gear, accLeft: 2963 } };
  const run = (pools: string) => call('optimize_build', { complements: true, build: RING, slots: ['accLeft'], candidates: { accLeft: [] }, objective: 'max', maxSolves: 200, pools });

  it('keeps unconfirmed pools out by default and says which rolls came from them when asked', async () => {
    const confirmed = (await run('confirmed')).data;
    expect(Object.keys(confirmed.patch.options ?? {})).toHaveLength(0);
    expect(confirmed.unconfirmedRolls).toBeUndefined();

    const upstream = (await run('upstream')).data;
    expect(Object.keys(upstream.patch.options ?? {}).length).toBeGreaterThan(0);
    expect(upstream.final.max).toBeGreaterThan(confirmed.final.max);
    expect(upstream.unconfirmedRolls[0].item).toContain('(2963)');
    const reread = (await call('calculate', { build: { share: upstream.share } })).data;
    expect(reread.damage.skill.max).toBe(upstream.final.max);
  });
});

describe('optimize_build with wiki pools', () => {
  it('rolls the Manto Branco Físico from its bROWiki pool, with no opt-in and nothing flagged as unconfirmed', async () => {
    const build = { ...BUILD, gear: { ...BUILD.gear, garment: 480812, garmentRefine: 11 } };
    const { data, isError } = await call('optimize_build', { build, slots: ['garment'], candidates: { garment: [] }, objective: 'max', maxSolves: 200 });
    expect(isError).toBe(false);
    expect(Object.keys(data.patch.options ?? {}).length).toBeGreaterThan(0);
    expect(data.final.max).toBeGreaterThan(data.baseline.max);
    expect(data.unconfirmedRolls).toBeUndefined();
    const reread = (await call('calculate', { build: { share: data.share } })).data;
    expect(reread.damage.skill.max).toBe(data.final.max);
  });
});
