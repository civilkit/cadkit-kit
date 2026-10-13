import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type ToolEvent, type ToolOutput } from './types';
import { bridgeShape, bridgeTool, endsAt, type BridgeState } from './bridge';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const onPoint = (type: 'move' | 'click', x: number, y: number, pointId?: string): ToolEvent =>
  ({ type, at: { x, y }, ...(pointId ? { snap: { kind: 'point' as const, at: { x, y }, pointId } } : {}), mods: M });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
const draft = (): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [
    { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 30, y: 10 }, { id: 'p4', x: 40, y: 10 },
    { id: 'p5', x: 10, y: 20 }, { id: 'p6', x: 10, y: 30 },
    { id: 'c', x: 0, y: 0 }, { id: 'a1', x: 5, y: 0 }, { id: 'a2', x: 0, y: 5 },
  ],
  entities: [
    { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' },
    { id: 'e3', type: 'line', p1: 'p2', p2: 'p5' },          // shares p2 with e1: p2 is a joint
    { id: 'e4', type: 'circle', c: 'p6', r: 3 },
  ],
  constraints: [], temp: [],
});
function run(events: ToolEvent[], d: SketchDraft = draft()): ToolOutput<BridgeState> {
  let out: ToolOutput<BridgeState> = { state: bridgeTool.start(), draft: d, preview: [], fields: [] };
  for (const ev of events) out = bridgeTool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}

describe('bridge tool', () => {
  it('two clicks on free ends write a cubic cvspline sharing both end ids, plus g1 at each end', () => {
    const o = run([onPoint('click', 40, 10, 'p4'), onPoint('click', 0, 0, 'p1')]);
    const bridge = o.draft.entities[o.draft.entities.length - 1];
    expect(bridge).toMatchObject({ type: 'cvspline', degree: 3 });
    const pts = bridge.pts as string[];
    expect(pts[0]).toBe('p4');
    expect(pts[pts.length - 1]).toBe('p1');
    expect(pts).toHaveLength(4);
    expect(o.draft.constraints.map((c) => [c.type, c.refs?.[1], c.at])).toEqual([['g1', 'e2', 'p4'], ['g1', 'e1', 'p1']]);
    expect(o.state.first).toBeUndefined();
  });

  it('places the inner control points on the end tangents, a third of the gap out', () => {
    const o = run([onPoint('click', 40, 10, 'p4'), onPoint('click', 0, 0, 'p1')]);
    const [, c1, c2] = (o.draft.entities[o.draft.entities.length - 1].pts as string[]).map((id) => o.draft.points.find((p) => p.id === id)!);
    const t = Math.hypot(40, 10) / 3;
    expect(c1.y).toBeCloseTo(10, 9);                  // the line e2 runs along +x from p3, so it leaves p4 along +x
    expect(c1.x).toBeCloseTo(40 + t, 9);
    expect(c2.y).toBeCloseTo(0, 9);                   // e1 runs along -x from p2 to p1, leaving p1 along -x
    expect(c2.x).toBeCloseTo(-t, 9);
  });

  it('degenerate: a click that is not on an end, or on a joint, or on a circle, is refused and nothing is written', () => {
    const none = run([onPoint('click', 5, 5)]);
    expect(none.hint).toBe('app.sketch.hint.bridgeNeedsEnd');
    expect(none.state.first).toBeUndefined();
    const joint = run([onPoint('click', 10, 0, 'p2')]);               // p2 is shared by e1 and e3
    expect(joint.hint).toBe('app.sketch.hint.bridgeNeedsEnd');
    const circle = run([onPoint('click', 10, 30, 'p6')]);
    expect(circle.hint).toBe('app.sketch.hint.bridgeNeedsEnd');
    const second = run([onPoint('click', 40, 10, 'p4'), onPoint('click', 10, 0, 'p2')]);
    expect(second.hint).toBe('app.sketch.hint.bridgeNeedsEnd');
    expect(second.state.first).toMatchObject({ pointId: 'p4' });      // the first pick survives a bad second click
    expect(second.draft.entities).toHaveLength(4);
  });

  it('degenerate: the same end twice, and ends at the same place, are refused', () => {
    const same = run([onPoint('click', 40, 10, 'p4'), onPoint('click', 40, 10, 'p4')]);
    expect(same.hint).toBe('app.sketch.hint.degenerate');
    expect(same.draft.entities).toHaveLength(4);
    const d = draft();
    d.points.push({ id: 'p7', x: 40, y: 10 });
    d.entities.push({ id: 'e5', type: 'line', p1: 'p7', p2: 'p6' });
    const stacked = run([onPoint('click', 40, 10, 'p4'), onPoint('click', 40, 10, 'p7')], d);
    expect(stacked.hint).toBe('app.sketch.hint.degenerate');
  });

  it('keys 1 and 2 switch continuity, G2 writes a six-point quintic and g2 constraints', () => {
    let o = run([key('2')]);
    expect(o.state.continuity).toBe(2);
    o = run([key('2'), onPoint('click', 40, 10, 'p4'), onPoint('click', 0, 0, 'p1')]);
    const bridge = o.draft.entities[o.draft.entities.length - 1];
    expect(bridge).toMatchObject({ type: 'cvspline', degree: 5 });
    expect(bridge.pts as string[]).toHaveLength(6);
    expect(o.draft.constraints.map((c) => c.type)).toEqual(['g2', 'g2']);
    expect(run([key('2'), key('1')]).state.continuity).toBe(1);
    expect(run([{ type: 'field', id: 'continuity', value: 2 }]).state.continuity).toBe(2);
  });

  it('G2 is refused with a hint when an end curvature is unknown (control-point spline end)', () => {
    const d = draft();
    d.points.push({ id: 'q1', x: 50, y: 0 }, { id: 'q2', x: 60, y: 5 }, { id: 'q3', x: 70, y: 0 });
    d.entities.push({ id: 'e6', type: 'cvspline', pts: ['q1', 'q2', 'q3'], degree: 2 });
    const o = run([key('2'), onPoint('click', 50, 0, 'q1'), onPoint('click', 40, 10, 'p4')], d);
    expect(o.hint).toBe('app.sketch.hint.bridgeCurvatureUnknown');
    expect(o.draft.entities).toHaveLength(5);
    const g1 = run([onPoint('click', 50, 0, 'q1'), onPoint('click', 40, 10, 'p4')], d);
    expect(g1.draft.entities).toHaveLength(6);
  });

  it('Escape drops the first pick; the preview is the real bridge curve once the pointer is over a second end', () => {
    expect(run([onPoint('click', 40, 10, 'p4'), key('Escape')]).state.first).toBeUndefined();
    const over = run([onPoint('click', 40, 10, 'p4'), onPoint('move', 0, 0, 'p1')]);
    expect(over.preview).toHaveLength(64);
    expect(over.pending).toEqual(['g1', 'g1']);
    const free = run([onPoint('click', 40, 10, 'p4'), onPoint('move', 20, 20)]);
    expect(free.preview).toEqual([{ kind: 'line', a: { x: 40, y: 10 }, b: { x: 20, y: 20 } }]);
    expect(run([onPoint('move', 1, 1)]).preview).toEqual([]);
  });

  it('end geometry: lines, arcs (counter-clockwise from p1 to p2) and fit splines', () => {
    const d = draft();
    const line = endsAt(d, 'p1')[0].geom!;
    expect(line.out).toEqual({ x: -1, y: 0 });
    expect(line.curvature).toBe(0);
    const arcEnd = endsAt({ ...d, entities: [...d.entities, { id: 'e7', type: 'arc', c: 'c', p1: 'a1', p2: 'a2' }] }, 'a2').find((e) => e.entity.id === 'e7')!.geom!;
    expect(arcEnd.out.x).toBeCloseTo(-1, 12);         // at the top of the circle, counter-clockwise runs to the left
    expect(arcEnd.curvature).toBeCloseTo(1 / 5, 12);
    const arcStart = endsAt({ ...d, entities: [...d.entities, { id: 'e7', type: 'arc', c: 'c', p1: 'a1', p2: 'a2' }] }, 'a1').find((e) => e.entity.id === 'e7')!.geom!;
    expect(arcStart.out.y).toBeCloseTo(-1, 12);       // before the start of a counter-clockwise sweep at (5,0) is downwards
    expect(arcStart.curvature).toBeCloseTo(-1 / 5, 12);
  });

  it('bridgeShape rejects coincident ends', () => {
    const g = { at: { x: 1, y: 1 }, out: { x: 1, y: 0 }, curvature: 0 };
    expect(bridgeShape(g, g, 1)).toEqual({ hint: 'app.sketch.hint.degenerate' });
  });

  it('does not mutate the draft it was given', () => {
    const d = draft();
    const before = JSON.stringify(d);
    run([onPoint('click', 40, 10, 'p4'), onPoint('click', 0, 0, 'p1')], d);
    expect(JSON.stringify(d)).toBe(before);
  });
});
