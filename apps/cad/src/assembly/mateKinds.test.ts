import { describe, expect, it } from 'vitest';
import { MATE_KINDS, draftOf, draftProblem, mateChanges, mateDropsField, mateFeature, mateKind, newDraft, offeredKinds } from './mateKinds';

describe('mate kind table', () => {
  it('offers the kinds the kernel solves and lists the announced ones as pending', () => {
    expect(offeredKinds().map((k) => k.id)).toEqual(['coincident', 'parallel', 'concentric', 'distance', 'angle', 'perpendicular', 'tangent', 'lock', 'symmetric', 'width', 'limits', 'hinge', 'slot', 'screw', 'gear', 'rackPinion']);
    for (const id of ['profileCenter', 'path', 'linearCoupler', 'cam', 'universalJoint']) expect(mateKind(id)?.pending).toBe(true);
    expect(new Set(MATE_KINDS.map((k) => k.id)).size).toBe(MATE_KINDS.length);
  });
  it('a distance draft needs two refs and a number, and builds the kernel feature', () => {
    const d = newDraft('distance');
    expect(draftProblem(d)).toBe('asm.mate.err.refs');
    d.refs = { a: 'F2.C0@F2.1', b: 'F2.C1@F1.1' }; d.params.distance = 5; d.flip = true; d.name = ' Seat ';
    expect(draftProblem(d)).toBeNull();
    expect(mateFeature(d)).toEqual({ type: 'mate', kind: 'distance', name: 'Seat', a: 'F2.C0@F2.1', b: 'F2.C1@F1.1', flip: true, distance: 5 });
    d.refs.b = d.refs.a;
    expect(draftProblem(d)).toBe('asm.mate.err.same');
    d.refs.b = 'x'; d.params.distance = NaN;
    expect(draftProblem(d)).toBe('asm.mate.err.value');
  });
  it('a pending kind cannot be applied; a kind with a third ref asks for it', () => {
    expect(draftProblem(newDraft('cam'))).toBe('asm.mate.err.pending');
    const s = newDraft('symmetric'); s.refs = { a: 'x', b: 'y' };
    expect(mateKind('symmetric')!.refs.map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(draftProblem(s)).toBe('asm.mate.err.refs');
    s.refs.c = 'z';
    expect(draftProblem(s)).toBeNull();
    expect(mateFeature(s)).toEqual({ type: 'mate', kind: 'symmetric', a: 'x', b: 'y', c: 'z' });
  });
  it('reads a feature back into a draft and lists only what changed', () => {
    const f = { type: 'mate', kind: 'distance', a: 'x', b: 'y', flip: false, distance: 2, name: 'M' };
    const d = draftOf(f);
    expect(d).toMatchObject({ kind: 'distance', refs: { a: 'x', b: 'y' }, params: { distance: 2 }, name: 'M' });
    expect(mateChanges(f, d)).toEqual([]);
    d.params.distance = 3; d.flip = true;
    expect(mateChanges(f, d)).toEqual([{ path: 'flip', value: true }, { path: 'distance', value: 3 }]);
  });
  it('builds the kernel field names per kind (degrees, a2 / b2, ratio, pitch, radius, min / max, of, dir, flip)', () => {
    const f = (kind: string, refs: Record<string, string>, set: (d: ReturnType<typeof newDraft>) => void = () => {}) => { const d = newDraft(kind); d.refs = refs; set(d); expect(draftProblem(d)).toBeNull(); return mateFeature(d); };
    expect(f('angle', { a: 'x', b: 'y' }, (d) => { d.params.angle = 30; d.flip = true; })).toEqual({ type: 'mate', kind: 'angle', a: 'x', b: 'y', flip: true, angle: 30 });
    expect(f('perpendicular', { a: 'x', b: 'y' })).toEqual({ type: 'mate', kind: 'perpendicular', a: 'x', b: 'y' });
    expect(f('width', { a: 'a', a2: 'a2', b: 'b', b2: 'b2' })).toEqual({ type: 'mate', kind: 'width', a: 'a', a2: 'a2', b: 'b', b2: 'b2' });
    // hinge: stops optional; slot: second wall optional
    expect(f('hinge', { a: 'x', b: 'y' })).toEqual({ type: 'mate', kind: 'hinge', a: 'x', b: 'y' });
    expect(f('hinge', { a: 'x', b: 'y', a2: 's', b2: 't' }, (d) => { d.params.distance = 1; })).toMatchObject({ a2: 's', b2: 't', distance: 1 });
    expect(f('slot', { a: 'p', b: 'w' })).toEqual({ type: 'mate', kind: 'slot', a: 'p', b: 'w', flip: false });
    // couplings: the Drive is left out until set
    expect(f('gear', { a: 'x', b: 'y' }, (d) => { d.params.ratio = 2; })).toEqual({ type: 'mate', kind: 'gear', a: 'x', b: 'y', flip: false, ratio: 2 });
    expect(f('gear', { a: 'x', b: 'y' }, (d) => { d.params.ratio = 2; d.params.angle = 40; })).toMatchObject({ ratio: 2, angle: 40 });
    expect(f('screw', { a: 'x', b: 'y' }, (d) => { d.params.pitch = 2; d.params.angle = 1080; })).toMatchObject({ pitch: 2, angle: 1080 });
    expect(f('rackPinion', { a: 'x', b: 'y' }, (d) => { d.params.radius = 8; })).toEqual({ type: 'mate', kind: 'rackPinion', a: 'x', b: 'y', flip: false, radius: 8 });
    expect(f('rackPinion', { a: 'x', b: 'y' }, (d) => { d.params.radius = 8; d.params.dirx = 1; d.params.diry = 0; d.params.dirz = 0; })).toMatchObject({ dir: [1, 0, 0] });
    expect(f('limits', { a: 'x', b: 'y' }, (d) => { d.params.min = 0; d.params.max = 15; })).toEqual({ type: 'mate', kind: 'limits', a: 'x', b: 'y', of: 'distance', min: 0, max: 15 });
    expect(f('limits', { a: 'x', b: 'y' }, (d) => { d.choice = 'angle'; d.params.min = -30; d.params.max = 90; })).toMatchObject({ of: 'angle', min: -30, max: 90 });
  });
  it('validates the values the kernel would reject', () => {
    const d = newDraft('gear'); d.refs = { a: 'x', b: 'y' };
    d.params.ratio = 0; expect(draftProblem(d)).toBe('asm.mate.err.ratio');
    const l = newDraft('limits'); l.refs = { a: 'x', b: 'y' }; l.params.min = 5; l.params.max = 1; expect(draftProblem(l)).toBe('asm.mate.err.range');
    const r = newDraft('rackPinion'); r.refs = { a: 'x', b: 'y' }; r.params.dirx = 1;
    expect(draftProblem(r)).toBe('asm.mate.err.vec');
    const h = newDraft('hinge'); h.refs = { a: 'x', b: 'x' }; expect(draftProblem(h)).toBe('asm.mate.err.same');
  });
  it('reads a kind with optional fields back, and a cleared optional field means the feature is replaced', () => {
    const f = { type: 'mate', kind: 'hinge', a: 'x', b: 'y', a2: 's', b2: 't' };
    const d = draftOf(f);
    expect(d.refs).toEqual({ a: 'x', b: 'y', a2: 's', b2: 't' });
    expect(mateDropsField(f, d)).toBe(false);
    delete d.refs.a2;
    expect(mateDropsField(f, d)).toBe(true);
    expect(draftOf({ kind: 'rackPinion', a: 'x', b: 'y', radius: 5, dir: [0, 1, 0] }).params).toMatchObject({ dirx: 0, diry: 1, dirz: 0, radius: 5 });
  });
});
