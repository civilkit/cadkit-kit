import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Modifiers, type Pt, type Tool, type ToolEvent, type ToolOutput } from './types';
import { lineTool } from './line';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const move = (x: number, y: number, pointId?: string): ToolEvent => ({ type: 'move', at: { x, y }, mods: M, ...(pointId ? { snap: { kind: 'point' as const, at: { x, y }, pointId } } : {}) });
const click = (x: number, y: number, pointId?: string): ToolEvent => ({ type: 'click', at: { x, y }, mods: M, ...(pointId ? { snap: { kind: 'point' as const, at: { x, y }, pointId } } : {}) });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });

function run(events: ToolEvent[]): ToolOutput<ReturnType<typeof lineTool.start>> {
  let out: ToolOutput<ReturnType<typeof lineTool.start>> = { state: lineTool.start(), draft: empty(), preview: [], fields: [] };
  for (const ev of events) out = lineTool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}
const at = (p: Pt) => p;

describe('line tool: tangent arc mode', () => {
  it('offers the chain end as an anchor only once there is a segment to be tangent to', () => {
    expect(run([click(0, 0), move(5, 0)]).anchor).toBeUndefined();
    const o = run([click(0, 0), click(10, 0), move(12, 3)]);
    expect(at(o.anchor!)).toEqual({ x: 10, y: 0 });
    expect(o.mode).toBe('line');
  });

  it('m switches to a tangent arc; the next click places an arc tangent to the line and the chain continues', () => {
    const o = run([click(0, 0), click(10, 0), key('m'), move(10, 10), click(10, 10)]);
    expect(o.mode).toBe('arc');
    const arc = o.draft.entities.find((e) => e.type === 'arc')!;
    expect(arc).toBeDefined();
    expect(o.draft.constraints.some((c) => c.type === 'tangent' && (c.refs as string[]).includes(arc.id))).toBe(true);
    expect(o.state.last).toBeDefined();
    expect(at(o.anchor!)).toEqual({ x: 10, y: 10 });   // the chain goes on from the arc's end, still in arc mode
  });

  it('l or Escape returns to straight lines, keeping the chain; m toggles', () => {
    const arcMode = run([click(0, 0), click(10, 0), key('m')]);
    expect(arcMode.mode).toBe('arc');
    expect(run([click(0, 0), click(10, 0), key('m'), key('l')]).mode).toBe('line');
    const esc = run([click(0, 0), click(10, 0), key('m'), key('Escape')]);
    expect(esc.mode).toBe('line');
    expect(esc.state.last).toBeDefined();
    expect(run([click(0, 0), click(10, 0), key('m'), key('m')]).mode).toBe('line');
  });

  it('refuses to flip with nothing to be tangent to, and says why', () => {
    const o = run([click(0, 0), key('m')]);
    expect(o.mode).not.toBe('arc');
    expect(o.hint).toBe('app.sketch.hint.tangentStart');
  });

  it('a line after an arc continues from the arc end', () => {
    const o = run([click(0, 0), click(10, 0), key('m'), click(10, 10), key('l'), move(0, 10), click(0, 10)]);
    const lines = o.draft.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(2);
    const arc = o.draft.entities.find((e) => e.type === 'arc')!;
    expect(lines[1].p1 === arc.p1 || lines[1].p1 === arc.p2).toBe(true);
  });
});

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

describe('a D-shaped profile drawn with the arc flip is valid for the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('line, tangent arc, line, closing line extrudes to the right box with a clean solve', async () => {
    const o = run([
      click(0, 0), click(10, 0),              // bottom edge
      key('m'), click(10, 10),                // semicircle up the right side (tangent at the bottom edge's end)
      key('l'), click(0, 10),                 // top edge back
      move(0, 0, 'p1'), click(0, 0, 'p1'),    // close on the first point
    ]);
    expect(o.state.last).toBeUndefined();     // chain closed
    const doc = { ...emptyPart('D'), features: [toFeature(o.draft), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 4, id: 'F2' }], seq: 3 } as unknown as PartDoc;
    const s = await Session.open(doc);
    sessions.push(s);
    const r = await s.preview([], { solveSketches: true });
    expect(r.errors).toEqual([]);
    const box = r.body!.box;
    expect(box.max[0] - box.min[0]).toBeGreaterThan(14.9);   // the arc bulges out to x = 15
    expect(box.max[0] - box.min[0]).toBeLessThan(15.1);
    expect(box.max[1] - box.min[1]).toBeCloseTo(10, 1);
    expect(r.body!.sketches[0].status?.conflicts).toEqual([]);
  });
});
