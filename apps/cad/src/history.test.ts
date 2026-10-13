import { describe, it, expect } from 'vitest';
import type { EditRecord } from '@ck/session';
import { describeOp, toEntries } from './history';

const rec = (id: string, author: string, ops: EditRecord['ops'], reason?: string, time = Date.UTC(2026, 9, 13, 9, 5)): EditRecord => ({ id, author, time, ops, reason });

describe('describeOp', () => {
  it('describes each op kind', () => {
    expect(describeOp({ op: 'add', feature: { type: 'extrude', id: 'F2' } })).toBe('Add extrude F2');
    expect(describeOp({ op: 'set', id: 'F2', path: 'depth', value: 14 })).toBe('Set F2.depth = 14');
    expect(describeOp({ op: 'remove', id: 'F3', cascade: true })).toBe('Remove F3 (with dependents)');
    expect(describeOp({ op: 'move', id: 'F4', to: 1 })).toBe('Move F4 to position 1');
    expect(describeOp({ op: 'replace', id: 'F5', feature: {} })).toBe('Replace F5');
  });
  it('copes with a feature that has no type or id', () => {
    expect(describeOp({ op: 'add', feature: {} })).toBe('Add feature');
  });
});

describe('toEntries', () => {
  it('maps records, authors and multi-op titles', () => {
    const e = toEntries([
      rec('edit-1', 'user', [{ op: 'set', id: 'F2', path: 'depth', value: 5 }]),
      rec('edit-2', 'agent', [{ op: 'set', id: 'F2', path: 'depth', value: 6 }, { op: 'remove', id: 'F3' }], 'tidy'),
    ]);
    expect(e.map((x) => x.author)).toEqual(['you', 'agent']);
    expect(e[1].title).toBe('Set F2.depth = 6 (+1 more)');
    expect(e[1].reason).toBe('tidy');
    expect(e[1].chips).toEqual(['2 ops']);
    expect(e[0].chips).toEqual(['1 op']);
  });
  it('places a rejection after the applied edits it followed', () => {
    const e = toEntries(
      [rec('edit-1', 'user', [{ op: 'remove', id: 'F9' }]), rec('edit-2', 'user', [{ op: 'remove', id: 'F8' }])],
      [{ at: 1, time: Date.UTC(2026, 9, 13, 9, 6), reason: '', hint: 'F4 cuts nothing', ops: [{ op: 'remove', id: 'F1' }] }],
    );
    expect(e.map((x) => x.title)).toEqual(['Remove F9', 'Rejected: F4 cuts nothing', 'Remove F8']);
    expect(e[1].failed).toBe(true);
    expect(e[1].chips).toEqual(['document unchanged']);
  });
  it('keeps a rejection that happened before any edit', () => {
    const e = toEntries([], [{ at: 0, time: 0, reason: 'x', hint: 'bad', ops: [] }]);
    expect(e.length).toBe(1);
    expect(e[0].failed).toBe(true);
  });
});
