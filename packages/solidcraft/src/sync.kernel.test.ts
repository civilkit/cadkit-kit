// The features the importer carries from a current converter's files, built in the kernel and measured against the shapes' own formulas.
// Every document is built here; no file of a corpus is read. Needs the kernel (CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { importSolidcraftDocument, type ScPart } from './import';

type Rec = Record<string, any>;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (part: ScPart) => { const s = await Session.open(part as unknown as PartDoc); sessions.push(s); return s; };
const doc = (features: unknown[], extra: Rec = {}) => ({ format: 'solidcraft/33', units: 'mm', params: [], features, ...extra });
/** Imports, rebuilds in the kernel, and returns the volume, the box, the errors and the import report. */
const build = async (features: unknown[], extra: Rec = {}) => {
  const r = await importSolidcraftDocument(doc(features, extra), 'p');
  expect(r.part, JSON.stringify(r.rows)).not.toBeNull();
  const s = await open(r.part!);
  const rep = await s.verify();
  const facts = await s.facts();
  return { r, errors: rep.regen.errors, volume: facts.volume!, box: facts.box!, solids: facts.solids };
};
const near = (a: number, b: number, tol = 1e-4) => expect(Math.abs(a - b) / Math.max(1, Math.abs(b)), `${a} against ${b}`).toBeLessThan(tol);
const clean = (rows: Array<{ status: string; reason?: string }>) => expect(rows.filter((x) => x.status === 'unsupported')).toEqual([]);

const rectSketch = (id: number, plane: Rec, w = 10, h = 10) => ({
  id, name: `S${id}`, type: 'sketch', suppressed: false, plane,
  sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [w, 0] }, { id: 'p3', pos: [w, h] }, { id: 'p4', pos: [0, h] }],
    curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }], constraints: [{ id: 'k1', type: 'coincident', p: 0, q: 1 }] },
});
const XY = { type: 'origin', name: 'XY' }, XZ = { type: 'origin', name: 'XZ' }, YZ = { type: 'origin', name: 'YZ' };
const extrude = (id: number, sk: number, extent: Rec, over: Rec = {}) => ({ id, name: `E${id}`, type: 'extrude', suppressed: false, sketch: sk, profiles: { type: 'all' }, operation: 'new_body', extent: { convention: 'total_distance', direction: 'positive', distance: '5', ...extent }, ...over });

describe('extents against the kernel', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  it('symmetric: the total distance centred on the sketch plane', async () => {
    const { volume, box, errors, r } = await build([rectSketch(1, XY), extrude(2, 1, { direction: 'symmetric', distance: '8' })]);
    expect(errors).toEqual([]); clean(r.rows);
    near(volume, 800);
    near(box.min[1], -4); near(box.max[1], 4);   // their z is our y
  });
  it('symmetric through all cuts clean through a plate', async () => {
    const { volume, errors } = await build([rectSketch(1, XY, 20, 20), extrude(2, 1, { distance: '6' }), rectSketch(3, XY, 5, 5), extrude(4, 3, { direction: 'symmetric', through_all: true, distance: '0 mm' }, { operation: 'cut' })]);
    expect(errors).toEqual([]);
    near(volume, 20 * 20 * 6 - 25 * 6);
  });
  it('two distances: 6 along the normal and 4 against it', async () => {
    const { volume, box, errors, r } = await build([rectSketch(1, XY), extrude(2, 1, { distance: '6', distance2: '4' })]);
    expect(errors).toEqual([]); clean(r.rows);
    near(volume, 1000); near(box.min[1], -4); near(box.max[1], 6);
  });
  it('two distances on a plane whose normal points the other way', async () => {
    const { volume, box, errors } = await build([rectSketch(1, XZ), extrude(2, 1, { distance: '6', distance2: '4' })]);
    expect(errors).toEqual([]);
    near(volume, 1000);
    // their XZ plane faces our -z: 6 along it is z from 0 to -6, and 4 against it is z up to 4
    near(box.min[2], -6); near(box.max[2], 4);
  });
  it('taper: a positive angle grows the section along the travel, a negative one shrinks it, on either side of the plane', async () => {
    const frustum = (deg: number, h = 5, a0 = 10) => { const a1 = a0 + 2 * h * Math.tan((deg * Math.PI) / 180); return (h / 3) * (a0 * a0 + a1 * a1 + a0 * a1); };
    for (const plane of [XY, XZ]) {
      for (const deg of [10, -10]) {
        const { volume, errors } = await build([rectSketch(1, plane), extrude(2, 1, { taper: `${deg} deg` })]);
        expect(errors, `${plane.name} ${deg}`).toEqual([]);
        near(volume, frustum(deg), 2e-3);
      }
    }
  });
  it('a start from a face and an end at a face', async () => {
    const { volume, box, errors } = await build([rectSketch(1, XY), extrude(2, 1, { from: [0, 0, 7], distance: '2' })]);
    expect(errors).toEqual([]);
    near(volume, 200); near(box.min[1], 7); near(box.max[1], 9);
    const stop = await build([rectSketch(1, XY), extrude(2, 1, { to: [0, 0, 12], distance: '1' })]);
    expect(stop.errors).toEqual([]);
    near(stop.volume, 1200);
  });
});

describe('profiles and revolves against the kernel', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  const plate = {
    id: 1, name: 'Plate', type: 'sketch', suppressed: false, plane: XY,
    sketch: {
      points: [{ id: 'origin', pos: [0, 0] }, { id: 'a', pos: [0, 0] }, { id: 'b', pos: [40, 0] }, { id: 'c', pos: [40, 20] }, { id: 'd', pos: [0, 20] }, { id: 'h', pos: [20, 10] }, { id: 'j', pos: [70, 10] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }, { id: 'c1', type: 'circle', c: 5, r: 4 }, { id: 'c2', type: 'circle', c: 6, r: 6 }], constraints: [],
    },
  };
  it('whole boundaries: the plate with its hole, and not the circle apart from it', async () => {
    const { volume, errors, r } = await build([plate, extrude(2, 1, {}, { profiles: { type: 'whole_boundaries', profiles: [{ outer: ['l1', 'l2', 'l3', 'l4'], holes: [['c1']] }] } })]);
    expect(errors).toEqual([]); clean(r.rows);
    near(volume, (800 - Math.PI * 16) * 5);
  });
  // a profile 5..15 wide and 0..20 high in the sketch of their YZ plane, with a construction line on its y axis
  const half = rectSketch(2, YZ);
  const prof = { ...half, sketch: { ...half.sketch, constraints: [], points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [5, 0] }, { id: 'p2', pos: [15, 0] }, { id: 'p3', pos: [15, 20] }, { id: 'p4', pos: [5, 20] }, { id: 'p5', pos: [0, 0] }, { id: 'p6', pos: [0, 30] }], curves: [...half.sketch.curves, { id: 'ax', type: 'line', a: 5, b: 6, construction: true }] } };
  const rev = (over: Rec = {}) => ({ id: 3, name: 'R', type: 'revolve', suppressed: false, sketch: 2, profiles: { type: 'all' }, axis: { type: 'sketch_axis', axis: 'y' }, angle: '360 deg', operation: 'new_body', convention: 'sketch_normal', ...over });
  const ring = Math.PI * (15 * 15 - 5 * 5) * 20;
  it('about a line of its own sketch, about a line in space, and about the sketch axis: the same ring', async () => {
    for (const axis of [{ type: 'sketch_line', curve: 'ax' }, { type: 'line', origin: [0, 0, 0], dir: [0, 0, 1] }, { type: 'sketch_axis', axis: 'y' }]) {
      const { volume, errors, r } = await build([prof, rev({ axis })]);
      expect(errors, JSON.stringify(axis)).toEqual([]); clean(r.rows);
      near(volume, ring);
    }
  });
  it('a line off the sketch axis turns the profile about that line', async () => {
    // the profile lies 5..15 from the sketch origin; the axis is 10 beyond the origin on the other side, so it lies 15..25 from the axis
    const { volume, box, errors } = await build([prof, rev({ axis: { type: 'line', origin: [0, -10, 0], dir: [0, 0, 1] } })]);
    expect(errors).toEqual([]);
    near(volume, Math.PI * (25 * 25 - 15 * 15) * 20);
    near(box.max[0] - box.min[0], 50, 1e-3);
  });
  it('symmetric: a quarter turn centred on the sketch plane', async () => {
    const { volume, errors } = await build([prof, rev({ angle: '90 deg', symmetric: true })]);
    expect(errors).toEqual([]);
    near(volume, ring / 4);
  });
  it('a torus is 2 pi squared times the ring radius times the tube radius squared', async () => {
    const { volume, errors, r } = await build([{ id: 1, name: 'Ring', type: 'torus', suppressed: false, center: [10, 20, 30], major: '15 mm', minor: '4 mm', operation: 'new_body' }]);
    expect(errors).toEqual([]); clean(r.rows);
    near(volume, 2 * Math.PI * Math.PI * 15 * 16);
  });
});

describe('holes, patterns, mirrors and sheets against the kernel', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  const box = { id: 1, name: 'Plate', type: 'box', suppressed: false, corner: [0, 0, 0], length: 40, width: 40, height: 20, operation: 'new_body' };
  it('a hole up to a face is as deep as the face is far', async () => {
    const { volume, errors, r } = await build([box, { id: 2, name: 'H', type: 'hole', suppressed: false, diameter: '4 mm', direction: [0, 0, -1], hole: { type: 'simple' }, position: [10, 10, 20], to: [30, 30, 12.5] }]);
    expect(errors).toEqual([]); clean(r.rows);
    near(volume, 40 * 40 * 20 - Math.PI * 4 * 7.5);
  });
  it('a circular pattern of a boss about the vertical axis through the origin', async () => {
    const disc = { id: 1, name: 'Disc', type: 'cylinder', suppressed: false, base: [0, 0, 0], axis: [0, 0, 5], radius: '40 mm', height: '5 mm', operation: 'new_body' };
    const bossSketch = { id: 2, name: 'BS', type: 'sketch', suppressed: false, plane: { type: 'offset', base: XY, distance: '5' }, sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'c', pos: [20, 0] }], curves: [{ id: 'c1', type: 'circle', c: 1, r: 3 }], constraints: [] } };
    const boss = extrude(3, 2, { distance: '5' }, { name: 'Boss', operation: 'join' });
    const ringed = { id: 4, name: 'Ring', type: 'pattern', suppressed: false, features: ['Boss'], pattern: { type: 'circular', origin: [0, 0, 0], axis: [0, 0, 1], count: '4', angle: '360 deg' } };
    const { volume, errors, r } = await build([disc, bossSketch, boss, ringed]);
    expect(errors).toEqual([]); clean(r.rows);
    near(volume, Math.PI * 1600 * 5 + 4 * Math.PI * 9 * 5);
  });
  it('a mirror of a body about a plane gives a second body', async () => {
    const plane = { type: 'custom', plane: { origin: [20, 0, 0], x_dir: [0, 1, 0], y_dir: [0, 0, 1] } };
    const bodies = [rectSketch(1, XY), extrude(2, 1, {}, { body_names: ['Left'] }), { id: 3, name: 'Other', type: 'box', suppressed: false, corner: [0, 50, 0], length: 4, width: 4, height: 4, operation: 'new_body', body_names: ['Other'] }];
    const apart = await build([...bodies, { id: 4, name: 'Mir', type: 'mirror', suppressed: false, features: [], bodies: ['Left'], plane, combine: false }]);
    expect(apart.errors).toEqual([]); clean(apart.r.rows);
    near(apart.volume, 500 + 64 + 500); expect(apart.solids).toBe(3);
    near(apart.box.max[0], 40);
  });
  it('a sheet base is a plate of the rule thickness', async () => {
    const sheet = { rules: [{ name: 'Sheet', thickness: '2 mm' }] };
    const { volume, errors, r } = await build([rectSketch(1, XY, 20, 10), { id: 2, name: 'Base', type: 'sheet_base', suppressed: false, sketch: 1, profiles: { type: 'all' }, rule: 'Sheet' }], { sheet });
    expect(errors).toEqual([]); clean(r.rows);
    near(volume, 400);
  });
});

describe('sweeps, lofts and sketches against the kernel', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  // the handle of the book: a line, a half circle and a line; a circle of radius 3.5 swept along it (2891.1061 mm3)
  const path = { id: 1, name: 'Handle', type: 'sketch', suppressed: false, plane: XY, sketch: {
    points: [{ id: 'origin', pos: [0, 0] }, { id: 'p1', pos: [0, 0] }, { id: 'p2', pos: [0, 14] }, { id: 'p3', pos: [30, 14] }, { id: 'p4', pos: [30, 0] }, { id: 'p5', pos: [15, 14] }],
    curves: [{ id: 'e1', type: 'line', a: 1, b: 2 }, { id: 'e2', type: 'arc', c: 5, a: 3, b: 2 }, { id: 'e3', type: 'line', a: 3, b: 4 }], constraints: [] } };
  const wire = { id: 2, name: 'Wire', type: 'sketch', suppressed: false, plane: XZ, sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'c', pos: [0, 0] }], curves: [{ id: 'c1', type: 'circle', c: 1, r: 3.5 }], constraints: [] } };
  const sweep = (over: Rec = {}) => ({ id: 3, name: 'Pipe', type: 'sweep', suppressed: false, sketch: 2, profiles: { type: 'all' }, path_sketch: 1, path: ['e1', 'e2', 'e3'], operation: 'new_body', ...over });
  it('along a path of lines and an arc: the volume of the book', async () => {
    const { volume, errors, r } = await build([path, wire, sweep()]);
    clean(r.rows); expect(errors).toEqual([]);
    near(volume, 2891.1061, 1e-3);
  });
  it('the same path drawn among other curves: only its curves are swept', async () => {
    const busy = { ...path, sketch: { ...path.sketch, points: [...path.sketch.points, { id: 'q', pos: [60, 60] }], curves: [...path.sketch.curves, { id: 'x1', type: 'circle', c: 6, r: 4 }] } };
    const { volume, errors, r } = await build([busy, wire, sweep()]);
    clean(r.rows); expect(errors).toEqual([]);
    near(volume, 2891.1061, 1e-3);
  });
  it('a twist about a straight path keeps the volume of a round wire', async () => {
    // the kernel twists along one piece of path only; a path of several pieces is its limit, reported when the part is rebuilt
    const { volume, errors } = await build([path, wire, sweep({ twist: '90 deg', path: ['e1'] })]);
    expect(errors).toEqual([]);
    near(volume, Math.PI * 3.5 * 3.5 * 14, 1e-3);
  });
  const section = (id: number, z: number, half: number) => ({
    id, name: `Sec${id}`, type: 'sketch', suppressed: false, plane: { type: 'custom', plane: { origin: [0, 0, z], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } },
    sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'a', pos: [-half, -half] }, { id: 'b', pos: [half, -half] }, { id: 'c', pos: [half, half] }, { id: 'd', pos: [-half, half] }],
      curves: [{ id: 'l1', type: 'line', a: 1, b: 2 }, { id: 'l2', type: 'line', a: 2, b: 3 }, { id: 'l3', type: 'line', a: 3, b: 4 }, { id: 'l4', type: 'line', a: 4, b: 1 }], constraints: [] },
  });
  it('a loft to a point is a pyramid', async () => {
    const tip = { id: 2, name: 'Apex', type: 'sketch', suppressed: false, plane: { type: 'custom', plane: { origin: [0, 0, 20], x_dir: [1, 0, 0], y_dir: [0, 1, 0] } }, sketch: { points: [{ id: 'origin', pos: [0, 0], fixed: true }], curves: [], constraints: [] } };
    const { volume, errors, r } = await build([section(1, 0, 5), tip, { id: 3, name: 'Cone', type: 'loft', suppressed: false, operation: 'new_body', sections: [{ sketch: 1, profiles: { type: 'all' } }, { sketch: 2, point: 'origin', profiles: { type: 'all' } }] }]);
    clean(r.rows); expect(errors).toEqual([]);
    near(volume, (100 * 20) / 3, 1e-3);
  });
  it('an ellipse is extruded to its area times the height', async () => {
    const sk = { id: 1, name: 'E', type: 'sketch', suppressed: false, plane: XY, sketch: { points: [{ id: 'origin', pos: [0, 0] }, { id: 'c', pos: [0, 0] }, { id: 'm', pos: [10, 0] }], curves: [{ id: 'e1', type: 'ellipse', c: 1, m: 2, r: 4 }], constraints: [] } };
    const { volume, errors, r } = await build([sk, extrude(2, 1, {})]);
    clean(r.rows); expect(errors).toEqual([]);
    near(volume, Math.PI * 10 * 4 * 5, 1e-3);
  });
  it('parallel, perpendicular, equal and distance constraints solve with the geometry in place', async () => {
    const sk = rectSketch(1, XY);
    sk.sketch.constraints.push({ id: 'k2', type: 'parallel', a: 0, b: 2 } as never, { id: 'k3', type: 'perpendicular', a: 0, b: 1 } as never, { id: 'k4', type: 'equal', a: 0, b: 1 } as never, { id: 'k5', type: 'point_line_distance', p: 3, l: 0, value: 10 } as never, { id: 'k6', type: 'fix', p: 2 } as never);
    const { volume, errors, r } = await build([sk, extrude(2, 1, {})]);
    clean(r.rows); expect(errors).toEqual([]);
    near(volume, 500);
  });
});

describe('assemblies against the kernel', { skip: !process.env.CK_WASM, timeout: 120_000 }, () => {
  const box = (id: number, component: number) => ({ id, name: `Box${id}`, type: 'box', suppressed: false, component, corner: [0, 0, 0], length: 10, width: 10, height: 10, operation: 'new_body' });
  const at = (x: number, y: number, z: number) => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [x, y, z, 1]];
  const occ = (id: number, component: number, parent: number, transform: number[][]) => ({ id, name: `O${id}`, component, parent, grounded: false, transform });
  it('a part inside a sub-assembly moves with it', async () => {
    const asm = { components: [{ id: 1, name: 'Sub', parent: 0 }, { id: 2, name: 'Leaf', parent: 1 }], occurrences: [occ(10, 1, 0, at(100, 0, 0)), occ(11, 2, 1, at(0, 0, 7))] };
    const { box: b, errors, volume } = await build([box(3, 2)], asm);
    expect(errors).toEqual([]);
    near(volume, 1000);
    // placed at x = 100 (Sub), then 7 up (their z, our y) inside it
    near(b.min[0], 100); near(b.max[0], 110); near(b.min[1], 7); near(b.max[1], 17);
  });
});
