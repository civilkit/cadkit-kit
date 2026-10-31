import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, sketchOpenChains, sketchShapes, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { lineTool } from './line';
import { splineTool } from './spline';

const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const onPoint = (x: number, y: number, pointId: string): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, pointId, role: 'endpoint' }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const field = (id: string, value: number): ToolEvent => ({ type: 'field', id, value, commit: true });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
/** A typed segment, as the Line tool takes it: LEN then ANG locked (the second lock places it). */
const typed = (len: number, ang: number): ToolEvent[] => [move(1, 1), field('len', len), field('ang', ang)];
const deg = (r: number) => (r * 180) / Math.PI;

function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}

/** The outline of a bottle-like profile drawn the way the GUI does: typed-start line chain, a spline from the chain's end, then lines from the spline's end back to the start; the axis is a construction line. */
export function drawn(byId = true): SketchDraft {
  const empty: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [], temp: [] };
  // 1. (0,10) -> (30,10) -> (35,130) by typed segments
  const a = run(lineTool, [key('Tab'), field('x', 0), field('y', 10), ...typed(30, 0), ...typed(Math.hypot(5, 120), deg(Math.atan2(120, 5)))], empty);
  const chainEnd = a.state.last!;
  // 2. the spline starts on the chain's end, three more clicks, the last one clicked twice (double-click)
  const at = (x: number, y: number, id: string): ToolEvent => (byId ? onPoint(x, y, id) : click(x, y));
  const s = run(splineTool, [at(35, 130, chainEnd), click(35, 145), click(25, 160), click(15, 175)], a.draft);
  const last = s.state.pts[s.state.pts.length - 1];
  const done = splineTool.step(s.state, at(15, 175, last), s.draft, DEFAULT_SETTINGS);
  // 3. lines from the spline's end: typed to the axis, then a click on the first point of the outline
  const l = run(lineTool, [at(15, 175, last), ...typed(15, 180), at(0, 10, 'p1')], done.draft);
  // the axis: a construction line on x = 0
  const d = l.draft;
  const withAxis: SketchDraft = { ...d, points: [...d.points, { id: 'ax1', x: 0, y: -5 }, { id: 'ax2', x: 0, y: 190 }], entities: [...d.entities, { id: 'axis', type: 'line', p1: 'ax1', p2: 'ax2', construction: true }] };
  return withAxis;
}

describe('a line, spline, line outline (pure walk)', () => {
  it('also closes when the clicks only land on the same coordinates (grid snaps, no shared point ids)', () => {
    const d = drawn(false);
    const f = toFeature(d) as never;
    expect(d.points.length).toBeGreaterThan(drawn(true).points.length);
    expect(sketchOpenChains(f)).toEqual([]);
    expect(sketchShapes(f)).toHaveLength(1);
  });
  it('is one closed loop of all its curves, and no open chain', () => {
    const d = drawn();
    const f = toFeature(d) as never;
    const shapes = sketchShapes(f);
    expect(sketchOpenChains(f).map((c) => c.entityIds)).toEqual([]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].entityIds).toContain(d.entities.find((e) => e.type === 'spline')!.id);
    expect(shapes[0].entityIds).toHaveLength(d.entities.filter((e) => !e.construction).length);
  });
});

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('revolving it with the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a line, spline, line loop revolves about the sketch axis', async () => {
    const doc = { ...emptyPart('R'), features: [toFeature(drawn()), { type: 'revolve', id: 'F2', op: 'newBody', sketch: 'F1', axis: 'axis', angle: 360 }], seq: 3 } as unknown as PartDoc;
    const s = await Session.open(doc);
    sessions.push(s);
    const r = await s.preview([], { sketchStatus: true });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.body!.box.max[1]).toBeCloseTo(175, 1);
  });
  it('and so does the same outline whose joints are separate points at the same coordinates', async () => {
    const doc = { ...emptyPart('R'), features: [toFeature(drawn(false)), { type: 'revolve', id: 'F2', op: 'newBody', sketch: 'F1', axis: 'axis', angle: 360 }], seq: 3 } as unknown as PartDoc;
    const s = await Session.open(doc);
    sessions.push(s);
    const r = await s.preview([], { sketchStatus: true });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
});
