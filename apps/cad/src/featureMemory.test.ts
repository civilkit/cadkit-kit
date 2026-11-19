import { describe, it, expect, beforeEach } from 'vitest';
import './locales/en';
import { FeatureMemory, applyExtrudeMemory, memoryOp, pickMemory, describeRepeat, rememberedRadius, rememberedChamfer, rememberedThickness, whileRepeating, recallFor } from './featureMemory';

const store = () => { const m = new Map<string, string>(); return { m, api: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }; };
const cutThrough = { type: 'extrude', op: 'cut', sketch: 'F3', end: 'through', depth: null, flip: true };

describe('feature memory store', () => {
  let s: ReturnType<typeof store>; let mem: FeatureMemory;
  beforeEach(() => { s = store(); mem = new FeatureMemory(() => s.api); });
  it('keeps the options of the last accepted feature per type, and not the geometry (sketch, edges, faces)', () => {
    mem.remember(cutThrough);
    expect(mem.recall('extrude')).toEqual({ op: 'cut', end: 'through', flip: true, thin: null });
    expect(mem.recall('fillet')).toEqual({});
    mem.remember({ type: 'fillet', radius: 3, edges: [{ faces: ['a', 'b'], at: [0, 0, 0] }] });
    expect(mem.recall('fillet')).toEqual({ radius: 3 });
  });
  it('a blind depth is left out unless Remember depth is on or the last feature is being repeated', () => {
    mem.remember({ type: 'extrude', op: 'add', end: 'blind', depth: 17, sketch: 'F1' });
    expect(mem.recall('extrude').depth).toBeUndefined();
    expect(mem.recall('extrude', true).depth).toBe(17);
    mem.rememberDepth = true;
    expect(mem.recall('extrude').depth).toBe(17);
  });
  it('an end that names an object, and a new body, are not remembered', () => {
    expect(pickMemory({ type: 'extrude', op: 'newBody', end: 'toObject', depth: 5 })).toEqual({ flip: false, thin: null });
  });
  it('survives a reload (storage) and Reset to defaults clears one type', () => {
    mem.remember(cutThrough); mem.remember({ type: 'shell', thickness: 3, faces: ['f'] });
    const again = new FeatureMemory(() => s.api);
    expect(again.recall('extrude').end).toBe('through');
    expect(again.recall('shell')).toEqual({ thickness: 3 });
    again.reset('extrude');
    expect(new FeatureMemory(() => s.api).has('extrude')).toBe(false);
    expect(new FeatureMemory(() => s.api).has('shell')).toBe(true);
  });
  it('unreadable or missing storage starts empty', () => {
    s.m.set('cad.featureMemory', '{nope');
    expect(new FeatureMemory(() => s.api).recall('extrude')).toEqual({});
    expect(new FeatureMemory(() => null).recall('fillet')).toEqual({});
  });
});

describe('applying remembered values to a new feature draft', () => {
  const base = { type: 'extrude', op: 'add', sketch: 'F5', end: 'blind', depth: 10 };
  it('end condition: through all drops the depth; the remembered cut applies only when there is a body', () => {
    const mem = { op: 'cut', end: 'through', flip: true };
    const d = applyExtrudeMemory({ ...base, op: 'cut' }, mem);
    expect(d).toMatchObject({ op: 'cut', end: 'through', sketch: 'F5' });
    expect(d.depth).toBeUndefined();
    expect(memoryOp(mem, false, true, 'add')).toBe('cut');
    expect(memoryOp(mem, false, false, 'new' as never)).toBe('new');
    expect(memoryOp({ op: 'add' }, true, true, 'add')).toBe('cut');   // an explicit Cut command stays a cut
  });
  it('draft and thin wall carry over, draft only where the end allows it, a depth only when remembered', () => {
    const d = applyExtrudeMemory(base, { draft: 5, thin: { thickness: 2, side: 'inside' }, depth: 40 });
    expect(d).toMatchObject({ draft: 5, thin: { thickness: 2 }, depth: 40 });
    expect(applyExtrudeMemory(base, { end: 'mid', draft: 5 }).draft).toBeUndefined();
    expect(applyExtrudeMemory(base, {}).depth).toBe(10);
    expect(applyExtrudeMemory({ ...base, thin: { thickness: 1 } }, { thin: { thickness: 9 } }).thin).toEqual({ thickness: 1 });
  });
  it('fillet radius, chamfer distance and shell thickness start from the last accepted value', () => {
    const mem = new FeatureMemory(() => null);
    expect(rememberedRadius(1, mem)).toBe(1);
    mem.remember({ type: 'fillet', radius: 3 }); mem.remember({ type: 'chamfer', chamferType: 'distances', distance: 2, distance2: 4 }); mem.remember({ type: 'shell', thickness: 3 });
    expect(rememberedRadius(1, mem)).toBe(3);
    expect(rememberedChamfer(1, mem)).toEqual({ chamferType: 'distances', distance: 2, distance2: 4 });
    expect(rememberedThickness(1, mem)).toBe(3);
  });
  it('repeating carries the depth for the duration of the call only', () => {
    expect(recallFor('extrude', new FeatureMemory(() => null))).toEqual({});
    const mem = new FeatureMemory(() => null);
    mem.remember({ type: 'extrude', op: 'cut', end: 'blind', depth: 8 });
    expect(recallFor('extrude', mem).depth).toBeUndefined();
    expect(whileRepeating(() => recallFor('extrude', mem).depth)).toBe(8);
    expect(recallFor('extrude', mem).depth).toBeUndefined();
  });
  it('the Repeat tooltip names the feature and its options', () => {
    const mem = new FeatureMemory(() => null);
    expect(describeRepeat('fit', mem)).toBeUndefined();
    mem.remember(cutThrough);
    const tip = describeRepeat('add-cut', mem)!;
    expect(tip).toContain('Extruded cut');
    expect(tip).toContain('Through all');
    expect(tip).toContain('Flip');
  });
});
