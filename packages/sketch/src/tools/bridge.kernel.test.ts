import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { bridgeTool } from './bridge';
import { lineTool } from './line';

const M = { shift: false, ctrl: false, alt: false };
const onPoint = (x: number, y: number, pointId: string): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, pointId }, mods: M });
const base = (points: Array<[string, number, number]>, entities: Array<Record<string, unknown>>): SketchDraft => ({
  id: 'F1', plane: { kind: 'std', id: 'front' }, points: points.map(([id, x, y]) => ({ id, x, y })),
  entities: entities.map((e, i) => ({ id: `e${i + 1}`, ...e })), constraints: [], temp: [],
});
function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function build(draft: SketchDraft, depth = 4) {
  const doc = { ...emptyPart('Drawn'), features: [toFeature(draft), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth, id: 'F2' }], seq: 3 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  return s.preview([], { sketchStatus: true });
}

const twoLines = () => base(
  [['p1', 0, 0], ['p2', 10, 0], ['p3', 30, 10], ['p4', 40, 10], ['p5', 40, -10], ['p6', 0, -10]],
  [{ type: 'line', p1: 'p1', p2: 'p2' }, { type: 'line', p1: 'p3', p2: 'p4' }]);
const closeLoop = (d: SketchDraft) => run(lineTool, [onPoint(40, 10, 'p4'), onPoint(40, -10, 'p5'), onPoint(0, -10, 'p6'), onPoint(0, 0, 'p1')], d);

describe('drawn bridge curves are valid for the real kernel', { skip: !process.env.CK_WASM }, () => {
  // The kernel returns the sketch exactly as drawn (it does not move points to satisfy constraints), and the
  // status residual is max |f| of the constraints at those coordinates. A residual near zero therefore proves
  // the analytic control points already satisfy the kernel's own g1/g2 equations.
  it('G1 between two lines: constraints hold at the drawn geometry and the profile extrudes', async () => {
    let o: { draft: SketchDraft } = run(bridgeTool, [onPoint(10, 0, 'p2'), onPoint(30, 10, 'p3')], twoLines());
    expect(o.draft.entities[2]).toMatchObject({ type: 'cvspline', degree: 3 });
    expect(o.draft.constraints.map((c) => [c.type, c.refs, c.at])).toEqual([['g1', ['e3', 'e1'], 'p2'], ['g1', ['e3', 'e2'], 'p3']]);
    o = closeLoop(o.draft);
    const r = await build(o.draft);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const st = r.body!.sketches[0].status!;
    expect(st.conflicts).toEqual([]);
    expect(st.solved).toBe(true);
    expect(st.residual).toBeLessThan(1e-9);
    expect(r.body!.box.min[0]).toBeCloseTo(0, 6);
    expect(r.body!.box.max[0]).toBeCloseTo(40, 6);
    expect(r.body!.box.min[1]).toBeCloseTo(-10, 6);
    expect(r.body!.box.max[1]).toBeCloseTo(10, 6);
  });

  it('G2 from a line to an arc: curvature continuity holds at the drawn geometry', async () => {
    const d0 = base(
      [['p1', 0, -6], ['p2', 10, -6], ['c', 30, 20], ['a1', 30, 0], ['a2', 50, 20], ['p6', 50, -20], ['p7', 0, -20]],
      [{ type: 'line', p1: 'p1', p2: 'p2' }, { type: 'arc', c: 'c', p1: 'a1', p2: 'a2' }]);
    let o: { draft: SketchDraft } = run(bridgeTool, [{ type: 'key', key: '2' }, onPoint(10, -6, 'p2'), onPoint(30, 0, 'a1')], d0);
    expect(o.draft.entities[2]).toMatchObject({ type: 'cvspline', degree: 5 });
    expect(o.draft.entities[2].pts as string[]).toHaveLength(6);
    expect(o.draft.constraints.map((c) => [c.type, c.refs, c.at])).toEqual([['g2', ['e3', 'e1'], 'p2'], ['g2', ['e3', 'e2'], 'a1']]);
    o = run(lineTool, [onPoint(50, 20, 'a2'), onPoint(50, -20, 'p6'), onPoint(0, -20, 'p7'), onPoint(0, -6, 'p1')], o.draft);
    const r = await build(o.draft);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const st = r.body!.sketches[0].status!;
    expect(st.conflicts).toEqual([]);
    expect(st.residual).toBeLessThan(1e-9);
    expect(r.body!.box.max[0]).toBeCloseTo(50, 6);
    expect(r.body!.box.max[1]).toBeCloseTo(20, 6);
    // g2 really checks curvature: nudging the third control point sideways keeps the tangent but breaks the residual
    const third = (o.draft.entities[2].pts as string[])[2];
    const bent = { ...o.draft, points: o.draft.points.map((p) => (p.id === third ? { ...p, y: p.y + 0.5 } : p)) };
    expect((await build(bent)).body!.sketches[0].status!.residual).toBeGreaterThan(1e-4);
  });

  it('the residual check is sensitive: a control point knocked off the tangent leaves a residual', async () => {
    const o = closeLoop(run(bridgeTool, [onPoint(10, 0, 'p2'), onPoint(30, 10, 'p3')], twoLines()).draft);
    const inner = (o.draft.entities[2].pts as string[])[1];
    const bad = { ...o.draft, points: o.draft.points.map((p) => (p.id === inner ? { ...p, y: p.y + 2 } : p)) };
    const st = (await build(bad)).body!.sketches[0].status!;
    expect(st.residual).toBeGreaterThan(1e-3);
  });

  it('G1 to an open fit spline end and to a control-point spline end', async () => {
    const d0 = base(
      [['p1', 0, 0], ['p2', 10, 6], ['p3', 20, 0], ['q1', 40, 10], ['q2', 50, 20], ['q3', 60, 20], ['q4', 70, 10], ['p9', 70, -10], ['p10', 0, -10]],
      [{ type: 'spline', pts: ['p1', 'p2', 'p3'] }, { type: 'cvspline', pts: ['q1', 'q2', 'q3', 'q4'], degree: 3 }]);
    let o: { draft: SketchDraft } = run(bridgeTool, [onPoint(20, 0, 'p3'), onPoint(40, 10, 'q1')], d0);
    o = run(lineTool, [onPoint(70, 10, 'q4'), onPoint(70, -10, 'p9'), onPoint(0, -10, 'p10'), onPoint(0, 0, 'p1')], o.draft);
    const r = await build(o.draft);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const st = r.body!.sketches[0].status!;
    expect(st.conflicts).toEqual([]);
    expect(st.residual).toBeLessThan(1e-9);
  });
});
