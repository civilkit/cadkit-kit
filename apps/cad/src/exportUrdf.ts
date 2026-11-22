// Pure URDF (Unified Robot Description Format) builder and zip packager.
// Converts CadKit parts and assemblies (links/components, B-rep or mesh mass properties, and mates)
// into a valid single-tree URDF XML + per-link binary STL meshes (in metres) bundled as a `.zip`.
import { meshToStl, zipWrite, type MeshBody } from '@kit/io';
import type { MassRaw } from './inspect/mass';
import { densityOf } from './inspect/mass';
import { componentOfName, insertIds, type DocLike } from './assembly/model';
import type { AsmComponent } from './assembly/kernel';
import type { BodyRow } from './bodies';
import { fileStem, type ExportNotice, type ExportResult } from './exportFiles';

export type V3 = [number, number, number];
export type Mat3 = [V3, V3, V3];

/** Face geometry in world coordinates (mm), as returned by the kernel's `measure` + `describe`. */
export type UrdfFaceGeo =
  | { kind: 'plane'; o: V3; n: V3 }
  | { kind: 'cylinder' | 'cone'; o: V3; d: V3; r?: number }
  | { kind: 'sphere'; c: V3; r: number }
  | { kind: 'other' };

export interface UrdfMassData {
  /** Volume in mm³ (unit density). */
  volume?: number;
  /** Center of mass in world mm. */
  com?: V3;
  /** 3x3 inertia tensor about CoM for unit density in mm⁵ (world axes). */
  inertia?: Mat3;
  /** Principal moments for unit density in mm⁵ (used when `inertia` is omitted). */
  principal?: V3;
  /** Principal axes (unit vectors) corresponding to `principal`. */
  axes?: Mat3;
  /** Material density in g/cm³ (defaults to 1.0 when omitted). */
  density?: number;
}

export interface UrdfLinkInput {
  /** Component id (e.g. `F2`) or body key. */
  id: string;
  /** Human-readable link/body name. */
  name: string;
  /** World-frame triangle soup in millimetres (length = 9 * triangles). */
  positions: ArrayLike<number>;
  /** Optional `#rrggbb` hex color for `<visual><material>`. */
  color?: string;
  /** Optional opacity in [0, 1]. */
  opacity?: number;
  /** Grounded/fixed component in the assembly. */
  fixed?: boolean;
  /** Optional B-rep mass properties from the kernel (world-aligned, mm). */
  mass?: UrdfMassData;
  /** Material density in g/cm³ (default 1.0). */
  density?: number;
}

export interface UrdfMateInput {
  id: string;
  name?: string;
  kind: string;
  a?: string;
  b?: string;
  a2?: string;
  b2?: string;
  c?: string;
  /** Optional pre-resolved component ids; when omitted, resolved from `a`/`b` suffixes. */
  compA?: string;
  compB?: string;
  /** For `limits`: `'distance'` (mm) or `'angle'` (degrees). */
  of?: string;
  min?: number;
  max?: number;
  distance?: number;
  angle?: number;
  flip?: boolean;
  dir?: V3;
}

export interface UrdfBuildInput {
  /** Robot name (sanitized for XML and file names). */
  name?: string;
  /** Links (components or bodies) to export. */
  links: readonly UrdfLinkInput[];
  /** Assembly mates (empty for single/multi-body parts). */
  mates?: readonly UrdfMateInput[];
  /** World-frame face geometry keyed by face name. */
  faceGeo?: ReadonlyMap<string, UrdfFaceGeo> | Record<string, UrdfFaceGeo>;
  /** Default effort limit for revolute (N·m) and prismatic (N) joints. Default: 100. */
  defaultEffort?: number;
  /** Default velocity limit for revolute (rad/s) and prismatic (m/s) joints. Default: 1. */
  defaultVelocity?: number;
}

export type UrdfJointType = 'revolute' | 'continuous' | 'prismatic' | 'fixed';

export interface UrdfLinkBuilt {
  id: string;
  name: string;
  meshPath: string;
  /** Local-frame triangle positions in metres. */
  positionsMeters: Float32Array;
  /** Link frame origin in world metres. */
  originMeters: V3;
  massKg: number;
  comLocalMeters: V3;
  inertiaKgM2: Mat3;
  color?: string;
  opacity?: number;
}

export interface UrdfJointBuilt {
  name: string;
  type: UrdfJointType;
  parent: string;
  child: string;
  originMeters: V3;
  axis?: V3;
  limit?: { lower: number; upper: number; effort: number; velocity: number };
}

export interface UrdfBuilt {
  robotName: string;
  xml: string;
  links: UrdfLinkBuilt[];
  joints: UrdfJointBuilt[];
  warnings: string[];
}

// ---- vector & matrix math ---------------------------------------------------------------------------------------------------

const MM_TO_M = 1e-3;
const DEFAULT_DENSITY = 1.0; // g/cm³
const MIN_MASS_KG = 1e-9;
const MIN_INERTIA = 1e-12;
const XYZ: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const n = norm(a); return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 1]; };
const parallel = (a: V3, b: V3): boolean => Math.abs(dot(unit(a), unit(b))) > 1 - 1e-6;

function v3(a: ArrayLike<number> | undefined, fallback: V3 = [0, 0, 0]): V3 {
  if (!a || a.length < 3) return [fallback[0], fallback[1], fallback[2]];
  return [
    Number.isFinite(a[0]) ? a[0] : fallback[0],
    Number.isFinite(a[1]) ? a[1] : fallback[1],
    Number.isFinite(a[2]) ? a[2] : fallback[2],
  ];
}

function canon(v: V3): V3 {
  const u = unit(v);
  const i = [0, 1, 2].reduce((a, b) => (Math.abs(u[b]) > Math.abs(u[a]) + 1e-9 ? b : a), 0);
  return u[i] < 0 ? scale(u, -1) : u;
}

function span(vs: readonly V3[]): V3[] {
  const basis: V3[] = [];
  for (const v of vs) {
    let w = v;
    for (const b of basis) w = sub(w, scale(b, dot(w, b)));
    if (norm(w) > 1e-6) basis.push(unit(w));
    if (basis.length === 3) break;
  }
  return basis;
}

function complement(vs: readonly V3[]): V3[] {
  const b = span(vs);
  return span([...b, ...XYZ]).slice(b.length);
}

function perp2(d: V3): V3[] {
  const u = unit(d);
  const a: V3 = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = unit(cross(u, a));
  return [x, cross(u, x)];
}

/** Rodrigues rotation of vector `v` about unit axis `axis` by `angle` radians. */
function rotAxisAngle(axis: V3, angle: number, v: V3): V3 {
  const k = unit(axis);
  const c = Math.cos(angle), s = Math.sin(angle);
  const kv = cross(k, v);
  const kd = dot(k, v);
  return [
    v[0] * c + kv[0] * s + k[0] * kd * (1 - c),
    v[1] * c + kv[1] * s + k[1] * kd * (1 - c),
    v[2] * c + kv[2] * s + k[2] * kd * (1 - c),
  ];
}

/** Transform a local-frame point (mm) by a component placement `{ o, x, y, z }`. */
export function applyPlacePoint(place: { o: number[]; x: number[]; y: number[]; z: number[] }, p: V3): V3 {
  const o = v3(place.o), x = v3(place.x, [1, 0, 0]), y = v3(place.y, [0, 1, 0]), z = v3(place.z, [0, 0, 1]);
  return [
    o[0] + x[0] * p[0] + y[0] * p[1] + z[0] * p[2],
    o[1] + x[1] * p[0] + y[1] * p[1] + z[1] * p[2],
    o[2] + x[2] * p[0] + y[2] * p[1] + z[2] * p[2],
  ];
}

/** Rotate a 3x3 symmetric tensor from local part axes into world axes: `R * I * R^T`. */
export function rotateInertia(place: { x: number[]; y: number[]; z: number[] }, I: Mat3): Mat3 {
  const x = v3(place.x, [1, 0, 0]), y = v3(place.y, [0, 1, 0]), z = v3(place.z, [0, 0, 1]);
  // Columns of R are x, y, z -> R[i][k] = [x, y, z][k][i]
  const R: Mat3 = [
    [x[0], y[0], z[0]],
    [x[1], y[1], z[1]],
    [x[2], y[2], z[2]],
  ];
  const RI: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      RI[i][j] = R[i][0] * I[0][j] + R[i][1] * I[1][j] + R[i][2] * I[2][j];
    }
  }
  const out: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = RI[i][0] * R[j][0] + RI[i][1] * R[j][1] + RI[i][2] * R[j][2];
    }
  }
  return symmetrize(out);
}

function symmetrize(m: Mat3): Mat3 {
  const xy = 0.5 * (m[0][1] + m[1][0]);
  const xz = 0.5 * (m[0][2] + m[2][0]);
  const yz = 0.5 * (m[1][2] + m[2][1]);
  return [
    [m[0][0], xy, xz],
    [xy, m[1][1], yz],
    [xz, yz, m[2][2]],
  ];
}

// ---- naming & XML helpers ---------------------------------------------------------------------------------------------------

/** Sanitize a string to a URDF-safe identifier (`[A-Za-z0-9_.-]`, non-empty). */
export function urdfSafeName(s: string | undefined, fallback = 'link'): string {
  const t = (s ?? '').trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
  return t || fallback;
}

function makeUniquer(fallback = 'item'): (s: string | undefined) => string {
  const used = new Set<string>();
  return (s) => {
    const base = urdfSafeName(s, fallback);
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${n++}`;
    used.add(name.toLowerCase());
    return name;
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function fmtNum(v: number, zeroEps = 1e-12): string {
  const x = !Number.isFinite(v) || Math.abs(v) < zeroEps ? 0 : v;
  return String(+(Object.is(x, -0) ? 0 : x).toPrecision(9));
}

function fmtVec(v: V3, zeroEps = 1e-12): string {
  return `${fmtNum(v[0], zeroEps)} ${fmtNum(v[1], zeroEps)} ${fmtNum(v[2], zeroEps)}`;
}

/** Parse `#rrggbb` or `#rgb` hex color into `[r, g, b]` in `[0, 1]`. */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3
    ? m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2]
    : m[1];
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// ---- mass & inertia computation ---------------------------------------------------------------------------------------------

/** Exact signed volume (mm³), center of mass (mm), and unit-density inertia tensor about CoM (mm⁵) from a closed triangle mesh. */
export function meshMassProps(positions: ArrayLike<number>): { volume: number; com: V3; inertia: Mat3 } {
  const n = Math.floor(positions.length / 9);
  if (n === 0) return { volume: 0, com: [0, 0, 0], inertia: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };

  // Shift by first vertex for numerical stability when the mesh is far from the origin
  const rx = positions[0], ry = positions[1], rz = positions[2];
  let vol = 0;
  let cx = 0, cy = 0, cz = 0;
  // Second-moment covariance about `r`: C_ij = integral (x_i * x_j) dV
  let c00 = 0, c11 = 0, c22 = 0, c01 = 0, c02 = 0, c12 = 0;

  for (let t = 0; t < n; t++) {
    const o = t * 9;
    const p0 = positions[o] - rx, p1 = positions[o + 1] - ry, p2 = positions[o + 2] - rz;
    const q0 = positions[o + 3] - rx, q1 = positions[o + 4] - ry, q2 = positions[o + 5] - rz;
    const s0 = positions[o + 6] - rx, s1 = positions[o + 7] - ry, s2 = positions[o + 8] - rz;

    const dv = (p0 * (q1 * s2 - q2 * s1) + p1 * (q2 * s0 - q0 * s2) + p2 * (q0 * s1 - q1 * s0)) / 6;
    vol += dv;
    cx += dv * (p0 + q0 + s0) * 0.25;
    cy += dv * (p1 + q1 + s1) * 0.25;
    cz += dv * (p2 + q2 + s2) * 0.25;

    const k = dv / 10;
    c00 += k * (p0 * p0 + q0 * q0 + s0 * s0 + p0 * q0 + p0 * s0 + q0 * s0);
    c11 += k * (p1 * p1 + q1 * q1 + s1 * s1 + p1 * q1 + p1 * s1 + q1 * s1);
    c22 += k * (p2 * p2 + q2 * q2 + s2 * s2 + p2 * q2 + p2 * s2 + q2 * s2);
    const k2 = dv / 20;
    c01 += k2 * (2 * p0 * p1 + 2 * q0 * q1 + 2 * s0 * s1 + p0 * q1 + q0 * p1 + p0 * s1 + s0 * p1 + q0 * s1 + s0 * q1);
    c02 += k2 * (2 * p0 * p2 + 2 * q0 * q2 + 2 * s0 * s2 + p0 * q2 + q0 * p2 + p0 * s2 + s0 * p2 + q0 * s2 + s0 * q2);
    c12 += k2 * (2 * p1 * p2 + 2 * q1 * q2 + 2 * s1 * s2 + p1 * q2 + q1 * p2 + p1 * s2 + s1 * p2 + q1 * s2 + s1 * q2);
  }

  // Handle inverted winding gracefully
  if (vol < -1e-12) {
    vol = -vol; cx = -cx; cy = -cy; cz = -cz;
    c00 = -c00; c11 = -c11; c22 = -c22; c01 = -c01; c02 = -c02; c12 = -c12;
  }

  if (vol <= 1e-12) {
    // Open/degenerate mesh fallback: solid bounding box
    const { boxCom, boxVol, boxI } = bboxMassFallback(positions);
    return { volume: boxVol, com: boxCom, inertia: boxI };
  }

  const mx = cx / vol, my = cy / vol, mz = cz / vol;
  // Parallel axis shift of covariance to CoM
  const cc00 = Math.max(0, c00 - vol * mx * mx);
  const cc11 = Math.max(0, c11 - vol * my * my);
  const cc22 = Math.max(0, c22 - vol * mz * mz);
  const cc01 = c01 - vol * mx * my;
  const cc02 = c02 - vol * mx * mz;
  const cc12 = c12 - vol * my * mz;

  const inertia: Mat3 = [
    [cc11 + cc22, -cc01, -cc02],
    [-cc01, cc00 + cc22, -cc12],
    [-cc02, -cc12, cc00 + cc11],
  ];
  return { volume: vol, com: [mx + rx, my + ry, mz + rz], inertia };
}

function bboxMassFallback(positions: ArrayLike<number>): { boxVol: number; boxCom: V3; boxI: Mat3 } {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const x = positions[i + a];
      if (x < lo[a]) lo[a] = x;
      if (x > hi[a]) hi[a] = x;
    }
  }
  if (!Number.isFinite(lo[0])) return { boxVol: 0, boxCom: [0, 0, 0], boxI: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] };
  const e: V3 = [Math.max(1e-3, hi[0] - lo[0]), Math.max(1e-3, hi[1] - lo[1]), Math.max(1e-3, hi[2] - lo[2])];
  const boxCom: V3 = [(lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5, (lo[2] + hi[2]) * 0.5];
  const boxVol = e[0] * e[1] * e[2];
  const boxI: Mat3 = [
    [boxVol * (e[1] * e[1] + e[2] * e[2]) / 12, 0, 0],
    [0, boxVol * (e[0] * e[0] + e[2] * e[2]) / 12, 0],
    [0, 0, boxVol * (e[0] * e[0] + e[1] * e[1]) / 12],
  ];
  return { boxVol, boxCom, boxI };
}

/** Convert unit-density CadKit mass properties (mm³, mm, mm⁵) + density (g/cm³) to SI (kg, m, kg·m²). */
function resolveMassSi(link: UrdfLinkInput): { massKg: number; comWorldMm: V3; inertiaKgM2: Mat3 } {
  const dens = link.mass?.density ?? link.density ?? DEFAULT_DENSITY;
  const kgPerMm3 = dens * 1e-6; // 1 g/cm³ = 1e-6 kg/mm³
  const kgM2PerMm5 = kgPerMm3 * 1e-6; // mm² -> m² = 1e-6

  const m = link.mass;
  let vol = m?.volume;
  let com = m?.com ? v3(m.com) : undefined;
  let I: Mat3 | undefined = m?.inertia ? symmetrize(m.inertia) : undefined;

  if (!I && m?.principal && m?.axes) {
    const rebuilt: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 3; k++) {
      const p = m.principal[k];
      const a = m.axes[k];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rebuilt[i][j] += p * a[i] * a[j];
    }
    I = symmetrize(rebuilt);
  }

  if (vol === undefined || com === undefined || I === undefined) {
    const meshProps = meshMassProps(link.positions);
    if (vol === undefined) vol = meshProps.volume;
    if (com === undefined) com = meshProps.com;
    if (I === undefined) I = meshProps.inertia;
  }

  const massKg = Math.max(MIN_MASS_KG, vol * kgPerMm3);
  const inertiaKgM2: Mat3 = [
    [Math.max(MIN_INERTIA, I[0][0] * kgM2PerMm5), I[0][1] * kgM2PerMm5, I[0][2] * kgM2PerMm5],
    [I[1][0] * kgM2PerMm5, Math.max(MIN_INERTIA, I[1][1] * kgM2PerMm5), I[1][2] * kgM2PerMm5],
    [I[2][0] * kgM2PerMm5, I[2][1] * kgM2PerMm5, Math.max(MIN_INERTIA, I[2][2] * kgM2PerMm5)],
  ];
  return { massKg, comWorldMm: com, inertiaKgM2: symmetrize(inertiaKgM2) };
}

// ---- mate -> joint inference ------------------------------------------------------------------------------------------------

const GEOMETRIC_MATES = new Set([
  'coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular',
  'tangent', 'lock', 'symmetric', 'width', 'hinge', 'slot', 'screw',
]);

const isAxisGeo = (g: UrdfFaceGeo | undefined): g is Extract<UrdfFaceGeo, { d: V3 }> =>
  !!g && (g.kind === 'cylinder' || g.kind === 'cone');

const dirOfGeo = (g: UrdfFaceGeo | undefined): V3 | null =>
  !g ? null : g.kind === 'plane' ? g.n : isAxisGeo(g) ? g.d : null;

interface AxisLine { o: V3; d: V3; mate: UrdfMateInput; stop: boolean }

interface InferredJoint {
  type: UrdfJointType;
  /** World point on joint axis in mm (or child CoM for fixed joints / fallback). */
  originMm: V3;
  /** World unit axis (present for revolute, continuous, prismatic). */
  axis?: V3;
  /** [lower, upper] in radians (revolute) or metres (prismatic). */
  range?: [number, number];
  /** Primary mate name/id for naming the joint. */
  mateLabel?: string;
}

function nearestOnLine(o: V3, d: V3, p: V3): V3 {
  const u = unit(d);
  return add(o, scale(u, dot(sub(p, o), u)));
}

function inferJointFromMates(
  childName: string,
  mates: readonly UrdfMateInput[],
  limitMates: readonly UrdfMateInput[],
  childId: string,
  parentId: string,
  childFixed: boolean,
  parentFixed: boolean,
  geo: ReadonlyMap<string, UrdfFaceGeo>,
  childComMm: V3,
  warnings: string[],
): InferredJoint {
  if (childFixed || !mates.length) {
    return { type: 'fixed', originMm: [0, 0, 0] };
  }

  const T: V3[] = [];
  const R: V3[] = [];
  const lines: AxisLine[] = [];
  let hasResolvedMate = false;

  const g = (ref: string | undefined) => (ref ? geo.get(ref) : undefined);

  for (const m of mates) {
    const kind = m.kind;
    if (kind === 'lock') {
      T.push(...XYZ);
      R.push(...XYZ);
      hasResolvedMate = true;
      continue;
    }

    const ga = g(m.a), gb = g(m.b);
    const pp = ga?.kind === 'plane' && gb?.kind === 'plane';
    const aa = isAxisGeo(ga) && isAxisGeo(gb);
    const ss = ga?.kind === 'sphere' && gb?.kind === 'sphere';

    const axisMate = (stop: boolean) => {
      const t = gb as Extract<UrdfFaceGeo, { d: V3 }>;
      T.push(...perp2(t.d));
      R.push(...perp2(t.d));
      if (stop) T.push(t.d);
      lines.push({ o: t.o, d: unit(t.d), mate: m, stop });
      hasResolvedMate = true;
    };

    switch (kind) {
      case 'coincident':
      case 'distance':
      case 'symmetric':
        if (pp) { T.push(gb.n); R.push(...perp2(gb.n)); hasResolvedMate = true; }
        else if (aa) axisMate(false);
        else if (ss) { T.push(...XYZ); hasResolvedMate = true; }
        else if (ga?.kind === 'plane' && gb?.kind === 'sphere') { T.push(ga.n); hasResolvedMate = true; }
        else if (ga?.kind === 'sphere' && gb?.kind === 'plane') { T.push(gb.n); hasResolvedMate = true; }
        else if (ga?.kind === 'plane' && isAxisGeo(gb)) { T.push(ga.n); R.push(cross(gb.d, ga.n)); hasResolvedMate = true; }
        else if (isAxisGeo(ga) && gb?.kind === 'plane') { T.push(gb.n); R.push(cross(ga.d, gb.n)); hasResolvedMate = true; }
        else warnings.push(`mate ${m.name ?? m.id} (${kind}): unresolved face geometry, ignored`);
        break;
      case 'concentric':
        if (aa) axisMate(false);
        else if (ss) { T.push(...XYZ); hasResolvedMate = true; }
        else warnings.push(`mate ${m.name ?? m.id} (concentric): unresolved face geometry, ignored`);
        break;
      case 'hinge':
        if (aa) axisMate(typeof m.a2 === 'string' && typeof m.b2 === 'string');
        else warnings.push(`mate ${m.name ?? m.id} (hinge): unresolved axis geometry, ignored`);
        break;
      case 'screw':
        if (aa) axisMate(false);
        else warnings.push(`mate ${m.name ?? m.id} (screw): unresolved axis geometry, ignored`);
        break;
      case 'parallel': {
        const da = dirOfGeo(ga), db = dirOfGeo(gb);
        if (!da || !db) { warnings.push(`mate ${m.name ?? m.id} (parallel): unresolved face geometry, ignored`); break; }
        if ((ga!.kind === 'plane') === (gb!.kind === 'plane')) R.push(...perp2(db));
        else R.push(cross(da, db));
        hasResolvedMate = true;
        break;
      }
      case 'perpendicular':
      case 'angle': {
        const da = dirOfGeo(ga), db = dirOfGeo(gb);
        if (!da || !db) { warnings.push(`mate ${m.name ?? m.id} (${kind}): unresolved face geometry, ignored`); break; }
        if (kind === 'perpendicular' && (ga!.kind === 'plane') !== (gb!.kind === 'plane')) R.push(...perp2(db));
        else R.push(cross(da, db));
        hasResolvedMate = true;
        break;
      }
      case 'tangent':
        if (isAxisGeo(ga) && gb?.kind === 'plane') { T.push(gb.n); R.push(cross(ga.d, gb.n)); hasResolvedMate = true; }
        else if (ga?.kind === 'plane' && isAxisGeo(gb)) { T.push(ga.n); R.push(cross(gb.d, ga.n)); hasResolvedMate = true; }
        else if (ga?.kind === 'sphere' && gb?.kind === 'plane') { T.push(gb.n); hasResolvedMate = true; }
        else if (ga?.kind === 'plane' && gb?.kind === 'sphere') { T.push(ga.n); hasResolvedMate = true; }
        else if (aa) { const d = sub(ga.o, gb.o); T.push(sub(d, scale(gb.d, dot(d, gb.d)))); R.push(...perp2(gb.d)); hasResolvedMate = true; }
        else if (ss) { T.push(sub(ga.c, gb.c)); hasResolvedMate = true; }
        else warnings.push(`mate ${m.name ?? m.id} (tangent): unresolved face geometry, ignored`);
        break;
      case 'width':
        if (pp) { T.push(gb.n); R.push(...perp2(gb.n)); hasResolvedMate = true; }
        else warnings.push(`mate ${m.name ?? m.id} (width): unresolved face geometry, ignored`);
        break;
      case 'slot':
        if (isAxisGeo(ga) && gb?.kind === 'plane') { T.push(gb.n); R.push(cross(ga.d, gb.n)); hasResolvedMate = true; }
        else warnings.push(`mate ${m.name ?? m.id} (slot): unresolved face geometry, ignored`);
        break;
      default:
        warnings.push(`mate ${m.name ?? m.id} (${kind}): not mapped to a URDF joint`);
    }
  }

  if (!hasResolvedMate) {
    return { type: 'fixed', originMm: [0, 0, 0], mateLabel: mates[0]?.name ?? mates[0]?.id };
  }

  const tf = complement(T);
  const rf = complement(R);
  const firstLabel = mates[0]?.name ?? mates[0]?.id;

  // 0 DOF -> fixed
  if (tf.length === 0 && rf.length === 0) {
    return { type: 'fixed', originMm: [0, 0, 0], mateLabel: firstLabel };
  }

  // Extract applicable angle / distance limits
  const angleLimit = limitMates.find((m) => m.of === 'angle');
  const distLimit = limitMates.find((m) => m.of !== 'angle');

  const makeRotJoint = (dir: V3): InferredJoint => {
    const line = lines.find((l) => parallel(l.d, dir));
    const axis = line ? unit(line.d) : canon(dir);
    const originMm = line ? nearestOnLine(line.o, line.d, childComMm) : childComMm;
    const label = line ? (line.mate.name ?? line.mate.id) : firstLabel;
    if (angleLimit) {
      const range = computeAngleRangeRad(angleLimit, axis, childId, parentId, parentFixed, geo, warnings);
      if (range) return { type: 'revolute', originMm, axis, range, mateLabel: label };
    }
    return { type: 'continuous', originMm, axis, mateLabel: label };
  };

  const makeSlideJoint = (dir: V3): InferredJoint => {
    const line = lines.find((l) => parallel(l.d, dir));
    const axis = line ? unit(line.d) : canon(dir);
    const originMm = line ? nearestOnLine(line.o, line.d, childComMm) : childComMm;
    const label = line ? (line.mate.name ?? line.mate.id) : firstLabel;
    let range: [number, number] = [-1, 1]; // URDF requires finite limits for prismatic joints
    if (distLimit) {
      const r = computeDistanceRangeMeters(distLimit, axis, childId, parentId, parentFixed, geo, warnings);
      if (r) range = r;
    }
    return { type: 'prismatic', originMm, axis, range, mateLabel: label };
  };

  // Pure 1-DOF rotation (hinge, or concentric + planar stop)
  if (rf.length === 1 && tf.length === 0) {
    return makeRotJoint(rf[0]);
  }

  // Pure 1-DOF translation (slider)
  if (tf.length === 1 && rf.length === 0) {
    return makeSlideJoint(tf[0]);
  }

  // 2-DOF cylindrical (e.g. standalone concentric or screw): pick prismatic if distance-limited, else revolute/continuous
  if (rf.length === 1 && tf.length === 1) {
    warnings.push(`link ${childName}: cylindrical mate (1 rotational + 1 translational DOF) reduced to 1-DOF URDF joint`);
    if (distLimit && !angleLimit) return makeSlideJoint(tf[0]);
    return makeRotJoint(rf[0]);
  }

  // Higher multi-DOF (e.g. planar mate alone, spherical ball joint)
  warnings.push(`link ${childName}: ${tf.length}T + ${rf.length}R DOF cannot be represented as a single URDF joint; reduced to 1 DOF`);
  if (rf.length >= 1) return makeRotJoint(rf[0]);
  return makeSlideJoint(tf[0]);
}

function computeAngleRangeRad(
  m: UrdfMateInput,
  axis: V3,
  childId: string,
  parentId: string,
  parentFixed: boolean,
  geo: ReadonlyMap<string, UrdfFaceGeo>,
  warnings: string[],
): [number, number] | null {
  const lo0 = typeof m.min === 'number' && Number.isFinite(m.min) ? m.min : null;
  const hi0 = typeof m.max === 'number' && Number.isFinite(m.max) ? m.max : null;
  if (lo0 === null && hi0 === null) return null;

  const loRad = lo0 !== null ? (lo0 * Math.PI) / 180 : -Math.PI;
  const hiRad = hi0 !== null ? (hi0 * Math.PI) / 180 : Math.PI;

  const ga = m.a ? geo.get(m.a) : undefined;
  const gb = m.b ? geo.get(m.b) : undefined;
  const da = dirOfGeo(ga), db = dirOfGeo(gb);

  // If face directions are available, compute relative range around q = 0 (assembled pose)
  if (da && db) {
    const swap = m.compA === parentId && parentFixed;
    const [dm, dt] = swap ? [db, da] : [da, db];
    const childIsMover = (swap ? m.compB : m.compA) === childId;
    const theta = (q: number) => {
      const a = childIsMover ? rotAxisAngle(axis, q, dm) : dm;
      const t = childIsMover ? dt : rotAxisAngle(axis, q, dt);
      return Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(t)))));
    };
    const inside = (q: number) => {
      const v = theta(q);
      return (lo0 === null || v >= loRad - 1e-9) && (hi0 === null || v <= hiRad + 1e-9);
    };
    if (!inside(0)) {
      warnings.push(`limits ${m.name ?? m.id}: assembled pose is outside ${lo0 ?? '-inf'}..${hi0 ?? 'inf'} deg`);
      return [Math.min(loRad, hiRad), Math.max(loRad, hiRad)];
    }
    const edge = (sg: number): number | null => {
      const step = Math.PI / 360;
      let prev = 0;
      for (let q = step; q <= Math.PI + 1e-12; q += step) {
        if (!inside(sg * q)) {
          let a = prev, b = q;
          for (let i = 0; i < 40; i++) {
            const mid = (a + b) * 0.5;
            if (inside(sg * mid)) a = mid; else b = mid;
          }
          return sg * a;
        }
        prev = q;
      }
      return null;
    };
    const lo2 = edge(-1);
    const hi2 = edge(1);
    if (lo2 !== null || hi2 !== null) return [lo2 ?? -Math.PI, hi2 ?? Math.PI];
  }

  return [Math.min(loRad, hiRad), Math.max(loRad, hiRad)];
}

function computeDistanceRangeMeters(
  m: UrdfMateInput,
  axis: V3,
  childId: string,
  parentId: string,
  parentFixed: boolean,
  geo: ReadonlyMap<string, UrdfFaceGeo>,
  warnings: string[],
): [number, number] | null {
  const lo0 = typeof m.min === 'number' && Number.isFinite(m.min) ? m.min : null;
  const hi0 = typeof m.max === 'number' && Number.isFinite(m.max) ? m.max : null;
  if (lo0 === null && hi0 === null) return null;

  const ga = m.a ? geo.get(m.a) : undefined;
  const gb = m.b ? geo.get(m.b) : undefined;
  if (ga?.kind === 'plane' && gb?.kind === 'plane') {
    const swap = m.compA === parentId && parentFixed;
    const [gm, gt] = swap ? [gb, ga] : [ga, gb];
    const childIsMover = (swap ? m.compB : m.compA) === childId;
    const n = unit(gt.n);
    const v0 = dot(n, sub(gm.o, gt.o));
    const k = dot(n, axis) * (childIsMover ? 1 : -1);
    if (Math.abs(k) > 1e-9) {
      if ((lo0 !== null && v0 < lo0 - 1e-9) || (hi0 !== null && v0 > hi0 + 1e-9)) {
        warnings.push(`limits ${m.name ?? m.id}: assembled distance (${+v0.toFixed(4)} mm) is outside ${lo0 ?? '-inf'}..${hi0 ?? 'inf'} mm`);
      }
      const a = lo0 === null ? (k > 0 ? -1000 : 1000) : (lo0 - v0) / k;
      const b = hi0 === null ? (k > 0 ? 1000 : -1000) : (hi0 - v0) / k;
      return [Math.min(a, b) * MM_TO_M, Math.max(a, b) * MM_TO_M];
    }
  }

  const loM = (lo0 ?? -1000) * MM_TO_M;
  const hiM = (hi0 ?? 1000) * MM_TO_M;
  return [Math.min(loM, hiM), Math.max(loM, hiM)];
}

// ---- URDF builder -----------------------------------------------------------------------------------------------------------

/** Build a valid single-tree URDF XML document and per-link metre-scaled meshes from links and mates. */
export function buildUrdf(input: UrdfBuildInput): UrdfBuilt {
  const warnings: string[] = [];
  const effort = input.defaultEffort ?? 100;
  const velocity = input.defaultVelocity ?? 1;
  const robotName = urdfSafeName(input.name, 'robot');

  const validLinks = input.links.filter((l) => l.positions.length >= 9);
  const linkNamer = makeUniquer('link');
  const linkInfo = validLinks.map((l) => {
    const mass = resolveMassSi(l);
    return {
      input: l,
      id: l.id,
      name: linkNamer(l.name),
      fixed: l.fixed === true,
      massKg: mass.massKg,
      comWorldMm: mass.comWorldMm,
      inertiaKgM2: mass.inertiaKgM2,
    };
  });

  const byId = new Map(linkInfo.map((l) => [l.id, l]));
  const linkIds = new Set(linkInfo.map((l) => l.id));

  const geoMap: ReadonlyMap<string, UrdfFaceGeo> = input.faceGeo instanceof Map
    ? input.faceGeo
    : new Map(Object.entries(input.faceGeo ?? {}));

  // Resolve mate endpoints to link ids
  const resolveComp = (explicit: string | undefined, faceRef: string | undefined): string | null => {
    if (explicit && linkIds.has(explicit)) return explicit;
    if (!faceRef) return null;
    if (linkIds.has(faceRef)) return faceRef;
    return componentOfName(faceRef, linkIds);
  };

  const resolvedMates = (input.mates ?? []).map((m) => ({
    ...m,
    compA: resolveComp(m.compA, m.a) ?? undefined,
    compB: resolveComp(m.compB, m.b) ?? undefined,
  }));

  const geomEdges = resolvedMates
    .filter((m) => GEOMETRIC_MATES.has(m.kind) && m.compA && m.compB && m.compA !== m.compB)
    .map((m) => ({ m, a: m.compA!, b: m.compB! }));

  const limitMates = resolvedMates.filter((m) => m.kind === 'limits' && m.compA && m.compB && m.compA !== m.compB);

  // Build single rooted spanning tree:
  // Primary root = first fixed link, or first link overall.
  const primaryRoot = linkInfo.find((l) => l.fixed)?.id ?? linkInfo[0]?.id ?? null;
  const parentOf = new Map<string, string | null>();
  if (primaryRoot) parentOf.set(primaryRoot, null);

  // Any additional fixed links attach directly to primaryRoot with a fixed joint
  for (const l of linkInfo) {
    if (l.fixed && l.id !== primaryRoot && primaryRoot) {
      parentOf.set(l.id, primaryRoot);
    }
  }

  const bfs = () => {
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of geomEdges) {
        if (parentOf.has(e.a) && !parentOf.has(e.b)) { parentOf.set(e.b, e.a); grew = true; }
        else if (parentOf.has(e.b) && !parentOf.has(e.a)) { parentOf.set(e.a, e.b); grew = true; }
      }
    }
  };
  bfs();

  // Attach any remaining disconnected / unmated links to primaryRoot (fixed) so the URDF is always one valid tree
  for (const l of linkInfo) {
    if (parentOf.has(l.id)) continue;
    if (primaryRoot && l.id !== primaryRoot) parentOf.set(l.id, primaryRoot);
    else parentOf.set(l.id, null);
    bfs();
  }

  // Warn on mates that close kinematic loops
  for (const e of geomEdges) {
    if (parentOf.get(e.a) !== e.b && parentOf.get(e.b) !== e.a) {
      warnings.push(`mate ${e.m.name ?? e.m.id}: closes a kinematic loop between ${byId.get(e.a)!.name} and ${byId.get(e.b)!.name} (URDF supports trees only)`);
    }
  }

  // Order links parents-before-children
  const ordered: typeof linkInfo = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    const p = parentOf.get(id);
    if (p && byId.has(p)) visit(p);
    visited.add(id);
    ordered.push(byId.get(id)!);
  };
  for (const l of linkInfo) visit(l.id);

  // Infer joints and link frame origins (all link frames are world-aligned, R = I, origin at joint pivot or [0,0,0])
  const jointNamer = makeUniquer('joint');
  const originMmOf = new Map<string, V3>();
  const joints: UrdfJointBuilt[] = [];

  for (const l of ordered) {
    const parId = parentOf.get(l.id) ?? null;
    if (!parId) {
      originMmOf.set(l.id, [0, 0, 0]);
      continue;
    }
    const par = byId.get(parId)!;
    const between = geomEdges
      .filter((e) => (e.a === l.id && e.b === parId) || (e.b === l.id && e.a === parId))
      .map((e) => e.m);
    const limitsBetween = limitMates.filter(
      (m) => (m.compA === l.id && m.compB === parId) || (m.compB === l.id && m.compA === parId),
    );

    const inf = inferJointFromMates(
      l.name, between, limitsBetween, l.id, parId, l.fixed, par.fixed, geoMap, l.comWorldMm, warnings,
    );

    const linkOriginMm: V3 = inf.type === 'fixed' ? [0, 0, 0] : inf.originMm;
    originMmOf.set(l.id, linkOriginMm);
    const parentOriginMm = originMmOf.get(parId) ?? [0, 0, 0];
    const relOriginMeters = scale(sub(linkOriginMm, parentOriginMm), MM_TO_M);

    const jName = jointNamer(inf.mateLabel ? `${par.name}_to_${l.name}_${inf.mateLabel}` : `${par.name}_to_${l.name}`);
    const built: UrdfJointBuilt = {
      name: jName,
      type: inf.type,
      parent: par.name,
      child: l.name,
      originMeters: relOriginMeters,
      ...(inf.axis ? { axis: inf.axis } : {}),
      ...(inf.type === 'revolute' || inf.type === 'prismatic'
        ? {
            limit: {
              lower: inf.range ? inf.range[0] : (inf.type === 'revolute' ? -Math.PI : -1),
              upper: inf.range ? inf.range[1] : (inf.type === 'revolute' ? Math.PI : 1),
              effort,
              velocity,
            },
          }
        : {}),
    };
    joints.push(built);
  }

  // Transform each link's mesh into its local frame in metres
  const linksBuilt: UrdfLinkBuilt[] = ordered.map((l) => {
    const oMm = originMmOf.get(l.id) ?? [0, 0, 0];
    const src = l.input.positions;
    const triFloats = Math.floor(src.length / 9) * 9;
    const positionsMeters = new Float32Array(triFloats);
    for (let i = 0; i < triFloats; i += 3) {
      positionsMeters[i] = (src[i] - oMm[0]) * MM_TO_M;
      positionsMeters[i + 1] = (src[i + 1] - oMm[1]) * MM_TO_M;
      positionsMeters[i + 2] = (src[i + 2] - oMm[2]) * MM_TO_M;
    }
    const comLocalMeters = scale(sub(l.comWorldMm, oMm), MM_TO_M);
    return {
      id: l.id,
      name: l.name,
      meshPath: `meshes/${l.name}.stl`,
      positionsMeters,
      originMeters: scale(oMm, MM_TO_M),
      massKg: l.massKg,
      comLocalMeters,
      inertiaKgM2: l.inertiaKgM2,
      ...(l.input.color ? { color: l.input.color } : {}),
      ...(l.input.opacity !== undefined ? { opacity: l.input.opacity } : {}),
    };
  });

  const xml = serializeUrdfXml(robotName, linksBuilt, joints);
  return { robotName, xml, links: linksBuilt, joints, warnings };
}

function serializeUrdfXml(robotName: string, links: readonly UrdfLinkBuilt[], joints: readonly UrdfJointBuilt[]): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<robot name="${escapeXml(robotName)}">`,
  ];

  for (const l of links) {
    const I = l.inertiaKgM2;
    const rgb = l.color ? hexToRgb(l.color) : null;
    const alpha = l.opacity !== undefined ? Math.max(0, Math.min(1, l.opacity)) : 1;

    out.push(`  <link name="${escapeXml(l.name)}">`);
    out.push('    <inertial>');
    out.push(`      <origin xyz="${fmtVec(l.comLocalMeters)}" rpy="0 0 0"/>`);
    out.push(`      <mass value="${fmtNum(l.massKg, 0)}"/>`);
    out.push(
      `      <inertia ixx="${fmtNum(I[0][0], 0)}" ixy="${fmtNum(I[0][1])}" ixz="${fmtNum(I[0][2])}" ` +
      `iyy="${fmtNum(I[1][1], 0)}" iyz="${fmtNum(I[1][2])}" izz="${fmtNum(I[2][2], 0)}"/>`,
    );
    out.push('    </inertial>');

    out.push('    <visual>');
    out.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
    out.push('      <geometry>');
    out.push(`        <mesh filename="${escapeXml(l.meshPath)}"/>`);
    out.push('      </geometry>');
    if (rgb) {
      out.push(`      <material name="${escapeXml(l.name)}_material">`);
      out.push(`        <color rgba="${fmtNum(rgb[0], 1e-6)} ${fmtNum(rgb[1], 1e-6)} ${fmtNum(rgb[2], 1e-6)} ${fmtNum(alpha, 1e-6)}"/>`);
      out.push('      </material>');
    }
    out.push('    </visual>');

    out.push('    <collision>');
    out.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
    out.push('      <geometry>');
    out.push(`        <mesh filename="${escapeXml(l.meshPath)}"/>`);
    out.push('      </geometry>');
    out.push('    </collision>');
    out.push('  </link>');
  }

  for (const j of joints) {
    out.push(`  <joint name="${escapeXml(j.name)}" type="${j.type}">`);
    out.push(`    <parent link="${escapeXml(j.parent)}"/>`);
    out.push(`    <child link="${escapeXml(j.child)}"/>`);
    out.push(`    <origin xyz="${fmtVec(j.originMeters)}" rpy="0 0 0"/>`);
    if (j.axis) out.push(`    <axis xyz="${fmtVec(j.axis)}"/>`);
    if (j.limit) {
      out.push(
        `    <limit lower="${fmtNum(j.limit.lower)}" upper="${fmtNum(j.limit.upper)}" ` +
        `effort="${fmtNum(j.limit.effort, 0)}" velocity="${fmtNum(j.limit.velocity, 0)}"/>`,
      );
    }
    out.push('  </joint>');
  }

  out.push('</robot>');
  return out.join('\n') + '\n';
}

// ---- document -> UrdfBuildInput helper --------------------------------------------------------------------------------------

export interface UrdfDocMesh {
  positions: ArrayLike<number>;
  triFace?: ArrayLike<number>;
  faceIds?: string[];
}

export interface UrdfDocContext {
  doc: DocLike & { name?: string };
  mesh: UrdfDocMesh | null;
  bodyRows: readonly Pick<BodyRow, 'key' | 'name' | 'hidden' | 'faces' | 'look'>[];
  visibleOnly: boolean;
  components?: readonly AsmComponent[];
  overallMass?: MassRaw | null;
  /** Exact per-component (insertPart feature id) local mass properties from the kernel. */
  componentMass?: ReadonlyMap<string, MassRaw>;
  /** World-frame face geometry for mate faces. */
  faceGeo?: ReadonlyMap<string, UrdfFaceGeo>;
  /** Optional reference meshes to include as fixed links. */
  refs?: readonly MeshBody[];
}

/** Build `UrdfBuildInput` from an open CadKit document (works for both assemblies and single/multi-body parts). */
export function buildUrdfInputFromDoc(ctx: UrdfDocContext): UrdfBuildInput {
  const { doc, mesh, bodyRows, visibleOnly, refs = [] } = ctx;
  const docDensity = densityOf(doc.material) ?? DEFAULT_DENSITY;
  const inserts = doc.features.filter((f) => f.type === 'insertPart' && f.suppressed !== true);
  const links: UrdfLinkInput[] = [];

  if (inserts.length > 0 && mesh && mesh.positions.length >= 9 && mesh.triFace && mesh.faceIds) {
    // Assembly mode: group triangles by component (insertPart feature id)
    const insSet = insertIds(doc);
    const hiddenFaces = new Set<string>();
    const faceLook = new Map<string, { color?: string; opacity?: number }>();
    for (const r of bodyRows) {
      if (visibleOnly && r.hidden) for (const f of r.faces) hiddenFaces.add(f);
      if (r.look.color || r.look.opacity !== undefined) {
        for (const f of r.faces) faceLook.set(f, { color: r.look.color, opacity: r.look.opacity });
      }
    }

    const compTris = new Map<string, number[]>();
    const compLook = new Map<string, { color?: string; opacity?: number }>();
    const rootTris: number[] = [];
    for (const f of inserts) compTris.set(f.id, []);

    for (let t = 0; t < mesh.triFace.length; t++) {
      const fid = mesh.faceIds[mesh.triFace[t]];
      if (hiddenFaces.has(fid)) continue;
      const cid = componentOfName(fid, insSet);
      const dst = cid && compTris.has(cid) ? compTris.get(cid)! : rootTris;
      if (cid && !compLook.has(cid) && faceLook.has(fid)) compLook.set(cid, faceLook.get(fid)!);
      for (let k = t * 9; k < t * 9 + 9; k++) dst.push(mesh.positions[k]);
    }

    const placeById = new Map((ctx.components ?? []).map((c) => [c.id, c.place]));

    if (rootTris.length >= 9) {
      links.push({
        id: '__root__',
        name: doc.name || 'base_link',
        positions: Float32Array.from(rootTris),
        fixed: true,
        density: docDensity,
      });
    }

    for (const f of inserts) {
      const pts = compTris.get(f.id) ?? [];
      if (pts.length < 9) continue;
      const part = (f.part ?? {}) as { name?: string; material?: string };
      const dens = densityOf(part.material) ?? docDensity;
      const raw = ctx.componentMass?.get(f.id);
      const place = placeById.get(f.id);
      let mass: UrdfMassData | undefined;
      if (raw && typeof raw.volume === 'number') {
        const localCom = raw.com ? v3(raw.com) : undefined;
        let localI: Mat3 | undefined = raw.inertia && raw.inertia.length === 3
          ? [v3(raw.inertia[0]), v3(raw.inertia[1]), v3(raw.inertia[2])]
          : undefined;
        if (!localI && raw.principal?.length === 3 && raw.axes?.length === 3) {
          const rebuilt: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
          for (let k = 0; k < 3; k++) {
            const p = raw.principal[k], a = raw.axes[k];
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rebuilt[i][j] += p * a[i] * a[j];
          }
          localI = rebuilt;
        }
        mass = {
          volume: raw.volume,
          density: dens,
          ...(localCom ? { com: place ? applyPlacePoint(place, localCom) : localCom } : {}),
          ...(localI ? { inertia: place ? rotateInertia(place, localI) : localI } : {}),
        };
      }
      const look = compLook.get(f.id);
      links.push({
        id: f.id,
        name: String(f.name ?? part.name ?? f.id),
        positions: Float32Array.from(pts),
        fixed: f.fixed === true,
        density: dens,
        ...(mass ? { mass } : {}),
        ...(look?.color ? { color: look.color } : {}),
        ...(look?.opacity !== undefined ? { opacity: look.opacity } : {}),
      });
    }
  } else if (mesh && mesh.positions.length >= 9) {
    // Part mode (single or multi-body without insertPart)
    const { triFace, faceIds, positions } = mesh;
    if (triFace && faceIds && bodyRows.length > 0) {
      const owner = new Map<string, number>();
      bodyRows.forEach((r, i) => { for (const f of r.faces) owner.set(f, i); });
      const pos: number[][] = bodyRows.map(() => []);
      const rest: number[] = [];
      for (let t = 0; t < triFace.length; t++) {
        const i = owner.get(faceIds[triFace[t]]);
        const dst = i === undefined ? rest : pos[i];
        for (let k = t * 9; k < t * 9 + 9; k++) dst.push(positions[k]);
      }
      const visibleBodies = bodyRows
        .map((r, i) => ({ r, pts: pos[i] }))
        .filter(({ r, pts }) => pts.length >= 9 && !(visibleOnly && r.hidden));

      const singleBody = visibleBodies.length === 1 && rest.length === 0 && !visibleOnly;
      for (const { r, pts } of visibleBodies) {
        const mass = singleBody && ctx.overallMass ? rawMassToUrdf(ctx.overallMass, docDensity) : undefined;
        links.push({
          id: r.key,
          name: r.name,
          positions: Float32Array.from(pts),
          fixed: links.length === 0,
          density: docDensity,
          ...(mass ? { mass } : {}),
          ...(r.look.color ? { color: r.look.color } : {}),
          ...(r.look.opacity !== undefined ? { opacity: r.look.opacity } : {}),
        });
      }
      if (rest.length >= 9) {
        links.push({
          id: '__rest__',
          name: doc.name || 'base_link',
          positions: Float32Array.from(rest),
          fixed: links.length === 0,
          density: docDensity,
        });
      }
    } else {
      const mass = ctx.overallMass ? rawMassToUrdf(ctx.overallMass, docDensity) : undefined;
      links.push({
        id: '__body__',
        name: doc.name || 'base_link',
        positions,
        fixed: true,
        density: docDensity,
        ...(mass ? { mass } : {}),
      });
    }
  }

  // Reference meshes as additional fixed links
  refs.forEach((ref, i) => {
    if (ref.positions.length < 9) return;
    links.push({
      id: `__ref_${i}`,
      name: ref.name || `ref_${i + 1}`,
      positions: ref.positions,
      fixed: true,
      density: docDensity,
      ...(ref.color ? { color: ref.color } : {}),
      ...(ref.opacity !== undefined ? { opacity: ref.opacity } : {}),
    });
  });

  // Extract unsuppressed mates
  const mates: UrdfMateInput[] = doc.features
    .filter((f) => f.type === 'mate' && f.suppressed !== true)
    .map((f) => ({
      id: f.id,
      ...(typeof f.name === 'string' ? { name: f.name } : {}),
      kind: String(f.kind ?? ''),
      ...(typeof f.a === 'string' ? { a: f.a } : {}),
      ...(typeof f.b === 'string' ? { b: f.b } : {}),
      ...(typeof f.a2 === 'string' ? { a2: f.a2 } : {}),
      ...(typeof f.b2 === 'string' ? { b2: f.b2 } : {}),
      ...(typeof f.c === 'string' ? { c: f.c } : {}),
      ...(typeof f.of === 'string' ? { of: f.of } : {}),
      ...(typeof f.min === 'number' ? { min: f.min } : {}),
      ...(typeof f.max === 'number' ? { max: f.max } : {}),
      ...(typeof f.distance === 'number' ? { distance: f.distance } : {}),
      ...(typeof f.angle === 'number' ? { angle: f.angle } : {}),
      ...(f.flip === true ? { flip: true } : {}),
      ...(Array.isArray(f.dir) && f.dir.length === 3 ? { dir: v3(f.dir as number[]) } : {}),
    }));

  return {
    name: doc.name || 'robot',
    links,
    mates,
    ...(ctx.faceGeo ? { faceGeo: ctx.faceGeo } : {}),
  };
}

function rawMassToUrdf(raw: MassRaw, density: number): UrdfMassData {
  return {
    ...(typeof raw.volume === 'number' ? { volume: raw.volume } : {}),
    ...(raw.com && raw.com.length >= 3 ? { com: v3(raw.com) } : {}),
    ...(raw.inertia && raw.inertia.length === 3
      ? { inertia: [v3(raw.inertia[0]), v3(raw.inertia[1]), v3(raw.inertia[2])] }
      : {}),
    ...(raw.principal && raw.principal.length >= 3 ? { principal: v3(raw.principal) } : {}),
    ...(raw.axes && raw.axes.length === 3
      ? { axes: [v3(raw.axes[0]), v3(raw.axes[1]), v3(raw.axes[2])] }
      : {}),
    density,
  };
}

// ---- zip packager -----------------------------------------------------------------------------------------------------------

/** Export a URDF bundle (`<name>-urdf.zip` containing `<name>.urdf` + `meshes/<link>.stl` in metres). */
export async function exportUrdf(input: UrdfBuildInput): Promise<ExportResult> {
  const nonEmpty = input.links.filter((l) => l.positions.length >= 9);
  if (!nonEmpty.length) return { notices: [{ level: 'error', key: 'io.noBody' }] };

  const built = buildUrdf({ ...input, links: nonEmpty });
  const stem = fileStem(input.name);
  const enc = new TextEncoder();

  let triangles = 0;
  const files: Array<{ name: string; data: Uint8Array }> = [
    { name: `${stem}.urdf`, data: enc.encode(built.xml) },
  ];

  for (const link of built.links) {
    const stl = meshToStl({ positions: link.positionsMeters }, { name: link.name, binary: true });
    triangles += stl.triangles;
    files.push({ name: link.meshPath, data: stl.data as Uint8Array });
  }

  const data = await zipWrite(files, { deflate: true });
  const name = `${stem}-urdf.zip`;
  const notices: ExportNotice[] = [
    {
      level: 'info',
      key: 'io.doneUrdf',
      params: { name, links: built.links.length, joints: built.joints.length, triangles },
    },
    ...built.warnings.map((message): ExportNotice => ({ level: 'warn', key: 'io.urdfWarn', params: { message } })),
  ];

  return { file: { name, data, mime: 'application/zip' }, notices };
}
