import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { applyCircular, applyGrid, applyLinear } from './pattern';
import { rectDraft, resolves } from './edit-fixtures';
import { boxSize, closeSessions, solveDraft } from './kernel-fixtures';

afterEach(closeSessions);
const ok = (r: ReturnType<typeof applyLinear>) => { if (!r.ok) throw new Error(r.hint); return r; };
const all4 = ['e1', 'e2', 'e3', 'e4'];
const cornersOf = (d: SketchDraft, ents: SketchDraft['entities']) => ents.flatMap((e) => [e.p1, e.p2]).map(String);

describe('sketch patterns solve in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('linear: three rectangles in a row extrude to three boxes, the solver agrees with the drawn copies, no new degrees of freedom', async () => {
    const d0 = rectDraft(10, 5);                              // dof 4
    expect((await solveDraft(d0, 3, { solve: true })).status!.dof).toBe(4);
    const d = ok(applyLinear(d0, all4, { n: 3, spacing: 15, angleDeg: 0 })).draft;
    expect(resolves(d)).toBe(true);
    const { r, facts, status, pts } = await solveDraft(d, 3, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.redundant).toEqual([]);
    expect(status!.solved).toBe(true);
    expect(status!.dof).toBe(4);
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 5); expect(pts[p.id][1]).toBeCloseTo(p.y, 5); }
    expect(boxSize(r.body!.box)[0]).toBeCloseTo(40, 6);
    expect(facts.volume!).toBeCloseTo(3 * 3 * 50, 4);
    expect(facts.solids).toBe(3);
  });

  it('linear: the spacing dimension drives the copies rigidly (edit 15 to 22 and the copy moves as a whole)', async () => {
    const pinned: SketchDraft = { ...rectDraft(10, 5), points: rectDraft(10, 5).points.map((p) => (p.id === 'p1' ? { ...p, fixed: true } : p)),
      constraints: [...rectDraft(10, 5).constraints, { id: 'k8', type: 'distance', refs: ['p1', 'p2'], value: 10 }, { id: 'k9', type: 'distance', refs: ['p2', 'p3'], value: 5 }] };
    const d = ok(applyLinear(pinned, all4, { n: 2, spacing: 15, angleDeg: 0 })).draft;
    const sp = d.constraints.find((c) => c.type === 'hdist' && !c.hidden)!;
    const edited = { ...d, constraints: d.constraints.map((c) => (c.id === sp.id ? { ...c, value: 22, expr: '22' } : c)) };
    const { status, pts } = await solveDraft(edited, 2, { solve: true });
    expect(status!.conflicts).toEqual([]);
    expect(status!.dof).toBe(0);
    const copyPts = d.points.filter((p) => !pinned.points.some((q) => q.id === p.id));
    const minX = Math.min(...copyPts.map((p) => pts[p.id][0])), maxX = Math.max(...copyPts.map((p) => pts[p.id][0]));
    expect(minX).toBeCloseTo(22, 5);
    expect(maxX).toBeCloseTo(32, 5);                       // the copy is still 10 wide
  });

  it('linear at an angle, with a circle and an arc: solves with no conflicts and no extra freedom', async () => {
    // a half disc: diameter line + arc over it, plus a circle
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: -5, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 0, y: 0 }, { id: 'p4', x: 0, y: 12 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'arc', c: 'p3', p1: 'p2', p2: 'p1' }, { id: 'e3', type: 'circle', c: 'p4', r: 2 }],
      constraints: [],
    };
    const base = await solveDraft(d0, 1, { solve: true });
    const d = ok(applyLinear(d0, ['e1', 'e2', 'e3'], { n: 3, spacing: 20, angleDeg: 30 })).draft;
    const { r, status, pts } = await solveDraft(d, 1, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.redundant).toEqual([]);
    expect(status!.dof).toBe(base.status!.dof);
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 4); expect(pts[p.id][1]).toBeCloseTo(p.y, 4); }
  });

  it('circular: a bolt-hole circle of four, the angle is the driving dimension and copies stay on the radius', async () => {
    // fixed centre O, a hole of radius 3 at (20, 0): four holes at 90 degrees
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 20, y: 0 }],
      entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 3 }], constraints: [],
    };
    const base = await solveDraft(d0, 1, { solve: true }).catch(() => null);
    void base;
    const d = ok(applyCircular(d0, ['e1'], { n: 4, stepDeg: 90, center: { at: { x: 0, y: 0 }, pointId: 'O' } })).draft;
    expect(resolves(d)).toBe(true);
    const { r, facts, status, pts } = await solveDraft(d, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.redundant).toEqual([]);
    expect(status!.solved).toBe(true);
    expect(status!.dof).toBe(3);                            // the original hole: x, y, radius. The copies add none
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 5); expect(pts[p.id][1]).toBeCloseTo(p.y, 5); }
    expect(facts.volume!).toBeCloseTo(2 * 4 * Math.PI * 9, 3);
    expect(facts.solids).toBe(4);
  });

  it('circular: editing the step angle (90 to 60) swings the copies, shape kept (a rectangle rotated about a corner)', async () => {
    const d0: SketchDraft = { ...rectDraft(10, 4), points: [{ id: 'p0', x: -10, y: -10, fixed: true }, ...rectDraft(10, 4).points.map((p) => ({ ...p, x: p.x + 10, y: p.y + 10 }))] };
    const made = ok(applyCircular(d0, all4, { n: 2, stepDeg: 90, center: { at: { x: -10, y: -10 }, pointId: 'p0' } }));
    const d = made.draft;
    const base = await solveDraft(d, 2, { solve: true });
    expect(base.status!.conflicts).toEqual([]);
    expect(base.status!.redundant).toEqual([]);
    const ang = d.constraints.find((c) => c.type === 'angle')!;
    const edited = { ...d, constraints: d.constraints.map((c) => (c.id === ang.id ? { ...c, value: 60, expr: '60' } : c)) };
    const { status, pts } = await solveDraft(edited, 2, { solve: true });
    expect(status!.conflicts).toEqual([]);
    // the copy's anchor sits 60 degrees from the original's, same distance from the centre
    const anchor = (d.entities.find((e) => e.id === 'e1')!.p1) as string;
    const copyAnchor = made.created.find((id) => id.startsWith('p') && d.points.find((p) => p.id === id) && Math.hypot(d.points.find((p) => p.id === id)!.x - (-10), d.points.find((p) => p.id === id)!.y - (-10)) > 1)!;
    void copyAnchor;
    const radial = d.entities.filter((e) => e.construction);
    const A0 = pts[String(radial[0].p2)], A1 = pts[String(radial[1].p2)], C = pts.p0;
    expect(Math.hypot(A0[0] - C[0], A0[1] - C[1])).toBeCloseTo(Math.hypot(A1[0] - C[0], A1[1] - C[1]), 5);
    const turn = Math.atan2(A1[1] - C[1], A1[0] - C[0]) - Math.atan2(A0[1] - C[1], A0[0] - C[0]);
    expect((turn * 180) / Math.PI).toBeCloseTo(60, 4);
    // the copied rectangle stays 10 x 4: its first side keeps its length
    const copySide = d.entities.slice(4, 8).find((e) => e.p1 !== undefined)!;
    const q1 = pts[String(copySide.p1)], q2 = pts[String(copySide.p2)];
    expect(Math.hypot(q2[0] - q1[0], q2[1] - q1[1])).toBeCloseTo(10, 5);
    void anchor; void cornersOf;
  });

  describe('grid', () => {
    const hole = (): SketchDraft => ({
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: 0, y: 0 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 3 }], constraints: [],
    });
    const grid = (g: Partial<Parameters<typeof applyGrid>[2]> = {}) => ok(applyGrid(hole(), ['e1'], { n1: 3, spacing1: 20, angle1: 0, n2: 2, spacing2: 20, angle2: 90, ...g }));

    it('3 columns x 2 rows of a circle: solves, no conflicts, no new freedom, six solids', async () => {
      const d = grid().draft;
      expect(resolves(d)).toBe(true);
      const { r, facts, status, pts } = await solveDraft(d, 2, { solve: true });
      expect(r.errors).toEqual([]);
      expect(status!.conflicts).toEqual([]);
      expect(status!.redundant).toEqual([]);
      expect(status!.solved).toBe(true);
      expect(status!.dof).toBe(3);                                   // the original circle: x, y, radius. The 5 copies add none
      for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 5); expect(pts[p.id][1]).toBeCloseTo(p.y, 5); }
      expect(facts.volume!).toBeCloseTo(6 * 2 * Math.PI * 9, 3);
      expect(facts.solids).toBe(6);
    });

    it('editing spacing 2 (20 to 35) moves the whole second row; editing the first spacing 1 step moves that column of both rows', async () => {
      const g0 = grid().draft;
      const d = { ...g0, points: g0.points.map((p) => (p.id === 'p1' ? { ...p, fixed: true } : p)) };   // the original stays put, so the copies' positions can be read off
      const dims = d.constraints.filter((c) => !c.hidden && (c.type === 'hdist' || c.type === 'vdist'));
      const vdim = dims.find((c) => c.type === 'vdist')!;
      const edit = (id: string, v: number) => ({ ...d, constraints: d.constraints.map((c) => (c.id === id ? { ...c, value: v, expr: String(v) } : c)) });
      let s = await solveDraft(edit(vdim.id, 35), 2, { solve: true });
      expect(s.status!.conflicts).toEqual([]);
      const centres = d.entities.filter((e) => e.type === 'circle').map((e) => String(e.c));
      expect(centres.map((c) => Math.round(s.pts[c][1]) + 0)).toEqual([0, 0, 0, 35, 35, 35]);
      expect(centres.map((c) => Math.round(s.pts[c][0]) + 0)).toEqual([0, 20, 40, 0, 20, 40]);
      const hdims = dims.filter((c) => c.type === 'hdist');
      s = await solveDraft(edit(hdims[0].id, 30), 2, { solve: true });
      expect(s.status!.conflicts).toEqual([]);
      expect(Math.round(s.pts[centres[1]][0])).toBe(30);
      expect(Math.round(s.pts[centres[4]][0])).toBe(30);             // row 2 follows row 1 column by column
    });

    it('a tilted grid of rectangles (corners placed against the anchor): solves with the same freedom as the original', async () => {
      const d0 = rectDraft(10, 5);
      const base = await solveDraft(d0, 2, { solve: true });
      const d = ok(applyGrid(d0, all4, { n1: 3, spacing1: 18, angle1: 20, n2: 3, spacing2: 15, angle2: 115 })).draft;
      const { r, status, pts } = await solveDraft(d, 2, { solve: true });
      expect(r.errors).toEqual([]);
      expect(status!.conflicts).toEqual([]);
      expect(status!.redundant).toEqual([]);
      expect(status!.dof).toBe(base.status!.dof);
      for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 4); expect(pts[p.id][1]).toBeCloseTo(p.y, 4); }
    });

    it('one column of four rows, and a grid of half discs, also solve with no added freedom', async () => {
      const col = grid({ n1: 1, n2: 4 }).draft;
      let s = await solveDraft(col, 2, { solve: true });
      expect(s.status!.conflicts).toEqual([]);
      expect(s.status!.redundant).toEqual([]);
      expect(s.status!.dof).toBe(3);
      const arcs: SketchDraft = {
        id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
        points: [{ id: 'p1', x: -5, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 0, y: 0 }],
        entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'arc', c: 'p3', p1: 'p2', p2: 'p1' }], constraints: [],
      };
      const base = await solveDraft(arcs, 1, { solve: true });
      const d = ok(applyGrid(arcs, ['e1', 'e2'], { n1: 2, spacing1: 15, angle1: 0, n2: 2, spacing2: 12, angle2: 90 })).draft;
      s = await solveDraft(d, 1, { solve: true });
      expect(s.status!.conflicts).toEqual([]);
      expect(s.status!.redundant).toEqual([]);
      expect(s.status!.dof).toBe(base.status!.dof);
      for (const p of d.points) { expect(s.pts[p.id][0]).toBeCloseTo(p.x, 4); expect(s.pts[p.id][1]).toBeCloseTo(p.y, 4); }
    });
  });
});
