import { describe, expect, it } from 'vitest';
import { diagnose, newBreakage, rawErrorText, refsOf, type DiagFeature } from './errorSummary';

const feats: DiagFeature[] = [
  { id: 'F1', type: 'sketch', name: 'Profile' },
  { id: 'F2', type: 'surfaceRevolve', sketch: 'F1' },
  { id: 'F3', type: 'loft', surface: true, sketches: ['F1'] },
  { id: 'F4', type: 'trimSurface', surface: 'F3', toolSurface: 'F2', name: 'Trim' },
  { id: 'F5', type: 'fill', edges: [{ faces: ['F3.S.e4'], at: [0, 0, 0] }] },
  { id: 'F6', type: 'extrude', op: 'cut', sketch: 'F1' },
  { id: 'F7', type: 'fillet', edges: [{ faces: ['F4.S.e1', 'F2.S.e8'] }] },
  { id: 'F8', type: 'hole', sketch: 'F1', on: 'F7.S.e1' },
];
const e = (id: string, code: string, params: Record<string, unknown> = {}) => ({ id, code, params });

describe('refsOf', () => {
  it('finds ids in plain fields, lists and face names, and ignores its own id and name', () => {
    expect([...refsOf(feats[3])].sort()).toEqual(['F2', 'F3']);
    expect([...refsOf(feats[4])]).toEqual(['F3']);
    expect([...refsOf({ id: 'F9', name: 'F1 copy', plane: { kind: 'feature', id: 'F3' } })]).toEqual(['F3']);
  });
});

describe('diagnose', () => {
  it('an empty error list has no roots', () => {
    const d = diagnose([], feats);
    expect(d.roots).toEqual([]); expect(d.consequences).toEqual([]);
  });
  it('the first failure is the root; later references to it and cut-nothing echoes are consequences', () => {
    const d = diagnose([e('F8', 'holeInvalid'), e('F6', 'nothingToCut'), e('F7', 'filletChamfer'), e('F4', 'trimNoIntersection')], feats);
    expect(d.roots.map((r) => r.id)).toEqual(['F4']);
    expect(d.consequences.map((c) => [c.id, c.via])).toEqual([['F6', 'code'], ['F7', 'ref'], ['F8', 'ref']]);
    expect(d.blockedBy).toEqual({ F6: 'F4', F7: 'F4', F8: 'F4' });
    expect(d.roots[0].blocks).toEqual(['F6', 'F7', 'F8']);
    expect(d.roots[0].label).toBe('Trim');
  });
  it('a failure that touches nothing broken and is not an echo stays a root', () => {
    const d = diagnose([e('F4', 'trimNoIntersection'), e('F8', 'holeInvalid')], [...feats.slice(0, 7), { id: 'F8', type: 'hole', sketch: 'F1' }]);
    expect(d.roots.map((r) => r.id)).toEqual(['F4', 'F8']);
  });
  it('a chain through a consequence traces back to the root', () => {
    const fs: DiagFeature[] = [{ id: 'F1', type: 'a' }, { id: 'F2', type: 'b', base: 'F1' }, { id: 'F3', type: 'c', base: 'F2' }];
    const d = diagnose([e('F1', 'x'), e('F2', 'y'), e('F3', 'z')], fs);
    expect(d.roots.map((r) => r.id)).toEqual(['F1']);
    expect(d.blockedBy).toEqual({ F2: 'F1', F3: 'F1' });
  });
  it('an echo code with no earlier failure is itself the root', () => {
    const d = diagnose([e('F6', 'nothingToCut')], feats);
    expect(d.roots.map((r) => r.id)).toEqual(['F6']);
  });
  it('an echo code is blocked by the latest root before it', () => {
    const fs: DiagFeature[] = [{ id: 'F1', type: 'a' }, { id: 'F2', type: 'b' }, { id: 'F3', type: 'cut' }];
    const d = diagnose([e('F1', 'x'), e('F2', 'filletChamfer'), e('F3', 'nothingToCut')], fs);
    expect(d.roots.map((r) => r.id)).toEqual(['F1', 'F2']);
    expect(d.blockedBy).toEqual({ F3: 'F2' });
  });
  it('errors arrive in any order; they are sorted by the document', () => {
    const d = diagnose([e('F7', 'missingEdge'), e('F4', 'trimNoIntersection')], feats);
    expect(d.all.map((x) => x.id)).toEqual(['F4', 'F7']);
  });
  it('an error on an unknown feature id is a root (nothing to trace)', () => {
    const d = diagnose([e('F4', 'trimNoIntersection'), e('part', 'badName')], feats);
    expect(d.roots.map((r) => r.id)).toEqual(['F4', 'part']);
  });
});

describe('newBreakage / rawErrorText', () => {
  it('only roots the committed model did not already have count as new', () => {
    const committed = diagnose([e('F4', 'trimNoIntersection')], feats);
    expect(newBreakage(diagnose([e('F4', 'trimNoIntersection')], feats), committed)).toEqual([]);
    expect(newBreakage(diagnose([e('F2', 'x')], feats), committed).map((r) => r.id)).toEqual(['F2']);
    expect(newBreakage(diagnose([e('F4', 'trimNoIntersection')], feats), null).length).toBe(1);
  });
  it('the raw text lists every error with its params', () => {
    const d = diagnose([e('F4', 'trimNoIntersection', { detail: 'x' })], feats);
    expect(rawErrorText(d)).toBe('F4: trimNoIntersection {"detail":"x"}');
  });
});

describe('a bearing seat that cuts nothing', () => {
  const seat = (plane: Record<string, unknown>): DiagFeature[] => [
    { id: 'F1', type: 'plane', mode: 'offset', base: { kind: 'face', id: 'F2.C1' } },
    { id: 'F2', type: 'sketch', plane },
    { id: 'F3', type: 'extrude', op: 'cut', sketch: 'F2', name: 'Bearing 608 seat' },
  ];
  it('is told apart by where its sketch plane comes from: fixed numbers, or a face', () => {
    expect(diagnose([e('F3', 'cutNoEffect')], seat({ kind: 'feature', id: 'F9' })).roots[0].seat).toBe('fixed');
    expect(diagnose([e('F3', 'cutNoEffect')], seat({ kind: 'feature', id: 'F1' })).roots[0].seat).toBe('face');
    expect(diagnose([e('F3', 'nothingToCut')], seat({ kind: 'face', id: 'F2.C1' })).roots[0].seat).toBe('face');
  });
  it('only a cut of that name that found nothing to cut', () => {
    expect(diagnose([e('F3', 'booleanFailed')], seat({ kind: 'feature', id: 'F9' })).roots[0].seat).toBeUndefined();
    expect(diagnose([e('F6', 'cutNoEffect')], feats).roots[0].seat).toBeUndefined();
  });
});
