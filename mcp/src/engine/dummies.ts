/**
 * Training dummies with real-boss defenses. The stock "Dummy - Neutro" (id 21077) has no DEF, MDEF, TEN or TENM, so against it
 * penetration, TEN reduction and size penalty look worthless and every hit looks bigger than it is. These four copy it with
 * the defenses of the level 200+ bosses in the data (median and 90th percentile), as normal and boss, Medium and Large. They are
 * target ids like any monster: `target: { monsterId: 9000002 }`.
 */
export const DUMMY_BASE_ID = 21077;

interface DummySpec { id: number; name: string; boss: boolean; large: boolean; defense: number; magicDefense: number; res: number; mres: number }

export const DEFENDED_DUMMIES: readonly DummySpec[] = [
  { id: 9000001, name: 'Dummy - Normal Médio (defesa média)', boss: false, large: false, defense: 512, magicDefense: 179, res: 300, mres: 300 },
  { id: 9000002, name: 'Dummy - Chefe Médio (defesa média)', boss: true, large: false, defense: 512, magicDefense: 179, res: 300, mres: 300 },
  { id: 9000003, name: 'Dummy - Normal Grande (defesa alta)', boss: false, large: true, defense: 791, magicDefense: 388, res: 500, mres: 500 },
  { id: 9000004, name: 'Dummy - Chefe Grande (defesa alta)', boss: true, large: true, defense: 791, magicDefense: 388, res: 500, mres: 500 },
];

/** The two dummies a check against a defended target uses: a medium and a large boss. */
export const CHECK_DUMMIES = [9000002, 9000004] as const;

/** Monster records for `Dataset.monsters`, cloned from the stock dummy so every field the engine reads is there. */
export function defendedDummyRecords(monsters: Record<string, any>): Record<string, any> {
  const base = monsters[DUMMY_BASE_ID];
  if (!base) return {};

  return Object.fromEntries(DEFENDED_DUMMIES.map((spec) => [spec.id, {
    ...base,
    id: spec.id,
    dbname: `S_DUMMY_DEFENDED_${spec.id}`,
    name: spec.name,
    stats: {
      ...base.stats,
      defense: spec.defense,
      magicDefense: spec.magicDefense,
      res: spec.res,
      mres: spec.mres,
      vit: 130,
      class: spec.boss ? 1 : 0,
      scale: spec.large ? 2 : 1,
      scaleName: spec.large ? 'Large' : 'Medium',
    },
  }]));
}

/** A target that shows no defense at all: penetration and TEN reduction cannot show on it. */
export const isUndefended = (target: { def?: number; mdef?: number; res?: number; mres?: number } | undefined): boolean =>
  !!target && !(target.def || target.mdef || target.res || target.mres);
