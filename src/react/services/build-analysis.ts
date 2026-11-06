import type { AnalysisRequest, AnalysisResponse } from '../../app/build-analysis/browser-protocol';
import type { DatasetSources } from '../../app/build-analysis/data/dataset';
import { DataClient } from './data-client';

declare const BUILD_ANALYSIS_WORKER_URL: string;

/** Browser adapter. Cancelling terminates the worker, including any synchronous solve. */
export class BuildAnalysis {
  private worker?: Worker;
  private reject?: (reason: Error) => void;
  private fallback?: () => void;
  private fallbackTimer?: ReturnType<typeof setTimeout>;
  private lastCheckpoint?: Record<string, any>;
  private generation = 0;
  constructor(private readonly data: DataClient) {}

  cancel(): void {
    this.generation++;
    if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
    this.fallbackTimer = undefined;
    this.fallback = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.reject?.(new DOMException('Search cancelled', 'AbortError'));
    this.reject = undefined;
  }

  /** Cooperative stop; force termination only after the externally retained checkpoint is available. */
  requestCancel(): void {
    if (!this.worker) { this.cancel(); return; }
    try { this.worker.postMessage({ type: 'cancel' }); }
    catch { this.fallback?.(); return; }
    if (!this.fallbackTimer) this.fallbackTimer = setTimeout(() => this.fallback?.(), 2_000);
  }

  getLastCheckpoint(): Record<string, any> | undefined { return this.lastCheckpoint; }

  async run(request: Omit<AnalysisRequest, 'sources' | 'descriptions' | 'origin'>, targetOverride?: { id: number; monster: any }, onCheckpoint?: (checkpoint: Record<string, any>) => void): Promise<Record<string, any>> {
    this.cancel();
    this.lastCheckpoint = undefined;
    const generation = this.generation;
    const [items, latamExtra, monsters, latamMonsters, hpSpTable, classes, descriptions] = await Promise.all([
      this.data.load<DatasetSources['items']>('itemsCore'), this.data.load<DatasetSources['latamExtra']>('latamExtra'),
      this.data.load<DatasetSources['monsters']>('monsters'), this.data.load<DatasetSources['latamMonsters']>('latamMonsters'),
      this.data.load('hpsp'), this.data.load<number[]>('classes'), this.data.load<Record<string, string>>('itemsDescMcp'),
    ]);
    if (generation !== this.generation) throw new DOMException('Search cancelled', 'AbortError');
    const sources: DatasetSources = { items, latamExtra, monsters: targetOverride ? { ...monsters, [targetOverride.id]: targetOverride.monster } : monsters, latamMonsters, hpSpTable, classes };
    const worker = new Worker(new URL(BUILD_ANALYSIS_WORKER_URL, document.baseURI), { type: 'module' });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const finish = () => {
        if (this.fallbackTimer) clearTimeout(this.fallbackTimer);
        this.fallbackTimer = undefined;
        this.fallback = undefined;
        worker.terminate();
        if (this.worker === worker) { this.worker = undefined; this.reject = undefined; }
      };
      this.fallback = () => {
        const checkpoint = this.lastCheckpoint;
        finish();
        if (!checkpoint) { reject(new Error('Cancelamento: nenhuma build verificada ficou disponível.')); return; }
        resolve({ ...checkpoint, checkpointFallback: true, stopped: 'cancelled',
          budgetUsage: { ...checkpoint['budgetUsage'], stoppedBy: 'cancelled', stoppedReasons: ['cancelled'], accountingIncomplete: true } });
      };
      worker.onmessage = ({ data }: MessageEvent<AnalysisResponse>) => {
        if (data.checkpoint) { this.lastCheckpoint = data.checkpoint; onCheckpoint?.(data.checkpoint); return; }
        finish();
        if (data.error) reject(new Error(data.error)); else resolve(data.result);
      };
      worker.onerror = (event) => { finish(); reject(new Error(event.message)); };
      worker.onmessageerror = () => { finish(); reject(new Error('Invalid search response')); };
      try { worker.postMessage({ ...request, sources, descriptions, origin: location.origin }); }
      catch (error) { finish(); reject(error); }
    });
  }
}
