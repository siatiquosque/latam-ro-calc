export interface ChanceModel {
  label: string;
  label2: string;
  name: string;
  bonus: Record<string, number>;
  /** Numeric item id that granted this chance, when known — drives the HUD chip icon (iconUrl pipe). */
  itemId?: number;
  /** Auto-cast effects only: the chance per attack (%) and how long the effect lasts, for average-uptime estimates. */
  ratePct?: number;
  durationSeconds?: number;
}
