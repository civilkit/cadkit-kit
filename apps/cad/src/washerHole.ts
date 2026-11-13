// Reading a hole off the part for the Washer wizard: the picked cylindrical face (or one of its circular edges) gives the hole's diameter and axis, and the face it opens on
// gives the plane the washer sits on. Pure functions over the edges and the mesh the view has (the same inputs the Knurl and Bearing wizards read), no DOM, no kernel.
//  - through hole: the washer can sit on either end (the first one found is the default, `seats` lists both);
//  - blind hole: it sits on the open end;
//  - counterbore: it sits on the counterbore floor (picking the small hole or the counterbore wall both give the floor);
//  - countersink or chamfered entrance, hole axis not along a world axis, not a hole at all: refused with a reason, never a guess.
import { circleOf, cylinderOfFace, type EdgeLike } from './threadData';
import type { FaceMesh } from './bearing';
import { WASHER_AXES } from './washer';

type V3 = [number, number, number];
export type HoleAxis = (typeof WASHER_AXES)[number];
export interface HoleSeat {
  /** the flat face the washer sits on */
  face: string;
  /** the centre of the hole on that face; the washer's first face goes here */
  origin: V3;
  /** the direction the washer's thickness runs: out of the material, away from the hole */
  axis: HoleAxis;
}
export interface WasherHole {
  /** the cylindrical face the hole was read from */
  face: string;
  /** hole diameter, mm (of the bore itself when a counterbore wall was picked) */
  diameter: number;
  seats: HoleSeat[];
  /** which of `seats` is in use */
  seat: number;
  blind: boolean;
  counterbore: boolean;
}
export type HoleRefusal = 'notHole' | 'countersink' | 'oblique' | 'noOpening' | 'noGeometry';
export type HoleResult = { ok: true; hole: WasherHole } | { ok: false; reason: HoleRefusal };

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: number[]): number => Math.hypot(a[0], a[1], a[2]);

export interface Tri { p: number[][]; n: number[][] }
export function trisOf(mesh: FaceMesh, face: string): Tri[] {
  const id = mesh.faceIds.indexOf(face);
  if (id < 0) return [];
  const out: Tri[] = [];
  for (let t = 0; t < mesh.triFace.length; t++) {
    if (mesh.triFace[t] !== id) continue;
    const p: number[][] = [], n: number[][] = [];
    for (let v = 0; v < 3; v++) { p.push([0, 1, 2].map((k) => mesh.positions[t * 9 + v * 3 + k])); n.push([0, 1, 2].map((k) => mesh.normals[t * 9 + v * 3 + k])); }
    out.push({ p, n });
  }
  return out;
}

/** The unit axis direction as the wizard's named axis, or null when it is not along x, y or z. */
function named(d: number[]): HoleAxis | null {
  const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-3);
  return k === undefined ? null : (((d[k] > 0 ? 'p' : 'n') + 'xyz'[k]) as HoleAxis);
}

/** Largest distance of the face's vertices from the axis line, and the mean absolute cosine between its normals and the axis. */
export function radialProfile(tris: Tri[], c: number[], d: number[]): { extent: number; tilt: number } {
  let extent = 0, tilt = 0, m = 0;
  for (const t of tris) for (let v = 0; v < 3; v++) {
    const q = sub(t.p[v], c), a = dot(q, d);
    extent = Math.max(extent, len([q[0] - a * d[0], q[1] - a * d[1], q[2] - a * d[2]]));
    const nl = len(t.n[v]);
    if (nl > 1e-12) { tilt += Math.abs(dot(t.n[v], d)) / nl; m++; }
  }
  return { extent, tilt: m ? tilt / m : 0 };
}

/**
 * Read the hole from a picked face name or edge key. `edges` and `mesh` are what the view has (controller.bodyEdges(), controller.bodyFaces()).
 * Preference of the end when both are open: the circular edge that was picked, else the end facing the larger world coordinate.
 */
export function holeFromPick(pick: string, edges: EdgeLike[], mesh: FaceMesh | null): HoleResult {
  if (!mesh || !edges.length) return { ok: false, reason: 'noGeometry' };
  // a picked edge: the cylinder is the face of it that is one
  const pickedEdge = edges.find((e) => e.key === pick);
  const face = pickedEdge ? (pickedEdge.faces ?? []).find((f) => cylinderOfFace(f, edges)) : pick;
  const cyl = face ? cylinderOfFace(face, edges) : null;
  if (!face || !cyl) return { ok: false, reason: 'notHole' };
  const d = cyl.axisDir, c = cyl.axisPoint, r = cyl.radius;
  const axisName = named(d);
  if (!axisName) return { ok: false, reason: 'oblique' };
  // a hole wall faces the axis: outward normals of the material point inwards
  const wall = trisOf(mesh, face);
  if (wall.length) {
    let radial = 0;
    for (const t of wall) for (let v = 0; v < 3; v++) { const q = sub(t.p[v], c), a = dot(q, d); radial += dot(t.n[v], [q[0] - a * d[0], q[1] - a * d[1], q[2] - a * d[2]]); }
    if (!(radial < 0)) return { ok: false, reason: 'notHole' };
  } else if (!cyl.internal) return { ok: false, reason: 'notHole' };

  // the two ends: edges of the wall that lie in one plane across the axis, with the face on their other side
  interface End { t: number; other: string; key?: string }
  const ends: End[] = [];
  for (const e of edges) {
    if (!e.pts?.length || !e.faces?.includes(face) || !circleOf(e.pts)) continue;
    const t = dot(e.pts[0], d);
    if (!e.pts.every((p) => Math.abs(dot(p, d) - t) < 1e-4)) continue;
    const other = e.faces.find((f) => f !== face);
    if (!other || ends.some((x) => Math.abs(x.t - t) < 1e-4)) continue;
    ends.push({ t, other, key: e.key });
  }
  if (ends.length !== 2) return { ok: false, reason: 'notHole' };
  ends.sort((a, b) => a.t - b.t);

  // what is across each end: an opening (a flat face reaching beyond the hole), a floor (a disc, a blind end), a floor with a smaller hole in it (the counterbore wall), a cone (countersink)
  type Kind = { kind: 'open'; extent: number } | { kind: 'floor' } | { kind: 'cbWall'; bore: number } | { kind: 'cone' } | { kind: 'other' };
  const classify = (e: End, outward: number): Kind => {
    const tris = trisOf(mesh, e.other);
    if (!tris.length) return { kind: 'other' };
    const prof = radialProfile(tris, c, d);
    if (prof.tilt > 0.98) {
      // flat across the axis: its normal must point away from the hole's other end to be an opening
      const sign = tris.reduce((s, t) => s + dot(t.n[0], d), 0) > 0 ? 1 : -1;
      if (prof.extent > r + 1e-3) return sign === outward ? { kind: 'open', extent: prof.extent } : { kind: 'other' };
      // a disc of the hole's own radius: a floor, unless it has a smaller round hole in it (then this wall is a counterbore)
      for (const ed of edges) {
        if (!ed.pts || !ed.faces?.includes(e.other)) continue;
        const ci = circleOf(ed.pts);
        if (ci && ci.r < r - 1e-3 && len(sub(ci.c, c).map((v, i) => v - dot(sub(ci.c, c), d) * d[i])) < 1e-3 * r + 1e-6 && Math.abs(dot(ci.n, d)) > 0.999) return { kind: 'cbWall', bore: ci.r * 2 };
      }
      return sign === -outward ? { kind: 'floor' } : { kind: 'other' };
    }
    if (prof.tilt > 0.05) return { kind: 'cone' };
    return { kind: 'other' };
  };
  // outward = the direction a washer would run at that end: away from the other end
  const kinds = [classify(ends[0], -1), classify(ends[1], 1)];
  if (kinds.some((x) => x.kind === 'cone')) return { ok: false, reason: 'countersink' };
  if (kinds.some((x) => x.kind === 'other')) return { ok: false, reason: 'notHole' };

  const at = (t: number): V3 => [0, 1, 2].map((i) => r3(c[i] + d[i] * (t - dot(c, d)))) as V3;
  const seatOf = (e: End, outward: number): HoleSeat => ({ face: e.other, origin: at(e.t), axis: named(d.map((v) => v * outward))! });
  const diameter = r3(2 * r);
  const seats: Array<HoleSeat & { extent: number }> = [];
  let counterbore = false, bore = diameter;
  for (let i = 0; i < 2; i++) {
    const outward = i === 0 ? -1 : 1, kd = kinds[i];
    if (kd.kind === 'open') seats.push({ ...seatOf(ends[i], outward), extent: kd.extent });
    else if (kd.kind === 'cbWall') {
      // the wall of a counterbore was picked: the hole is the bore in its floor, and the washer sits on that floor, running from it towards the open end of the wall
      counterbore = true; bore = r3(kd.bore);
      seats.length = 0;
      seats.push({ face: ends[i].other, origin: at(ends[i].t), axis: named(d.map((v) => v * -outward))!, extent: 0 });
      break;
    }
  }
  if (!seats.length) return { ok: false, reason: 'noOpening' };
  if (seats.length === 2 && Math.abs(seats[0].extent - seats[1].extent) > 0.05 * Math.max(seats[0].extent, seats[1].extent)) {
    // the small hole of a counterbore was picked: its end on the floor (a face that reaches less far round the hole than the part's face) is the one to seat on
    seats.sort((a, b) => a.extent - b.extent);
    counterbore = true;
  } else {
    // a plain hole: the picked edge's end first, else the end facing the larger world coordinate
    const prefer = pickedEdge ? ends.find((e) => e.key === pick) : undefined;
    const score = (s: HoleSeat): number => (s.axis[0] === 'p' ? 1 : 0) * 10 + 'xyz'.indexOf(s.axis[1]);
    seats.sort((a, b) => (prefer ? Number(b.face === prefer.other) - Number(a.face === prefer.other) : 0) || score(b) - score(a));
  }
  return { ok: true, hole: { face, diameter: bore, seats: seats.map(({ face, origin, axis }) => ({ face, origin, axis })), seat: 0, blind: kinds.some((x) => x.kind === 'floor'), counterbore } };
}
