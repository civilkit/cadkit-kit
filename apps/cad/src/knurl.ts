// The Knurl wizard's rules: which cylinder a picked face is (axis along x, y or z, radius, axial range), the parameter record with its defaults, the
// checks that need no kernel, and the ops. The ops come from the script's knurl() helper (packages/script/src/features/knurl.ts), so the wizard and the
// Script tab cut the same grooves. Nothing here touches the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import { cosmeticToOpts, knurlCosmeticRecord, knurlEditOps, type CosmeticKnurl, type KnurlOpts } from '@kit/script';
import type { EdgeLike } from './threadData';
import { cylinderOfFace } from './threadData';
import { seatOnFace, type FaceMesh } from './bearing';

export type KnurlAxis = 'x' | 'y' | 'z';
export const KNURL_PATTERNS = ['straight', 'diamond', 'pyramid'] as const;
export const KNURL_PROFILES = ['v', 'round'] as const;
export const KNURL_METHODS = ['faceted', 'boolean'] as const;

/** An end of the cylinder that is a flat face across its axis: the face name and its position along the axis. The band is built from the nearer one, so it keeps its distance from it when the part is edited. */
export interface KnurlEnd { face: string; at: number }
/** The cylinder being knurled, in world coordinates. `center` is the axis position across it: [x, y] for z, [x, z] for y, [y, z] for x. `ends` are its flat end faces (none when an end is a chamfer, a fillet or a cone, or the faces were not known). */
export interface KnurlTarget { axis: KnurlAxis; center: [number, number]; radius: number; from: number; to: number; ends?: KnurlEnd[] }
/** What the user chose; the target comes from the picked face. */
export interface KnurlParams {
  pattern: (typeof KNURL_PATTERNS)[number];
  profile: (typeof KNURL_PROFILES)[number];
  count: number;
  depth: number;
  helixAngle: number;
  /** diamond and pyramid with V grooves: 'faceted' builds the surface as faces (seconds), 'boolean' cuts the groove sets against each other (slow when dense) */
  method: (typeof KNURL_METHODS)[number];
  /** the cylinder; null until a face is picked */
  target: KnurlTarget | null;
  /** axial range actually knurled, within the target; null: the whole face */
  range: [number, number] | null;
  /** cosmetic: draw the grooves only (a record in the document, the solid stays a plain cylinder); false cuts them */
  cosmetic: boolean;
  /** Not offered by the wizard; kept so that editing a knurl made by a script or an older version does not reset them. Absent: the helper's default. */
  angle?: number;
  ringPitch?: number;
  width?: number;
}
export const DEFAULT_KNURL: KnurlParams = { pattern: 'straight', profile: 'v', count: 36, depth: 0.5, helixAngle: 30, method: 'faceted', target: null, range: null, cosmetic: true };
/** Whether a pattern starts as cosmetic in the wizard: always. Cosmetic (instant) is the default for every pattern; unticking it makes the real cut, one click away. */
export const cosmeticByDefault = (_pattern: KnurlParams['pattern']): boolean => true;

const round3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/**
 * The cylinder a face is, when its axis lies along a world axis (the knurl cuts across and along that axis); the axial range is the face's own extent.
 * `reason` says why not: 'notCylinder' or 'oblique' (the axis is tilted) or 'internal' (a hole wall: a knurl is cut on the outside).
 */
export function knurlTarget(face: string, edges: EdgeLike[], mesh?: FaceMesh | null): { target: KnurlTarget } | { reason: 'notCylinder' | 'oblique' | 'internal' } {
  const cyl = cylinderOfFace(face, edges);
  if (!cyl) return { reason: 'notCylinder' };
  if (cyl.internal) return { reason: 'internal' };
  const d = cyl.axisDir;
  const k = [0, 1, 2].find((i) => Math.abs(Math.abs(d[i]) - 1) < 1e-3);
  if (k === undefined) return { reason: 'oblique' };
  // extent: the face's own boundary points projected on the axis
  let lo = Infinity, hi = -Infinity;
  for (const e of edges) {
    if (!e.pts || !e.faces?.includes(face)) continue;
    for (const p of e.pts) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); }
  }
  if (!(hi > lo)) return { reason: 'notCylinder' };
  const c = cyl.axisPoint;
  const axis: KnurlAxis = (['x', 'y', 'z'] as const)[k];
  const center: [number, number] = axis === 'z' ? [c[0], c[1]] : axis === 'y' ? [c[0], c[2]] : [c[1], c[2]];
  const ends = endFaces(face, edges, axis, k, [lo, hi], mesh ?? null);
  return { target: { axis, center: [round3(center[0]), round3(center[1])], radius: round3(cyl.radius), from: round3(lo), to: round3(hi), ...(ends.length ? { ends } : {}) } };
}

/** The flat faces across the axis at the two ends of the cylinder face: the face on the other side of the circular edge at that end, when it is flat, faces along the axis and lies there. */
function endFaces(face: string, edges: EdgeLike[], axis: KnurlAxis, k: number, at: number[], mesh: FaceMesh | null): KnurlEnd[] {
  if (!mesh) return [];
  const out: KnurlEnd[] = [];
  for (const end of at) {
    for (const e of edges) {
      if (!e.pts || !e.faces?.includes(face) || e.faces.length !== 2) continue;
      if (!e.pts.every((p) => Math.abs(p[k] - end) < 1e-4)) continue;   // an edge round the end, not a seam
      const other = e.faces.find((f) => f !== face);
      const flat = other ? seatOnFace(other, mesh) : null;
      if (!other || !flat || flat.axis[1] !== axis || Math.abs(flat.origin[k] - end) > 1e-3) continue;
      if (!out.some((x) => x.face === other)) out.push({ face: other, at: round3(end) });
      break;
    }
  }
  return out;
}

/**
 * The end face the band is built from, so that it keeps its distance from it when the part is edited: of the flat end faces, the one nearer to the band
 * (the one a longer or shorter shaft moves, when both are as near: the `.C1` end of an extrude). Null when the cylinder has none, or the knurl is
 * cosmetic or a faceted band, which are placed at the numbers (a knurlBand holds plain numbers).
 */
export function knurlAnchor(p: KnurlParams): KnurlEnd | null {
  const ends = p.target?.ends;
  if (!p.target || !ends?.length || p.cosmetic || (knurlHasMethod(p) && p.method === 'faceted')) return null;
  const [from, to] = p.range ?? [p.target.from, p.target.to];
  const gap = (e: KnurlEnd): number => (e.at > (from + to) / 2 ? e.at - to : from - e.at);
  const moves = (e: KnurlEnd): number => (/\.C1$/.test(e.face) ? 0 : 1);
  return [...ends].sort((a, b) => Math.abs(gap(a)) - Math.abs(gap(b)) || moves(a) - moves(b) || b.at - a.at)[0];
}

export type KnurlIssueCode = 'noTarget' | 'count' | 'depth' | 'range' | 'kernel';
export interface KnurlIssue { code: KnurlIssueCode; params: Record<string, string | number>; message: string }

/** Whether the method choice applies: only V diamond and pyramid can be built as faces. */
export function knurlHasMethod(p: Pick<KnurlParams, 'pattern' | 'profile'>): boolean {
  return p.pattern !== 'straight' && p.profile === 'v';
}

/** The options of the script helper for these parameters. */
export function knurlOpts(p: KnurlParams): KnurlOpts | null {
  if (!p.target) return null;
  const t = p.target;
  const [from, to] = p.range ?? [t.from, t.to];
  const anchor = knurlAnchor(p);
  return {
    axis: t.axis, center: t.center, radius: t.radius, from, to,
    pattern: p.pattern, profile: p.profile, count: p.count, depth: p.depth,
    ...(p.pattern === 'diamond' ? { helixAngle: p.helixAngle } : {}),
    ...(p.angle !== undefined ? { angle: p.angle } : {}),
    ...(p.width !== undefined ? { width: p.width } : {}),
    ...(p.pattern === 'pyramid' && p.ringPitch !== undefined ? { ringPitch: p.ringPitch } : {}),
    ...(p.cosmetic ? { mode: 'cosmetic' as const } : {}),
    ...(knurlHasMethod(p) ? { method: p.method } : {}),
    ...(anchor ? { onFace: { face: anchor.face, at: anchor.at } } : {}),
  };
}

/** The cosmetic record for these parameters (what the document keeps); throws with the helper's message. */
export function knurlCosmetic(p: KnurlParams): CosmeticKnurl {
  const o = knurlOpts(p);
  if (!o) throw new Error('Pick a cylindrical face to knurl');
  return knurlCosmeticRecord(o);
}

/** The records of a document's `cosmeticKnurls` field (malformed entries dropped). */
export { sanitizeCosmeticKnurls as readCosmeticKnurls } from '@kit/script';

/** The next free feature number of a document. */
function nextSeq(doc: { features: Array<{ id?: string }>; seq?: number }): number {
  let n = doc.seq ?? 1;
  for (const f of doc.features) { const m = /^F(\d+)$/.exec(String(f.id ?? '')); if (m) n = Math.max(n, Number(m[1]) + 1); }
  return n;
}

/** The ops that turn cosmetic records into real cuts, numbered from the document's next feature id. Throws with the helper's message (overlapping grooves, too many crossings). */
export function cosmeticToCutOps(doc: { features: Array<{ id?: string }>; seq?: number }, recs: readonly CosmeticKnurl[]): EditOp[] {
  let n = nextSeq(doc);
  const ops: EditOp[] = [];
  for (const r of recs) {
    const mine = knurlEditOps(cosmeticToOpts(r), n) as unknown as EditOp[];
    ops.push(...mine);
    n += mine.filter((o) => o.op === 'add').length;
  }
  return ops;
}

/** The first problem with the parameters, from the helper itself (overlapping grooves, too many crossings) after the simple checks; none when the ops can be made. */
export function knurlIssue(p: KnurlParams): KnurlIssue | null {
  const bad = (code: KnurlIssueCode, message: string, params: Record<string, string | number> = {}): KnurlIssue => ({ code, params, message });
  if (!p.target) return bad('noTarget', 'Pick a cylindrical face to knurl');
  if (!Number.isInteger(p.count) || p.count < 3) return bad('count', 'The number of grooves must be a whole number of 3 or more');
  if (!(p.depth > 0) || p.depth >= p.target.radius) return bad('depth', 'The depth must be more than 0 and less than the radius', { radius: p.target.radius });
  const [from, to] = p.range ?? [p.target.from, p.target.to];
  if (!(to > from)) return bad('range', 'The end of the knurled band must be beyond its start');
  try { if (p.cosmetic) knurlCosmetic(p); else knurlOps({ features: [] }, p); } catch (e) { return bad('kernel', (e as Error).message.replace(/^knurl\(\): /, '')); }
  return null;
}

/** The marker a cut knurl (straight, or diamond/pyramid cut as grooves) carries on its first feature, so the wizard can reopen it: the parameters and the ids
 *  of every feature the knurl made. It is a plain JSON field of the feature, which the kernel keeps unchanged (as the `gear` record of a gear). A faceted
 *  knurlBand needs none (it holds the parameters itself); a cosmetic knurl is a record in the document. */
export const KNURL_MARK = 'knurl';
/** `ids` are the numbers of the F<n> ids, not the id strings: the kernel treats an exact id string inside another feature as a reference to it (it would refuse to remove the members one by one). */
export interface KnurlMark { v: 1; ids: number[]; params: KnurlParams }

/** The parameters as stored in the marker: what the wizard edits, never the cosmetic flag. */
function markParams(p: KnurlParams): KnurlParams {
  return JSON.parse(JSON.stringify({ ...p, cosmetic: false })) as KnurlParams;
}

/** The ops that append the knurl to the document, in one tree folder named after the wizard (see wizardGroup.ts): sketches, planes and cuts, numbered from the
 *  document's next feature id. Throws with the helper's message. `group` keeps the folder of a knurl being replaced (default: a new, unique folder name).
 *  The first feature carries the marker (see KNURL_MARK) unless the knurl is a single faceted band. */
export function knurlOps(doc: { features: Array<{ id?: string; group?: unknown }>; seq?: number }, p: KnurlParams, group?: { keep: string | undefined }): EditOp[] {
  const o = knurlOpts({ ...p, cosmetic: false });
  if (!o) throw new Error('Pick a cylindrical face to knurl');
  const ops = knurlEditOps(o, nextSeq(doc)) as unknown as EditOp[];
  const adds = ops.filter((x): x is Extract<EditOp, { op: 'add' }> => x.op === 'add');
  if (adds.length && adds[0].feature.type !== 'knurlBand') {
    const mark: KnurlMark = { v: 1, ids: adds.map((a) => Number(String(a.feature.id).replace(/^F/, ''))), params: markParams(p) };
    adds[0].feature[KNURL_MARK] = mark;
  }
  return groupOps(ops, group ? group.keep : wizardGroupName(doc.features, t('knurl.title')));
}

/** Grooves per ... for a start: about one groove every 1.5 mm of circumference, rounded to a multiple of 2 and kept in 8..120. */
export function suggestCount(radius: number): number {
  return Math.min(120, Math.max(8, 2 * Math.round((2 * Math.PI * radius) / 1.5 / 2)));
}
/** A depth that suits the groove spacing: a quarter of the pitch (a 90 degree V). */
export function suggestDepth(radius: number, count: number): number {
  return Math.round(((2 * Math.PI * radius) / count / 4) * 100) / 100;
}
