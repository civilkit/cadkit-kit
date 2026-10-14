import { describe, expect, it } from 'vitest';
import { viewOwner, faceOwner, dependents, dependentsOf, nextSelection, rollbackCount, repairAnchor, withRollbackInsert, renameOps, deleteOps, suppressOps } from './treeActions';

const feats = [
  { id: 'F1', type: 'sketch', name: 'F2' },
  { id: 'F2', type: 'extrude', sketch: 'F1' },
  { id: 'F3', type: 'fillet', edges: ['F2.E1', 'F2.E2'] },
  { id: 'F4', type: 'sketch', plane: { kind: 'face', id: 'F2.C1' } },
  { id: 'F5', type: 'extrude', sketch: 'F4' },
];

describe('faceOwner', () => {
  it('reads the feature id off a face name', () => {
    expect(faceOwner('F2.C1')).toBe('F2');
    expect(faceOwner('F12.S3')).toBe('F12');
    expect(faceOwner('F7')).toBe('F7');
    expect(faceOwner('v:1,2,3')).toBeNull();
    expect(faceOwner('Front')).toBeNull();
  });
});

describe('dependents', () => {
  it('finds sketch, edge and face-plane references, ignoring names', () => {
    const d = dependents(feats);
    expect(d.get('F1')).toEqual(['F2']);       // F1's own name "F2" is not a reference to F2 from F1
    expect(d.get('F2')).toEqual(['F3', 'F4']);
    expect(d.get('F4')).toEqual(['F5']);
    expect(d.get('F5')).toEqual([]);
  });
  it('follows chains', () => {
    expect(dependentsOf(feats, 'F1')).toEqual(['F2', 'F3', 'F4', 'F5']);
    expect(dependentsOf(feats, 'F3')).toEqual([]);
  });
});

describe('nextSelection', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('plain click selects one', () => expect(nextSelection(['a', 'b'], 'a', 'c', order, {})).toEqual({ selection: ['c'], anchor: 'c' }));
  it('ctrl toggles', () => {
    expect(nextSelection(['a'], 'a', 'c', order, { ctrl: true }).selection).toEqual(['a', 'c']);
    expect(nextSelection(['a', 'c'], 'c', 'a', order, { ctrl: true }).selection).toEqual(['c']);
  });
  it('shift selects the range from the anchor, either way', () => {
    expect(nextSelection(['b'], 'b', 'd', order, { shift: true }).selection).toEqual(['b', 'c', 'd']);
    expect(nextSelection(['c'], 'c', 'a', order, { shift: true }).selection).toEqual(['a', 'b', 'c']);
  });
  it('shift without an anchor acts like a click', () => expect(nextSelection([], null, 'b', order, { shift: true }).selection).toEqual(['b']));
});

describe('rollback anchor', () => {
  const ids = ['F1', 'F2', 'F3'];
  it('counts', () => {
    expect(rollbackCount(null, ids)).toBeNull();
    expect(rollbackCount('', ids)).toBe(0);
    expect(rollbackCount('F2', ids)).toBe(2);
    expect(rollbackCount('F9', ids)).toBeNull();
  });
  it('repairs to the nearest earlier feature', () => {
    expect(repairAnchor('F3', ids, ['F1', 'F2'])).toBe('F2');
    expect(repairAnchor('F3', ids, ['F1'])).toBe('F1');
    expect(repairAnchor('F1', ids, ['F2', 'F3'])).toBe('');
    expect(repairAnchor('F2', ids, ids)).toBe('F2');
    expect(repairAnchor(null, ids, [])).toBeNull();
  });
  it('inserts new features at the marker, in order', () => {
    const ops = withRollbackInsert([{ op: 'add', feature: { type: 'sketch' } }, { op: 'add', feature: { type: 'extrude' } }, { op: 'set', id: 'F1', path: 'x', value: 1 }], 2);
    expect(ops.map((o) => (o.op === 'add' ? o.index : '-'))).toEqual([2, 3, '-']);
    const keep = [{ op: 'add' as const, feature: {}, index: 0 }];
    expect(withRollbackInsert(keep, 2)).toEqual(keep);
    expect(withRollbackInsert(keep, null)).toBe(keep);
  });
});

describe('ops', () => {
  it('rename sets name', () => expect(renameOps('F2', 'Base')).toEqual([{ op: 'set', id: 'F2', path: 'name', value: 'Base' }]));
  it('delete cascades only inside the selection', () => {
    expect(deleteOps(feats, ['F5'])).toEqual([{ op: 'remove', id: 'F5' }]);
    expect(deleteOps(feats, ['F4', 'F5'])).toEqual([{ op: 'remove', id: 'F4', cascade: true }, { op: 'remove', id: 'F5' }]);
    expect(deleteOps(feats, ['F4'])).toEqual([{ op: 'remove', id: 'F4' }]);
  });
  it('suppress toggles all together', () => {
    const f = [{ id: 'A', suppressed: true }, { id: 'B' }];
    expect(suppressOps(f, ['A', 'B'])).toEqual([{ op: 'set', id: 'B', path: 'suppressed', value: true }]);
    expect(suppressOps(f, ['A'])).toEqual([{ op: 'set', id: 'A', path: 'suppressed', value: false }]);
  });
});

describe('viewOwner', () => {
  const inserts = new Set(['F6', 'F8']);
  it('is the feature id in a part', () => {
    expect(viewOwner('F5.S.e1', new Set())).toBe('F5');
    expect(viewOwner('F2.C1|F2.C2#0', new Set())).toBe('F2');
  });
  it('is the component for names of an inserted part, also pattern copies, and the feature for root-part names', () => {
    expect(viewOwner('F2.S.e12@F6.1', inserts)).toBe('F6');
    expect(viewOwner('F4.C0@F6.1@F12.1', inserts)).toBe('F6');
    expect(viewOwner('F3.C1', inserts)).toBe('F3');
    expect(viewOwner('F2.C1@F9.1', inserts)).toBeNull();
  });
});
