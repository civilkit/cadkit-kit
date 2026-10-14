import { describe, expect, it } from 'vitest';
import type { EditOp } from '@ck/session';
import { HandleRunner, type RunnerDeps } from './runner';
import type { HandleSession } from './session';

const op = (n: number): EditOp[] => [{ op: 'set', id: 'F2', path: 'depth', value: n } as EditOp];

function fake() {
  const log: string[] = [];
  const gates: Array<() => void> = [];
  let running = 0, maxRunning = 0;
  const deps: RunnerDeps = {
    preview: async (ops) => {
      running++; maxRunning = Math.max(maxRunning, running);
      log.push('preview ' + (ops[0] as { value: number }).value);
      await new Promise<void>((r) => gates.push(r));
      running--;
      return { ok: true };
    },
    cancelPreview: async () => { log.push('cancel'); },
    commit: async (c) => { log.push(`commit ${(c.ops[0] as { value: number }).value} create=${c.create}`); },
  };
  const release = async () => { await Promise.resolve(); gates.shift()?.(); await new Promise((r) => setTimeout(r, 0)); };
  return { deps, log, release, max: () => maxRunning };
}
const session = (): HandleSession => ({
  kind: 'extrude-depth', specs: [], preview: (_i, q) => (q === 0 ? null : op(q)), commit: (_i, q) => (q === 0 ? null : { ops: op(q), create: false }),
});

describe('HandleRunner', () => {
  it('previews one at a time and only the latest waiting drag step runs', async () => {
    const f = fake();
    const r = new HandleRunner(f.deps);
    for (const q of [1, 2, 3, 4, 5]) r.drag(op(q));
    await new Promise((x) => setTimeout(x, 0));
    expect(f.log).toEqual(['preview 1']);          // 2, 3, 4 are superseded while 1 runs
    await f.release();
    expect(f.log).toEqual(['preview 1', 'preview 5']);
    await f.release();
    expect(f.max()).toBe(1);
  });

  it('release commits ONE edit after the running preview, and drops queued steps', async () => {
    const f = fake();
    const r = new HandleRunner(f.deps);
    const sink = r.sink(session());
    sink.onStart!('depth');
    sink.onDrag('depth', 10, [0, 0, 10]);
    await new Promise((x) => setTimeout(x, 0));
    sink.onDrag('depth', 11, [0, 0, 11]);
    sink.onDrag('depth', 12, [0, 0, 12]);
    const done = r.commit(session().commit('depth', 12, [0, 0, 12]));
    await f.release();
    await done;
    expect(f.log).toEqual(['preview 10', 'commit 12 create=false']);
  });

  it('cancel puts the last good body back and makes no edit', async () => {
    const f = fake();
    const r = new HandleRunner(f.deps);
    r.drag(op(7));
    await new Promise((x) => setTimeout(x, 0));
    const done = r.cancel();
    await f.release();
    await done;
    expect(f.log).toEqual(['preview 7', 'cancel']);
  });

  it('a drag back to nothing restores the body; cancelling with nothing shown does not touch it', async () => {
    const f = fake();
    const r = new HandleRunner(f.deps);
    r.drag(op(3));
    await new Promise((x) => setTimeout(x, 0));
    await f.release();
    r.drag(null);
    await new Promise((x) => setTimeout(x, 0));
    expect(f.log).toEqual(['preview 3', 'cancel']);
    const g = fake();
    const r2 = new HandleRunner(g.deps);
    await r2.cancel();
    expect(g.log).toEqual([]);
  });

  it('a commit with no edit (zero size) puts the preview away', async () => {
    const f = fake();
    const r = new HandleRunner(f.deps);
    r.drag(op(3));
    await new Promise((x) => setTimeout(x, 0));
    const done = r.commit(null);
    await f.release();
    await done;
    expect(f.log).toEqual(['preview 3', 'cancel']);
  });

  it('reports why a preview failed and clears it when one works', async () => {
    const hints: Array<string | null> = [];
    const results = [{ ok: false, hint: 'too big' }, { ok: true }];
    const r = new HandleRunner({ preview: async () => results.shift(), cancelPreview: async () => {}, commit: async () => {}, hint: (h) => hints.push(h) });
    r.drag(op(1)); await new Promise((x) => setTimeout(x, 0));
    r.drag(op(2)); await new Promise((x) => setTimeout(x, 0));
    expect(hints).toEqual(['too big', null]);
  });
});
