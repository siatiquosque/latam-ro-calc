/**
 * A search is synchronous CPU work on a server that answers other requests too (and `/healthz`). It
 * therefore gets a wall-clock allowance as well as a solve budget, and hands the event loop back every
 * few tens of milliseconds so a long optimisation never freezes the rest of the site.
 */
export function pacing(maxMs: number, sliceMs = 40) {
  const deadline = Date.now() + maxMs;
  let lastYield = Date.now();

  return {
    /** True once the allowance is spent; the search stops and reports its best build so far. */
    timeUp: (): boolean => Date.now() > deadline,
    /** Lets pending requests run if the search has held the loop for a slice. Cheap when it has not. */
    async breathe(): Promise<void> {
      if (Date.now() - lastYield < sliceMs) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYield = Date.now();
    },
  };
}
