import type { AnalysisRequest, AnalysisResponse } from '../../app/build-analysis/browser-protocol';
import type { DatasetSources } from '../../app/build-analysis/data/dataset';
import { DataClient } from './data-client';

declare const BUILD_ANALYSIS_WORKER_URL: string;

/** Browser adapter. Cancelling terminates the worker, including any synchronous solve. */
export class BuildAnalysis {
  private worker?: Worker;
  private reject?: (reason: Error) => void;
  private generation = 0;
  constructor(private readonly data: DataClient) {}

  cancel(): void {
    this.generation++;
    this.worker?.terminate();
    this.worker = undefined;
    this.reject?.(new DOMException('Search cancelled', 'AbortError'));
    this.reject = undefined;
  }

  async run(request: Omit<AnalysisRequest, 'sources' | 'descriptions' | 'origin'>, targetOverride?: { id: number; monster: any }): Promise<Record<string, any>> {
    this.cancel();
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
      const finish = () => { worker.terminate(); if (this.worker === worker) { this.worker = undefined; this.reject = undefined; } };
      worker.onmessage = ({ data }: MessageEvent<AnalysisResponse>) => {
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
