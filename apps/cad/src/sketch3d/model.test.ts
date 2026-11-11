import { describe, expect, it } from 'vitest';
import { bsplineSamples, circumcentre, splineSamples, arcSamples } from './curves';
import {
  draftOf, emptyDraft, entityPolyline, finishStroke, isSplinePath, movePoint, normalPlane, removePoint, sketch3dCurves, sketch3dFeature, sketch3dOps, snapRay, strokeReady,
  withPoint, withStroke, workPlanes, rayOnPlane, fitDraftToSurface, resample, type Draft3, type P3, type Stroke,
} from './model';

const draftWith = (pts: Array<[number, number, number]>): { d: Draft3; ids: string[] } => {
  let d = emptyDraft();
  const ids: string[] = [];
  for (const p of pts) { const r = withPoint(d, p); d = r.draft; ids.push(r.id); }
  return { d, ids };
};
const stroke = (mode: Stroke['mode'], ids: string[], degree = 3): Stroke => ({ mode, ids, degree });

describe('curves', () => {
  it('a natural cubic spline passes through its points and is a straight line for collinear data', () => {
    const pts: Array<[number, number, number]> = [[0, 0, 0], [10, 5, 2], [20, 0, 4], [30, 5, 6]];
    const s = splineSamples(pts, 8);
    expect(s[0]).toEqual(pts[0]);
    expect(s[8]).toEqual(pts[1]);
    expect(s[s.length - 1]).toEqual(pts[3]);
    const line = splineSamples([[0, 0, 0], [5, 5, 5], [10, 10, 10]], 4);
    for (const q of line) expect(Math.abs(q[0] - q[1]) + Math.abs(q[1] - q[2])).toBeLessThan(1e-9);
  });
  it('a clamped B-spline starts and ends on the control polygon and stays inside its hull', () => {
    const cp: Array<[number, number, number]> = [[0, 0, 0], [10, 20, 0], [20, 0, 10], [30, 20, 10]];
    const s = bsplineSamples(cp, 3, 20);
    expect(s[0]).toEqual(cp[0]);
    expect(s[20]).toEqual(cp[3]);
    expect(bsplineSamples(cp, 4)).toEqual([]);   // degree 4 needs five points
  });
  it('the circle through three points in space has the right centre, and an arc runs from the start to the end', () => {
    const c = circumcentre([10, 0, 5], [0, 10, 5], [-10, 0, 5])!;
    expect(c.c.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 5]);
    expect(c.r).toBeCloseTo(10, 9);
    const a = arcSamples([0, 0, 5], [10, 0, 5], [0, 10, 5], 16);
    expect(a[0]).toEqual([10, 0, 5]);
    expect(a[16]).toEqual([0, 10, 5]);
    expect(a[8][0]).toBeCloseTo(10 * Math.SQRT1_2, 9);
    expect(circumcentre([0, 0, 0], [1, 1, 1], [2, 2, 2])).toBeNull();
  });
});

describe('strokes', () => {
  it('a polyline of three clicks makes two lines sharing the middle point', () => {
    const { d, ids } = draftWith([[0, 0, 0], [10, 0, 5], [10, 10, 5]]);
    const out = finishStroke(d, stroke('line', ids));
    expect(out.entities.map((e) => [e.type, e.p1, e.p2])).toEqual([['line', ids[0], ids[1]], ['line', ids[1], ids[2]]]);
  });
  it('clicking the first point again closes a spline', () => {
    const { d, ids } = draftWith([[0, 0, 0], [10, 0, 0], [10, 10, 0]]);
    const out = finishStroke(d, stroke('spline', [...ids, ids[0]]));
    expect(out.entities).toEqual([{ id: 'e1', type: 'spline', pts: ids, closed: true }]);
  });
  it('a spline needs two points; a lone point is dropped with its stroke', () => {
    const { d, ids } = draftWith([[0, 0, 0]]);
    expect(strokeReady(stroke('spline', ids))).toBe(false);
    const out = finishStroke(d, stroke('spline', ids));
    expect(out.entities).toEqual([]);
    expect(out.points).toEqual([]);
  });
  it('a control spline keeps the degree the points allow', () => {
    const { d, ids } = draftWith([[0, 0, 0], [10, 10, 0], [20, 0, 0]]);
    const out = finishStroke(d, stroke('cvspline', ids, 3));
    expect(out.entities[0]).toMatchObject({ type: 'cvspline', degree: 2 });
  });
  it('three clicks make one arc (centre, start, end) when it is at most half a turn, the guide point leaves', () => {
    const { d, ids } = draftWith([[10, 0, 0], [7.0710678, 7.0710678, 0], [0, 10, 0]]);
    const out = finishStroke(d, stroke('arc', ids));
    expect(out.entities).toHaveLength(1);
    const arc = out.entities[0];
    const centre = out.points.find((p) => p.id === arc.c)!;
    expect([centre.x, centre.y, centre.z].map((v) => Math.abs(v) < 1e-6)).toEqual([true, true, true]);
    expect(arc.p1).toBe(ids[0]);
    expect(arc.p2).toBe(ids[2]);
    expect(out.points.find((p) => p.id === ids[1])).toBeUndefined();
  });
  it('an arc of more than half a turn is cut into arcs the kernel can read, and they join up', () => {
    // start at angle 0, through angle 180 + 40, to angle 300: a 300 degree arc
    const at = (deg: number): [number, number, number] => [10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180), 0];
    const { d, ids } = draftWith([at(0), at(150), at(300)]);
    const out = finishStroke(d, stroke('arc', ids));
    expect(out.entities.length).toBeGreaterThanOrEqual(2);
    expect(out.entities.every((e) => e.type === 'arc')).toBe(true);
    const polys = out.entities.map((e) => entityPolyline(out, e));
    for (let i = 1; i < polys.length; i++) expect(polys[i][0].map((v, k) => Math.abs(v - polys[i - 1][polys[i - 1].length - 1][k]) < 1e-6)).toEqual([true, true, true]);
    // every arc is at most half a turn
    for (const p of polys) expect(Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1])).toBeLessThanOrEqual(20 + 1e-9);
    // together they end at angle 300
    const last = polys[polys.length - 1];
    expect(last[last.length - 1][0]).toBeCloseTo(at(300)[0], 6);
    expect(last[last.length - 1][1]).toBeCloseTo(at(300)[1], 6);
  });
  it('collinear arc clicks make no arc', () => {
    const { d, ids } = draftWith([[0, 0, 0], [5, 5, 5], [10, 10, 10]]);
    expect(finishStroke(d, stroke('arc', ids)).entities).toEqual([]);
  });
  it('points mode makes a point entity per point', () => {
    const { d, ids } = draftWith([[1, 2, 3]]);
    expect(finishStroke(d, stroke('point', ids)).entities).toEqual([{ id: 'e1', type: 'point', p: ids[0] }]);
  });
  it('withStroke shows the chain so far without touching the draft', () => {
    const { d, ids } = draftWith([[0, 0, 0], [10, 0, 0]]);
    const shown = withStroke(d, stroke('line', ids));
    expect(shown.entities).toHaveLength(1);
    expect(d.entities).toHaveLength(0);
  });
});

describe('editing points', () => {
  it('moving a point changes only that point', () => {
    const { d, ids } = draftWith([[0, 0, 0], [1, 1, 1]]);
    const m = movePoint(d, ids[1], [5, 6, 7]);
    expect(m.points[1]).toMatchObject({ x: 5, y: 6, z: 7 });
    expect(m.points[0]).toEqual(d.points[0]);
  });
  it('deleting the middle point of a polyline joins its neighbours', () => {
    const { d, ids } = draftWith([[0, 0, 0], [10, 0, 0], [10, 10, 0]]);
    const full = finishStroke(d, stroke('line', ids));
    const out = removePoint(full, ids[1]);
    expect(out.entities.map((e) => [e.p1, e.p2])).toEqual([[ids[0], ids[2]]]);
    expect(out.points.map((p) => p.id)).toEqual([ids[0], ids[2]]);
  });
  it('deleting the end of a polyline removes its line; deleting a spline point keeps the spline until two are left', () => {
    const { d, ids } = draftWith([[0, 0, 0], [10, 0, 0], [10, 10, 0]]);
    const lines = removePoint(finishStroke(d, stroke('line', ids)), ids[2]);
    expect(lines.entities).toHaveLength(1);
    const sp = finishStroke(d, stroke('spline', ids));
    const one = removePoint(sp, ids[1]);
    expect(one.entities[0]).toMatchObject({ type: 'spline', pts: [ids[0], ids[2]] });
    expect(removePoint(one, ids[0]).entities).toEqual([]);
  });
  it('deleting an arc end removes the arc and its centre; constraints on a deleted point go', () => {
    const { d, ids } = draftWith([[10, 0, 0], [7.0710678, 7.0710678, 0], [0, 10, 0]]);
    const arc = finishStroke(d, stroke('arc', ids));
    const out = removePoint({ ...arc, constraints: [{ type: 'fix', refs: [ids[0]] }, { type: 'fix', refs: [ids[2]] }] }, ids[0]);
    expect(out.entities).toEqual([]);
    expect(out.points.map((p) => p.id)).toEqual([ids[2]]);
    expect(out.constraints).toEqual([{ type: 'fix', refs: [ids[2]] }]);
  });
  it('a loose point of a chain under way survives deleting another point', () => {
    const { d, ids } = draftWith([[0, 0, 0], [10, 0, 0], [10, 10, 0]]);
    const full = finishStroke(d, stroke('line', [ids[0], ids[1]]));
    const out = removePoint(full, ids[0]);
    expect(out.points.map((p) => p.id)).toEqual([ids[2]]);
  });
});

describe('work planes and snapping', () => {
  const planes = workPlanes('y', [{ id: 'F4', frame: { o: [0, 0, 30], z: [0, 0, 1] } }]);
  const ground = planes[0];
  it('the ground is normal to the up axis; the datum planes of the document follow', () => {
    expect(ground.n).toEqual([0, 1, 0]);
    expect(workPlanes('z', [])[0].n).toEqual([0, 0, 1]);
    expect(planes.map((p) => p.id)).toEqual(['ground', 'front', 'top', 'right', 'plane:F4']);
  });
  it('a ray lands on the plane lifted by the height; a ray parallel to it, or pointing away, lands nowhere', () => {
    const ray = { o: [0, 100, 0] as [number, number, number], d: [0, -1, 0] as [number, number, number] };
    expect(rayOnPlane(ray, ground, 0)).toEqual([0, 0, 0]);
    expect(rayOnPlane(ray, ground, 25)).toEqual([0, 25, 0]);
    expect(rayOnPlane({ o: [0, 100, 0], d: [1, 0, 0] }, ground, 0)).toBeNull();
    expect(rayOnPlane({ o: [0, 100, 0], d: [0, 1, 0] }, ground, 0)).toBeNull();
  });
  it('snaps to the nearest candidate within the pixel reach, preferring sketch points over a model middle, else the plane', () => {
    const ray = { o: [0, 100, 0] as [number, number, number], d: [0, -1, 0] as [number, number, number] };
    const wpp = () => 0.5;   // half a unit per pixel
    const cands = [
      { p: [3, 0, 0] as [number, number, number], kind: 'midpoint' as const },
      { p: [3, 10, 0] as [number, number, number], kind: 'draft' as const, id: 'p1' },
      { p: [40, 0, 0] as [number, number, number], kind: 'endpoint' as const },
    ];
    const s = snapRay(ray, cands, wpp, 12, ground, 0)!;
    expect(s).toMatchObject({ kind: 'draft', id: 'p1', pos: [3, 10, 0] });   // both within 6 units (12 px); the draft point wins on its bias
    expect(snapRay(ray, [cands[2]], wpp, 12, ground, 0)).toMatchObject({ kind: 'plane', pos: [0, 0, 0] });
    expect(snapRay({ o: [0, 100, 0], d: [1, 0, 0] }, [], wpp, 12, ground, 0)).toBeNull();
  });
  it('a candidate behind the viewer is ignored', () => {
    const ray = { o: [0, 100, 0] as [number, number, number], d: [0, -1, 0] as [number, number, number] };
    expect(snapRay(ray, [{ p: [0, 200, 0], kind: 'draft', id: 'p1' }], () => 1, 12, ground, 0)?.kind).toBe('plane');
  });
});

describe('the feature', () => {
  it('builds the wire shape the kernel reads and reads it back', () => {
    const { d, ids } = draftWith([[0, 0, 0], [50, 0, 30], [100, 40, 0]]);
    const f = sketch3dFeature('F1', finishStroke(d, stroke('spline', ids)));
    expect(f).toEqual({ type: 'sketch3d', id: 'F1', points: [{ id: 'p1', x: 0, y: 0, z: 0 }, { id: 'p2', x: 50, y: 0, z: 30 }, { id: 'p3', x: 100, y: 40, z: 0 }], entities: [{ id: 'e1', type: 'spline', pts: ['p1', 'p2', 'p3'] }], constraints: [] });
    expect(draftOf(f)).toEqual({ points: f.points, entities: f.entities, constraints: [] });
  });
  it('editing keeps the feature’s other keys and the constraints and entities the tool does not make', () => {
    const base = { type: 'sketch3d', id: 'F2', name: 'Path', visible: true, points: [{ id: 'a', x: 0, y: 0, z: 0 }], entities: [], constraints: [{ type: 'fix', refs: ['a'] }] };
    const d = draftOf(base)!;
    expect(sketch3dFeature('F2', movePoint(d, 'a', [1, 2, 3]), base)).toMatchObject({ name: 'Path', visible: true, constraints: [{ type: 'fix', refs: ['a'] }], points: [{ id: 'a', x: 1, y: 2, z: 3 }] });
    expect(draftOf({ type: 'sketch', id: 'S' })).toBeNull();
  });
  it('a sweep path is one open spline with nothing but points beside it', () => {
    const spline = { type: 'sketch3d', entities: [{ id: 'e1', type: 'spline', pts: ['a', 'b'] }, { id: 'e2', type: 'point', p: 'a' }] };
    expect(isSplinePath(spline)).toBe(true);
    expect(isSplinePath({ type: 'sketch3d', entities: [{ id: 'e1', type: 'spline', pts: ['a', 'b'], closed: true }] })).toBe(false);
    expect(isSplinePath({ type: 'sketch3d', entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }] })).toBe(false);
    expect(isSplinePath({ type: 'sketch3d', entities: [{ id: 'e1', type: 'spline', pts: ['a', 'b'] }, { id: 'e2', type: 'spline', pts: ['b', 'c'] }] })).toBe(false);
    expect(isSplinePath({ type: 'sketch', entities: spline.entities })).toBe(false);
  });
  it('the ops replace when editing and add the plane normal to the path after the sketch', () => {
    const f = { type: 'sketch3d', id: 'F1' };
    expect(sketch3dOps(f, false)).toEqual([{ op: 'add', feature: f }]);
    expect(sketch3dOps(f, true, normalPlane('F2', 'F1'))).toEqual([{ op: 'replace', id: 'F1', feature: f }, { op: 'add', feature: { type: 'plane', id: 'F2', mode: 'normal', path: 'F1' } }]);
  });
  it('the viewport curves: one per entity, a cross for a point, nothing for the sketch being edited or a suppressed one', () => {
    const { d, ids } = draftWith([[0, 0, 0], [50, 0, 30], [100, 40, 0]]);
    const spline = sketch3dFeature('F1', finishStroke(d, stroke('spline', ids)));
    const pts = sketch3dFeature('F2', finishStroke(draftWith([[1, 2, 3]]).d, stroke('point', ['p1'])));
    const curves = sketch3dCurves([spline, pts, { type: 'sketch', id: 'S' }]);
    expect(curves.filter((c) => c.id === 'F1')).toHaveLength(1);
    expect(curves.filter((c) => c.id === 'F1')[0].pts.length).toBeGreaterThan(20);
    expect(curves.filter((c) => c.id === 'F2')).toHaveLength(3);
    expect(sketch3dCurves([spline, pts], 'F1').every((c) => c.id === 'F2')).toBe(true);
    expect(sketch3dCurves([{ ...spline, suppressed: true }])).toEqual([]);
  });
});

describe('mesh surface: snapping and fitting', () => {
  const plane = workPlanes('z', [])[0];
  // a sphere of radius 10 about the origin stands in for a reference mesh
  const sphere = (ray: { o: P3; d: P3 }) => {
    const { o, d } = ray;
    const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2], c = o[0] ** 2 + o[1] ** 2 + o[2] ** 2 - 100;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? { pos: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] as P3 } : null;
  };
  it('a ray that hits the mesh lands on its surface; one that misses falls back to the work plane', () => {
    const hit = snapRay({ o: [0, 0, 50], d: [0, 0, -1] }, [], () => 1, 12, plane, 0, sphere)!;
    expect(hit.kind).toBe('mesh');
    expect(hit.pos[2]).toBeCloseTo(10, 6);
    const miss = snapRay({ o: [30, 0, 50], d: [0, 0, -1] }, [], () => 1, 12, plane, 0, sphere)!;
    expect(miss.kind).toBe('plane');
  });
  it('a nearby point snap still wins over the mesh', () => {
    const s = snapRay({ o: [0, 0, 50], d: [0, 0, -1] }, [{ p: [0.1, 0, 12], kind: 'draft', id: 'p1' }], () => 1, 12, plane, 0, sphere)!;
    expect(s.kind).toBe('draft');
  });
  it('fitDraftToSurface turns a spline through three clicks into a dense spline whose points lie on the surface', () => {
    const onSphere = (p: P3): P3 | null => { const l = Math.hypot(...p); return l ? [p[0] * 10 / l, p[1] * 10 / l, p[2] * 10 / l] : null; };
    let d = emptyDraft();
    const ids: string[] = [];
    for (const p of [[10, 0, 0], [7.07, 0, 7.07], [0, 0, 10]] as P3[]) { const w = withPoint(d, p); d = w.draft; ids.push(w.id); }
    d = finishStroke(d, { mode: 'spline', ids, degree: 3 });
    const r = fitDraftToSurface(d, { project: onSphere });
    expect(r.fitted).toBe(1);
    const e = r.draft.entities.find((x) => x.type === 'spline')!;
    const pts = (e.pts as string[]).map((id) => r.draft.points.find((p) => p.id === id)!);
    expect(pts.length).toBeGreaterThan(20);
    for (const p of pts) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(10, 6);
    expect(r.draft.points.length).toBe(pts.length);   // the three clicks are gone: nothing else used them
    expect(pts[0]).toMatchObject({ x: 10, y: 0, z: 0 });
  });
  it('a curve with a sample off the surface is left as drawn; point entities move onto it', () => {
    let d = emptyDraft();
    const a = withPoint(d, [10, 0, 0]); d = a.draft;
    const b = withPoint(d, [0, 0, 10]); d = b.draft;
    d = finishStroke(d, { mode: 'line', ids: [a.id, b.id], degree: 3 });
    const none = fitDraftToSurface(d, { project: () => null });
    expect(none.fitted).toBe(0);
    expect(none.draft.entities).toEqual(d.entities);
    const q = withPoint(d, [0, 0, 20]); d = finishStroke(q.draft, { mode: 'point', ids: [q.id], degree: 3 });
    const moved = fitDraftToSurface(d, { project: (p) => [p[0], p[1], Math.min(p[2], 10)] });
    expect(moved.draft.points.find((p) => p.id === q.id)!.z).toBe(10);
  });
  it('resample keeps the ends and spaces the points by length', () => {
    const r = resample([[0, 0, 0], [10, 0, 0], [10, 10, 0]], 5);
    expect(r).toHaveLength(5);
    expect(r[2]).toEqual([10, 0, 0]);
    expect(r[4]).toEqual([10, 10, 0]);
  });
});
