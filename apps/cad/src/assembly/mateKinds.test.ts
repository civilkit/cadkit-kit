import { describe, expect, it } from 'vitest';
import { MATE_KINDS, draftOf, draftProblem, mateChanges, mateFeature, mateKind, newDraft, offeredKinds } from './mateKinds';

describe('mate kind table', () => {
  it('offers the kinds the kernel solves and lists the announced ones as pending', () => {
    expect(offeredKinds().map((k) => k.id)).toEqual(['coincident', 'parallel', 'concentric', 'distance']);
    for (const id of ['hinge', 'slot', 'screw', 'gear', 'rackPinion', 'lock', 'tangent', 'symmetric', 'width', 'limits', 'angle']) expect(mateKind(id)?.pending).toBe(true);
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
    expect(draftProblem(newDraft('hinge'))).toBe('asm.mate.err.pending');
    const s = newDraft('symmetric'); s.refs = { a: 'x', b: 'y' };
    expect(mateKind('symmetric')!.refs.map((r) => r.key)).toEqual(['a', 'b', 'c']);
    expect(draftProblem({ ...s, kind: 'symmetric' })).toBe('asm.mate.err.pending');
  });
  it('reads a feature back into a draft and lists only what changed', () => {
    const f = { type: 'mate', kind: 'distance', a: 'x', b: 'y', flip: false, distance: 2, name: 'M' };
    const d = draftOf(f);
    expect(d).toMatchObject({ kind: 'distance', refs: { a: 'x', b: 'y' }, params: { distance: 2 }, name: 'M' });
    expect(mateChanges(f, d)).toEqual([]);
    d.params.distance = 3; d.flip = true;
    expect(mateChanges(f, d)).toEqual([{ path: 'flip', value: true }, { path: 'distance', value: 3 }]);
  });
});
