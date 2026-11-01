export interface HpSpModel {
  jobs: Record<string, boolean>;
  // Before the class multiplier. Preserve fractions when normalizing observed
  // fourth-job HP/SP by 1.25; see docs/hp-sp.md.
  baseHp: Record<string, number>;
  baseSp: Record<string, number>;
}

export type HpSpTable = HpSpModel[];
