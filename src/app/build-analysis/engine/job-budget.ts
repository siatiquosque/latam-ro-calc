/** Conservative minimum used by both the core and callers before starting a job. */
export function minimumEngineCalls(targets: number, procMode: 'off' | 'active' | 'average', rotationCalls = 0): number {
  const states = procMode === 'average' ? 8 : procMode === 'active' ? 2 : 1;
  return 6 * targets * states + 4 * targets * (states + 1) * rotationCalls;
}

// Process telemetry only; the admission control is always the job's own synchronous counter.
let engineCalls = 0;
export const engineCallCount = () => engineCalls;
export function countedEngineCall<T>(budget: JobBudget | undefined, run: () => T): T {
  budget?.charge();
  engineCalls++;
  return run();
}

/** A synchronous charge immediately before each engine call; never shared globally. */
export class JobBudget {
  readonly phases: Record<string, number> = {};
  calls = 0;
  phase = 'baseline';
  verifying = false;
  exhausted = false;
  /** Evaluations are synchronous; check between individual target/proc solves. */
  shouldStop?: () => 'cancelled' | 'time' | undefined;

  constructor(readonly limit: number, readonly reserved: number) {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(reserved) || reserved < 0 || reserved > limit) {
      throw new Error('Orçamento total insuficiente para as verificações obrigatórias.');
    }
  }

  get remainingSearch(): number { return Math.max(0, this.limit - this.reserved - this.calls); }

  charge(): void {
    const stopped = !this.verifying && this.shouldStop?.();
    if (stopped) throw new JobInterrupted(stopped);
    const ceiling = this.verifying ? this.limit : this.limit - this.reserved;
    if (this.calls >= ceiling) { this.exhausted = true; throw new JobBudgetExceeded(); }
    this.calls++;
    this.phases[this.phase] = (this.phases[this.phase] ?? 0) + 1;
  }
}

export class JobInterrupted extends Error {
  constructor(readonly reason: 'cancelled' | 'time') { super(`Busca interrompida: ${reason}.`); }
}

export class JobBudgetExceeded extends Error {
  constructor() { super('Orçamento total de chamadas ao motor esgotado.'); }
}
