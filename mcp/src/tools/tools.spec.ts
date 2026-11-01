/**
 * Tool contract tests. These call the registered handlers through a real in-memory
 * MCP client, so the zod schemas and result shapes are exercised exactly as an agent
 * would hit them — including the serialized-size ceilings, which are the regression
 * guard for token cost.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadDatasetFromDisk } from '../data/dataset.node';
import { createMcpServer } from '../mcp-server';
import { decodeCustomBundle } from 'src/app/core/custom-item-library';
import { CUSTOM_ITEM_MIN_ID } from 'src/app/core/custom-items';

const dataset = loadDatasetFromDisk();
let client: Client;

/** Every tool returns a single JSON text block. */
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res: any = await client.callTool({ name, arguments: args });
  const text = res.content[0].text as string;
  return { data: JSON.parse(text), bytes: text.length, isError: !!res.isError };
};

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'spec', version: '1.0.0' });
  await Promise.all([createMcpServer(dataset).connect(serverTransport), client.connect(clientTransport)]);
});

describe('tool surface', () => {
  it('advertises the full build schema once, so the tool list stays small', async () => {
    const list = await client.listTools();
    expect(JSON.stringify(list).length).toBeLessThan(48_000);
    const withFullBuild = list.tools.filter((tool) => JSON.stringify(tool.inputSchema).includes('"jobLevel"'));
    expect(withFullBuild.map((tool) => tool.name)).toEqual(['calculate']);
  });

  it('still validates the build against the full schema when the tool advertises the compact one', async () => {
    const result: any = await client.callTool({ name: 'optimize_slot', arguments: { build: { class: 4262, level: 999 }, slot: 'weapon', candidates: [560037] } }).catch((error) => ({ isError: true, content: [{ text: String(error) }] }));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/level|300|validation/i);
  });

  it('exposes the full set', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'calculate',
        'compare_builds',
        'create_custom_items',
        'damage_table',
        'get_custom_item_schema',
        'guide',
        'get_item',
        'get_monster',
        'item_description',
        'list_bonus_keys',
        'list_classes',
        'list_skills',
        'evaluate_variants',
        'explain_damage',
        'optimize_build',
        'optimize_slot',
        'optimize_stats',
        'scan_slot',
        'parse_share_link',
        'search_items',
        'search_monsters',
        'share_link',
        'slot_options',
        'uncatalogued_pools',
        'validate_custom_items',
      ].sort(),
    );
  });
});

describe('custom item tools', () => {
  const first = CUSTOM_ITEM_MIN_ID + 500;
  const second = CUSTOM_ITEM_MIN_ID + 501;
  const items = [
    { id: first, name: 'Espada MCP', kind: 'weapon', itemSubTypeId: 257, itemLevel: 5, attack: 100,
      script: { atk: [`EQUIP_ID[${second}]20`] } },
    { id: second, name: 'Carta MCP', kind: 'card', script: { cri: ['5'] } },
  ];

  it('validates and returns one portable link for a forward-reference batch', async () => {
    const validated = await call('validate_custom_items', { items });
    expect(validated.data.valid).toBe(true);
    const mocked = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 503 }));
    const created = await call('create_custom_items', { items });
    mocked.mockRestore();
    expect(created.data.valid).toBe(true);
    expect(created.data.items[0].item).toMatchObject({ id: first, name: 'Espada MCP' });
    const token = new URL(created.data.url).hash.split('customItem=')[1];
    expect(decodeCustomBundle(token).map((item) => item.id)).toEqual([first, second]);
  });

  it('keeps custom-item links on the current domain when the shortener is disabled', async () => {
    const shortUrl = 'https://short.latam-tools.com.br/itens123';
    const mocked = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ short_url: shortUrl }), { status: 200 }));
    const created = await call('create_custom_items', { items });
    expect(created.data.url).toMatch(/^https:\/\/laro-calc\.siatiquosque\.com\.br\//);
    expect(mocked).not.toHaveBeenCalled();
    mocked.mockRestore();
  });

  it('rejects a broken member without returning a partial link', async () => {
    const result = await call('create_custom_items', { items: [items[0], { ...items[1], script: { madeUp: ['1'] } }] });
    expect(result.isError).toBe(true);
    expect(result.data.valid).toBe(false);
    expect(result.data.errors[0].path).toContain('items[1]');
    expect(result.data.url).toBeUndefined();
  });

  it('uses request-local definitions in calculation and carries them into share links', async () => {
    const build = { class: 4257, level: 200, jobLevel: 50, stats: { dex: 130 },
      gear: { weapon: first }, atkSkill: 'Focused Arrow Strike==5', customItems: items };
    const calculated = await call('calculate', { build });
    expect(calculated.isError).toBe(false);
    expect(calculated.data.share).toContain('/s/');
    const fromShare = await call('calculate', { build: { share: calculated.data.share } });
    expect(fromShare.isError).toBe(false);
  });
});

describe('discovery', () => {
  it('list_classes stays small', async () => {
    const { data, bytes } = await call('list_classes');
    expect(data.classes).toHaveLength(41);
    expect(data.classes[0]).toMatchObject({ id: expect.any(Number), name: expect.any(String), maxLevel: expect.any(Number) });
    expect(bytes).toBeLessThan(8000);
  });

  it('search_items covers both databases and flags which is which', async () => {
    const inCalc = await call('search_items', { query: 'arco de apoio' });
    expect(inCalc.data.items.some((i: any) => i.id === 700016 && i.db === true)).toBe(true);

    // 7508 exists in latam-items.json only — the app itself cannot surface it.
    const latamOnly = await call('search_items', { query: 'allysia' });
    expect(latamOnly.data.items[0]).toMatchObject({ id: 7508, db: false });
  });

  it('search_items keeps a page of results cheap', async () => {
    const { data, bytes } = await call('search_items', { query: 'arco', limit: 20 });
    expect(data.items.length).toBeLessThanOrEqual(20);
    expect(bytes).toBeLessThan(4000);
  });

  it('get_item decodes the bonus script with pt-BR labels', async () => {
    const { data } = await call('get_item', { id: 1291 });
    expect(data.name).toBeTruthy();
    expect(data.bonuses.some((b: any) => b.key === 'dex')).toBe(true);
    // The description must be plain text, not the app's <font>-tag popover HTML.
    expect(data.description).not.toMatch(/<font|\^[0-9a-fA-F]{6}/);
  });

  it('get_item explains an item with no calculator record instead of erroring', async () => {
    const { data } = await call('get_item', { id: 7508 });
    expect(data).toMatchObject({ id: 7508, inCalcDb: false });
    expect(data.note).toMatch(/não foi cadastrado/);
  });

  it('search_monsters defaults to targets calculate can actually use', async () => {
    const { data } = await call('search_monsters', { query: 'osiris' });
    expect(data.monsters.every((m: any) => m.hasStats !== false)).toBe(true);
    expect(data.monsters.some((m: any) => m.id === 1038)).toBe(true);
  });

  it('list_skills returns values calculate accepts verbatim', async () => {
    const { data } = await call('list_skills', { classId: 4261, kind: 'atk' });
    const skill = data.skills.find((s: any) => s.value === 'Poison Burst==5');
    expect(skill).toBeTruthy();
    expect(skill.label).toBeTruthy();
  });
});

describe('calculate', () => {
  const build = { class: 4261, level: 230, jobLevel: 47, stats: { int: 133, spl: 100, vit: 120 }, atkSkill: 'Poison Burst==5' };

  it('reproduces the replay-validated damage and stays under the size ceiling', async () => {
    const { data, bytes } = await call('calculate', { build, target: { monsterId: 21077 } });
    expect(data.damage.skill.max).toBe(68309);
    expect(data.target).toMatchObject({ id: 21077, name: 'Dummy - Neutro' });
    expect(data.share).toMatch(/^https:\/\/laro-calc\.siatiquosque\.com\.br\/s\/[A-Za-z0-9.$-]+\/$/);
    // The default result must stay cheap — never spread getTotalSummary().
    expect(bytes).toBeLessThan(4000);
  });

  it('accepts a share link as the build, with overrides on top', async () => {
    const first = await call('calculate', { build, target: { monsterId: 21077 } });
    const viaShare = await call('calculate', { build: { share: first.data.share }, target: { monsterId: 21077 } });
    expect(viaShare.data.damage).toEqual(first.data.damage);

    const overridden = await call('calculate', { build: { share: first.data.share, level: 200 }, target: { monsterId: 21077 } });
    expect(overridden.data.build.level).toBe(200);
    expect(overridden.data.damage.skill.max).not.toBe(68309);
  });

  it('reports an unusable target as a tool error, not a crash', async () => {
    const { data, isError } = await call('calculate', { build, target: { monsterId: 999999 } });
    expect(isError).toBe(true);
    expect(data.error).toMatch(/não tem bloco de atributos/);
  });

  it('include: tables adds the multiplier tables on request only', async () => {
    const plain = await call('calculate', { build });
    expect(plain.data.tables).toBeUndefined();
    const withTables = await call('calculate', { build, include: ['tables'] });
    expect(withTables.data.tables.element.length).toBeGreaterThan(0);
    expect(withTables.bytes).toBeGreaterThan(plain.bytes);
  });
});

describe('optimize_slot', () => {
  it('ranks candidates and arms the comparison in the returned link', async () => {
    const { data } = await call('optimize_slot', {
      build: {
        class: 4257,
        level: 200,
        jobLevel: 50,
        stats: { agi: 100, dex: 130, pow: 60, con: 40 },
        gear: { weapon: 700016, weaponRefine: 11, ammo: 1773 },
        atkSkill: 'Focused Arrow Strike==5',
      },
      slot: 'weapon',
      slotTag: 'weapon',
      query: 'arco',
      limit: 3,
    });

    expect(data.ranking.length).toBeGreaterThan(0);
    expect(data.ranking[0].dps).toBeGreaterThanOrEqual(data.ranking[data.ranking.length - 1].dps);
    expect(data.current.id).toBe(700016);

    // The link must open the app on its current → simulado view.
    const parsed = await call('parse_share_link', { share: data.share });
    expect(parsed.data.compare.slots).toEqual(['weapon']);
    expect(parsed.data.compare.items.weapon.id).toBe(data.ranking[0].id);
  });
});

describe('regressions', () => {
  const windhawk = {
    class: 4257,
    level: 200,
    jobLevel: 50,
    stats: { agi: 100, dex: 130, pow: 60, con: 40 },
    gear: { weapon: 700016, weaponRefine: 11, weaponCard1: 4628, ammo: 1773 },
    atkSkill: 'Focused Arrow Strike==5',
  };

  it('damage_table honours HP Increase Potion (L) like calculate does', async () => {
    // Tiger Cannon's base damage is literally a function of maxHp (Sura.ts:232), so
    // it is the skill that exposes the flag. The per-target recompute used to hardcode
    // isUseHpL:false, making this tool disagree with `calculate` for the same build.
    const build = { class: 13, level: 200, jobLevel: 50, stats: { str: 110, vit: 100, dex: 90 }, atkSkill: 'Tiger Cannon==10', consumables: [12424] };
    const single = await call('calculate', { build, target: { monsterId: 21077 } });
    const table = await call('damage_table', { build, monsterIds: [21077] });

    // Guard that the fixture actually exercises the flag: without the potion the
    // damage must differ, otherwise this test could never fail.
    const noPotion = await call('calculate', { build: { ...build, consumables: [] }, target: { monsterId: 21077 } });
    expect(single.data.damage.skill.max).not.toBe(noPotion.data.damage.skill.max);

    expect(table.data.rows[0].max).toBe(single.data.damage.skill.max);
  });

  it('damage_table survives an unknown id in the first position', async () => {
    const { data } = await call('damage_table', { build: windhawk, monsterIds: [999999, 21077] });
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).toMatchObject({ id: 999999, error: expect.any(String) });
    expect(data.rows[1].max).toBeGreaterThan(0);
  });

  it('optimize_slot rejects a slot that is not an equipment field', async () => {
    // Previously this silently scored every candidate as the untouched base build.
    const { data, isError } = await call('optimize_slot', { build: windhawk, slot: 'boots', candidates: [700016], target: { monsterId: 21077 } });
    expect(isError).toBe(true);
    expect(data.error).toMatch(/não é um slot de equipamento/);
  });

  it('optimize_slot carries the slot cards into the emitted comparison', async () => {
    // The app rebuilds a compared slot's related fields from model2 alone, so a card
    // left out here comes back as null and the simulated side stops matching the rank.
    const { data } = await call('optimize_slot', { build: windhawk, slot: 'weapon', candidates: [18186], target: { monsterId: 21077 }, limit: 1, complements: false });
    const parsed = await call('parse_share_link', { share: data.share });
    expect(parsed.data.compare.items.weapon.id).toBe(18186);
    expect(parsed.data.compare.items.weaponCard1.id).toBe(4628);
  });

  it('optimize_slot tests each candidate with its own sockets and drops the ones it cannot hold', async () => {
    // Soqueira Invernal (no card slot) and Vil Invernal (one slot, other enchants) share ATK and script: only the sockets tell them apart.
    const build = { class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', gear: { weapon: 560032, weaponRefine: 15 },
      stats: { str: 130, agi: 50, vit: 50, int: 1, dex: 80, luk: 30, pow: 100, sta: 50, con: 50 } };
    const { data } = await call('optimize_slot', { build, slot: 'weapon', candidates: [560032, 560037, 700016] });
    const vil = data.ranking.find((row: any) => row.id === 560037);
    expect(vil.sockets?.length).toBeGreaterThan(0);
    expect(vil.dps).toBeGreaterThan(vil.withoutSockets);
    expect(data.skippedNotInLatam ?? []).toEqual([]);
  });

  it('ranks the next investments: refine, grade, enchant level and an empty enchant socket', async () => {
    const build = { class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', gear: { weapon: 560037, weaponRefine: 10, weaponGrade: 'D', weaponEnchant1: 311449 },
      stats: { str: 130, agi: 50, vit: 50, int: 1, dex: 80, luk: 30, pow: 100, sta: 50, con: 50 } };
    const { data } = await call('explain_damage', { build, parts: ['upgrades'] });
    const actions = data.upgrades.ranked.map((row: any) => row.action);
    expect(actions.some((a: string) => /^refino/.test(a))).toBe(true);
    expect(actions.some((a: string) => /^grau/.test(a))).toBe(true);
    expect(actions.some((a: string) => /nível/.test(a))).toBe(true);
    expect(data.upgrades.ranked[0].gainPct).toBeGreaterThanOrEqual(data.upgrades.ranked[data.upgrades.ranked.length - 1].gainPct);
  });

  it('optimize_slot defaults to the ideal refine and grade, and a cap limits them', async () => {
    const build = { class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', gear: { weapon: 560037, weaponRefine: 10 },
      stats: { str: 130, agi: 50, vit: 50, int: 1, dex: 80, luk: 30, pow: 100, sta: 50, con: 50 } };
    const ideal = await call('optimize_slot', { build, slot: 'weapon', candidates: [560037], complements: false });
    const capped = await call('optimize_slot', { build, slot: 'weapon', candidates: [560037], complements: false, refine: 10, maxGrade: 'none' });
    expect(ideal.data.limits).toEqual({ refine: 12, maxGrade: 'A' });
    expect(ideal.data.ranking[0].dps).toBeGreaterThan(capped.data.ranking[0].dps);
    expect(capped.data.ranking[0].deltaPct).toBe(0);
  });

  it('optimize_build shows the result against each target, so a normal monster and a boss can be told apart', async () => {
    const { data } = await call('optimize_build', { build: windhawk, slots: ['boot'], candidates: { boot: [470069] }, targets: [{ monsterId: 21077 }, { monsterId: 3507 }], maxSolves: 60 });
    expect(data.perTarget).toHaveLength(2);
    expect(data.perTarget.every((row: any) => typeof row.final === 'number' && typeof row.baseline === 'number')).toBe(true);
    expect(data.perTarget.map((row: any) => row.name).length).toBe(2);
  });

  it('optimize_build tunes the worn pieces (rolls, cards) before comparing replacements with them', async () => {
    // The link brings Selo de Loki and Selo de Copas with no rolls; the Máscara de Pesar (Meio + Baixo) must not win just because
    // the walk reaches the Meio slot before the Copas has had its rolls.
    const build = { class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', gear: { weapon: 560037, weaponRefine: 12, headMiddle: 410233, headLower: 420210 },
      stats: { str: 130, agi: 50, vit: 50, int: 1, dex: 80, luk: 30, pow: 100, sta: 50, con: 50 } };
    const { data } = await call('optimize_build', { build, slots: ['headMiddle', 'headLower'], candidates: { headMiddle: [436031] }, objective: 'max', maxSolves: 400 });
    const tuned = data.steps.filter((step: any) => step.atual);
    expect(tuned.length).toBeGreaterThan(0);
    expect(tuned[0].from).toBe(tuned[0].to);
    expect(Object.keys(data.patch.options ?? {}).length).toBeGreaterThan(0);
  });

  it('optimize_build tells whether a new piece wins at the current refine and grade, only when evolved, or not at all', async () => {
    const build = { class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', gear: { weapon: 560032, weaponRefine: 8, weaponGrade: 'D' },
      stats: { str: 130, agi: 50, vit: 50, int: 1, dex: 80, luk: 30, pow: 100, sta: 50, con: 50 } };
    const { data } = await call('optimize_build', { build, slots: ['weapon'], candidates: { weapon: [560037] }, objective: 'max', maxSolves: 600 });
    const weapon = data.levelCheck.find((entry: any) => entry.slot === 'weapon');
    const row = weapon.rows.find((entry: any) => /Vil Invernal/.test(entry.item));
    expect(typeof row.now).toBe('number');
    expect(typeof row.evolved).toBe('number');
    expect(['melhor nos dois níveis', 'só vence evoluída', 'vence agora, perde evoluída', 'não vence']).toContain(row.verdict);
  });

  it('repeats the result against defended dummies when the target has no defenses, and reads breakpoints and objective notes', async () => {
    const build = { class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', gear: { weapon: 560037, weaponRefine: 12 },
      stats: { str: 130, agi: 50, vit: 50, int: 1, dex: 80, luk: 30, pow: 100, sta: 50, con: 50 } };
    const { data } = await call('optimize_build', { build, slots: ['boot'], candidates: { boot: [470069] }, objective: 'max', maxSolves: 60 });
    expect(data.alerts.join(' ')).toMatch(/9000001/);
    expect(data.defendedCheck).toHaveLength(2);
    expect(data.defendedCheck[0].baseline).toBeLessThan(data.defendedCheck[0].final + 1);
    expect(data.alerts.join(' ')).toMatch(/dps/);
    const full = await call('optimize_build', { build, slots: ['boot'], candidates: { boot: [470069] }, objective: 'max', maxSolves: 60, detail: true });
    expect(full.data.context.breakpoints).toMatchObject({ aspdCap: 193 });
    const defended = await call('optimize_build', { build, slots: ['boot'], candidates: { boot: [470069] }, objective: 'dps', maxSolves: 60, target: { monsterId: 9000002 } });
    expect(defended.data.defendedCheck).toBeUndefined();
    const defendedFull = await call('optimize_build', { build, slots: ['boot'], candidates: { boot: [470069] }, objective: 'dps', maxSolves: 60, target: { monsterId: 9000002 }, detail: true });
    expect(defendedFull.data.context.target.name).toMatch(/Chefe Médio/);
    expect(defendedFull.data.context.target.def).toBe(512);
  });

  it('avgHit is the average hit with crit and accuracy, between min and max', async () => {
    const { data } = await call('evaluate_variants', { build: windhawk, variants: [{ label: 'base', patch: {} }], metrics: ['avgHit', 'min', 'max'], target: { monsterId: 21077 } });
    const m = data.results[0].metrics;
    expect(m.avgHit).toBeGreaterThan(0);
    expect(m.avgHit).toBeLessThanOrEqual(m.max * 1.5);
  });

  const inquisitor = { class: 4262, level: 250, jobLevel: 50, atkSkill: 'Third Flame Bomb==5', gear: { weapon: 560032, weaponRefine: 8, weaponGrade: 'D' },
    stats: { str: 130, agi: 50, vit: 50, int: 1, dex: 80, luk: 30, pow: 100, sta: 50, con: 50 } };

  it('scan_slot measures every usable item of a slot, tunes the best ones and lists set partners', async () => {
    const { data } = await call('scan_slot', { build: inquisitor, slot: 'weapon', query: 'Soqueira', limit: 5, topSockets: 4 });
    expect(data.eligible).toBeGreaterThan(3);
    expect(data.scanned).toBe(data.eligible);
    expect(data.ranking.length).toBeGreaterThan(1);
    expect(data.ranking[0].value).toBeGreaterThanOrEqual(data.ranking[data.ranking.length - 1].value);
    expect(data.reference.basis).toMatch(/melhores soquetes/);
    expect(data.ranking.some((row: any) => row.id === 560037)).toBe(true);
    expect(data.context.undefendedNote).toBeTruthy();
  });

  it('scan_slot finds a piece whose value is in its sockets, not in its bare stats', async () => {
    // Soqueira Vil Invernal has the same ATK and script as the Invernal: bare it ties with dozens of weapons, with sockets it wins.
    const { data } = await call('scan_slot', { build: { ...inquisitor, rotation: undefined }, slot: 'weapon', limit: 6 });
    const vil = data.ranking.findIndex((row: any) => row.id === 560037);
    expect(vil).toBeGreaterThanOrEqual(0);
    expect(vil).toBeLessThanOrEqual(1);
    expect(data.ranking[vil].sockets.length).toBeGreaterThan(0);
  }, 60_000);

  it('optimize_build offers the higher-level sibling of the worn piece, which no script key would find', async () => {
    const { data } = await call('optimize_build', { build: { ...inquisitor, rotation: undefined }, slots: ['weapon'], maxSolves: 400, detail: true });
    expect(data.candidateIds.weapon).toContain(560037);
  }, 60_000);

  it('evaluate_variants warns when a swapped-in piece is left with empty sockets', async () => {
    const { data } = await call('evaluate_variants', { build: { ...inquisitor, rotation: undefined }, variants: [{ label: 'vil', patch: { gear: { weapon: 560037 } } }, { label: 'base', patch: {} }] });
    const vil = data.results.find((row: any) => row.label === 'vil');
    const base = data.results.find((row: any) => row.label === 'base');
    expect(vil.emptySockets.join(' ')).toMatch(/Vil Invernal.*carta.*encantamento/);
    expect(base.emptySockets).toBeUndefined();
  }, 60_000);

  it('scan_slot skips items LATAM has not shipped and rejects a slot that is not equipment', async () => {
    const { data } = await call('scan_slot', { build: inquisitor, slot: 'boot', limit: 40, topSockets: 0 });
    expect(data.ranking.map((row: any) => row.id)).not.toContain(470328);
    const bad = await call('scan_slot', { build: inquisitor, slot: 'boots' });
    expect(bad.isError).toBe(true);
  });

  it('judges a build by the profile: sustained and burst use different metrics and both come back', async () => {
    const rotation = ['Third Flame Bomb==5', 'Third Punish==5', 'Third Flame Bomb==5'];
    const sustained = await call('optimize_build', { build: { ...inquisitor, rotation }, slots: ['boot'], candidates: { boot: [470069] }, maxSolves: 80 });
    const burst = await call('optimize_build', { build: { ...inquisitor, rotation }, slots: ['boot'], candidates: { boot: [470069] }, maxSolves: 80, profile: 'burst' });
    expect(sustained.data.objective).toBe('rotationDps');
    expect(burst.data.objective).toBe('burstDps');
    expect(sustained.data.profiles.sustained.metric).toBe('rotationDps');
    expect(sustained.data.profiles.burst.metric).toBe('burstDps');
    expect(burst.data.profiles.burst.baseline).toBeGreaterThan(0);
    const bare = await call('optimize_build', { build: inquisitor, slots: ['boot'], candidates: { boot: [470069] }, maxSolves: 60, profile: 'burst' });
    expect(bare.data.objective).toBe('avgHit');
  });

  it('optimize_slot reports the size penalty and penetration the ranking is made under', async () => {
    const { data } = await call('optimize_slot', { build: windhawk, slot: 'weapon', candidates: [700016, 18186], target: { monsterId: 21077 } });
    expect(data.context.target.size).toBeTruthy();
    expect(typeof data.context.sizePenaltyPct).toBe('number');
    expect(typeof data.context.penetrationPct).toBe('number');
  });

  it('optimize_slot reports items LATAM has not shipped instead of ranking them', async () => {
    const { data } = await call('optimize_slot', { build: windhawk, slot: 'boot', candidates: [470328, 470069], target: { monsterId: 21077 } });
    expect(data.skippedNotInLatam).toEqual([470328]);
    expect(data.ranking.map((row: any) => row.id)).not.toContain(470328);
  });

  it('parse_share_link does not report consumables as equipped gear', async () => {
    const { data: made } = await call('share_link', { build: { ...windhawk, aspdPotion: 645 } });
    const { data } = await call('parse_share_link', { share: made.url });
    expect(data.gear.weapon.id).toBe(700016);
    expect(data.gear.aspdPotion).toBeUndefined();
  });

  it('search_monsters does not invent a type for monsters with no stat block', async () => {
    const { data } = await call('search_monsters', { query: 'poring', hasStats: false, limit: 25 });
    const statless = data.monsters.find((m: any) => m.hasStats === false);
    expect(statless).toBeTruthy();
    expect(statless.type).toBeUndefined();
  });
});

describe('bridge', () => {
  it('parse_share_link resolves ids to names and summarises the build', async () => {
    const { data: calc } = await call('calculate', {
      build: { class: 4257, level: 200, jobLevel: 50, gear: { weapon: 700016, weaponRefine: 11 }, atkSkill: 'Focused Arrow Strike==5' },
    });
    const { data } = await call('parse_share_link', { share: calc.share });

    expect(data.build.className).toBe('Falcão do Vento');
    expect(data.gear.weapon).toMatchObject({ id: 700016, name: 'Arco de Apoio Certeiro', refine: 11 });
    expect(data.summary).toMatch(/Falcão do Vento nível 200\/50/);
    expect(data.buildInput.preset).toBeTruthy();
  });

  it('share_link can arm a comparison without solving', async () => {
    const { data } = await call('share_link', {
      build: { class: 4257, level: 200, jobLevel: 50, gear: { weapon: 700016 } },
      compare: { slots: ['weapon'], gear: { weapon: 18186 } },
    });
    const parsed = await call('parse_share_link', { share: data.url });
    expect(parsed.data.compare.items.weapon.id).toBe(18186);
  });

  it('rejects a malformed link with a readable message', async () => {
    const { data, isError } = await call('parse_share_link', { share: 'https://laro-calc.siatiquosque.com.br/#/?b=garbage' });
    expect(isError).toBe(true);
    expect(data.error).toMatch(/inválido|corrompido/);
  });
});
