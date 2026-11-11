import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type Tool, type ToolEvent, type ToolOutput } from './types';
import { arcSlotTool } from './arcSlot';
import { sketchTools } from '../registry';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = empty()): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
const step = <S>(tool: Tool<S>, o: ToolOutput<S>, ev: ToolEvent) => tool.step(o.state, ev, o.draft, DEFAULT_SETTINGS);
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
const move = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods: M });
const commitField = (id: string, value: number): ToolEvent => ({ type: 'field', id, value, commit: true });
interface Arc { id: string; type: string; c: string; p1: string; p2: string }
const arcs = (d: SketchDraft) => d.entities as unknown as Arc[];
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;

// centre (0,0), start (12,16): R 20 at 53.13 degrees; end click at 180 degrees: sweep 126.87 degrees counter-clockwise; pointer 24 out: w 8
const ccw = () => run(arcSlotTool, [click(0, 0), click(12, 16), click(-20, 0), click(0, 24)]);

describe('arc slot tool', () => {
  it('is registered as a draw tool', () => {
    expect(sketchTools().find((t) => t.id === 'arc-slot')?.group).toBe('draw');
  });

  it('builds four arcs from seven shared points: a closed loop, caps centred on the centre arc', () => {
    const o = ccw();
    const d = o.draft;
    expect(d.points).toHaveLength(7);
    expect(d.entities.map((e) => e.type)).toEqual(['arc', 'arc', 'arc', 'arc']);
    const [outer, cap1, inner, cap0] = arcs(d);
    expect([outer.c, inner.c]).toEqual(['p1', 'p1']);                       // concentric: one shared centre point
    // closed: every end point is used by exactly two arcs
    const ends = arcs(d).flatMap((e) => [e.p1, e.p2]);
    for (const id of new Set(ends)) expect(ends.filter((x) => x === id)).toHaveLength(2);
    const R = (e: Arc, id: string) => Math.hypot(pt(d, id).x - pt(d, e.c).x, pt(d, id).y - pt(d, e.c).y);
    expect(R(outer, outer.p1)).toBeCloseTo(24, 9);
    expect(R(inner, inner.p1)).toBeCloseTo(16, 9);
    expect(R(cap0, cap0.p1)).toBeCloseTo(4, 9);
    expect(R(cap1, cap1.p1)).toBeCloseTo(4, 9);
    // the caps are centred on the centre arc (radius 20)
    expect(Math.hypot(pt(d, cap0.c).x, pt(d, cap0.c).y)).toBeCloseTo(20, 9);
    expect(Math.hypot(pt(d, cap1.c).x, pt(d, cap1.c).y)).toBeCloseTo(20, 9);
    expect(pt(d, cap1.c).x).toBeCloseTo(-20, 9);                           // the end is at 180 degrees
  });

  it('arcs run counter-clockwise about their centre; each cap bulges away from the slot', () => {
    const d = ccw().draft;
    const ang = (c: string, p: string) => Math.atan2(pt(d, p).y - pt(d, c).y, pt(d, p).x - pt(d, c).x);
    const ccwSweep = (a0: number, a1: number) => (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const [outer, cap1, inner, cap0] = arcs(d);
    expect(ccwSweep(ang('p1', outer.p1), ang('p1', outer.p2))).toBeCloseTo(2.2143, 3);
    expect(ccwSweep(ang('p1', inner.p1), ang('p1', inner.p2))).toBeCloseTo(2.2143, 3);
    expect(ccwSweep(ang(cap1.c, cap1.p1), ang(cap1.c, cap1.p2))).toBeCloseTo(Math.PI, 9);
    expect(ccwSweep(ang(cap0.c, cap0.p1), ang(cap0.c, cap0.p2))).toBeCloseTo(Math.PI, 9);
    // the end cap's midpoint lies beyond the centre arc's end (further round), the start cap's before its start
    const mid = (c: string, p1: string) => { const a = ang(c, p1) + Math.PI / 2; return { x: pt(d, c).x + 4 * Math.cos(a), y: pt(d, c).y + 4 * Math.sin(a) }; };
    const m1 = mid(cap1.c, cap1.p1), c1 = pt(d, cap1.c);
    expect(Math.atan2(m1.y, m1.x) - Math.atan2(c1.y, c1.x)).not.toBeCloseTo(0, 3);
    const endAngle = Math.atan2(c1.y, c1.x);
    const midAngle = (Math.atan2(m1.y, m1.x) + 2 * Math.PI) % (2 * Math.PI);
    expect(midAngle).toBeGreaterThan((endAngle + 2 * Math.PI) % (2 * Math.PI));
  });

  it('constraints: four tangent joins and nothing else for a free arc slot', () => {
    const c = ccw().draft.constraints;
    expect(c.map((k) => k.type)).toEqual(['tangent', 'tangent', 'tangent', 'tangent']);
    for (const k of c) expect(k.refs).toHaveLength(2);
    // each join point is the end of exactly the two arcs it joins
    const d = ccw().draft;
    for (const k of c) {
      const at = (k as { at?: string }).at!;
      const owners = arcs(d).filter((e) => e.p1 === at || e.p2 === at).map((e) => e.id).sort();
      expect([...k.refs!].sort()).toEqual(owners);
    }
  });

  it('a clockwise pointer draws the same shape the other way round', () => {
    const o = run(arcSlotTool, [click(0, 0), click(12, 16), move(20, 0), click(14, -14), click(0, 24)]);   // start 53.13 deg, end -45 deg: sweep -98.13 deg
    expect(o.draft.entities).toHaveLength(4);
    const cap = arcs(o.draft)[1];
    // the cap at the far end is centred on the START point (the clockwise end is the lower angle end of the arc)
    const [outer] = arcs(o.draft);
    const a = (id: string) => Math.atan2(pt(o.draft, id).y, pt(o.draft, id).x);
    expect(a(outer.p1)).toBeCloseTo(-Math.PI / 4, 6);
    expect(a(outer.p2)).toBeCloseTo(Math.atan2(16, 12), 6);
    expect(Math.hypot(pt(o.draft, cap.c!).x, pt(o.draft, cap.c!).y)).toBeCloseTo(20, 9);
  });

  it('a horizontal start inference constrains the centre and the start point', () => {
    const o = run(arcSlotTool, [click(0, 0), click(20, 0), click(0, 20), click(0, 24)]);
    expect(o.draft.constraints.map((k) => k.type)).toEqual(['tangent', 'tangent', 'tangent', 'tangent', 'horizontal']);
    expect(o.draft.constraints[4].refs).toEqual(['p1', 'p2']);
  });

  it('typed radius, sweep and width: radius and width become distance constraints, sweep and angle only place', () => {
    let o = run(arcSlotTool, [click(0, 0), move(5, 5)]);
    o = step(arcSlotTool, o, commitField('len', 30));
    o = step(arcSlotTool, o, commitField('ang', 0));
    expect(o.state.start).toBeDefined();
    expect(o.draft.entities).toHaveLength(0);
    o = step(arcSlotTool, o, move(0, 10));
    expect(o.fields.map((f) => f.id)).toEqual(['sweep']);
    o = step(arcSlotTool, o, commitField('sweep', 90));
    expect(o.state.sweep).toBeCloseTo(Math.PI / 2, 9);
    expect(o.fields.map((f) => f.id)).toEqual(['w']);
    o = step(arcSlotTool, o, commitField('w', 8));
    expect(o.draft.entities).toHaveLength(4);
    expect(pt(o.draft, 'p2')).toMatchObject({ x: 30, y: 0 });
    expect(o.draft.constraints.filter((k) => k.type === 'distance').map((k) => [k.refs, k.value])).toEqual([[['p1', 'p2'], 30], [['p4', 'p5'], 8]]);
  });

  it('refuses a degenerate, too wide or overlapping slot with a hint and draws nothing', () => {
    expect(run(arcSlotTool, [click(1, 1), click(1, 1)]).hint).toBe('app.sketch.hint.degenerate');
    const wide = run(arcSlotTool, [click(0, 0), click(12, 16), click(10, 20), click(0, 24)]);   // sweep 10 degrees, w 8: the two end caps would overlap
    expect(wide.draft.entities).toHaveLength(0);
    expect(wide.hint).toBe('app.sketch.hint.arcSlotWide');
    const tooWide = run(arcSlotTool, [click(0, 0), click(12, 16), click(-20, 0), click(0, 60)]);   // half width 20 = R: no inner arc
    expect(tooWide.draft.entities).toHaveLength(0);
    expect(tooWide.hint).toBe('app.sketch.hint.arcSlotWide');
  });

  it('Escape clears typed values, then starts over; the tool can draw a second slot', () => {
    let o = run(arcSlotTool, [click(0, 0), move(5, 5), { type: 'field', id: 'len', value: 9, commit: true }]);
    o = step(arcSlotTool, o, { type: 'key', key: 'Escape' });
    expect(o.state.locked).toEqual({});
    expect(o.state.c).toBeDefined();
    o = step(arcSlotTool, o, { type: 'key', key: 'Escape' });
    expect(o.state.c).toBeUndefined();
    const two = run(arcSlotTool, [click(0, 0), click(12, 16), click(-20, 0), click(0, 24), click(50, 50), click(62, 66), click(30, 50), click(50, 74)]);
    expect(two.draft.entities).toHaveLength(8);
  });
});
