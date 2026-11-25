import { describe, expect, it } from 'vitest';
import { Interpreter } from './interpreter';

const scratch = { async build() { return []; } };
const run = (I: Interpreter, c: string, a: object = {}) => I.runSync(c, a) as any;
const square = (I: Interpreter, name = 'Sq', plane: unknown = 'XY') => {
  run(I, 'sketch.create', { name, plane });
  run(I, 'sketch.line', { points: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true });
};

describe('sketches the rail and nut plugin draws', () => {
  it('lines, arcs, circles and points get SolidCraft ids and a shared end point is one point', () => {
    const I = new Interpreter(scratch);
    expect(run(I, 'sketch.create', { name: 'S', plane: 'XY' }).sketch).toBe(1);
    expect(run(I, 'sketch.line', { points: [[0, 0], [4, 0], [4, 3]] }).curves).toEqual(['l1', 'l2']);
    expect(run(I, 'sketch.arc.three_point', { start: [4, 3], through: [2, 5], end: [0, 3] }).curves).toEqual(['a1']);
    expect(run(I, 'sketch.circle.center', { center: [1, 1], diameter: 1, id: 'hole1' }).curves).toEqual(['hole1']);
    expect(run(I, 'sketch.point', { point: [9, 9], id: 'p9' }).points).toEqual(['p9']);
    const info = run(I, 'sketch.inspect', { sketch: 1 });
    expect(info.points.map((p: any) => p.id)).toEqual(expect.arrayContaining(['l1.start', 'l1.end', 'l2.end', 'a1.end', 'hole1.center', 'p9']));
    expect(info.points.filter((p: any) => p.at[0] === 4 && p.at[1] === 3)).toHaveLength(1);
  });
  it('a closed square is one profile with its area; a circle inside is a hole and a region of its own', () => {
    const I = new Interpreter(scratch);
    square(I);
    run(I, 'sketch.circle.center', { center: [5, 5], diameter: 4, id: 'c1' });
    const prof = run(I, 'sketch.inspect', {}).profiles;
    expect(prof).toHaveLength(2);
    expect(prof[0].area_mm2).toBeCloseTo(100 - Math.PI * 4, 6);
    expect(prof[0].holes).toEqual([['c1']]);
    expect(prof[1].area_mm2).toBeCloseTo(Math.PI * 4, 6);
  });
  it('an arc closes a profile (half disc) and its area includes the segment', () => {
    const I = new Interpreter(scratch);
    run(I, 'sketch.create', { name: 'S', plane: 'XY' });
    run(I, 'sketch.arc.three_point', { start: [-5, 0], through: [0, 5], end: [5, 0] });
    run(I, 'sketch.line', { points: [[5, 0], [-5, 0]] });
    expect(run(I, 'sketch.inspect', {}).profiles[0].area_mm2).toBeCloseTo(Math.PI * 25 / 2, 6);
  });
  it('a point is taken by its id, a refused id names itself', () => {
    const I = new Interpreter(scratch);
    run(I, 'sketch.create', { name: 'S', plane: 'XY' });
    run(I, 'sketch.circle.center', { center: [3, 4], diameter: 2, id: 'hole1' });
    run(I, 'sketch.circle.center', { center: 'hole1.center', diameter: 3, id: 'access1' });
    const c = run(I, 'sketch.inspect', {}).curves.find((x: any) => x.id === 'access1');
    expect(c.center_at).toEqual([3, 4]);
    expect(() => run(I, 'sketch.circle.center', { center: 'nope.center', diameter: 3 })).toThrow(/no point/);
    expect(() => run(I, 'sketch.circle.center', { center: [0, 0], diameter: 3, id: 'hole1' })).toThrow(/already used/);
  });
  it('constraints, dimensions and fixes are recorded and answered, fix marks the point', () => {
    const I = new Interpreter(scratch);
    run(I, 'sketch.create', { name: 'S', plane: 'XY' });
    run(I, 'sketch.point', { point: [1, 2], id: 'p1' });
    expect(run(I, 'sketch.constraint.fix', { entities: ['p1'], fixed: true }).constraints).toHaveLength(1);
    expect(run(I, 'sketch.dimension', { entities: ['p1'], type: 'horizontal', value: 1 }).constraints).toHaveLength(1);
    expect(run(I, 'sketch.inspect', {}).points[0].fixed).toBe(true);
    expect(() => run(I, 'sketch.constraint.fix', { entities: ['zz'] })).toThrow(/no curve/);
  });
  it('sketch.replace copies another sketch\'s geometry and keeps the new sketch\'s plane', () => {
    const I = new Interpreter(scratch);
    square(I, 'A');
    run(I, 'sketch.finish');
    run(I, 'sketch.create', { name: 'B', plane: 'XZ' });
    run(I, 'sketch.replace', { from: 1 });
    const b = run(I, 'sketch.inspect', {});
    expect(b.curves).toHaveLength(4);
    expect(b.plane.y_dir).toEqual([0, 0, -1]);
  });
});

describe('features: numbers, extrude, sweep, sphere', () => {
  it('features are numbered from 1 in order, timeline.inspect reads them back, timeline.group takes the numbers', () => {
    const I = new Interpreter(scratch);
    run(I, 'component.create', { name: 'Rail', activate: true });
    square(I, 'Rail: Section'); run(I, 'sketch.finish');
    const x = run(I, 'solid.extrude', { sketch: 1, distance: 20, operation: 'new', body_name: 'Rail', name: 'Rail: Rail', profiles: [{ point: [5, 5] }] });
    expect(x).toMatchObject({ feature: 2, name: 'Rail: Rail', created_bodies: ['Rail'], bodies: ['Rail'] });
    const f = run(I, 'timeline.inspect', { feature: 2 });
    expect(f).toMatchObject({ id: 2, type: 'extrude', suppressed: false, error: null, omitted: [] });
    expect(f.definition).toMatchObject({ sketch: 1, component: 1, operation: 'new' });
    const s = run(I, 'timeline.inspect', { feature: 1 });
    expect(s.omitted).toEqual([expect.objectContaining({ field: 'sketch' })]);
    expect(run(I, 'timeline.group', { name: 'Rail', features: [1, 2] })).toMatchObject({ count: 2 });
    expect(run(I, 'model.body_features', {})).toEqual({ bodies: [{ body: 'Rail', features: [{ id: 1 }, { id: 2 }] }] });
    const list = run(I, 'component.list', {}).components.find((c: any) => c.name === 'Rail');
    expect(list).toMatchObject({ bodies: ['Rail'], features: ['Rail: Rail'], sketches: ['Rail: Section'] });
    expect(() => run(I, 'timeline.inspect', { feature: 9 })).toThrow(/no feature/);
  });
  it('a profile pick by point or by curves chooses the region; no profile is an error', () => {
    const I = new Interpreter(scratch);
    square(I);
    run(I, 'sketch.circle.center', { center: [5, 5], diameter: 4, id: 'c1' });
    run(I, 'sketch.finish');
    expect(run(I, 'solid.extrude', { sketch: 1, distance: 5, profiles: [{ curves: ['c1'] }], body_name: 'Pin' }).created_bodies).toEqual(['Pin']);
    expect(() => run(I, 'solid.extrude', { sketch: 1, distance: 5, profiles: [{ point: [50, 50] }] })).toThrow(/no profile/);
  });
  it('a straight sweep square to its path is recorded as the extrusion of the length of the path', () => {
    const I = new Interpreter(scratch);
    run(I, 'sketch.create', { name: 'Path', plane: 'XY' }); run(I, 'sketch.line', { points: [[0, 0], [30, 40]] }); run(I, 'sketch.finish');
    run(I, 'construct.plane.along_path', { path: { sketch: 1, curve: 'l1' }, t: 0, name: 'Start' });
    run(I, 'sketch.create', { name: 'Section', plane: 'Start' });
    run(I, 'sketch.circle.center', { center: [0, 0], diameter: 6 }); run(I, 'sketch.finish');
    const r = run(I, 'solid.sweep', { sketch: 3, profiles: [{ point: [1, 0] }], path_sketch: 1, path: ['l1'], operation: 'new', body_name: 'Pipe', name: 'Pipe: Rail' });
    expect(r.created_bodies).toEqual(['Pipe']);
    expect(I.script()).toContain('.extrude(50,');
    expect(() => run(I, 'solid.sweep', { sketch: 3, path_sketch: 1, path: ['l1', 'l2'] })).toThrow(/one straight line/);
  });
  it('a plane through the axis and a point has x along the axis and y towards the point', () => {
    const I = new Interpreter(scratch);
    run(I, 'sketch.create', { name: 'Path', plane: 'XY' }); run(I, 'sketch.line', { points: [[0, 0], [100, 0]] }); run(I, 'sketch.finish');
    run(I, 'construct.plane.along_path', { path: { sketch: 1, curve: 'l1' }, t: 0, name: 'Start' });
    run(I, 'sketch.create', { name: 'Side', plane: 'Start' }); run(I, 'sketch.point', { id: 'side0', point: [0, 1] }); run(I, 'sketch.finish');
    run(I, 'construct.plane.axis_point', { axis: { sketch: 1, curve: 'l1' }, point: { sketch: 3, point: 'side0' }, name: 'Face' });
    run(I, 'sketch.create', { name: 'On face', plane: 'Face', offset: 10 });
    const info = run(I, 'sketch.inspect', {});
    expect(info.plane.x_dir.map(Math.round)).toEqual([1, 0, 0]);
    expect(Math.abs(info.plane.y_dir[0])).toBeLessThan(1e-9);
    expect(Math.hypot(...(info.plane.origin as number[]))).toBeCloseTo(10, 6);
  });
  it('solid.sphere joins a ball to a body, answers the feature, and refuses an unknown body', () => {
    const I = new Interpreter(scratch);
    square(I); run(I, 'sketch.finish');
    run(I, 'solid.extrude', { sketch: 1, distance: 5, body_name: 'Nut' });
    const r = run(I, 'solid.sphere', { center: [5, 5, 5], radius: 2, operation: 'join', targets: ['Nut'], name: 'Nut: Ball' });
    expect(r).toMatchObject({ name: 'Nut: Ball', changed_bodies: ['Nut'], created_bodies: [] });
    expect(I.script()).toContain('p.sphere(2,');
    expect(() => run(I, 'solid.sphere', { radius: 1, operation: 'join', targets: ['Nope'] })).toThrow(/no body/);
  });
  it('a tap of a bore that is already the tap drill cuts nothing; a tap into a solid does', () => {
    const I = new Interpreter(scratch);
    run(I, 'sketch.create', { name: 'S', plane: 'XY' });
    run(I, 'sketch.line', { points: [[-10, -10], [10, -10], [10, 10], [-10, 10]], closed: true });
    run(I, 'sketch.circle.center', { center: [0, 0], diameter: 4.2 }); run(I, 'sketch.finish');
    run(I, 'solid.extrude', { sketch: 1, distance: 50, body_name: 'Rail', profiles: [{ point: [8, 8] }] });
    run(I, 'solid.hole', { name: 'Tap', position: [0, 0, 0], direction: [0, 0, 1], thread: 'M5', depth: 12, targets: ['Rail'] });
    run(I, 'solid.hole', { name: 'Big', position: [8, 0, 0], direction: [0, 0, 1], thread: 'M5', depth: 12, targets: ['Rail'] });
    const s = I.script();
    expect(s).not.toContain('Tap @');
    expect(s).toContain('Big @');
    expect(() => run(I, 'solid.hole', { name: 'X', position: [0, 0, 0], direction: [0, 0, 1], thread: 'M99', depth: 1, targets: ['Rail'] })).toThrow(/tap drill/);
  });
});

describe('components, placements and reads', () => {
  it('a placement by matrix moves the first part, a copy is a new set of bodies made from the part at the origin', () => {
    const I = new Interpreter(scratch);
    run(I, 'component.create', { name: 'Rail', activate: true });
    square(I); run(I, 'sketch.finish');
    run(I, 'solid.extrude', { sketch: 1, distance: 5, body_name: 'Rail' });
    run(I, 'component.activate', { component: 0 });
    run(I, 'component.create', { name: 'Folder', parent: 0, activate: false });
    const c = run(I, 'occurrence.copy', { component: 1, parent: 0 });
    expect(c.occurrence).toBeGreaterThan(1);
    run(I, 'occurrence.move', { occurrence: 1, to_matrix: [[1, 0, 0, 100], [0, 1, 0, 0], [0, 0, 1, 0]] });
    run(I, 'occurrence.move', { occurrence: c.occurrence, to_matrix: [[0, -1, 0, 0], [1, 0, 0, 50], [0, 0, 1, 0]] });
    expect(run(I, 'occurrence.reparent', { occurrence: c.occurrence, parent: 2 })).toMatchObject({ parent: 2 });
    const s = I.script();
    expect(s.indexOf('copy: true')).toBeGreaterThan(-1);
    expect(s.indexOf('copy: true')).toBeLessThan(s.indexOf('translate: [100'));
    expect(s).toContain('"Rail (Rail:2)"');
    expect(s).toMatch(/angle: 90/);
  });
  it('parameters.list, parameters.users, appearance.list and document.metadata.set answer in SolidCraft\'s shape', () => {
    const I = new Interpreter(scratch);
    run(I, 'parameters.add', { name: 'w', expression: '20', comment: 'width' });
    expect(run(I, 'parameters.list', {}).parameters[0]).toMatchObject({ name: 'w', expression: '20', value: 20, source: 'user' });
    expect(run(I, 'parameters.users', { name: 'w' })).toEqual({ name: 'w', users: [], drives: [] });
    expect(() => run(I, 'parameters.users', { name: 'zz' })).toThrow(/no parameter/);
    expect(run(I, 'appearance.list', {})).toMatchObject({ in_design: [], bodies: {}, components: [] });
    expect(run(I, 'document.metadata.set', { key: 'a', value: 1 })).toEqual({ metadata: { a: 1 }, changed: ['a'] });
    expect(run(I, 'document.metadata.set', { values: { a: 1, b: 'x' } }).changed).toEqual(['b']);
    expect(run(I, 'browser.visibility', { items: [1], visible: false })).toMatchObject({ visible: false, changed: 1 });
    expect(() => run(I, 'browser.visibility', { items: [1] })).toThrow(/visible/);
  });
  it('component.properties measures the component\'s bodies from a build, with a material density', async () => {
    const I = new Interpreter({ async build() { return [{ name: 'Rail', volume: 2000, bbox: { min: [0, 0, 0], max: [10, 10, 20] } }]; } });
    run(I, 'component.create', { name: 'Rail', activate: true });
    square(I); run(I, 'sketch.finish');
    run(I, 'solid.extrude', { sketch: 1, distance: 20, body_name: 'Rail' });
    const r = await I.run('component.properties', { component: 1, descendants: false }) as any;
    expect(r.body_count).toBe(1);
    expect(r.bodies[0]).toMatchObject({ name: 'Rail', material: 'Steel', closed: true });
    expect(r.total.volume_mm3).toBe(2000);
    expect(r.total.mass_g).toBeCloseTo(15.7, 6);
  });
});

describe('a join or intersect with several targets', () => {
  const run = async (op: string, targets?: string[]) => {
    const I = new Interpreter({ async build() { return []; } } as never);
    for (const n of ['A', 'B']) await I.run('solid.box', { name: n, body_name: n, corner: [0, 0, 0], length: 10, width: 10, height: 10 });
    await I.run('solid.box', { name: 'T', body_name: 'T', operation: op, ...(targets ? { targets } : {}), corner: [5, 5, 5], length: 10, width: 10, height: 10 });
    return I.script({ part: 'P' });
  };
  it('a join with two targets merges both into the first target body', async () => {
    const s = await run('join', ['A', 'B']);
    expect(s).toContain(`p.combine('union', "A", ["T (join)", "B"])`);
  });
  it('an intersect with two targets trims each to the tool, keeping the tool until the last', async () => {
    const s = await run('intersect', ['A', 'B']);
    expect(s).toContain(`p.combine('intersect', "A", ["T (intersect)"], { keepTools: true })`);
    expect(s).toContain(`p.combine('intersect', "B", ["T (intersect)"]);`);
  });
});
