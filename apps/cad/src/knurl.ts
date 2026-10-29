// The Knurl wizard's rules: which cylinder a picked face is (axis along x, y or z, radius, axial range), the parameter record with its defaults, the
// checks that need no kernel, and the ops. The ops come from the script's knurl() helper (packages/script/src/features/knurl.ts), so the wizard and the
// Script tab cut the same grooves. Nothing here touches the DOM or the kernel.
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { groupOps, wizardGroupName } from './wizardGroup';
import { cosmeticToOpts, knurlCosmeticRecord, knurlEditOps, type CosmeticKnurl, type KnurlOpts } from '@kit/script';
import type { EdgeLike } from './threadData';
import { cylinderOfFace } from './threadData';

export type KnurlAxis = 'x' | 'y' | 'z';
export const KNURL_PATTERNS = ['straight', 'diamond', 'pyramid'] as const;
export const KNURL_PROFILES = ['v', 'round'] as const;
export const KNURL_METHODS = ['faceted', 'boolean'] as const;

/** The cylinder being knurled, in world coordinates. `center` is the axis position across it: [x, y] for z, [x, z] for y, [y, z] for x. */
export interface KnurlTarget { axis: KnurlAxis; center: [number, number]; radius: number; from: number; to: number }
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
}
export const DEFAULT_KNURL: KnurlParams = { pattern: 'straight', profile: 'v', count: 36, depth: 0.5, helixAngle: 30, method: 'faceted', target: null, range: null, cosmetic: false };
/** Whether a pattern starts as cosmetic in the wizard: never, since the faceted build makes a real diamond or pyramid in seconds and a cosmetic knurl is missing from exports; the box stays one click away. */
export const cosmeticByDefault = (_pattern: KnurlParams['pattern']): boolean => false;

const round3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/**
 * The cylinder a face is, when its axis lies along a world axis (the knurl cuts across and along that axis); the axial range is the face's own extent.
 * `reason` says why not: 'notCylinder' or 'oblique' (the axis is tilted) or 'internal' (a hole wall: a knurl is cut on the outside).
 */
export function knurlTarget(face: string, edges: EdgeLike[]): { target: KnurlTarget } | { reason: 'notCylinder' | 'oblique' | 'internal' } {
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
  return { target: { axis, center: [round3(center[0]), round3(center[1])], radius: round3(cyl.radius), from: round3(lo), to: round3(hi) } };
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
  return {
    axis: t.axis, center: t.center, radius: t.radius, from, to,
    pattern: p.pattern, profile: p.profile, count: p.count, depth: p.depth,
    ...(p.pattern === 'diamond' ? { helixAngle: p.helixAngle } : {}),
    ...(p.cosmetic ? { mode: 'cosmetic' as const } : {}),
    ...(knurlHasMethod(p) ? { method: p.method } : {}),
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

/** The ops that append the knurl to the document, in one tree folder named after the wizard (see wizardGroup.ts): sketches, planes and cuts, numbered from the document's next feature id. Throws with the helper's message. */
export function knurlOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: KnurlParams): EditOp[] {
  const o = knurlOpts({ ...p, cosmetic: false });
  if (!o) throw new Error('Pick a cylindrical face to knurl');
  return groupOps(knurlEditOps(o, nextSeq(doc)) as unknown as EditOp[], wizardGroupName(doc.features, t('knurl.title')));
}

/** Grooves per ... for a start: about one groove every 1.5 mm of circumference, rounded to a multiple of 2 and kept in 8..120. */
export function suggestCount(radius: number): number {
  return Math.min(120, Math.max(8, 2 * Math.round((2 * Math.PI * radius) / 1.5 / 2)));
}
/** A depth that suits the groove spacing: a quarter of the pitch (a 90 degree V). */
export function suggestDepth(radius: number, count: number): number {
  return Math.round(((2 * Math.PI * radius) / count / 4) * 100) / 100;
}
