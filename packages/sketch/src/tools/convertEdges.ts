/**
 * Convert edges: copy the outline of the body on screen into the sketch as REAL geometry (fixed, extrudable), not dashed reference.
 *
 * What a click does (the pointer shows it before the click):
 *  - on an edge: the whole connected chain it belongs to (the entire tooth profile, a full circle); Shift+click: just that edge;
 *  - inside an outline: that face's whole boundary, the outer loop and every hole or bore in it;
 *  - on an edge that is part of the selection made in 3D before the sketch: all of the selection.
 * Enter converts the selection made in 3D (edges, or the boundary of faces). After each action the hint says how many curves were
 * converted, or that they were already in the sketch as outline. A curve that was projected earlier as dashed reference is made solid in place.
 */
import type { SketchDraft } from '../types';
import { projectCurves, referenceChain, chainCurves, edgeCurve, edgesFor, edgeNear, flatten, classifyCurve, shapesOf, type Projected } from './project';
import type { BodyEdge, FieldSpec, Pt, PreviewShape, Tool, ToolEnv, ToolOutput } from './types';

type Piece = { edge: BodyEdge; pts: Pt[]; off: number };
const rkey = (p: Pt) => `${Math.round(p.x * 1e4)}:${Math.round(p.y * 1e4)}`;

/** Even-odd test of a point against a set of closed segments. */
function inside(p: Pt, loops: Pt[][]): boolean {
  let c = false;
  for (const pts of loops) for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

type Comp = { pieces: Piece[]; segs: Pt[][]; area: number };

/** The closed outlines of the edges that lie in one plane parallel to the sketch plane, each a set of pieces joined end to end. */
function components(pieces: Piece[]): Comp[] {
  const at = new Map<string, Piece[]>();
  const ends = (p: Piece) => [rkey(p.pts[0]), rkey(p.pts[p.pts.length - 1])];
  for (const p of pieces) for (const k of new Set(ends(p))) at.set(k, [...(at.get(k) ?? []), p]);
  const seen = new Set<Piece>();
  const out: Comp[] = [];
  for (const p0 of pieces) {
    if (seen.has(p0)) continue;
    const stack = [p0], got: Piece[] = [];
    seen.add(p0);
    while (stack.length) {
      const p = stack.pop()!; got.push(p);
      for (const k of ends(p)) for (const q of at.get(k) ?? []) if (!seen.has(q)) { seen.add(q); stack.push(q); }
    }
    // a closed outline: every vertex has two pieces (a self-closed piece counts once)
    const closed = got.every((p) => ends(p).every((k, i, a) => (a[0] === a[1] && i === 1) || (at.get(k) ?? []).length === 2 || (a[0] === a[1])));
    if (!closed) continue;
    const xs = got.flatMap((p) => p.pts.map((q) => q.x)), ys = got.flatMap((p) => p.pts.map((q) => q.y));
    out.push({ pieces: got, segs: got.map((p) => p.pts), area: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) });
  }
  return out;
}

function piecesOf(env: ToolEnv): Piece[] {
  const out: Piece[] = [];
  for (const e of env.body?.edges ?? []) {
    const f = flatten(env.body!.frame, e.pts);
    if (f.pts.length >= 2 && classifyCurve(f.pts)) out.push({ edge: e, pts: f.pts, off: f.off });
  }
  return out;
}

/** The boundary of the face under `at`: the smallest outline that holds the point (nearest the sketch plane first) and the outlines directly inside it (holes). */
export function faceBoundary(env: ToolEnv, at: Pt): BodyEdge[] | null {
  const all = piecesOf(env);
  const offs = [...new Set(all.map((p) => Math.round(p.off * 1e4) / 1e4))].sort((a, b) => Math.abs(a) - Math.abs(b));
  for (const o of offs) {
    const comps = components(all.filter((p) => Math.abs(p.off - o) <= 1e-4));
    const holding = comps.filter((c) => inside(at, c.segs)).sort((a, b) => a.area - b.area);
    const outer = holding[0];
    if (!outer) continue;
    // a point inside a hole (the bore) is in empty space, not on the face: the smallest outline holding it is then a hole, which another outline holds
    if (comps.some((c) => c !== outer && inside(outer.segs[0][0], c.segs))) return null;
    const within = comps.filter((c) => c !== outer && inside(c.segs[0][0], outer.segs));
    const holes = within.filter((h) => !within.some((o2) => o2 !== h && inside(h.segs[0][0], o2.segs)));
    return [outer, ...holes].flatMap((c) => c.pieces.map((p) => p.edge));
  }
  return null;
}

/** What a click at `at` would convert: the chain of the edge under the pointer (or the whole pre-selection when that edge is part of it), else the face's boundary. */
export function targetAt(env: ToolEnv, at: Pt, shift: boolean): { edges: BodyEdge[]; kind: 'chain' | 'edge' | 'face' | 'selection' } | null {
  if (!env.body) return null;
  const e = edgeNear(env, at);
  if (e) {
    const sel = edgesFor(env.body.edges, env.selection ?? []);
    if (sel.includes(e) && sel.length > 1 && !shift) return { edges: sel, kind: 'selection' };
    if (shift) return { edges: [e], kind: 'edge' };
    const chain = referenceChain(env, e);
    return { edges: chain.length ? chain.map((c) => c.edge) : [e], kind: chain.length > 1 ? 'chain' : 'edge' };
  }
  const f = faceBoundary(env, at);
  return f ? { edges: f, kind: 'face' } : null;
}

const view = (draft: SketchDraft, hint: string, preview: PreviewShape[] = [], hintArgs?: Record<string, number>): ToolOutput<Record<string, never>> =>
  ({ state: {}, draft, preview, fields: [] as FieldSpec[], hint, ...(hintArgs ? { hintArgs } : {}) });

const BASE_HINT = 'app.sketch.hint.convertEdges';
const previewOf = (env: ToolEnv, edges: BodyEdge[]): PreviewShape[] => edges.flatMap((e) => { const c = edgeCurve(env.body!.frame, e); return c ? shapesOf(c) : []; });

function convert(draft: SketchDraft, env: ToolEnv, edges: BodyEdge[]): ToolOutput<Record<string, never>> {
  const curves = edgesToCurves(env, edges);
  const r = projectCurves(draft, curves, { construction: false });
  if (r.added.length) return view(r.draft, 'app.sketch.hint.converted', [], { n: r.added.length });
  return view(r.draft, r.existing ? 'app.sketch.hint.alreadyConverted' : 'app.sketch.hint.nothingProjected');
}
const edgesToCurves = (env: ToolEnv, edges: BodyEdge[]): Array<Projected | null> => {
  const frame = env.body!.frame;
  const out: Array<Projected | null> = [];
  const left = new Set(edges);
  // only a smooth outline the kernel split into several edges (one exact spline) is joined back into that spline; separate edges that meet
  // at a corner stay separate, so a gear's teeth keep their corners
  const joined = new Set<BodyEdge>();
  for (const e of edges) {
    if (joined.has(e) || !e.exact || e.exact.pieces < 2) continue;
    const chain = referenceChain(env, e);
    if (chain.length >= 2 && chain.every((c) => c.whole && c.exact && left.has(c.edge))) { out.push(...chainCurves(chain)); for (const c of chain) { joined.add(c.edge); left.delete(c.edge); } }
  }
  for (const e of left) out.push(edgeCurve(frame, e));
  return out;
};

export const convertEdgesTool: Tool<Record<string, never>> = {
  id: 'convert-edges',
  start: () => ({}),
  step(_s, ev, draft, _settings, env) {
    if (!env?.body) return view(draft, 'app.sketch.hint.noBody');
    switch (ev.type) {
      case 'move': {
        const t = targetAt(env, ev.at, ev.mods.shift);
        return view(draft, BASE_HINT, t ? previewOf(env, t.edges) : pendingPreview(env, draft));
      }
      case 'click': {
        const t = targetAt(env, ev.at, ev.mods.shift);
        if (!t) return view(draft, 'app.sketch.hint.nothingToConvert', pendingPreview(env, draft));
        return convert(draft, env, t.edges);
      }
      case 'key': {
        if (ev.key !== 'Enter') return view(draft, BASE_HINT, pendingPreview(env, draft));
        const edges = edgesFor(env.body.edges, env.selection ?? []);
        if (!edges.length) return view(draft, 'app.sketch.hint.nothingSelected');
        return convert(draft, env, edges);
      }
      default:
        return view(draft, BASE_HINT, pendingPreview(env, draft));
    }
  },
};

/** The selection made in 3D, shown while there is one so Enter is known to be live (and the app keeps Enter for the tool). */
function pendingPreview(env: ToolEnv, _draft: SketchDraft): PreviewShape[] {
  if (!env.body || !env.selection?.length) return [];
  return previewOf(env, edgesFor(env.body.edges, env.selection));
}
