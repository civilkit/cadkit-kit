// Reading holes and grouping identical ones, on synthetic geometry (no kernel): a plate with the holes below, as the mesh arrays and circular edges the view has.
import { describe, expect, it } from 'vitest';
import { allHoles, HoleIndex, identicalHoles, patternHoles, readFastenHole } from './fastenHole';

type V3 = [number, number, number];
/** A wall piece of a hole from z0 to z1 (z0 < z1): radius r0 at z0, r1 at z1 (a cylinder when equal, a cone when not). */
interface Seg { z0: number; z1: number; r0: number; r1: number }
interface HoleSpec { id: string; x: number; y: number; segs: Seg[]; /** blind: the floor sits at the lowest z */ blind?: boolean; /** a drill point below the floor */ }
const N = 24;
const ring = (x: number, y: number, z: number, r: number): V3[] => Array.from({ length: N + 1 }, (_, i) => [x + r * Math.cos((2 * Math.PI * i) / N), y + r * Math.sin((2 * Math.PI * i) / N), z]);

/** A plate 0..W in x and y, z from 0 to T, with the holes. Faces: P.C1 top, P.C0 bottom, per hole <id>.S.h<k> walls (+ floors). */
function plate(T: number, holes: HoleSpec[], W = 100) {
  const positions: number[] = [], normals: number[] = [], triFace: number[] = [], faceIds: string[] = [];
  const edges: Array<{ key: string; faces: string[]; pts: number[][] }> = [];
  const face = (name: string): number => { let i = faceIds.indexOf(name); if (i < 0) { faceIds.push(name); i = faceIds.length - 1; } return i; };
  const tri = (name: string, pts: V3[], n: V3): void => { const f = face(name); for (const p of pts) { positions.push(...p); normals.push(...n); } triFace.push(f); };
  face('P.C1'); face('P.C0');
  // the outer corners give the flat faces their reach
  const corners: V3[] = [[0, 0, 0], [W, 0, 0], [W, W, 0], [0, W, 0]];
  for (const h of holes) {
    const top = h.segs[h.segs.length - 1], bot = h.segs[0];
    // the flat faces: a fan from the rim to the far corners
    const rt = ring(h.x, h.y, T, top.r1), rb = ring(h.x, h.y, bot.z0, bot.r0);
    for (let i = 0; i < N; i++) {
      tri('P.C1', [rt[i], rt[i + 1], [corners[i % 4][0], corners[i % 4][1], T]], [0, 0, 1]);
      if (!h.blind) tri('P.C0', [rb[i], rb[i + 1], [corners[i % 4][0], corners[i % 4][1], 0]], [0, 0, -1]);
    }
    edges.push({ key: `${h.id}|top`, faces: [`${h.id}.S.h${h.segs.length}`, 'P.C1'], pts: rt });
    if (h.blind) {
      for (let i = 0; i < N; i++) tri(`${h.id}.S.fl`, [[h.x, h.y, bot.z0], rb[i], rb[i + 1]], [0, 0, 1]);
      edges.push({ key: `${h.id}|floor`, faces: [`${h.id}.S.h1`, `${h.id}.S.fl`], pts: rb });
    } else edges.push({ key: `${h.id}|bot`, faces: [`${h.id}.S.h1`, 'P.C0'], pts: rb });
    h.segs.forEach((s, k) => {
      const name = `${h.id}.S.h${k + 1}`;
      const a = ring(h.x, h.y, s.z0, s.r0), b = ring(h.x, h.y, s.z1, s.r1);
      for (let i = 0; i < N; i++) {
        const ang = (2 * Math.PI * (i + 0.5)) / N, slope = (s.r1 - s.r0) / (s.z1 - s.z0);
        const nl = Math.hypot(1, slope), n: V3 = [-Math.cos(ang) / nl, -Math.sin(ang) / nl, slope / nl];   // faces the axis (and a little up for a mouth widening upwards)
        tri(name, [a[i], a[i + 1], b[i + 1]], n); tri(name, [a[i], b[i + 1], b[i]], n);
      }
      if (k > 0) edges.push({ key: `${h.id}|step${k}`, faces: [name, `${h.id}.S.h${k}`], pts: a });   // where this piece meets the one below (the floor between them is not needed)
    });
  }
  return new HoleIndex(edges, { positions, normals, triFace, faceIds });
}
const bore = (id: string, x: number, y: number, T: number, d: number): HoleSpec => ({ id, x, y, segs: [{ z0: 0, z1: T, r0: d / 2, r1: d / 2 }] });

describe('readFastenHole', () => {
  it('a plain through hole: bore, open both ends, mouth on the top, exit on the bottom, thickness', () => {
    const r = readFastenHole('F4.S.h1', plate(12, [bore('F4', 20, 15, 12, 5.5)]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hole).toMatchObject({ face: 'F4.S.h1', diameter: 5.5, kind: 'plain', through: true, thickness: 12, grip: 12, seatDepth: 0, recessDiameter: null, bothOpen: true, farRecess: false, openFace: 'P.C1', exitFace: 'P.C0' });
    expect(r.hole.out).toEqual([0, 0, 1]);
    expect(r.hole.mouth).toEqual([20, 15, 12]); expect(r.hole.seat).toEqual([20, 15, 12]); expect(r.hole.exit).toEqual([20, 15, 0]);
  });
  it('the head end can be flipped on a plain through hole', () => {
    const ix = plate(12, [bore('F4', 20, 15, 12, 5.5)]);
    const r = readFastenHole('F4.S.h1', ix, { flip: true });
    expect(r.ok && r.hole.out).toEqual([0, 0, -1]);
    expect(r.ok && r.hole.mouth).toEqual([20, 15, 0]); expect(r.ok && r.hole.exit).toEqual([20, 15, 12]);
  });
  it('a counterbore: the head sits on the floor, the mouth is the top, the thickness is the whole plate; picking either wall reads the same hole', () => {
    const cb: HoleSpec = { id: 'F4', x: 20, y: 15, segs: [{ z0: 0, z1: 7, r0: 2.75, r1: 2.75 }, { z0: 7, z1: 12, r0: 5, r1: 5 }] };
    for (const pick of ['F4.S.h1', 'F4.S.h2']) {
      const r = readFastenHole(pick, plate(12, [cb]));
      expect(r.ok, pick).toBe(true);
      if (!r.ok) continue;
      expect(r.hole).toMatchObject({ face: 'F4.S.h1', diameter: 5.5, kind: 'cbore', through: true, thickness: 12, seatDepth: 5, recessDiameter: 10, grip: 7, bothOpen: false });
      expect(r.hole.mouth).toEqual([20, 15, 12]); expect(r.hole.seat).toEqual([20, 15, 7]); expect(r.hole.exit).toEqual([20, 15, 0]);
    }
  });
  it('a counterbore on the underside puts the head there, whichever way the pick goes', () => {
    const cb: HoleSpec = { id: 'F4', x: 20, y: 15, segs: [{ z0: 0, z1: 5, r0: 5, r1: 5 }, { z0: 5, z1: 12, r0: 2.75, r1: 2.75 }] };
    const r = readFastenHole('F4.S.h2', plate(12, [cb]));
    expect(r.ok && r.hole).toMatchObject({ kind: 'cbore', out: [0, 0, -1], seatDepth: 5, grip: 7 });
    expect(r.ok && r.hole.seat).toEqual([20, 15, 5]); expect(r.ok && r.hole.exit).toEqual([20, 15, 12]);
  });
  it('a countersink: a cone at the mouth widening to the top; the head seat is the flat top', () => {
    const cs: HoleSpec = { id: 'F4', x: 20, y: 15, segs: [{ z0: 0, z1: 9.8, r0: 2.75, r1: 2.75 }, { z0: 9.8, z1: 12, r0: 2.75, r1: 4.95 }] };
    const r = readFastenHole('F4.S.h1', plate(12, [cs]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hole).toMatchObject({ kind: 'csink', diameter: 5.5, recessDiameter: 9.9, through: true, thickness: 12, grip: 12, bothOpen: false });
    expect(r.hole.seatDepth).toBeCloseTo(2.2, 3);
    expect(r.hole.seat).toEqual([20, 15, 12]); expect(r.hole.exit).toEqual([20, 15, 0]);
  });
  it('a blind hole: no exit, the depth is the thickness, the head at the open end', () => {
    const b: HoleSpec = { id: 'F4', x: 20, y: 15, blind: true, segs: [{ z0: 4, z1: 12, r0: 2.1, r1: 2.1 }] };
    const r = readFastenHole('F4.S.h1', plate(12, [b]));
    expect(r.ok && r.hole).toMatchObject({ through: false, exit: null, exitFace: null, thickness: 8, grip: 8, bothOpen: false, out: [0, 0, 1], diameter: 4.2 });
  });
  it('the far end widening into a pocket: the nut seat is the pocket floor', () => {
    const p: HoleSpec = { id: 'F4', x: 20, y: 15, segs: [{ z0: 0, z1: 3, r0: 6, r1: 6 }, { z0: 3, z1: 12, r0: 2.75, r1: 2.75 }] };
    const r = readFastenHole('F4.S.h2', plate(12, [p]), { prefer: undefined });
    // the wider end is the head end by the rule, so flip to the pocket as the far side
    expect(r.ok && r.hole).toMatchObject({ kind: 'cbore', out: [0, 0, -1] });
    const f = readFastenHole('F4.S.h2', plate(12, [p]), { flip: true });
    expect(f.ok && f.hole).toMatchObject({ out: [0, 0, 1], farRecess: true });
    expect(f.ok && f.hole.exit).toEqual([20, 15, 3]);
  });
  it('refuses what is not a hole: a boss wall (normals out) and a face with no circle', () => {
    expect(readFastenHole('P.C1', plate(12, [bore('F4', 20, 15, 12, 5.5)])).ok).toBe(false);
    expect(readFastenHole('nothing', plate(12, [bore('F4', 20, 15, 12, 5.5)])).ok).toBe(false);
  });
});

describe('identical holes', () => {
  const read = (ix: HoleIndex) => allHoles(ix);
  it('holes of the same diameter, type and depth on the same plane are identical, whatever made them', () => {
    const ix = plate(12, [bore('F4', 10, 10, 12, 5.5), bore('F4~1', 30, 10, 12, 5.5), bore('F9', 10, 30, 12, 5.5), bore('F9~1', 30, 30, 12, 5.5)]);
    const hs = read(ix);
    expect(hs).toHaveLength(4);
    expect(identicalHoles(hs, hs[0])).toHaveLength(4);
    expect(identicalHoles(hs, hs[0])[0]).toBe(hs[0]);
  });
  it('a different diameter is not identical', () => {
    const hs = read(plate(12, [bore('F4', 10, 10, 12, 5.5), bore('F5', 30, 10, 12, 5.5), bore('F6', 20, 30, 12, 3.4)]));
    expect(identicalHoles(hs, hs.find((h) => h.diameter === 5.5)!).map((h) => h.face).sort()).toEqual(['F4.S.h1', 'F5.S.h1']);
    expect(identicalHoles(hs, hs.find((h) => h.diameter === 3.4)!)).toHaveLength(1);
  });
  it('a different depth is not identical (a blind hole next to a through hole, two blind depths)', () => {
    const blind = (id: string, x: number, z0: number): HoleSpec => ({ id, x, y: 10, blind: true, segs: [{ z0, z1: 12, r0: 2.75, r1: 2.75 }] });
    const hs = read(plate(12, [bore('F4', 10, 30, 12, 5.5), blind('F5', 30, 4), blind('F6', 50, 4), blind('F7', 70, 6)]));
    const b4 = hs.find((h) => h.face === 'F5.S.h1')!;
    expect(identicalHoles(hs, b4).map((h) => h.face).sort()).toEqual(['F5.S.h1', 'F6.S.h1']);
    expect(identicalHoles(hs, hs.find((h) => h.face === 'F4.S.h1')!)).toHaveLength(1);
  });
  it('within 1e-3 mm counts as the same depth, over it does not', () => {
    const blind = (id: string, x: number, z0: number): HoleSpec => ({ id, x, y: 10, blind: true, segs: [{ z0, z1: 12, r0: 2.75, r1: 2.75 }] });
    const hs = read(plate(12, [blind('F5', 10, 4), blind('F6', 30, 4.0005), blind('F7', 50, 4.01)]));
    expect(identicalHoles(hs, hs[0]).map((h) => h.face).sort()).toEqual(['F5.S.h1', 'F6.S.h1']);
  });
  it('a hole opening on another plane (the other side of the plate, or a stepped face) is not identical', () => {
    // two plates stacked at different heights: hole A opens at z = 12, hole B at z = 20
    const hs = read(plate(12, [bore('F4', 10, 10, 12, 5.5), { id: 'F5', x: 30, y: 10, segs: [{ z0: 8, z1: 20, r0: 2.75, r1: 2.75 }] }]));
    expect(hs.length).toBe(2);
    expect(identicalHoles(hs, hs[0])).toHaveLength(1);
    // a through hole read with the head on the other side is on another plane too
    const ix = plate(12, [bore('F4', 10, 10, 12, 5.5), bore('F5', 30, 10, 12, 5.5)]);
    const a = readFastenHole('F4.S.h1', ix)!, b = readFastenHole('F5.S.h1', ix, { flip: true })!;
    expect(a.ok && b.ok && identicalHoles([b.hole], a.hole)).toHaveLength(1);
  });
  it('a counterbore is not identical to a plain hole of the same bore, and counterbores of different recess are not either', () => {
    const cb = (id: string, x: number, r: number): HoleSpec => ({ id, x, y: 10, segs: [{ z0: 0, z1: 7, r0: 2.75, r1: 2.75 }, { z0: 7, z1: 12, r0: r, r1: r }] });
    const hs = read(plate(12, [bore('F4', 10, 30, 12, 5.5), cb('F5', 30, 5), cb('F6', 50, 5), cb('F7', 70, 6)]));
    expect(hs).toHaveLength(4);
    expect(identicalHoles(hs, hs.find((h) => h.face === 'F5.S.h1')!).map((h) => h.face).sort()).toEqual(['F5.S.h1', 'F6.S.h1']);
    expect(identicalHoles(hs, hs.find((h) => h.face === 'F4.S.h1')!)).toHaveLength(1);
  });
  it('pattern holes: the copies of a pattern are told by the @<pattern> suffix of their face names', () => {
    const hs = read(plate(12, [bore('F4', 10, 10, 12, 5.5), bore('F4', 30, 10, 12, 5.5)])).length;
    expect(hs).toBeGreaterThan(0);
    const mk = (face: string): never => ({ face } as never);
    const all = [mk('F4.S.h1'), mk('F4.S.h1@F9.1'), mk('F4.S.h1@F9.2'), mk('F5.S.h1'), mk('F4.S.h1@F12.1')];
    expect(patternHoles(all, 'F9', 'F4').map((h) => h.face)).toEqual(['F4.S.h1', 'F4.S.h1@F9.1', 'F4.S.h1@F9.2']);
  });
});
