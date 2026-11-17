import { describe, expect, it } from 'vitest';
import { BridgeError } from '@kit/agent-link';
import { diffFeatures, MAX_EDIT_CHARS, planEdit, snapshotFeatures } from './agentEdit';

const doc = { features: [{ id: 'F1', type: 'sketch' }, { id: 'F2', type: 'extrude', depth: 10 }, { id: 'F3', type: 'moveBody', translate: [0, 0, 0] }] };
const refused = (ops: unknown, code: string, re?: RegExp) => { try { planEdit(ops, doc); expect.unreachable(String(JSON.stringify(ops))); } catch (e) { expect(e).toBeInstanceOf(BridgeError); expect((e as BridgeError).code).toBe(code); if (re) expect((e as BridgeError).message).toMatch(re); } };

describe('planEdit: translation', () => {
  it('turns the five ops into kernel ops and never touches an id', () => {
    const ops = planEdit([
      { op: 'add', feature: { type: 'extrude', depth: 3 } },
      { op: 'add', feature: { id: 'F9', type: 'extrude' }, index: 1 },
      { op: 'replace', id: 'F2', feature: { type: 'extrude', depth: 12 } },
      { op: 'setParam', id: 'F2', path: 'depth', value: 14 },
      { op: 'transform', id: 'F3', translate: [1, 2, 3], rotate: { axis: 'z', angle: 90, origin: [0, 0, 0] } },
      { op: 'remove', id: 'F1', cascade: true },
    ], doc);
    expect(ops).toEqual([
      { op: 'add', feature: { type: 'extrude', depth: 3 } },
      { op: 'add', feature: { id: 'F9', type: 'extrude' }, index: 1 },
      { op: 'replace', id: 'F2', feature: { type: 'extrude', depth: 12, id: 'F2' } },
      { op: 'set', id: 'F2', path: 'depth', value: 14 },
      { op: 'set', id: 'F3', path: 'translate', value: [1, 2, 3] },
      { op: 'set', id: 'F3', path: 'rotate', value: { axis: 'z', angle: 90, origin: [0, 0, 0] } },
      { op: 'remove', id: 'F1', cascade: true },
    ]);
  });
  it('checks each op against the document as the ops before it leave it', () => {
    expect(planEdit([{ op: 'add', feature: { id: 'N1', type: 'extrude' } }, { op: 'setParam', id: 'N1', path: 'depth', value: 1 }], doc)).toHaveLength(2);   // an id added earlier is there
    refused([{ op: 'remove', id: 'F2' }, { op: 'setParam', id: 'F2', path: 'depth', value: 1 }], 'bad_op', /op 1 \(setParam\): no feature F2/);   // and a removed one is gone
    refused([{ op: 'add', feature: { id: 'F2', type: 'extrude' } }], 'bad_op', /already exists/);
  });
});

describe('planEdit: refusals name the op and say nothing was changed', () => {
  it.each([
    [[], 'bad_input'], [Array.from({ length: 51 }, () => ({ op: 'remove', id: 'F1' })), 'bad_input'], ['nope', 'bad_input'],
    [[{ op: 'add' }], 'bad_op'], [[{ op: 'add', feature: { depth: 1 } }], 'bad_op'], [[{ op: 'add', feature: { type: 'x' }, index: 99 }], 'bad_op'],
    [[{ op: 'replace', id: 'F2', feature: { type: 'extrude', id: 'F5' } }], 'bad_op'], [[{ op: 'replace', id: 'NOPE', feature: { type: 'x' } }], 'bad_op'],
    [[{ op: 'remove' }], 'bad_op'], [[{ op: 'remove', id: 'NOPE' }], 'bad_op'],
    [[{ op: 'setParam', id: 'F2', path: 'id', value: 'F7' }], 'bad_op'], [[{ op: 'setParam', id: 'F2', path: 'type', value: 'sketch' }], 'bad_op'],
    [[{ op: 'setParam', id: 'F2', path: '', value: 1 }], 'bad_op'], [[{ op: 'setParam', id: 'F2', path: 'depth' }], 'bad_op'],
    [[{ op: 'transform', id: 'F2', translate: [1, 2, 3] }], 'bad_op'],                                 // not a moveBody
    [[{ op: 'transform', id: 'F3' }], 'bad_op'], [[{ op: 'transform', id: 'F3', translate: [1, 2] }], 'bad_op'], [[{ op: 'transform', id: 'F3', rotate: { axis: 'w', angle: 1 } }], 'bad_op'],
    [[{ op: 'teleport', id: 'F3' }], 'bad_op'],
  ])('%j', (ops, code) => refused(ops, code as string));
  it('an op that is bad late refuses the whole list, and the message carries its index and the hint', () => {
    try { planEdit([{ op: 'setParam', id: 'F2', path: 'depth', value: 5 }, { op: 'remove', id: 'GONE' }], doc); expect.unreachable(); }
    catch (e) { expect((e as BridgeError).message).toMatch(/^op 1 \(remove\)/); expect((e as BridgeError).hint).toMatch(/nothing was changed; ids now: F1, F2, F3/); }
  });
  it('a transaction is bounded in size', () => refused([{ op: 'add', feature: { type: 'sketch', blob: 'x'.repeat(MAX_EDIT_CHARS) } }], 'edit_too_large'));
});

describe('diffFeatures', () => {
  it('names the features that changed, appeared and went, and counts a status change', () => {
    const bad = new Map<string, { code?: string }>();
    const before = snapshotFeatures(doc.features, bad);
    const after = [doc.features[0], { ...doc.features[1], depth: 11 }, { id: 'F4', type: 'extrude' }];
    expect(diffFeatures(before, after, bad)).toEqual({ changed: ['F2'], added: ['F4'], removed: ['F3'] });
    expect(diffFeatures(before, doc.features, new Map([['F1', { code: 'x' }]]))).toEqual({ changed: ['F1'], added: [], removed: [] });
    expect(diffFeatures(before, doc.features, bad)).toEqual({ changed: [], added: [], removed: [] });
  });
});
