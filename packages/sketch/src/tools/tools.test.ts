import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type Pt, type Tool, type ToolEvent, type ToolOutput } from './types';
import { absoluteAngle, lineTool, setRelativeAngle, turnAngle } from './line';
import { rectangleTool } from './rectangle';
import { centerRectangleTool } from './center-rectangle';
import { splineTool } from './spline';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });

/** Run a list of events through a tool, threading state and draft. */
function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = empty(), settings = DEFAULT_SETTINGS): ToolOutput<S> {
  let state = tool.start();
  let out: ToolOutput<S> = { state, draft, preview: [], fields: [] };
  for (const ev of events) { out = tool.step(out.state, ev, out.draft, settings); }
  return out;
}
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });

describe('line tool', () => {
  it('chains segments through shared points', () => {
    const o = run(lineTool, [click(0, 0), move(10, 5), click(10, 5), move(20, 20), click(20, 20)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 5], [20, 20]]);
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p1', 'p2'], ['p2', 'p3']]);
  });

  it('infers horizontal and vertical within two degrees and records the constraints', () => {
    const o = run(lineTool, [click(0, 0), move(10, 0.1), click(10, 0.1), move(10.05, 8), click(10.05, 8)]);
    const [p1, p2, p3] = o.draft.points;
    expect(p2.y).toBe(0);                 // snapped onto the horizontal
    expect(p2.x).toBeCloseTo(10, 9);      // keeping the pointer's x, not the longer diagonal
    expect(p3.x).toBeCloseTo(p2.x, 9);    // and the vertical
    expect(o.draft.constraints.map((c) => [c.type, c.refs])).toEqual([['horizontal', ['e1']], ['vertical', ['e2']]]);
    expect(p1.x).toBe(0);
  });

  it('shows a pending horizontal before the click, and none when auto constraints are off', () => {
    const on = run(lineTool, [click(0, 0), move(10, 0.1)]);
    expect(on.pending).toEqual(['horizontal']);
    const off = run(lineTool, [click(0, 0), move(10, 0.1)], empty(), { ...DEFAULT_SETTINGS, autoConstraints: false });
    expect(off.pending).toBeUndefined();
  });

  it('a committed length is a distance constraint and moves the end to exactly that length', () => {
    let o = run(lineTool, [click(0, 0), move(7, 1)]);
    o = lineTool.step(o.state, { type: 'field', id: 'len', value: 30, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.fields.find((f) => f.id === 'len')).toMatchObject({ value: 30, locked: true });
    o = lineTool.step(o.state, click(7, 1), o.draft, DEFAULT_SETTINGS);
    const [p1, p2] = o.draft.points;
    expect(Math.hypot(p2.x - p1.x, p2.y - p1.y)).toBeCloseTo(30, 9);
    expect(o.draft.constraints.find((c) => c.type === 'distance')).toMatchObject({ refs: ['p1', 'p2'], value: 30 });
  });

  it('an uncommitted value only previews: no constraint is written', () => {
    let o = run(lineTool, [click(0, 0), move(7, 7)]);
    o = lineTool.step(o.state, { type: 'field', id: 'len', value: 12, commit: false }, o.draft, DEFAULT_SETTINGS);
    expect(o.preview[0]).toMatchObject({ kind: 'line' });
    const b = (o.preview[0] as { b: Pt }).b;
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(12, 9);
    o = lineTool.step(o.state, click(7, 7), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints.find((c) => c.type === 'distance')).toBeUndefined();
  });

  it('committing both length and angle places the segment at once, even with a stale pointer', () => {
    let o = run(lineTool, [click(0, 0), move(1, 1)]);
    o = lineTool.step(o.state, { type: 'field', id: 'len', value: 30, commit: true }, o.draft, DEFAULT_SETTINGS);
    o = lineTool.step(o.state, { type: 'field', id: 'ang', value: 45, commit: true }, o.draft, DEFAULT_SETTINGS);
    const p2 = o.draft.points[1];
    expect(p2.x).toBeCloseTo(30 * Math.cos(Math.PI / 4), 9);
    expect(p2.y).toBeCloseTo(30 * Math.sin(Math.PI / 4), 9);
  });

  it('closes the profile on the first point and ends the chain', () => {
    const o = run(lineTool, [click(0, 0), click(10, 0), click(10, 10),
      { type: 'move', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, pointId: 'p1' }, mods: M },
      { type: 'click', at: { x: 0, y: 0 }, snap: { kind: 'point', at: { x: 0, y: 0 }, pointId: 'p1' }, mods: M }]);
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p1', 'p2'], ['p2', 'p3'], ['p3', 'p1']]);
    expect(o.draft.points).toHaveLength(3);          // no duplicate point
    expect(o.state.last).toBeUndefined();            // chain ended
  });

  it('Escape clears typed values first, then ends the chain', () => {
    let o = run(lineTool, [click(0, 0), move(5, 5)]);
    o = lineTool.step(o.state, { type: 'field', id: 'len', value: 9, commit: true }, o.draft, DEFAULT_SETTINGS);
    o = lineTool.step(o.state, { type: 'key', key: 'Escape' }, o.draft, DEFAULT_SETTINGS);
    expect(o.state.last).toBe('p1');
    expect(o.state.locked).toEqual({});
    o = lineTool.step(o.state, { type: 'key', key: 'Escape' }, o.draft, DEFAULT_SETTINGS);
    expect(o.state.last).toBeUndefined();
    expect(o.draft.entities).toHaveLength(0);
  });

  it('a zero-length click adds nothing and says why', () => {
    const o = run(lineTool, [click(3, 3), click(3, 3)]);
    expect(o.draft.entities).toHaveLength(0);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
  });

  it('on-view values off returns no fields', () => {
    const o = run(lineTool, [click(0, 0), move(5, 5)], empty(), { ...DEFAULT_SETTINGS, onViewValues: 'off' });
    expect(o.fields).toEqual([]);
  });
});

describe('rectangle tool', () => {
  it('two clicks make four points, four lines and axis-aligned constraints', () => {
    const o = run(rectangleTool, [click(0, 0), move(10, 6), click(10, 6)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 6], [0, 6]]);
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p1', 'p2'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p1']]);
    expect(o.draft.constraints.map((c) => c.type)).toEqual(['horizontal', 'vertical', 'horizontal', 'vertical']);
  });

  it('works toward any corner direction', () => {
    const o = run(rectangleTool, [click(0, 0), click(-4, -3)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [-4, 0], [-4, -3], [0, -3]]);
  });

  it('typed width and height become distance constraints and finish the rectangle', () => {
    let o = run(rectangleTool, [click(0, 0), move(3, 2)]);
    o = rectangleTool.step(o.state, { type: 'field', id: 'w', value: 40, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.draft.points).toHaveLength(0);          // not yet placed
    o = rectangleTool.step(o.state, { type: 'field', id: 'h', value: 25, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [40, 0], [40, 25], [0, 25]]);
    const d = o.draft.constraints.filter((c) => c.type === 'distance');
    expect(d.map((c) => [c.refs, c.value])).toEqual([[['p1', 'p2'], 40], [['p2', 'p3'], 25]]);
  });

  it('reuses a snapped existing point as the first corner', () => {
    const base = run(lineTool, [click(5, 5), click(9, 5)]).draft;      // p1 (5,5), p2 (9,5)
    const o = run(rectangleTool, [
      { type: 'click', at: { x: 5, y: 5 }, snap: { kind: 'point', at: { x: 5, y: 5 }, pointId: 'p1' }, mods: M },
      click(15, 12)], base);
    expect(o.draft.points.filter((p) => p.x === 5 && p.y === 5)).toHaveLength(1);
    expect(o.draft.entities.some((e) => e.type === 'line' && e.p1 === 'p1' && e.p2 === 'p3')).toBe(true);
  });

  it('a flat rectangle is refused', () => {
    const o = run(rectangleTool, [click(0, 0), click(8, 0)]);
    expect(o.draft.entities).toHaveLength(0);
    expect(o.hint).toBe('app.sketch.hint.degenerate');
  });
});

describe('rectangle tool with Alt', () => {
  const alt: Modifiers = { shift: false, ctrl: false, alt: true };
  const aclick = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: alt });
  const amove = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: alt });
  it('Alt makes a square from the longer pointer offset, toward the pointer', () => {
    const o = run(rectangleTool, [click(0, 0), amove(10, -4), aclick(10, -4)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, -10], [0, -10]]);
  });
  it('the preview and the size fields show the square while Alt is held, and go back to the rectangle when it is released', () => {
    let o = run(rectangleTool, [click(0, 0), amove(3, 9)]);
    expect(o.fields.map((f) => f.value)).toEqual([9, 9]);
    o = rectangleTool.step(o.state, move(3, 9), o.draft, DEFAULT_SETTINGS);
    expect(o.fields.map((f) => f.value)).toEqual([3, 9]);
  });
  it('a typed side makes the other side follow', () => {
    let o = run(rectangleTool, [click(0, 0), amove(3, 9)]);
    o = rectangleTool.step(o.state, { type: 'field', id: 'w', value: 5, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.fields.map((f) => f.value)).toEqual([5, 5]);
  });
  it('without Alt the corners are free, as before', () => {
    const o = run(rectangleTool, [click(0, 0), click(10, 6)]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 6], [0, 6]]);
  });
});

describe('centre rectangle tool with Alt', () => {
  it('Alt makes a square about the centre', () => {
    const alt: Modifiers = { shift: false, ctrl: false, alt: true };
    const o = run(centerRectangleTool, [click(0, 0), { type: 'move', at: { x: 2, y: 5 }, mods: alt }, { type: 'click', at: { x: 2, y: 5 }, mods: alt }]);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0], [-5, -5], [5, -5], [5, 5], [-5, 5]]);
  });
});

const field = (id: string, value: number | null, commit = true): ToolEvent => ({ type: 'field', id, value, commit });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
/** A typed segment: len and ang locked (the second lock places it). */
const typed = (len: number, ang: number): ToolEvent[] => [move(1, 1), field('len', len), field('ang', ang)];

describe('line tool: typed first point and typed closing', () => {
  it('Tab before the first click shows X and Y; locking both places the first point exactly there', () => {
    let o = run(lineTool, [move(7.3, 4.1), key('Tab')]);
    expect(o.fields.map((f) => f.id)).toEqual(['x', 'y']);
    expect(o.hint).toBe('app.sketch.hint.lineTypeStart');
    o = lineTool.step(o.state, field('x', 0), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.points).toHaveLength(0);               // not yet: Y is still open
    expect(o.fields.find((f) => f.id === 'x')?.locked).toBe(true);
    o = lineTool.step(o.state, field('y', 0), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[0, 0]]);
    expect(o.state.first).toBe('p1');
    expect(o.state.start).toBeUndefined();
  });
  it('the first point lands on an existing point at those coordinates (no duplicate)', () => {
    const base = run(lineTool, [click(0, 0), key('Escape'), key('Escape')]);
    const o = run(lineTool, [key('Tab'), field('x', 0), field('y', 0)], { ...base.draft });
    expect(o.state.first).toBe(base.draft.points[0].id);
    expect(o.draft.points).toHaveLength(1);
  });
  it('a click with only X typed takes Y from the pointer; Escape drops the typing, not the tool', () => {
    let o = run(lineTool, [move(3, 9), key('Tab'), field('x', 5)]);
    o = lineTool.step(o.state, click(3, 9), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.points.map((p) => [p.x, p.y])).toEqual([[5, 9]]);
    const esc = run(lineTool, [key('Tab'), key('Escape')]);
    expect(esc.state.start).toBeUndefined();
    expect(esc.fields).toEqual([]);
  });
  it('a typed segment that ends exactly on the start closes the loop with the shared point and ends the chain', () => {
    const o = run(lineTool, [key('Tab'), field('x', 0), field('y', 0), ...typed(10, 0), ...typed(10, 90), ...typed(10, 180), ...typed(10, 270)]);
    expect(o.draft.points).toHaveLength(4);                       // no fifth point on top of the start
    expect(o.draft.entities.map((e) => [e.p1, e.p2])).toEqual([['p1', 'p2'], ['p2', 'p3'], ['p3', 'p4'], ['p4', 'p1']]);
    expect(o.state.last).toBeUndefined();                          // the chain ended
    expect(o.preview).toEqual([]);                                 // no rubber band from the start
    const esc = lineTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS);
    expect(esc.draft.entities).toHaveLength(4);
  });
  it('two typed segments back to the start do not close a 2-point sliver', () => {
    const o = run(lineTool, [click(0, 0), ...typed(10, 0), ...typed(10, 180)]);
    expect(o.state.last).toBeDefined();
    expect(o.draft.points).toHaveLength(3);
  });
  it('says what to do in the hint line', () => {
    expect(run(lineTool, [move(1, 1)]).hint).toBe('app.sketch.hint.lineStart');
    expect(run(lineTool, [click(0, 0), move(5, 5)]).hint).toBe('app.sketch.hint.lineNext');
  });
});

describe('spline tool: finishing', () => {
  it('Enter finishes, and so does a second click on the last point; the hint line says how', () => {
    const picked = run(splineTool, [click(0, 0), click(10, 5), click(20, 0)]);
    expect(picked.hint).toBe('app.sketch.hint.curveNext');
    expect(run(splineTool, [move(1, 1)]).hint).toBe('app.sketch.hint.curveStart');
    const enter = splineTool.step(picked.state, key('Enter'), picked.draft, DEFAULT_SETTINGS);
    expect(enter.draft.entities.map((e) => e.type)).toEqual(['spline']);
    const dbl = splineTool.step(picked.state, click(20, 0), picked.draft, DEFAULT_SETTINGS);
    expect(dbl.draft.entities.map((e) => e.type)).toEqual(['spline']);
  });
});

describe('line tool: relative (turn) angle', () => {
  it('the angle maths: a turn adds to the previous direction and wraps to -180..180', () => {
    expect(absoluteAngle(90, 90)).toBe(180);
    expect(absoluteAngle(170, 20)).toBe(-170);
    expect(absoluteAngle(0, -90)).toBe(-90);
    expect(turnAngle(90, 0)).toBe(-90);
    expect(turnAngle(-170, 170)).toBe(-20);
    expect(turnAngle(30, 30)).toBe(0);
  });
  it('is off by default (absolute); on, a typed 90 turns left from the previous segment, and the box shows the turn', () => {
    setRelativeAngle(false);
    try {
      let o = run(lineTool, [click(0, 0), ...typed(10, 0)]);                  // first segment along +x
      expect(o.fields.find((f) => f.id === 'ang')?.toggle).toMatchObject({ id: 'turn', on: false });
      // absolute: 90 is straight up
      const abs = run(lineTool, [click(0, 0), ...typed(10, 0), ...typed(5, 90)]);
      expect(abs.draft.points[2].x).toBeCloseTo(10); expect(abs.draft.points[2].y).toBeCloseTo(5);
      // relative: from a segment going UP, a turn of 90 goes LEFT (-x)
      o = lineTool.step(o.state, { type: 'field', id: 'turn', value: 1 }, o.draft, DEFAULT_SETTINGS);
      expect(o.fields.find((f) => f.id === 'ang')?.toggle?.on).toBe(true);
      const up = run(lineTool, [click(0, 0), ...typed(10, 90)]);
      let r = lineTool.step(up.state, { type: 'field', id: 'turn', value: 1 }, up.draft, DEFAULT_SETTINGS);
      r = lineTool.step(r.state, move(1, 1), r.draft, DEFAULT_SETTINGS);
      r = lineTool.step(r.state, field('len', 5), r.draft, DEFAULT_SETTINGS);
      r = lineTool.step(r.state, field('ang', 90), r.draft, DEFAULT_SETTINGS);
      expect(r.draft.points[2].x).toBeCloseTo(-5); expect(r.draft.points[2].y).toBeCloseTo(10);
      // straight on is a turn of 0, and the box shows the turn for a pointer-driven end too
      const s = lineTool.step(r.state, move(-5, 20), r.draft, DEFAULT_SETTINGS);
      expect(s.fields.find((f) => f.id === 'ang')?.value).toBeCloseTo(-90);      // the last segment went left (180), the pointer heads up (90): a right turn
    } finally { setRelativeAngle(false); }
  });
  it('the T key toggles it and drops a typed angle that the new mode would misread', () => {
    setRelativeAngle(false);
    try {
      const o = run(lineTool, [click(0, 0), ...typed(10, 0), move(3, 3), field('ang', 45)]);
      expect(o.state.locked.ang).toBe(45);
      const t = lineTool.step(o.state, key('t'), o.draft, DEFAULT_SETTINGS);
      expect(t.state.locked.ang).toBeUndefined();
      expect(t.fields.find((f) => f.id === 'ang')?.toggle?.on).toBe(true);
      const first = run(lineTool, [click(0, 0), move(3, 3)]);
      expect(first.fields.find((f) => f.id === 'ang')?.toggle).toBeUndefined();      // no previous segment: nothing to turn from
    } finally { setRelativeAngle(false); }
  });
});

describe('line tool: a typed angle becomes an angle dimension', () => {
  const angles = (o: ToolOutput<unknown>) => o.draft.constraints.filter((c) => c.type === 'angle');
  const first = (extra: ToolEvent[]) => run(lineTool, [click(0, 0), ...extra]);
  it('the interior angle between the new line and the previous one, as a driving angle constraint', () => {
    const o = first([...typed(10, 0), ...typed(10, 135)]);
    expect(angles(o)).toHaveLength(1);
    expect([...angles(o)[0].refs!].sort()).toEqual(['e1', 'e2']);
    expect(angles(o)[0].value).toBeCloseTo(45, 6);           // directions 180 (back along the first line) and 135 degrees
    // the first segment, typed 0, is horizontal; typed 90 on the second is a right angle between them: dimensioned (and drawn as a square corner)
    const sq = first([...typed(10, 0), ...typed(10, 90)]);
    expect(sq.draft.constraints.filter((c) => c.type === 'horizontal').map((c) => c.refs)).toEqual([['e1']]);
    expect(angles(sq)[0].value).toBeCloseTo(90, 6);
  });
  it('a right angle between lines that are not horizontal / vertical is kept as a dimension', () => {
    const o = first([...typed(10, 30), ...typed(10, 120)]);
    expect(angles(o)[0].value).toBeCloseTo(90, 6);
  });
  it('relative mode: a left turn of 90 is an interior angle of 90; a turn of 45 is 135', () => {
    setRelativeAngle(true);
    try {
      const o = first([...typed(10, 30), ...typed(10, 90)]);        // the first segment is absolute (nothing to turn from), the second turns 90 left
      expect(angles(o)[0].value).toBeCloseTo(90, 6);
      const p = first([...typed(10, 30), ...typed(10, -45)]);
      expect(angles(p)[0].value).toBeCloseTo(135, 6);
    } finally { setRelativeAngle(false); }
  });
  it('none for the first segment, for a clicked segment, with the setting off, or for the segment that closes the outline', () => {
    expect(angles(first(typed(10, 30)))).toEqual([]);
    expect(first(typed(10, 90)).draft.constraints.filter((c) => c.type === 'vertical')).toHaveLength(1);        // typed 90 as the first segment: vertical, no angle dimension
    expect(angles(first([...typed(10, 30), click(20, 20)]))).toEqual([]);
    const off = run(lineTool, [click(0, 0), ...typed(10, 30), ...typed(10, 120)], empty(), { ...DEFAULT_SETTINGS, typedAngleDims: false });
    expect(angles(off)).toEqual([]);
    // a triangle drawn by typing: the third (closing) segment ends on the start and gets no angle, with a hint
    const tri = first([...typed(10, 0), ...typed(10, 120), ...typed(10, 240)]);
    expect(tri.state.last).toBeUndefined();
    expect(angles(tri)).toHaveLength(1);
    expect(tri.hint).toBe('app.sketch.hint.angleSkipped');
  });
});
