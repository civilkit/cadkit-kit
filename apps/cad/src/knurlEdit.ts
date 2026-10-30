// Editing a knurl that already exists: which features (or cosmetic record) are a knurl the Knurl wizard can reopen, what parameters they map back to, which later
// features would break if the knurl were replaced, and the ops that replace it in place. Three storage forms (see knurl.ts):
//   faceted band     one `knurlBand` feature holding every number;
//   cut knurl        sketches and cuts with the marker KNURL_MARK on the first (parameters and ids of the group);
//   cosmetic         a record in the document field `cosmeticKnurls`.
// Knurls without any of these (made before the marker existed) are not guessed: they stay on the generic feature editor. No DOM, no kernel.
import type { EditOp } from '@ck/session';
import type { CosmeticKnurl } from '@kit/script';
import { DEFAULT_KNURL, KNURL_MARK, KNURL_METHODS, KNURL_PATTERNS, KNURL_PROFILES, knurlOps, type KnurlMark, type KnurlParams, type KnurlTarget } from './knurl';

type Feat = Record<string, unknown>;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const AXES = ['x', 'y', 'z'];
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** What a knurl the wizard can reopen is: which features make it (ids in document order), and its parameters. */
export interface KnurlOwner { kind: 'band' | 'group'; ids: string[]; params: KnurlParams }

function targetOf(r: Feat): KnurlTarget | null {
  const c = r.center;
  if (!AXES.includes(String(r.axis)) || !Array.isArray(c) || !fin(c[0]) || !fin(c[1])) return null;
  if (!fin(r.radius) || !(r.radius > 0) || !fin(r.from) || !fin(r.to) || !(r.to > r.from)) return null;
  const ends = Array.isArray(r.ends) ? (r.ends as Feat[]).filter((e) => e && typeof e.face === 'string' && e.face && fin(e.at)).map((e) => ({ face: e.face as string, at: e.at as number })) : [];
  return { axis: r.axis as KnurlTarget['axis'], center: [c[0], c[1]], radius: r.radius, from: r.from, to: r.to, ...(ends.length ? { ends } : {}) };
}

/** Optional values the wizard does not offer, kept only when they differ from the helper's defaults. */
function extras(o: { angle?: unknown; width?: unknown; ringPitch?: unknown }, p: { pattern: string; profile: string; count: number; depth: number; radius: number }): Partial<KnurlParams> {
  const out: Partial<KnurlParams> = {};
  if (fin(o.angle) && o.angle > 0 && o.angle < 180 && !near(o.angle, 90)) out.angle = o.angle;
  if (p.profile === 'round' && fin(o.width) && o.width > 0 && !near(o.width, 2 * p.depth)) out.width = o.width;
  if (p.pattern === 'pyramid' && fin(o.ringPitch) && o.ringPitch > 0 && !near(o.ringPitch, (2 * Math.PI * p.radius) / p.count)) out.ringPitch = o.ringPitch;
  return out;
}

/** The parameters of a faceted `knurlBand` feature, or null when it is not one the wizard can describe. */
export function paramsFromBand(f: Feat | null | undefined): KnurlParams | null {
  if (!f || f.type !== 'knurlBand') return null;
  const target = targetOf(f);
  if (!target || (f.pattern !== 'diamond' && f.pattern !== 'pyramid')) return null;
  const count = fin(f.count) ? Math.round(f.count) : fin(f.pitch) && f.pitch > 0 ? Math.round((2 * Math.PI * target.radius) / f.pitch) : NaN;
  if (!(count >= 3) || !fin(f.depth) || !(f.depth > 0)) return null;
  const helix = fin(f.helixAngle) && f.helixAngle > 0 && f.helixAngle < 80 ? f.helixAngle : DEFAULT_KNURL.helixAngle;
  return { ...DEFAULT_KNURL, pattern: f.pattern, profile: 'v', method: 'faceted', count, depth: f.depth, helixAngle: helix, target, range: null, cosmetic: false, ...extras(f, { pattern: f.pattern, profile: 'v', count, depth: f.depth, radius: target.radius }) };
}

/** The parameters of a cosmetic record (the form the wizard shows it in: cosmetic stays on). */
export function paramsFromCosmetic(r: CosmeticKnurl): KnurlParams {
  const { axis, center, radius, from, to } = r;
  return { ...DEFAULT_KNURL, pattern: r.pattern, profile: r.profile, count: r.count, depth: r.depth, helixAngle: r.helixAngle, target: { axis, center: [center[0], center[1]], radius, from, to }, range: null, cosmetic: true, ...extras(r, r) };
}

/** The marker of a feature, validated; null when absent or damaged. */
function readMark(f: Feat): KnurlMark | null {
  const m = f[KNURL_MARK] as Partial<KnurlMark> | undefined;
  if (!m || typeof m !== 'object' || m.v !== 1 || !Array.isArray(m.ids) || !m.ids.length || !m.ids.every((x) => Number.isInteger(x))) return null;
  const r = m.params as unknown as Feat | undefined;
  if (!r || typeof r !== 'object') return null;
  const target = r.target && typeof r.target === 'object' ? targetOf(r.target as Feat) : null;
  if (!target || !KNURL_PATTERNS.includes(r.pattern as never) || !KNURL_PROFILES.includes(r.profile as never) || !KNURL_METHODS.includes(r.method as never)) return null;
  if (!fin(r.count) || !fin(r.depth) || !fin(r.helixAngle)) return null;
  const range = Array.isArray(r.range) && fin(r.range[0]) && fin(r.range[1]) ? ([r.range[0], r.range[1]] as [number, number]) : null;
  const params: KnurlParams = {
    pattern: r.pattern as KnurlParams['pattern'], profile: r.profile as KnurlParams['profile'], method: r.method as KnurlParams['method'],
    count: r.count, depth: r.depth, helixAngle: r.helixAngle, target, range, cosmetic: false,
    ...(fin(r.angle) ? { angle: r.angle } : {}), ...(fin(r.width) ? { width: r.width } : {}), ...(fin(r.ringPitch) ? { ringPitch: r.ringPitch } : {}),
  };
  return { v: 1, ids: m.ids, params };
}

/** The knurl a feature id belongs to, when the wizard can reopen it: a faceted band by its own id, a marked group by any of its ids (all of them must
 *  still exist). Null for everything else, including a knurl that carries no marker. */
export function knurlOwner(features: ReadonlyArray<Feat>, id: string): KnurlOwner | null {
  const at = features.find((f) => f.id === id);
  if (at?.type === 'knurlBand') { const p = paramsFromBand(at); return p ? { kind: 'band', ids: [id], params: p } : null; }
  for (const f of features) {
    const m = f[KNURL_MARK] ? readMark(f) : null;
    const group = m?.ids.map((n) => `F${n}`);
    if (!m || !group?.includes(id)) continue;
    const have = new Set(features.map((x) => String(x.id)));
    if (!group.every((x) => have.has(x))) return null;
    return { kind: 'group', ids: [...group].sort((a, b) => features.findIndex((x) => x.id === a) - features.findIndex((x) => x.id === b)), params: m.params };
  }
  return null;
}

/** Ids of the features outside the knurl that name one of its features or a face of one (`F4.S.c1`): replacing the knurl would break them. */
export function knurlDependents(features: ReadonlyArray<Feat>, ids: readonly string[]): string[] {
  const mine = new Set(ids);
  const ref = /"(F\d+)(?:\.[^"]*)?"/g;
  const out: string[] = [];
  for (const f of features) {
    if (mine.has(String(f.id))) continue;
    for (const m of JSON.stringify(f).matchAll(ref)) if (mine.has(m[1])) { out.push(String(f.id)); break; }
  }
  return out;
}

/** The ops that replace a knurl by new parameters at the same place in the feature order: the old features are removed (last first), the new ones added at
 *  the old first position. One batch, so one undo step. Throws with the helper's message when the parameters cannot work. */
export function knurlReplaceOps(doc: { features: Array<{ id?: string }>; seq?: number }, p: KnurlParams, owner: KnurlOwner): EditOp[] {
  const order = doc.features.map((f) => String(f.id));
  const gone = owner.ids.filter((id) => order.includes(id)).sort((a, b) => order.indexOf(b) - order.indexOf(a));
  const at = Math.min(...gone.map((id) => order.indexOf(id)));
  // the new features sit in the folder the old ones were in (a knurl from before folders stays outside one)
  const folder = (doc.features as Array<{ id?: string; group?: unknown }>).find((f) => f.id === owner.ids[0])?.group;
  const adds = knurlOps(doc as never, p, { keep: typeof folder === 'string' && folder !== '' ? folder : undefined });
  return [
    ...gone.map((id) => ({ op: 'remove', id, cascade: true }) as EditOp),
    ...adds.map((o, i) => (o.op === 'add' ? { ...o, index: at + i } : o)),
  ];
}

/** The cosmetic records with the one at `index` replaced; null when there is none there. */
export function replaceCosmetic(recs: readonly CosmeticKnurl[], index: number, rec: CosmeticKnurl): CosmeticKnurl[] | null {
  if (!Number.isInteger(index) || index < 0 || index >= recs.length) return null;
  return recs.map((r, i) => (i === index ? rec : r));
}
