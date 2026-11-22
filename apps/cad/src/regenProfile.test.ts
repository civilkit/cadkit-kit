import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profiler, profileLine, progress, progressText, startProgress } from './regenProfile';

const t = (k: string, p?: Record<string, string | number>) => `${k}${p ? JSON.stringify(p) : ''}`;

describe('Profiler', () => {
  it('adds up a phase that runs twice and times async work', async () => {
    const p = new Profiler('edit', 12);
    p.add('report', 100); p.add('report', 50);
    await p.time('kernel', async () => { await new Promise((r) => setTimeout(r, 15)); });
    const r = p.finish();
    expect(r.features).toBe(12);
    expect(r.phases.find((x) => x.phase === 'report')?.ms).toBe(150);
    expect(r.phases.find((x) => x.phase === 'kernel')!.ms).toBeGreaterThanOrEqual(10);
    expect(r.totalMs).toBeGreaterThanOrEqual(10);
  });
  it('records a phase that throws', async () => {
    const p = new Profiler('load', 1);
    await expect(p.time('kernel', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(p.finish().phases.map((x) => x.phase)).toEqual(['kernel']);
  });
});

describe('profileLine', () => {
  it('lists the slowest phase first and drops the negligible ones', () => {
    const line = profileLine(t, { kind: 'load', features: 480, totalMs: 14200, at: 0, phases: [{ phase: 'view', ms: 2400 }, { phase: 'kernel', ms: 11000 }, { phase: 'fonts', ms: 10 }] });
    expect(line).toContain('app.profile.load');
    expect(line).toContain('"count":480');
    expect(line).toContain('"total":"14.2"');
    expect(line.indexOf('kernel')).toBeLessThan(line.indexOf('view'));
    expect(line).not.toContain('fonts 0.0');
  });
});

describe('progress line', () => {
  afterEach(() => { vi.useRealTimers(); progress.value = null; });
  it('appears only after the delay, counts, and goes away at the end', () => {
    vi.useFakeTimers();
    let now = 0;
    const h = startProgress(480, 'kernel', 800, () => now);
    expect(progress.value).toBeNull();
    now = 900; vi.advanceTimersByTime(900);
    expect(progress.value).toMatchObject({ phase: 'kernel', total: 480, done: 0 });
    h.count(120);
    expect(progress.value?.done).toBe(120);
    now = 14200; vi.advanceTimersByTime(600);
    expect(progressText(t, progress.value!)).toContain('"seconds":"14.2"');
    h.end();
    expect(progress.value).toBeNull();
  });
  it('a quick job never shows the line', () => {
    vi.useFakeTimers();
    const h = startProgress(5, 'kernel', 800, () => 0);
    h.phase('view'); h.end();
    vi.advanceTimersByTime(2000);
    expect(progress.value).toBeNull();
  });
  it('without a count it shows only the total', () => {
    expect(progressText(t, { phase: 'kernel', done: 0, total: 9, startedAt: 0, elapsedMs: 1000 })).toContain('app.progress.total');
  });
});
