import { describe, expect, it } from 'vitest';
import { attachModelPoint, buildModelSnaps, midExtrusionLine, modelLineAt, modelPointAt, snapAt, type BodyEdge, type SketchDraft } from './index';

const circle = (r: number, z: number, n = 48): number[][] => Array.from({ length: n + 1 }, (_, i) => [r * Math.cos((i / n) * Math.PI * 2), r * Math.sin((i / n) * Math.PI * 2), z]);
// a ring: outer R10, inner r6, 20 high on the z axis
const ring: BodyEdge[] = [circle(10, 0), circle(10, 20), circle(6, 0), circle(6, 20), { pts: [[10, 0, 0], [10, 0, 20]] }, { pts: [[6, 0, 0], [6, 0, 20]] }, { pts: [[-10, 0, 0], [-10, 0, 20]] }, { pts: [[-6, 0, 0], [-6, 0, 20]] }].map((e) => (Array.isArray(e) ? { pts: e } : e));
const side = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] };   // XZ plane through the axis (side view)
const top = { o: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };    // plane through the middle of the height
const empty: SketchDraft = { id: 's', points: [], entities: [], constraints: [], temp: [] } as never;
const on = () => true;

describe('model snaps', () => {
  it('ring side view: the middle between the top and bottom edges is a guide line and the body centre', () => {
    const m = buildModelSnaps(side, ring);
    expect(m.lines.some((l) => l.tag === 'midExtent' && Math.abs(l.a.y - 10) < 1e-6 && Math.abs(l.b.y - 10) < 1e-6)).toBe(true);
    const h = modelLineAt(m, { x: 3, y: 10.2 }, { tolerance: 0.5, on });
    expect(h?.kind).toBe('modelExtent');
    expect(h?.at.y).toBeCloseTo(10, 6);
    expect(h?.guide).toBeTruthy();
    const c = modelPointAt(m, { x: 0.1, y: 10.1 }, { tolerance: 0.5, on });
    expect(c?.model).toBe('bodyCentre');
    expect(c?.at.x).toBeCloseTo(0, 6);
    expect(c?.at.y).toBeCloseTo(10, 6);
  });
  it('ring side view: ends and midpoints of the projected circles (lines) are found', () => {
    const m = buildModelSnaps(side, ring);
    expect(modelPointAt(m, { x: 10.1, y: 0.1 }, { tolerance: 0.5, on })?.model).toBe('modelEndpoint');
    expect(modelPointAt(m, { x: 0.1, y: 0.1 }, { tolerance: 0.5, on })?.model).toBe('modelMidpoint');
  });
  it('a plane through the ring finds the circle centre, quadrants, and the seam piercings', () => {
    const m = buildModelSnaps(top, ring);
    const c = modelPointAt(m, { x: 0.05, y: -0.05 }, { tolerance: 0.5, on });
    expect(c?.kind).toBe('modelCenter');
    expect(m.points.some((p) => p.tag === 'modelQuadrant' && Math.abs(p.at.x - 6) < 1e-6 && Math.abs(p.at.y) < 1e-6)).toBe(true);
    expect(m.points.some((p) => p.tag === 'modelEndpoint' && Math.abs(p.at.x - 10) < 1e-6 && Math.abs(p.at.y) < 1e-6)).toBe(true);
  });
  it('the tolerance decides, and a switched-off kind is skipped', () => {
    const m = buildModelSnaps(top, ring);
    expect(modelPointAt(m, { x: 1, y: 1 }, { tolerance: 0.5, on })).toBeUndefined();
    expect(modelPointAt(m, { x: 0, y: 0 }, { tolerance: 0.5, on: (k) => k !== 'modelCenter' && k !== 'modelExtent' })).toBeUndefined();
  });
  it('the mid-plane of an extrusion is a labelled line half the depth along the normal', () => {
    // a 20 deep extrusion of a sketch on z = 0, seen from the XZ plane: the line is v = 10
    const l = midExtrusionLine(side, { frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, depth: 20, dir: 1 })!;
    expect(l.tag).toBe('midExtrusion');
    expect(l.a.y).toBeCloseTo(10, 9);
    expect(l.b.y).toBeCloseTo(10, 9);
    // symmetric about the sketch: the sketch plane itself
    expect(midExtrusionLine(side, { frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, depth: 20, dir: 1, mid: true })!.a.y).toBeCloseTo(0, 9);
    // a sketch parallel to the extruded one meets the mid-plane nowhere
    expect(midExtrusionLine(top, { frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, depth: 20, dir: 1 })).toBeNull();
    const m = buildModelSnaps(side, [], { extrusions: [{ frame: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, depth: 20, dir: -1 }] });
    expect(modelLineAt(m, { x: 4, y: -10.1 }, { tolerance: 0.5, on })?.model).toBe('midExtrusion');
  });
  it('caps the candidate list', () => {
    const many: BodyEdge[] = Array.from({ length: 3000 }, (_, i) => ({ pts: [[i, 0, 0], [i, 5, 0]] }));
    const m = buildModelSnaps(top, many, { max: 4000 });
    expect(m.points.length).toBeLessThanOrEqual(4000);
    expect(m.capped).toBe(true);
  });
  it('snapAt: sketch points win over the model, the model beats the grid, and nothing changes without it', () => {
    const m = buildModelSnaps(top, ring);
    expect(snapAt(empty, { x: 0.1, y: 0.1 }, { tolerance: 0.5, grid: 5, model: m })?.kind).toBe('modelCenter');
    expect(snapAt(empty, { x: 0.1, y: 0.1 }, { tolerance: 0.5, grid: 5 })?.kind).toBe('grid');
    expect(snapAt(empty, { x: 0.1, y: 0.1 }, { tolerance: 0.5, model: m, kinds: { modelCenter: false } })?.kind).not.toBe('modelCenter');
    const withPt = { ...empty, points: [{ id: 'p1', x: 0.05, y: 0.05 }] } as SketchDraft;
    expect(snapAt(withPt, { x: 0.1, y: 0.1 }, { tolerance: 0.5, model: m })?.kind).toBe('point');
  });
  it('shift+click attach adds a fixed reference point once', () => {
    const a = attachModelPoint(empty, { x: 3, y: 4 });
    expect(a.draft.points[0]).toMatchObject({ x: 3, y: 4, fixed: true });
    expect(attachModelPoint(a.draft, { x: 3, y: 4 }).draft.points.length).toBe(1);
  });
});

describe('attachModelSnap', () => {
  it('pins the new point to a fixed reference point with a coincident constraint', async () => {
    const { attachModelSnap } = await import('./modelSnaps');
    const after = { ...empty, points: [{ id: 'p1', x: 3, y: 4 }] } as SketchDraft;
    const d = attachModelSnap(empty, after, { kind: 'modelEndpoint', at: { x: 3, y: 4 }, model: 'modelEndpoint' });
    expect(d.points.some((p) => p.fixed && p.x === 3)).toBe(true);
    expect(d.constraints.some((c) => c.type === 'coincident')).toBe(true);
    expect(attachModelSnap(empty, after, undefined)).toBe(after);
  });
});
