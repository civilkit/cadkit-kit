import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { toFeature, type SketchDraft } from '../index';
import { DEFAULT_SETTINGS, type Tool, type ToolEvent, type ToolOutput } from './types';
import { filletTool } from './fillet';
import { chamferTool } from './chamfer';
import { trimTool } from './trim';
import { mirrorTool } from './mirror';
import { rectDraft, resolves } from './edit-fixtures';

const M = { shift: false, ctrl: false, alt: false };
const clickOn = (entityId: string, x = 0, y = 0): ToolEvent => ({ type: 'click', at: { x, y }, snap: { kind: 'point', at: { x, y }, entityId }, mods: M });
const field = (id: string, value: number): ToolEvent => ({ type: 'field', id, value, commit: true });

function run<S>(tool: Tool<S>, draft: SketchDraft, events: ToolEvent[]): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
}

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function build(draft: SketchDraft, depth = 5) {
  const doc = { ...emptyPart('Edited'), features: [toFeature(draft), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth, id: 'F2' }], seq: 3 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  const r = await s.preview([], { sketchStatus: true });
  const facts = await s.facts();
  return { r, facts };
}
const size = (b: { min: number[]; max: number[] }) => [b.max[0] - b.min[0], b.max[1] - b.min[1]];

describe('edit tools produce sketches the real kernel accepts', { skip: !process.env.CK_WASM }, () => {
  it('fillet: all four corners of a rectangle, tangent arcs counter-clockwise, volume matches', async () => {
    // rectangle 40 x 25: e1 bottom, e2 right, e3 top, e4 left
    let o: ToolOutput<unknown> = { state: filletTool.start(), draft: rectDraft(40, 25), preview: [], fields: [] };
    const pairs = [['e1', 'e2'], ['e2', 'e3'], ['e3', 'e4'], ['e4', 'e1']];
    let d = o.draft;
    for (const [a, b] of pairs) {
      const x = run(filletTool, d, [field('r', 4), clickOn(a), clickOn(b)]);
      expect(x.hint).toBeUndefined();
      d = x.draft;
    }
    expect(resolves(d)).toBe(true);
    const { r, facts } = await build(d, 5);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const [w, h] = size(r.body!.box);
    expect(w).toBeCloseTo(40, 6); expect(h).toBeCloseTo(25, 6);
    expect(facts.volume!).toBeCloseTo(5 * (40 * 25 - 4 * (1 - Math.PI / 4) * 16), 4);
    const st = r.body!.sketches[0].status!;
    expect(st.conflicts).toEqual([]);
    expect(st.solved).toBe(true);
  });

  it('fillet by clicking the corner point', async () => {
    const d0 = rectDraft(30, 20);
    const x = run(filletTool, d0, [field('r', 6), { type: 'click', at: { x: 30, y: 0 }, snap: { kind: 'point', at: { x: 30, y: 0 }, pointId: 'p2' }, mods: M }]);
    const { r, facts } = await build(x.draft, 3);
    expect(r.ok).toBe(true);
    expect(facts.volume!).toBeCloseTo(3 * (600 - (1 - Math.PI / 4) * 36), 4);
    expect(r.body!.sketches[0].status!.conflicts).toEqual([]);
  });

  it('chamfer: two corners of a rectangle', async () => {
    let d = rectDraft(40, 25);
    d = run(chamferTool, d, [field('d', 5), clickOn('e1'), clickOn('e2')]).draft;
    d = run(chamferTool, d, [field('d', 8), clickOn('e3'), clickOn('e4')]).draft;
    expect(resolves(d)).toBe(true);
    const { r, facts } = await build(d, 2);
    expect(r.ok).toBe(true);
    const [w, h] = size(r.body!.box);
    expect(w).toBeCloseTo(40, 6); expect(h).toBeCloseTo(25, 6);
    expect(facts.volume!).toBeCloseTo(2 * (1000 - 12.5 - 32), 4);
    expect(r.body!.sketches[0].status!.conflicts).toEqual([]);
  });

  it('trim: a circle on an edge, trimmed line and circle, leaves a rectangle with a half-disc bump', async () => {
    let d = rectDraft(40, 20);
    // circle r=5 centred on the top edge at x=20
    d = { ...d, points: [...d.points, { id: 'p5', x: 20, y: 20 }], entities: [...d.entities, { id: 'e5', type: 'circle', c: 'p5', r: 5 }] };
    d = run(trimTool, d, [clickOn('e3', 20, 20)]).draft;      // top edge: the part inside the circle
    d = run(trimTool, d, [clickOn('e5', 20, 15)]).draft;      // circle: the half below the edge
    expect(resolves(d)).toBe(true);
    expect(d.entities.find((e) => e.id === 'e5')).toMatchObject({ type: 'arc' });
    const { r, facts } = await build(d, 4);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const [w, h] = size(r.body!.box);
    expect(w).toBeCloseTo(40, 6); expect(h).toBeCloseTo(25, 1); // the arc apex is tessellated
    expect(facts.volume!).toBeCloseTo(4 * (800 + Math.PI * 25 / 2), 3);
    expect(r.body!.sketches[0].status!.conflicts).toEqual([]);
  });

  it('trim: the overhang of a crossing line is removed', async () => {
    let d = rectDraft(40, 20);
    d = { ...d, points: [...d.points, { id: 'p5', x: 20, y: -6 }, { id: 'p6', x: 20, y: 26 }], entities: [...d.entities, { id: 'e5', type: 'line', p1: 'p5', p2: 'p6' }] };
    d = run(trimTool, d, [clickOn('e5', 20, 23), clickOn('e5', 20, -3)]).draft;
    expect(resolves(d)).toBe(true);
    const { r } = await build(d, 4);
    expect(r.ok).toBe(true);
    const [w, h] = size(r.body!.box);
    expect(w).toBeCloseTo(40, 6); expect(h).toBeCloseTo(20, 6);
    expect(r.body!.sketches[0].status!.conflicts).toEqual([]);
  });

  it('mirror: three sides of a rectangle across its fourth makes a rectangle twice as wide, with symmetric constraints', async () => {
    const d0 = rectDraft(10, 10);          // e4 is the left edge on x=0
    const x = run(mirrorTool, d0, [clickOn('e1'), clickOn('e2'), clickOn('e3'), { type: 'key', key: 'Enter' }, clickOn('e4')]);
    const d = x.draft;
    expect(d.constraints.some((c) => c.type === 'symmetric')).toBe(true);
    expect(resolves(d)).toBe(true);
    const { r, facts } = await build(d, 3);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    const [w, h] = size(r.body!.box);
    expect(w).toBeCloseTo(20, 6); expect(h).toBeCloseTo(10, 6);
    expect(facts.volume!).toBeCloseTo(3 * 200, 4);
    const st = r.body!.sketches[0].status!;
    expect(st.conflicts).toEqual([]);
    expect(st.solved).toBe(true);
  });

  it('mirror: an arc keeps counter-clockwise order, half disc + mirror = disc', async () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: -5, y: 0 }, { id: 'p2', x: 5, y: 0 }, { id: 'p3', x: 0, y: 0 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'arc', c: 'p3', p1: 'p2', p2: 'p1' }],
      constraints: [{ id: 'k1', type: 'horizontal', refs: ['e1'] }],
    };
    const d = run(mirrorTool, d0, [clickOn('e2'), { type: 'key', key: 'Enter' }, clickOn('e1')]).draft;
    expect(d.entities[2]).toMatchObject({ type: 'arc', c: 'p3', p1: 'p1', p2: 'p2' });
    const { r, facts } = await build(d, 2);
    expect(r.ok).toBe(true);
    expect(facts.volume!).toBeCloseTo(2 * Math.PI * 25, 3);
    expect(r.body!.sketches[0].status!.conflicts).toEqual([]);
  });
});
