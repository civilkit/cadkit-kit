// Reading a hole off the part for "Fasten this hole": the picked cylindrical face (or a hole feature's wall) gives the hole's axis and bore, the faces
// around it say whether the mouth is plain, counterbored or countersunk, where the head sits, where the hole ends (the exit plane a nut sits on, or a blind
// floor) and how much material it goes through. Also the grouping of identical holes (same axis direction, diameter, mouth plane, type and depth).
// Pure functions over the edges and the mesh the view has (controller.bodyEdges() / bodyFaces(), the inputs the Washer and Knurl wizards read): no DOM, no kernel.
import { circleOf, cylinderOfFace, type EdgeLike } from './threadData';
import type { FaceMesh } from './bearing';
import { radialProfile, trisOf, type Tri } from './washerHole';

type V3 = [number, number, number];
export type FastenKind = 'plain' | 'cbore' | 'csink';
export interface FastenHole {
  /** the wall of the bore (the narrowest cylinder of the hole) */
  face: string;
  /** diameter of the bore, mm */
  diameter: number;
  kind: FastenKind;
  /** unit vector along the axis, out of the material at the head side */
  out: V3;
  /** the hole's centre on the face it opens on (the mouth) */
  mouth: V3;
  /** the centre of the head's bearing face: the mouth, or the floor of a counterbore */
  seat: V3;
  /** the centre where a nut or washer sits on the far side (the end of the bore); null for a blind hole */
  exit: V3 | null;
  through: boolean;
  /** material thickness along the axis, mouth to the far face (a blind hole: its depth to the floor or the drill point), mm */
  thickness: number;
  /** from the bearing face to the exit (blind: to the floor), mm: the length a bolt has to span */
  grip: number;
  /** counterbore depth or countersink depth, 0 for a plain mouth, mm */
  seatDepth: number;
  /** counterbore or countersink diameter at the mouth, null for a plain mouth */
  recessDiameter: number | null;
  /** the flat face the hole opens on, and the one it leaves by */
  openFace: string;
  exitFace: string | null;
  /** a plain through hole: either end could take the head (the default is the end facing the larger world coordinate) */
  bothOpen: boolean;
  /** the far end widens into a pocket (the nut sits on its floor) */
  farRecess: boolean;
}
export type FastenRefusal = 'notHole' | 'noOpening' | 'noGeometry';
export type FastenResult = { ok: true; hole: FastenHole } | { ok: false; reason: FastenRefusal };

export const TOL = 1e-3;
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: number[]): number => Math.hypot(a[0], a[1], a[2]);

/** A piece of the hole's wall along the axis. t is the position along `d`; r0 is the radius at t0 and r1 at t1 (a drill point is a cone with r1 = 0). */
interface Seg { face: string; kind: 'cyl' | 'cone' | 'tip'; t0: number; t1: number; r0: number; r1: number }

/** The edges and the face triangles the view has, indexed once for all the reads of one part. */
export class HoleIndex {
  private byFace = new Map<string, EdgeLike[]>();
  private tris = new Map<string, Tri[]>();
  constructor(readonly edges: EdgeLike[], readonly mesh: FaceMesh) {
    for (const e of edges) for (const f of e.faces ?? []) { const l = this.byFace.get(f); if (l) l.push(e); else this.byFace.set(f, [e]); }
  }
  edgesOf(face: string): EdgeLike[] { return this.byFace.get(face) ?? []; }
  trisOf(face: string): Tri[] {
    let t = this.tris.get(face);
    if (!t) { t = trisOf(this.mesh, face); this.tris.set(face, t); }
    return t;
  }
}

/** The wall piece a face is, relative to the axis (point c, unit direction d): an internal cylinder or cone (a hole wall), or null. */
function segOf(ix: HoleIndex, face: string, c: number[], d: number[]): Seg | null {
  const edges = ix.edgesOf(face);
  const circles = edges.flatMap((e) => { const ci = e.pts ? circleOf(e.pts) : null; return ci ? [ci] : []; })
    .filter((ci) => Math.abs(Math.abs(dot(ci.n, d)) - 1) < 1e-4 && len(sub(sub(ci.c, c), d.map((v) => v * dot(sub(ci.c, c), d)))) < 1e-3 * ci.r + 1e-6);
  if (!circles.length) return null;
  const tris = ix.trisOf(face);
  if (!tris.length) return null;
  // a hole wall faces the axis: the material's outward normal points inwards
  let radial = 0;
  for (const t of tris) for (let v = 0; v < 3; v++) { const q = sub(t.p[v], c), a = dot(q, d); radial += dot(t.n[v], [q[0] - a * d[0], q[1] - a * d[1], q[2] - a * d[2]]); }
  if (!(radial < 0)) return null;
  const prof = radialProfile(tris, c, d);
  const ts = circles.map((ci) => ({ t: dot(ci.c, d), r: ci.r })).sort((a, b) => a.t - b.t);
  const lo = ts[0], hi = ts[ts.length - 1];
  const spread = hi.t - lo.t > 1e-6;
  if (prof.tilt <= 0.05) {
    if (!spread) return null;
    return { face, kind: 'cyl', t0: lo.t, t1: hi.t, r0: lo.r, r1: lo.r };
  }
  if (prof.tilt >= 0.98) return null;
  if (spread) return { face, kind: 'cone', t0: lo.t, t1: hi.t, r0: lo.r, r1: hi.r };
  // one circle only: a drill point; the apex is the face vertex farthest along the axis from the circle
  let far = lo.t, best = 0;
  for (const t of tris) for (const p of t.p) { const s = dot(p, d); if (Math.abs(s - lo.t) > best) { best = Math.abs(s - lo.t); far = s; } }
  return far > lo.t ? { face, kind: 'tip', t0: lo.t, t1: far, r0: lo.r, r1: 0 } : { face, kind: 'tip', t0: far, t1: lo.t, r0: 0, r1: lo.r };
}

interface End { t: number; kind: 'open' | 'floor' | 'tip' | 'other'; other?: string; seg: Seg }
function classifyEnd(ix: HoleIndex, seg: Seg, atT1: boolean, c: number[], d: number[]): End {
  const t = atT1 ? seg.t1 : seg.t0, outward = atT1 ? 1 : -1, re = atT1 ? seg.r1 : seg.r0;
  if (seg.kind === 'tip' && re === 0) return { t, kind: 'tip', seg };
  for (const e of ix.edgesOf(seg.face)) {
    const ci = e.pts ? circleOf(e.pts) : null;
    if (!ci || Math.abs(dot(ci.c, d) - t) > 1e-4 || Math.abs(ci.r - re) > 1e-3 * re + 1e-6) continue;
    const other = (e.faces ?? []).find((f) => f !== seg.face);
    if (!other) continue;
    const tris = ix.trisOf(other);
    if (!tris.length) return { t, kind: 'other', other, seg };
    const prof = radialProfile(tris, c, d);
    if (prof.tilt < 0.98) return { t, kind: 'other', other, seg };
    const sign = tris.reduce((s, tr) => s + dot(tr.n[0], d), 0) > 0 ? 1 : -1;
    if (prof.extent > re + 1e-3) return sign === outward ? { t, kind: 'open', other, seg } : { t, kind: 'other', other, seg };
    return sign === -outward ? { t, kind: 'floor', other, seg } : { t, kind: 'other', other, seg };
  }
  return { t, kind: 'other', seg };
}

export interface ReadOpts {
  /** a plain through hole: take the head to the other end */
  flip?: boolean;
  /** an edge key or face name picked, to prefer its end when both ends are alike */
  prefer?: string;
}

/**
 * Read the hole from a picked cylindrical face (any wall of the hole: bore, counterbore wall) or one of its circular edges.
 * The hole is the chain of coaxial wall pieces (cylinders and cones facing the axis) that touch end to end along the axis.
 */
export function readFastenHole(pick: string, ix: HoleIndex, opts: ReadOpts = {}): FastenResult {
  if (!ix.mesh || !ix.edges.length) return { ok: false, reason: 'noGeometry' };
  const pe = ix.edges.find((e) => e.key === pick);
  const face = pe ? (pe.faces ?? []).find((f) => cylinderOfFace(f, ix.edgesOf(f)) !== null) : pick;
  const cyl = face ? cylinderOfFace(face, ix.edgesOf(face)) : null;
  if (!face || !cyl) return { ok: false, reason: 'notHole' };
  const d = cyl.axisDir, c = cyl.axisPoint;
  const first = segOf(ix, face, c, d);
  if (!first || first.kind !== 'cyl') return { ok: false, reason: 'notHole' };

  // every coaxial wall piece of the part, then the chain that touches the picked one end to end
  const all: Seg[] = [first];
  for (const f of ix.mesh.faceIds) {
    if (f === face || !ix.edgesOf(f).length) continue;
    const s = segOf(ix, f, c, d);
    if (s) all.push(s);
  }
  const chain: Seg[] = [first];
  let lo = first.t0, hi = first.t1, grew = true;
  while (grew) {
    grew = false;
    for (const s of all) {
      if (chain.includes(s)) continue;
      if (Math.abs(s.t0 - hi) < 1e-3) { chain.push(s); hi = Math.max(hi, s.t1); grew = true; }
      else if (Math.abs(s.t1 - lo) < 1e-3) { chain.push(s); lo = Math.min(lo, s.t0); grew = true; }
    }
  }
  chain.sort((a, b) => a.t0 - b.t0);
  const segA = chain[0], segB = chain[chain.length - 1];
  const ends = [classifyEnd(ix, segA, false, c, d), classifyEnd(ix, segB, true, c, d)];
  const open = ends.map((e) => e.kind === 'open');
  if (!open[0] && !open[1]) return { ok: false, reason: ends.some((e) => e.kind === 'other') ? 'notHole' : 'noOpening' };
  if (ends.some((e) => e.kind === 'other')) return { ok: false, reason: 'notHole' };

  const cylR = chain.filter((s) => s.kind === 'cyl').map((s) => s.r0);
  const rb = Math.min(...cylR);
  // radius of the chain right at an end: how wide the mouth is there
  const endR = (i: number): number => (i === 0 ? segA.r0 : segB.r1);
  const dirOf = (i: number): number => (i === 0 ? -1 : 1);

  let head: number;
  if (open[0] && open[1]) {
    const wide = [endR(0) > rb + 1e-3, endR(1) > rb + 1e-3];
    if (wide[0] !== wide[1]) head = wide[0] ? 0 : 1;
    else {
      // both ends alike: the picked edge's end, else the end facing the larger world coordinate
      const pickedEnd = pe?.pts?.length ? ends.findIndex((e) => Math.abs(dot(pe.pts![0], d) - e.t) < 1e-4) : -1;
      const score = (i: number): number => { const o = d.map((v) => v * dirOf(i)); const k = [0, 1, 2].reduce((m, j) => (Math.abs(o[j]) > Math.abs(o[m]) ? j : m), 0); return (o[k] > 0 ? 1 : 0) * 10 + k; };
      head = pickedEnd >= 0 ? pickedEnd : score(1) >= score(0) ? 1 : 0;
    }
    if (opts.flip) head = 1 - head;
  } else head = open[0] ? 0 : 1;
  const far = 1 - head;
  const dirOut = dirOf(head);
  const tMouth = ends[head].t;
  // depth coordinate z: 0 at the mouth, growing into the material
  const zOf = (t: number): number => -dirOut * (t - tMouth);
  const segs = (head === 0 ? chain : [...chain].reverse()).map((s) => {
    const a = zOf(s.t0), b = zOf(s.t1);
    return a <= b ? { ...s, z0: a, z1: b, ra: s.r0, rb: s.r1 } : { ...s, z0: b, z1: a, ra: s.r1, rb: s.r0 };
  });
  const Z = Math.abs(ends[1].t - ends[0].t);

  // the mouth: a cone widening to the bore is a countersink, a wider cylinder a counterbore, the bore itself a plain mouth
  const s0 = segs[0];
  let kind: FastenKind = 'plain', seatZ = 0, recessDiameter: number | null = null, boreStart = 0;
  if (s0.kind === 'cone' && s0.ra > rb + 1e-3) { kind = 'csink'; recessDiameter = r3(2 * s0.ra); boreStart = s0.z1; }
  else if (s0.kind === 'cyl' && s0.ra > rb + 1e-3) { kind = 'cbore'; recessDiameter = r3(2 * s0.ra); seatZ = s0.z1; boreStart = s0.z1; }
  // the bore: the cylinders of the bore radius that follow
  const boreSegs = segs.filter((s) => s.kind === 'cyl' && Math.abs(s.ra - rb) < 1e-3 && s.z0 >= boreStart - 1e-3);
  if (!boreSegs.length) return { ok: false, reason: 'notHole' };
  let boreEnd = boreSegs[0].z1;
  for (const s of boreSegs.slice(1)) if (Math.abs(s.z0 - boreEnd) < 1e-3) boreEnd = Math.max(boreEnd, s.z1);
  const boreFace = boreSegs[0].face;

  const through = ends[far].kind === 'open';
  const farRecess = through && boreEnd < Z - 1e-3;
  const at = (z: number): V3 => [0, 1, 2].map((i) => r3(c[i] + d[i] * (tMouth - dirOut * z - dot(c, d)))) as V3;
  const out = d.map((v) => r3(v * dirOut)) as V3;
  const exitZ = through ? boreEnd : Z;
  return {
    ok: true,
    hole: {
      face: boreFace, diameter: r3(2 * rb), kind, out: out.map((v) => (v === 0 ? 0 : v)) as V3, mouth: at(0), seat: at(seatZ), exit: through ? at(exitZ) : null, through,
      thickness: r3(Z), grip: r3(exitZ - seatZ), seatDepth: r3(kind === 'plain' ? 0 : kind === 'csink' ? segs[0].z1 - segs[0].z0 : seatZ),
      recessDiameter, openFace: ends[head].other!, exitFace: through ? (ends[far].other ?? null) : null, bothOpen: open[0] && open[1] && kind === 'plain', farRecess,
    },
  };
}

/** Every hole of the part (one entry per bore), each read with its default head end. A wall that is not a hole is skipped. */
export function allHoles(ix: HoleIndex): FastenHole[] {
  const seen = new Set<string>();
  const out: FastenHole[] = [];
  for (const f of ix.mesh.faceIds) {
    if (seen.has(f) || !ix.edgesOf(f).length) continue;
    if (!cylinderOfFace(f, ix.edgesOf(f))) continue;
    const r = readFastenHole(f, ix);
    if (!r.ok || seen.has(r.hole.face)) continue;
    seen.add(r.hole.face); seen.add(f);
    out.push(r.hole);
  }
  return out;
}

/** The mouth plane of a hole as a signed distance along its `out` direction. */
const planeOf = (h: FastenHole): number => dot(h.mouth, h.out);

/**
 * The holes identical to `ref` (itself included, first): the same axis direction (out vectors equal), diameter, type, recess, depth and the same mouth plane
 * (a hole on a parallel face lying in the same plane counts, one on another plane does not), all within `tol` mm. Works on holes however they were made (a hole
 * feature, a pattern of it, a cut extrude): only the geometry is compared.
 */
export function identicalHoles(holes: FastenHole[], ref: FastenHole, tolerance = TOL): FastenHole[] {
  const tol = tolerance + 1e-9;   // the numbers are rounded to 1e-3: a difference of one step is within a tolerance of one step
  const same = (h: FastenHole): boolean =>
    len(sub(h.out, ref.out)) < 1e-4 && Math.abs(planeOf(h) - planeOf(ref)) <= tol && Math.abs(h.diameter - ref.diameter) <= tol
    && h.kind === ref.kind && (h.recessDiameter ?? 0) - (ref.recessDiameter ?? 0) <= tol && (ref.recessDiameter ?? 0) - (h.recessDiameter ?? 0) <= tol
    && Math.abs(h.seatDepth - ref.seatDepth) <= tol && h.through === ref.through && Math.abs(h.thickness - ref.thickness) <= tol;
  return [ref, ...holes.filter((h) => h.face !== ref.face && same(h))];
}

/** The holes of one pattern: the face names of a pattern's copies end `@<pattern id>.<n>`; the source hole's own face is the one without it. */
export function patternHoles(holes: FastenHole[], patternId: string, sourceId: string): FastenHole[] {
  const inst = (h: FastenHole): boolean => h.face.includes(`@${patternId}.`) && h.face.startsWith(`${sourceId}.`);
  return holes.filter((h) => inst(h) || (h.face.startsWith(`${sourceId}.`) && !h.face.includes('@')));
}
