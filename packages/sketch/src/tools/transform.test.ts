import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { rectDraft, resolves } from './edit-fixtures';
import { applyTransform, copyTool, moveTool, rotateTool, scaleTool, xformOf, type TransformState } from './transform';
import { DEFAULT_SETTINGS, type ToolEvent, type ToolOutput } from './types';

const ok = (r: ReturnType<typeof applyTransform>) => { if (!r.ok) throw new Error(r.hint); return r; };
const all4 = ['e1', 'e2', 'e3', 'e4'];
const mods = { shift: false, ctrl: false, alt: false };
const sized = (): SketchDraft => {
  const r = rectDraft(10, 5);
  return { ...r, constraints: [...r.constraints, { id: 'k5', type: 'distance', refs: ['p1', 'p2'], value: 10 }, { id: 'k6', type: 'hdist', refs: ['p1', 'p4'], value: 0 }] };
};
const pt = (d: SketchDraft, id: string) => d.points.find((p) => p.id === id)!;

describe('applyTransform in place', () => {
  it('moves every point of the picked entities and keeps the sketch resolvable', () => {
    const d = ok(applyTransform(rectDraft(10, 5), all4, { kind: 'move', dx: 3, dy: -2 })).draft;
    expect([pt(d, 'p1').x, pt(d, 'p1').y, pt(d, 'p3').x, pt(d, 'p3').y]).toEqual([3, -2, 13, 3]);
    expect(resolves(d)).toBe(true);
    expect(d.points).toHaveLength(4);
  });
  it('re-measures dimensions that mention what moved (hdist from the origin follows)', () => {
    const base: SketchDraft = { ...rectDraft(10, 5), points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...rectDraft(10, 5).points], constraints: [{ id: 'k9', type: 'hdist', refs: ['O', 'p2'], value: 10 }, { id: 'k10', type: 'fix', refs: ['p1'], value: [0, 0] }] };
    const d = ok(applyTransform(base, all4, { kind: 'move', dx: 4, dy: 0 })).draft;
    expect(d.constraints.find((c) => c.id === 'k9')!.value).toBeCloseTo(14, 9);
    expect(d.constraints.find((c) => c.id === 'k10')!.value).toEqual([4, 0]);
  });
  it('refuses to move a fixed point (the origin)', () => {
    const base: SketchDraft = { ...rectDraft(10, 5), points: rectDraft(10, 5).points.map((p) => (p.id === 'p1' ? { ...p, fixed: true } : p)) };
    expect(applyTransform(base, all4, { kind: 'move', dx: 1, dy: 1 })).toEqual({ ok: false, hint: 'app.sketch.hint.transformFixed' });
  });
  it('rotates about a centre, drops horizontal / vertical on turned lines, keeps lengths', () => {
    const d = ok(applyTransform(sized(), all4, { kind: 'rotate', center: { x: 0, y: 0 }, angleDeg: 30 })).draft;
    expect(Math.hypot(pt(d, 'p2').x, pt(d, 'p2').y)).toBeCloseTo(10, 9);
    expect(d.constraints.some((c) => c.type === 'horizontal' || c.type === 'vertical')).toBe(false);
    // ... the rectangle stays a rectangle: the turned sides keep their relations to each other
    expect(d.constraints.filter((c) => c.type === 'parallel').map((c) => c.refs)).toEqual([['e1', 'e3'], ['e2', 'e4']]);
    expect(d.constraints.filter((c) => c.type === 'perpendicular').map((c) => c.refs)).toEqual([['e1', 'e2']]);
    expect(d.constraints.find((c) => c.id === 'k5')!.value).toBeCloseTo(10, 9);
    expect(resolves(d)).toBe(true);
  });
  it('keeps horizontal / vertical for a quarter turn', () => {
    const d = ok(applyTransform(rectDraft(10, 5), all4, { kind: 'rotate', center: { x: 0, y: 0 }, angleDeg: 90 })).draft;
    expect(d.constraints.filter((c) => c.type === 'horizontal' || c.type === 'vertical')).toHaveLength(4);
    expect(d.constraints.find((c) => c.id === 'k1')!.type).toBe('vertical');   // the bottom edge is now a side
  });
  it('scales about a base point: circle radius, lengths and the dimensions that name them', () => {
    const d0: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'p1', x: 10, y: 0 }, { id: 'p2', x: 30, y: 0 }, { id: 'p3', x: 20, y: 20 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'circle', c: 'p3', r: 4 }],
      constraints: [{ id: 'k1', type: 'distance', refs: ['p1', 'p2'], value: 20 }, { id: 'k2', type: 'radius', refs: ['e2'], value: 4 }] };
    const d = ok(applyTransform(d0, ['e1', 'e2'], { kind: 'scale', base: { x: 0, y: 0 }, factor: 2 })).draft;
    expect(pt(d, 'p2').x).toBe(60);
    expect(d.entities.find((e) => e.id === 'e2')!.r).toBe(8);
    expect(d.constraints.find((c) => c.id === 'k1')!.value).toBeCloseTo(40, 9);
    expect(d.constraints.find((c) => c.id === 'k2')!.value).toBeCloseTo(8, 9);
  });
  it('turns an angle dimension with its sign convention intact when only one line turns', () => {
    const d0: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 0, y: 10 }],
      entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'a', p2: 'c' }],
      constraints: [{ id: 'k1', type: 'angle', refs: ['e1', 'e2'], value: 90 }] };
    const d = ok(applyTransform(d0, ['e2'], { kind: 'rotate', center: { x: 0, y: 0 }, angleDeg: -30 })).draft;
    expect(d.constraints[0].value).toBeCloseTo(60, 6);
  });
  it('refuses nothing-to-do and non-entities', () => {
    expect(applyTransform(rectDraft(10, 5), [], { kind: 'move', dx: 1, dy: 1 })).toMatchObject({ ok: false });
    expect(applyTransform(rectDraft(10, 5), all4, { kind: 'move', dx: 0, dy: 0 })).toMatchObject({ ok: false });
    expect(applyTransform(rectDraft(10, 5), all4, { kind: 'scale', base: { x: 0, y: 0 }, factor: 1 })).toMatchObject({ ok: false });
  });
});

describe('applyTransform as copies', () => {
  it('copies leave the originals, add fresh points and entities and copy the inside constraints', () => {
    const d0 = sized();
    const r = ok(applyTransform(d0, all4, { kind: 'move', dx: 20, dy: 0 }, 2));
    expect(r.draft.points).toHaveLength(12);
    expect(r.draft.entities).toHaveLength(12);
    expect(pt(r.draft, 'p1').x).toBe(0);
    expect(resolves(r.draft)).toBe(true);
    const count = (t: string) => r.draft.constraints.filter((c) => c.type === t).length;
    expect(count('horizontal')).toBe(6);
    expect(count('distance')).toBe(3);
    expect(r.draft.points.map((p) => p.x)).toContain(40);
  });
  it('a rotated copy has its dimensions measured on the copy and no fix', () => {
    const base: SketchDraft = { ...sized(), constraints: [...sized().constraints, { id: 'k7', type: 'fix', refs: ['p1'], value: [0, 0] }] };
    const r = ok(applyTransform(base, all4, { kind: 'rotate', center: { x: 0, y: 0 }, angleDeg: 45 }, 1));
    expect(r.draft.constraints.filter((c) => c.type === 'fix')).toHaveLength(1);
    const dist = r.draft.constraints.filter((c) => c.type === 'distance');
    expect(dist).toHaveLength(2);
    expect(dist[1].value).toBeCloseTo(10, 6);
  });
  it('a scaled copy has the radius scaled', () => {
    const d0: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: [{ id: 'p1', x: 5, y: 5 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 2 }], constraints: [{ id: 'k1', type: 'radius', refs: ['e1'], value: 2 }] };
    const r = ok(applyTransform(d0, ['e1'], { kind: 'scale', base: { x: 0, y: 0 }, factor: 3 }, 2));
    expect(r.draft.entities.map((e) => e.r)).toEqual([2, 6, 18]);
    expect(r.draft.constraints.map((c) => c.value)).toEqual([2, 6, 18]);
  });
  it('refuses a silly copy count', () => {
    expect(applyTransform(rectDraft(10, 5), all4, { kind: 'move', dx: 5, dy: 0 }, 150)).toMatchObject({ ok: false });
  });
});

describe('the transform tools', () => {
  type Out = ToolOutput<TransformState>;
  const run = (tool: typeof moveTool, d: SketchDraft, evs: ToolEvent[], env?: Parameters<typeof moveTool.step>[4]): Out => {
    let st = tool.start(); let out: Out = { state: st, draft: d, preview: [], fields: [] };
    for (const ev of evs) { out = tool.step(st, ev, out.draft, DEFAULT_SETTINGS, env); st = out.state; }
    return out;
  };
  const click = (x: number, y: number, entityId?: string): ToolEvent => ({ type: 'click', at: { x, y }, mods, ...(entityId ? { snap: { kind: 'oncurve', at: { x, y }, entityId } } : {}) });
  const mv = (x: number, y: number): ToolEvent => ({ type: 'move', at: { x, y }, mods });
  it('move: pick, Enter, base, pointer, click', () => {
    const o = run(moveTool, rectDraft(10, 5), [click(5, 0, 'e1'), click(10, 2.5, 'e2'), { type: 'key', key: 'Enter' }, click(0, 0), mv(7, 3), click(7, 3)]);
    expect(pt(o.draft, 'p1').x).toBe(7);
    expect(pt(o.draft, 'p1').y).toBe(3);
    expect(o.state.selected).toEqual([]);
  });
  it('move with preselected entities skips the pick', () => {
    const o = run(moveTool, rectDraft(10, 5), [mv(0, 0), click(0, 0), mv(4, 0), click(4, 0)], { entities: all4 });
    expect(pt(o.draft, 'p2').x).toBe(14);
  });
  it('typed dx and dy lock and apply with Enter', () => {
    const o = run(moveTool, rectDraft(10, 5), [mv(0, 0), click(0, 0), { type: 'field', id: 'dx', value: 6, commit: true }, { type: 'field', id: 'dy', value: 2, commit: true }, { type: 'key', key: 'Enter' }], { entities: all4 });
    expect([pt(o.draft, 'p1').x, pt(o.draft, 'p1').y]).toEqual([6, 2]);
  });
  it('copy: one copy by default, n sets the number', () => {
    const o = run(copyTool, rectDraft(10, 5), [mv(0, 0), click(0, 0), { type: 'field', id: 'n', value: 3 }, { type: 'field', id: 'dx', value: 15, commit: true }, { type: 'key', key: 'Enter' }], { entities: all4 });
    expect(o.draft.entities).toHaveLength(16);
  });
  it('rotate: the angle from the pointer, 0 copies turns the originals', () => {
    const o = run(rotateTool, rectDraft(10, 5), [mv(0, 0), click(0, 0), mv(0, 10), click(0, 10)], { entities: all4 });
    expect(pt(o.draft, 'p2').x).toBeCloseTo(0, 9);
    expect(pt(o.draft, 'p2').y).toBeCloseTo(10, 9);
    expect(o.draft.points).toHaveLength(4);
  });
  it('scale: the factor is the ratio of the pointer distances', () => {
    const o = run(scaleTool, rectDraft(10, 5), [mv(0, 0), click(0, 0), mv(5, 0), mv(10, 0), click(10, 0)], { entities: all4 });
    expect(pt(o.draft, 'p3').x).toBe(20);
  });
  it('xformOf snaps a near-axis move to the axis', () => {
    const s: TransformState = { phase: 'set', selected: [], n: 0, base: { x: 0, y: 0 }, ptr: { x: 10, y: 0.05 } };
    expect(xformOf('move', s, DEFAULT_SETTINGS)).toEqual({ kind: 'move', dx: 10, dy: 0 });
  });
  it('Escape steps back: set -> base -> select -> empty', () => {
    const o = run(moveTool, rectDraft(10, 5), [click(5, 0, 'e1'), { type: 'key', key: 'Enter' }, click(0, 0), { type: 'key', key: 'Escape' }]);
    expect(o.state.phase).toBe('base');
  });
});
