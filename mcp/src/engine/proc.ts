/**
 * What a proc is worth on average, not only while it is on. The calculator measures a proc as always active; a proc
 * that fires on 5% of the attacks and lasts 10 seconds is on most of the time at five attacks a second and about
 * half of it at one. The estimate is the chance that at least one trigger fell inside the last `duration` seconds:
 * 1 - (1 - p)^(hits per second × duration), and the average gain is taken as proportional to that uptime.
 */

/** Attacks per second that make the sensitivity visible: a boss with a slow skill, a mixed rotation, a packed map. */
export const PROC_HIT_RATES = [1, 3, 5] as const;

export interface ProcData { ratePct?: number; durationSeconds?: number }

export function procUptime(ratePct: number, durationSeconds: number, hitsPerSecond: number): number {
  const p = Math.min(1, Math.max(0, ratePct / 100));
  return 1 - Math.pow(1 - p, hitsPerSecond * durationSeconds);
}

/** `gainWhenActivePct` is the build's gain with the proc on; null when it could not be measured. */
export function procEstimate(chance: ProcData, gainWhenActivePct: number | null, hitsPerSecond?: number) {
  if (!chance.ratePct || !chance.durationSeconds) return undefined;
  const rates = hitsPerSecond ? [hitsPerSecond] : [...PROC_HIT_RATES];
  const at = (value: (rate: number) => number) => Object.fromEntries(rates.map((rate) => [`${rate}/s`, Math.round(value(rate) * 100) / 100]));
  return {
    chancePct: chance.ratePct,
    durationSeconds: chance.durationSeconds,
    uptimePct: at((rate) => procUptime(chance.ratePct!, chance.durationSeconds!, rate) * 100),
    ...(gainWhenActivePct === null ? {} : { expectedGainPct: at((rate) => gainWhenActivePct * procUptime(chance.ratePct!, chance.durationSeconds!, rate)) }),
  };
}

/**
 * A script proc (`chance__vit`, the Botas Desconhecidas) carries no rate in its script, only the bonus; the chance and
 * the duration are in the description ("5% de chance de ativar um [efeito] por 10 segundos"). Auto-cast effects the
 * calculator models carry them directly.
 */
export async function procData(
  dataset: { description(id: number): Promise<string | undefined> },
  chance: ProcData & { itemId?: number },
): Promise<ProcData> {
  if (chance.ratePct && chance.durationSeconds) return chance;
  const text = chance.itemId ? await dataset.description(chance.itemId) : undefined;
  const match = text && /(\d+(?:[.,]\d+)?)\s*%\s*de\s*chance[^.]*?por\s*(\d+)\s*segundos/i.exec(text);
  return match ? { ratePct: Number(match[1].replace(',', '.')), durationSeconds: Number(match[2]) } : {};
}
