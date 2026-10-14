import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type BodyEdge, type PlaneFrame3, type Pt, type ToolEnv, type ToolEvent } from './types';
import { classifyCurve, edgeNear, edgesFor, flatten, projectEdges, projectTool } from './project';
import { blankDraft } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const FRONT: PlaneFrame3 = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const TOP_AT5: PlaneFrame3 = { o: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const circlePts = (cx: number, cy: number, r: number, z = 0, a0 = 0, sweep = Math.PI * 2, n = 48): number[][] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(a0 + (sweep * i) / n), cy + r * Math.sin(a0 + (sweep * i) / n), z]);
const edge = (key: string, pts: number[][], faces: string[] = []): BodyEdge => ({ key, faces, pts });

describe('classifyCurve', () => {
  it('recognises a straight edge', () => {
    expect(classifyCurve([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } });
    expect(classifyCurve([{ x: 0, y: 0 }, { x: 5, y: 2.5 }, { x: 10, y: 5 }])?.kind).toBe('line');
  });
  it('a full circle, closed or not duplicated at the end', () => {
    const pts = flatten(FRONT, circlePts(3, 4, 7)).pts;
    const c = classifyCurve(pts);
    expect(c).toMatchObject({ kind: 'circle' });
    if (c?.kind === 'circle') { expect(c.r).toBeCloseTo(7, 6); expect(c.c.x).toBeCloseTo(3, 6); expect(c.c.y).toBeCloseTo(4, 6); }
    expect(classifyCurve(pts.slice(0, -1))?.kind).toBe('circle');
  });
  it('an arc is counter-clockwise from p1 to p2 whichever way the edge runs', () => {
    const ccw = flatten(FRONT, circlePts(0, 0, 10, 0, 0, Math.PI / 2, 12)).pts;
    const a = classifyCurve(ccw);
    expect(a).toMatchObject({ kind: 'arc' });
    if (a?.kind === 'arc') { expect(a.p1.x).toBeCloseTo(10, 6); expect(a.p2.y).toBeCloseTo(10, 6); }
    const b = classifyCurve([...ccw].reverse());
    if (b?.kind === 'arc') { expect(b.p1.x).toBeCloseTo(10, 6); expect(b.p2.y).toBeCloseTo(10, 6); }
    expect(b?.kind).toBe('arc');
  });
  it('a circle seen at a tilt is a closed spline, a wavy edge an open one', () => {
    const tilted = circlePts(0, 0, 10).map(([x, y]) => [x, y * 0.5, 0]);
    const t = classifyCurve(flatten(FRONT, tilted).pts);
    expect(t).toMatchObject({ kind: 'spline', closed: true });
    if (t?.kind === 'spline') expect(t.pts.length).toBeLessThanOrEqual(32);
    const wave = Array.from({ length: 20 }, (_, i) => ({ x: i, y: Math.sin(i / 3) * 3 }));
    expect(classifyCurve(wave)).toMatchObject({ kind: 'spline', closed: false });
  });
  it('nothing for a point', () => {
    expect(classifyCurve([{ x: 1, y: 1 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe('flatten', () => {
  it('drops the normal component and reports how far off the plane', () => {
    const f = flatten(TOP_AT5, [[1, 2, 0], [1, 2, 5]]);
    expect(f.pts).toEqual([{ x: 1, y: 2 }, { x: 1, y: 2 }]);
    expect(f.off).toBe(5);
  });
  it('follows a rotated frame', () => {
    const f = flatten({ o: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1], z: [1, 0, 0] }, [[9, 3, 4]]);
    expect(f.pts[0]).toEqual({ x: 3, y: 4 });
  });
});

describe('projectEdges', () => {
  const rect = [
    edge('a', [[0, 0, 5], [40, 0, 5]], ['top', 's1']), edge('b', [[40, 0, 5], [40, 20, 5]], ['top', 's2']),
    edge('c', [[40, 20, 5], [0, 20, 5]], ['top', 's3']), edge('d', [[0, 20, 5], [0, 0, 5]], ['top', 's4']),
    edge('v', [[0, 0, 0], [0, 0, 5]], ['s4', 's1']), // square-on to the plane
  ];
  it('adds fixed points and construction + ext entities, sharing the corners', () => {
    const r = projectEdges(blankDraft(), TOP_AT5, rect);
    expect(r.added).toHaveLength(4);
    expect(r.skipped).toBe(1);
    expect(r.draft.points).toHaveLength(4);
    expect(r.draft.points.every((p) => p.fixed === true)).toBe(true);
    expect(r.draft.entities.every((e) => e.type === 'line' && e.construction === true && e.ext === true)).toBe(true);
    expect(r.draft.constraints).toEqual([]);
  });
  it('projecting again adds nothing and says so', () => {
    const once = projectEdges(blankDraft(), TOP_AT5, rect).draft;
    const again = projectEdges(once, TOP_AT5, rect);
    expect(again.added).toEqual([]);
    expect(again.existing).toBe(4);
    expect(again.draft.entities).toHaveLength(4);
  });
  it('a circle keeps its radius and gets a fixed centre', () => {
    const r = projectEdges(blankDraft(), TOP_AT5, [edge('h', circlePts(20, 10, 4, 5))]);
    const e = r.draft.entities[0];
    expect(e).toMatchObject({ type: 'circle', construction: true, ext: true });
    expect(Number(e.r)).toBeCloseTo(4, 6);
    expect(r.draft.points[0]).toMatchObject({ fixed: true });
    expect(r.draft.points[0].x).toBeCloseTo(20, 6);
  });
  it('does not mutate the draft', () => {
    const d = blankDraft(); const copy = JSON.stringify(d);
    projectEdges(d, TOP_AT5, rect);
    expect(JSON.stringify(d)).toBe(copy);
  });
  it('edgesFor takes edge keys and the boundary of named faces', () => {
    expect(edgesFor(rect, ['a']).map((e) => e.key)).toEqual(['a']);
    expect(edgesFor(rect, ['top']).map((e) => e.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(edgesFor(rect, ['s4']).map((e) => e.key)).toEqual(['d', 'v']);
    expect(edgesFor(rect, [])).toEqual([]);
  });
});

describe('project tool', () => {
  const edges = [edge('a', [[0, 0, 5], [40, 0, 5]], ['top', 's1']), edge('b', [[40, 0, 5], [40, 20, 5]], ['top', 's2'])];
  const env = (selection: string[] = []): ToolEnv => ({ body: { frame: TOP_AT5, edges }, tol: 1, selection });
  const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
  const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
  const step = (ev: ToolEvent, d: SketchDraft, e: ToolEnv | undefined) => projectTool.step({}, ev, d, DEFAULT_SETTINGS, e);

  it('finds the edge nearest the pointer within the tolerance', () => {
    expect(edgeNear(env(), { x: 20, y: 0.4 })?.key).toBe('a');
    expect(edgeNear(env(), { x: 20, y: 5 })).toBeNull();
  });
  it('hovering previews the projection; a click projects it; a second click says it is there', () => {
    const d = blankDraft();
    const mv = step(move(20, 0.3), d, env());
    expect(mv.preview).toEqual([{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }]);
    const c = step(click(20, 0.3), d, env());
    expect(c.draft.entities).toHaveLength(1);
    expect(step(click(20, 0.3), c.draft, env()).hint).toBe('app.sketch.hint.alreadyProjected');
  });
  it('a click away from every edge hints', () => {
    expect(step(click(20, 10), blankDraft(), env()).hint).toBe('app.sketch.hint.pickBodyEdge');
  });
  it('the pre-selection is previewed (so Enter reaches the tool) and Enter projects it', () => {
    const d = blankDraft();
    const mv = step(move(20, 10), d, env(['top']));
    expect(mv.preview.length).toBe(2);
    expect(mv.hint).toBe('app.sketch.hint.projectSelection');
    const e = step({ type: 'key', key: 'Enter' }, d, env(['top']));
    expect(e.draft.entities).toHaveLength(2);
    expect(e.preview).toEqual([]);
  });
  it('Enter with nothing selected hints; without a body the tool hints on a click', () => {
    expect(step({ type: 'key', key: 'Enter' }, blankDraft(), env()).hint).toBe('app.sketch.hint.nothingSelected');
    expect(step(click(0, 0), blankDraft(), undefined).hint).toBe('app.sketch.hint.noBody');
  });
  it('of two projections at the same spot (front and back edge) the one nearer the plane wins', () => {
    const e2 = [edge('far', [[0, 0, 0], [40, 0, 0]]), edge('near', [[0, 0, 5], [40, 0, 5]])];
    expect(edgeNear({ body: { frame: TOP_AT5, edges: e2 }, tol: 1 }, { x: 20, y: 0 } as Pt)?.key).toBe('near');
  });
});
