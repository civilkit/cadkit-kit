import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type Tool, type ToolEvent, type ToolOutput } from './types';
import { centerRectangleTool } from './center-rectangle';
import { pointTool } from './point';
import { centerlineTool } from './centerline';
import { ellipseTool } from './ellipse';
import { polygonTool } from './polygon';
import { slotTool } from './slot';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = empty(), settings = DEFAULT_SETTINGS): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, settings);
  return out;
}
const step = <S>(tool: Tool<S>, o: ToolOutput<S>, ev: ToolEvent) => tool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const snapTo = (x: number, y: number, pointId: string) => ({ kind: 'point' as const, at: { x, y }, pointId });
const commitField = (id: string, value: number): ToolEvent => ({ type: 'field', id, value, commit: true });
const xy = (d: SketchDraft) => d.points.map((p) => [p.x, p.y]);

describe('centre rectangle tool', () => {
  it('centre then corner makes a symmetric axis-aligned rectangle', () => {
    const o = run(centerRectangleTool, [click(10, 10), move(14, 13), click(14, 13)]);
    expect(xy(o.draft)).toEqual([[10, 10], [6, 7], [14, 7], [14, 13], [6, 13]]);
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p2', 'p3'], ['p3', 'p4'], ['p4', 'p5'], ['p5', 'p2']]);
    expect(o.draft.constraints.map((c) => c.type)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
  });

  it('typed width and height are the full sizes and become distance constraints', () => {
    let o = run(centerRectangleTool, [click(0, 0), move(1, 1)]);
    o = step(centerRectangleTool, o, commitField('w', 40));
    expect(o.draft.points).toHaveLength(0);
    o = step(centerRectangleTool, o, commitField('h', 20));
    expect(xy(o.draft)).toEqual([[0, 0], [-20, -10], [20, -10], [20, 10], [-20, 10]]);
    expect(o.draft.constraints.filter((c) => c.type === 'distance').map((c) => [c.refs, c.value])).toEqual([[['p2', 'p3'], 40], [['p3', 'p4'], 20]]);
  });

  it('reuses a snapped centre point and refuses a flat rectangle', () => {
    const base = run(pointTool, [click(5, 5)]).draft;
    const o = run(centerRectangleTool, [{ type: 'click', at: { x: 5, y: 5 }, snap: snapTo(5, 5, 'p1'), mods: M }, click(8, 9)], base);
    expect(o.draft.points.filter((p) => p.x === 5 && p.y === 5)).toHaveLength(1);
    const flat = run(centerRectangleTool, [click(0, 0), click(6, 0)]);
    expect(flat.draft.entities).toHaveLength(0);
    expect(flat.hint).toBe('app.sketch.hint.degenerate');
  });

  it('Escape clears typed values first, then the centre', () => {
    let o = run(centerRectangleTool, [click(0, 0), move(3, 3)]);
    o = step(centerRectangleTool, o, commitField('w', 9));
    o = step(centerRectangleTool, o, { type: 'key', key: 'Escape' });
    expect(o.state.centre).toBeDefined();
    o = step(centerRectangleTool, o, { type: 'key', key: 'Escape' });
    expect(o.state.centre).toBeUndefined();
  });
});

describe('point tool', () => {
  it('each click adds a point and a point entity, and the tool stays active', () => {
    const o = run(pointTool, [click(1, 2), click(3, 4)]);
    expect(xy(o.draft)).toEqual([[1, 2], [3, 4]]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'point', p: 'p1' }, { id: 'e2', type: 'point', p: 'p2' }]);
  });

  it('a snapped existing point gets an entity without a duplicate point, once', () => {
    const base = centerlineTool.step(run(centerlineTool, [click(0, 0)]).state, click(10, 0), run(centerlineTool, [click(0, 0)]).draft, DEFAULT_SETTINGS).draft;
    const ev: ToolEvent = { type: 'click', at: { x: 10, y: 0 }, snap: snapTo(10, 0, 'p2'), mods: M };
    const o = run(pointTool, [ev, ev], base);
    expect(o.draft.points).toHaveLength(2);
    expect(o.draft.entities.filter((e) => e.type === 'point')).toHaveLength(1);
    expect(o.hint).toBe('app.sketch.hint.exists');
  });
});

describe('centreline tool', () => {
  it('two clicks make one construction line and the tool is ready again', () => {
    const o = run(centerlineTool, [click(0, 0), move(10, 5), click(10, 5)]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2', construction: true }]);
    expect(o.state.start).toBeUndefined();
  });

  it('infers horizontal and shows it pending', () => {
    const pre = run(centerlineTool, [click(0, 0), move(10, 0.1)]);
    expect(pre.pending).toEqual(['horizontal']);
    const o = step(centerlineTool, pre, click(10, 0.1));
    expect(o.draft.constraints.map((c) => [c.type, c.refs])).toEqual([['horizontal', ['e1']]]);
  });

  it('committed length is a distance constraint; committed length and angle place it at once', () => {
    let o = run(centerlineTool, [click(0, 0), move(1, 1)]);
    o = step(centerlineTool, o, commitField('len', 30));
    o = step(centerlineTool, o, commitField('ang', 90));
    expect(o.draft.points[1].x).toBeCloseTo(0, 9);
    expect(o.draft.points[1].y).toBeCloseTo(30, 9);
    expect(o.draft.constraints.find((c) => c.type === 'distance')).toMatchObject({ refs: ['p1', 'p2'], value: 30 });
  });

  it('a zero-length centreline is refused', () => {
    const o = run(centerlineTool, [click(3, 3), click(3, 3)]);
    expect(o.draft.entities).toHaveLength(0);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
  });
});

describe('ellipse tool', () => {
  it('centre, major axis end, minor radius make one ellipse entity', () => {
    const o = run(ellipseTool, [click(0, 0), click(10, 0), move(0, 4), click(0, 4)]);
    expect(xy(o.draft)).toEqual([[0, 0], [10, 0]]);
    expect(o.draft.entities).toEqual([{ id: 'e1', type: 'ellipse', c: 'p1', p: 'p2', r: 4 }]);
  });

  it('the minor radius is the perpendicular distance to a tilted major axis', () => {
    const o = run(ellipseTool, [click(0, 0), click(10, 10), click(-3, 3)]);
    expect((o.draft.entities[0].r as number)).toBeCloseTo(Math.hypot(3, 3), 9);
  });

  it('typed major length, angle and minor radius become constraints', () => {
    let o = run(ellipseTool, [click(0, 0), move(5, 1)]);
    o = step(ellipseTool, o, commitField('len', 12));
    o = step(ellipseTool, o, commitField('ang', 0));
    expect(o.state.axis).toBeDefined();
    o = step(ellipseTool, o, commitField('r', 5));
    expect(xy(o.draft)).toEqual([[0, 0], [12, 0]]);
    expect(o.draft.constraints.map((c) => [c.type, c.refs, c.value])).toEqual([['distance', ['p1', 'p2'], 12], ['radius', ['e1'], 5]]);
  });

  it('zero axis or zero minor radius is refused', () => {
    expect(run(ellipseTool, [click(2, 2), click(2, 2)]).hint).toBe('app.sketch.hint.degenerate');
    const o = run(ellipseTool, [click(0, 0), click(10, 0), click(5, 0)]);
    expect(o.draft.entities).toHaveLength(0);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
  });
});

describe('polygon tool', () => {
  it('a hexagon is six lines sharing six vertices, a vertex at the pointer', () => {
    const o = run(polygonTool, [click(0, 0), click(10, 0)]);
    expect(o.draft.points).toHaveLength(7);               // centre + 6
    expect(o.draft.entities).toHaveLength(6);
    expect(o.draft.points[1]).toMatchObject({ x: 10, y: 0 });
    for (const p of o.draft.points.slice(1)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 9);
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p2', 'p3'], ['p3', 'p4'], ['p4', 'p5'], ['p5', 'p6'], ['p6', 'p7'], ['p7', 'p2']]);
    expect(o.draft.constraints.filter((c) => c.type === 'equal').map((c) => c.refs)).toEqual([['e1', 'e2'], ['e2', 'e3'], ['e3', 'e4'], ['e4', 'e5'], ['e5', 'e6']]);
  });

  it('circumscribed puts an edge midpoint at the pointer: the apothem is the radius', () => {
    let o = run(polygonTool, [{ type: 'key', key: 'm' }, { type: 'key', key: '-' }, { type: 'key', key: '-' }]);   // 6 -> 4 sides, square
    o = step(polygonTool, o, click(0, 0));
    o = step(polygonTool, o, click(5, 0));
    const v = o.draft.points.slice(1);
    expect(v).toHaveLength(4);
    for (const p of v) { expect(Math.abs(p.x)).toBeCloseTo(5, 9); expect(Math.abs(p.y)).toBeCloseTo(5, 9); }
  });

  it('sides come from keys or a field, and persist after drawing and Escape', () => {
    let o = run(polygonTool, [{ type: 'field', id: 'sides', value: 3 }, click(0, 0), click(0, 10)]);
    expect(o.draft.entities).toHaveLength(3);
    expect(o.state.sides).toBe(3);
    o = step(polygonTool, o, { type: 'key', key: '+' });
    o = step(polygonTool, o, { type: 'key', key: 'Escape' });
    expect(o.state.sides).toBe(4);
  });

  it('fewer than three sides or a zero radius is refused with a hint', () => {
    const few = run(polygonTool, [{ type: 'field', id: 'sides', value: 2 }, click(0, 0), click(5, 0)]);
    expect(few.draft.entities).toHaveLength(0);
    expect(few.hint).toBe('app.sketch.hint.sides');
    const zero = run(polygonTool, [click(1, 1), click(1, 1)]);
    expect(zero.draft.entities).toHaveLength(0);
    expect(zero.hint).toBe('app.sketch.hint.degenerate');
  });

  it('a committed radius on an inscribed polygon is a distance from the centre to the first vertex', () => {
    let o = run(polygonTool, [click(0, 0), move(3, 0)]);
    o = step(polygonTool, o, commitField('r', 20));
    o = step(polygonTool, o, commitField('ang', 90));
    expect(o.draft.points[1].x).toBeCloseTo(0, 9);
    expect(o.draft.points[1].y).toBeCloseTo(20, 9);
    expect(o.draft.constraints.find((c) => c.type === 'distance')).toMatchObject({ refs: ['p1', 'p2'], value: 20 });
  });

  it('previews the reference circle and the edges, and none when on-view values are off for fields', () => {
    const o = run(polygonTool, [click(0, 0), move(8, 0)], empty(), { ...DEFAULT_SETTINGS, onViewValues: 'off' });
    expect(o.preview.filter((s) => s.kind === 'circle')).toHaveLength(1);
    expect(o.preview.filter((s) => s.kind === 'line')).toHaveLength(6);
    expect(o.fields).toEqual([]);
  });
});

describe('slot tool', () => {
  it('builds two lines and two arcs from six shared points; arcs run counter-clockwise', () => {
    const o = run(slotTool, [click(0, 0), click(20, 0), click(20, 4)]);
    expect(xy(o.draft)).toEqual([[0, 0], [20, 0], [0, 4], [0, -4], [20, 4], [20, -4]]);
    const e = o.draft.entities;
    expect(e.map((x) => x.type)).toEqual(['line', 'arc', 'line', 'arc']);
    expect(e[0]).toMatchObject({ p1: 'p3', p2: 'p5' });                     // top
    expect(e[1]).toMatchObject({ c: 'p2', p1: 'p6', p2: 'p5' });            // right cap: bottom -> top, bulging +x
    expect(e[2]).toMatchObject({ p1: 'p6', p2: 'p4' });                     // bottom
    expect(e[3]).toMatchObject({ c: 'p1', p1: 'p3', p2: 'p4' });            // left cap: top -> bottom, bulging -x
    expect(o.draft.constraints.map((c) => [c.type, c.refs])).toEqual([['horizontal', ['e1']], ['horizontal', ['e3']]]);
  });

  it('a tilted slot has the right width and no H/V constraint', () => {
    const o = run(slotTool, [click(0, 0), click(10, 10), click(-3, 3)]);
    const [, , a1, b1] = o.draft.points;
    expect(Math.hypot(a1.x - b1.x, a1.y - b1.y)).toBeCloseTo(2 * Math.hypot(3, 3), 9);
    expect(o.draft.constraints).toEqual([]);
  });

  it('typed length, angle and width become constraints', () => {
    let o = run(slotTool, [click(0, 0), move(5, 1)]);
    o = step(slotTool, o, commitField('len', 30));
    o = step(slotTool, o, commitField('ang', 0));
    expect(o.state.c2).toBeDefined();
    expect(o.draft.entities).toHaveLength(0);
    o = step(slotTool, o, commitField('w', 8));
    expect(o.draft.points[1]).toMatchObject({ x: 30, y: 0 });
    expect(o.draft.constraints.filter((c) => c.type === 'distance').map((c) => [c.refs, c.value])).toEqual([[['p1', 'p2'], 30], [['p3', 'p4'], 8]]);
  });

  it('zero length or zero width is refused with a hint', () => {
    expect(run(slotTool, [click(1, 1), click(1, 1)]).hint).toBe('app.sketch.hint.degenerate');
    const o = run(slotTool, [click(0, 0), click(10, 0), click(5, 0)]);
    expect(o.draft.entities).toHaveLength(0);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
  });
});

describe('polygon sides field', () => {
  it('offers a sides field before and after the centre, and typing a number changes the side count', () => {
    let o = run(polygonTool, [{ type: 'move', at: { x: 0, y: 0 }, mods: M } as ToolEvent]);
    expect(o.fields.map((f) => f.id)).toContain('sides');
    o = polygonTool.step(o.state, { type: 'field', id: 'sides', value: 8 } as ToolEvent, o.draft, DEFAULT_SETTINGS);
    expect((o.state as { sides: number }).sides).toBe(8);
    expect(o.fields.find((f) => f.id === 'sides')!.value).toBe(8);
  });
});
