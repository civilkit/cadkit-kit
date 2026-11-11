import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { arcSlotTool } from './tools/arcSlot';
import { DEFAULT_SETTINGS, type Modifiers, type ToolEvent, type ToolOutput } from './tools/types';
import { arcSlotParams, findArcSlot, withArcSlotParams } from './arcSlotEdit';
import { entityDims, setEntityDim } from './select';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const empty = (): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [], entities: [], constraints: [], temp: [] });
const click = (x: number, y: number): ToolEvent => ({ type: 'click', at: { x, y }, mods: M });
function slot(clicks: Array<[number, number]>): SketchDraft {
  let out: ToolOutput<ReturnType<typeof arcSlotTool.start>> = { state: arcSlotTool.start(), draft: empty(), preview: [], fields: [] };
  for (const [x, y] of clicks) out = arcSlotTool.step(out.state, click(x, y), out.draft, DEFAULT_SETTINGS);
  return out.draft;
}
// centre (0,0), start (12,16): R 20 at 53.13 degrees; sweep to 180 degrees (126.87 counter-clockwise); pointer 24 out: width 8
const ccw = () => slot([[0, 0], [12, 16], [-20, 0], [0, 24]]);
const cw = () => slot([[0, 0], [20, 0], [0, -20], [0, -24]]);
const DEG = 180 / Math.PI;
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;

describe('finding an arc slot', () => {
  it('finds the slot from any of its four arcs, and nothing else', () => {
    const d = ccw();
    for (const e of d.entities) expect(findArcSlot(d, e.id)).toBeTruthy();
    expect(findArcSlot(d, 'nope')).toBeUndefined();
    // an arc on its own is no slot
    const lone: SketchDraft = { ...empty(), points: [{ id: 'c', x: 0, y: 0 }, { id: 'a', x: 5, y: 0 }, { id: 'b', x: 0, y: 5 }] as never, entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'a', p2: 'b' }] as never };
    expect(findArcSlot(lone, 'e1')).toBeUndefined();
  });
  it('reads the parameters it was drawn with', () => {
    const d = ccw();
    const p = arcSlotParams(d, findArcSlot(d, d.entities[0].id)!)!;
    expect(p.R).toBeCloseTo(20, 6);
    expect(p.w).toBeCloseTo(8, 6);
    expect(p.a0 * DEG).toBeCloseTo(53.1301, 3);
    expect(p.sweep * DEG).toBeCloseTo(126.8699, 3);
  });
  it('a clockwise slot reads as the same shape drawn from its far end', () => {
    const d = cw();
    const p = arcSlotParams(d, findArcSlot(d, d.entities[0].id)!)!;
    expect(p.R).toBeCloseTo(20, 6);
    expect(p.sweep * DEG).toBeCloseTo(90, 3);
    expect((((p.a0 * DEG) % 360) + 360) % 360).toBeCloseTo(270, 3);
  });
});

describe('editing an arc slot', () => {
  it('changes the radius, keeping the sweep, the width and the tangent shape', () => {
    const d = ccw();
    const s = findArcSlot(d, d.entities[0].id)!;
    const n = withArcSlotParams(d, s, { R: 30 })!;
    const p = arcSlotParams(n, s)!;
    expect(p.R).toBeCloseTo(30, 6);
    expect(p.w).toBeCloseTo(8, 6);
    expect(p.sweep * DEG).toBeCloseTo(126.8699, 3);
    expect(p.a0 * DEG).toBeCloseTo(53.1301, 3);
    // the points sit on the new radii: the outer arc at 34, the inner at 26
    expect(Math.hypot(pt(n, s.po0).x, pt(n, s.po0).y)).toBeCloseTo(34, 6);
    expect(Math.hypot(pt(n, s.pi1).x, pt(n, s.pi1).y)).toBeCloseTo(26, 6);
    // the centre did not move
    expect(pt(n, s.c)).toMatchObject({ x: 0, y: 0 });
  });
  it('changes the width, the sweep and the start angle', () => {
    const d = ccw();
    const s = findArcSlot(d, d.entities[2].id)!;
    const n = withArcSlotParams(d, s, { w: 12, sweep: 90 / DEG, a0: 10 / DEG })!;
    const p = arcSlotParams(n, s)!;
    expect(p.w).toBeCloseTo(12, 6);
    expect(p.sweep * DEG).toBeCloseTo(90, 6);
    expect(p.a0 * DEG).toBeCloseTo(10, 6);
    expect(p.R).toBeCloseTo(20, 6);
  });
  it('refuses parameters that do not make a slot', () => {
    const d = ccw();
    const s = findArcSlot(d, d.entities[0].id)!;
    expect(withArcSlotParams(d, s, { w: 50 })).toBeNull();     // wider than the radius allows
    expect(withArcSlotParams(d, s, { R: -1 })).toBeNull();
    expect(withArcSlotParams(d, s, { sweep: 0 })).toBeNull();
    expect(withArcSlotParams(d, s, { sweep: 7 })).toBeNull();  // more than a full turn
    expect(withArcSlotParams(d, s, { w: NaN })).toBeNull();
  });
  it('a typed radius and width keep their dimension and take the new value; the start-direction inference is dropped when the angle changes', () => {
    let d = ccw();
    const s = findArcSlot(d, d.entities[0].id)!;
    d = { ...d, constraints: [
      { id: 'k1', type: 'distance', refs: [s.c, s.m0], value: 20 },
      { id: 'k2', type: 'distance', refs: [s.pi0, s.po0], value: 8 },
      { id: 'k3', type: 'horizontal', refs: [s.c, s.m0] },
      { id: 'k4', type: 'perpendicular', refs: ['x', 'y'] },
    ] };
    const r = withArcSlotParams(d, s, { R: 25, w: 6 })!;
    expect(r.constraints.find((k) => k.id === 'k1')?.value).toBe(25);
    expect(r.constraints.find((k) => k.id === 'k2')?.value).toBe(6);
    expect(r.constraints.map((k) => k.id)).toContain('k3');                       // the angle did not change
    const a = withArcSlotParams(d, s, { a0: 0.2 })!;
    expect(a.constraints.map((k) => k.id)).not.toContain('k3');
    expect(a.constraints.map((k) => k.id)).toContain('k4');
  });
});

describe('the fields of a selected arc slot', () => {
  it('an arc of a slot offers radius, angle, sweep and width; an ordinary arc only its radius', () => {
    const d = ccw();
    const f = entityDims(d, d.entities[0].id);
    expect(f.map((x) => x.id)).toEqual(['slotR', 'slotA', 'slotSweep', 'slotW']);
    expect(f[0].value).toBeCloseTo(20, 6);
    expect(f[1].value).toBeCloseTo(53.1301, 3);
    expect(f[2].value).toBeCloseTo(126.8699, 3);
    expect(f[3].value).toBeCloseTo(8, 6);
    expect(f.every((x) => x.locked === false)).toBe(true);
    const lone: SketchDraft = { ...empty(), points: [{ id: 'c', x: 0, y: 0 }, { id: 'a', x: 5, y: 0 }, { id: 'b', x: 0, y: 5 }] as never, entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'a', p2: 'b' }] as never };
    expect(entityDims(lone, 'e1').map((x) => x.id)).toEqual(['radius']);
  });
  it('setEntityDim edits the slot from a field: degrees in, a slot out', () => {
    const d = ccw();
    const id = d.entities[0].id;
    const n = setEntityDim(d, id, 'slotSweep', 200)!;
    expect(entityDims(n, id)[2].value).toBeCloseTo(200, 6);
    expect(entityDims(setEntityDim(d, id, 'slotW', 10)!, id)[3].value).toBeCloseTo(10, 6);
    expect(entityDims(setEntityDim(d, id, 'slotA', 90)!, id)[1].value).toBeCloseTo(90, 6);
    expect(setEntityDim(d, id, 'slotW', 99)).toBeNull();
    expect(setEntityDim(d, 'nope', 'slotR', 5)).toBeNull();
  });
});
