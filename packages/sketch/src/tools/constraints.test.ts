import { describe, expect, it } from 'vitest';
import type { SketchDraft } from '../index';
import { angleSpec, orientations, pickOf, problemHint, refusedBy, reportStatus } from './constraints';
import {
  coincidentTool, collinearTool, concentricTool, equalTool, fixTool, horizontalTool, midpointTool, parallelTool,
  perpendicularTool, symmetricTool, tangentTool, verticalTool, type ConstraintTool,
} from './constraint-tools';
import { dimensionTool, type DimensionState } from './dimension';
import { DEFAULT_SETTINGS, type Modifiers, type SnapHit, type Tool, type ToolEvent, type ToolOutput } from './types';

const M: Modifiers = { shift: false, ctrl: false, alt: false };
const D: SketchDraft = {
  id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [
    { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 2 }, { id: 'p3', x: 0, y: 5 }, { id: 'p4', x: 8, y: 7 },
    { id: 'c1', x: 20, y: 0 }, { id: 'c2', x: 24, y: 1 }, { id: 'p5', x: 30, y: 0 },
  ],
  entities: [
    { id: 'e1', type: 'line', p1: 'p1', p2: 'p2' }, { id: 'e2', type: 'line', p1: 'p3', p2: 'p4' },
    { id: 'e3', type: 'circle', c: 'c1', r: 3 }, { id: 'e4', type: 'circle', c: 'c2', r: 2 },
    { id: 'e5', type: 'arc', c: 'c1', p1: 'p5', p2: 'c2' },
  ],
  constraints: [], temp: [],
};

const at = (snap: SnapHit) => ({ type: 'click', at: snap.at, snap, mods: M }) as ToolEvent;
const pt = (id: string): ToolEvent => at({ kind: 'point', at: { x: 0, y: 0 }, pointId: id });
const ent = (id: string): ToolEvent => at({ kind: 'grid', at: { x: 0, y: 0 }, entityId: id });
const key = (k: string): ToolEvent => ({ type: 'key', key: k });

function run<S>(tool: Tool<S>, events: ToolEvent[], draft: SketchDraft = D, settings = DEFAULT_SETTINGS): ToolOutput<S> {
  let out: ToolOutput<S> = { state: tool.start(), draft, preview: [], fields: [] };
  for (const ev of events) out = tool.step(out.state, ev, out.draft, settings);
  return out;
}
const added = (o: ToolOutput<unknown>, base: SketchDraft = D) => o.draft.constraints.slice(base.constraints.length).map(({ id: _id, ...c }) => c);

describe('pickOf', () => {
  it('a point wins over an entity, entities are classified by type, empty space is undefined', () => {
    expect(pickOf(D, { kind: 'point', at: { x: 0, y: 0 }, pointId: 'p1', entityId: 'e1' })).toEqual({ kind: 'point', id: 'p1' });
    expect(pickOf(D, { kind: 'grid', at: { x: 0, y: 0 }, entityId: 'e3' })).toEqual({ kind: 'circle', id: 'e3' });
    expect(pickOf(D, { kind: 'grid', at: { x: 0, y: 0 }, entityId: 'e5' })).toEqual({ kind: 'arc', id: 'e5' });
    expect(pickOf(D, { kind: 'grid', at: { x: 0, y: 0 } })).toBeUndefined();
    expect(pickOf(D, { kind: 'point', at: { x: 0, y: 0 }, pointId: 'nope' })).toBeUndefined();
  });
});

describe('constraint tools: picks make exactly one constraint with the verified refs', () => {
  it.each<[string, ConstraintTool, ToolEvent[], object]>([
    ['horizontal on a line', horizontalTool, [ent('e1')], { type: 'horizontal', refs: ['e1'] }],
    ['horizontal on two points', horizontalTool, [pt('p1'), pt('p2')], { type: 'horizontal', refs: ['p1', 'p2'] }],
    ['vertical on a line', verticalTool, [ent('e2')], { type: 'vertical', refs: ['e2'] }],
    ['coincident', coincidentTool, [pt('p2'), pt('p3')], { type: 'coincident', refs: ['p2', 'p3'] }],
    ['equal lines', equalTool, [ent('e1'), ent('e2')], { type: 'equal', refs: ['e1', 'e2'] }],
    ['equal circle and arc', equalTool, [ent('e3'), ent('e5')], { type: 'equal', refs: ['e3', 'e5'] }],
    ['parallel', parallelTool, [ent('e1'), ent('e2')], { type: 'parallel', refs: ['e1', 'e2'] }],
    ['perpendicular', perpendicularTool, [ent('e2'), ent('e1')], { type: 'perpendicular', refs: ['e2', 'e1'] }],
    ['collinear', collinearTool, [ent('e1'), ent('e2')], { type: 'collinear', refs: ['e1', 'e2'] }],
    ['midpoint, point picked first', midpointTool, [pt('p3'), ent('e1')], { type: 'midpoint', refs: ['p3', 'e1'] }],
    ['midpoint, line picked first: the point still leads', midpointTool, [ent('e1'), pt('p3')], { type: 'midpoint', refs: ['p3', 'e1'] }],
    ['tangent line and circle', tangentTool, [ent('e1'), ent('e3')], { type: 'tangent', refs: ['e1', 'e3'] }],
    ['tangent circle and circle: apart means external', tangentTool, [ent('e3'), ent('e4')], { type: 'tangent', refs: ['e3', 'e4'] }],
    ['symmetric: two points then the axis', symmetricTool, [pt('p3'), pt('p4'), ent('e1')], { type: 'symmetric', refs: ['p3', 'p4', 'e1'] }],
    ['symmetric: axis first', symmetricTool, [ent('e1'), pt('p3'), pt('p4')], { type: 'symmetric', refs: ['p3', 'p4', 'e1'] }],
    ['fix writes the target position as value', fixTool, [pt('p2')], { type: 'fix', refs: ['p2'], value: [10, 2] }],
    ['concentric two circles', concentricTool, [ent('e3'), ent('e4')], { type: 'concentric', refs: ['e3', 'e4'] }],
    ['concentric circle and a point', concentricTool, [ent('e3'), pt('p1')], { type: 'concentric', refs: ['e3', 'p1'] }],
  ])('%s', (_name, tool, events, expected) => {
    const o = run(tool, events);
    expect(added(o)).toEqual([expected]);
    expect(o.state).toEqual({ picks: [] });          // ready for the next constraint
    expect(D.constraints).toEqual([]);                // the input draft is untouched
  });

  it('circles that nest are tangent internally, apart externally; a shared end point is named by `at`', () => {
    const nested: SketchDraft = { ...D, points: D.points.map((p) => (p.id === 'c2' ? { ...p, x: 21, y: 0 } : p)) };
    expect(added(run(tangentTool, [ent('e3'), ent('e4')], nested), nested)[0]).toMatchObject({ internal: true });
    const apart: SketchDraft = { ...D, points: D.points.map((p) => (p.id === 'c2' ? { ...p, x: 25, y: 0 } : p)) };
    expect(added(run(tangentTool, [ent('e3'), ent('e4')], apart), apart)[0]).not.toHaveProperty('internal');
    const meet: SketchDraft = { ...D, entities: [...D.entities, { id: 'e6', type: 'line', p1: 'p5', p2: 'p4' }] };
    expect(added(run(tangentTool, [ent('e5'), ent('e6')], meet), meet)[0]).toMatchObject({ type: 'tangent', refs: ['e5', 'e6'], at: 'p5' });
  });

  it('waits for the missing picks and says what it needs', () => {
    const o = run(parallelTool, [ent('e1')]);
    expect(o.draft.constraints).toEqual([]);
    expect(o.state.picks).toEqual([{ kind: 'line', id: 'e1' }]);
    expect(o.hint).toBe('app.sketch.hint.parallel.more');
  });

  it('ignores a pick that does not fit the tool and keeps the earlier ones', () => {
    const o = run(parallelTool, [ent('e1'), ent('e3')]);
    expect(o.hint).toBe('app.sketch.hint.pick.invalid');
    expect(o.state.picks).toHaveLength(1);
    expect(run(horizontalTool, [ent('e3')]).hint).toBe('app.sketch.hint.pick.invalid');
    expect(run(tangentTool, [ent('e1'), ent('e2')]).hint).toBe('app.sketch.hint.pick.invalid');   // two lines are never tangent
    expect(run(equalTool, [ent('e1'), ent('e3')]).hint).toBe('app.sketch.hint.pick.invalid');     // a length is not a radius
    expect(run(coincidentTool, [pt('p1'), ent('e1')]).hint).toBe('app.sketch.hint.pick.invalid');
    expect(run(midpointTool, [pt('p1'), ent('e1')]).hint).toBe('app.sketch.hint.pick.ownEnd');    // an end point is not the midpoint (solidcraft #8562)
    expect(run(midpointTool, [ent('e1'), pt('p2')]).hint).toBe('app.sketch.hint.pick.ownEnd');
    // a line's two ends are never made coincident: the line would shrink to a point (solidcraft #8611)
    const ends = run(coincidentTool, [pt('p2'), pt('p1')]);
    expect(ends.hint).toBe('app.sketch.hint.pick.lineEnds');
    expect(ends.draft.constraints).toHaveLength(0);
    expect(run(symmetricTool, [pt('p3'), pt('p4'), pt('p1')]).hint).toBe('app.sketch.hint.pick.invalid');
    expect(run(parallelTool, [ent('e1'), ent('e1')]).hint).toBe('app.sketch.hint.pick.same');
    expect(run(parallelTool, [{ type: 'click', at: { x: 0, y: 0 }, mods: M }]).hint).toBe('app.sketch.hint.pick.none');
  });

  it('Escape drops the picks', () => {
    expect(run(parallelTool, [ent('e1'), key('Escape')]).state.picks).toEqual([]);
  });

  it('fromSelection applies a tool to an existing selection', () => {
    const o = perpendicularTool.fromSelection([{ kind: 'line', id: 'e1' }, { kind: 'line', id: 'e2' }], D, DEFAULT_SETTINGS);
    expect(added(o)).toEqual([{ type: 'perpendicular', refs: ['e1', 'e2'] }]);
  });
});

describe('constraints that would add nothing are refused with a hint', () => {
  const withC = (...cs: Array<{ type: string; refs: string[]; value?: number | number[] }>): SketchDraft =>
    ({ ...D, constraints: cs.map((c, i) => ({ id: `k${i + 1}`, ...c })) });

  it('horizontal on a line that is already horizontal; conflict when it is vertical', () => {
    const h = withC({ type: 'horizontal', refs: ['e1'] });
    const o = run(horizontalTool, [ent('e1')], h);
    expect(o.hint).toBe('app.sketch.hint.constraint.exists');
    expect(o.draft.constraints).toHaveLength(1);
    expect(run(verticalTool, [ent('e1')], h).hint).toBe('app.sketch.hint.constraint.conflict');
  });

  it('knows a line is horizontal through parallel and perpendicular', () => {
    const d = withC({ type: 'horizontal', refs: ['e1'] }, { type: 'parallel', refs: ['e1', 'e2'] });
    expect([...orientations(d)]).toEqual([['e1', 'h'], ['e2', 'h']]);
    expect(run(horizontalTool, [ent('e2')], d).hint).toBe('app.sketch.hint.constraint.exists');
    expect(run(perpendicularTool, [ent('e1'), ent('e2')], d).hint).toBe('app.sketch.hint.constraint.conflict');
    const hv = withC({ type: 'horizontal', refs: ['e1'] }, { type: 'vertical', refs: ['e2'] });
    expect(run(perpendicularTool, [ent('e1'), ent('e2')], hv).hint).toBe('app.sketch.hint.constraint.redundant');
    expect(run(parallelTool, [ent('e1'), ent('e2')], hv).hint).toBe('app.sketch.hint.constraint.conflict');
  });

  it('duplicates of every kind', () => {
    const cases: Array<[ConstraintTool, ToolEvent[], Parameters<typeof withC>[0]]> = [
      [coincidentTool, [pt('p2'), pt('p3')], { type: 'coincident', refs: ['p3', 'p2'] }],
      [parallelTool, [ent('e1'), ent('e2')], { type: 'parallel', refs: ['e2', 'e1'] }],
      [equalTool, [ent('e1'), ent('e2')], { type: 'equal', refs: ['e1', 'e2'] }],
      [collinearTool, [ent('e1'), ent('e2')], { type: 'collinear', refs: ['e1', 'e2'] }],
      [midpointTool, [pt('p3'), ent('e1')], { type: 'midpoint', refs: ['p3', 'e1'] }],
      [tangentTool, [ent('e3'), ent('e4')], { type: 'tangent', refs: ['e4', 'e3'] }],
      [concentricTool, [ent('e3'), pt('c1')], { type: 'coincident', refs: ['c1', 'e3'] }],
      [fixTool, [pt('p2')], { type: 'fix', refs: ['p2'], value: [1, 1] }],
      [horizontalTool, [pt('p1'), pt('p2')], { type: 'horizontal', refs: ['p2', 'p1'] }],
    ];
    for (const [tool, events, existing] of cases) {
      const o = run(tool, events, withC(existing));
      expect([tool.kind, o.hint]).toEqual([tool.kind, 'app.sketch.hint.constraint.exists']);
      expect(o.draft.constraints).toHaveLength(1);
    }
  });

  it('transitive equality and a point that is already fixed', () => {
    const d = withC({ type: 'equal', refs: ['e3', 'e4'] }, { type: 'equal', refs: ['e4', 'e5'] });
    expect(run(equalTool, [ent('e3'), ent('e5')], d).hint).toBe('app.sketch.hint.constraint.redundant');
    const fixed: SketchDraft = { ...D, points: D.points.map((p) => (p.id === 'p1' ? { ...p, fixed: true } : p)) };
    expect(run(fixTool, [pt('p1')], fixed).hint).toBe('app.sketch.hint.constraint.exists');
  });

  it('points that are already coincident are not made coincident or aligned again', () => {
    const d = withC({ type: 'coincident', refs: ['p1', 'p2'] }, { type: 'coincident', refs: ['p2', 'p3'] });
    expect(run(coincidentTool, [pt('p1'), pt('p3')], d).hint).toBe('app.sketch.hint.constraint.exists');
    expect(run(horizontalTool, [pt('p1'), pt('p3')], d).hint).toBe('app.sketch.hint.constraint.redundant');
  });
});

describe('angleSpec', () => {
  const sk = (pts: Array<[string, number, number]>, lines: Array<[string, string, string]>): SketchDraft => ({
    ...D, points: pts.map(([id, x, y]) => ({ id, x, y })), entities: lines.map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })),
  });

  it('lines meeting at a vertex measure the interior angle there, whichever way they were drawn', () => {
    // A->B then B->C, C above the line: the turn A->B to B->C is counter-clockwise (exterior 63.4), interior at B is 116.6
    const d = sk([['A', 0, 0], ['B', 10, 0], ['C', 13, 6]], [['e1', 'A', 'B'], ['e2', 'B', 'C']]);
    const s = angleSpec(d, 'e1', 'e2')!;
    expect(s.measured).toBeCloseTo(116.565, 3);
    expect(s.refs).toEqual(['e2', 'e1']);       // ordered so the turn is counter-clockwise
    expect(s.extra).toEqual({ s2: -1 });        // line e1 is read B->A, away from the shared vertex
    const flipped = angleSpec(d, 'e2', 'e1')!;
    expect(flipped.measured).toBeCloseTo(116.565, 3);
    expect(flipped.refs).toEqual(s.refs);
  });

  it('lines with no common point use their drawn directions', () => {
    const d = sk([['a', 0, 0], ['b', 10, 0], ['c', 0, 5], ['d', 0, 15]], [['e1', 'a', 'b'], ['e2', 'c', 'd']]);
    expect(angleSpec(d, 'e1', 'e2')).toEqual({ refs: ['e1', 'e2'], extra: {}, measured: 90 });
    expect(angleSpec(d, 'e2', 'e1')).toMatchObject({ refs: ['e1', 'e2'], measured: 90 });
  });
});

describe('smart dimension', () => {
  const dim = (events: ToolEvent[], settings = DEFAULT_SETTINGS, draft = D) => run(dimensionTool, events, draft, settings);
  const value = (v: number, commit = true): ToolEvent => ({ type: 'field', id: 'value', value: v, commit });

  it('a line asks for its length; Enter commits the measured value', () => {
    const o = dim([ent('e1')]);
    expect(o.fields).toEqual([{ id: 'value', label: 'app.sketch.field.distance', value: Math.hypot(10, 2), locked: false, unit: 'length' }]);
    expect(o.preview).toEqual([{ kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 2 } }]);
    expect(o.draft.constraints).toEqual([]);
    const done = dimensionTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS);
    expect(added(done)).toEqual([{ type: 'distance', refs: ['p1', 'p2'], value: Math.hypot(10, 2) }]);
    expect(done.fields).toEqual([]);
    expect(done.state.picks).toEqual([]);
  });

  it('Tab and a committed field both commit; the typed number wins over the measured one', () => {
    expect(added(dim([ent('e1'), key('Tab')]))[0]).toMatchObject({ type: 'distance', value: Math.hypot(10, 2) });
    expect(added(dim([ent('e1'), value(25)]))).toEqual([{ type: 'distance', refs: ['p1', 'p2'], value: 25 }]);
  });

  it('an uncommitted value only previews; Enter then commits it; Escape drops it', () => {
    let o = dim([ent('e1'), value(40, false)]);
    expect(o.fields[0].value).toBe(40);
    expect(o.draft.constraints).toEqual([]);
    expect(added(dimensionTool.step(o.state, key('Enter'), o.draft, DEFAULT_SETTINGS))[0]).toMatchObject({ value: 40 });
    o = dimensionTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS);
    expect(o.fields[0].value).toBeCloseTo(Math.hypot(10, 2), 9);
    expect(o.state.picks).toHaveLength(1);                          // the first Escape only cleared the typed value
    expect(dimensionTool.step(o.state, key('Escape'), o.draft, DEFAULT_SETTINGS).state.picks).toEqual([]);
  });

  it('two points: distance, or the horizontal / vertical part with H / V', () => {
    expect(added(dim([pt('p1'), pt('p4'), key('Enter')]))).toEqual([{ type: 'distance', refs: ['p1', 'p4'], value: Math.hypot(8, 7) }]);
    expect(added(dim([pt('p1'), key('h'), pt('p4'), key('Enter')]))).toEqual([{ type: 'hdist', refs: ['p1', 'p4'], value: 8 }]);
    expect(added(dim([pt('p1'), pt('p4'), key('v'), key('Enter')]))).toEqual([{ type: 'vdist', refs: ['p1', 'p4'], value: 7 }]);
    expect(dim([pt('p1')]).fields).toEqual([]);                    // one point alone is not a dimension yet
  });

  it('a point and a line: distance to the line', () => {
    const o = dim([pt('p4'), ent('e1'), key('Enter')]);
    expect(added(o)).toEqual([{ type: 'pldist', refs: ['p4', 'e1'], value: Math.abs(10 * 7 - 2 * 8) / Math.hypot(10, 2) }]);
    expect(dim([ent('e1'), pt('p4'), key('Enter')]).draft.constraints).toHaveLength(1);
    expect(dim([ent('e1'), pt('p1')]).state.picks).toEqual([{ kind: 'point', id: 'p1' }]); // an end point is not off the line: starts over
  });

  it('a circle asks for its diameter, R switches to radius; an arc is a radius', () => {
    expect(added(dim([ent('e3'), key('Enter')]))).toEqual([{ type: 'diameter', refs: ['e3'], value: 6 }]);
    expect(added(dim([ent('e3'), key('r'), key('Enter')]))).toEqual([{ type: 'radius', refs: ['e3'], value: 3 }]);
    const radiusState = dim([key('r')]).state as DimensionState;
    expect(radiusState.radius).toBe(true);
    expect(added(dim([ent('e5'), value(7)]))).toEqual([{ type: 'radius', refs: ['e5'], value: 7 }]);
    expect(dim([ent('e3')]).preview).toEqual([{ kind: 'circle', c: { x: 20, y: 0 }, r: 3 }]);
  });

  it('two lines: the angle in degrees, with signs written only when -1', () => {
    const d: SketchDraft = { ...D, points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 0, y: 5 }, { id: 'd', x: 0, y: 15 }],
      entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'c', p2: 'd' }] };
    const o = dim([ent('e1'), ent('e2')], DEFAULT_SETTINGS, d);
    expect(o.fields[0]).toMatchObject({ label: 'app.sketch.field.angle', value: 90, unit: 'angle' });
    expect(added(dimensionTool.step(o.state, value(75), o.draft, DEFAULT_SETTINGS), d)).toEqual([{ type: 'angle', refs: ['e1', 'e2'], value: 75 }]);
  });

  it('two lines of one corner: their interior angle is offered at once as the value field, and a typed value becomes the dimension', () => {
    const d: SketchDraft = { ...D, points: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 0, y: 10 }],
      entities: [{ id: 'e1', type: 'line', p1: 'b', p2: 'a' }, { id: 'e2', type: 'line', p1: 'a', p2: 'c' }] };
    const o = dim([ent('e1'), ent('e2')], DEFAULT_SETTINGS, d);
    expect(o.fields).toHaveLength(1);
    expect(o.fields[0]).toMatchObject({ id: 'value', unit: 'angle', value: 90 });
    expect(added(dimensionTool.step(o.state, value(60), o.draft, DEFAULT_SETTINGS), d)).toMatchObject([{ type: 'angle', value: 60 }]);
  });

  it('refuses what cannot be dimensioned, a repeated dimension and bad values', () => {
    expect(dim([ent('e3'), ent('e1'), key('Enter')]).draft.constraints).toMatchObject([{ type: 'pldist' }]); // circle then line: its centre's distance to the line
    expect(dim([pt('p1'), ent('e3')]).state.pending?.spec.type).toBe('distance'); // point then circle: to the circle's centre
    const have: SketchDraft = { ...D, constraints: [{ id: 'k1', type: 'distance', refs: ['p2', 'p1'], value: 5 }] };
    const o = dim([ent('e1'), key('Enter')], DEFAULT_SETTINGS, have);
    expect(o.hint).toBe('app.sketch.hint.dimension.exists');
    expect(o.draft.constraints).toHaveLength(1);
    const neg = dim([ent('e1'), value(-3)]);
    expect(neg.hint).toBe('app.sketch.hint.dimension.value.invalid');
    expect(neg.draft.constraints).toEqual([]);
    expect(dim([{ type: 'click', at: { x: 0, y: 0 }, mods: M }]).hint).toBe('app.sketch.hint.pick.none');
  });

  it('shows no field when on-view values are off, but still commits', () => {
    const off = { ...DEFAULT_SETTINGS, onViewValues: 'off' as const };
    const o = dim([ent('e1')], off);
    expect(o.fields).toEqual([]);
    expect(added(dimensionTool.step(o.state, key('Enter'), o.draft, off))).toHaveLength(1);
  });
});

describe('reportStatus', () => {
  const base = { dof: 0, fullyDefined: false, conflicts: [], redundant: [], solved: true, state: 'under' as const, residual: 0 };
  it('turns the kernel status into a level, a hint and the blamed constraint', () => {
    expect(reportStatus(base)).toEqual({ level: 'under', ids: [], blamesAdded: false });
    expect(reportStatus({ ...base, state: 'full', fullyDefined: true }).hint).toBe('app.sketch.hint.status.fullyDefined');
    expect(reportStatus({ ...base, state: 'over', conflicts: ['k4'] }, 'k4')).toEqual({ level: 'conflict', hint: 'app.sketch.hint.status.overConstrained', ids: ['k4'], blamesAdded: true });
    expect(reportStatus({ ...base, state: 'over', redundant: ['k2'] }, 'k4')).toMatchObject({ level: 'redundant', blamesAdded: false });
    expect(reportStatus({ ...base, solved: false })).toMatchObject({ level: 'unsolved', hint: 'app.sketch.hint.status.unsolved' });
  });

  it('a coded kernel problem names why: the refused solve first, then the picks', () => {
    const shrunk = { code: 'sketchCurveShrunk', message: 'that would shrink e8 to a point', entity: 'e8' };
    const twice = { code: 'sketchSameCurveTwice', message: 'k1 picks e1 twice', constraint: 'k1', entity: 'e1' };
    const st = { ...base, solved: false, problems: [twice, shrunk] };
    expect(problemHint(st)).toBe('app.sketch.problem.curveShrunk');
    expect(refusedBy(st)).toEqual(shrunk);
    expect(reportStatus(st)).toMatchObject({ level: 'unsolved', hint: 'app.sketch.problem.curveShrunk' });
    expect(problemHint({ ...base, problems: [twice] })).toBe('app.sketch.problem.sameCurveTwice');
    expect(refusedBy({ ...base, problems: [twice] })).toBeUndefined();
    expect(problemHint({ ...base, problems: [{ code: 'somethingNew', message: 'x' }] })).toBeUndefined();
    expect(problemHint(base)).toBeUndefined();
  });
});

