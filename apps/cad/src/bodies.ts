// Bodies of the current result, their appearance and their visibility. A body is a lump: a connected set of faces (joined by shared
// edges), found by the selection model. Nothing here touches the kernel or the feature history.
//
// Document fields (viewer state, not features, not undo steps; saved with the part):
//   appearance: { [key]: { color?: '#rrggbb', opacity?: 0.05..1, finish?: 'matte'|'plastic'|'chrome'|'glass'|'brushed' } }
//   bodyNames:  { [key]: string }
//   view:       { hiddenBodies: string[] }       (body keys)
// KEY RULE. A key is either a BODY key or a FEATURE id.
//   body key    '@body:' + the lowest face name of the body (plain string order, e.g. '@body:F83.S1'). Face names carry the id of the
//               feature that made the face and survive regeneration, so the key survives editing, adding or removing any other feature.
//   feature id  'F83': applies to every body whose ORIGIN is that feature. A body's origin is the lowest-numbered feature that owns one
//               of its faces (the feature that created the lump; later cuts and fillets do not change it). Scripts key by feature
//               (the id is known while the script runs; the face names are not), and one entry covers a pattern's whole row of bodies.
// A body key wins over a feature id; a user edit always writes the body key.
import type { Body } from './select/model';
import { BODY_PREFIX } from './select/model';
import { clampBodyOpacity, FINISHES, isHex, type BodyLookSpec, type BodyViewSpec, type Finish } from '@kit/viewport';

export type { BodyLookSpec, Finish };
export const FEATURE_KEY = /^F\d+$/;

export interface BodyRow {
  key: string;
  name: string;
  /** the default name was used (no user or script name) */
  named: boolean;
  faces: string[];
  edges: string[];
  /** lowest-numbered feature owning one of the faces */
  origin: string | null;
  /** mm3 from the display mesh (signed tetrahedra); null when the body is not a closed shell (a sheet) */
  volume: number | null;
  /** the look in effect (body entry over feature entry), {} when none */
  look: BodyLookSpec;
  hidden: boolean;
}

export interface BodyFields {
  appearance?: Record<string, BodyLookSpec>;
  /** colour / finish of single faces: a persistent face name ('F3.C1') or a prefix ('F3.*') */
  faceAppearance?: Record<string, BodyLookSpec>;
  bodyNames?: Record<string, string>;
  view?: { hiddenBodies?: string[] };
}

const num = (id: string): number => Number(id.slice(1));
export const faceOwner = (name: string): string | null => { const m = /^(F\d+)(?:[.:|#]|$)/.exec(name); return m ? m[1] : null; };

/** The feature that created a body: the lowest feature number among its faces' owners. */
export function originOf(faces: readonly string[]): string | null {
  let best: string | null = null;
  for (const f of faces) { const o = faceOwner(f); if (o && (best === null || num(o) < num(best))) best = o; }
  return best;
}

export const keyOf = (faces: readonly string[]): string => BODY_PREFIX + [...faces].sort()[0];

/** Keep only what a look may hold: a hex colour, an opacity in 0.05..1, a known finish. */
export function cleanLook(raw: unknown): BodyLookSpec {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: BodyLookSpec = {};
  const c = r.color ?? r.colour;
  if (isHex(c)) out.color = c.toLowerCase();
  if (typeof r.opacity === 'number' && isFinite(r.opacity)) out.opacity = clampBodyOpacity(r.opacity);
  if ((FINISHES as readonly unknown[]).includes(r.finish)) out.finish = r.finish as Finish;
  return out;
}

/** The look of a body: its feature's entry, then its own entry over it (field by field). */
export function lookFor(fields: BodyFields, key: string, origin: string | null): BodyLookSpec {
  const a = fields.appearance ?? {};
  return { ...(origin ? cleanLook(a[origin]) : {}), ...cleanLook(a[key]) };
}

/** Signed volume of the triangles of the given faces (a closed shell gives its volume). */
export function faceVolumes(mesh: { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] } | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!mesh) return out;
  const P = mesh.positions;
  for (let t = 0; t < mesh.triFace.length; t++) {
    const o = t * 9;
    const v = (P[o] * (P[o + 4] * P[o + 8] - P[o + 5] * P[o + 7]) - P[o + 1] * (P[o + 3] * P[o + 8] - P[o + 5] * P[o + 6]) + P[o + 2] * (P[o + 3] * P[o + 7] - P[o + 4] * P[o + 6])) / 6;
    const f = mesh.faceIds[mesh.triFace[t]];
    out.set(f, (out.get(f) ?? 0) + v);
  }
  return out;
}

/** The rows of the Bodies list: ordered by creating feature, then key. */
export function listBodies(
  bodies: readonly Body[],
  fields: BodyFields,
  opts: { featureName?(id: string): string | null; volumes?: Map<string, number>; defaultName?(n: number): string } = {},
): BodyRow[] {
  const hidden = new Set(fields.view?.hiddenBodies ?? []);
  const base = bodies.map((b) => ({ b, key: keyOf(b.faces), origin: originOf(b.faces) }));
  base.sort((x, y) => (x.origin ? num(x.origin) : Infinity) - (y.origin ? num(y.origin) : Infinity) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const perOrigin = new Map<string, number>();
  for (const x of base) if (x.origin) perOrigin.set(x.origin, (perOrigin.get(x.origin) ?? 0) + 1);
  const seen = new Map<string, number>();
  const dflt = opts.defaultName ?? ((n: number) => `Body ${n}`);
  return base.map((x, i) => {
    const names = fields.bodyNames ?? {};
    const own = names[x.key]?.trim();
    const feat = x.origin ? names[x.origin]?.trim() || opts.featureName?.(x.origin)?.trim() || '' : '';
    let name: string, named = true;
    if (own) name = own;
    else if (feat) { const k = (seen.get(x.origin!) ?? 0) + 1; seen.set(x.origin!, k); name = (perOrigin.get(x.origin!) ?? 1) > 1 ? `${feat} ${k}` : feat; }
    else { name = dflt(i + 1); named = false; }
    let volume: number | null = null;
    if (opts.volumes) { let v = 0, any = false; for (const f of x.b.faces) { const fv = opts.volumes.get(f); if (fv !== undefined) { v += fv; any = true; } } volume = any && !x.b.surface ? Math.abs(v) : null; }
    return { key: x.key, name, named, faces: x.b.faces, edges: x.b.edges, origin: x.origin, volume, look: lookFor(fields, x.key, x.origin), hidden: hidden.has(x.key) };
  });
}

/** faceAppearance entries (exact names and 'F3.*' prefixes) resolved to the faces that exist; a longer (more specific) entry wins. */
export function resolveFaceLooks(entries: Record<string, BodyLookSpec> | undefined, faceNames: readonly string[]): Record<string, BodyLookSpec> {
  const out: Record<string, BodyLookSpec> = {};
  if (!entries) return out;
  const keys = Object.keys(entries).sort((a, b) => a.length - b.length);
  for (const k of keys) {
    const l = cleanLook(entries[k]);
    if (l.color === undefined && l.finish === undefined) continue;
    const pre = k.endsWith('*') ? k.slice(0, -1) : null;
    for (const f of faceNames) if (pre !== null ? f.startsWith(pre) : f === k) out[f] = { ...out[f], color: l.color ?? out[f]?.color, finish: l.finish ?? out[f]?.finish };
  }
  for (const f of Object.keys(out)) { const o = out[f]; if (o.color === undefined) delete o.color; if (o.finish === undefined) delete o.finish; }
  return out;
}

/** What the viewport is given. */
export function viewSpec(rows: readonly BodyRow[], faces?: Record<string, BodyLookSpec>): BodyViewSpec {
  const looks: Record<string, BodyLookSpec> = {};
  for (const r of rows) if (r.look.color !== undefined || r.look.opacity !== undefined || r.look.finish !== undefined) looks[r.key] = r.look;
  return { bodies: rows.map((r) => ({ key: r.key, faces: r.faces, edges: r.edges })), looks, hidden: rows.filter((r) => r.hidden).map((r) => r.key), ...(faces && Object.keys(faces).length ? { faces } : {}) };
}

// ---- edits: each returns the new value of one document field (undefined = remove the field) ----
const uniq = (xs: string[]): string[] => [...new Set(xs)];
export function toggleHidden(fields: BodyFields, key: string): string[] {
  const h = fields.view?.hiddenBodies ?? [];
  return h.includes(key) ? h.filter((k) => k !== key) : [...h, key];
}
export const setHidden = (fields: BodyFields, key: string, hide: boolean): string[] => {
  const h = fields.view?.hiddenBodies ?? [];
  return hide ? uniq([...h, key]) : h.filter((k) => k !== key);
};
/** Hide every body but `key` (solo); soloing the only visible body shows all again. */
export function solo(rows: readonly BodyRow[], key: string): string[] {
  const visible = rows.filter((r) => !r.hidden);
  if (visible.length === 1 && visible[0].key === key) return [];
  return rows.filter((r) => r.key !== key).map((r) => r.key);
}
export const hideOthers = (rows: readonly BodyRow[], keys: readonly string[]): string[] => rows.filter((r) => !keys.includes(r.key)).map((r) => r.key);
export const showAll = (): string[] => [];
/** The appearance map with `patch` merged into the BODY entry of `key` (fields set to undefined are removed; an empty entry is dropped). */
export function withLook(fields: BodyFields, row: Pick<BodyRow, 'key' | 'look'>, patch: Partial<Record<keyof BodyLookSpec, BodyLookSpec[keyof BodyLookSpec] | undefined>>): Record<string, BodyLookSpec> {
  const next = { ...(fields.appearance ?? {}) };
  const entry = cleanLook({ ...row.look, ...next[row.key], ...patch });
  for (const k of Object.keys(patch) as Array<keyof BodyLookSpec>) if (patch[k] === undefined) delete entry[k];
  if (Object.keys(entry).length) next[row.key] = entry; else delete next[row.key];
  return next;
}
export function withName(fields: BodyFields, key: string, name: string): Record<string, string> {
  const next = { ...(fields.bodyNames ?? {}) };
  const n = name.trim();
  if (n) next[key] = n; else delete next[key];
  return next;
}
/** Which row a selection name (a face, an edge or a body name) points into. */
export function rowOfName(rows: readonly BodyRow[], name: string): BodyRow | undefined {
  return rows.find((r) => r.key === name || r.faces.includes(name) || r.edges.includes(name));
}

// ---- finishes and swatches ----
export const FINISH_LABEL_KEY: Record<Finish, string> = {
  matte: 'bodies.finish.matte', plastic: 'bodies.finish.plastic', chrome: 'bodies.finish.chrome', glass: 'bodies.finish.glass', brushed: 'bodies.finish.brushed',
};
/** What an opacity slider shows for a look and what the Glass preset sets. */
export const GLASS_PRESET: BodyLookSpec = { color: '#b9c7d6', opacity: 0.18, finish: 'glass' };
export const SWATCH_DEFAULT = '#c3ccd8';

/** The body fields of a document (anything malformed is dropped). */
export function readBodyFields(doc: unknown): BodyFields {
  const d = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>;
  const out: BodyFields = {};
  if (d.appearance && typeof d.appearance === 'object') {
    const a: Record<string, BodyLookSpec> = {};
    for (const [k, v] of Object.entries(d.appearance as Record<string, unknown>)) { const l = cleanLook(v); if (Object.keys(l).length) a[k] = l; }
    if (Object.keys(a).length) out.appearance = a;
  }
  if (d.faceAppearance && typeof d.faceAppearance === 'object') {
    const a: Record<string, BodyLookSpec> = {};
    for (const [k, v] of Object.entries(d.faceAppearance as Record<string, unknown>)) { const l = cleanLook(v); delete l.opacity; if (Object.keys(l).length) a[k] = l; }
    if (Object.keys(a).length) out.faceAppearance = a;
  }
  if (d.bodyNames && typeof d.bodyNames === 'object') {
    const n: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.bodyNames as Record<string, unknown>)) if (typeof v === 'string' && v.trim()) n[k] = v.trim();
    if (Object.keys(n).length) out.bodyNames = n;
  }
  const hb = (d.view as { hiddenBodies?: unknown } | undefined)?.hiddenBodies;
  if (Array.isArray(hb)) out.view = { hiddenBodies: hb.filter((x): x is string => typeof x === 'string') };
  return out;
}
