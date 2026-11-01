/** Reference ranges, not measured probabilities or confirmation of LATAM availability.
 * Source: https://browiki.org/wiki/Bônus_Aleatórios#Elmo_-_Meio
 * Both middle rolls must come from the SAME Loki coin. Lower seals use distinct positions.
 */
import regionalPools from '../../../data/random-options/regional-pools.json';
import browiki from '../../../data/random-options/browiki-pools.json';

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
 * Pools confirmed in game, kept as data (`data/random-options/regional-pools.json`) so adding one is an edit
 * to a JSON file, not to code. Built once; the code-defined pools above win on a collision.
 */
const regional = new Map<number, RandomOptionPool>(Object.entries(regionalPools.pools as Record<string, RandomOptionPool>)
  .map(([id, pool]) => [Number(id), pool]));

/**
 * Pools read from the bROWiki page by `tools/import-browiki-pools.py`: reference ranges for the Brazilian server,
 * not measured by us. They sit below everything above, so a pool confirmed in game always overrides the wiki.
 */
const wiki = new Map<number, RandomOptionPool>(Object.entries(browiki.items as Record<string, number[]>).map(([id, rolling]) => [Number(id), {
  source: browiki.source,
  confidence: 'bROWiki; faixas de referência, não medidas no LATAM',
  profiles: rolling.map(index => ({
    combiner: browiki.combiners[index].name,
    positions: (browiki.combiners[index].positions as [string, number, number][][]).map(position => position.map(([key, min, max]) => r(key, min, max))),
  })),
}]));

export const randomOptionCatalogFor = (itemId: number): RandomOptionPool | undefined =>
  itemId === 410233 ? loki : aces[itemId] ?? regional.get(itemId) ?? wiki.get(itemId);
/** Every item with a regional pool (code, confirmed JSON or wiki), for audits. */
export const cataloguedRandomItemIds = (): number[] => [...new Set([410233, ...Object.keys(aces).map(Number), ...regional.keys(), ...wiki.keys()])];

/** Unknown pools are explicitly not validated. Do not invent a global stat range. */
export function validateCataloguedRolls(itemId: number, rolls: (string | null | undefined)[]): string | null {
  const catalog = randomOptionCatalogFor(itemId);
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
