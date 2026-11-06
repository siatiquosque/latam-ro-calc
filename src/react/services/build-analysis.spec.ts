import { afterEach, expect, it, vi } from 'vitest';
import { BuildAnalysis } from './build-analysis';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps the verified checkpoint outside an unresponsive worker and returns it on forced stop', async () => {
  vi.useFakeTimers();
  let worker: any;
  class FakeWorker {
    onmessage?: (event: any) => void;
    onerror?: (event: any) => void;
    onmessageerror?: () => void;
    terminated = false;
    messages: any[] = [];
    constructor() { worker = this; }
    postMessage(value: unknown) { this.messages.push(value); }
    terminate() { this.terminated = true; }
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('BUILD_ANALYSIS_WORKER_URL', '/worker.js');
  vi.stubGlobal('document', { baseURI: 'http://localhost/' });
  vi.stubGlobal('location', { origin: 'http://localhost' });
  const runner = new BuildAnalysis({ load: async () => ({}) } as any);
  const pending = runner.run({ mode: 'build', maxSearchMs: 5000, maxSolves: 300, args: { build: { preset: {} } } } as any);
  await vi.waitFor(() => expect(worker).toBeDefined());
  const checkpoint = { patch: { gear: { weapon: 123 } }, final: { dps: 456 }, budgetUsage: { engineCalls: 12 }, suggestedModel: { weapon: 123 } };
  worker.onmessage({ data: { checkpoint } });
  expect(runner.getLastCheckpoint()).toEqual(checkpoint);
  runner.requestCancel();
  expect(worker.messages.at(-1)).toEqual({ type: 'cancel' });
  await vi.advanceTimersByTimeAsync(2000);
  const result = await pending;
  expect(worker.terminated).toBe(true);
  expect(result.patch).toEqual(checkpoint.patch);
  expect(result.budgetUsage).toMatchObject({ stoppedBy: 'cancelled', accountingIncomplete: true, engineCalls: 12 });
  expect(result.checkpointFallback).toBe(true);
});

it('never fabricates a result if an unresponsive worker has not sent a verified checkpoint', async () => {
  vi.useFakeTimers();
  let worker: any;
  class FakeWorker {
    onmessage?: (event: any) => void;
    terminated = false;
    constructor() { worker = this; }
    postMessage(_value: unknown) {}
    terminate() { this.terminated = true; }
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('BUILD_ANALYSIS_WORKER_URL', '/worker.js');
  vi.stubGlobal('document', { baseURI: 'http://localhost/' });
  vi.stubGlobal('location', { origin: 'http://localhost' });
  const runner = new BuildAnalysis({ load: async () => ({}) } as any);
  const pending = runner.run({ mode: 'build', maxSearchMs: 5000, maxSolves: 300, args: { build: { preset: {} } } } as any);
  const rejected = expect(pending).rejects.toThrow('nenhuma build verificada');
  await vi.waitFor(() => expect(worker).toBeDefined());
  runner.requestCancel();
  await vi.advanceTimersByTimeAsync(2000);
  await rejected;
  expect(worker.terminated).toBe(true);
});
