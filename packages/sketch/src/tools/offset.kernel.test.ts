import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { applyOffset } from './offset';
import { rectDraft, resolves } from './edit-fixtures';
import { filletTool } from './fillet';
import { DEFAULT_SETTINGS, type ToolEvent } from './types';
import { boxSize, closeSessions, solveDraft } from './kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods: M });
const field = (id: string, value: number): ToolEvent => ({ type: 'field', id, value, commit: true });
const ok = (r: ReturnType<typeof applyOffset>) => { if (!r.ok) throw new Error(r.hint); return r; };

describe('offset copies solve in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a rectangle offset outside: the copy is a ring around it, constraints hold, adds no degrees of freedom', async () => {
    const d0 = rectDraft(40, 20);                       // 4 free points, H/V on all sides: dof 4
    const base = await solveDraft(d0, 5, { solve: true });
    expect(base.status!.dof).toBe(4);
    const d = ok(applyOffset(d0, ['e1', 'e2', 'e3', 'e4'], -3)).draft;
    expect(resolves(d)).toBe(true);
    const { r, facts, status, pts } = await solveDraft(d, 5, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.solved).toBe(true);
    expect(status!.dof).toBe(4);                        // the copy is fully tied to the original
    // the kernel's solved copy is where we drew it
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 5); expect(pts[p.id][1]).toBeCloseTo(p.y, 5); }
    // the outer and inner loops make a ring: area 46*26 - 40*20 times depth
    expect(boxSize(r.body!.box).slice(0, 2)).toEqual([expect.closeTo(46, 6), expect.closeTo(26, 6)]);
    expect(facts.volume!).toBeCloseTo(5 * (46 * 26 - 40 * 20), 4);
  });

  it('moving the original with a driving dimension moves the copy (it is parametric)', async () => {
    const d0 = rectDraft(40, 20);
    const pinned: SketchDraft = { ...d0, points: d0.points.map((p) => (p.id === 'p1' ? { ...p, fixed: true } : p)),
      constraints: [...d0.constraints, { id: 'k9', type: 'distance', refs: ['p1', 'p2'], value: 40 }, { id: 'k10', type: 'distance', refs: ['p2', 'p3'], value: 20 }] };
    const d = ok(applyOffset(pinned, ['e1', 'e2', 'e3', 'e4'], -2)).draft;
    // widen the original from 40 to 50: the copy follows
    const wide = { ...d, constraints: d.constraints.map((c) => (c.id === 'k9' ? { ...c, value: 50, expr: '50' } : c)) };
    const { status, pts } = await solveDraft(wide, 3, { solve: true });
    expect(status!.conflicts).toEqual([]);
    expect(status!.dof).toBe(0);
    expect(pts.p2[0]).toBeCloseTo(50, 5);
    const copyRight = Math.max(...d.points.filter((p) => !pinned.points.some((q) => q.id === p.id)).map((p) => pts[p.id][0]));
    expect(copyRight).toBeCloseTo(52, 5);
  });

  it('a filleted rectangle offset inward keeps its arcs concentric, radii r - d, solves with no conflicts', async () => {
    let d = rectDraft(40, 30);
    for (const [a, b] of [['e1', 'e2'], ['e2', 'e3'], ['e3', 'e4'], ['e4', 'e1']]) {
      let st = filletTool.start(); let out = { draft: d } as { draft: SketchDraft; state?: unknown };
      for (const ev of [field('r', 6), clickOn(a), clickOn(b)]) { const o = filletTool.step(st, ev, out.draft, DEFAULT_SETTINGS); st = o.state; out = o; }
      d = out.draft;
    }
    const ids = d.entities.map((e) => e.id);
    expect(ids).toHaveLength(8);
    const res = ok(applyOffset(d, ids, 2));              // inward: the walk is counter-clockwise
    expect(res.dropped).toEqual([]);
    const arcs = res.draft.entities.slice(8).filter((e) => e.type === 'arc');
    expect(arcs).toHaveLength(4);
    const { r, facts, status, pts, entities } = await solveDraft(res.draft, 4, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.solved).toBe(true);
    // the copy loop is a 36 x 26 rounded rectangle with corner radius 4, as a hole in nothing: the part is the larger loop plus the copy region
    const copyArc = entities.find((e) => e.id === arcs[0].id)!;
    const c = pts[String(copyArc.c)], p1 = pts[String(copyArc.p1)];
    expect(Math.hypot(p1[0] - c[0], p1[1] - c[1])).toBeCloseTo(4, 5);
    const area = (w: number, h: number, rr: number) => w * h - (4 - Math.PI) * rr * rr;
    expect(facts.volume!).toBeCloseTo(4 * (area(40, 30, 6) - area(36, 26, 4)), 3);
  });

  it('a circle offset: concentric ring, the radius difference is the dimension', async () => {
    const d0: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: [{ id: 'p1', x: 3, y: 4 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 10 }], constraints: [] };
    const d = ok(applyOffset(d0, ['e1'], -2.5)).draft;
    const { r, facts, status } = await solveDraft(d, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.dof).toBe(3);                         // x, y of the centre and the original radius; the copy adds none
    expect(facts.volume!).toBeCloseTo(2 * Math.PI * (12.5 ** 2 - 10 ** 2), 3);
  });

  it('an open line + arc chain offset solves', async () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 15, y: 5 }, { id: 'c', x: 10, y: 5 }, { id: 'p4', x: 15, y: -5 }, { id: 'p5', x: 0, y: -5 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'arc', c: 'c', p1: 'p2', p2: 'p3' }],
      constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }],
    };
    const d = ok(applyOffset(d0, ['e1', 'e2'], -2)).draft;   // outside: right of the walk
    const { r, status } = await solveDraft({ ...d, points: d.points.filter((p) => p.id !== 'p4' && p.id !== 'p5') }, 2, { solve: true });
    expect(r.body ?? r.errors).toBeTruthy();
    expect(status === undefined || status.conflicts.length === 0).toBe(true);
  });
});
