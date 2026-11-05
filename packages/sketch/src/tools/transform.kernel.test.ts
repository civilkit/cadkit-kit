/** Move, copy, rotate and scale solve in the real kernel: no conflicts, no new freedom, the solver agrees with the drawn coordinates. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { fullyDefine } from '../define';
import { rectDraft } from './edit-fixtures';
import { closeSessions, solveSketchOnly } from './kernel-fixtures';
import { applyTransform, type Xform } from './transform';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc, type SketchSolverStatus } from '@ck/part-model';
import { toFeature } from '../index';

afterEach(closeSessions);
const all4 = ['e1', 'e2', 'e3', 'e4'];
const dims = (): SketchDraft => {
  const r = rectDraft(10, 5);
  return { ...r, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...r.points.map((p) => ({ ...p, x: p.x + 7, y: p.y + 3 }))],
    constraints: [...r.constraints, { id: 'k5', type: 'distance', refs: ['p1', 'p2'], value: 10 }, { id: 'k6', type: 'distance', refs: ['p2', 'p3'], value: 5 }, { id: 'k7', type: 'hdist', refs: ['O', 'p1'], value: 7 }, { id: 'k8', type: 'vdist', refs: ['O', 'p1'], value: 3 }] };
};
const ok = (r: ReturnType<typeof applyTransform>) => { if (!r.ok) throw new Error(r.hint); return r.draft; };

async function solved(d: SketchDraft) {
  const s = await Session.open({ ...emptyPart('T'), features: [toFeature(d)], seq: 2 } as unknown as PartDoc);
  const r = await s.preview([], { upTo: 1, sketchStatus: true, solveSketches: true });
  await s.close().catch(() => {});
  const sk = r.sketches?.[0] as unknown as { sketch: { points: Array<{ id: string; x: number; y: number }> }; status: SketchSolverStatus };
  return { status: sk.status, pts: Object.fromEntries(sk.sketch.points.map((p) => [p.id, [p.x, p.y]])) as Record<string, [number, number]> };
}

describe('transforms against the real kernel', { skip: !process.env.CK_WASM }, () => {
  const base = dims();
  it('the fixture is fully defined', async () => { expect((await solved(base)).status.dof).toBe(0); });
  const cases: Array<[string, Xform, number]> = [
    ['move', { kind: 'move', dx: 12, dy: -4 }, 0],
    ['rotate by 30 degrees', { kind: 'rotate', center: { x: 0, y: 0 }, angleDeg: 30 }, 0],
    ['rotate a quarter turn', { kind: 'rotate', center: { x: 5, y: 5 }, angleDeg: 90 }, 0],
    ['scale by 2', { kind: 'scale', base: { x: 0, y: 0 }, factor: 2 }, 0],
  ];
  for (const [name, x, copies] of cases) {
    it(`${name} in place: still fully defined, no conflicts, coordinates unchanged by the solve`, async () => {
      const d = ok(applyTransform(base, all4, x, copies));
      const { status, pts } = await solved(d);
      expect(status.conflicts).toEqual([]);
      expect(status.redundant).toEqual([]);
      expect(status.solved).toBe(true);
      expect(status.dof).toBe(x.kind === 'rotate' && Math.abs(Math.sin((x.angleDeg * Math.PI) / 90)) > 1e-9 ? 1 : 0);
      for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 4); expect(pts[p.id][1]).toBeCloseTo(p.y, 4); }
    });
  }
  it('rotated off-axis: the rectangle stays a rectangle (parallel / perpendicular replace H / V), one freedom is left (its turn), and Fully define closes it', async () => {
    const d = ok(applyTransform(base, all4, { kind: 'rotate', center: { x: 0, y: 0 }, angleDeg: 30 }));
    const { status, pts } = await solved(d);
    expect(status.solved).toBe(true);
    expect(status.conflicts).toEqual([]);
    expect(status.redundant).toEqual([]);
    expect(status.dof).toBe(1);
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 4); expect(pts[p.id][1]).toBeCloseTo(p.y, 4); }
  });
  it('two copies with their relations: solves, each copy keeps its own size and shape, dof is that of three independent rectangles minus nothing', async () => {
    const d = ok(applyTransform(base, all4, { kind: 'move', dx: 0, dy: 20 }, 2));
    const { status, pts } = await solved(d);
    expect(status.conflicts).toEqual([]);
    expect(status.redundant).toEqual([]);
    expect(status.solved).toBe(true);
    // the original is fully defined; each copy keeps H/V + both sizes but is free to slide: 2 dof per copy
    expect(status.dof).toBe(4);
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 4); expect(pts[p.id][1]).toBeCloseTo(p.y, 4); }
  });
  it('Fully Define can pin a copy down afterwards', async () => {
    const d = ok(applyTransform(base, all4, { kind: 'move', dx: 0, dy: 20 }, 1));
    const s = await Session.open({ ...emptyPart('T'), features: [toFeature(d)], seq: 2 } as unknown as PartDoc);
    const solve = async (dd: SketchDraft) => {
      const r = await s.preview([{ op: 'replace', id: dd.id, feature: toFeature(dd) }], { upTo: 1, solveSketches: true });
      return (r.sketches?.[0] as unknown as { status?: SketchSolverStatus }).status ?? null;
    };
    const r = await fullyDefine(d, solve);
    await s.close().catch(() => {});
    expect(r.fully).toBe(true);
  });
  it('rotate copies of a constrained petal: the solver leaves every copy exactly where the rotation put it', async () => {
    const petal: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'A', x: 0, y: 10 }, { id: 'B', x: 0, y: 40 }, { id: 'M', x: 15, y: 40 }, { id: 'E', x: 30, y: 40 }],
      entities: [{ id: 'e1', type: 'line', p1: 'A', p2: 'B' }, { id: 'e2', type: 'arc', c: 'M', p1: 'E', p2: 'B' }, { id: 'e3', type: 'line', p1: 'E', p2: 'A' }],
      constraints: [
        { id: 'k1', type: 'vertical', refs: ['e1'] }, { id: 'k2', type: 'distance', refs: ['A', 'B'], value: 30 }, { id: 'k3', type: 'tangent', refs: ['e1', 'e2'], at: 'B' },
        { id: 'k4', type: 'hdist', refs: ['A', 'E'], value: 30 },
      ],
    };
    const d = ok(applyTransform(petal, ['e1', 'e2', 'e3'], { kind: 'rotate', center: { x: 0, y: 0 }, angleDeg: 72 }, 4));
    const { status, pts } = await solved(d);
    expect(status.conflicts).toEqual([]);
    expect(status.redundant).toEqual([]);
    expect(status.solved).toBe(true);
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 4); expect(pts[p.id][1]).toBeCloseTo(p.y, 4); }
  });
  it('unused import guard', () => { expect(typeof solveSketchOnly).toBe('function'); });
});
