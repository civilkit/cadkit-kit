// Picking into an edge or face list field of an open editor (Fillet and Chamfer edges, Shell faces...): while the field is active, each
// click or tap adds what was hit to the field, and a hit on something already in it takes it out again, with no modifier key (a phone
// has none). A click on empty space changes nothing. The field is the record; the selection only lights up what is in it.
//
// An edges field names edges of the body its feature is applied to (the body before it), but the edges are clicked on the body on
// screen, which has the feature applied (the saved one or its preview). So with `before` given, each clicked edge is first taken to the
// edge of the body before the feature between the same two faces nearest it (a rim edge the fillet shortened, or split into a long
// piece and a stub at the end of the round, is the one edge it was before), an edge between faces the feature made itself is dropped,
// and the tangent chain is followed on that body: adding edges later gives what picking them all at once gives.
import { pickValue, type ViewEdge } from './featureCommands';
import { nearestEdge, refEdgeKey, rememberRoundPick, roundPickOf } from './roundChain';

const sameRef = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  const x = a as { faces?: string[]; at?: number[] } | null, y = b as { faces?: string[]; at?: number[] } | null;
  if (!x?.faces || !y?.faces || x.faces.length !== y.faces.length || !x.faces.every((f) => y.faces!.includes(f))) return false;
  if (!x.at || !y.at) return !x.at && !y.at;
  return Math.hypot(...x.at.map((v, i) => v - (y.at![i] ?? 0))) <= 1e-6 * Math.max(1, ...x.at.map(Math.abs));
};

/** Equality of two references: the same reference, or (with `edges`) two edge references naming the same edge of `edges`. */
const sameOn = (edges?: ViewEdge[]) => (a: unknown, b: unknown): boolean => {
  if (sameRef(a, b)) return true;
  if (!edges?.length || typeof a === 'string' || typeof b === 'string') return false;
  const ka = refEdgeKey(a, edges);
  return ka !== null && ka === refEdgeKey(b, edges);
};

/** The field after a hit on `hit` (the references one pick gives): all of them already in the field takes them out, else the missing
 *  ones are added. `addOnly` (a box selection) never takes anything out. With `edges` (the body the references are read on), two
 *  references to one edge count as one, and a field that names an edge twice keeps it once. */
export function toggleRefs(current: unknown[], hit: unknown[], addOnly = false, edges?: ViewEdge[]): { value: unknown[]; removed: boolean } {
  const same = sameOn(edges);
  const has = (list: unknown[], r: unknown): boolean => list.some((x) => same(x, r));
  const cur = current.filter((r, i) => !has(current.slice(0, i), r));
  if (!addOnly && hit.length && hit.every((r) => has(cur, r))) return { value: cur.filter((x) => !has(hit, x)), removed: true };
  return { value: [...cur, ...hit.filter((r, i) => !has(cur, r) && !has(hit.slice(0, i), r))], removed: false };
}

const BASE = /~\d+$/;
/** The edges clicked on the body on screen (`shown`) as edges of `before` (the body the feature is applied to): the edge between the
 *  same two faces nearest the clicked one, else between the faces they were split from (`F2.S.e3~1` is a piece of `F2.S.e3`). A
 *  clicked edge with no such edge (one between faces the feature made) is dropped; names that are not edges pass through. */
export function edgesOnBefore(names: string[], shown: ViewEdge[], before: ViewEdge[]): string[] {
  const byKey = new Map(shown.filter((e) => e.key).map((e) => [e.key!, e]));
  const out: string[] = [];
  for (const n of names) {
    const e = byKey.get(n);
    if (!e) { if (!n.includes('|')) out.push(n); else if (before.some((b) => b.key === n)) out.push(n); continue; }
    if (!e.faces || e.faces.length !== 2) continue;
    const at = e.mid ?? e.pts?.[Math.floor((e.pts.length - 1) / 2)];
    if (!at) continue;
    const hit = nearestEdge(e.faces, at, before) ?? nearestEdge(e.faces.map((f) => f.replace(BASE, '')), at, before);
    if (hit && !out.includes(hit.key)) out.push(hit.key);
  }
  return out;
}

/** What a pick does to an active list field: null when it hit nothing the field takes (empty space, a face for an edges field), so
 *  neither the field nor the selection changes; else the field's new value and the new selection. `edges` is the body the names were
 *  picked on; `before` (an edges field of a feature in the document) the body that feature is applied to, which the field is read on. */
export function listPick(path: string, current: unknown, selection: string[], names: string[], edges: ViewEdge[], chain = false, addOnly = false, before?: ViewEdge[] | null): { value: unknown[]; selection: string[] } | null {
  const on = path === 'edges' && before?.length ? before : edges;
  const ns = on === edges ? names : edgesOnBefore(names, edges, on);
  const hit = pickValue(path, ns, on, chain);
  if (!Array.isArray(hit) || !hit.length) return null;
  const cur = Array.isArray(current) ? current : [];
  const ref = path === 'edges' ? on : undefined;
  const { value, removed } = toggleRefs(cur, hit, addOnly, ref);
  if (path === 'edges' && chain) {
    // the field's edges as picked, without the chain, so the editor's Tangent chain tick can still switch the whole list
    const seedHit = (pickValue(path, ns, on, false) as unknown[] | null) ?? [];
    const seeds = roundPickOf(cur)?.seeds ?? cur;
    const same = sameOn(ref);
    rememberRoundPick(removed ? seeds.filter((x) => !seedHit.some((s) => same(s, x))) : toggleRefs(seeds, seedHit, true, ref).value, value);
  }
  const sel = removed ? selection.filter((n) => !names.includes(n)) : [...new Set([...selection, ...names])];
  return { value, selection: sel };
}

/** The selection with the names whose references are no longer in the field dropped (an edge taken out with its chip stops being lit).
 *  A name that no longer resolves on the body on screen (the preview rounded it away) is kept. `before` as for listPick. */
export function selectionInField(path: string, selection: string[], value: unknown, edges: ViewEdge[], chain = false, before?: ViewEdge[] | null): string[] {
  const list = Array.isArray(value) ? value : [];
  const on = path === 'edges' && before?.length ? before : edges;
  const same = sameOn(path === 'edges' ? on : undefined);
  return selection.filter((n) => {
    const ns = on === edges ? [n] : edgesOnBefore([n], edges, on);
    const r = ns.length ? pickValue(path, ns, on, chain) : null;
    return !Array.isArray(r) || r.every((x) => list.some((y) => same(y, x)));
  });
}
