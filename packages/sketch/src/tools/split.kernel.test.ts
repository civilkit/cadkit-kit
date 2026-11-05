import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { splitAt } from './split';
import { resolves } from './edit-fixtures';
import { closeSessions, solveDraft } from './kernel-fixtures';

afterEach(closeSessions);

const base = (points: SketchDraft['points'], entities: SketchDraft['entities'], constraints: SketchDraft['constraints']): SketchDraft =>
  ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points, entities, constraints });
const must = (r: ReturnType<typeof splitAt>) => { if (!r.ok) throw new Error(r.hint); return r; };

/** Solve both drafts, extrude both by the same depth: the same volume (to `tol`, relative), and the split one still converges. */
async function same(before: SketchDraft, after: SketchDraft, tol: number) {
  const b = await solveDraft(before, 5, { solve: true });
  const a = await solveDraft(after, 5, { solve: true });
  expect(b.r.errors).toEqual([]);
  expect(a.r.errors).toEqual([]);
  expect(a.status!.solved).toBe(true);
  expect(a.status!.conflicts).toEqual([]);
  expect(a.status!.redundant).toEqual([]);
  expect(Math.abs(a.facts.volume! - b.facts.volume!) / b.facts.volume!).toBeLessThanOrEqual(tol);
  return { a, b };
}

describe('split produces sketches the real kernel solves and extrudes', { skip: !process.env.CK_WASM }, () => {
  it('a rectangle side split in two: same volume, the joint is the only new freedom', async () => {
    const d0 = base(
      [{ id: 'p1', x: 0, y: 0, fixed: true }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 20 }, { id: 'p4', x: 0, y: 20 }],
      [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e4', type: 'line', p1: 'p4', p2: 'p1' }],
      [{ id: 'k1', type: 'horizontal', refs: ['e1'] }, { id: 'k2', type: 'vertical', refs: ['e2'] }, { id: 'k3', type: 'horizontal', refs: ['e3'] }, { id: 'k4', type: 'vertical', refs: ['e4'] },
        { id: 'k5', type: 'hdist', refs: ['p1', 'p2'], value: 40 }, { id: 'k6', type: 'vdist', refs: ['p2', 'p3'], value: 20 }],
    );
    const before = await solveDraft(d0, 5, { solve: true });
    expect(before.status!.dof).toBe(0);
    const r = must(splitAt(d0, 'e1', { x: 15, y: 0 }));
    expect(resolves(r.draft)).toBe(true);
    const { a } = await same(d0, r.draft, 1e-9);
    expect(a.facts.volume!).toBeCloseTo(4000, 6);
    expect(a.status!.dof).toBe(1);                                   // the joint slides along the side
  });

  it('a slanted side split in two stays one straight line (parallel between the halves)', async () => {
    const d0 = base(
      [{ id: 'p1', x: 0, y: 0, fixed: true }, { id: 'p2', x: 30, y: 10, fixed: true }, { id: 'p3', x: 30, y: 30 }, { id: 'p4', x: 0, y: 30 }],
      [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' }, { id: 'e4', type: 'line', p1: 'p4', p2: 'p1' }],
      [{ id: 'k2', type: 'vertical', refs: ['e2'] }, { id: 'k3', type: 'horizontal', refs: ['e3'] }, { id: 'k4', type: 'vertical', refs: ['e4'] }],
    );
    const r = must(splitAt(d0, 'e1', { x: 12, y: 4 }));
    const { a } = await same(d0, r.draft, 1e-9);
    const j = r.draft.entities.find((e) => e.id === 'e1')!.p2 as string;
    // the joint sits on the old line after the solve
    expect(a.pts[j][1]).toBeCloseTo(a.pts[j][0] / 3, 6);
  });

  it('an arc split in two: same half-disc volume, the radius dimension holds', async () => {
    const d0 = base(
      [{ id: 'c', x: 0, y: 0, fixed: true }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: -10, y: 0 }],
      [{ id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p1' }],
      [{ id: 'k1', type: 'radius', refs: ['e1'], value: 10 }, { id: 'k2', type: 'horizontal', refs: ['e2'] }],
    );
    const r = must(splitAt(d0, 'e1', { x: 5, y: 8.7 }));
    const { a } = await same(d0, r.draft, 1e-9);
    expect(a.facts.volume!).toBeCloseTo((Math.PI * 100 / 2) * 5, 4);
    const j = r.draft.entities.find((e) => e.id === 'e1')!.p2 as string;
    expect(Math.hypot(a.pts[j][0], a.pts[j][1])).toBeCloseTo(10, 6);
  });

  it('a circle split into two arcs: same disc volume, the diameter dimension holds', async () => {
    const d0 = base(
      [{ id: 'c', x: 0, y: 0, fixed: true }],
      [{ id: 'e1', type: 'circle', c: 'c', r: 10 }],
      [{ id: 'k1', type: 'diameter', refs: ['e1'], value: 20 }],
    );
    const r = must(splitAt(d0, 'e1', { x: 0, y: 10 }));
    expect(r.draft.entities).toHaveLength(2);
    const { a } = await same(d0, r.draft, 1e-6);
    expect(a.facts.volume!).toBeCloseTo(Math.PI * 100 * 5, 2);
  });

  it('a smooth fit spline in a closed profile split in two: the loop still extrudes, volume within 0.1% (1.5% when cut at a data point on the curvature peak)', async () => {
    const d0 = base(
      [{ id: 'p1', x: 0, y: 0, fixed: true }, { id: 'p2', x: 10, y: 6, fixed: true }, { id: 'p3', x: 20, y: 9, fixed: true }, { id: 'p4', x: 30, y: 6, fixed: true }, { id: 'p5', x: 40, y: 0, fixed: true }],
      [{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3', 'p4', 'p5'] }, { id: 'e2', type: 'line', p1: 'p5', p2: 'p1' }],
      [],
    );
    const r = must(splitAt(d0, 'e1', { x: 15, y: 8 }));
    expect(r.draft.entities.filter((e) => e.type === 'spline')).toHaveLength(2);
    await same(d0, r.draft, 0.001);                                   // measured 0.06%
    // on the data point at the top of the arch: each half has natural ends there, the old curve did not (measured 1.5%)
    const r2 = must(splitAt(d0, 'e1', { x: 20, y: 9 }));
    await same(d0, r2.draft, 0.03);
  });

  it('a sharply wavering fit spline shifts more (natural ends at the joint), but still extrudes as one loop', async () => {
    const d0 = base(
      [{ id: 'p1', x: 0, y: 0, fixed: true }, { id: 'p2', x: 10, y: 8, fixed: true }, { id: 'p3', x: 25, y: -4, fixed: true }, { id: 'p4', x: 40, y: 6, fixed: true }],
      [{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3', 'p4'] }, { id: 'e2', type: 'line', p1: 'p4', p2: 'p1' }],
      [],
    );
    const r = must(splitAt(d0, 'e1', { x: 18, y: 2 }));
    await same(d0, r.draft, 0.02);                                    // measured 0.4%
  });

  it('a closed fit spline split in two open ones: the loop still extrudes', async () => {
    const pts = [[0, 0], [20, 0], [30, 15], [18, 30], [0, 22]];
    const d0 = base(pts.map(([x, y], i) => ({ id: `p${i + 1}`, x, y, fixed: true })), [{ id: 'e1', type: 'spline', pts: pts.map((_, i) => `p${i + 1}`), closed: true }], []);
    const r = must(splitAt(d0, 'e1', { x: 20, y: 0 }));
    expect(r.draft.entities).toHaveLength(2);
    await same(d0, r.draft, 0.12);                                    // measured 7%: the periodic curve becomes two natural ones
  });
});
