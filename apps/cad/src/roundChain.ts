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

interface Edgeish { key?: string; faces?: string[]; pts?: number[][] }

/** The selected edge keys and, with the chain on, the keys that continue them. `extras` are only the added ones. */
export function chainSelection(selection: string[], edges: Edgeish[]): { keys: string[]; extras: string[] } {
  const cand: ChainEdge[] = edges.flatMap((e) => (e.key && e.faces && e.pts ? [{ key: e.key, faces: e.faces, pts: e.pts }] : []));
  const known = new Set(cand.map((e) => e.key));
  const picked = selection.filter((n) => known.has(n));
  if (!picked.length) return { keys: selection, extras: [] };
  const all = tangentChain(picked, cand);
  const extras = all.filter((k) => !selection.includes(k));
  return { keys: [...selection, ...extras], extras };
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
