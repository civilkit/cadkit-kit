import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { dimensionTool, orientFromCursor, type DimensionState } from './dimension';
import { DEFAULT_SETTINGS, type SnapHit, type Tool, type ToolEnv, type ToolEvent, type ToolOutput } from './types';

const M = { shift: false, ctrl: false, alt: false };
const draft: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], entities: [], constraints: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 6 }] };
const run = <S,>(tool: Tool<S>, events: ToolEvent[], d = draft): ToolOutput<S> => {
  let out: ToolOutput<S> = { state: tool.start(), draft: d, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
};
const point = (id: string): ToolEvent => { const snap: SnapHit = { kind: 'point', at: { x: 0, y: 0 }, pointId: id }; return { type: 'click', at: snap.at, snap, mods: M }; };
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
const typed = (value: number): ToolEvent => ({ type: 'field', id: 'value', value, commit: true });

describe('orientFromCursor', () => {
  const u = { x: 0, y: 0 }, v = { x: 10, y: 6 };
  it('above or below the points\' box is horizontal, beside it vertical', () => {
    expect(orientFromCursor(u, v, { x: 5, y: 12 })).toBe('horizontal');
    expect(orientFromCursor(u, v, { x: 5, y: -3 })).toBe('horizontal');
    expect(orientFromCursor(u, v, { x: -4, y: 3 })).toBe('vertical');
    expect(orientFromCursor(u, v, { x: 14, y: 3 })).toBe('vertical');
  });
  it('inside the box, or off a corner, is aligned', () => {
    expect(orientFromCursor(u, v, { x: 5, y: 3 })).toBe('aligned');
    expect(orientFromCursor(u, v, { x: 14, y: 9 })).toBe('aligned');
  });
  it('does not depend on which point was picked first', () => {
    expect(orientFromCursor(v, u, { x: 5, y: 12 })).toBe('horizontal');
  });
});

describe('dimension between two points follows the pointer', () => {
  it('moving above the points makes the horizontal distance, beside them the vertical one', () => {
    let o = run(dimensionTool, [point('p1'), point('p2')]);
    expect(o.state.pending?.spec.type).toBe('distance');
    o = dimensionTool.step(o.state, move(5, 12), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec.type).toBe('hdist');
    expect(o.fields[0].value).toBe(10);
    o = dimensionTool.step(o.state, move(-4, 3), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec.type).toBe('vdist');
    expect(o.fields[0].value).toBe(6);
    o = dimensionTool.step(o.state, typed(8), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints).toMatchObject([{ type: 'vdist', refs: ['p1', 'p2'], value: 8 }]);
  });
  it('a typed value survives pointer moves that keep the orientation', () => {
    let o = run(dimensionTool, [point('p1'), point('p2'), move(5, 12)]);
    o = dimensionTool.step(o.state, { type: 'field', id: 'value', value: 7 }, o.draft, DEFAULT_SETTINGS);
    o = dimensionTool.step(o.state, move(6, 14), o.draft, DEFAULT_SETTINGS);
    expect(o.fields[0].value).toBe(7);
  });
  it('a pressed key wins over the pointer, until the tool is restarted', () => {
    let o = run(dimensionTool, [point('p1'), point('p2'), key('v'), move(5, 12)]);
    expect(o.state.pending?.spec.type).toBe('vdist');
    o = dimensionTool.step(o.state, key('a'), o.draft, DEFAULT_SETTINGS);
    o = dimensionTool.step(o.state, move(-4, 3), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec.type).toBe('distance');
  });
  it('a new dimension starts aligned again after an automatic choice', () => {
    let o = run(dimensionTool, [point('p1'), point('p2'), move(5, 12), typed(10)]);
    o = dimensionTool.step(o.state, point('p1'), o.draft, DEFAULT_SETTINGS);
    o = dimensionTool.step(o.state, point('p2'), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec.type).toBe('distance');
  });
});

describe('dimension of a circle against a line or point: the centre is what is measured', () => {
  const d: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], constraints: [],
    points: [{ id: 'a', x: -20, y: 20 }, { id: 'b', x: 20, y: 20 }, { id: 'c', x: -20, y: -20 }, { id: 'o', x: -16, y: 16 }],
    entities: [{ id: 'top', type: 'line', p1: 'a', p2: 'b' }, { id: 'side', type: 'line', p1: 'a', p2: 'c' }, { id: 'hole', type: 'circle', c: 'o', r: 2.5 }] };
  const ent = (id: string): ToolEvent => { const snap: SnapHit = { kind: 'oncurve', at: { x: 0, y: 0 }, entityId: id }; return { type: 'click', at: snap.at, snap, mods: M }; };
  it('circle then the top line: pldist of the centre, the measured offset', () => {
    const o = run(dimensionTool, [ent('hole'), ent('top')], d);
    expect(o.state.pending?.spec).toMatchObject({ type: 'pldist', refs: ['o', 'top'] });
    expect(o.fields[0].value).toBeCloseTo(4);
    const c = dimensionTool.step(o.state, typed(4), o.draft, DEFAULT_SETTINGS);
    expect(c.draft.constraints).toMatchObject([{ type: 'pldist', refs: ['o', 'top'], value: 4 }]);
  });
  it('the line first, then the circle, is the same dimension', () => {
    const o = run(dimensionTool, [ent('side'), ent('hole')], d);
    expect(o.state.pending?.spec).toMatchObject({ type: 'pldist', refs: ['o', 'side'] });
    expect(o.fields[0].value).toBeCloseTo(4);
  });
  it('the centre point then a line, and circle then a corner point (horizontal / vertical part by the pointer)', () => {
    expect(run(dimensionTool, [point('o'), ent('top')], d).state.pending?.spec.type).toBe('pldist');
    let o = run(dimensionTool, [ent('hole'), point('a')], d);
    expect(o.state.pending?.spec).toMatchObject({ type: 'distance', refs: ['o', 'a'] });
    o = dimensionTool.step(o.state, key('h'), o.draft, DEFAULT_SETTINGS);
    expect(o.state.pending?.spec).toMatchObject({ type: 'hdist', refs: ['o', 'a'] });
    expect(o.fields[0].value).toBeCloseTo(4);
  });
  it('clicking the second line before committing re-measures against it', () => {
    const o = run(dimensionTool, [ent('hole'), ent('top'), ent('side')], d);
    expect(o.state.pending?.spec).toMatchObject({ type: 'pldist', refs: ['o', 'side'] });
  });
  it('a lone circle is still its diameter', () => {
    expect(run(dimensionTool, [ent('hole')], d).state.pending?.spec.type).toBe('diameter');
  });
});

describe('dimension to a body edge', () => {
  const TOP = { o: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const circ = (cx: number, cy: number, r: number, n = 48) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), 5]);
  const edges = [
    { key: 'left', faces: ['top'], pts: [[0, 0, 5], [0, 40, 5]] },
    { key: 'post', faces: ['s1'], pts: [[60, 0, 0], [60, 0, 5]] },           // square-on to the plane
    { key: 'hole', faces: ['top'], pts: circ(30, 20, 6) },
  ];
  const env: ToolEnv = { body: { frame: TOP, edges }, tol: 1 };
  const d0: SketchDraft = { ...draft, points: [{ id: 'p1', x: 10, y: 8 }] };
  const clickAt = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
  const go = (events: ToolEvent[], d = d0, e: ToolEnv | null = env): ToolOutput<DimensionState> => {
    let out: ToolOutput<DimensionState> = { state: dimensionTool.start(), draft: d, preview: [], fields: [] };
    for (const ev of events) out = dimensionTool.step(out.state, ev, out.draft, DEFAULT_SETTINGS, e ?? undefined);
    return out;
  };
  const refs = (o: ToolOutput<DimensionState>) => o.draft.entities.filter((e) => e.ext);

  it('a point then an unprojected edge projects it once (fixed) and dimensions to it', () => {
    const o = go([point('p1'), clickAt(0, 20), typed(10)]);
    expect(refs(o)).toHaveLength(1);
    expect(refs(o)[0]).toMatchObject({ type: 'line', construction: true, ext: true });
    expect(o.draft.points.filter((p) => p.fixed)).toHaveLength(2);
    expect(o.draft.constraints).toMatchObject([{ type: 'pldist', value: 10 }]);
    expect(o.draft.constraints[0].refs).toContain('p1');
  });
  it('a second dimension to the same edge reuses the projected line', () => {
    const d2: SketchDraft = { ...d0, points: [...d0.points, { id: 'p9', x: 20, y: 30 }] };
    const first = go([point('p1'), clickAt(0, 20), typed(10)], d2);
    const second = go([point('p9'), clickAt(0, 33), typed(20)], first.draft);
    expect(refs(second)).toHaveLength(1);
    expect(second.draft.points.filter((p) => p.fixed)).toHaveLength(2);
    expect(second.draft.constraints).toHaveLength(2);
  });
  it('the edge may be the first pick', () => {
    const o = go([clickAt(0, 20), point('p1')]);
    expect(o.state.pending?.spec.type).toBe('pldist');
    expect(refs(o)).toHaveLength(1);
  });
  it('a circular edge projects as a circle and dimensions its centre distance to a point', () => {
    const o = go([point('p1'), clickAt(36, 20), typed(25)]);
    expect(refs(o)).toMatchObject([{ type: 'circle' }]);
    expect(Number(refs(o)[0].r)).toBeCloseTo(6, 6);
    expect(o.draft.constraints).toMatchObject([{ type: 'distance', value: 25 }]);
  });
  it('an edge on its own is measured like a projected one (a circle: its diameter)', () => {
    const o = go([clickAt(36, 20)]);
    expect(o.state.pending?.spec.type).toBe('diameter');
  });
  it('an edge square-on to the plane gets its own hint and changes nothing', () => {
    const o = go([point('p1'), clickAt(60, 0)]);
    expect(o.hint).toBe('app.sketch.hint.dimension.edgeSquareOn');
    expect(o.draft).toBe(d0);
  });
  it('empty space still says nothing is there, and without a body so does an edge position', () => {
    expect(go([clickAt(20, 20)]).hint).toBe('app.sketch.hint.pick.none');
    expect(go([clickAt(0, 20)], d0, null).hint).toBe('app.sketch.hint.pick.none');
  });
  it('sketch geometry under the pointer wins over a body edge', () => {
    const o = go([point('p1')]);
    expect(refs(o)).toHaveLength(0);
  });
});
