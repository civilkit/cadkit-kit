/**
 * Proves the `refs` convention of every constraint type against the real kernel (see CONSTRAINTS.md).
 *
 * The kernel only re-solves a sketch at regen when a constraint carries an `expr` whose value differs from its
 * stored `value` (a missing value counts as changed); otherwise the reply echoes the coordinates it was given and
 * only reports the solver `status`. These tests use that as a solving oracle: `solve` puts an `expr` on the
 * constraint under test, so the reply holds the SOLVED coordinates. Points marked `fixed` are constants for the
 * solver, which is how the scenes pin the geometry that must not move (everything else moves minimum-norm).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc, type SketchSolverStatus } from '@ck/part-model';
import type { SketchDraft } from '../index';
import { appendSpec, reportStatus } from './constraints';
import { tangentTool } from './constraint-tools';
import { dimensionTool } from './dimension';
import { DEFAULT_SETTINGS, type Modifiers, type SnapHit, type Tool, type ToolEvent, type ToolOutput } from './types';

type Raw = Record<string, unknown>;
interface Solved { pts: Record<string, [number, number]>; ents: Record<string, Raw>; status: Raw }

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const P = (id: string, x: number, y: number, fixed = false): Raw => ({ id, x, y, ...(fixed ? { fixed: true } : {}) });
const L = (id: string, p1: string, p2: string): Raw => ({ id, type: 'line', p1, p2 });
const C = (id: string, c: string, r: number): Raw => ({ id, type: 'circle', c, r });
const A = (id: string, c: string, p1: string, p2: string): Raw => ({ id, type: 'arc', c, p1, p2 });
const K = (id: string, type: string, refs: string[], extra: Raw = {}): Raw => ({ id, type, refs, ...extra });

/** A far-away closed square so the part has a solid and the reply carries `body.sketches`. */
const ANCHOR = { type: 'sketch', id: 'F2', plane: { kind: 'std', id: 'front' },
  points: [P('a', 100, 100), P('b', 110, 100), P('c', 110, 110), P('d', 100, 110)],
  entities: [L('e1', 'a', 'b'), L('e2', 'b', 'c'), L('e3', 'c', 'd'), L('e4', 'd', 'a')], constraints: [] };

/** Regenerate with the solver status on. `solveAll` makes the kernel re-solve (see header); `raw` skips that. */
async function regen(points: Raw[], entities: Raw[], constraints: Raw[], solveAll = true): Promise<Solved> {
  const cs = constraints.map((c, i) => {
    if (!solveAll) return c;
    if (typeof c.value === 'number') return { ...c, expr: String(c.value), value: c.value + 1 }; // stale value, expr is the truth
    return i === constraints.length - 1 ? { ...c, expr: '0' } : c;                              // no value: counts as changed
  });
  const sketch = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points, entities, constraints: cs };
  const doc = { ...emptyPart('C'), features: [sketch, ANCHOR, { type: 'extrude', op: 'add', sketch: 'F2', end: 'blind', depth: 2, id: 'F3' }], seq: 4 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  const r = await s.preview([], { sketchStatus: true });
  expect(r.errors).toEqual([]);
  const out = (r.body as unknown as { sketches: Array<{ sketch: { points: Raw[]; entities: Raw[] }; status: Raw }> }).sketches[0];
  return {
    pts: Object.fromEntries(out.sketch.points.map((p) => [p.id as string, [p.x as number, p.y as number]])),
    ents: Object.fromEntries(out.sketch.entities.map((e) => [e.id as string, e])),
    status: out.status,
  };
}

const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const sub = (a: [number, number], b: [number, number]): [number, number] => [a[0] - b[0], a[1] - b[1]];
const len = (v: [number, number]) => Math.hypot(v[0], v[1]);
const deg = (v: [number, number], w: [number, number]) => (Math.atan2(v[0] * w[1] - v[1] * w[0], v[0] * w[0] + v[1] * w[1]) * 180) / Math.PI;

describe('every constraint type solves with the documented refs', { skip: !process.env.CK_WASM }, () => {
  it('control: without an expr the kernel returns the coordinates unsolved but still reports the status', async () => {
    const r = await regen([P('p1', 0, 0, true), P('p2', 10, 3)], [L('e1', 'p1', 'p2')], [K('k1', 'horizontal', ['e1'])], false);
    expect(r.pts.p2).toEqual([10, 3]);
    expect(r.status).toMatchObject({ solved: true, dof: 1 });        // "solved": a solve from here converges
    expect(r.status.residual as number).toBeGreaterThan(1);          // ...but the coordinates as given do not satisfy it
  });

  it('horizontal / vertical: refs [lineId], or [pointA, pointB]', async () => {
    const pts = [P('p1', 0, 0, true), P('p2', 10, 3)];
    let r = await regen(pts, [L('e1', 'p1', 'p2')], [K('k1', 'horizontal', ['e1'])]);
    near(r.pts.p2[1], 0); near(r.pts.p2[0], 10);
    r = await regen(pts, [L('e1', 'p1', 'p2')], [K('k1', 'vertical', ['e1'])]);
    near(r.pts.p2[0], 0); near(r.pts.p2[1], 3);
    r = await regen(pts, [], [K('k1', 'horizontal', ['p1', 'p2'])]);
    near(r.pts.p2[1], 0);
    r = await regen(pts, [], [K('k1', 'vertical', ['p1', 'p2'])]);
    near(r.pts.p2[0], 0);
    expect(r.status).toMatchObject({ solved: true, dof: 1, conflicts: [] });
  });

  it('coincident: refs [pointA, pointB]; a circle/arc id stands for its centre', async () => {
    let r = await regen([P('p1', 2, 3, true), P('p2', 5, 7)], [], [K('k1', 'coincident', ['p1', 'p2'])]);
    expect(r.pts.p2[0]).toBeCloseTo(2, 6); expect(r.pts.p2[1]).toBeCloseTo(3, 6);
    r = await regen([P('p1', 2, 3, true), P('c', 9, 9)], [C('e1', 'c', 4)], [K('k1', 'coincident', ['p1', 'e1'])]);
    near(r.pts.c[0], 2); near(r.pts.c[1], 3);
  });

  it('concentric: refs [curveA, curveB] (circle/arc ids or centre points)', async () => {
    const r = await regen([P('c1', 0, 0, true), P('c2', 3, 1)], [C('e1', 'c1', 5), C('e2', 'c2', 2)], [K('k1', 'concentric', ['e1', 'e2'])]);
    near(r.pts.c2[0], 0); near(r.pts.c2[1], 0);
    near(r.ents.e2.r as number, 2); // radii untouched
  });

  it('equal: refs [lineA, lineB] equalises length; [curveA, curveB] equalises radius', async () => {
    let r = await regen([P('p1', 0, 0, true), P('p2', 10, 0, true), P('p3', 0, 5, true), P('p4', 3, 5)], [L('e1', 'p1', 'p2'), L('e2', 'p3', 'p4')], [K('k1', 'equal', ['e1', 'e2'])]);
    near(len(sub(r.pts.p4, r.pts.p3)), 10);
    r = await regen([P('c1', 0, 0, true), P('c2', 20, 0, true)], [C('e1', 'c1', 3), C('e2', 'c2', 9)], [K('k0', 'radius', ['e1'], { value: 5 }), K('k1', 'equal', ['e1', 'e2'])]);
    near(r.ents.e1.r as number, 5); near(r.ents.e2.r as number, 5);
  });

  it('parallel / perpendicular: refs [lineA, lineB] (lines only)', async () => {
    const base = [P('p1', 0, 0, true), P('p2', 10, 0, true), P('p3', 0, 5, true), P('p4', 8, 7)];
    const ents = [L('e1', 'p1', 'p2'), L('e2', 'p3', 'p4')];
    let r = await regen(base, ents, [K('k1', 'parallel', ['e1', 'e2'])]);
    near(r.pts.p4[1], 5);
    r = await regen(base, ents, [K('k1', 'perpendicular', ['e1', 'e2'])]);
    near(r.pts.p4[0], 0);
    expect(r.status).toMatchObject({ solved: true, conflicts: [] });
  });

  it('collinear: refs [lineA, lineB] puts both ends of B on the infinite line A', async () => {
    const r = await regen([P('p1', 0, 0, true), P('p2', 10, 0, true), P('p3', 12, 2), P('p4', 20, 1)], [L('e1', 'p1', 'p2'), L('e2', 'p3', 'p4')], [K('k1', 'collinear', ['e1', 'e2'])]);
    near(r.pts.p3[1], 0); near(r.pts.p4[1], 0);
  });

  it('midpoint: refs [point, line] (point first)', async () => {
    const r = await regen([P('p1', 0, 0, true), P('p2', 10, 4, true), P('p3', 1, 1)], [L('e1', 'p1', 'p2')], [K('k1', 'midpoint', ['p3', 'e1'])]);
    near(r.pts.p3[0], 5); near(r.pts.p3[1], 2);
  });

  it('tangent: [line, circle] and [circle, circle] (either order), `internal` for nested circles', async () => {
    let r = await regen([P('p1', 0, 0, true), P('p2', 10, 0, true), P('c', 5, 3, true)], [L('e1', 'p1', 'p2'), C('e2', 'c', 1)], [K('k1', 'tangent', ['e1', 'e2'])]);
    near(r.ents.e2.r as number, 3);
    r = await regen([P('p1', 0, 0, true), P('p2', 10, 0, true), P('c', 5, 3, true)], [L('e1', 'p1', 'p2'), C('e2', 'c', 1)], [K('k1', 'tangent', ['e2', 'e1'])]);
    near(r.ents.e2.r as number, 3);
    const circles = [P('c1', 0, 0, true), P('c2', 4, 0)];
    const ents = [C('e1', 'c1', 3), C('e2', 'c2', 2)];
    const radii = [K('r1', 'radius', ['e1'], { value: 3 }), K('r2', 'radius', ['e2'], { value: 2 })];
    r = await regen(circles, ents, [...radii, K('k1', 'tangent', ['e1', 'e2'])]);
    near(len(r.pts.c2), 5);                                    // external: distance r1 + r2
    r = await regen(circles, ents, [...radii, K('k1', 'tangent', ['e1', 'e2'], { internal: true })]);
    near(len(r.pts.c2), 1);                                    // internal: distance |r1 - r2|
  });

  it('tangent at a shared end point: [line, arc] meeting at an end point, optional `at`', async () => {
    const pts = [P('c', 0, 0, true), P('p1', 5, 0, true), P('p2', 0, 5, true), P('q', 5.5, 4)];
    const ents = [A('e1', 'c', 'p1', 'p2'), L('e2', 'p1', 'q')];
    for (const extra of [{}, { at: 'p1' }]) {
      const r = await regen(pts, ents, [K('k1', 'tangent', ['e1', 'e2'], extra)]);
      near(r.pts.q[0], 5);   // the line leaves p1 perpendicular to the radius c-p1
      expect(r.status).toMatchObject({ solved: true, conflicts: [] });
    }
  });

  it('symmetric: refs [pointA, pointB, axisLine]', async () => {
    const r = await regen([P('a1', 0, 0, true), P('a2', 0, 10, true), P('p1', 3, 2, true), P('p2', -1, 5)], [L('e1', 'a1', 'a2')], [K('k1', 'symmetric', ['p1', 'p2', 'e1'])]);
    near(r.pts.p2[0], -3); near(r.pts.p2[1], 2);
  });

  it('fix: refs [point] with value [x, y] (the target position, not a flag)', async () => {
    const r = await regen([P('p1', 1, 1)], [], [K('k1', 'fix', ['p1'], { value: [3, 4] })]);
    near(r.pts.p1[0], 3); near(r.pts.p1[1], 4);
    expect(r.status).toMatchObject({ dof: 0, state: 'full' });
  });

  it('pointOnLine [point, line] and pointOnCircle [point, circle]', async () => {
    let r = await regen([P('p1', 0, 0, true), P('p2', 10, 0, true), P('p3', 4, 3)], [L('e1', 'p1', 'p2')], [K('k1', 'pointOnLine', ['p3', 'e1'])]);
    near(r.pts.p3[1], 0);
    r = await regen([P('c', 0, 0, true), P('p', 6, 0)], [C('e1', 'c', 4)], [K('r', 'radius', ['e1'], { value: 4 }), K('k1', 'pointOnCircle', ['p', 'e1'])]);
    near(len(r.pts.p), 4);
  });

  it('distance [pointA, pointB]; hdist / vdist are absolute differences along x / y', async () => {
    const pts = [P('p1', 0, 0, true), P('p2', 3, 4)];
    let r = await regen(pts, [], [K('k1', 'distance', ['p1', 'p2'], { value: 10 })]);
    near(len(r.pts.p2), 10);
    r = await regen(pts, [], [K('k1', 'hdist', ['p1', 'p2'], { value: 10 })]);
    near(r.pts.p2[0], 10); near(r.pts.p2[1], 4);
    r = await regen([P('p1', 0, 0, true), P('p2', -3, -4)], [], [K('k1', 'vdist', ['p1', 'p2'], { value: 6 })]);
    near(r.pts.p2[1], -6);                                   // |dy| = 6 keeps the side it started on
  });

  it('pldist [point, line]: absolute distance to the infinite line', async () => {
    const r = await regen([P('p1', 0, 0, true), P('p2', 10, 0, true), P('p3', 5, 3)], [L('e1', 'p1', 'p2')], [K('k1', 'pldist', ['p3', 'e1'], { value: 6 })]);
    near(r.pts.p3[1], 6);
  });

  it('radius [circle|arc], diameter [circle|arc]', async () => {
    let r = await regen([P('c', 0, 0, true)], [C('e1', 'c', 3)], [K('k1', 'radius', ['e1'], { value: 5 })]);
    near(r.ents.e1.r as number, 5);
    r = await regen([P('c', 0, 0, true)], [C('e1', 'c', 3)], [K('k1', 'diameter', ['e1'], { value: 8 })]);
    near(r.ents.e1.r as number, 4);
    r = await regen([P('c', 0, 0, true), P('p1', 4, 0), P('p2', 0, 4.2)], [A('e1', 'c', 'p1', 'p2')], [K('k1', 'radius', ['e1'], { value: 6 })]);
    near(len(r.pts.p1), 6); near(len(r.pts.p2), 6);
    r = await regen([P('c', 0, 0, true), P('p1', 4, 0), P('p2', 0, 4.2)], [A('e1', 'c', 'p1', 'p2')], [K('k1', 'diameter', ['e1'], { value: 12 })]);
    near(len(r.pts.p1), 6);
  });

  describe('angle: refs [lineA, lineB], value in DEGREES, optional s1 / s2 = -1 reverse a line', () => {
    // direction of a line is p1 -> p2; the constraint fixes the signed angle from dir(A)*s1 to dir(B)*s2, counter-clockwise positive
    const two = (p4: [number, number]) => [P('p1', 0, 0, true), P('p2', 10, 0, true), P('p3', 0, 5, true), P('p4', ...p4)];
    const ents = [L('e1', 'p1', 'p2'), L('e2', 'p3', 'p4')];
    const dirs = (r: Solved) => [sub(r.pts.p2, r.pts.p1), sub(r.pts.p4, r.pts.p3)] as [[number, number], [number, number]];

    it('value is degrees and measures the counter-clockwise turn from line A to line B', async () => {
      let r = await regen(two([8, 7]), ents, [K('k1', 'angle', ['e1', 'e2'], { value: 60 })]);
      let [a, b] = dirs(r);
      near(deg(a, b), 60, 1e-6);
      r = await regen(two([8, -7]), ents, [K('k1', 'angle', ['e1', 'e2'], { value: 300 })]);
      [a, b] = dirs(r);
      near(deg(a, b), -60, 1e-6);      // 300 degrees == -60: the sign convention is counter-clockwise
    });

    it('the near branch wins: sin(angle - value) = 0 also has the opposite root, so start near the target', async () => {
      const r = await regen(two([-8, 7]), ents, [K('k1', 'angle', ['e1', 'e2'], { value: 60 })]);
      const [a, b] = dirs(r);
      // from 138.8 degrees the solver converges to the root at 240 (= 60 + 180), not 60
      near(Math.abs(Math.sin(((deg(a, b) - 60) * Math.PI) / 180)), 0, 1e-6);
      expect(Math.abs(deg(a, b) - 60)).toBeGreaterThan(100);
    });

    it('s1 / s2 = -1 reverse the line, so lines drawn "toward" a shared vertex measure the interior angle', async () => {
      // A=(0,0)->B=(10,0) and B->C: with both measured away from B the angle is the interior angle at B
      const pts = [P('A', 0, 0, true), P('B', 10, 0, true), P('C', 13, 6)];
      const lines = [L('e1', 'A', 'B'), L('e2', 'B', 'C')];
      const interior = (r: Solved) => Math.abs(deg(sub(r.pts.A, r.pts.B), sub(r.pts.C, r.pts.B)));
      const plain = await regen(pts, lines, [K('k1', 'angle', ['e1', 'e2'], { value: 40 })]);
      near(interior(plain), 140, 1e-6);   // s1 = s2 = 1: the EXTERIOR (turning) angle, interior = 180 - 40
      // measure away from B on both lines, ordered so the turn from the first to the second is counter-clockwise
      const away = await regen(pts, lines, [K('k1', 'angle', ['e2', 'e1'], { value: 40, s1: 1, s2: -1 })]);
      near(interior(away), 40, 1e-6);     // the interior angle at B
      // same intent, wrong order: the turn from B->A to B->C is clockwise, so the solver lands on the opposite root
      const wrong = await regen(pts, lines, [K('k1', 'angle', ['e1', 'e2'], { value: 40, s1: -1 })]);
      near(interior(wrong), 140, 1e-6);
    });
  });

  it('duplicate and contradicting constraints are reported in status.redundant / status.conflicts', async () => {
    const pts = [P('p1', 0, 0, true), P('p2', 10, 0)];
    const dup = await regen(pts, [L('e1', 'p1', 'p2')], [K('k1', 'horizontal', ['e1']), K('k2', 'horizontal', ['e1'])]);
    expect(dup.status).toMatchObject({ state: 'over', redundant: ['k2'], conflicts: [] });
    const bad = await regen([P('p1', 0, 0, true), P('p2', 10, 5, true)], [L('e1', 'p1', 'p2')], [K('k1', 'horizontal', ['e1'])], false);
    expect(bad.status).toMatchObject({ state: 'over', conflicts: ['k1'], solved: false });
    // horizontal + vertical on ONE line is not reported at all: it collapses the line to a point (dof 0, no conflict)
    const collapsed = await regen(pts, [L('e1', 'p1', 'p2')], [K('k1', 'horizontal', ['e1']), K('k2', 'vertical', ['e1'])]);
    expect(collapsed.status).toMatchObject({ state: 'full', conflicts: [], redundant: [] });
    near(len(sub(collapsed.pts.p2, collapsed.pts.p1)), 0, 1e-5);
  });
});

// ---- what the tools write, solved by the real kernel -----------------------------------------------------------

const MODS: Modifiers = { shift: false, ctrl: false, alt: false };
const hit = (snap: SnapHit): ToolEvent => ({ type: 'click', at: snap.at, snap, mods: MODS });
const entity = (id: string) => hit({ kind: 'grid', at: { x: 0, y: 0 }, entityId: id });
const drive = <S>(tool: Tool<S>, draft: SketchDraft, events: ToolEvent[]): ToolOutput<S> => {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, DEFAULT_SETTINGS);
  return out;
};
const draftOf = (points: Raw[], entities: Raw[], constraints: Raw[] = []): SketchDraft =>
  ({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: points as SketchDraft['points'], entities: entities as SketchDraft['entities'], constraints: constraints as SketchDraft['constraints'], temp: [] });
const solveDraft = (d: SketchDraft) => regen(d.points as Raw[], d.entities as Raw[], d.constraints as Raw[]);

describe('constraints written by the tools hold in the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('a typed angle between two lines that meet is the interior angle at their vertex', async () => {
    const d = draftOf([P('A', 0, 0, true), P('B', 10, 0, true), P('C', 13, 6)], [L('e1', 'A', 'B'), L('e2', 'B', 'C')]);
    const o = drive(dimensionTool, d, [entity('e1'), entity('e2'), { type: 'field', id: 'value', value: 40, commit: true }]);
    expect(o.draft.constraints).toMatchObject([{ type: 'angle', refs: ['e2', 'e1'], s2: -1, value: 40 }]);
    const r = await solveDraft(o.draft);
    near(Math.abs(deg(sub(r.pts.A, r.pts.B), sub(r.pts.C, r.pts.B))), 40);
    expect(r.status).toMatchObject({ solved: true, conflicts: [] });
  });

  it('a typed length, radius and diameter move the geometry as asked', async () => {
    const d = draftOf([P('p1', 0, 0, true), P('p2', 6, 8), P('c', 30, 0, true), P('d', 50, 0, true)], [L('e1', 'p1', 'p2'), C('e2', 'c', 3), C('e3', 'd', 3)]);
    const typed = (v: number): ToolEvent => ({ type: 'field', id: 'value', value: v, commit: true });
    let o = drive(dimensionTool, d, [entity('e1'), typed(25)]);
    o = drive(dimensionTool, o.draft, [entity('e2'), { type: 'key', key: 'r' }, typed(5)]);
    o = drive(dimensionTool, o.draft, [entity('e3'), typed(14)]);
    expect(o.draft.constraints.map((c) => [c.type, c.refs, c.value])).toEqual([['distance', ['p1', 'p2'], 25], ['radius', ['e2'], 5], ['diameter', ['e3'], 14]]);
    const r = await solveDraft(o.draft);
    near(len(r.pts.p2), 25);
    near(r.ents.e2.r as number, 5);
    near(r.ents.e3.r as number, 7);
    expect(r.status).toMatchObject({ solved: true, conflicts: [], redundant: [] });
  });

  it('tangent detects nested circles and sets `internal`, which the kernel honours', async () => {
    const d = draftOf([P('c1', 0, 0, true), P('c2', 2.4, 0)], [C('e1', 'c1', 3), C('e2', 'c2', 2)],
      [K('r1', 'radius', ['e1'], { value: 3 }), K('r2', 'radius', ['e2'], { value: 2 })]);
    const o = drive(tangentTool, d, [entity('e1'), entity('e2')]);
    expect(o.draft.constraints[2]).toMatchObject({ type: 'tangent', refs: ['e1', 'e2'], internal: true });
    const r = await solveDraft(o.draft);
    near(len(r.pts.c2), 1);
  });

  it('status after an unwanted constraint: reportStatus blames the one just added', async () => {
    const base = draftOf([P('p1', 0, 0, true), P('p2', 10, 5, true)], [L('e1', 'p1', 'p2')]);
    // bypass the tool's refusal logic to see what the kernel says
    const conflict = appendSpec(base, { type: 'horizontal', refs: ['e1'] });
    let r = await regen(conflict.points as Raw[], conflict.entities as Raw[], conflict.constraints as Raw[], false);
    expect(reportStatus(r.status as unknown as SketchSolverStatus, 'k1')).toMatchObject({ level: 'conflict', hint: 'app.sketch.hint.status.overConstrained', ids: ['k1'], blamesAdded: true });
    const free = draftOf([P('p1', 0, 0, true), P('p2', 10, 0)], [L('e1', 'p1', 'p2')], [K('k1', 'horizontal', ['e1'])]);
    const dup = appendSpec(free, { type: 'horizontal', refs: ['e1'] });
    r = await regen(dup.points as Raw[], dup.entities as Raw[], dup.constraints as Raw[], false);
    expect(reportStatus(r.status as unknown as SketchSolverStatus, 'k2')).toMatchObject({ level: 'redundant', ids: ['k2'], blamesAdded: true });
    r = await regen(free.points as Raw[], free.entities as Raw[], free.constraints as Raw[], false);
    expect(reportStatus(r.status as unknown as SketchSolverStatus, 'k1')).toMatchObject({ level: 'under', ids: [] });
  });
});
