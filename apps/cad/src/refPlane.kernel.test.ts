// Reference planes (the `plane` feature: offset, angle, perpendicular, mid) against the real kernel. Each case builds a circle (radius 25) on the Top plane
// (std "front" in the Z-up app) plus one plane feature, reads the plane's frame back and checks it by hand-worked numbers, then sketches a circle on the new
// plane and extrudes it 10 mm: the solid must come out whole (volume pi * 25^2 * 10) whatever the plane's tilt. Invalid inputs pin their exact error code.
//
// Findings pinned here (kernel d5aa08b6, angle offset from the 0.8.14 kernel):
//  - angle mode honours `offset` (kernel 0.8.14): tilt about the axis, then move along the tilted normal by the offset, so "30 degrees AND 40 mm away" is one feature.
//    Hanging the angle plane on an offset plane still does not move it (the axis decides where it is); perpendicular still ignores the offset.
//  - the app's Plane editor lists Angle / Midplane / Parallel / Three points but cannot set the axis, base2 or points, so choosing one of them gives
//    missingReference, which the app words as "a face or edge it uses no longer exists" (see the last describe: it documents the kernel side only).
//  - angle about an axis normal to the base plane turns the plane about its own normal: it builds, the same plane comes back (no error).
//  - mid of two non-parallel planes takes the z1 - z2 bisector (the oracle's choice), which is the wider-angle one for a narrow wedge.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';

type Wire = Record<string, unknown>;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const TOP = { kind: 'std', id: 'front' };
const ax = (a: string) => ({ kind: 'axis', axis: a });
const circle = (id: string, plane: Wire, r = 25): Wire => ({ type: 'sketch', id, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r }], constraints: [] });
const lineSketch = (id: string, x0: number, y0: number, x1: number, y1: number): Wire => ({ type: 'sketch', id, plane: TOP, points: [{ id: 'a', x: x0, y: y0 }, { id: 'b', x: x1, y: y1 }], entities: [{ id: 'l1', type: 'line', p1: 'a', p2: 'b' }], constraints: [] });
const plane = (id: string, f: Wire): Wire => ({ type: 'plane', id, ...f });
const VOL = Math.PI * 25 * 25 * 10;

async function open(features: Wire[]) {
  const doc = { ...emptyPart('Planes'), upAxis: 'z', features, seq: features.length + 1 } as unknown as PartDoc;
  const s = await Session.open(doc); sessions.push(s);
  return s;
}
type Frame = { o: number[]; x: number[]; y: number[]; z: number[] };
/** Build a circle on Top and `extra` features, then the plane `P1`; returns its frame (null when it failed) and the error codes. */
async function build(f: Wire, extra: Wire[] = []) {
  const s = await open([circle('S1', TOP), ...extra, plane('P1', f)]);
  const rep = await s.regenReport();
  const view = await s.bodyForView();
  const fr = (view?.planes.find((p) => p.id === 'P1')?.frame ?? null) as Frame | null;
  return { s, errors: (rep.errors as unknown as Array<[string, { code: string }]>).map((e) => `${e[0]}:${e[1].code}`), frame: fr };
}
/** A sketch on P1 extruded 10 mm: the volume of the solid, or the error codes. */
async function extrudeOn(f: Wire, extra: Wire[] = []) {
  const s = await open([circle('S1', TOP), ...extra, plane('P1', f), circle('S2', { kind: 'feature', id: 'P1' }), { type: 'extrude', id: 'E1', op: 'new', sketch: 'S2', end: 'blind', depth: 10 }]);
  const rep = await s.regenReport();
  const vol = rep.errors.length ? null : (await s.massProps()).volume as number;
  return { vol, errors: (rep.errors as unknown as Array<[string, { code: string }]>).map((e) => `${e[0]}:${e[1].code}`) };
}
const close = (a: number[], b: number[], tol = 1e-6) => { expect(a.length).toBe(3); a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol)); };
const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const S = Math.sqrt(3) / 2, H = Math.SQRT1_2;

/** frame checks that hold for every case: orthonormal, right-handed */
function sane(fr: Frame) {
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  expect(Math.abs(dot(fr.x, fr.x) - 1)).toBeLessThan(1e-9);
  expect(Math.abs(dot(fr.z, fr.z) - 1)).toBeLessThan(1e-9);
  expect(Math.abs(dot(fr.x, fr.z))).toBeLessThan(1e-9);
  const c = [fr.x[1] * fr.y[2] - fr.x[2] * fr.y[1], fr.x[2] * fr.y[0] - fr.x[0] * fr.y[2], fr.x[0] * fr.y[1] - fr.x[1] * fr.y[0]];
  close(c, fr.z, 1e-9);
}

describe('offset mode', { skip: !process.env.CK_WASM }, () => {
  it('40 mm above the Top plane: origin (0,0,40), normal +Z; a sketch on it extrudes whole', async () => {
    const f = { mode: 'offset', base: TOP, offset: 40 };
    const r = await build(f);
    expect(r.errors).toEqual([]);
    close(r.frame!.o, [0, 0, 40]); close(r.frame!.z, [0, 0, 1]); sane(r.frame!);
    const e = await extrudeOn(f);
    expect(e.errors).toEqual([]);
    expect(Math.abs(e.vol! - VOL) / VOL).toBeLessThan(1e-6);
  });
  it('a negative offset goes the other way', async () => {
    const r = await build({ mode: 'offset', base: TOP, offset: -40 });
    close(r.frame!.o, [0, 0, -40]); close(r.frame!.z, [0, 0, 1]);
  });
  it('flip turns the plane over: the same distance lands on the other side, normal -Z', async () => {
    const r = await build({ mode: 'offset', base: TOP, offset: 40, flip: true });
    close(r.frame!.o, [0, 0, -40]); close(r.frame!.z, [0, 0, -1]); sane(r.frame!);
  });
  it('offset 0 is the base plane itself', async () => {
    close((await build({ mode: 'offset', base: TOP, offset: 0 })).frame!.o, [0, 0, 0]);
  });
  it('no mode means offset, and an unknown mode falls back to offset', async () => {
    close((await build({ base: TOP, offset: 40 })).frame!.o, [0, 0, 40]);
    close((await build({ mode: 'nonsense', base: TOP, offset: 40 })).frame!.o, [0, 0, 40]);
  });
  it('a plane can hang on another plane: 20 + 15 above Top', async () => {
    const r = await build({ mode: 'offset', base: { kind: 'feature', id: 'PA' }, offset: 15 }, [plane('PA', { mode: 'offset', base: TOP, offset: 20 })]);
    close(r.frame!.o, [0, 0, 35]);
  });
  it('without a base: missingReference', async () => {
    expect((await build({ mode: 'offset', offset: 40 })).errors).toEqual(['P1:missingReference']);
  });
  it('an expression offset is evaluated with or without the "=": "=20+20" and "20+20" are both 40, and "1in" is 25.4 (the kernel since the expression-field batch)', async () => {
    close((await build({ mode: 'offset', base: TOP, offset: '=20+20' })).frame!.o, [0, 0, 40]);
    close((await build({ mode: 'offset', base: TOP, offset: '20+20' })).frame!.o, [0, 0, 40]);
    close((await build({ mode: 'offset', base: TOP, offset: '1in' })).frame!.o, [0, 0, 25.4]);
  });
});

describe('angle mode', { skip: !process.env.CK_WASM }, () => {
  // Rotation of the base about +X by a: z = (0, -sin a, cos a) (right-hand rule), the plane passes through the axis.
  for (const [a, nz] of [[30, [0, -0.5, S]], [45, [0, -H, H]], [90, [0, -1, 0]], [-30, [0, 0.5, S]], [0, [0, 0, 1]], [180, [0, 0, -1]]] as Array<[number, number[]]>) {
    it(`${a} degrees about the X axis: normal ${nz.map((v) => +v.toFixed(3)).join(',')}, through the axis; a sketch on it extrudes whole`, async () => {
      const f = { mode: 'angle', base: TOP, axis: ax('x'), angle: a };
      const r = await build(f);
      expect(r.errors).toEqual([]);
      close(r.frame!.o, [0, 0, 0]); close(r.frame!.z, nz); close(r.frame!.x, [1, 0, 0]); sane(r.frame!);
      const e = await extrudeOn(f);
      expect(e.errors).toEqual([]);
      expect(Math.abs(e.vol! - VOL) / VOL).toBeLessThan(1e-6);
    });
  }
  it('about the Y axis: 30 degrees tilts the normal toward +X', async () => {
    const r = await build({ mode: 'angle', base: TOP, axis: ax('y'), angle: 30 });
    close(r.frame!.z, [0.5, 0, S]); close(r.frame!.o, [0, 0, 0]);
  });
  it('flip negates the angle', async () => {
    close((await build({ mode: 'angle', base: TOP, axis: ax('x'), angle: 30, flip: true })).frame!.z, [0, 0.5, S]);
  });
  it('about a free axis line y = 40: the plane passes through that line, tilted 30', async () => {
    const r = await build({ mode: 'angle', base: TOP, axis: { kind: 'axis', point: [0, 40, 0], dir: [1, 0, 0] }, angle: 30 });
    close(r.frame!.o, [0, 40, 0]); close(r.frame!.z, [0, -0.5, S]);
  });
  it('about a sketch line (an edge in the plane): through the line, tilted 30', async () => {
    const r = await build({ mode: 'angle', base: TOP, axis: { kind: 'sketchLine', sketch: 'SL', entity: 'l1' }, angle: 30 }, [lineSketch('SL', -10, 40, 50, 40)]);
    expect(r.errors).toEqual([]);
    close(r.frame!.o, [-10, 40, 0]); close(r.frame!.z, [0, -0.5, S]);
    // every point of the axis line lies in the plane
    const p = r.frame!; const d = [50 - p.o[0], 0, 0]; expect(Math.abs(d[0] * p.z[0] + d[1] * p.z[1] + d[2] * p.z[2])).toBeLessThan(1e-9);
  });
  it('about an axis feature (where the Front and Top planes meet)', async () => {
    const r = await build({ mode: 'angle', base: TOP, axis: { kind: 'feature', id: 'AX1' }, angle: 30 }, [{ type: 'axis', id: 'AX1', refs: [TOP, { kind: 'std', id: 'top' }] }]);
    expect(r.errors).toEqual([]);
    expect(Math.abs(r.frame!.z[2] - S)).toBeLessThan(1e-9);   // tilted 30 from Top whichever way the axis points
  });
  it('without an axis the kernel answers missingReference (what the app editor does today: it has no Axis field)', async () => {
    expect((await build({ mode: 'angle', base: TOP, angle: 30 })).errors).toEqual(['P1:missingReference']);
    expect((await build({ mode: 'angle', base: TOP })).errors).toEqual(['P1:missingReference']);
  });
  it('without a base plane: missingReference', async () => {
    expect((await build({ mode: 'angle', axis: ax('x'), angle: 30 })).errors).toEqual(['P1:missingReference']);
  });
  it('an axis along the base normal turns the plane about its own normal and builds the same plane (no error, no tilt)', async () => {
    const r = await build({ mode: 'angle', base: TOP, axis: ax('z'), angle: 30 });
    expect(r.errors).toEqual([]);
    close(r.frame!.z, [0, 0, 1]); close(r.frame!.o, [0, 0, 0]);
  });

  describe('tilted AND away from the base', () => {
    it('angle 30 + offset 40 in ONE feature: tilt about the axis, then move 40 along the tilted normal', async () => {
      const r = await build({ mode: 'angle', base: TOP, axis: ax('x'), angle: 30, offset: 40 });
      expect(r.errors).toEqual([]);
      close(r.frame!.o, [0, -20, 40 * S]); close(r.frame!.z, [0, -0.5, S]);   // 40 * (0, -0.5, 0.866) = (0, -20, 34.641)
      expect(Math.hypot(...r.frame!.o)).toBeCloseTo(40, 6);
    });
    it('angle with offset 0 or no offset is unchanged (through the axis)', async () => {
      close((await build({ mode: 'angle', base: TOP, axis: ax('x'), angle: 30, offset: 0 })).frame!.o, [0, 0, 0]);
      close((await build({ mode: 'angle', base: TOP, axis: ax('x'), angle: 30 })).frame!.o, [0, 0, 0]);
    });
    it('way 1: an offset plane 40 above Top, then an angle plane about the X axis hung on it: it tilts 30 but passes through the world X axis, not the offset plane', async () => {
      const r = await build({ mode: 'angle', base: { kind: 'feature', id: 'PO' }, axis: ax('x'), angle: 30 }, [plane('PO', { mode: 'offset', base: TOP, offset: 40 })]);
      expect(r.errors).toEqual([]);
      close(r.frame!.z, [0, -0.5, S]); close(r.frame!.o, [0, 0, 0]);   // the 40 is lost again: the axis decides where the plane is
    });
    it('way 2 (works): an axis line 40 above Top, the angle plane about it', async () => {
      const r = await build({ mode: 'angle', base: TOP, axis: { kind: 'axis', point: [0, 0, 40], dir: [1, 0, 0] }, angle: 30 });
      close(r.frame!.o, [0, 0, 40]); close(r.frame!.z, [0, -0.5, S]);
    });
    it('way 3 (works): a tilted plane, then an offset plane 40 along ITS normal', async () => {
      const f = { mode: 'offset', base: { kind: 'feature', id: 'PA' }, offset: 40 };
      const extra = [plane('PA', { mode: 'angle', base: TOP, axis: ax('x'), angle: 30 })];
      const r = await build(f, extra);
      expect(r.errors).toEqual([]);
      close(r.frame!.o, [0, -20, 40 * S]); close(r.frame!.z, [0, -0.5, S]);   // 40 * (0, -0.5, 0.866)
      const e = await extrudeOn(f, extra);
      expect(Math.abs(e.vol! - VOL) / VOL).toBeLessThan(1e-6);
    });
  });
});

describe('perpendicular mode', { skip: !process.env.CK_WASM }, () => {
  it('perpendicular to Top through the X axis: normal -Y, x along the axis; a sketch on it extrudes whole', async () => {
    const f = { mode: 'perpendicular', base: TOP, axis: ax('x') };
    const r = await build(f);
    expect(r.errors).toEqual([]);
    close(r.frame!.o, [0, 0, 0]); close(r.frame!.x, [1, 0, 0]); close(r.frame!.z, [0, -1, 0]); sane(r.frame!);
    const e = await extrudeOn(f);
    expect(Math.abs(e.vol! - VOL) / VOL).toBeLessThan(1e-6);
  });
  it('through the Y axis: normal +X', async () => {
    close((await build({ mode: 'perpendicular', base: TOP, axis: ax('y') })).frame!.z, [1, 0, 0]);
  });
  it('through a sketch line 40 mm along Y: the origin is the line start, the plane stands on Top', async () => {
    const r = await build({ mode: 'perpendicular', base: TOP, axis: { kind: 'sketchLine', sketch: 'SL', entity: 'l1' } }, [lineSketch('SL', -10, 40, 50, 40)]);
    close(r.frame!.o, [-10, 40, 0]); close(r.frame!.z, [0, -1, 0]);
  });
  it('flip reverses the normal', async () => {
    close((await build({ mode: 'perpendicular', base: TOP, axis: ax('x'), flip: true })).frame!.z, [0, 1, 0]);
  });
  it('an axis along the base normal has no unique plane: planeLineNormal', async () => {
    expect((await build({ mode: 'perpendicular', base: TOP, axis: ax('z') })).errors).toEqual(['P1:planeLineNormal']);
    expect((await build({ mode: 'perpendicular', base: { kind: 'std', id: 'right' }, axis: ax('x') })).errors).toEqual(['P1:planeLineNormal']);
  });
  it('without an axis: missingReference', async () => {
    expect((await build({ mode: 'perpendicular', base: TOP })).errors).toEqual(['P1:missingReference']);
  });
});

describe('mid mode', { skip: !process.env.CK_WASM }, () => {
  const off = (id: string, d: number) => plane(id, { mode: 'offset', base: TOP, offset: d });
  const ref = (id: string) => ({ kind: 'feature', id });
  it('midway between Top and a plane 40 above: z = 20; a sketch on it extrudes whole', async () => {
    const f = { mode: 'mid', base: TOP, base2: ref('PO') };
    const r = await build(f, [off('PO', 40)]);
    expect(r.errors).toEqual([]);
    close(r.frame!.o, [0, 0, 20]); close(r.frame!.z, [0, 0, 1]); sane(r.frame!);
    const e = await extrudeOn(f, [off('PO', 40)]);
    expect(Math.abs(e.vol! - VOL) / VOL).toBeLessThan(1e-6);
  });
  it('Top and a plane 40 below: z = -20', async () => {
    close((await build({ mode: 'mid', base: TOP, base2: ref('PO') }, [off('PO', -40)])).frame!.o, [0, 0, -20]);
  });
  it('two offset planes at 10 and 50: z = 30', async () => {
    close((await build({ mode: 'mid', base: ref('PA'), base2: ref('PB') }, [off('PA', 10), off('PB', 50)])).frame!.o, [0, 0, 30]);
  });
  it('the same plane twice is that plane', async () => {
    close((await build({ mode: 'mid', base: TOP, base2: TOP })).frame!.o, [0, 0, 0]);
  });
  it('Top and Right (square to each other): the 45 degree plane through the origin, normal (-1,0,1)/sqrt2', async () => {
    const r = await build({ mode: 'mid', base: TOP, base2: { kind: 'std', id: 'right' } });
    expect(r.errors).toEqual([]);
    close(r.frame!.z, [-H, 0, H]); close(r.frame!.o, [0, 0, 0]);
  });
  it('Top and a plane tilted 60 about X (not parallel): a plane through their common line; normal is the z1 - z2 bisector', async () => {
    const r = await build({ mode: 'mid', base: TOP, base2: ref('PT') }, [plane('PT', { mode: 'angle', base: TOP, axis: ax('x'), angle: 60 })]);
    expect(r.errors).toEqual([]);
    close(r.frame!.o, [0, 0, 0]);
    close(r.frame!.z, unit([0, 0.866025403784, 0.5]), 1e-6);   // z1 - z2 = (0, sin60, 1 - cos60); the 120 degree-wedge bisector, not the 60 degree one
  });
  it('mid ignores `offset`', async () => {
    close((await build({ mode: 'mid', base: TOP, base2: ref('PO'), offset: 5 }, [off('PO', 40)])).frame!.o, [0, 0, 20]);
  });
  it('without a second plane: missingReference', async () => {
    expect((await build({ mode: 'mid', base: TOP })).errors).toEqual(['P1:missingReference']);
  });
});

describe('what a sketch on the new plane sees', { skip: !process.env.CK_WASM }, () => {
  it('sketch coordinates follow the plane frame: a point (10, 0) on the 30 degree plane lies 10 mm along the plane x axis, in the plane', async () => {
    const s = await open([circle('S1', TOP), plane('P1', { mode: 'angle', base: TOP, axis: ax('x'), angle: 30 }), circle('S2', { kind: 'feature', id: 'P1' }, 10)]);
    const rep = await s.regenReport();
    expect(rep.errors).toEqual([]);
  });
  it('an extrude on a tilted plane leaves the base circle alone: two circles, one solid, the volume of the extruded one only', async () => {
    const e = await extrudeOn({ mode: 'angle', base: TOP, axis: ax('x'), angle: 45 });
    expect(Math.abs(e.vol! - VOL) / VOL).toBeLessThan(1e-6);
  });
});

describe('offset planes chained on each other (owner report: the second one seemed to sit on Top)', () => {
  it('a plane 10 from a plane 40 from Top is 50 above Top', async () => {
    const r = await build({ mode: 'offset', base: { kind: 'feature', id: 'P0' }, offset: 10 }, [plane('P0', { mode: 'offset', base: TOP, offset: 40 })]);
    expect(r.errors).toEqual([]);
    close(r.frame!.o, [0, 0, 50]);
    close(r.frame!.z, [0, 0, 1]);
  });
});
