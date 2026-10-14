import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { mirrorEntities, mirrorTool, type MirrorState } from './mirror';
import { DEFAULT_SETTINGS, type ToolEvent, type ToolOutput } from './types';
import { resolves } from './edit-fixtures';
import { boxSize, closeSessions, solveDraft } from './kernel-fixtures';

afterEach(closeSessions);
const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string): ToolEvent => ({ type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, entityId }, mods: M });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
const ok = (r: ReturnType<typeof mirrorEntities>) => { if (!r.ok) throw new Error(r.hint); return r; };

/** A vertical mirror axis x = 0 (both ends fixed) and, to its right, a D-shape: a vertical side, a top and bottom edge and a
 *  quarter... kept simple: a rectangle 10..30 x 0..20 whose right corners are rounded by an arc is built by hand. */
function scene(): SketchDraft {
  return {
    id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
    points: [
      { id: 'a1', x: 0, y: -5, fixed: true }, { id: 'a2', x: 0, y: 30, fixed: true },
      { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 25, y: 0 }, { id: 'p3', x: 30, y: 5 }, { id: 'p4', x: 30, y: 20 }, { id: 'p5', x: 10, y: 20 },
      { id: 'c1', x: 25, y: 5 }, { id: 'c2', x: 18, y: 12 },
    ],
    entities: [
      { id: 'axis', type: 'line', p1: 'a1', p2: 'a2' },
      { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'arc', c: 'c1', p1: 'p2', p2: 'p3' }, { id: 'e3', type: 'line', p1: 'p3', p2: 'p4' },
      { id: 'e4', type: 'line', p1: 'p4', p2: 'p5' }, { id: 'e5', type: 'line', p1: 'p5', p2: 'p1' },
      { id: 'e6', type: 'circle', c: 'c2', r: 3 },
    ],
    constraints: [{ id: 'k2', type: 'horizontal', refs: ['e1'] }, { id: 'k3', type: 'radius', refs: ['e2'], value: 5 }],
  };
}
const SEL = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];

describe('mirror end to end in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('through the tool: select, Enter, pick the axis; the result solves with no conflict or redundancy and mirrors the volume', async () => {
    const d0 = scene();
    let out: ToolOutput<MirrorState> = { state: mirrorTool.start(), draft: d0, preview: [], fields: [] };
    for (const ev of [...SEL.map(clickOn), key('Enter'), clickOn('axis')]) {
      out = mirrorTool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
      if (ev.type === 'click' && SEL.includes((ev.snap as { entityId: string }).entityId)) expect(out.preview.length).toBeGreaterThan(0);   // Enter will reach the tool
    }
    const d = out.draft;
    expect(d.entities.length).toBe(d0.entities.length + SEL.length);
    expect(resolves(d)).toBe(true);
    const { r, facts, status, pts } = await solveDraft(d, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.redundant).toEqual([]);
    expect(status!.solved).toBe(true);
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 4); expect(pts[p.id][1]).toBeCloseTo(p.y, 4); }
    // the original is a 20 x 20 box with a rounded corner (and a hole); its mirror is the same on the other side
    expect(boxSize(r.body!.box)[0]).toBeCloseTo(60, 4);
    const half = 2 * (20 * 20 - (1 - Math.PI / 4) * 25 - Math.PI * 9);
    expect(facts.volume!).toBeCloseTo(2 * half, 3);
    expect(facts.solids).toBe(2);
  });

  it('stays symmetric when the original changes: widen it and the mirror follows (arc radius, circle radius, positions)', async () => {
    const d0 = scene();
    const d = ok(mirrorEntities(d0, SEL, 'axis')).draft;
    // pin the original so the edit has one answer: p1 and the circle centre fixed; edit the arc radius 5 -> 4 and the circle's radius 3 -> 2
    const pinned: SketchDraft = {
      ...d,
      points: d.points.map((p) => (['p1', 'c2'].includes(p.id) ? { ...p, fixed: true } : p)),
      constraints: [
        ...d.constraints.map((c) => (c.id === 'k3' ? { ...c, value: 4, expr: '4' } : c)),
        { id: 'k90', type: 'distance', refs: ['p1', 'p2'], value: 15 }, { id: 'k91', type: 'vdist', refs: ['p2', 'p4'], value: 20 }, { id: 'k92', type: 'radius', refs: ['e6'], value: 2, expr: '2' },
      ],
    };
    const { r, status, pts, entities } = await solveDraft(pinned, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    // every mirrored point is the reflection (x -> -x) of its original
    const mirrored = d.points.filter((p) => !d.points.some((q) => q.id === p.id && ['a1', 'a2', 'p1', 'p2', 'p3', 'p4', 'p5', 'c1', 'c2'].includes(p.id)));
    expect(mirrored.length).toBeGreaterThan(0);
    for (const q of d.constraints.filter((c) => c.type === 'symmetric')) {
      const [p, m] = q.refs!;
      expect(pts[m][0]).toBeCloseTo(-pts[p][0], 4);
      expect(pts[m][1]).toBeCloseTo(pts[p][1], 4);
    }
    // the circle copy follows the original's radius, the arc copy keeps its radius
    const radii = entities.filter((e) => e.type === 'circle').map((e) => Number(e.r));
    expect(radii).toHaveLength(2);
    expect(radii[0]).toBeCloseTo(2, 5); expect(radii[1]).toBeCloseTo(2, 5);
  });

  it('a half disc across its own diameter: the shared points and the semicircle copy solve and extrude to a full disc', async () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: -5, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 0, y: 0 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'arc', c: 'p3', p1: 'p2', p2: 'p1' }],
      constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }],
    };
    const d = ok(mirrorEntities(d0, ['e2'], 'e1')).draft;
    const { r, facts, status } = await solveDraft(d, 2, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.redundant).toEqual([]);
    expect(facts.volume!).toBeCloseTo(2 * Math.PI * 25, 3);
  });

  it('a semicircle off the axis (the centre is not fixed by its radius alone) mirrors without redundancy across a vertical axis', async () => {
    // a half disc with a slanted diameter p1 -> p2 about the centre (13, 4)
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'a1', x: 0, y: -5, fixed: true }, { id: 'a2', x: 0, y: 25, fixed: true }, { id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 16, y: 8 }, { id: 'c', x: 13, y: 4 }],
      entities: [{ id: 'axis', type: 'line', p1: 'a1', p2: 'a2' }, { id: 'e1', type: 'arc', c: 'c', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p2', p2: 'p1' }],
      constraints: [],
    };
    const d = ok(mirrorEntities(d0, ['e1', 'e2'], 'axis')).draft;
    const { r, status, pts } = await solveDraft(d, 1, { solve: true });
    expect(r.errors).toEqual([]);
    expect(status!.conflicts).toEqual([]);
    expect(status!.redundant).toEqual([]);
    for (const p of d.points) { expect(pts[p.id][0]).toBeCloseTo(p.x, 4); expect(pts[p.id][1]).toBeCloseTo(p.y, 4); }
  });
});
