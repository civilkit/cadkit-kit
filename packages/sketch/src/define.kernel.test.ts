/** Fully Define and the definition colouring against the real kernel: the solver decides what is redundant. */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc, type SketchSolverStatus } from '@ck/part-model';
import { toFeature, type SketchDraft } from './index';
import { definitionMap, fullyDefine, type Solve } from './define';
import { rectDraft } from './tools/edit-fixtures';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

/** A solve callback the way the app has it: replace the sketch of an open session and read the status back. */
async function solver(seed: SketchDraft): Promise<{ solve: Solve; calls: () => number }> {
  const doc = { ...emptyPart('D'), features: [toFeature(seed)], seq: 2 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  let n = 0;
  const solve: Solve = async (d) => {
    n++;
    const r = await s.preview([{ op: 'replace', id: d.id, feature: toFeature(d, { includeTemp: true }) }], { upTo: 1, solveSketches: true });
    const sk = (r.body?.sketches ?? r.sketches)?.find((x) => x.id === d.id) as unknown as { status?: SketchSolverStatus } | undefined;
    return sk?.status ?? null;
  };
  return { solve, calls: () => n };
}

const withOrigin = (d: SketchDraft): SketchDraft => ({ ...d, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...d.points.map((p) => ({ ...p, x: p.x + 7, y: p.y + 3 }))] });

describe('Fully Define in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a rectangle with H/V relations and nothing else gets size and position until dof is 0', async () => {
    const d0 = withOrigin(rectDraft(10, 5));
    const { solve } = await solver(d0);
    expect((await solve(d0))!.dof).toBeGreaterThan(0);
    const r = await fullyDefine(d0, solve);
    expect(r.fully).toBe(true);
    expect(r.status!.dof).toBe(0);
    expect(r.status!.conflicts).toEqual([]);
    expect(r.status!.redundant).toEqual([]);
    expect(r.dimensions).toBeGreaterThan(0);
    // the geometry did not move to satisfy the new dimensions
    for (const p of d0.points) {
      const q = r.draft.points.find((x) => x.id === p.id)!;
      expect(q.x).toBeCloseTo(p.x, 6); expect(q.y).toBeCloseTo(p.y, 6);
    }
  });

  it('a skewed-but-nearly-axis-aligned quad gets its relations as drawn first', async () => {
    const d0: SketchDraft = { ...withOrigin(rectDraft(10, 5)), constraints: [] };
    const { solve } = await solver(d0);
    const r = await fullyDefine(d0, solve);
    expect(r.relations).toBeGreaterThanOrEqual(4);          // 4 lines are horizontal / vertical
    expect(r.fully).toBe(true);
    expect(r.status!.redundant).toEqual([]);
  });

  it('a circle and a line: radius, length and positions', async () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 5, y: 5 }, { id: 'p2', x: 20, y: 12 }, { id: 'p3', x: 30, y: 30 }],
      entities: [{ id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'circle', c: 'p3', r: 4 }],
      constraints: [],
    };
    const { solve } = await solver(d0);
    const r = await fullyDefine(d0, solve);
    expect(r.fully).toBe(true);
    expect(r.draft.constraints.some((c) => c.type === 'radius')).toBe(true);
  });

  it('an over-constrained sketch is left alone', async () => {
    const d0 = withOrigin(rectDraft(10, 5));
    const bad: SketchDraft = { ...d0, constraints: [...d0.constraints, { id: 'k5', type: 'distance', refs: ['p1', 'p2'], value: 10 }, { id: 'k6', type: 'distance', refs: ['p1', 'p2'], value: 12 }] };
    const { solve } = await solver(bad);
    const r = await fullyDefine(bad, solve);
    expect(r.dimensions + r.relations).toBe(0);
    expect(r.fully).toBe(false);
  });
});

describe('definitionMap in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('fully defined: every entity is full', async () => {
    const d0 = withOrigin(rectDraft(10, 5));
    const { solve } = await solver(d0);
    const r = await fullyDefine(d0, solve);
    const map = await definitionMap(r.draft, r.status, solve);
    for (const e of r.draft.entities) expect(map.get(e.id)).toBe('full');
  });

  it('partly defined: the pinned square is full, the free line is under', async () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 10, y: 0, fixed: true }, { id: 'b', x: 10, y: 10 }, { id: 'c', x: 30, y: 30 }, { id: 'd', x: 40, y: 35 }],
      entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'c', p2: 'd' }],
      constraints: [{ id: 'k1', type: 'vertical', refs: ['e1'] }, { id: 'k2', type: 'distance', refs: ['a', 'b'], value: 10 }],
    };
    const { solve } = await solver(d0);
    const st = (await solve(d0))!;
    const map = await definitionMap(d0, st, solve);
    expect(map.get('e1')).toBe('full');
    expect(map.get('e2')).toBe('under');
  });

  it('over-constrained: the entity named by the conflicting constraint is over', async () => {
    const d0 = withOrigin(rectDraft(10, 5));
    const bad: SketchDraft = { ...d0, constraints: [...d0.constraints, { id: 'k5', type: 'distance', refs: ['p1', 'p2'], value: 10 }, { id: 'k6', type: 'distance', refs: ['p1', 'p2'], value: 12 }] };
    const { solve } = await solver(bad);
    const st = (await solve(bad))!;
    expect(st.state).toBe('over');
    const map = await definitionMap(bad, st, solve);
    expect(map.get('e1')).toBe('over');
  });
});
