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

/** Two d40 circles and two R40 arcs tangent to both; the arc ends are free but lie (within a hair) on the circles. 4 degrees of freedom are left. */
const twoCirclesTwoArcs = (): SketchDraft => {
  const h = Math.sqrt(60 * 60 - 30 * 30);               // arc centre height: 20 + 40 from each circle centre
  const t = 20 * 0.5, u = 20 * (h / 60);                 // tangent point offsets from a circle centre
  return {
    id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
    points: [
      { id: 'O', x: 0, y: 0, fixed: true },
      { id: 'c1', x: -30, y: 0, fixed: true }, { id: 'c2', x: 30, y: 0, fixed: true },
      { id: 'ca', x: 0, y: h }, { id: 'cb', x: 0, y: -h },
      { id: 'a1', x: -30 + t + 0.04, y: u - 0.03 }, { id: 'a2', x: 30 - t - 0.03, y: u + 0.04 },
      { id: 'b1', x: 30 - t + 0.02, y: -u + 0.03 }, { id: 'b2', x: -30 + t - 0.04, y: -u - 0.02 },
    ],
    entities: [
      { id: 'e1', type: 'circle', c: 'c1', r: 20 }, { id: 'e2', type: 'circle', c: 'c2', r: 20 },
      { id: 'e3', type: 'arc', c: 'ca', p1: 'a1', p2: 'a2' }, { id: 'e4', type: 'arc', c: 'cb', p1: 'b1', p2: 'b2' },
    ],
    constraints: [
      { id: 'k1', type: 'diameter', refs: ['e1'], value: 40 }, { id: 'k2', type: 'diameter', refs: ['e2'], value: 40 },
      { id: 'k3', type: 'radius', refs: ['e3'], value: 40 }, { id: 'k4', type: 'radius', refs: ['e4'], value: 40 },
      { id: 'k5', type: 'tangent', refs: ['e3', 'e1'] }, { id: 'k6', type: 'tangent', refs: ['e3', 'e2'] },
      { id: 'k7', type: 'tangent', refs: ['e4', 'e1'] }, { id: 'k8', type: 'tangent', refs: ['e4', 'e2'] },
    ],
  };
};

describe('Fully Define prefers relations the drawing already satisfies', { skip: !process.env.CK_WASM }, () => {
  it('arc ends that lie on the circles are put on them, not pinned with arbitrary dimensions', async () => {
    const d0 = twoCirclesTwoArcs();
    const { solve } = await solver(d0);
    const st0 = (await solve(d0))!;
    expect(st0.dof).toBe(4);
    const r = await fullyDefine(d0, solve);
    expect(r.fully).toBe(true);
    expect(r.status!.conflicts).toEqual([]);
    expect(r.status!.redundant).toEqual([]);
    expect(r.relations).toBe(4);
    expect(r.dimensions).toBe(0);
    const added = r.draft.constraints.slice(d0.constraints.length);
    expect(added.every((c) => c.type === 'pointOnCircle')).toBe(true);
    // no dimension with an accidental value, and nothing pinned
    expect(r.draft.constraints.some((c) => c.type === 'fix' || c.type === 'hdist' || c.type === 'vdist')).toBe(false);
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

  it('a fully defined circle is full too', async () => {
    const d0: SketchDraft = { id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [], points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 5, y: 5 }], entities: [{ id: 'e1', type: 'circle', c: 'p1', r: 3 }], constraints: [] };
    const { solve } = await solver(d0);
    const r = await fullyDefine(d0, solve);
    expect(r.fully).toBe(true);
    expect((await definitionMap(r.draft, r.status, solve)).get('e1')).toBe('full');
    expect((await definitionMap(d0, await solve(d0), solve)).get('e1')).toBe('under');
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

  it('a point whose distance is fixed but whose direction is free is under defined (a half-pinned point is not defined)', async () => {
    const d0: SketchDraft = {
      id: 'F1', plane: { kind: 'std', id: 'front' }, temp: [],
      points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 10, y: 0 }, { id: 'b', x: 10, y: 4 }],
      entities: [{ id: 'e1', type: 'line', p1: 'O', p2: 'a' }, { id: 'e2', type: 'line', p1: 'a', p2: 'b' }],
      constraints: [{ id: 'k1', type: 'distance', refs: ['O', 'a'], value: 10 }, { id: 'k2', type: 'distance', refs: ['a', 'b'], value: 4 }, { id: 'k3', type: 'perpendicular', refs: ['e1', 'e2'] }],
    };
    const { solve } = await solver(d0);
    const st = (await solve(d0))!;
    expect(st.dof).toBe(1);                       // it can swing about the origin
    const map = await definitionMap(d0, st, solve);
    expect(map.get('e1')).toBe('under');
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
