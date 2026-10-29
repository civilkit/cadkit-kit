// What a current converter writes into a .solidcraft file and the importer carries: symmetric, two-sided and tapered extents, regions picked by whole
// boundaries, revolves about any axis, holes up to a face, circular patterns of features, mirrors of bodies, tori, sheet bases, sweeps along line and arc
// paths, lofts to a point and along rails, ellipses, more sketch constraints, sub-assemblies, hidden placements and timeline folders.
// Every document is built here; no file of a corpus is read.
import { describe, expect, it } from 'vitest';
import { importSolidcraftDocument } from './import';

type Rec = Record<string, any>;
const doc = (features: unknown[], extra: Rec = {}) => ({ format: 'solidcraft/33', units: 'mm', params: [], features, ...extra });
/** A 10 x 10 square on their plane (default XY) from the origin; `curves` a to d are l1..l4. */
const square = (id: number, over: Rec = {}, plane: Rec = { type: 'origin', name: 'XY' }) => ({
  id, name: `S${id}`, type: 'sketch', suppressed: false, plane,
  sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [10, 0] }, { id: 'p3', pos: [10, 10] }, { id: 'p4', pos: [0, 10] }],
    curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }],
    constraints: [{ id: 'k1', type: 'coincident', p: 0, q: 1 }], ...over },
});
const extrude = (id: number, sk: number, extent: Rec, over: Rec = {}) => ({ id, name: `E${id}`, type: 'extrude', suppressed: false, sketch: sk, profiles: { type: 'all' }, operation: 'new_body', extent: { convention: 'total_distance', direction: 'positive', distance: '5', ...extent }, ...over });
const run = async (features: unknown[], extra: Rec = {}) => {
  const r = await importSolidcraftDocument(doc(features, extra), 'p');
  return { r, f: (r.part?.features ?? []) as Rec[], row: (i: number) => r.rows[i] };
};
const ofType = (f: Rec[], type: string) => f.filter((x) => x.type === type);

describe('extrude extents', () => {
  it('a symmetric extent is the total distance centred on the sketch plane', async () => {
    const { f, r } = await run([square(1), extrude(2, 1, { direction: 'symmetric', distance: '8' })]);
    expect(r.geometryComplete).toBe(true);
    expect(ofType(f, 'extrude')[0]).toMatchObject({ end: 'mid', depth: 8, op: 'add' });
    expect(ofType(f, 'extrude')[0].flip).toBeUndefined();
  });
  it('a symmetric cut keeps its end, and the legacy convention counts the distance on each side', async () => {
    const { f } = await run([square(1), extrude(2, 1, {}), square(3), extrude(4, 3, { direction: 'symmetric', distance: '3', convention: 'legacy_per_side' }, { operation: 'cut' })]);
    expect(ofType(f, 'extrude')[1]).toMatchObject({ end: 'mid', depth: 6, op: 'cut' });
    expect(ofType(f, 'extrude')[1].flip).toBeUndefined();
  });
  it('symmetric through all runs through the body both ways', async () => {
    const { f } = await run([square(1), extrude(2, 1, {}), square(3), extrude(4, 3, { direction: 'symmetric', through_all: true, distance: '0 mm' }, { operation: 'cut' })]);
    expect(ofType(f, 'extrude')[1]).toMatchObject({ end: 'throughBoth', op: 'cut' });
  });
  it('a second distance starts the profile that far back on an offset plane and runs both distances together', async () => {
    const { f, r } = await run([square(1), extrude(2, 1, { distance: '6', distance2: '4' })]);
    expect(r.geometryComplete).toBe(true);
    const ex = ofType(f, 'extrude')[0], moved = ofType(f, 'sketch').find((x) => x.id === ex.sketch)!, plane = f.find((x) => x.type === 'plane')!;
    expect(ex).toMatchObject({ end: 'blind', depth: 10, op: 'add' });
    expect(ex.flip).toBeUndefined();
    expect(moved.name).toBe('E2 start');
    expect(plane).toMatchObject({ mode: 'offset', base: { kind: 'std', id: 'top' }, offset: -4 });   // their z is our y: 4 mm below the sketch plane
  });
  it('a second distance on a sketch whose normal points the other way starts on the other side', async () => {
    const xz = { type: 'origin', name: 'XZ' };   // their XZ plane faces our -z, so "back" is our +z
    const { f } = await run([square(1, {}, xz), extrude(2, 1, { distance: '6', distance2: '4' })]);
    expect(f.find((x) => x.type === 'plane')).toMatchObject({ offset: 4, base: { id: 'front' } });
    expect(ofType(f, 'extrude')[0]).toMatchObject({ depth: 10, flip: true });
  });
  it('a taper is the draft angle: a positive one grows the profile (draftOut), a negative one shrinks it', async () => {
    const grow = await run([square(1), extrude(2, 1, { taper: '5 deg' })]);
    expect(ofType(grow.f, 'extrude')[0]).toMatchObject({ draft: 5, draftOut: true, depth: 5 });
    const shrink = await run([square(1), extrude(2, 1, { taper: '-2.5 deg' })]);
    expect(ofType(shrink.f, 'extrude')[0]).toMatchObject({ draft: 2.5 });
    expect(ofType(shrink.f, 'extrude')[0].draftOut).toBeUndefined();
  });
  it('what has no counterpart is reported, not dropped: a taper with a second distance, an end offset from a face', async () => {
    const a = await run([square(1), extrude(2, 1, { taper: '5 deg', distance2: '1' })]);
    expect(a.row(1)).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/tapered extrude/) });
    const b = await run([square(1), extrude(2, 1, { to: [0, 0, 20], to_offset: '2 mm' })]);
    expect(b.row(1)).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/offset from a face/) });
    const c = await run([square(1), extrude(2, 1, { distance2: '1', direction: 'symmetric' })]);
    expect(c.row(1).status).toBe('unsupported');
  });
  it('a start from a face moves the profile to the plane through the face point, and a stop at a face on a tilted sketch plane is found along its normal', async () => {
    const { f, r } = await run([square(1), extrude(2, 1, { from: [3, 4, 7], distance: '2' })]);
    expect(r.rows[1].notes?.[0]).toMatch(/starts at a face/);
    expect(f.find((x) => x.type === 'plane')).toMatchObject({ mode: 'offset', offset: 7 });
    expect(ofType(f, 'extrude')[0]).toMatchObject({ depth: 2 });
    const tilted = { type: 'custom', plane: { origin: [0, 0, 0], x_dir: [1, 0, 0], y_dir: [0, 0.6, 0.8] } };
    const stop = await run([square(1, {}, tilted), extrude(2, 1, { to: [0, 0, 10], distance: '1' })]);
    // the sketch normal is (0, -0.8, 0.6) in their world; the point (0, 0, 10) lies 6 along it
    expect(ofType(stop.f, 'extrude')[0].depth).toBeCloseTo(6, 9);
  });
});

describe('profiles picked by whole boundaries', () => {
  // a 40 x 20 plate with a round hole, and a second round shape apart from it
  const plate = (over: Rec = {}) => ({
    id: 1, name: 'Plate', type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' },
    sketch: {
      points: [{ id: 'origin', pos: [0, 0] }, { id: 'a', pos: [0, 0] }, { id: 'b', pos: [40, 0] }, { id: 'c', pos: [40, 20] }, { id: 'd', pos: [0, 20] }, { id: 'h', pos: [20, 10] }, { id: 'j', pos: [70, 10] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }, { id: 'c1', type: 'circle', c: 5, r: 4 }, { id: 'c2', type: 'circle', c: 6, r: 6 }],
      constraints: [], ...over,
    },
  });
  it('the part picks a region by one curve of its outer boundary and keeps the holes by itself', async () => {
    const { f } = await run([plate(), extrude(2, 1, {}, { profiles: { type: 'whole_boundaries', profiles: [{ outer: ['l1', 'l2', 'l3', 'l4'], holes: [['c1']] }] } })]);
    // l1 is the first curve of the outline that no hole uses; the hole circle c1 (e5) is not listed, or it would add the disc
    expect(ofType(f, 'extrude')[0].regions).toEqual(['e1']);
  });
  it('several profiles give one curve each, and a curve two profiles share is passed over for one that only one uses', async () => {
    const { f } = await run([plate(), extrude(2, 1, {}, { profiles: { type: 'whole_boundaries', profiles: [{ outer: ['l1', 'l2'], holes: [] }, { outer: ['l1', 'c2'], holes: [] }] } })]);
    expect(ofType(f, 'extrude')[0].regions).toEqual(['e2', 'e6']);
  });
  it('an empty selection and an outline that is not in the sketch are reported', async () => {
    const a = await run([plate(), extrude(2, 1, {}, { profiles: { type: 'whole_boundaries', profiles: [] } })]);
    expect(a.row(1).status).toBe('unsupported');
    const b = await run([plate(), extrude(2, 1, {}, { profiles: { type: 'whole_boundaries', profiles: [{ outer: ['zz'], holes: [] }] } })]);
    expect(b.row(1).reason).toMatch(/not in the sketch/);
  });
});

describe('revolves', () => {
  const rev = (over: Rec = {}) => ({ id: 3, name: 'R', type: 'revolve', suppressed: false, sketch: 2, profiles: { type: 'all' }, axis: { type: 'sketch_axis', axis: 'y' }, angle: '360 deg', operation: 'new_body', convention: 'sketch_normal', ...over });
  // a profile 5..15 wide and 0..20 high on their XZ plane (x right, z up)
  const half = square(2, { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [5, 0] }, { id: 'p2', pos: [15, 0] }, { id: 'p3', pos: [15, 20] }, { id: 'p4', pos: [5, 20] }, { id: 'p5', pos: [0, 0] }, { id: 'p6', pos: [0, 30] }], curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }, { id: 'ax', type: 'line', a: 5, b: 6, construction: true }] }, { type: 'origin', name: 'YZ' });
  it('about a line of its own sketch the revolve uses that line as it is', async () => {
    const { f, r } = await run([half, rev({ axis: { type: 'sketch_line', curve: 'ax' } })]);
    expect(r.geometryComplete).toBe(true);
    const rv = ofType(f, 'revolve')[0];
    expect(rv).toMatchObject({ axis: 'e5', angle: 360, end: 'blind' });
    expect(ofType(f, 'sketch')[0].entities.find((e: Rec) => e.id === 'e5')).toMatchObject({ type: 'line', construction: true });
  });
  it('about a line in space the axis is drawn into the sketch where the line lies in its plane', async () => {
    const { f } = await run([half, rev({ axis: { type: 'line', origin: [0, 3, 0], dir: [0, 0, 2] } })]);
    const sk = ofType(f, 'sketch')[0], rv = ofType(f, 'revolve')[0];
    const line = sk.entities.find((e: Rec) => e.id === rv.axis);
    expect(line).toMatchObject({ type: 'line', construction: true });
    const pt = (id: string) => sk.points.find((p: Rec) => p.id === id);
    // their YZ plane is our right plane (x = their y): the line passes x = 3 and runs along the sketch's y
    expect([pt(line.p1).x, pt(line.p1).y]).toEqual([3, 0]);
    expect([pt(line.p2).x, pt(line.p2).y]).toEqual([3, 10]);
  });
  it('a line out of the sketch plane or across a straight sketch curve is refused', async () => {
    const off = await run([half, rev({ axis: { type: 'line', origin: [4, 3, 0], dir: [0, 0, 1] } })]);
    expect(off.row(1).reason).toMatch(/not in the plane/);
    const arc = await run([half, rev({ axis: { type: 'sketch_line', curve: 'zz' } })]);
    expect(arc.row(1).reason).toMatch(/not a straight line/);
  });
  it('a symmetric revolve turns half the angle each way from the sketch plane; a full turn has no sides', async () => {
    const part = await run([half, rev({ angle: '90 deg', symmetric: true })]);
    expect(ofType(part.f, 'revolve')[0]).toMatchObject({ end: 'mid', angle: 90 });
    const full = await run([half, rev({ angle: '360 deg', symmetric: true })]);
    expect(ofType(full.f, 'revolve')[0]).toMatchObject({ end: 'blind', angle: 360 });
  });
  it('regions are picked as for an extrude', async () => {
    const { f } = await run([half, rev({ profiles: { type: 'whole_boundaries', profiles: [{ outer: ['l1', 'l2', 'l3', 'l4'], holes: [] }] } })]);
    expect(ofType(f, 'revolve')[0].regions).toEqual(['e1']);
    const loops = await run([half, rev({ profiles: { type: 'curves', loops: [['l1', 'l2', 'l3', 'l4']] } })]);
    expect(ofType(loops.f, 'revolve')[0].regions).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect((await run([half, rev({ profiles: { type: 'regions' } })])).row(1).reason).toMatch(/profile selection/);
  });
  it('a coil swept from a sketch profile says its helix has no stated radius', async () => {
    const { row } = await run([half, { id: 3, name: 'Spring', type: 'coil', suppressed: false, sketch: 2, profiles: { type: 'all' }, base: [0, 0, 0], axis: [0, 0, 1], pitch: '4 mm', turns: '5', operation: 'new_body' }]);
    expect(row(1)).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(/radius of its helix/) });
  });
});

describe('holes up to a face', () => {
  const plate = { id: 1, name: 'Plate', type: 'box', suppressed: false, corner: [0, 0, 0], length: 40, width: 40, height: 20, operation: 'new_body' };
  const hole = (over: Rec = {}) => ({ id: 2, name: 'H', type: 'hole', suppressed: false, diameter: '4 mm', direction: [0, 0, -1], hole: { type: 'simple' }, position: [10, 10, 20], ...over });
  it('the depth is the distance to the plane through the face point across the drill', async () => {
    const { f, r } = await run([plate, hole({ to: [30, 30, 12.5] })]);
    expect(r.geometryComplete).toBe(true);
    expect(ofType(f, 'hole')[0]).toMatchObject({ end: 'blind', depth: 7.5, diameter: 4 });
  });
  it('a face behind the start is reported', async () => {
    const { row } = await run([plate, hole({ to: [30, 30, 25] })]);
    expect(row(1).reason).toMatch(/at or behind/);
  });
});

describe('patterns, mirrors, tori and sheets', () => {
  const base = [square(1), extrude(2, 1, {}), square(3, {}, { type: 'origin', name: 'XY' }), extrude(4, 3, { distance: '2' }, { operation: 'join', name: 'Boss' })];
  it('a circular pattern of features about a coordinate axis through the origin is a circular pattern of the kernel', async () => {
    const { f, r } = await run([...base, { id: 5, name: 'Ring', type: 'pattern', suppressed: false, features: ['Boss'], pattern: { type: 'circular', origin: [0, 0, 0], axis: [0, 0, 1], count: '6', angle: '360 deg' } }]);
    expect(r.geometryComplete).toBe(true);
    // their z axis is our y axis
    expect(ofType(f, 'cpattern')[0]).toMatchObject({ seeds: ['F4'], axis: { kind: 'axis', axis: 'y' }, count: 6, angle: 360, equal: true });
    expect(ofType(f, 'cpattern')[0].reverse).toBeUndefined();
  });
  it('an axis pointing the other way, or a negative angle, reverses the turn; both together do not', async () => {
    const turn = async (axis: number[], angle: string) => ofType((await run([...base, { id: 5, name: 'Ring', type: 'pattern', suppressed: false, features: ['Boss'], pattern: { type: 'circular', origin: [0, 0, 0], axis, count: 3, angle } }])).f, 'cpattern')[0].reverse;
    expect(await turn([0, 0, -1], '90 deg')).toBe(true);
    expect(await turn([0, 0, 1], '-90 deg')).toBe(true);
    expect(await turn([0, 0, -1], '-90 deg')).toBeUndefined();
  });
  it('an axis that is not a coordinate axis through the origin is reported', async () => {
    const off = await run([...base, { id: 5, name: 'Ring', type: 'pattern', suppressed: false, features: ['Boss'], pattern: { type: 'circular', origin: [5, 0, 0], axis: [0, 0, 1], count: 3, angle: '360 deg' } }]);
    expect(off.row(4).reason).toMatch(/does not pass through the origin/);
    const tilted = await run([...base, { id: 5, name: 'Ring', type: 'pattern', suppressed: false, features: ['Boss'], pattern: { type: 'circular', origin: [0, 0, 0], axis: [0, 1, 1], count: 3, angle: '360 deg' } }]);
    expect(tilted.row(4).status).toBe('unsupported');
  });
  it('a mirror can be the seed of a pattern, and a pattern the seed of a mirror', async () => {
    const mirror = { id: 5, name: 'Mir', type: 'mirror', suppressed: false, features: ['Boss'], plane: { type: 'custom', plane: { origin: [0, 0, 0], x_dir: [0, 1, 0], y_dir: [0, 0, 1] } } };
    const lin = { id: 6, name: 'Row', type: 'pattern', suppressed: false, features: ['Mir'], pattern: { type: 'rectangular', dir1: [0, 1, 0], count1: '3', spacing1: '20 mm' } };
    const { f, r } = await run([...base, mirror, lin]);
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true);
    expect(ofType(f, 'lpattern')[0].seeds).toEqual([ofType(f, 'mirror')[0].id]);
  });
  it('bodies are mirrored as copies, united with the original when the file says so', async () => {
    const bodies = [square(1), extrude(2, 1, {}, { body_names: ['Left'] }), square(3), extrude(4, 3, { distance: '2' }, { body_names: ['Right'] })];
    const plane = { type: 'custom', plane: { origin: [20, 0, 0], x_dir: [0, 1, 0], y_dir: [0, 0, 1] } };
    const apart = await run([...bodies, { id: 5, name: 'Mir', type: 'mirror', suppressed: false, features: [], bodies: ['Left'], plane, combine: false }]);
    expect(apart.r.geometryComplete, JSON.stringify(apart.r.rows)).toBe(true);
    const copy = ofType(apart.f, 'moveBody')[0];
    expect(copy).toMatchObject({ copy: true, bodies: [{ body: 'Left' }], body: 'Left (mirror)' });
    expect(copy.mirror).toBeDefined();
    expect(ofType(apart.f, 'combine')).toHaveLength(0);
    const joined = await run([...bodies, { id: 5, name: 'Mir', type: 'mirror', suppressed: false, features: [], bodies: ['Left'], plane, combine: true }]);
    expect(ofType(joined.f, 'combine')[0]).toMatchObject({ op: 'union', target: { body: 'Left' }, tools: [{ body: 'Left (mirror)' }], keepTools: false });
  });
  it('a torus is a circle of the tube radius turned about a vertical line through the centre', async () => {
    const { f, r } = await run([{ id: 1, name: 'Ring', type: 'torus', suppressed: false, center: [10, 20, 30], major: '15 mm', minor: '4 mm', operation: 'new_body' }]);
    expect(r.geometryComplete).toBe(true);
    const sk = ofType(f, 'sketch')[0], rv = ofType(f, 'revolve')[0];
    // their (10, 20, 30) is our (10, 30, -20); the ring is drawn on the front plane moved to z = -20
    expect(f.find((x) => x.type === 'plane')).toMatchObject({ base: { id: 'front' }, offset: -20 });
    expect(sk.points.find((p: Rec) => p.id === 'p1')).toMatchObject({ x: 25, y: 30 });
    expect(sk.entities.find((e: Rec) => e.type === 'circle')).toMatchObject({ r: 4 });
    expect(rv).toMatchObject({ axis: 'e2', angle: 360, op: 'add' });
    expect((await run([{ id: 1, name: 'Ring', type: 'torus', suppressed: false, center: [0, 0, 0], major: '3 mm', minor: '4 mm', operation: 'new_body' }])).row(0).status).toBe('unsupported');
  });
  it('a sheet base is its profile extruded by the thickness of the rule it names', async () => {
    const sheet = { rules: [{ name: 'Sheet 2 mm', thickness: '2 mm' }, { name: 'Other', thickness: '3 mm' }] };
    const { f, r } = await run([square(1), { id: 2, name: 'Base', type: 'sheet_base', suppressed: false, sketch: 1, profiles: { type: 'all' }, rule: 'Sheet 2 mm' }], { sheet });
    expect(r.geometryComplete).toBe(true);
    expect(r.rows[1].notes?.[0]).toMatch(/plain extrude/);
    expect(ofType(f, 'extrude')[0]).toMatchObject({ depth: 2, op: 'add' });
    expect(ofType(f, 'extrude')[0].flip).toBeUndefined();
    const flipped = await run([square(1), { id: 2, name: 'Base', type: 'sheet_base', suppressed: false, sketch: 1, profiles: { type: 'all' }, rule: 'Other', flip: true }], { sheet });
    expect(ofType(flipped.f, 'extrude')[0]).toMatchObject({ depth: 3, flip: true });
    expect((await run([square(1), { id: 2, name: 'Base', type: 'sheet_base', suppressed: false, sketch: 1, profiles: { type: 'all' }, rule: 'Missing' }], { sheet })).row(1).reason).toMatch(/not in the file/);
  });
});

describe('sweeps and lofts', () => {
  // a path of a line and an arc on their XZ plane, and a small circle profile on their XY plane at the start of the line
  const path = (curves: Rec[], extra: Rec[] = []) => ({
    id: 1, name: 'Path', type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XZ' },
    sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'a', pos: [0, 0] }, { id: 'b', pos: [0, 30] }, { id: 'c', pos: [20, 30] }, { id: 'o', pos: [20, 10] }, ...extra],
      curves, constraints: [] },
  });
  const lineAndArc = [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'a1', type: 'arc', a: 3, b: 2, c: 4 }];
  const profile = { id: 2, name: 'Wire', type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XY' }, sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'c', pos: [0, 0] }], curves: [{ id: 'c1', type: 'circle', c: 1, r: 2 }], constraints: [] } };
  const sweep = (over: Rec = {}) => ({ id: 3, name: 'Pipe', type: 'sweep', suppressed: false, sketch: 2, profiles: { type: 'all' }, path_sketch: 1, path: ['l1', 'a1'], operation: 'new_body', ...over });
  it('a path of lines and arcs is the sketch that draws them, and a twist is kept', async () => {
    const { f, r } = await run([path(lineAndArc), profile, sweep({ twist: '30 deg' })]);
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true);
    const sw = ofType(f, 'sweep')[0];
    expect(sw).toMatchObject({ sketch: 'F2', path: { kind: 'sketch', id: 'F1' }, twist: 30, op: 'add' });
  });
  it('only the curves of the path are used when the sketch draws more', async () => {
    const { f, r } = await run([path([...lineAndArc, { id: 'x1', type: 'line', a: 2, b: 3 }]), profile, sweep()]);
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true);
    const sw = ofType(f, 'sweep')[0], own = ofType(f, 'sketch').find((x) => x.id === sw.path.id)!;
    expect(own.id).not.toBe('F1');
    expect(own.entities.map((e: Rec) => e.type)).toEqual(['line', 'arc']);
    // the pieces share their joint
    const used = new Set(own.entities.flatMap((e: Rec) => [e.p1, e.p2]));
    expect(used.size).toBe(3);
  });
  it('a profile kept at a fixed angle, an end scale and a guide rail are reported, not dropped', async () => {
    for (const [over, why] of [[{ orientation: 'parallel' }, /orientation/], [{ scale: '2' }, /scales/], [{ rails: [{ sketch: 1, curves: ['l1'] }] }, /rail/]] as Array<[Rec, RegExp]>) {
      const { row } = await run([path(lineAndArc), profile, sweep(over)]);
      expect(row(2), JSON.stringify(over)).toMatchObject({ status: 'unsupported', reason: expect.stringMatching(why) });
    }
  });
  it('a path of a circle or one that is not in the file is reported', async () => {
    const ring = path([{ id: 'r1', type: 'circle', c: 4, r: 5 }]);
    expect((await run([ring, profile, sweep({ path: ['r1'] })])).row(2).reason).toMatch(/lines and arcs/);
    expect((await run([path(lineAndArc), profile, sweep({ path_sketch: 9 })])).row(2).reason).toMatch(/not in the file/);
  });
  const rect = (id: number, z: number, half: number) => ({
    id, name: `Sec${id}`, type: 'sketch', suppressed: false, plane: { type: 'custom', plane: { origin: [0, 0, z], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } },
    sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'a', pos: [-half, -half] }, { id: 'b', pos: [half, -half] }, { id: 'c', pos: [half, half] }, { id: 'd', pos: [-half, half] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }], constraints: [] },
  });
  const apex = (id: number, z: number) => ({ id, name: `Apex${id}`, type: 'sketch', suppressed: false, plane: { type: 'custom', plane: { origin: [0, 0, z], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } }, sketch: { points: [{ id: 'origin', pos: [0, 0], fixed: true }], curves: [], constraints: [] } });
  it('a loft to a point gives the apex sketch a point entity', async () => {
    const { f, r } = await run([rect(1, 0, 5), apex(2, 20), { id: 3, name: 'Cone', type: 'loft', suppressed: false, operation: 'new_body', sections: [{ sketch: 1, profiles: { type: 'all' } }, { sketch: 2, point: 'origin', profiles: { type: 'all' } }] }]);
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true);
    const tip = ofType(f, 'sketch').find((x) => x.name === 'Apex2')!;
    expect(tip.entities).toEqual([{ id: 'pt1', type: 'point', p: 'O' }]);
    expect(ofType(f, 'loft')[0].sketches).toEqual([ofType(f, 'sketch').find((y) => y.name === 'Sec1')!.id, tip.id]);
  });
  it('rails become guides, and a section that uses part of its sketch is reported', async () => {
    const rail = (id: number, x: number) => ({ id, name: `Rail${id}`, type: 'sketch', suppressed: false, plane: { type: 'origin', name: 'XZ' }, sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'a', pos: [x, 0] }, { id: 'b', pos: [x, 20] }], curves: [{ id: 'r1', type: 'line', a: 1, b: 2 }], constraints: [] } });
    const sections = [{ sketch: 1, profiles: { type: 'all' } }, { sketch: 2, profiles: { type: 'all' } }];
    const { f, r } = await run([rect(1, 0, 5), rect(2, 20, 3), rail(3, 5), { id: 4, name: 'Guided', type: 'loft', suppressed: false, operation: 'new_body', sections, rails: [{ sketch: 3, curves: ['r1'] }] }]);
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true);
    expect(ofType(f, 'loft')[0].guides).toEqual([{ sketch: ofType(f, 'sketch').find((x) => x.name === 'Rail3')!.id, influence: 'next' }]);
    const part = await run([rect(1, 0, 5), rect(2, 20, 3), { id: 4, name: 'Part', type: 'loft', suppressed: false, operation: 'new_body', sections: [{ sketch: 1, profiles: { type: 'curves', loops: [['l1', 'l2', 'l3', 'l4']] } }, sections[1]] }]);
    expect(part.row(2).reason).toMatch(/some of the regions/);
  });
});

describe('sketches', () => {
  it('an ellipse keeps its centre, the end of its major axis and its minor radius', async () => {
    const sk = { ...square(1), sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'c', pos: [5, 5] }, { id: 'm', pos: [15, 5] }], curves: [{ id: 'e1', type: 'ellipse', c: 1, m: 2, r: 4 }], constraints: [] } };
    const { f, r } = await run([sk, extrude(2, 1, {})]);
    expect(r.geometryComplete, JSON.stringify(r.rows)).toBe(true);
    const e = ofType(f, 'sketch')[0].entities[0];
    expect(e).toMatchObject({ type: 'ellipse', r: 4 });
    const pt = (id: string) => ofType(f, 'sketch')[0].points.find((p: Rec) => p.id === id);
    expect([pt(e.c).x, pt(e.c).y, pt(e.p).x, pt(e.p).y]).toEqual([5, 5, 15, 5]);
  });
  it('parallel, perpendicular, equal, point-to-line distance and fixed points are constraints of the part', async () => {
    const { f, r } = await run([square(1, { constraints: [
      { id: 'k1', type: 'coincident', p: 0, q: 1 }, { id: 'k2', type: 'parallel', a: 0, b: 2 }, { id: 'k3', type: 'perpendicular', a: 0, b: 1 }, { id: 'k4', type: 'equal', a: 0, b: 1 },
      { id: 'k5', type: 'point_line_distance', p: 3, l: 0, value: 10 }, { id: 'k6', type: 'fix', p: 2 }, { id: 'k7', type: 'equal', a: 0, b: 9 },
    ] }), extrude(2, 1, {})]);
    expect(r.rows[0].notes).toEqual(['equal constraint dropped (the geometry is kept as stored)']);   // k7 names a curve that is not there
    const k = ofType(f, 'sketch')[0].constraints;
    expect(k.map((c: Rec) => c.type)).toEqual(['parallel', 'perpendicular', 'equal', 'pldist', 'fix']);
    expect(k[0].refs).toEqual(['e1', 'e3']);
    expect(k[3]).toMatchObject({ refs: [k[3].refs[0], 'e1'], value: 10 });
    expect(k[4]).toMatchObject({ value: [10, 0] });
    expect(k[4].refs).toHaveLength(1);
  });
});

describe('coils', () => {
  const coil = (axis: number[], over: Rec = {}) => ({ id: 1, name: 'Spring', type: 'coil', suppressed: false, base: [0, 0, 0], axis, diameter: '20 mm', section_size: '2 mm', turns: '5', pitch: '4 mm', operation: 'new_body', ...over });
  const frames = async (axis: number[]) => ofType((await run([coil(axis)])).f, 'plane').map((p) => [p.xDir, p.yDir]);
  it('starts where their world X axis, projected square to the axis, points', async () => {
    // about their Z axis (our y): the start is along X, and the plane across the axis turns right-handed from it
    expect((await frames([0, 0, 1]))[0]).toEqual([[1, 0, 0], [0, 0, -1]]);
    // about their Y axis (our -z): X is already square to it
    expect((await frames([0, 1, 0]))[0][0]).toEqual([1, 0, 0]);
    // tilted: X minus its part along the axis
    const tilt = (await frames([1, 0, 1]))[0][0];
    expect(tilt[0]).toBeCloseTo(0.5 ** 0.5, 9); expect(tilt[1]).toBeCloseTo(-(0.5 ** 0.5), 9); expect(tilt[2]).toBeCloseTo(0, 9);
  });
  it('about their X axis it starts along their Z axis (the axis times their Y)', async () => {
    const [x] = (await frames([1, 0, 0]))[0];
    expect(x).toEqual([0, 1, 0]);
  });
});

describe('assemblies', () => {
  const box = (id: number, component: number, name = `Box${id}`) => ({ id, name, type: 'box', suppressed: false, component, corner: [0, 0, 0], length: 10, width: 10, height: 10, operation: 'new_body' });
  const at = (x: number, y: number, z: number) => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [x, y, z, 1]];
  const occ = (id: number, component: number, parent: number, transform = at(0, 0, 0)) => ({ id, name: `O${id}`, component, parent, grounded: false, transform });
  const asm = (extra: Rec = {}) => ({
    components: [{ id: 1, name: 'Sub', parent: 0 }, { id: 2, name: 'Leaf', parent: 1 }],
    // Sub is placed in the design, Leaf inside Sub
    occurrences: [occ(10, 1, 0, at(100, 0, 0)), occ(11, 2, 1, at(0, 0, 7))],
    ...extra,
  });
  it('an occurrence in a placed component is inserted into the part of that component, so it moves with it', async () => {
    const { f, r } = await run([box(3, 2)], asm());
    expect(r.geometryComplete).toBe(true);
    const top = ofType(f, 'insertPart');
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ name: 'O10', place: { o: [100, 0, 0] } });
    const inner = ofType(top[0].part.features, 'insertPart');
    expect(inner).toHaveLength(1);
    expect(inner[0]).toMatchObject({ name: 'O11', place: { o: [0, 7, 0] } });   // their z is our y
    expect(ofType(inner[0].part.features, 'box').length + ofType(inner[0].part.features, 'extrude').length).toBeGreaterThan(0);
    expect(r.rows.filter((x) => x.type === 'occurrence').map((x) => x.status)).toEqual(['converted', 'converted']);
  });
  it('a parent that no occurrence places is the design itself, as before', async () => {
    const { f } = await run([box(3, 1)], { components: [{ id: 1, name: 'Leaf', parent: 0 }], occurrences: [occ(10, 1, 7), occ(11, 1, 0, at(20, 0, 0))] });
    expect(ofType(f, 'insertPart')).toHaveLength(2);
  });
  it('a component that holds itself is reported, not followed', async () => {
    // Loop holds Inner, which holds Loop again
    const { r } = await run([box(3, 1), box(4, 2)], { components: [{ id: 1, name: 'Loop', parent: 0 }, { id: 2, name: 'Inner', parent: 1 }], occurrences: [occ(10, 1, 0), occ(11, 2, 1), occ(12, 1, 2)] });
    expect(r.rows.find((x) => x.id === '12')).toMatchObject({ status: 'unsupported', reason: 'components that hold themselves' });
    // a ring nobody in the design places is placed in the design itself, so nothing is lost
    const ring = await run([box(3, 1), box(4, 2)], { components: [{ id: 1, name: 'A', parent: 0 }, { id: 2, name: 'B', parent: 0 }], occurrences: [occ(10, 1, 2), occ(11, 2, 1)] });
    expect(ofType(ring.f, 'insertPart')).toHaveLength(2);
  });
  it('a placement the file hides has the bodies of its part hidden; others stay shown', async () => {
    const { r } = await run([box(3, 2), box(4, 1)], asm({ visibility: { hidden_occurrences: [[10, 11]] } }));
    const top = ofType(r.part!.features, 'insertPart')[0];
    // the hidden one is the leaf inside Sub: its keys are hidden in the part of Sub (they name the feature and the insert inside it)
    const hidden = top.part.view?.hiddenBodies as string[];
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((k) => /^F\d+@F\d+$/.test(k))).toBe(true);
    expect(r.rows.find((x) => x.id === '11')?.notes?.[0]).toMatch(/hidden in the file/);
    // the design's own part lists the same key: it is what the face names of the leaf say (feature @ the insert inside Sub)
    expect(r.part!.view?.hiddenBodies).toEqual(hidden);
    const whole = await run([box(3, 2), box(4, 1)], asm({ visibility: { hidden_occurrences: [[10]] } }));
    const keys = whole.r.part!.view?.hiddenBodies as string[];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => /^F\d+@F\d+$/.test(k))).toBe(true);
    expect(whole.r.rows.find((x) => x.id === '10')?.notes?.[0]).toMatch(/hidden in the file/);
  });
  it('a hidden editable-history component beside the original shape keeps only the shape shown', async () => {
    const original = { id: 5, name: 'Original', type: 'import', suppressed: false, step: '', file: 'x.step' };
    const { r } = await run([box(3, 1), original], { components: [{ id: 1, name: 'Editable history (partial)', parent: 0 }], occurrences: [occ(10, 1, 0)], visibility: { hidden_occurrences: [[10]] } });
    expect(r.part!.view?.hiddenBodies?.length).toBeGreaterThan(0);
    expect(ofType(r.part!.features, 'insertPart')).toHaveLength(1);
  });
  it('timeline folders name the features they list', async () => {
    const { f } = await run([square(1), extrude(2, 1, {}), square(3), extrude(4, 3, { distance: '1' }, { operation: 'join' })], { timeline_groups: [{ id: 9, name: 'Base', features: [1, 2], parent: null }, { id: 10, name: 'Lid', features: [3, 4], parent: null }] });
    expect(f.map((x) => x.group)).toEqual(['Base', 'Base', 'Lid', 'Lid']);
  });
});
