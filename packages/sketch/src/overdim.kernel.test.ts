/** What the app's settleDimensions relies on: a second, different dimension on an already dimensioned edge comes back from the kernel as a conflict (45 against 40), a repeated equal one as redundant, so either becomes a reference dimension. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import { closeSessions, solveDraft } from './tools/kernel-fixtures';

afterEach(closeSessions);
const base = (value: number): SketchDraft => ({ id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'a', x: 0, y: 0, fixed: true }, { id: 'b', x: 40, y: 0 }, { id: 'c', x: 40, y: 20 }, { id: 'd', x: 0, y: 20 }],
  entities: [{ id: 'l1', type: 'line', p1: 'a', p2: 'b' }, { id: 'l2', type: 'line', p1: 'b', p2: 'c' }, { id: 'l3', type: 'line', p1: 'c', p2: 'd' }, { id: 'l4', type: 'line', p1: 'd', p2: 'a' }],
  constraints: [{ id: 'k1', type: 'distance', refs: ['a', 'b'], value: 40 }, { id: 'k2', type: 'distance', refs: ['a', 'b'], value }] });

describe('a second dimension on a dimensioned edge, in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('45 against 40 is reported as a conflicting constraint, an equal 40 as redundant (so the app can make it a reference dimension)', async () => {
    const conflict = await solveDraft(base(45), 2, { solve: true });
    expect([...(conflict.status?.conflicts ?? []), ...(conflict.status?.redundant ?? [])]).toContain('k2');
    const same = await solveDraft(base(40), 2, { solve: true });
    expect([...(same.status?.conflicts ?? []), ...(same.status?.redundant ?? [])]).toContain('k2');
  });
});
