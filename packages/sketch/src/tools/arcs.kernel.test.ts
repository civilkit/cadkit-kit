import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type SnapHit, type Tool, type ToolEvent, type ToolOutput } from './types';
import { circleTool } from './circle';
import { centreArcTool } from './centreArc';
import { threePointArcTool } from './threePointArc';
import { tangentArcTool } from './tangentArc';
import { lineTool } from './line';

const M = { shift: false, ctrl: false, alt: false };
const click = (x: number, y: number, pointId?: string): ToolEvent => ({ type: 'click', at: { x, y }, ...(pointId ? { snap: { kind: 'point', at: { x, y }, pointId } as SnapHit } : {}), mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const draft0 = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });

function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = draft0()): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
const at = (d: SketchDraft, x: number, y: number) => {
  const p = d.points.find((q) => Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6);
  if (!p) throw new Error(`no point at ${x},${y}`);
  return p.id;
};
/** Straight lines between existing points, drawn with the line tool so they share the arc's end points. */
const lines = (d: SketchDraft, path: Array<[number, number]>) =>
  run(lineTool, path.flatMap(([x, y]) => [click(x, y, at(d, x, y))]), d).draft;

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function build(draft: SketchDraft, depth = 5) {
  const doc = { ...emptyPart('Drawn'), features: [toFeature(draft), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth, id: 'F2' }], seq: 3 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  return s.preview([], { sketchStatus: true });
}
/** Signed volume of the (non-indexed) triangle mesh. */
function volume(pos: Float32Array): number {
  let v = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [pos[i], pos[i + 1], pos[i + 2], pos[i + 3], pos[i + 4], pos[i + 5], pos[i + 6], pos[i + 7], pos[i + 8]];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(v);
}
async function solid(draft: SketchDraft, depth: number) {
  const r = await build(draft, depth);
  expect(r.errors).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.body!.sketches[0].status?.conflicts).toEqual([]);
  return { box: r.body!.box, vol: volume(r.body!.mesh.positions) };
}
const size = (b: { min: number[]; max: number[] }, i: number) => b.max[i] - b.min[i];

describe('drawn circles and arcs are valid for the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a circle with a typed radius extrudes to a cylinder of that radius', async () => {
    let o = run(circleTool, [click(0, 0), move(3, 0)]);
    o = circleTool.step(o.state, { type: 'field', id: 'radius', value: 7, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints).toMatchObject([{ type: 'radius', refs: ['e1'], value: 7 }]);
    const s = await solid(o.draft, 4);
    expect(size(s.box, 0)).toBeCloseTo(14, 1); // the box of a tessellated circle is a hair under the true size
    expect(size(s.box, 1)).toBeCloseTo(14, 1);
    expect(s.vol).toBeCloseTo(Math.PI * 49 * 4, -1);
  });

  it('a typed diameter is a diameter constraint whose value is the diameter', async () => {
    let o = run(circleTool, [click(0, 0), move(3, 0)]);
    o = circleTool.step(o.state, { type: 'field', id: 'diameter', value: 20, commit: true }, o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints).toMatchObject([{ type: 'diameter', refs: ['e1'], value: 20 }]);
    const s = await solid(o.draft, 2);
    expect(size(s.box, 0)).toBeCloseTo(20, 1);
  });

  it('a centrepoint arc runs counter-clockwise from start to end (a quarter disc, not three quarters)', async () => {
    const o = run(centreArcTool, [click(0, 0), click(10, 0), move(0, 10), click(0, 10)]);
    const d = lines(o.draft, [[0, 10], [0, 0], [10, 0]]);
    const s = await solid(d, 3);
    expect(s.box.min[0]).toBeCloseTo(0, 4); expect(s.box.max[0]).toBeCloseTo(10, 4);
    expect(s.box.min[1]).toBeCloseTo(0, 4); expect(s.box.max[1]).toBeCloseTo(10, 4);
    expect(s.vol).toBeCloseTo((Math.PI * 100 / 4) * 3, -1);
  });

  it('a typed arc radius is a radius constraint on the arc', async () => {
    let o = run(centreArcTool, [click(0, 0), move(4, 0)]);
    o = centreArcTool.step(o.state, { type: 'field', id: 'radius', value: 10, commit: true }, o.draft, DEFAULT_SETTINGS);
    o = centreArcTool.step(o.state, move(0, 3), o.draft, DEFAULT_SETTINGS);
    o = centreArcTool.step(o.state, click(0, 3), o.draft, DEFAULT_SETTINGS);
    expect(o.draft.constraints).toMatchObject([{ type: 'radius', refs: ['e1'], value: 10 }]);
    const d = lines(o.draft, [[0, 10], [0, 0], [10, 0]]);
    const s = await solid(d, 1);
    expect(size(s.box, 0)).toBeCloseTo(10, 4);
  });

  it.each([
    ['counter-clockwise (start right, through top, end left)', [[10, 0], [0, 10], [-10, 0]]],
    ['clockwise (start left, through top, end right)', [[-10, 0], [0, 10], [10, 0]]],
  ] as const)('a three-point arc drawn %s is the upper half disc', async (_n, [a, b, c]) => {
    const o = run(threePointArcTool, [click(a[0], a[1]), click(b[0], b[1]), click(c[0], c[1])]);
    const d = lines(o.draft, [[c[0], c[1]], [a[0], a[1]]]);
    const s = await solid(d, 2);
    expect(s.box.min[0]).toBeCloseTo(-10, 4); expect(s.box.max[0]).toBeCloseTo(10, 4);
    expect(s.box.min[1]).toBeCloseTo(0, 4); expect(s.box.max[1]).toBeCloseTo(10, 4);
    expect(s.vol).toBeCloseTo((Math.PI * 100 / 2) * 2, -1);
  });

  it('a tangent arc after a line bending left: the kernel accepts the tangent constraint and keeps the geometry', async () => {
    const l = run(lineTool, [click(0, 0), move(10, 0), click(10, 0)]);
    const o = run(tangentArcTool, [click(10, 0, 'p2'), move(20, 10), click(20, 10)], l.draft);
    expect(o.draft.constraints.find((c) => c.type === 'tangent')).toMatchObject({ refs: ['e1', 'e2'], at: 'p2' });
    let d = o.draft;
    d = run(lineTool, [click(20, 10, at(d, 20, 10)), click(0, 10), click(0, 0, 'p1')], d).draft;
    const s = await solid(d, 1);
    expect(s.box.min[0]).toBeCloseTo(0, 4); expect(s.box.max[0]).toBeCloseTo(20, 4);
    expect(s.box.min[1]).toBeCloseTo(0, 4); expect(s.box.max[1]).toBeCloseTo(10, 4);
    // the square 0..10 plus the quarter disc (centre (10,10), radius 10) that the arc bounds from below
    expect(s.vol).toBeCloseTo(100 + Math.PI * 100 / 4, -1);
  });

  it('the kernel really enforces the tangent refs: with a horizontal line, a vertical radius is implied (redundant)', async () => {
    const l = run(lineTool, [click(0, 0), move(10, 0), click(10, 0)]);
    const o = run(tangentArcTool, [click(10, 0, 'p2'), move(20, 10), click(20, 10)], l.draft);
    const closed = run(lineTool, [click(20, 10, at(o.draft, 20, 10)), click(0, 10), click(0, 0, 'p1')], o.draft).draft;
    const centre = o.draft.entities.find((e) => e.type === 'arc')!.c as string;
    const withRadial = (d: SketchDraft): SketchDraft => ({
      ...d,
      entities: [...d.entities, { id: 'e90', type: 'line', p1: centre, p2: 'p2', construction: true }],
      constraints: [...d.constraints, { id: 'k90', type: 'vertical', refs: ['e90'] }],
    });
    const withTangent = await build(withRadial(closed), 1);
    expect(withTangent.body!.sketches[0].status).toMatchObject({ state: 'over', redundant: ['k90'], conflicts: [] });
    // control: without the tangent constraint the same vertical is a real, independent constraint
    const noTangent = withRadial({ ...closed, constraints: closed.constraints.filter((c) => c.type !== 'tangent') });
    const control = await build(noTangent, 1);
    expect(control.body!.sketches[0].status).toMatchObject({ redundant: [], conflicts: [] });
  });

  it('a tangent arc bending right (end below the line) is also valid', async () => {
    const l = run(lineTool, [click(0, 0), move(10, 0), click(10, 0)]);
    const o = run(tangentArcTool, [click(10, 0, 'p2'), move(20, -10), click(20, -10)], l.draft);
    let d = o.draft;
    d = run(lineTool, [click(20, -10, at(d, 20, -10)), click(0, -10), click(0, 0, 'p1')], d).draft;
    const s = await solid(d, 1);
    expect(s.box.min[1]).toBeCloseTo(-10, 4); expect(s.box.max[1]).toBeCloseTo(0, 4);
    expect(s.box.max[0]).toBeCloseTo(20, 4);
  });

  it('a tangent arc continues from an arc end', async () => {
    const l = run(lineTool, [click(0, 0), move(10, 0), click(10, 0)]);
    let o = run(tangentArcTool, [click(10, 0, 'p2'), move(20, 10), click(20, 10)], l.draft);
    o = tangentArcTool.step(o.state, move(10, 20), o.draft, DEFAULT_SETTINGS);
    o = tangentArcTool.step(o.state, click(10, 20), o.draft, DEFAULT_SETTINGS);
    let d = o.draft;
    d = run(lineTool, [click(10, 20, at(d, 10, 20)), click(0, 20), click(0, 0, 'p1')], d).draft;
    const s = await solid(d, 1);
    expect(s.box.max[0]).toBeCloseTo(20, 4);
    expect(s.box.max[1]).toBeCloseTo(20, 4);
  });
});
