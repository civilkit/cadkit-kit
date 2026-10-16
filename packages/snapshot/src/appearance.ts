// Per-body colour, opacity and finish for the headless renderer. The document keeps `appearance` ({ key: look }), `faceAppearance` and
// `bodyNames`; a key is a BODY key ('@body:' + the lowest face name of the lump) or a FEATURE id ('F83': every lump that feature created).
// The key rule is the app's (apps/cad/src/bodies.ts); a test in the app checks the two agree.
import type { MeshLike } from './types.js';

export type Finish = 'matte' | 'plastic' | 'chrome' | 'glass' | 'brushed';
export interface FaceLook { color?: string; opacity?: number; finish?: Finish }
/** The document fields the renderer reads. */
export interface AppearanceFields {
  appearance?: Record<string, FaceLook>;
  faceAppearance?: Record<string, FaceLook>;
  /** body keys hidden in the app (view state): their faces are not drawn */
  view?: { hiddenBodies?: string[] };
}

const FEATURE_NUM = /^F(\d+)(?:[.:|#]|$)/;
/** The lumps of a mesh: faces joined by a shared edge (edges list the two faces they separate). */
export function lumps(faceIds: readonly string[], edges: ReadonlyArray<{ faces?: string[] }>): string[][] {
  const names = [...new Set(faceIds)];
  const parent = new Map<string, string>(names.map((n) => [n, n]));
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; let c = a; while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; } return r; };
  for (const e of edges) {
    const f = [...new Set(e.faces ?? [])];
    if (f.length === 2 && parent.has(f[0]) && parent.has(f[1])) parent.set(find(f[0]), find(f[1]));
  }
  const by = new Map<string, string[]>();
  for (const n of names) { const r = find(n); (by.get(r) ?? by.set(r, []).get(r)!).push(n); }
  return [...by.values()];
}
export const bodyKey = (faces: readonly string[]): string => '@body:' + [...faces].sort()[0];
/** The lowest-numbered feature owning a face of the lump (the feature that created it). */
export function bodyOrigin(faces: readonly string[]): string | null {
  let best: string | null = null, bn = Infinity;
  for (const f of faces) { const m = FEATURE_NUM.exec(f); if (m && +m[1] < bn) { bn = +m[1]; best = 'F' + m[1]; } }
  return best;
}

const HEX = /^#[0-9a-f]{6}$/i;
const clean = (l: FaceLook | undefined): FaceLook => {
  const o: FaceLook = {};
  if (l && typeof l.color === 'string' && HEX.test(l.color)) o.color = l.color.toLowerCase();
  if (l && typeof l.opacity === 'number' && isFinite(l.opacity)) o.opacity = Math.min(1, Math.max(0.05, l.opacity));
  if (l && (['matte', 'plastic', 'chrome', 'glass', 'brushed'] as const).includes(l.finish as Finish)) o.finish = l.finish;
  return o;
};

/** The look of every face: its body's (body entry over feature entry), then the face's own colour and finish. Faces without a look are absent; faces of hidden bodies map to `hidden`. */
export function faceLooks(mesh: MeshLike, edges: ReadonlyArray<{ faces?: string[] }>, f: AppearanceFields): { looks: Map<string, FaceLook>; hidden: Set<string> } {
  const looks = new Map<string, FaceLook>(), hidden = new Set<string>();
  const ids = mesh.faceIds ?? [];
  const hid = new Set(f.view?.hiddenBodies ?? []);
  const app = f.appearance ?? {};
  if (Object.keys(app).length || hid.size) {
    for (const faces of lumps(ids, edges)) {
      const key = bodyKey(faces), origin = bodyOrigin(faces);
      if (hid.has(key)) { for (const n of faces) hidden.add(n); continue; }
      const look = { ...(origin ? clean(app[origin]) : {}), ...clean(app[key]) };
      if (Object.keys(look).length) for (const n of faces) looks.set(n, look);
    }
  }
  const entries = Object.entries(f.faceAppearance ?? {}).sort((a, b) => a[0].length - b[0].length);
  for (const [k, raw] of entries) {
    const l = clean(raw); delete l.opacity;
    if (!Object.keys(l).length) continue;
    const pre = k.endsWith('*') ? k.slice(0, -1) : null;
    for (const n of new Set(ids)) if (pre !== null ? n.startsWith(pre) : n === k) looks.set(n, { ...looks.get(n), ...l });
  }
  return { looks, hidden };
}
