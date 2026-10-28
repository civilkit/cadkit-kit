// Bodies of the current result, their appearance and their visibility. A body is a lump: a connected set of faces (joined by shared
// edges), found by the selection model. Nothing here touches the kernel or the feature history.
//
// Document fields (viewer state, not features, not undo steps; saved with the part):
//   appearance: { [key]: { color?: '#rrggbb', opacity?: 0.05..1, finish?: 'matte'|'plastic'|'chrome'|'glass'|'brushed', metallic?: 0..1, roughness?: 0..1 } }
//   bodyNames:  { [key]: string }
//   view:       { hiddenBodies: string[] }       (body keys, or feature ids: every body made by that feature)
// KEY RULE. A key is either a BODY key or a FEATURE id.
//   body key    '@body:' + the lowest face name of the body (plain string order, e.g. '@body:F83.S1'). Face names carry the id of the
//               feature that made the face and survive regeneration, so the key survives editing, adding or removing any other feature.
//   feature id  'F83': applies to every body whose ORIGIN is that feature. In an assembly a body of a component has the origin 'F2@F6': feature F2 of
//               the part inserted by F6 (the face names say so: 'F2.S.e12@F6.1'). A body's origin is the lowest-numbered feature that owns one
//               of its faces (the feature that created the lump; later cuts and fillets do not change it). Scripts key by feature
//               (the id is known while the script runs; the face names are not), and one entry covers a pattern's whole row of bodies.
// A body key wins over a feature id; a user edit always writes the body key.
import type { Body } from './select/model';
import { BODY_PREFIX } from './select/model';
import { clampBodyOpacity, clampUnit, FINISHES, isHex, type BodyLookSpec, type BodyViewSpec, type Finish } from '@kit/viewport';

export type { BodyLookSpec, Finish };
export const FEATURE_KEY = /^F\d+$/;

export interface BodyRow {
  key: string;
  name: string;
  /** the default name was used (no user or script name) */
  named: boolean;
  /** the name the document gives this body (`body` of the feature that made it), when the kernel's lump could be matched to the row */
  docName?: string;
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

const num = (id: string): number => parseInt(id.slice(1), 10);
export const faceOwner = (name: string): string | null => { const m = /^(F\d+)(?:[.:|#]|$)/.exec(name); return m ? m[1] : null; };
/** The origin a face gives its body: its feature ('F3'), or for a face of a component the feature of the inserted part and the insert ('F3@F6'). */
export const faceOrigin = (name: string): string | null => {
  const m = /^(F\d+)[^@]*@(F\d+)/.exec(name);
  return m ? `${m[1]}@${m[2]}` : faceOwner(name);
};
/** Where an origin sorts: roots by feature number; a component's features just after the insert that made them. */
const order = (origin: string): number => { const [a, b] = origin.split('@'); return b ? num(b) + num(a) / 1e7 : num(a); };

/** The feature that created a body: the lowest feature number among its faces' owners. */
export function originOf(faces: readonly string[]): string | null {
  let best: string | null = null;
  for (const f of faces) { const o = faceOrigin(f); if (o && (best === null || order(o) < order(best))) best = o; }
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
  const m = clampUnit(r.metallic), g = clampUnit(r.roughness);
  if (m !== undefined) out.metallic = m;
  if (g !== undefined) out.roughness = g;
  return out;
}

/** The look of a body: its feature's entry, then its own entry over it (field by field). */
export function lookFor(fields: BodyFields, key: string, origin: string | null): BodyLookSpec {
  const a = fields.appearance ?? {};
  return { ...(origin ? cleanLook(a[origin]) : {}), ...cleanLook(a[key]) };
}

/** Signed volume and volume-weighted centre moment (sum of volume x centroid) of the triangles of each face. A closed shell's total volume is its volume and
 *  moment / volume its centre of mass. */
export function faceMoments(mesh: { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] } | null | undefined): Map<string, { v: number; m: [number, number, number] }> {
  const out = new Map<string, { v: number; m: [number, number, number] }>();
  if (!mesh) return out;
  const P = mesh.positions;
  for (let t = 0; t < mesh.triFace.length; t++) {
    const o = t * 9;
    const v = (P[o] * (P[o + 4] * P[o + 8] - P[o + 5] * P[o + 7]) - P[o + 1] * (P[o + 3] * P[o + 8] - P[o + 5] * P[o + 6]) + P[o + 2] * (P[o + 3] * P[o + 7] - P[o + 4] * P[o + 6])) / 6;
    const f = mesh.faceIds[mesh.triFace[t]];
    let e = out.get(f);
    if (!e) { e = { v: 0, m: [0, 0, 0] }; out.set(f, e); }
    e.v += v;
    for (let k = 0; k < 3; k++) e.m[k] += v * (P[o + k] + P[o + 3 + k] + P[o + 6 + k]) / 4;   // the tetrahedron with the origin has its centroid at a quarter of the corner sum
  }
  return out;
}

/** Signed volume of the triangles of the given faces (a closed shell gives its volume). */
export function faceVolumes(mesh: { positions: ArrayLike<number>; triFace: ArrayLike<number>; faceIds: string[] } | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const [f, e] of faceMoments(mesh)) out.set(f, e.v);
  return out;
}

/** What the kernel says about one lump (`massProps` with `bodies: true`): the name its document gave it, if any, and its volume and centre of mass. */
export interface LumpInfo { name?: string; volume: number; com: readonly number[] }
export interface BodyShape { key: string; volume: number | null; com: readonly number[] | null }

/** The document names of the lumps, matched to the rows of the list: the kernel does not say which face belongs to which lump, but a lump and a
 *  body of the list are the same thing when their volumes (the list's come from the display mesh, so a fraction of a percent off) and centres agree.
 *  Closest pairs first, so two copies of one body (the same volume) are told apart by where they are. A row that matches nothing gets no name. */
export function matchLumps(rows: readonly BodyShape[], lumps: readonly LumpInfo[]): Map<string, string> {
  const pairs: Array<{ i: number; j: number; cost: number }> = [];
  rows.forEach((r, i) => {
    if (r.volume === null || r.com === null || !(r.volume > 0)) return;
    lumps.forEach((l, j) => {
      if (!l.name || !(l.volume > 0)) return;
      const dv = Math.abs(l.volume - r.volume!) / l.volume;
      const dc = Math.hypot(l.com[0] - r.com![0], l.com[1] - r.com![1], l.com[2] - r.com![2]);
      if (dv > 0.03 || dc > 0.5 + 0.03 * Math.cbrt(l.volume)) return;
      pairs.push({ i, j, cost: dv + dc / (1 + Math.cbrt(l.volume)) });
    });
  });
  pairs.sort((a, b) => a.cost - b.cost);
  const out = new Map<string, string>(), usedRow = new Set<number>(), usedLump = new Set<number>();
  for (const p of pairs) {
    if (usedRow.has(p.i) || usedLump.has(p.j)) continue;
    usedRow.add(p.i); usedLump.add(p.j);
    out.set(rows[p.i].key, lumps[p.j].name!);
  }
  return out;
}

/** The volume and centre of mass of each body from the display mesh (null for a sheet, which has no volume). */
export function bodyShapes(bodies: readonly Body[], moments: Map<string, { v: number; m: [number, number, number] }>): BodyShape[] {
  return bodies.map((b) => {
    let v = 0; const m: [number, number, number] = [0, 0, 0];
    for (const f of b.faces) { const e = moments.get(f); if (e) { v += e.v; m[0] += e.m[0]; m[1] += e.m[1]; m[2] += e.m[2]; } }
    const ok = !b.surface && Math.abs(v) > 1e-12;
    return { key: keyOf(b.faces), volume: ok ? Math.abs(v) : null, com: ok ? [m[0] / v, m[1] / v, m[2] / v] : null };
  });
}

/** The rows of the Bodies list: ordered by creating feature, then key. */
export function listBodies(
  bodies: readonly Body[],
  fields: BodyFields,
  opts: { featureName?(id: string): string | null; volumes?: Map<string, number>; defaultName?(n: number): string; docNames?: Map<string, string> } = {},
): BodyRow[] {
  const hidden = new Set(fields.view?.hiddenBodies ?? []);
  const base = bodies.map((b) => ({ b, key: keyOf(b.faces), origin: originOf(b.faces) }));
  base.sort((x, y) => (x.origin ? order(x.origin) : Infinity) - (y.origin ? order(y.origin) : Infinity) || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  const perOrigin = new Map<string, number>();
  /** bodies are told apart by the feature that made them, those of a component by the insert (the component's name) */
  const group = (o: string): string => o.split('@')[1] ?? o;
  for (const x of base) if (x.origin) perOrigin.set(group(x.origin), (perOrigin.get(group(x.origin)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const dflt = opts.defaultName ?? ((n: number) => `Body ${n}`);
  return base.map((x, i) => {
    const names = fields.bodyNames ?? {};
    const own = names[x.key]?.trim();
    const docName = opts.docNames?.get(x.key);
    const feat = x.origin ? names[x.origin]?.trim() || opts.featureName?.(group(x.origin))?.trim() || '' : '';
    let name: string, named = true;
    if (own) name = own;
    else if (docName) name = docName;
    else if (feat) { const g = group(x.origin!), k = (seen.get(g) ?? 0) + 1; seen.set(g, k); name = (perOrigin.get(g) ?? 1) > 1 ? `${feat} ${k}` : feat; }
    else { name = dflt(i + 1); named = false; }
    let volume: number | null = null;
    if (opts.volumes) { let v = 0, any = false; for (const f of x.b.faces) { const fv = opts.volumes.get(f); if (fv !== undefined) { v += fv; any = true; } } volume = any && !x.b.surface ? Math.abs(v) : null; }
    return { key: x.key, name, named, ...(docName ? { docName } : {}), faces: x.b.faces, edges: x.b.edges, origin: x.origin, volume, look: lookFor(fields, x.key, x.origin), hidden: hidden.has(x.key) || (!!x.origin && hidden.has(x.origin)) };
  });
}

/** faceAppearance entries (exact names and 'F3.*' prefixes) resolved to the faces that exist; a longer (more specific) entry wins. */
export function resolveFaceLooks(entries: Record<string, BodyLookSpec> | undefined, faceNames: readonly string[]): Record<string, BodyLookSpec> {
  const out: Record<string, BodyLookSpec> = {};
  if (!entries) return out;
  const keys = Object.keys(entries).sort((a, b) => a.length - b.length);
  for (const k of keys) {
    const l = cleanLook(entries[k]);
    if (l.color === undefined && l.finish === undefined && l.metallic === undefined && l.roughness === undefined) continue;
    const pre = k.endsWith('*') ? k.slice(0, -1) : null;
    for (const f of faceNames) if (pre !== null ? f.startsWith(pre) : f === k) out[f] = { ...out[f], color: l.color ?? out[f]?.color, finish: l.finish ?? out[f]?.finish, metallic: l.metallic ?? out[f]?.metallic, roughness: l.roughness ?? out[f]?.roughness };
  }
  for (const f of Object.keys(out)) { const o = out[f]; if (o.color === undefined) delete o.color; if (o.finish === undefined) delete o.finish; if (o.metallic === undefined) delete o.metallic; if (o.roughness === undefined) delete o.roughness; }
  return out;
}

/** The mesh without the triangles of hidden bodies (what "export only visible bodies" writes). The same mesh when no body is hidden
 *  or the mesh does not say which face a triangle belongs to; null when nothing visible is left. */
export function visibleMesh(mesh: { positions: ArrayLike<number>; triFace?: ArrayLike<number>; faceIds?: string[] } | null, rows: readonly Pick<BodyRow, 'hidden' | 'faces'>[]): { positions: ArrayLike<number> } | null {
  if (!mesh) return null;
  const gone = new Set<string>();
  for (const r of rows) if (r.hidden) for (const f of r.faces) gone.add(f);
  const { triFace, faceIds } = mesh;
  if (!gone.size || !triFace || !faceIds) return mesh;
  const out: number[] = [];
  for (let t = 0; t < triFace.length; t++) {
    if (gone.has(faceIds[triFace[t]])) continue;
    for (let i = t * 9; i < t * 9 + 9; i++) out.push(mesh.positions[i]);
  }
  return out.length ? { positions: new Float32Array(out) } : null;
}

/** What the viewport is given. */
export function viewSpec(rows: readonly BodyRow[], faces?: Record<string, BodyLookSpec>): BodyViewSpec {
  const looks: Record<string, BodyLookSpec> = {};
  for (const r of rows) if (r.look.color !== undefined || r.look.opacity !== undefined || r.look.finish !== undefined || r.look.metallic !== undefined || r.look.roughness !== undefined) looks[r.key] = r.look;
  return { bodies: rows.map((r) => ({ key: r.key, faces: r.faces, edges: r.edges })), looks, hidden: rows.filter((r) => r.hidden).map((r) => r.key), ...(faces && Object.keys(faces).length ? { faces } : {}) };
}

// ---- edits: each returns the new value of one document field (undefined = remove the field) ----
const uniq = (xs: string[]): string[] => [...new Set(xs)];
export function toggleHidden(fields: BodyFields, key: string): string[] {
  const h = fields.view?.hiddenBodies ?? [];
  return h.includes(key) ? h.filter((k) => k !== key) : [...h, key];
}
export const setHidden = (fields: BodyFields, key: string, hide: boolean, rows?: readonly BodyRow[]): string[] => {
  const h = fields.view?.hiddenBodies ?? [];
  if (hide) return uniq([...h, key]);
  // a body hidden through its feature (the importer hides a file's hidden bodies that way): showing it keeps the others of that feature hidden by their own keys
  const origin = rows?.find((r) => r.key === key)?.origin;
  if (origin && h.includes(origin)) return uniq([...h.filter((k) => k !== origin && k !== key), ...(rows ?? []).filter((r) => r.origin === origin && r.key !== key).map((r) => r.key)]);
  return h.filter((k) => k !== key);
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
/** The same look change on several bodies at once (Appearance applied to a multi-selection): each keeps the rest of its own look. */
export function withLooks(fields: BodyFields, rows: Array<Pick<BodyRow, 'key' | 'look'>>, patch: Partial<Record<keyof BodyLookSpec, BodyLookSpec[keyof BodyLookSpec] | undefined>>): Record<string, BodyLookSpec> {
  let f = fields;
  for (const r of rows) f = { ...f, appearance: withLook(f, r, patch) };
  return f.appearance ?? {};
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
