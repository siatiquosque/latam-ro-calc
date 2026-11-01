import { describe, expect, it, vi } from 'vitest';
import { pacing } from './pacing';

describe('pacing', () => {
  it('reports the allowance as spent only after it has passed', () => {
    vi.useFakeTimers();
    const pace = pacing(1000);
    expect(pace.timeUp()).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(pace.timeUp()).toBe(true);
    vi.useRealTimers();
  });
  it('hands the event loop back only once a slice has been held', async () => {
    vi.useFakeTimers();
    const pace = pacing(60_000, 40);
    let ran = false;
    setTimeout(() => { ran = true; }, 0);
    await pace.breathe();
    expect(ran).toBe(false);
    vi.advanceTimersByTime(41);
    const yielded = pace.breathe();
    await vi.advanceTimersByTimeAsync(1);
    await yielded;
    expect(ran).toBe(true);
    vi.useRealTimers();
  });
});
