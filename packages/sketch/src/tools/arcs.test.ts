import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type SnapHit, type Tool, type ToolEvent, type ToolOutput } from './types';
import { circleTool } from './circle';
import { centreArcTool } from './centreArc';
import { threePointArcTool } from './threePointArc';
import { tangentArcTool } from './tangentArc';
import { circumcircle } from './builders-arcs';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = empty(), settings = DEFAULT_SETTINGS): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, settings);
  return out;
}
const click = (x: number, y: number, pointId?: string): ToolEvent => ({ type: 'click', at: { x, y }, ...(pointId ? { snap: { kind: 'point', at: { x, y }, pointId } as SnapHit } : {}), mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const field = (id: string, value: number | null, commit = false): ToolEvent => ({ type: 'field', id, value, commit });
const esc: ToolEvent = { type: 'key', key: 'Escape' };
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;
const isFrozen = (d: SketchDraft) => JSON.stringify(d);

describe('circle tool', () => {
  it('centre then pointer radius makes one circle on a new centre point', () => {
    const o = run(circleTool, [click(2, 3), move(5, 7), click(5, 7)]);
    expect(o.draft.points).toEqual([{ id: 'p1', x: 2, y: 3 }]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'circle', c: 'p1', r: 5 }]);
    expect(o.draft.constraints).toEqual([]);
  });

  it('previews the circle and shows radius and diameter while dragging', () => {
    const o = run(circleTool, [click(0, 0), move(3, 4)]);
    expect(o.preview).toEqual([{ kind: 'circle', c: { x: 0, y: 0 }, r: 5 }]);
    expect(o.fields.map((f) => [f.id, f.value, f.locked])).toEqual([['radius', 5, false], ['diameter', 10, false]]);
    expect(o.draft.entities).toEqual([]);
  });

  it('reuses a snapped centre point', () => {
    const base = run(circleTool, [click(0, 0), click(1, 0)]).draft;
    const o = run(circleTool, [click(0, 0, 'p1'), click(0, 4)], base);
    expect(o.draft.points).toHaveLength(1);
    expect(o.draft.entities[1]).toMatchObject({ type: 'circle', c: 'p1', r: 4 });
  });

  it('a committed radius is a radius constraint and ends the shape at once', () => {
    let o = run(circleTool, [click(0, 0), move(3, 0)]);
    o = circleTool.step(o.state, field('radius', 12, true), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities[0]).toMatchObject({ type: 'circle', r: 12 });
    expect(o.draft.constraints).toEqual([{ id: 'k1', type: 'radius', refs: ['e1'], value: 12 }]);
    expect(o.state.centre).toBeUndefined();
  });

  it('a committed diameter writes a diameter constraint with the diameter as value and half as the radius', () => {
    let o = run(circleTool, [click(0, 0), move(3, 0)]);
    o = circleTool.step(o.state, field('diameter', 30, true), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities[0]).toMatchObject({ r: 15 });
    expect(o.draft.constraints[0]).toMatchObject({ type: 'diameter', refs: ['e1'], value: 30 });
  });

  it('an uncommitted value only previews, and a click then uses it without a constraint', () => {
    let o = run(circleTool, [click(0, 0), move(3, 0)]);
    o = circleTool.step(o.state, field('radius', 9), o.draft, DEFAULT_SETTINGS);
    expect(o.preview).toEqual([{ kind: 'circle', c: { x: 0, y: 0 }, r: 9 }]);
    expect(o.draft.entities).toEqual([]);
    o = circleTool.step(o.state, click(3, 0), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities[0]).toMatchObject({ r: 9 });
    expect(o.draft.constraints).toEqual([]);
  });

  it('refuses a zero radius with the degenerate hint and keeps the centre', () => {
    const o = run(circleTool, [click(4, 4), click(4, 4)]);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
    expect(o.draft.entities).toEqual([]);
    expect(o.state.centre).toBeDefined();
  });

  it('ignores a non-positive typed value and clears a field with null', () => {
    let o = run(circleTool, [click(0, 0), move(3, 0)]);
    o = circleTool.step(o.state, field('radius', 0, true), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.entities).toEqual([]);
    o = circleTool.step(o.state, field('radius', 5), o.draft, DEFAULT_SETTINGS);
    o = circleTool.step(o.state, field('radius', null), o.draft, DEFAULT_SETTINGS);
    expect(o.state.live).toBeUndefined();
  });

  it('Escape clears typed values first, then the centre', () => {
    let o = run(circleTool, [click(0, 0), move(3, 0), field('radius', 9)]);
    o = circleTool.step(o.state, esc, o.draft, DEFAULT_SETTINGS);
    expect(o.state.centre).toBeDefined();
    expect(o.state.live).toBeUndefined();
    o = circleTool.step(o.state, esc, o.draft, DEFAULT_SETTINGS);
    expect(o.state.centre).toBeUndefined();
  });

  it('returns no fields when on-view values are off, and never mutates the given draft', () => {
    const d = empty();
    const before = isFrozen(d);
    const o = run(circleTool, [click(0, 0), move(3, 0), click(3, 0)], d, { ...DEFAULT_SETTINGS, onViewValues: 'off' });
    expect(o.fields).toEqual([]);
    expect(isFrozen(d)).toBe(before);
  });
});

describe('centrepoint arc tool', () => {
  it('centre, start, end makes arc {c, p1, p2} counter-clockwise from start to end', () => {
    const o = run(centreArcTool, [click(0, 0), click(10, 0), move(0, 8), click(0, 8)]);
    expect(o.draft.points.map((p) => [p.id, p.x, p.y])).toEqual([['p1', 0, 0], ['p2', 10, 0], ['p3', 0, 10]]); // end projected onto the circle
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'arc', c: 'p1', p1: 'p2', p2: 'p3' }]);
  });

  it('previews a radial line, then the arc and the end ray', () => {
    let o = run(centreArcTool, [click(0, 0), move(10, 0)]);
    expect(o.preview).toEqual([{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }]);
    o = centreArcTool.step(o.state, click(10, 0), o.draft, DEFAULT_SETTINGS);
    o = centreArcTool.step(o.state, move(0, 5), o.draft, DEFAULT_SETTINGS);
    expect(o.preview.length).toBeGreaterThan(4);
    const arcEnds = o.preview.slice(1, -1) as Array<{ a: { x: number; y: number }; b: { x: number; y: number } }>;
    expect(arcEnds[0].a.x).toBeCloseTo(10, 9);
    expect(arcEnds[arcEnds.length - 1].b.y).toBeCloseTo(10, 9);
    expect(o.fields[0]).toMatchObject({ id: 'radius', value: 10 });
  });

  it('clockwise pointer motion within half a turn draws the small arc, end points swapped', () => {
    const o = run(centreArcTool, [click(0, 0), click(10, 0), move(0, -9), click(0, -9)]);
    const [, start, end] = o.draft.points;
    expect([end.x, end.y].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, -10]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'arc', c: 'p1', p1: end.id, p2: start.id }]); // ccw from the pointer end to the start: a quarter turn
  });

  it('a 15 degree clockwise sweep is a 15 degree arc, not the 345 degree remainder', () => {
    const a = (15 * Math.PI) / 180;
    const o = run(centreArcTool, [click(0, 0), click(0, 10), move(10 * Math.sin(a), 10 * Math.cos(a)), click(10 * Math.sin(a), 10 * Math.cos(a))]);
    const arc = o.draft.entities[0] as unknown as { p1: string; p2: string };
    expect(arc.p1).toBe('p3'); // starts at the pointer end, runs ccw 15 degrees to the first click
    expect(arc.p2).toBe('p2');
  });

  it('past half a turn clockwise the arc keeps following the pointer (no flip)', () => {
    const o = run(centreArcTool, [click(0, 0), click(10, 0), move(0, -10), move(-10, -1), move(-10, 1), move(-3, 10), click(-3, 10)]);
    // clockwise from (10,0) through the bottom and the left to just short of the top: stored ccw from the pointer end to the start
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'arc', c: 'p1', p1: 'p3', p2: 'p2' }]);
  });

  it('reuses snapped centre and start points, and the end only when it already lies on the circle', () => {
    const base = run(centreArcTool, [click(0, 0), click(10, 0), click(0, 10)]).draft; // p1 centre, p2 start, p3 end
    const o = run(centreArcTool, [click(0, 0, 'p1'), click(10, 0, 'p2'), click(-10, 0)], base);
    expect(o.draft.points).toHaveLength(4); // only the new end was added
    expect(o.draft.entities[1]).toMatchObject({ c: 'p1', p1: 'p2', p2: 'p4' });
    const on = run(centreArcTool, [click(0, 0, 'p1'), click(10, 0, 'p2'), click(0, 10, 'p3')], base);
    expect(on.draft.points).toHaveLength(3);
    expect(on.draft.entities[1]).toMatchObject({ c: 'p1', p1: 'p2', p2: 'p3' });
  });

  it('a typed radius pins the start at that distance in the pointer direction and adds a radius constraint', () => {
    let o = run(centreArcTool, [click(0, 0), move(0, 3), field('radius', 25, true)]);
    expect(o.state.start?.at).toEqual({ x: 0, y: 25 });
    o = centreArcTool.step(o.state, move(-1, 0.1), o.draft, DEFAULT_SETTINGS);
    o = centreArcTool.step(o.state, click(-1, 0.1), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints).toEqual([{ id: 'k1', type: 'radius', refs: ['e1'], value: 25 }]);
    expect(Math.hypot(pt(o.draft, 'p3').x, pt(o.draft, 'p3').y)).toBeCloseTo(25, 9);
  });

  it('refuses a zero radius and an end that falls on the start', () => {
    expect(run(centreArcTool, [click(1, 1), click(1, 1)]).hint).toBe('app.sketch.hint.degenerate');
    const o = run(centreArcTool, [click(0, 0), click(10, 0), click(20, 0)]);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
    expect(o.draft.entities).toEqual([]);
  });

  it('Escape clears the typed radius, then drops the shape', () => {
    let o = run(centreArcTool, [click(0, 0), move(5, 0), field('radius', 7, true)]);
    o = centreArcTool.step(o.state, esc, o.draft, DEFAULT_SETTINGS);
    expect(o.state.lockedR).toBeUndefined();
    expect(o.state.centre).toBeDefined();
    o = centreArcTool.step(o.state, esc, o.draft, DEFAULT_SETTINGS);
    expect(o.state.centre).toBeUndefined();
  });
});

describe('three-point arc tool', () => {
  it('finds the circumcentre', () => {
    const c = circumcircle({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 })!;
    expect(c.c.x).toBeCloseTo(0, 9); expect(c.c.y).toBeCloseTo(0, 9); expect(c.r).toBeCloseTo(10, 9);
  });

  it('a counter-clockwise run stores start as p1 and end as p2', () => {
    const o = run(threePointArcTool, [click(10, 0), click(0, 10), click(-10, 0)]);
    expect(o.draft.points.map((p) => [p.id, p.x, p.y])).toEqual([['p1', 10, 0], ['p2', -10, 0], ['p3', 0, 0]]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'arc', c: 'p3', p1: 'p1', p2: 'p2' }]);
  });

  it('a clockwise run swaps the ends so the stored arc still runs counter-clockwise', () => {
    const o = run(threePointArcTool, [click(-10, 0), click(0, 10), click(10, 0)]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'arc', c: 'p3', p1: 'p2', p2: 'p1' }]);
    expect(pt(o.draft, 'p2')).toMatchObject({ x: 10, y: 0 });
  });

  it('does not store the through point', () => {
    const o = run(threePointArcTool, [click(10, 0), click(0, 10), click(-10, 0)]);
    expect(o.draft.points.some((p) => p.x === 0 && p.y === 10)).toBe(false);
  });

  it('refuses collinear points with the collinear hint and keeps the first two clicks', () => {
    const o = run(threePointArcTool, [click(0, 0), click(5, 5), click(10, 10)]);
    expect(o.hint).toBe('app.sketch.hint.collinear');
    expect(o.draft.entities).toEqual([]);
    expect(o.state.through).toBeDefined();
  });

  it('previews a straight guide while the third point is collinear, with the hint', () => {
    const o = run(threePointArcTool, [click(0, 0), click(5, 5), move(10, 10)]);
    expect(o.hint).toBe('app.sketch.hint.collinear');
    expect(o.preview).toHaveLength(2);
  });

  it('refuses closing on the first point, and a through point on the start', () => {
    const o = run(threePointArcTool, [click(0, 0), click(5, 5), click(0, 0)]);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
    expect(o.draft.entities).toEqual([]);
    expect(run(threePointArcTool, [click(0, 0), click(0, 0)]).hint).toBe('app.sketch.hint.degenerate');
  });

  it('reuses snapped start and end points', () => {
    const base = run(threePointArcTool, [click(10, 0), click(0, 10), click(-10, 0)]).draft;
    const o = run(threePointArcTool, [click(10, 0, 'p1'), click(0, -10), click(-10, 0, 'p2')], base);
    expect(o.draft.points).toHaveLength(4); // only the second centre was added
    expect(o.draft.entities[1]).toMatchObject({ p1: 'p2', p2: 'p1' }); // clockwise through the bottom: ends swapped
  });

  it('previews the arc and shows its radius', () => {
    const o = run(threePointArcTool, [click(10, 0), click(0, 10), move(-10, 0)]);
    expect(o.fields[0]).toMatchObject({ id: 'radius' });
    expect(o.fields[0].value).toBeCloseTo(10, 9);
    expect(o.preview.length).toBeGreaterThan(8);
  });
});

describe('tangent arc tool', () => {
  const lineDraft = (): SketchDraft => ({
    ...empty(),
    points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
    entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }],
  });

  it('refuses a start that is not the end of a line or arc, with the start hint', () => {
    expect(run(tangentArcTool, [click(5, 5)], lineDraft()).hint).toBe('app.sketch.hint.tangentStart');
    expect(run(tangentArcTool, [click(5, 0)], lineDraft()).hint).toBe('app.sketch.hint.tangentStart');
    const junction: SketchDraft = { ...lineDraft(), points: [...lineDraft().points, { id: 'p3', x: 10, y: 5 }], entities: [...lineDraft().entities, { id: 'e2', type: 'line', p1: 'p2', p2: 'p3' }] };
    expect(run(tangentArcTool, [click(10, 0, 'p2')], junction).hint).toBe('app.sketch.hint.tangentStart');
  });

  it('turning left makes arc {c, p1: start, p2: end} and a tangent constraint with the shared point named', () => {
    const o = run(tangentArcTool, [click(10, 0, 'p2'), click(20, 10)], lineDraft());
    expect(pt(o.draft, 'p4').x).toBeCloseTo(10, 9); // centre on the normal through the start
    expect(pt(o.draft, 'p4').y).toBeCloseTo(10, 9);
    expect(o.draft.entities[1]).toEqual({ id: 'e2', type: 'arc', c: 'p4', p1: 'p2', p2: 'p3' });
    expect(o.draft.constraints).toEqual([{ id: 'k1', type: 'tangent', refs: ['e1', 'e2'], at: 'p2' }]);
  });

  it('turning right stores the ends swapped so the arc stays counter-clockwise', () => {
    const o = run(tangentArcTool, [click(10, 0, 'p2'), click(20, -10)], lineDraft());
    expect(pt(o.draft, 'p4').y).toBeCloseTo(-10, 9);
    expect(o.draft.entities[1]).toMatchObject({ c: 'p4', p1: 'p3', p2: 'p2' });
  });

  it('leaves a line from its far end: starting at p1 heads away from p2', () => {
    const o = run(tangentArcTool, [click(0, 0, 'p1'), click(-10, 10)], lineDraft());
    expect(pt(o.draft, 'p3')).toMatchObject({ x: -10, y: 10 });
    expect(pt(o.draft, 'p4').x).toBeCloseTo(0, 9);
    expect(pt(o.draft, 'p4').y).toBeCloseTo(10, 9);
  });

  it('an end straight along the tangent line is refused (aligned), and so is the start itself', () => {
    const o = run(tangentArcTool, [click(10, 0, 'p2'), click(30, 0)], lineDraft());
    expect(o.hint).toBe('app.sketch.hint.tangentAligned');
    expect(o.draft.entities).toHaveLength(1);
    expect(run(tangentArcTool, [click(10, 0, 'p2'), click(10, 0, 'p2')], lineDraft()).hint).toBe('app.sketch.hint.degenerate');
    const mv = run(tangentArcTool, [click(10, 0, 'p2'), move(30, 0)], lineDraft());
    expect(mv.hint).toBe('app.sketch.hint.tangentAligned');
  });

  it('previews the arc with a pending tangent and shows its radius', () => {
    const o = run(tangentArcTool, [click(10, 0, 'p2'), move(20, 10)], lineDraft());
    expect(o.pending).toEqual(['tangent']);
    expect(o.fields[0].value).toBeCloseTo(10, 9);
    expect(o.preview.length).toBeGreaterThan(4);
  });

  it('chains: the next arc is tangent to the previous arc at its end', () => {
    const o = run(tangentArcTool, [click(10, 0, 'p2'), click(20, 10), click(10, 20)], lineDraft());
    expect(o.draft.entities.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(o.draft.constraints[1]).toMatchObject({ type: 'tangent', refs: ['e2', 'e3'], at: 'p3' });
    const c = pt(o.draft, 'p6'); // second centre: (10,10) again, as the path is a semicircle
    expect(c.x).toBeCloseTo(10, 9); expect(c.y).toBeCloseTo(10, 9);
  });

  it('starts from an arc end, either end, heading away from the arc', () => {
    // arc centre (0,0) r 10, ccw from (10,0) [p2] to (0,10) [p3]; continue from p3: heads left (-x)
    const d: SketchDraft = {
      ...empty(),
      points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 0, y: 10 }],
      entities: [{ id: 'e1', type: 'arc', c: 'p1', p1: 'p2', p2: 'p3' }],
    };
    const fromEnd = run(tangentArcTool, [click(0, 10, 'p3'), click(-10, 20)], d);
    // heading -x from (0,10), turning right: the centre is straight above
    expect(pt(fromEnd.draft, 'p5').x).toBeCloseTo(0, 9);
    expect(pt(fromEnd.draft, 'p5').y).toBeCloseTo(20, 9);
    // from the p1 end the arc is left going down; turning left puts the centre to the right, a mirror circle
    const fromStart = run(tangentArcTool, [click(10, 0, 'p2'), click(20, -10)], d);
    expect(pt(fromStart.draft, 'p5').x).toBeCloseTo(20, 9);
    expect(pt(fromStart.draft, 'p5').y).toBeCloseTo(0, 9);
  });

  it('Escape ends the chain', () => {
    const o = run(tangentArcTool, [click(10, 0, 'p2'), esc], lineDraft());
    expect(o.state.from).toBeUndefined();
  });
});
