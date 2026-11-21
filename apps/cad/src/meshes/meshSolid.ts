// Convert mesh to solid, phase 1: a PREVIEW. The kernel's `meshToSolid` turns the triangles of a reference mesh (or of a mesh file
// read for the purpose) into a solid on a scratch tag of its own; nothing is added to the document. This file is the pure part: the
// options the panel edits and the request built from them, the reply read into a report or a refusal the panel shows, the number
// formatting, and the preview body and markers for the viewport. The kernel call is `runMeshToSolid` (any object with `request`).
// Accepting the result into the part is phase 2 (meshSolidAccept.ts): it needs an `importMesh` feature in the kernel first.
import type { ViewSurface } from '@kit/viewport';
import { meshFromBody } from '@ck/mesh';
import { bytesToBase64, decode, matrixOf, type MeshRec, type V3 } from './meshDoc';

/** The kernel tag the preview is built on (never the document's tag): a later run replaces it, closing the panel empties it. */
export const MESH_SOLID_TAG = 'mesh-solid-preview';
/** The kernel's `maxTriangles` default: above it the mesh is refused (meshTooLarge), so Run is disabled. */
export const MAX_TRIANGLES = 200000;
/** Above this the panel warns that the conversion can take a while (the kernel holds the page's worker meanwhile): a 50 000 triangle
 *  free-form surface (a scan) takes one to two minutes, where a 50 000 triangle cylinder takes a second. */
export const WARN_TRIANGLES = 20000;

/**
 * What the panel edits. `null` means "the kernel's default" (it scales with the size of the mesh, so the app has no number for it); only
 * what differs from the defaults goes into the request (see `requestOpts`). Lengths are millimetres.
 */
export interface MeshSolidOptions {
  /** close gaps and holes before the watertight check (off: an open mesh is refused, which invents nothing) */
  close: boolean;
  /** with `close`: vertices on gaps closer than this are welded (kernel default: 1e-4 of the diagonal) */
  closeTolerance: number | null;
  /** with `close`: fill the holes that remain (kernel default true; false only welds and stitches) */
  fill: boolean;
  /** with `close` and `fill`: largest hole that is filled, in edges (kernel default 500) */
  maxHoleEdges: number | null;
  /** largest distance of a merged triangle from its face's plane (kernel default 1e-5 of the diagonal) */
  planeTol: number | null;
  /** largest angle between a merged triangle and its face, degrees (kernel default 0.05) */
  angleTolDeg: number | null;
  /** largest distance of a facet corner from a fitted cylinder, cone or sphere (kernel default 2e-5 of the diagonal) */
  fitTol: number | null;
  /** refit planes, cylinders, cones and spheres (kernel default true; false keeps every curved area as facets) */
  analytic: boolean;
  /** the analytic fit's work budget: null the kernel default (3 work units; the fit stops there and the rest stays faceted), 0 unlimited (can take minutes on a scan) */
  maxSeconds: number | null;
  /** thin the triangles first, within a stated deviation (a scan of 100 000 triangles or more): the kernel's `opts.decimate` */
  decimate: boolean;
  /** with `decimate`: the largest distance of the thinned mesh from the original, mm (required by the kernel; the panel suggests one from the size of the mesh) */
  decimateTol: number | null;
  /** with `decimate`: stop at this many triangles (default: as far as the tolerance allows) */
  decimateTarget: number | null;
  /** with `decimate`: edges where faces meet at more than this angle, degrees, are kept as creases (default none) */
  decimateKeepAngle: number | null;
}

export const DEFAULT_MESH_SOLID_OPTIONS: Readonly<MeshSolidOptions> = Object.freeze({
  close: false, closeTolerance: null, fill: true, maxHoleEdges: null, planeTol: null, angleTolDeg: null, fitTol: null, analytic: true, maxSeconds: null,
  decimate: false, decimateTol: null, decimateTarget: null, decimateKeepAngle: null,
});

/** The request's `opts`: only what the user changed from the kernel's defaults; undefined when nothing was. */
export function requestOpts(o: MeshSolidOptions): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (o.planeTol !== null) out.planeTol = o.planeTol;
  if (o.angleTolDeg !== null) out.angleTolDeg = o.angleTolDeg;
  if (o.fitTol !== null) out.fitTol = o.fitTol;
  if (!o.analytic) out.analytic = false;
  if (o.maxSeconds !== null) out.maxSeconds = o.maxSeconds;
  if (o.decimate && o.decimateTol !== null) {
    const d: Record<string, unknown> = { tol: o.decimateTol };
    if (o.decimateTarget !== null) d.targetTriangles = o.decimateTarget;
    if (o.decimateKeepAngle !== null) d.keepAngleDeg = o.decimateKeepAngle;
    out.decimate = d;
  }
  if (o.close) {
    const c: Record<string, unknown> = {};
    if (o.closeTolerance !== null) c.tolerance = o.closeTolerance;
    if (!o.fill) c.fill = false;
    else if (o.maxHoleEdges !== null) c.maxHoleEdges = o.maxHoleEdges;
    out.close = Object.keys(c).length ? c : true;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A number field's text: an empty field is the default (null); anything that is not a number above 0 is `invalid`. */
export function parseTol(text: string, integer = false): { value: number | null; invalid: boolean } {
  const s = text.trim();
  if (!s) return { value: null, invalid: false };
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) return { value: null, invalid: true };
  return { value: n, invalid: false };
}

/** The most triangles Decimate takes in: it brings a scan under MAX_TRIANGLES, but the mesh still has to be sent and welded. */
export const MAX_DECIMATE_INPUT = 2_000_000;

export type TriangleLimit = 'ok' | 'warn' | 'over';
/** With `decimate` the mesh may exceed the kernel's limit (the limit then applies to the thinned mesh); it still warns above WARN_TRIANGLES. */
export const triangleLimit = (tris: number, decimate = false): TriangleLimit =>
  (tris > (decimate ? MAX_DECIMATE_INPUT : MAX_TRIANGLES) ? 'over' : tris > WARN_TRIANGLES ? 'warn' : 'ok');

/**
 * A starting tolerance for Decimate from the size of the mesh: 0.05 percent of its diagonal, two significant digits (a 200 mm part: 0.1 mm), never
 * below 0.001 mm. Null when the size is unknown. The user changes it; this only saves typing a number for a first look.
 */
export function suggestDecimateTol(diagonal: number | null | undefined): number | null {
  if (!diagonal || !Number.isFinite(diagonal) || diagonal <= 0) return null;
  return Math.max(0.001, Number((diagonal * 0.0005).toPrecision(2)));
}

/** Welded vertices and triangle corners, millimetres, in world coordinates. */
export interface MeshInput { vertices: Float32Array; indices: Uint32Array }

/**
 * The record's triangles where they are drawn: its placement (position, rotation, scale) is applied before sending, so the solid, the
 * kernel's `positions` of gaps and the `at` of filled holes are all in world coordinates and line up with the mesh on screen without a
 * transform back. (Phase 2 must keep it so: the feature's blob then holds world coordinates, or the feature carries the placement.)
 */
export function worldMesh(rec: MeshRec): MeshInput {
  const d = decode(rec).mesh;
  const m = matrixOf(rec);
  const identity = rec.pos.every((v) => v === 0) && rec.rot.every((v) => v === 0) && rec.scale === 1;
  if (identity) return { vertices: d.vertices, indices: d.indices };
  const v = d.vertices, out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return { vertices: out, indices: d.indices };
}

const b64 = (a: Float32Array | Uint32Array): string => bytesToBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));

/** The kernel message (docs/spec-agent-interface.md "Mesh to solid"): typed arrays as little-endian base64, `opts` only when something changed. */
export function meshSolidRequest(mesh: MeshInput, o: MeshSolidOptions, at: { tag?: string; name: string }): Record<string, unknown> {
  const opts = requestOpts(o);
  return { type: 'meshToSolid', tag: at.tag ?? MESH_SOLID_TAG, name: at.name, positionsF32: b64(mesh.vertices), indicesU32: b64(mesh.indices), ...(opts ? { opts } : {}) };
}

// ---- the reply ----

export interface FilledHole { edges: number; area: number; planar: boolean; method: string; at: V3 | null }
export interface MeshSolidReport {
  triangles: number;
  faces: number;
  /** the diagonal of the mesh's box (mm): the scale of "too small to matter" */
  diagonal: number;
  /** faces by kind: `planar` the true planes, `faceted` the flat facets left on curved areas that were not refit (the kernel counts
   *  those among its planes; they are told apart here) */
  kinds: { planar: number; faceted: number; cylinder: number; cone: number; sphere: number; other: number };
  /** why the analytic fit did not run (`analytic: false`, nothing to fit ...), or null */
  analyticSkipped: string | null;
  /** the analytic fit ran out of its work budget: the rest of the curved areas stays faceted */
  budgetExhausted: boolean;
  /** curved areas the fit declined, with the kernel's reason */
  declined: Array<{ reason: string; detail: string }>;
  deviation: { max: number; rms: number } | null;
  /** the thinning, when Decimate ran: triangles before and after, the tolerance, and the largest distance measured on the thinned mesh (mm) */
  decimation: { inputTriangles: number; triangles: number; tol: number; deviation: number; stoppedBy: string } | null;
  volume: { mesh: number | null; body: number | null; relative: number | null };
  /** repairs the kernel did and reports (welded, dropped, flipped ...): count by name, only the ones above 0 */
  repairs: Array<{ key: string; n: number }>;
  closing: { openEdges: number; mergedVertices: number; stitched: number; filledHoles: number; filledTriangles: number; filledArea: number; holes: FilledHole[] } | null;
  /** wall time of the request, measured here (the kernel's reply has no timing) */
  ms: number;
}
export interface FailedHole { reason: string; edges: number | null; area: number | null; at: V3 | null }
export interface MeshSolidRefusal {
  code: string;
  /** the kernel's text, shown verbatim */
  message: string;
  hint: string;
  reason: string | null;
  /** where it is: midpoints of open edges, the failing holes, ... (world coordinates, see `worldMesh`) */
  positions: V3[];
  holes: FailedHole[];
  ms: number;
}
export type MeshSolidOutcome =
  | { ok: true; report: MeshSolidReport; body: unknown }
  | { ok: false; refusal: MeshSolidRefusal }
  | { ok: false; failed: string };

/** The refusal codes the panel has a title for (`m2s.code.<code>`); any other code gets the generic title. */
export const REFUSAL_CODES = ['meshNotWatertight', 'meshNonManifold', 'meshDegenerate', 'meshTooLarge', 'meshBadInput', 'meshHoleTooLarge', 'meshHoleSelfIntersects', 'meshGapAmbiguous'] as const;

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const n0 = (x: unknown): number => num(x) ?? 0;
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const v3 = (x: unknown): V3 | null => (Array.isArray(x) && x.length === 3 && x.every((c) => typeof c === 'number' && Number.isFinite(c)) ? [x[0], x[1], x[2]] : null);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

/** The kernel's `import` report as the panel shows it. */
export function readReport(imp: unknown, ms: number): MeshSolidReport {
  const r = obj(imp), ft = obj(r.faceTypes), an = obj(r.analytic), dev = obj(r.deviation), vol = obj(r.volume), cl = r.closing ? obj(r.closing) : null;
  const plane = n0(ft.plane), cylinder = n0(ft.cylinder), cone = n0(ft.cone), sphere = n0(ft.sphere);
  const faces = n0(r.faces);
  // kinds the panel has no row for (a torus, a spline, should a later kernel fit them), and faces the counts leave out
  const listed = Object.values(ft).reduce<number>((s, v) => s + n0(v), 0);
  const other = listed - (plane + cylinder + cone + sphere) + Math.max(0, faces - listed);
  const repairs = ['collapsed', 'duplicates', 'slivers', 'flipped', 'insideOut', 'voids'].map((key) => ({ key, n: n0(r[key]) })).filter((x) => x.n > 0);
  const faceted = Math.min(plane, n0(an.faceted));
  const dc = r.decimation ? obj(r.decimation) : null;
  return {
    triangles: n0(r.triangles), faces, diagonal: n0(r.diagonal),
    kinds: { planar: plane - faceted, faceted, cylinder, cone, sphere, other },
    analyticSkipped: an.applied === false && str(an.reason) ? str(an.reason) : null,
    budgetExhausted: an.budgetExhausted === true,
    declined: Array.isArray(an.declined) ? an.declined.map((d) => ({ reason: str(obj(d).reason), detail: str(obj(d).detail) })) : [],
    deviation: num(dev.max) !== null ? { max: num(dev.max)!, rms: n0(dev.rms) } : null,
    decimation: dc && num(dc.inputTriangles) !== null ? { inputTriangles: n0(dc.inputTriangles), triangles: n0(dc.triangles), tol: n0(dc.tol), deviation: n0(obj(dc.deviation).max), stoppedBy: str(dc.stoppedBy) } : null,
    volume: { mesh: num(vol.mesh), body: num(vol.body), relative: num(vol.relative) },
    repairs,
    closing: cl ? {
      openEdges: n0(cl.openEdges), mergedVertices: n0(cl.mergedVertices), stitched: n0(cl.stitched), filledHoles: n0(cl.filledHoles), filledTriangles: n0(cl.filledTriangles), filledArea: n0(cl.filledArea),
      holes: Array.isArray(cl.holes) ? cl.holes.map((h) => { const o = obj(h); return { edges: n0(o.edges), area: n0(o.area), planar: o.planar === true, method: str(o.method), at: v3(o.at) }; }) : [],
    } : null,
    ms,
  };
}

/** A refusal (`errors: [['import', {code, params}]]`) as the panel shows it. */
export function readRefusal(code: string, params: unknown, ms: number): MeshSolidRefusal {
  const p = obj(params);
  const positions = Array.isArray(p.positions) ? p.positions.map(v3).filter((x): x is V3 => !!x) : [];
  const holes = Array.isArray(p.holes) ? p.holes.map((h) => { const o = obj(h); return { reason: str(o.reason) || str(o.code), edges: num(o.edges), area: num(o.area), at: v3(o.at) }; }) : [];
  return { code, message: str(p.message), hint: str(p.hint), reason: str(p.reason) || null, positions, holes, ms };
}

/** The transport's answer (`{ok, trap?, error?, result}`) as an outcome. Never throws. */
export function readOutcome(res: { ok?: boolean; trap?: string; error?: unknown; result?: unknown } | null | undefined, ms: number): MeshSolidOutcome {
  if (!res) return { ok: false, failed: 'no answer from the kernel' };
  if (res.trap) return { ok: false, failed: String(res.trap) };
  if (!res.ok) { const e = res.error as { message?: string } | string | undefined; return { ok: false, failed: typeof e === 'string' ? e : e?.message ?? 'the kernel refused the request' }; }
  const r = obj(res.result);
  const errors = Array.isArray(r.errors) ? r.errors : [];
  if (errors.length) {
    const first = errors[0] as [unknown, unknown] | undefined;
    const e = obj(Array.isArray(first) ? first[1] : first);
    return { ok: false, refusal: readRefusal(str(e.code) || 'unknown', e.params, ms) };
  }
  if (!r.body) return { ok: false, failed: 'the kernel answered without a body' };
  return { ok: true, report: readReport(r.import, ms), body: r.body };
}

/** Anything with the kernel transport's `request` (the controller's, a Session's kernel, a test double). */
export interface MeshSolidKernel { request(msg: Record<string, unknown>): Promise<{ ok?: boolean; trap?: string; error?: unknown; result?: unknown }> }

/**
 * Convert `mesh` on the preview tag. The request cannot be interrupted once sent (the kernel worker runs it to the end); the caller
 * that wants a Cancel ignores the late answer (see useMeshSolid.ts). Never throws.
 */
export async function runMeshToSolid(k: MeshSolidKernel, mesh: MeshInput, o: MeshSolidOptions, at: { tag?: string; name: string }): Promise<MeshSolidOutcome> {
  const t0 = performance.now();
  try {
    const res = await k.request(meshSolidRequest(mesh, o, at));
    return readOutcome(res, Math.round(performance.now() - t0));
  } catch (e) { return { ok: false, failed: (e as Error).message }; }
}

/** Empty the preview tag (the kernel keeps a body per tag). */
export async function releasePreview(k: MeshSolidKernel, tag = MESH_SOLID_TAG): Promise<void> {
  await k.request({ type: 'regen', tag, part: { format: 'ck-part', version: 1, name: 'scratch', features: [], seq: 1, rollback: null }, opts: { noView: true } }).catch(() => null);
}

// ---- the viewport ----

/** The id of the preview in the viewport's surface list, and the prefix of its face and edge names (so they never meet the part's). */
export const PREVIEW_ID = 'mesh-solid-preview';
const PREFIX = 'm2s:';

/** The converted body as a tinted body drawn beside the part (the viewport's surface-body channel). Null when it has no mesh. */
export function previewSurface(body: unknown): ViewSurface | null {
  const b = obj(body) as { faces?: Array<{ id: string }>; mesh?: unknown; edges?: Array<{ key?: string; pts: number[][] }>; box?: { min: number[]; max: number[] } };
  const mesh = meshFromBody({ faces: (b.faces ?? []).map((f) => ({ id: PREFIX + f.id })), mesh: b.mesh as never });
  if (!mesh.positions.length) return null;
  const edges = (b.edges ?? []).filter((e) => Array.isArray(e.pts)).map((e) => ({ ...e, ...(e.key ? { key: PREFIX + e.key } : {}) }));
  return { id: PREVIEW_ID, mesh, edges, box: b.box ?? null };
}

/** A view body with the preview attached as one more surface body (the box covers it). A null body gets an empty one to carry it. */
export function withPreview<B extends { mesh: { triFace: ArrayLike<number> }; box: { min: number[]; max: number[] }; surfaces?: ViewSurface[] }>(body: B | null, s: ViewSurface | null): B | null {
  if (!s) return body;
  const sb = s.box ?? null;
  if (!body) {
    if (!sb) return null;
    return { mesh: { positions: new Float32Array(0), normals: new Float32Array(0), triFace: new Int32Array(0), faceIds: [] }, edges: [], box: sb, sketches: [], curves: [], planes: [], markers: [], surfaces: [s] } as unknown as B;
  }
  const empty = body.mesh.triFace.length === 0;
  const box = !sb ? body.box : empty && !body.surfaces?.length ? sb : { min: body.box.min.map((v, i) => Math.min(v, sb.min[i])), max: body.box.max.map((v, i) => Math.max(v, sb.max[i])) };
  return { ...body, surfaces: [...(body.surfaces ?? []).filter((x) => x.id !== PREVIEW_ID), s], box };
}

/** Line segments of a 3D cross of half size `k` at `p` (two points a segment), for the viewport's wire handles. */
export function crossLines(p: V3, k: number): V3[] {
  return [[p[0] - k, p[1], p[2]], [p[0] + k, p[1], p[2]], [p[0], p[1] - k, p[2]], [p[0], p[1] + k, p[2]], [p[0], p[1], p[2] - k], [p[0], p[1], p[2] + k]];
}

/** The places the panel can point at: a filled hole (`hole`), a failed hole (`failed`), a refusal position (`gap`). */
export interface MeshSolidMark { kind: 'hole' | 'failed' | 'gap'; at: V3 }
export function marksOf(o: MeshSolidOutcome | null): MeshSolidMark[] {
  if (!o) return [];
  if (o.ok) return (o.report.closing?.holes ?? []).flatMap((h) => (h.at ? [{ kind: 'hole' as const, at: h.at }] : []));
  if ('refusal' in o) {
    const failed = o.refusal.holes.flatMap((h) => (h.at ? [{ kind: 'failed' as const, at: h.at }] : []));
    return [...failed, ...o.refusal.positions.map((at) => ({ kind: 'gap' as const, at }))];
  }
  return [];
}

// ---- numbers ----

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in';
const PER_MM: Record<LengthUnit, number> = { mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4 };

const NBSP = '\u00a0';
/**
 * `digits` significant digits as plain decimals, never in exponent form, thousands grouped with a no-break space so a number never
 * wraps: 0.019, 1.5, 785, 12 346. Trailing zeros after the point are dropped.
 */
export function plainNum(v: number, digits = 3): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  const a = Math.abs(v);
  const dec = Math.min(12, Math.max(0, digits - 1 - Math.floor(Math.log10(a))));
  let s = a.toFixed(dec);
  if (dec > 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  const [int, frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const out = frac ? `${grouped}.${frac}` : grouped;
  return out === '0' ? '0' : (v < 0 ? '-' : '') + out;
}
/** A length (mm) in the display unit: '0.024 mm', '0.000945 in'. */
export const fmtLength = (mm: number, unit: LengthUnit = 'mm', digits = 3): string => `${plainNum(mm * PER_MM[unit], digits)}${NBSP}${unit}`;
/** A volume (mm³) in the display unit cubed. */
export const fmtVolume = (mm3: number, unit: LengthUnit = 'mm'): string => `${plainNum(mm3 * PER_MM[unit] ** 3)}${NBSP}${unit}³`;
/** An area (mm²) in the display unit squared. */
export const fmtArea = (mm2: number, unit: LengthUnit = 'mm'): string => `${plainNum(mm2 * PER_MM[unit] ** 2)}${NBSP}${unit}²`;
/** A relative change as a signed percent: '+0.65 %', '-0.040 %'; null when it rounds to nothing (the same volume). */
export function fmtPercent(rel: number): string | null {
  const p = rel * 100;
  if (!Number.isFinite(p) || Math.abs(p) < 0.005) return null;
  return `${p > 0 ? '+' : ''}${Math.abs(p) < 0.1 ? p.toFixed(3) : p.toFixed(2)}${NBSP}%`;
}
/**
 * The deviation of the solid from the mesh in the display unit (two significant digits), or null when there is none worth a number:
 * below 1e-6 mm, or below 1e-4 of the mesh's size (`diagonal`, mm) - rounding noise of an exact conversion.
 */
export function fmtDeviation(mm: number, unit: LengthUnit = 'mm', diagonal = 0): string | null {
  if (!Number.isFinite(mm) || mm < 1e-6 || (diagonal > 0 && mm < 1e-4 * diagonal)) return null;
  return fmtLength(mm, unit, 2);
}
/** Wall time: '180 ms', '2.4 s'. */
export const fmtMs = (ms: number): string => (ms < 1000 ? `${Math.round(ms)}${NBSP}ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}${NBSP}s`);
