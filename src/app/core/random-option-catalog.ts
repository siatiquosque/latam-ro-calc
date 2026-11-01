/** Reference ranges, not measured probabilities or confirmation of LATAM availability.
 * Source: https://browiki.org/wiki/Bônus_Aleatórios#Elmo_-_Meio
 * Both middle rolls must come from the SAME Loki coin. Lower seals use distinct positions.
 */
type Range = { key: string; min: number; max: number };
const r = (key: string, min: number, max: number): Range => ({ key, min, max });
const resources = [r('hp', 300, 1000), r('sp', 300, 1000), r('hpPercent', 1, 5), r('spPercent', 1, 5)];
const defense = [r('def', 10, 30), r('mdef', 5, 10)];
const casting = [r('vct', 1, 5), r('acd', 1, 5)];
const physical = [...resources, ...defense, ...casting, r('atk', 1, 20), r('atkPercent', 1, 5), r('cri', 1, 5), r('criDmg', 1, 5)];
const loki = {
  source: 'https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios#Elmo_-_Meio',
  confidence: 'reference-ranges; not independently measured on LATAM',
  profiles: [
    { combiner: 'Moeda Poderosa de Loki', positions: [[...physical, r('melee', 1, 5)], [...physical, r('melee', 1, 5)]] },
    { combiner: 'Moeda Certeira de Loki', positions: [[...physical, r('range', 1, 5)], [...physical, r('range', 1, 5)]] },
    { combiner: 'Moeda Mágica de Loki', positions: [0, 1].map(() => [...resources, ...defense, ...casting,
      r('matk', 1, 20), r('matkPercent', 1, 5), r('healPower', 1, 5), r('sMatk', 1, 5), r('m_my_element_all', 1, 5)]) },
    { combiner: 'Moeda Vital de Loki', positions: [0, 1].map(() => [...resources, ...casting,
      r('def', 20, 100), r('mdef', 5, 25), r('res', 1, 20), r('mres', 1, 10), r('sta', 1, 10)]) },
  ],
};

const attributes = ['str', 'agi', 'vit', 'int', 'dex', 'luk'].map(key => r(key, 1, 5));
const ace = (combiner: string, second: Range[]): typeof loki => ({
  source: 'https://browiki.org/wiki/B%C3%B4nus_Aleat%C3%B3rios#Elmo_-_Baixo',
  confidence: loki.confidence,
  profiles: [{ combiner, positions: [attributes, second] }],
});
const aces: Record<number, typeof loki> = {
  420210: ace('Aviso de Loki', [r('cri', 1, 5), r('criDmg', 1, 7), r('melee', 1, 7), r('vct', 1, 5), r('aspdPercent', 1, 5)]),
  420213: ace('Conselho de Loki', [r('healPower', 1, 5), r('m_my_element_all', 1, 7), r('vct', 1, 5), r('aspdPercent', 1, 5), r('sMatk', 1, 7)]),
  420220: ace('Fofoca de Loki', [r('cri', 1, 5), r('criDmg', 1, 7), r('range', 1, 7), r('vct', 1, 5), r('aspdPercent', 1, 5)]),
  420269: ace('Cochicho de Loki', [r('def', 50, 100), r('mdef', 5, 25), r('vct', 1, 5), r('aspdPercent', 1, 5), r('res', 1, 20), r('mres', 1, 10)]),
};
export type RandomOptionPool = typeof loki;

/**
 * The three data tiers below code. They are separate JSON files (`data/random-options/*-pools.json`, one document
 * format, see tools/pool_document.py) loaded on demand: they are about 100 KB and grow with every research round, so
 * they stay out of the startup bundle. `loadRandomPools()` fetches them once; until it resolves the lookups below find
 * no pool, so the picker stays open and nothing is validated. The app starts the load when the equipment card is
 * created and the MCP awaits it before every tool.
 */
type PoolDocument = {
  source: string; confidence?: string;
  combiners: { name: string; source?: string; confidence?: string; positions: [string, number, number][][] }[];
  items: Record<string, number[]>;
};

/** Pools written once as combiners and pointed at by items. A combiner may carry its own source/confidence. */
const fromDocument = (document: PoolDocument) => new Map<number, RandomOptionPool>(Object.entries(document.items).map(([id, rolling]) => {
  const first = document.combiners[rolling[0]];
  return [Number(id), {
    source: first.source ?? document.source,
    confidence: first.confidence ?? document.confidence ?? '',
    profiles: rolling.map(index => ({
      combiner: document.combiners[index].name,
      positions: document.combiners[index].positions.map(position => position.map(([key, min, max]) => r(key, min, max))),
    })),
  }];
}));

const empty = new Map<number, RandomOptionPool>();
/** In order of authority: confirmed in game or read from a regional page, the bROWiki page, and rAthena (kRO) as the last
 *  resort. An item no regional source covers is narrowed to rAthena's pool instead of being left open to every bonus; it is
 *  not confirmed for LATAM, which is why `randomPoolTier` tells it apart and roll validation does not enforce it. */
let regional = empty;
let wiki = empty;
let upstream = empty;
let loading: Promise<void> | undefined;

export const randomPoolsLoaded = (): boolean => regional !== empty;
export const loadRandomPools = (): Promise<void> => loading ??= Promise.all([
  import('../../../data/random-options/regional-pools.json'),
  import('../../../data/random-options/browiki-pools.json'),
  import('../../../data/random-options/rathena-pools.json'),
]).then(([a, b, c]) => {
  wiki = fromDocument(b.default as unknown as PoolDocument);
  upstream = fromDocument(c.default as unknown as PoolDocument);
  regional = fromDocument(a.default as unknown as PoolDocument);
}, (error) => { loading = undefined; throw error; });

export type RandomPoolTier = 'code' | 'regional' | 'wiki' | 'rathena';
export const randomPoolTier = (itemId: number): RandomPoolTier | undefined =>
  itemId === 410233 || aces[itemId] ? 'code' : regional.has(itemId) ? 'regional' : wiki.has(itemId) ? 'wiki' : upstream.has(itemId) ? 'rathena' : undefined;

export const randomOptionCatalogFor = (itemId: number): RandomOptionPool | undefined =>
  itemId === 410233 ? loki : aces[itemId] ?? regional.get(itemId) ?? wiki.get(itemId) ?? upstream.get(itemId);
/** Every item with a pool from any source, for audits. */
export const cataloguedRandomItemIds = (): number[] => [...new Set([410233, ...Object.keys(aces).map(Number), ...regional.keys(), ...wiki.keys(), ...upstream.keys()])];

/** Unknown pools are explicitly not validated. Do not invent a global stat range. */
export function validateCataloguedRolls(itemId: number, rolls: (string | null | undefined)[]): string | null {
  // A shared build is only held to pools somebody confirmed or read from a regional source, never to the rAthena fallback.
  const catalog = randomPoolTier(itemId) === 'rathena' ? undefined : randomOptionCatalogFor(itemId);
  if (!catalog) return null;
  const fits = catalog.profiles.some(profile => rolls.every((text, index) => {
    if (!text) return true;
    const match = /^([a-zA-Z0-9_]+):(\d+)$/.exec(text);
    if (!match) return false;
    return profile.positions[index]?.some(rule => rule.key === match[1] && Number(match[2]) >= rule.min && Number(match[2]) <= rule.max);
  }));
  return fits ? null : `Bônus aleatórios de ${itemId} incompatíveis com as posições, faixas e combinadores catalogados.`;
}

interface OptionNode { label: string; value?: string | number; children?: OptionNode[] }

/**
 * The picker tree narrowed to what `itemId` can roll in `position`. An item without a
 * catalogued pool returns `null`: nothing is known about it, so the picker stays open
 * to every bonus instead of hiding rolls the game may allow.
 */
export function restrictToPool(itemId: number, position: number, roots: readonly OptionNode[], leaves: ReadonlyMap<string, string>) {
  const catalog = randomOptionCatalogFor(itemId);
  if (!catalog || position < 0) return null;
  const rules = catalog.profiles.flatMap(profile => profile.positions[position] ?? []);
  if (!rules.length) return null;
  const allowed = (value: unknown) => {
    const match = /^([a-zA-Z0-9_]+):(\d+)$/.exec(String(value));
    return !!match && rules.some(rule => rule.key === match[1] && Number(match[2]) >= rule.min && Number(match[2]) <= rule.max);
  };
  const prune = (nodes: readonly OptionNode[]): OptionNode[] => nodes.flatMap(node => {
    if (!node.children) return allowed(node.value) ? [node] : [];
    const children = prune(node.children);
    return children.length ? [{ ...node, children }] : [];
  });
  return { roots: prune(roots), leaves: new Map([...leaves].filter(([value]) => allowed(value))) };
}
