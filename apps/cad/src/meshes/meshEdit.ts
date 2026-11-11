// Edits of a reference mesh record and the sketch plane through a picked surface point. Pure.
import { unit, cross, type P3 } from '../sketch3d/curves';
import { inPlane } from '../sketch3d/model';
import { worldBox, type MeshRec, type V3 } from './meshDoc';

/** Move the mesh so its box is centred on the origin in the ground plane and rests on it (the ground is normal to the up axis). */
export function onGround(rec: MeshRec, up: 'y' | 'z'): MeshRec {
  const b = worldBox(rec);
  const c: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const ui = up === 'z' ? 2 : 1;
  const d: V3 = [-c[0], -c[1], -c[2]];
  d[ui] = -b.min[ui];
  return { ...rec, pos: [rec.pos[0] + d[0], rec.pos[1] + d[1], rec.pos[2] + d[2]] };
}
/** Move the mesh so the centre of its box is the origin. */
export function centred(rec: MeshRec): MeshRec {
  const b = worldBox(rec);
  return { ...rec, pos: [rec.pos[0] - (b.min[0] + b.max[0]) / 2, rec.pos[1] - (b.min[1] + b.max[1]) / 2, rec.pos[2] - (b.min[2] + b.max[2]) / 2] };
}
/** Turn 90 degrees about a world axis, keeping the box centre where it is. */
export function turned(rec: MeshRec, axis: 0 | 1 | 2, deg = 90): MeshRec {
  const b = worldBox(rec);
  const mid: V3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  // compose: new rotation = Rworld(axis, deg) * R(rec); read back as XYZ degrees
  const rw = axisRotation(axis, deg), r = rotMat(rec.rot);
  const m = mul3(rw, r);
  const rot = eulerOf(m);
  const next = { ...rec, rot };
  const b2 = worldBox(next);
  const mid2: V3 = [(b2.min[0] + b2.max[0]) / 2, (b2.min[1] + b2.max[1]) / 2, (b2.min[2] + b2.max[2]) / 2];
  return { ...next, pos: [next.pos[0] + mid[0] - mid2[0], next.pos[1] + mid[1] - mid2[1], next.pos[2] + mid[2] - mid2[2]] };
}

type M3 = number[];
const rotMat = (rot: V3): M3 => {
  const [a, b, c] = rot.map((d) => (d * Math.PI) / 180);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  return [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa, sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa, -sb, cb * sa, cb * ca];
};
const axisRotation = (axis: 0 | 1 | 2, deg: number): M3 => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return axis === 0 ? [1, 0, 0, 0, c, -s, 0, s, c] : axis === 1 ? [c, 0, s, 0, 1, 0, -s, 0, c] : [c, -s, 0, s, c, 0, 0, 0, 1];
};
const mul3 = (a: M3, b: M3): M3 => {
  const o: M3 = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
/** XYZ degrees (R = Rz Ry Rx) of a rotation matrix. */
const eulerOf = (m: M3): V3 => {
  const sb = Math.max(-1, Math.min(1, -m[6]));
  const b = Math.asin(sb);
  let a: number, c: number;
  if (Math.abs(sb) < 0.999999) { a = Math.atan2(m[7], m[8]); c = Math.atan2(m[3], m[0]); }
  else { a = Math.atan2(-m[5], m[4]); c = 0; }
  const d = (x: number) => Math.round(((x * 180) / Math.PI) * 1e9) / 1e9 + 0;
  return [d(a), d(b), d(c)];
};

export type PlaneKind = 'normal' | 'front' | 'top' | 'right';

/** A `plane` feature (mode `frame`) through a surface point: square to the surface normal, or parallel to one of the three base planes. */
export function planeThrough(pos: P3, normal: P3, kind: PlaneKind, name: string): Record<string, unknown> {
  let x: P3, y: P3;
  if (kind === 'normal') {
    const n = unit(normal) ?? [0, 0, 1];
    x = inPlane(n);
    y = cross(n, x);
  } else if (kind === 'front') { x = [1, 0, 0]; y = [0, 1, 0]; }
  else if (kind === 'top') { x = [1, 0, 0]; y = [0, 0, 1]; }
  else { x = [0, 1, 0]; y = [0, 0, 1]; }
  const r = (p: P3): number[] => p.map((v) => Math.round(v * 1e9) / 1e9);
  return { type: 'plane', mode: 'frame', origin: r(pos), xDir: r(x), yDir: r(y), name };
}
