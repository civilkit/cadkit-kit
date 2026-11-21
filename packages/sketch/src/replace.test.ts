import { describe, expect, it } from 'vitest';
import type { SketchDraft } from './index';
import type { Solve } from './define';
import { replaceCandidates, withoutConstraint } from './replace';

const draft = (): SketchDraft => ({
  id: 'S', plane: { kind: 'std', id: 'front' }, temp: [],
  points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }, { id: 'p3', x: 0, y: 5 }, { id: 'p4', x: 7, y: 7 }],
  entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' }],
  constraints: [
    { id: 'k1', type: 'horizontal', refs: ['e1'] },
    { id: 'k2', type: 'distance', refs: ['p1', 'p2'], value: 10 },
    { id: 'k3', type: 'parallel', refs: ['e1', 'e2'] },
    { id: 'k4', type: 'distance', refs: ['p3', 'p4'], value: 9 },   // the new one
  ],
} as unknown as SketchDraft);

/** A stand-in solver: the sketch is clean unless both k3 and k4 are present together with k1 (the clash). */
const solve: Solve = async (d) => {
  const has = (id: string) => d.constraints.some((k) => k.id === id);
  const clash = has('k1') && has('k3') && has('k4');
  return { solved: true, dof: 0, state: 'full', conflicts: clash ? ['k4'] : [], redundant: [] } as never;
};

describe('replaceCandidates', () => {
  it('lists the earlier constraints that touch the new one and whose removal clears the clash', async () => {
    const ids = await replaceCandidates(draft(), 'k4', solve);
    expect(ids).toEqual(['k3']);   // k1 shares no geometry with the new k4, so it is not even tried
  });
  it('unrelated constraints are not tried; an unknown id gives nothing', async () => {
    expect(await replaceCandidates(draft(), 'nope', solve)).toEqual([]);
    const tried: string[] = [];
    await replaceCandidates(draft(), 'k4', async (d) => { tried.push(d.constraints.map((k) => k.id).join()); return solve(d); });
    expect(tried.every((t) => t.includes('k4'))).toBe(true);
  });
  it('withoutConstraint takes out just that one', () => {
    expect(withoutConstraint(draft(), 'k3').constraints.map((k) => k.id)).toEqual(['k1', 'k2', 'k4']);
  });
});

describe('blewUp', () => {
  const at = (x: number): SketchDraft => ({ ...draft(), points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x, y: 0 }] });
  it('flags a sketch thrown thousands of times further out, not an ordinary change', async () => {
    const { blewUp } = await import('./replace');
    expect(blewUp(at(10), at(25))).toBe(false);
    expect(blewUp(at(10), at(5000))).toBe(false);   // large but under the floor
    expect(blewUp(at(10), at(3e7))).toBe(true);
  });
});
