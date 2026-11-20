// Pure rules of the Sweep surface and Blend surface forms (FeatureOptions.tsx): which fields each form owns, what the profile, path and
// face pickers offer, and the draft patches their controls make. No DOM, so they are tested without a browser (procSurfaceRules.test.tsx)
// and against the kernel (proceduralSurfaces.kernel.test.ts). A patch value of null removes the field.
import type { PartDoc } from '@ck/part-model';
import { t } from './i18n';
import { CURVE_FEATURES, faceList, isVec3 } from './curveRules';
import { hasCurves, isClosedSketch, isOpenSketch } from './featureCreators';
import { sketchInfos } from './surfaceRules';

type Wire = Record<string, unknown>;
type Feat = { id: string; type: string; name?: string; [k: string]: unknown };
const feats = (doc: PartDoc | null | undefined): Feat[] => ((doc?.features ?? []) as unknown as Feat[]);
const labelOf = (f: Feat): string => (f.name ? `${f.name} (${f.id})` : f.id);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The fields these forms own; the generic editor hides them. */
export function procSurfaceManaged(type: string): Set<string> {
  switch (type) {
    case 'sweepSurface': return new Set(['profile', 'path', 'frame', 'up', 'caps', 'tolerance', 'gapTolerance']);
    case 'blendSurface': return new Set(['faces', 'radius', 'sides', 'from', 'to', 'at', 'tolerance']);
    default: return new Set();
  }
}

// ---- Sweep surface ----

/** What the kernel takes for a profile or a path: a feature id (a sketch, else an earlier curve feature), one curve reference, or a list of references in chain order. */
export type CurveInput = string | Wire | Wire[] | null | undefined;
/** The curve features a sweep can take (a procedural one is swept along its definition). */
export const SWEEP_CURVE_FEATURES = [...CURVE_FEATURES, 'helix'] as const;
/** Set in the form from a pick list: only a plain id is written there; references (edges, curves of a sketch) stay as they were written. */
export const inputIsCustom = (v: unknown): boolean => (Array.isArray(v) && v.length > 0) || (!!v && typeof v === 'object' && !Array.isArray(v));
export const inputId = (v: unknown): string => (typeof v === 'string' ? v : '');
/** No profile or no path (`sweepSurfaceNoInput`). */
export const inputMissing = (v: unknown): boolean => !inputIsCustom(v) && inputId(v) === '';
/** The curve references of a custom input, as a list. */
export const inputRefs = (v: unknown): Wire[] => (Array.isArray(v) ? (v as Wire[]).filter((r) => r && typeof r === 'object') : v && typeof v === 'object' ? [v as Wire] : []);

/** The choices for a profile or path: sketches that hold a curve (the path may also be an open 3D sketch), then the curve features before this one. The current value is kept even when it no longer fits. */
export function inputChoices(doc: PartDoc | null | undefined, selfId: string, current: unknown, role: 'profile' | 'path'): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const infos = sketchInfos(doc);
  for (const s of infos) {
    const f = feats(doc).find((x) => x.id === s.id);
    if (!f) continue;
    if (f.type === 'sketch3d') { if (role === 'path' && isOpenSketch(f)) out.push([s.id, s.name]); continue; }
    if (hasCurves(f)) out.push([s.id, s.name]);
  }
  for (const f of feats(doc)) {
    if (f.id === selfId) break;
    if ((SWEEP_CURVE_FEATURES as readonly string[]).includes(f.type)) out.push([f.id, `${t('feature.' + f.type, undefined, f.type)}: ${labelOf(f)}`]);
  }
  const cur = inputId(current);
  if (cur && !out.some(([v]) => v === cur)) out.unshift([cur, cur]);
  return out;
}
/** A custom input in words (the form shows it read-only next to a way back to a plain choice). */
export function inputSummary(doc: PartDoc | null | undefined, v: unknown): string {
  const refs = inputRefs(v);
  return refs.map((r) => {
    if (r.kind === 'sketchCurve') { const s = feats(doc).find((f) => f.id === r.sketch); return t('opt.editCurve.ref.sketch', { entity: String(r.entity), sketch: s ? labelOf(s) : String(r.sketch) }); }
    if (r.kind === 'edge') return t('opt.editCurve.ref.edge', { faces: Array.isArray(r.faces) ? (r.faces as string[]).join(' | ') : '' });
    if (r.kind === 'curve') { const f = feats(doc).find((x) => x.id === r.id); return f ? labelOf(f) : String(r.id); }
    return '';
  }).filter(Boolean).join(', ');
}
/** The same sketch or curve as profile and path: the surface has no area. */
export const sameInput = (eff: Wire): boolean => inputId(eff.profile) !== '' && inputId(eff.profile) === inputId(eff.path);

/** `tangent`: the profile turns with the path (the default); `translate`: it is carried without turning. */
export const SWEEP_FRAMES = ['tangent', 'translate'] as const;
export type SweepFrame = (typeof SWEEP_FRAMES)[number];
export const sweepFrameOf = (eff: Wire): SweepFrame => (eff.frame === 'translate' ? 'translate' : 'tangent');
/** Keep orientation has no up direction (the kernel reads `up` for the tangent frame only), so it goes with the choice. */
export const sweepFramePatch = (f: SweepFrame): Wire => (f === 'translate' ? { frame: 'translate', up: null } : { frame: null });

/** The up direction: left to the kernel (`auto`), a world axis, or a vector. */
export const UP_CHOICES = ['auto', 'x', '-x', 'y', '-y', 'z', '-z', 'vector'] as const;
export type UpChoice = (typeof UP_CHOICES)[number];
const AXIS_VEC: Record<string, [number, number, number]> = { x: [1, 0, 0], '-x': [-1, 0, 0], y: [0, 1, 0], '-y': [0, -1, 0], z: [0, 0, 1], '-z': [0, 0, -1] };
export function upChoiceOf(eff: Wire): UpChoice {
  if (!isVec3(eff.up)) return 'auto';
  const hit = Object.entries(AXIS_VEC).find(([, v]) => v.every((x, i) => x === (eff.up as number[])[i]));
  return (hit ? hit[0] : 'vector') as UpChoice;
}
export function upPatch(eff: Wire, c: UpChoice): Wire {
  if (c === 'auto') return { up: null };
  if (c === 'vector') return { up: isVec3(eff.up) ? eff.up : [0, 0, 1] };
  return { up: [...AXIS_VEC[c]] };
}
export const upComponentPatch = (eff: Wire, i: number, v: number): Wire => ({ up: (isVec3(eff.up) ? eff.up : [0, 0, 1]).map((x, k) => (k === i ? v : x)) });
/** An up vector of length 0 cannot give a frame (`invalidValue`). */
export const upIsZero = (eff: Wire): boolean => isVec3(eff.up) && eff.up.every((x) => x === 0);

/** Caps close a closed planar profile on an open path: offered when the profile is a closed sketch, and kept visible while on so it can be turned off. */
export function capsOffered(doc: PartDoc | null | undefined, eff: Wire): boolean {
  if (eff.caps === true) return true;
  const f = feats(doc).find((x) => x.id === inputId(eff.profile));
  return !!f && f.type === 'sketch' && isClosedSketch(f);
}
export const capsPatch = (on: boolean): Wire => ({ caps: on ? true : null });
/** A tolerance of 0 or below is refused (`invalidValue`). */
export const toleranceInvalid = (v: unknown): boolean => num(v) && v <= 0;
export const SWEEP_DEFAULTS = { frame: 'tangent', tolerance: 0.001 } as const;

// ---- Sweep (the solid sweep, and its sheet) path ----

/** The path of a `sweep`: an open sketch (`{kind: 'sketch', id}`) or an earlier curve feature (`{kind: 'curve', id}`: a helix, an Edit,
 *  Project, Offset or Composite curve; a procedural one of lines and arcs is swept along those pieces exactly, any other along a spline
 *  through its points). The drop-down value is the sketch id, or `curve:<id>` for a curve feature. */
export function sweepPathValue(eff: Wire): string {
  const p = eff.path as { kind?: unknown; id?: unknown } | null | undefined;
  return p && typeof p.id === 'string' && p.id ? (p.kind === 'curve' ? 'curve:' + p.id : p.id) : '';
}
export const sweepPathPatch = (v: string): Wire => (v.startsWith('curve:') ? { path: { kind: 'curve', id: v.slice(6) } } : { path: { kind: 'sketch', id: v } });
/** The open sketches given, then the curve features before the sweep `selfId`; the current path is kept (first) when it no longer fits. */
export function sweepPathChoices(doc: PartDoc | null | undefined, selfId: string, eff: Wire, open: Array<{ id: string; name: string }>): Array<[string, string]> {
  const out: Array<[string, string]> = open.map((s): [string, string] => [s.id, s.name]);
  for (const f of feats(doc)) {
    if (f.id === selfId) break;
    if ((SWEEP_CURVE_FEATURES as readonly string[]).includes(f.type)) out.push(['curve:' + f.id, `${t('feature.' + f.type, undefined, f.type)}: ${labelOf(f)}`]);
  }
  const cur = sweepPathValue(eff);
  if (cur && !out.some(([v]) => v === cur)) out.unshift([cur, cur.replace(/^curve:/, '')]);
  return out;
}

// ---- Blend surface ----

/** Radius at the start of the span and (for a varying blend) at its end: `3` or `[3, 5]`. */
export const radiusVaries = (eff: Wire): boolean => Array.isArray(eff.radius);
export const radiusStart = (eff: Wire): unknown => (Array.isArray(eff.radius) ? eff.radius[0] : eff.radius);
export const radiusEnd = (eff: Wire): unknown => (Array.isArray(eff.radius) ? eff.radius[1] : undefined);
/** Writing the start radius keeps the end when the blend varies. */
export const radiusStartPatch = (eff: Wire, v: number | string): Wire => ({ radius: radiusVaries(eff) ? [v, radiusEnd(eff) ?? v] : v });
export const radiusEndPatch = (eff: Wire, v: number | string): Wire => ({ radius: [radiusStart(eff) ?? 1, v] });
/** The switch: on starts the end at the start radius, off keeps the start only. */
export const varyPatch = (eff: Wire, on: boolean): Wire => ({ radius: on ? [radiusStart(eff) ?? 1, radiusStart(eff) ?? 1] : radiusStart(eff) ?? 1 });
/** A radius of 0 or below (`invalidValue`); expressions are left to the kernel. */
export const radiusInvalid = (eff: Wire): boolean => [radiusStart(eff), radiusEnd(eff)].some((r) => num(r) && r <= 0);

/** The blend needs two different faces (`invalidValue` on `faces`). */
export const blendFaceCount = (eff: Wire): number => faceList(eff).length;
export const blendNeedsTwoFaces = (eff: Wire): boolean => blendFaceCount(eff) !== 2;
export const blendSameFace = (eff: Wire): boolean => { const f = faceList(eff); return f.length === 2 && f[0] === f[1]; };

/** `edge`: the edge the two faces share (the nearest to `at` when they share several); `points`: a line between two points. */
export const SPANS = ['edge', 'points'] as const;
export type Span = (typeof SPANS)[number];
export const spanOf = (eff: Wire): Span => (isVec3(eff.from) || isVec3(eff.to) ? 'points' : 'edge');
/** Switching the span: two points keep the ones written, else start from `derived` (blendSpanFromFaces of the picked faces), else a line of 10 along x. */
export function spanPatch(eff: Wire, s: Span, derived?: BlendSpan | null): Wire {
  if (s === 'points') {
    if (isVec3(eff.from) && isVec3(eff.to)) return { at: null, from: eff.from, to: eff.to };
    return { at: null, from: isVec3(eff.from) ? eff.from : derived?.from ?? [0, 0, 0], to: isVec3(eff.to) ? eff.to : derived?.to ?? [10, 0, 0] };
  }
  return { from: null, to: null };
}

/** A two-point span of a blend surface. */
export interface BlendSpan { from: [number, number, number]; to: [number, number, number] }
/** A view mesh: three vertices per triangle (xyz), the face of each triangle. */
export type FaceMesh = { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] } | null | undefined;
type P3 = [number, number, number];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist3 = (a: P3, b: P3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp3 = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** The point of triangle abc closest to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p: P3, a: P3, b: P3, c: P3): P3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot3(ab, ap), d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b), d3 = dot3(ab, bp), d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return lerp3(a, b, d1 / (d1 - d3));
  const cp = sub(p, c), d5 = dot3(ab, cp), d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return lerp3(a, c, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return lerp3(b, c, (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}
/** The triangles of face `name` in any of the meshes. */
function trianglesOf(meshes: FaceMesh[], name: string): P3[][] {
  const out: P3[][] = [];
  for (const m of meshes) {
    if (!m) continue;
    const f = m.faceIds.indexOf(name);
    if (f < 0) continue;
    const P = m.positions;
    for (let t = 0; t < m.triFace.length; t++) {
      if (m.triFace[t] !== f) continue;
      const o = t * 9;
      out.push([[P[o], P[o + 1], P[o + 2]], [P[o + 3], P[o + 4], P[o + 5]], [P[o + 6], P[o + 7], P[o + 8]]]);
    }
  }
  return out;
}
/** At most `max` of the corners of the triangles, evenly spread (the derivation stays fast on a finely meshed face). */
function cornersOf(tris: P3[][], max = 400): P3[] {
  const all = tris.flat();
  const step = Math.max(1, Math.ceil(all.length / max));
  return all.filter((_, i) => i % step === 0);
}
const round4 = (v: number): number => { const r = Math.round(v * 1e4) / 1e4; return r === 0 ? 0 : r; };
const before = (a: P3, b: P3): boolean => { for (let k = 0; k < 3; k++) if (Math.abs(a[k] - b[k]) > 1e-6) return a[k] < b[k]; return false; };

/**
 * The default two-point span of a blend between faces `a` and `b`, from their view meshes. The rule: every mesh corner of each face is
 * paired with the closest point of the other face; the pairs within 1 % of the size of the two faces of the closest pair make up the
 * contact (the shared edge when the faces touch along one, the nearest borders across a gap), and the midpoints of those pairs are the
 * candidates. The span is the two candidates furthest apart (the farthest point from their centre, then the farthest from that one),
 * the lower one (by x, then y, then z) first, rounded to 1e-4 mm. So it depends only on the two faces, not on the order they were picked
 * in, and for faces that share a straight edge it is that edge. Null when a face is not on screen, the faces are the same, or the
 * contact is a single point.
 */
export function blendSpanFromFaces(meshes: FaceMesh[], a: string, b: string): BlendSpan | null {
  if (a === b) return null;
  const ta = trianglesOf(meshes, a), tb = trianglesOf(meshes, b);
  if (!ta.length || !tb.length) return null;
  const lo: P3 = [Infinity, Infinity, Infinity], hi: P3 = [-Infinity, -Infinity, -Infinity];
  for (const p of [...ta.flat(), ...tb.flat()]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const band = 0.01 * dist3(lo, hi);
  const pairs: Array<{ d: number; m: P3 }> = [];
  const pairUp = (corners: P3[], tris: P3[][]) => {
    for (const p of corners) {
      let best: P3 | null = null, bd = Infinity;
      for (const [x, y, z] of tris) { const q = closestOnTriangle(p, x, y, z); const d = dist3(p, q); if (d < bd) { bd = d; best = q; } }
      if (best) pairs.push({ d: bd, m: lerp3(p, best, 0.5) });
    }
  };
  pairUp(cornersOf(ta), tb);
  pairUp(cornersOf(tb), ta);
  const dMin = Math.min(...pairs.map((x) => x.d));
  const cand = pairs.filter((x) => x.d <= dMin + band).map((x) => x.m);
  const c: P3 = [0, 1, 2].map((k) => cand.reduce((s, p) => s + p[k], 0) / cand.length) as P3;
  const far = (from: P3): P3 => cand.reduce((best, p) => (dist3(p, from) > dist3(best, from) + 1e-9 || (Math.abs(dist3(p, from) - dist3(best, from)) <= 1e-9 && before(p, best)) ? p : best), cand[0]);
  const p = far(c), q = far(p);
  if (dist3(p, q) < 1e-6) return null;
  const [s, e] = before(q, p) ? [q, p] : [p, q];
  return { from: s.map(round4) as P3, to: e.map(round4) as P3 };
}
export const vecPatch = (eff: Wire, key: 'from' | 'to' | 'at', i: number, v: number): Wire => ({ [key]: (isVec3(eff[key]) ? (eff[key] as number[]) : [0, 0, 0]).map((x, k) => (k === i ? v : x)) });
/** In edge mode the edge nearest to a point can be chosen when the faces share several. */
export const atOn = (eff: Wire): boolean => isVec3(eff.at);
export const atPatch = (eff: Wire, on: boolean): Wire => (on ? { at: isVec3(eff.at) ? eff.at : [0, 0, 0] } : { at: null });
/** Two equal points give no span (`blendSurfaceSpan`). */
export const spanIsPoint = (eff: Wire): boolean => isVec3(eff.from) && isVec3(eff.to) && eff.from.every((x, i) => x === (eff.to as number[])[i]);

/** Which side of each face the ball lies on: +1 the side its outward normal points to, -1 against it. Without `sides` each face turns toward the other one. */
export const sidesOf = (eff: Wire): [number, number] | null => (Array.isArray(eff.sides) && eff.sides.length === 2 && eff.sides.every((s) => s === 1 || s === -1) ? [eff.sides[0], eff.sides[1]] as [number, number] : null);
/** The sides in force: the ones written, else the ones the kernel chose (its marker's `sides`), else null. */
export function sidesInForce(eff: Wire, built: ArrayLike<number> | null | undefined): [number, number] | null {
  const own = sidesOf(eff);
  if (own) return own;
  return built && built.length === 2 && (built[0] === 1 || built[0] === -1) && (built[1] === 1 || built[1] === -1) ? [built[0], built[1]] : null;
}
/** Flip one face's side. Without sides written yet both are written, starting from the ones in force (the kernel's choice), else from a round (both against the normals). */
export function flipSide(eff: Wire, i: 0 | 1, built?: ArrayLike<number> | null): Wire {
  const cur = sidesInForce(eff, built) ?? [-1, -1];
  const next: [number, number] = [cur[0], cur[1]];
  next[i] = (next[i] === 1 ? -1 : 1);
  return { sides: next };
}
/** Back to the kernel's choice: each face toward the other. */
export const autoSidesPatch = (): Wire => ({ sides: null });
export const BLEND_DEFAULTS = { tolerance: 0.001 } as const;
