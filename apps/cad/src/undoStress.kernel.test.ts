// Random edit / undo / redo sequences against the real kernel, checked against a shadow model of the history.
// Reproduce a failure with UNDO_SEED=<n>; UNDO_SEEDS and UNDO_STEPS size the run.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const rect = (id: string, x0: number, y0: number, x1: number, y1: number, plane = 'front') => ({
  type: 'sketch', id, plane: { kind: 'std', id: plane },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: x0, y: y0 }, { id: 'p2', x: x1, y: y0 }, { id: 'p3', x: x1, y: y1 }, { id: 'p4', x: x0, y: y1 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [],
});
const pointSketch = (id: string, x: number, y: number) => ({ type: 'sketch', id, plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x, y }], entities: [{ id: 'e1', type: 'point', p: 'p1' }], constraints: [] });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  const base = { ...emptyPart('Stress'), features: [rect('S0', 0, 0, 60, 40), { type: 'extrude', id: 'E0', op: 'add', sketch: 'S0', end: 'blind', depth: 20 }], seq: 3 } as unknown as PartDoc;
  await controller.load(base);
  const check = new Controller({ store: createStore(), view, kernel });
  await check.load(base);
  return { controller, check, store };
}

type Snap = { doc: string; material: string | null };
const snapOf = (c: Controller): Snap => { const d = c.document()!; return { doc: JSON.stringify({ f: d.features, v: (d as never as { variables?: unknown }).variables ?? null }), material: (d as { material?: string }).material ?? null }; };

const SEEDS = Number(process.env.UNDO_SEEDS ?? 6), STEPS = Number(process.env.UNDO_STEPS ?? 18);
const ONLY = process.env.UNDO_SEED ? Number(process.env.UNDO_SEED) : null;

describe('undo / redo stress against the real kernel', { skip: !process.env.CK_WASM, timeout: 600_000 }, () => {
  const seeds = ONLY !== null ? [ONLY] : Array.from({ length: SEEDS }, (_, i) => 101 + i);
  for (const seed of seeds) {
    it(`seed ${seed}`, async () => {
      const w = await world();
      const r = rng(seed);
      const c = w.controller;
      let n = 1;
      const log: string[] = [];
      /** shadow: states[i] is the document after i undoable steps; cursor the current index; redo steps are states past the cursor */
      let states: Snap[] = [snapOf(c)];
      let cursor = 0;
      const featCount = () => c.document()!.features.length;
      const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)];
      const verify = async (what: string) => {
        const now = snapOf(c);
        const ctx = `seed ${seed} after ${what}\n${log.join('\n')}`;
        expect(now, ctx).toEqual(states[cursor]);
        expect(c.document()!.features.length, ctx).toBe(JSON.parse(states[cursor].doc).f.length);
        const sd = c.features().length;
        expect(sd, ctx).toBe(featCount());
        // history length of the session = undoable session steps (material steps are not in it)
        // regenerated body volume equals the same document built from scratch
        await w.check.load(c.document()!);
        const a = await c.partMass(c.document()!), b = await w.check.partMass(c.document()!);
        expect(a.volume, ctx).toBeCloseTo(b.volume ?? NaN, 3);
      };
      const record = async () => { states = states.slice(0, cursor + 1); states.push(snapOf(c)); cursor++; };
      for (let step = 0; step < STEPS; step++) {
        const feats = c.document()!.features as unknown as Array<{ id: string; type: string }>;
        const lastSolid = [...feats].reverse().find((f) => f.type === 'extrude' || f.type === 'hole' || f.type === 'lpattern' || f.type === 'mirror');
        const roll = r();
        const before = JSON.stringify(c.document()!.features);
        let what = '';
        const doEdit = async (label: string, ops: never[]) => {
          what = label; log.push(label);
          const res = await c.edit(ops);
          if (res.ok) await record();
          else expect(JSON.stringify(c.document()!.features), `failed edit changed the document: ${label}`).toBe(before);
        };
        if (roll < 0.14) { const k = n++; await doEdit(`add boxext S${k}`, [{ op: 'add', feature: rect(`S${k}`, Math.floor(r() * 20), Math.floor(r() * 20), 30 + Math.floor(r() * 30), 25 + Math.floor(r() * 20)) as never }, { op: 'add', feature: { type: 'extrude', id: `X${k}`, op: 'add', sketch: `S${k}`, end: 'blind', depth: 5 + Math.floor(r() * 25) } as never }] as never); }
        else if (roll < 0.26) { const k = n++; await doEdit(`cut S${k}`, [{ op: 'add', feature: rect(`S${k}`, 10 + Math.floor(r() * 10), 10 + Math.floor(r() * 10), 25 + Math.floor(r() * 10), 22 + Math.floor(r() * 8)) as never }, { op: 'add', feature: { type: 'extrude', id: `X${k}`, op: 'cut', sketch: `S${k}`, end: 'blind', depth: 3 + Math.floor(r() * 10), flip: true } as never }] as never); }
        else if (roll < 0.34) { const k = n++; await doEdit(`hole H${k}`, [{ op: 'add', feature: pointSketch(`S${k}`, 5 + Math.floor(r() * 50), 5 + Math.floor(r() * 30)) as never }, { op: 'add', feature: { type: 'hole', id: `H${k}`, sketch: `S${k}`, kind: 'simple', diameter: 2 + Math.floor(r() * 4), end: 'through', flip: true } as never }] as never); }
        else if (roll < 0.40 && lastSolid) { const k = n++; await doEdit(`lpattern of ${lastSolid.id}`, [{ op: 'add', feature: { type: 'lpattern', id: `P${k}`, seeds: [lastSolid.id], dir: { kind: 'axis', axis: 'x' }, spacing: 8, count: 2 } as never }] as never); }
        else if (roll < 0.45 && lastSolid) { const k = n++; await doEdit(`mirror ${lastSolid.id}`, [{ op: 'add', feature: { type: 'mirror', id: `M${k}`, seeds: [lastSolid.id], plane: { kind: 'std', id: 'right' }, body: false } as never }] as never); }
        else if (roll < 0.52) {
          const edges = c.bodyEdges().filter((e) => e.key).slice(0, 12); const e = edges.length ? pick(edges) : null;
          if (e) { const k = n++; await doEdit(`fillet ${e.key}`, [{ op: 'add', feature: { type: 'fillet', id: `L${k}`, radius: 0.5, edges: [e.key] } as never }] as never); }
        }
        else if (roll < 0.58) { const k = n++; await doEdit(`thread on invalid face (kernel error)`, [{ op: 'add', feature: { type: 'thread', id: `T${k}`, face: 'nope.S.h1', standard: 'metric', size: 'M5', class: '6H', length: 'full', hand: 'right', modeled: false } as never }] as never); }
        else if (roll < 0.63) { what = 'material'; const m = `Mat${step}`; log.push(what + ' ' + m); if (c.setMaterial(m)) await record(); }
        else if (roll < 0.68) { const f = pick(feats); await doEdit(`rename ${f.id}`, [{ op: 'set', id: f.id, path: 'name', value: `N${step}` } as never]); }
        else if (roll < 0.73 && feats.length > 3) { const f = [...feats].reverse().find((x) => !['S0', 'E0'].includes(x.id))!; await doEdit(`delete ${f.id}`, [{ op: 'remove', id: f.id } as never]); }
        else if (roll < 0.76) { what = 'rollback'; log.push(what); await c.setRollback(Math.max(1, Math.floor(r() * feats.length))); await c.setRollback(null); }
        else if (roll < 0.9) {
          what = 'undo'; log.push(what);
          if (cursor > 0) { await c.undo(); cursor--; await verify(what); } else { await c.undo(); await verify('undo at start'); }
        } else {
          what = 'redo'; log.push(what);
          if (cursor + 1 < states.length) { await c.redo(); cursor++; await verify(what); } else { await c.redo(); await verify('redo at end'); }
        }
        expect(featCount(), `seed ${seed} step ${step} ${what}\n${log.join('\n')}`).toBeGreaterThanOrEqual(2);
      }
      if (process.env.UNDO_VERBOSE) console.log(`seed ${seed}: ${states.length - 1} accepted steps, ${featCount()} features`);
      // everything back: undo all, redo all
      while (cursor > 0) { await c.undo(); cursor--; }
      await verify('undo all');
      while (cursor + 1 < states.length) { await c.redo(); cursor++; }
      await verify('redo all');
    });
  }
});

const addBox = (k: number) => [
  { op: 'add', feature: rect(`S${k}`, 0, 0, 20 + k, 20, 'top') as never },
  { op: 'add', feature: { type: 'extrude', id: `X${k}`, op: 'add', sketch: `S${k}`, end: 'blind', depth: 5 } as never },
] as never;

describe('undo racing other work', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  it('undo pressed while an edit is still building waits for it: nothing is lost or half applied', async () => {
    const w = await world();
    const c = w.controller;
    await c.edit(addBox(1));
    await c.edit(addBox(2));
    const n = c.features().length;
    const pending = c.edit(addBox(3));
    const u = c.undo();      // pressed before the edit finished
    await Promise.all([pending, u]);
    expect(c.features().length).toBe(n);   // the new box was added, then undone: the two before are there
    expect(c.history().length).toBe(2);
    await c.redo();
    expect(c.features().length).toBe(n + 2);
  });

  it('double undo pressed at once undoes two steps, in order', async () => {
    const w = await world();
    const c = w.controller;
    await c.edit(addBox(1)); await c.edit(addBox(2)); await c.edit(addBox(3));
    const n = c.features().length;
    await Promise.all([c.undo(), c.undo()]);
    expect(c.features().length).toBe(n - 4);
    await Promise.all([c.redo(), c.redo()]);
    expect(c.features().length).toBe(n);
  });

  it('cancel keeps the undo history and the redo steps', async () => {
    const w = await world();
    const c = w.controller;
    await c.edit(addBox(1)); await c.edit(addBox(2));
    await c.undo();
    const feats = c.features().length;
    await c.cancel();
    expect(c.features().length).toBe(feats);
    expect(c.history().length).toBe(1);
    await c.undo();
    expect(c.features().length).toBe(feats - 2);
    await c.redo();
    await c.redo();
    expect(c.features().length).toBe(feats + 2);
  });

  it('a material change made before a cancel is still one undo step', async () => {
    const w = await world();
    const c = w.controller;
    await c.edit(addBox(1));
    const was = (c.document() as { material?: string }).material;
    c.setMaterial('Brass');
    await c.cancel();
    await c.undo();
    expect((c.document() as { material?: string }).material).toBe(was);
    expect(c.features().length).toBe(4);
  });

  it('undo with a sketch open undoes the sketch step, not the part', async () => {
    const w = await world();
    const c = w.controller;
    await c.edit(addBox(1));
    const n = c.features().length;
    expect(await c.beginSketch('S1')).not.toBeNull();
    await c.undo();
    expect(c.features().length).toBe(n);
    expect(c.history().length).toBe(1);
  });

  it('refuses an undo whose step would drop far more features than it added, and says so', async () => {
    const w = await world();
    const c = w.controller;
    await c.edit(addBox(1)); await c.edit(addBox(2)); await c.edit(addBox(3));
    const n = c.features().length;
    // corrupt the step on top of the stack the way a stale reload would: its "before" is the empty part
    const st = (c as unknown as { session: { stack: Array<{ before: { features: unknown[] } }> } }).session.stack;
    st[st.length - 1].before = { ...st[st.length - 1].before, features: [] };
    await c.undo();
    expect(c.features().length).toBe(n);
    expect(c.history().length).toBe(3);
    expect(c.lastUndoProblem).toMatch(/undo refused/);
    expect(w.store.notices.value.some((x) => x.level === 'error' && /Undo failed/.test(x.text))).toBe(true);
  });
});
