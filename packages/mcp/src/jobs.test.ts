import { describe, expect, it } from 'vitest';
import { ResultStore } from '@kit/agent-tools';
import { BridgeError } from '@kit/agent-link';
import { JobRunner, type JobOutcome } from './jobs';

const ok = (over: Partial<JobOutcome> = {}): JobOutcome => ({ revision: 4, changedCount: 3, errorCount: 0, warningCount: 1, report: { rows: [1, 2, 3] }, ...over });
const tick = () => new Promise((r) => setTimeout(r, 5));
const mk = () => { let t = 1000; const store = new ResultStore(); return { store, runner: new JobRunner({ store, now: () => t }), advance: (n: number) => { t += n; } }; };
const gate = () => { let go!: (v?: unknown) => void; let fail!: (e: Error) => void; const p = new Promise((res, rej) => { go = res; fail = rej; }); return { p, go, fail }; };

describe('JobRunner', () => {
  it('returns at once with a running job, then a done job with the one answer shape and the report behind a handle', async () => {
    const { runner, store, advance } = mk();
    const g = gate();
    const j = runner.start('x', async () => { await g.p; return ok({ previewPng: 'aGk=' }); });
    expect(j).toMatchObject({ state: 'running', kind: 'x', elapsedMs: 0 });
    advance(250);
    expect(runner.status(j.jobId)).toMatchObject({ state: 'running', elapsedMs: 250 });
    g.go(); await tick();
    const s = runner.status(j.jobId)!;
    expect(s.state).toBe('done');
    expect(s.result).toMatchObject({ ok: true, revision: 4, changedCount: 3, errorCount: 0, warningCount: 1 });
    expect(s.result!.reportUri).toMatch(/^ck:\/\/result\//);
    expect(store.get(s.result!.reportUri.replace('ck://result/', ''))!.value).toEqual({ rows: [1, 2, 3] });
    expect(store.get(s.result!.previewUri!.replace('ck://result/', ''))!.value).toMatchObject({ mimeType: 'image/png', data: 'aGk=' });
    expect(s.elapsedMs).toBe(250);                          // the clock stops at the end
    advance(9999); expect(runner.status(j.jobId)!.elapsedMs).toBe(250);
  });
  it('a failed validation is never success: errorCount above zero is ok false even though the work ran to the end', async () => {
    const { runner } = mk();
    const j = runner.start('x', async () => ok({ errorCount: 2 }));
    await tick();
    expect(runner.status(j.jobId)).toMatchObject({ state: 'done', result: { ok: false, errorCount: 2 } });
  });
  it('a throw is a failed job with the code, message and hint, and no result', async () => {
    const { runner } = mk();
    const j = runner.start('x', async () => { throw new BridgeError('stale_revision', 'the document changed', 'read again'); });
    await tick();
    const s = runner.status(j.jobId)!;
    expect(s).toMatchObject({ state: 'failed', error: { code: 'stale_revision', message: 'the document changed', hint: 'read again' } });
    expect(s.result).toBeUndefined();
    const j2 = runner.start('x', async () => { throw new Error('boom'); });
    await tick();
    expect(runner.status(j2.jobId)!.error).toMatchObject({ code: 'job_failed', message: 'boom' });
  });
  it('cancel marks the job cancelled at once; work that finishes later is reported as lateResult and never becomes the result', async () => {
    const { runner } = mk();
    const g = gate();
    const j = runner.start('x', async () => { await g.p; return ok(); });
    const c = runner.cancel(j.jobId)!;
    expect(c).toMatchObject({ state: 'cancelled' }); expect(c.note).toMatch(/may still finish/);
    g.go(); await tick();
    const s = runner.status(j.jobId)!;
    expect(s.state).toBe('cancelled'); expect(s.result).toBeUndefined();
    expect(s.lateResult).toMatchObject({ ok: true }); expect(s.lateResult!.note).toMatch(/discarded/);
    const g2 = gate();
    const j2 = runner.start('x', async () => { await g2.p; return ok(); });
    runner.cancel(j2.jobId); g2.fail(new Error('app gone')); await tick();
    expect(runner.status(j2.jobId)!.lateResult).toMatchObject({ ok: false, note: expect.stringContaining('app gone') });
    expect(runner.cancel(j.jobId)!.state).toBe('cancelled');          // again: no change
    expect(runner.cancel('nope')).toBeNull();
  });
  it('cancelling a finished job does not change it, and the signal reaches the work', async () => {
    const { runner } = mk();
    let aborted = false;
    const g = gate();
    const j = runner.start('x', async (c) => { c.signal.addEventListener('abort', () => { aborted = true; }); await g.p; return ok(); });
    runner.cancel(j.jobId); expect(aborted).toBe(true); g.go(); await tick();
    const d = runner.start('x', async () => ok()); await tick();
    expect(runner.cancel(d.jobId)).toMatchObject({ state: 'done' });
  });
  it('reports progress while running and drops it once done; at most four run at a time', async () => {
    const { runner } = mk();
    const g = gate();
    const j = runner.start('x', async (c) => { c.progress(2, 5, 'clearance'); await g.p; return ok(); });
    await tick();
    expect(runner.status(j.jobId)!.progress).toEqual({ done: 2, total: 5, step: 'clearance' });
    g.go(); await tick();
    expect(runner.status(j.jobId)!.progress).toBeUndefined();
    const hold = gate();
    for (let n = 0; n < 4; n++) runner.start('x', async () => { await hold.p; return ok(); });
    expect(() => runner.start('x', async () => ok())).toThrowError(/already running/);
    hold.go(); await tick();
    expect(() => runner.start('x', async () => ok())).not.toThrow();
  });
  it('keeps the last 50 finished jobs and forgets the oldest', async () => {
    const { runner } = mk();
    const first = runner.start('x', async () => ok()); await tick();
    for (let n = 0; n < 55; n++) { runner.start('x', async () => ok()); await tick(); }
    expect(runner.status(first.jobId)).toBeNull();
    expect(runner.list().length).toBeLessThanOrEqual(51);
  });
});
