// The "Tangent chain" choice of the Fillet and Chamfer editors (SolidWorks: "Select through tangent edges"): when on, picking an edge
// also rounds the edges that continue it smoothly. The preference is remembered per browser; the picks are remembered by their edge
// lists so the editor's toggle can switch an existing feature between "as picked" and "with the chain" without the (changed) body.
import { tangentChain, type ChainEdge } from './tangentChain';

const KEY = 'cad.tangentChain';

/** Whether tangent chains are followed. Default on. */
export function tangentChainOn(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}
export function setTangentChain(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private window */ }
}

interface Edgeish { key?: string; faces?: string[]; pts?: number[][]; mid?: number[]; smooth?: boolean }

/** The selected edge keys and, with the chain on, the keys that continue them. `extras` are only the added ones. */
export function chainSelection(selection: string[], edges: Edgeish[]): { keys: string[]; extras: string[] } {
  const cand: ChainEdge[] = edges.flatMap((e) => (e.key && e.faces && e.pts ? [{ key: e.key, faces: e.faces, pts: e.pts, smooth: e.smooth }] : []));
  const known = new Set(cand.map((e) => e.key));
  const picked = selection.filter((n) => known.has(n));
  if (!picked.length) return { keys: selection, extras: [] };
  const all = tangentChain(picked, cand);
  const extras = all.filter((k) => !selection.includes(k));
  return { keys: [...selection, ...extras], extras };
}

interface Ref { faces?: unknown; at?: unknown }

/** The distance from `p` to the polyline `pts`. */
function distToPolyline(p: number[], pts: number[][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const s = l2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
    best = Math.min(best, Math.hypot(ap[0] - ab[0] * s, ap[1] - ab[1] * s, ap[2] - ab[2] * s));
  }
  return best;
}

/** The edge of `edges` between the faces `faces` (either order) nearest the point `at`, with its distance; null when no edge has those faces. */
export function nearestEdge(faces: string[], at: number[], edges: Edgeish[]): { key: string; d: number } | null {
  let best: { d: number; key: string } | null = null;
  for (const e of edges) {
    const pts = e.pts?.length ? e.pts : e.mid ? [e.mid] : null;
    if (!e.key || !pts || e.faces?.length !== 2 || faces.length !== 2 || !faces.every((x) => e.faces!.includes(x))) continue;
    const d = distToPolyline(at, pts);
    if (!best || d < best.d) best = { d, key: e.key };
  }
  return best;
}

/** The key of the edge an edge reference (`{faces, at}`) names on `edges`, or null: the nearest edge between the same two faces. */
export function refEdgeKey(r: unknown, edges: Edgeish[]): string | null {
  const x = r as Ref | null;
  const f = Array.isArray(x?.faces) ? (x!.faces as string[]) : null, at = Array.isArray(x?.at) ? (x!.at as number[]) : null;
  return f && f.length === 2 && at && at.length === 3 ? nearestEdge(f, at, edges)?.key ?? null : null;
}

/** A feature's edge references (`{faces, at}`, as the kernel takes them) with the edges that continue them tangentially appended, read on
 *  `edges` (the body the feature is applied to). For an edge list that was not made through the chain (picked with it off, or made in
 *  an earlier session): each reference is matched to the edge between the same two faces nearest its point (within `tol` of the edge's
 *  polyline, which is a chord of a curved edge). The given references are kept as they are (a per-edge radius stays); null when the
 *  chain adds nothing. */
export function chainRefs(refs: unknown, edges: Edgeish[], tol = 0.25): unknown[] | null {
  if (!Array.isArray(refs) || !refs.length) return null;
  const keys: string[] = [];
  for (const r of refs as Ref[]) {
    const f = Array.isArray(r?.faces) ? (r.faces as string[]) : null, at = Array.isArray(r?.at) ? (r.at as number[]) : null;
    if (!f || f.length !== 2 || !at || at.length !== 3) continue;
    const best = nearestEdge(f, at, edges);
    if (best && best.d <= tol) keys.push(best.key);
  }
  if (!keys.length) return null;
  const { extras } = chainSelection(keys, edges);
  if (!extras.length) return null;
  const byKey = new Map(edges.map((e) => [e.key, e]));
  const added = extras.flatMap((k) => { const e = byKey.get(k); return e?.faces && e.mid ? [{ faces: [...e.faces], at: [...e.mid] }] : []; });
  return added.length ? [...refs, ...added] : null;
}

// ---- picks, so the editor's toggle can undo or redo the chain on the feature it made ----

export interface RoundPick { seeds: unknown[]; all: unknown[] }
const picks = new Map<string, RoundPick>();
const sig = (refs: unknown[]): string => JSON.stringify(refs);

/** Remember that `all` (the edge references with the chain) came from `seeds` (as picked). Nothing is kept when the chain added nothing. */
export function rememberRoundPick(seeds: unknown[], all: unknown[]): void {
  if (all.length <= seeds.length) return;
  const p = { seeds, all };
  picks.set(sig(all), p); picks.set(sig(seeds), p);
  while (picks.size > 40) picks.delete(picks.keys().next().value as string);
}
/** The pick an edge list of a feature came from, or null (edges picked by other means). */
export const roundPickOf = (edges: unknown): RoundPick | null => (Array.isArray(edges) ? picks.get(sig(edges)) ?? null : null);
