import { describe, expect, it } from 'vitest';
import { createRunControl, formatElapsed, throttleProgress, runScript, type Progress, type ScriptHost } from './index';

const P = (done: number, total = 600, phase: Progress['phase'] = 'building'): Progress => ({ phase, done, total, elapsedMs: 0 });

describe('throttleProgress', () => {
  it('passes the first report, then at most one per interval or per N steps, and always the last', () => {
    let t = 0;
    const got: number[] = [];
    const f = throttleProgress((p) => got.push(p.done), { ms: 250, steps: 25, now: () => t });
    f(P(0));                 // first
    t = 10; f(P(5));         // too soon, too few
    t = 20; f(P(10));
    t = 300; f(P(12));       // interval passed
    t = 310; f(P(40));       // 28 steps since the last report
    t = 320; f(P(41));
    t = 330; f(P(600));      // last
    expect(got).toEqual([0, 12, 40, 600]);
  });
  it('lets a change of phase through', () => {
    const got: string[] = [];
    const f = throttleProgress((p) => got.push(p.phase), { ms: 1e9, steps: 1e9, now: () => 0 });
    f(P(1)); f(P(2)); f(P(2, 600, 'loading'));
    expect(got).toEqual(['building', 'loading']);
  });
  it('a 600-step run reports far fewer than 600 times', () => {
    let t = 0, n = 0;
    const f = throttleProgress(() => n++, { now: () => t });
    for (let i = 0; i <= 600; i++) { t += 5; f(P(i)); }
    expect(n).toBeLessThan(40);
  });
});

describe('cancel', () => {
  it('createRunControl flips the signal', () => {
    const c = createRunControl();
    expect(c.signal.aborted).toBe(false);
    c.cancel();
    expect(c.signal.aborted).toBe(true);
  });
  // a host with no kernel: build() accepts everything, load / edit record what they get
  const mock = (log: string[], onBuild?: () => void): ScriptHost => ({
    load: async () => { log.push('load'); },
    edit: async (ops) => { log.push(`edit:${ops.length}`); return { ok: true }; },
    geometry: () => ({ mesh: null, edges: [], box: null }),
    build: async () => { log.push('build'); onBuild?.(); return { errors: [] }; },
    release: async () => { log.push('release'); },
  });
  const CODE = `const p = part('x'); for (let i = 0; i < 60; i++) { p.sketch('front', (s) => s.rect(10, 10)).extrude(i + 1); }`;
  it('a cancelled batched run loads and edits nothing, and still releases the scratch state', async () => {
    const log: string[] = [], c = createRunControl();
    const r = await runScript(CODE, mock(log, () => c.cancel()), {}, { signal: c.signal, flushEvery: 10, yieldToUi: async () => {} });
    expect(r.cancelled).toBe(true);
    expect(log).toEqual(['build', 'release']);
  });
  it('an uncancelled run builds in chunks, loads once and edits once with every op', async () => {
    const log: string[] = [], seen: Progress[] = [];
    const r = await runScript(CODE, mock(log), {}, { flushEvery: 25, yieldToUi: async () => {}, onProgress: (p) => seen.push(p) });
    expect(r.errors).toEqual([]);
    expect(log.filter((x) => x === 'load')).toHaveLength(1);
    expect(log.filter((x) => x.startsWith('edit'))).toEqual(['edit:120']);
    expect(log.filter((x) => x === 'build').length).toBeGreaterThanOrEqual(1);
    expect(seen.at(-1)).toMatchObject({ phase: 'loading', done: 120 });
  });
  it('formatElapsed', () => { expect(formatElapsed(71_400)).toBe('1:11'); expect(formatElapsed(4000)).toBe('0:04'); });
});
