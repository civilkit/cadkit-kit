// Making and placing views: the kernel's `drawing` request for each view, the standard layout, projected / section / detail /
// auxiliary views, and alignment. Pure but for the async `query` that talks to the kernel.
import {
  STD_FRAMES, auxFrame, bestScale, cross, newId, nextLetter, parseScale, projectedFrame, scaleText, sectionFrame, sheetSize, sideFor, viewExtent, viewScale,
  type DView, type DrawingDoc, type V2, type V3, type ViewData,
} from './model';
import { viewBox } from './render';

export type DrawingQuery = (views: Array<Record<string, unknown>>) => Promise<ViewData[] | null>;

/** The request entry of a view (details are cut from their parent's data on the sheet and need none). */
export function requestFor(doc: DrawingDoc, v: DView): Record<string, unknown> | null {
  if (v.kind === 'detail') return null;
  const e: Record<string, unknown> = { x: v.x, y: v.y };
  if (v.kind === 'section' && v.cut && v.parent) {
    const p = doc.views.find((x) => x.id === v.parent);
    if (!p) return null;
    const f = sectionFrame(p.x, p.y, v.cut);
    e.x = f.x; e.y = f.y; e.section = { point: f.point, hatch: 3 };
  }
  return e;
}

/** Views already projected for a part state: key = part revision + the view request. Kept so that coming back to the sheet is instant. */
const viewCache = new Map<string, ViewData>();
export const clearViewCache = (): void => viewCache.clear();
/** Remember views fetched by another route (the tools that make a view) under the part revision, so the refresh after the edit costs nothing. */
export function cacheViews(cacheKey: string, doc: DrawingDoc, data: Record<string, ViewData | undefined>): void {
  for (const v of doc.views) {
    const r = requestFor(doc, v), g = data[v.id];
    if (r && g) viewCache.set(cacheKey + JSON.stringify(r), g);
  }
}

/** Fetch geometry for the views of a drawing (hidden lines always included: the view toggles hide them on the sheet). One kernel call
 *  per view that is not cached (`cacheKey` = the part's revision), so a slow view does not hold up the others: `onView` is called as
 *  each arrives. */
export async function fetchViews(doc: DrawingDoc, query: DrawingQuery, only?: string[], opts: { cacheKey?: string; onView?: (id: string, g: ViewData) => void } = {}): Promise<Record<string, ViewData>> {
  const items = doc.views.filter((v) => !only || only.includes(v.id)).map((v) => ({ v, r: requestFor(doc, v) })).filter((x) => x.r);
  const out: Record<string, ViewData> = {};
  const todo: typeof items = [];
  for (const x of items) {
    const hit = opts.cacheKey !== undefined ? viewCache.get(opts.cacheKey + JSON.stringify(x.r)) : undefined;
    if (hit) { out[x.v.id] = hit; opts.onView?.(x.v.id, hit); } else todo.push(x);
  }
  if (items.length > 1 && todo.length) {
    for (const x of todo) {
      const res = await query([x.r!]);
      const r = res?.[0];
      if (r && r.lines) {
        const g = { min: r.min, max: r.max, lines: r.lines, edges: r.edges ?? [] };
        out[x.v.id] = g; opts.onView?.(x.v.id, g);
        if (opts.cacheKey !== undefined) { viewCache.set(opts.cacheKey + JSON.stringify(x.r), g); if (viewCache.size > 64) viewCache.delete(viewCache.keys().next().value as string); }
      }
    }
    return out;
  }
  if (!todo.length) return out;
  const res = await query(todo.map((x) => x.r!));
  if (!res) return out;
  todo.forEach((x, i) => {
    const r = res[i];
    if (r && r.lines) {
      const g = { min: r.min, max: r.max, lines: r.lines, edges: r.edges ?? [] };
      out[x.v.id] = g; opts.onView?.(x.v.id, g);
      if (opts.cacheKey !== undefined) viewCache.set(opts.cacheKey + JSON.stringify(x.r), g);
    }
  });
  return out;
}

const GAP = 22;

function mkView(doc: DrawingDoc, kind: DView['kind'], label: string, fr: { x: V3; y: V3 }, pos: V2, extra: Partial<DView> = {}): DView {
  return {
    id: newId('V', doc.views.map((v) => v.id)), kind, label, x: fr.x, y: fr.y, pos, scale: null, hidden: true, tangent: false, centerlines: true, showLabel: true, ...extra,
  };
}

/** Front, top, right (and isometric) filling the sheet at the largest standard scale that fits (or at `forceScale`, e.g. '2:1'); replaces the views already on it. */
export async function standardViews(doc: DrawingDoc, query: DrawingQuery, names = ['front', 'top', 'right', 'iso'], reserve = 0, forceScale?: string): Promise<{ doc: DrawingDoc; data: Record<string, ViewData> }> {
  let d: DrawingDoc = { ...doc, views: [], dims: [], balloons: [] };
  const proj = d.sheet.projection;
  const front = mkView(d, 'std', 'Front', STD_FRAMES.front, [0, 0]);
  d.views.push(front);
  const wants: Array<{ dir?: 'up' | 'right' | 'left' | 'down'; name: string }> = [];
  for (const n of names) {
    if (n === 'front') continue;
    wants.push({ name: n, dir: n === 'top' ? 'up' : n === 'right' ? 'right' : n === 'left' ? 'left' : n === 'bottom' ? 'down' : undefined });
  }
  const sideOf = (dir: 'up' | 'right' | 'left' | 'down') => sideFor(proj, dir);
  for (const w of wants) {
    if (w.dir) {
      const side = sideOf(w.dir);
      const fr = projectedFrame(front.x, front.y, side);
      d.views.push(mkView(d, 'proj', STD_FRAMES[w.name]?.label ?? w.name, fr, [0, 0], { parent: front.id, side }));
    } else if (STD_FRAMES[w.name]) {
      d.views.push(mkView(d, 'std', STD_FRAMES[w.name].label, STD_FRAMES[w.name], [0, 0]));
    }
  }
  const data = await fetchViews(d, query);
  if (!data[front.id]) return { doc: d, data };
  const ext = (v: DView): V2 => viewExtent(data[v.id] ?? data[front.id], 1);
  const fe = ext(front);
  const up = d.views.find((v) => v.side === 'up' || v.side === 'down');
  const side = d.views.find((v) => v.side === 'right' || v.side === 'left');
  const iso = d.views.find((v) => v.kind === 'std' && v.id !== front.id);
  const ue = up ? ext(up) : [0, 0] as V2, se = side ? ext(side) : [0, 0] as V2;
  const cross3 = forceScale ?? bestScale(d.sheet, [[fe[0], fe[1]], [se[0], 0], [0, ue[1]]]);
  const s = parseScale(cross3);
  d = { ...d, sheet: { ...d.sheet, scale: cross3 } };
  const [sw, sh] = sheetSize(d.sheet);
  const m = d.sheet.margin;
  const free = { x0: m + 12, y0: m + 12, x1: sw - m - 12, y1: sh - m - 48 - reserve };
  const fw = fe[0] * s, fh = fe[1] * s, uh = ue[1] * s, sW = se[0] * s;
  const totW = fw + (side ? GAP + sW : 0), totH = fh + (up ? GAP + uh : 0);
  const left = free.x0 + (free.x1 - free.x0 - totW) / 2, top = free.y0 + (free.y1 - free.y0 - totH) / 2 + 4;
  const place = (v: DView, cx: number, cy: number) => { v.pos = [cx, cy]; };
  const upOnTop = up?.side === 'up', sideOnRight = side?.side === 'right';
  const rowTopH = up ? uh : 0;
  const frontCy = upOnTop ? top + rowTopH + (up ? GAP : 0) + fh / 2 : top + fh / 2;
  const frontCx = sideOnRight || !side ? left + fw / 2 : left + sW + GAP + fw / 2;
  place(front, frontCx, frontCy);
  if (up) place(up, frontCx, upOnTop ? top + uh / 2 : frontCy + fh / 2 + GAP + uh / 2);
  if (side) place(side, sideOnRight ? frontCx + fw / 2 + GAP + sW / 2 : frontCx - fw / 2 - GAP - sW / 2, frontCy);
  // align projected views exactly on the parent's coordinates
  for (const v of d.views) if (v.parent) v.pos = alignedPos(d, data, v, v.pos);
  if (iso && data[iso.id]) {
    const ie = ext(iso);
    const cellW = Math.max(sW, 30), cellH = Math.max(uh, 30);
    let isc = s;
    for (const cand of ['2:1', '1:1', '1:2', '1:4', '1:5', '1:10', '1:20']) { const r = parseScale(cand); if (r <= s * 2 && ie[0] * r <= cellW * 1.4 && ie[1] * r <= cellH * 1.4) { isc = r; break; } }
    iso.scale = scaleText(isc);
    const cx = side && sideOnRight ? frontCx + fw / 2 + GAP + sW / 2 : frontCx + fw / 2 + GAP + ie[0] * isc / 2;
    place(iso, cx, up && upOnTop ? top + uh / 2 : top + ie[1] * isc / 2);
  }
  return { doc: d, data };
}

/** The position of a projected / section view on the axis shared with its parent (the other coordinate is kept). */
export function alignedPos(doc: DrawingDoc, data: Record<string, ViewData | undefined>, v: DView, want: V2): V2 {
  const p = doc.views.find((x) => x.id === v.parent);
  const pg = p && data[p.id], g = data[v.id];
  if (!p || !pg || !g || !v.side) return want;
  const sp = viewScale(doc, p), sv = viewScale(doc, v);
  const cp = [(pg.min[0] + pg.max[0]) / 2, (pg.min[1] + pg.max[1]) / 2], cv = [(g.min[0] + g.max[0]) / 2, (g.min[1] + g.max[1]) / 2];
  // right / left views share the model v axis with the parent: same sheet height; above / below share u: same sheet column
  if (v.side === 'right' || v.side === 'left') return [want[0], p.pos[1] + cp[1] * sp - cv[1] * sv];
  return [p.pos[0] + cv[0] * sv - cp[0] * sp, want[1]];
}

/** A view projected from `parent` to a side; `at` is where the cursor put it (the aligned coordinate is taken from the parent). */
export async function addProjected(doc: DrawingDoc, query: DrawingQuery, parentId: string, side: 'right' | 'left' | 'up' | 'down', at: V2): Promise<{ doc: DrawingDoc; data: Record<string, ViewData>; view: DView } | null> {
  const p = doc.views.find((v) => v.id === parentId);
  if (!p) return null;
  const fr = projectedFrame(p.x, p.y, side);
  const label = ({ right: 'Right', left: 'Left', up: 'Top', down: 'Bottom' } as const)[side];
  const view = mkView(doc, 'proj', p.kind === 'std' && p.label !== 'Front' ? `Projected ${label}` : label, fr, at, { parent: p.id, side, scale: p.scale });
  const d2 = { ...doc, views: [...doc.views, view] };
  const data = await fetchViews(d2, query, [view.id]);
  if (!data[view.id]) return null;
  return { doc: d2, data, view };
}

/** Section view from a cut line on `parent` (vertical at parent u = at, or horizontal at v = at); placed beside the parent. */
export async function addSection(doc: DrawingDoc, query: DrawingQuery, data0: Record<string, ViewData | undefined>, parentId: string, dir: 'v' | 'h', at: number): Promise<{ doc: DrawingDoc; data: Record<string, ViewData>; view: DView } | null> {
  const p = doc.views.find((v) => v.id === parentId);
  const pg = p && data0[p.id];
  if (!p || !pg) return null;
  const f = sectionFrame(p.x, p.y, { dir, at });
  const letter = nextLetter(doc);
  const side = dir === 'v' ? sideFor(doc.sheet.projection, 'right') : sideFor(doc.sheet.projection, 'up');
  const view = mkView(doc, 'section', 'Section', f, [0, 0], { parent: p.id, side, scale: p.scale, cut: { dir, at, letter }, hidden: false, centerlines: false });
  const d2 = { ...doc, views: [...doc.views, view] };
  const data = await fetchViews(d2, query, [view.id]);
  const g = data[view.id];
  if (!g) return null;
  const pb = viewBox(doc, p, pg);
  const s = viewScale(doc, p);
  const half = viewExtent(g, s);
  const pos: V2 = side === 'right' ? [pb.x1 + GAP + half[0] / 2, p.pos[1]] : side === 'left' ? [pb.x0 - GAP - half[0] / 2, p.pos[1]] : side === 'up' ? [p.pos[0], pb.y0 - GAP - half[1] / 2 - 8] : [p.pos[0], pb.y1 + GAP + half[1] / 2 + 8];
  view.pos = alignedPos(d2, { ...data0, ...data }, view, pos);
  const all = { ...data0, ...data };
  view.pos = nudgeClear(d2, all, view, side === 'right' ? [1, 0] : side === 'left' ? [-1, 0] : side === 'up' ? [0, -1] : [0, 1]);
  return { doc: d2, data, view };
}

/** Detail view: a circle on `parent` shown larger. */
export function addDetail(doc: DrawingDoc, parentId: string, c: V2, r: number, scale?: string, data: Record<string, ViewData | undefined> = {}): { doc: DrawingDoc; view: DView } | null {
  const p = doc.views.find((v) => v.id === parentId);
  if (!p || r <= 0) return null;
  const ps = viewScale(doc, p);
  const sc = scale ?? scaleText(Math.min(10, ps * 2));
  const rr = r * parseScale(sc);
  const view = mkView(doc, 'detail', 'Detail', p, [0, 0], { parent: p.id, scale: sc, circle: { c, r, letter: nextLetter(doc) }, centerlines: true });
  const [sw, sh] = sheetSize(doc.sheet);
  view.pos = [Math.min(sw - doc.sheet.margin - rr - 6, Math.max(doc.sheet.margin + rr + 6, p.pos[0] + 90)), Math.max(doc.sheet.margin + rr + 6, Math.min(sh - 60 - rr, p.pos[1] - 60))];
  const d2 = { ...doc, views: [...doc.views, view] };
  const tries: V2[] = [[1, 0], [0, -1], [0, 1], [-1, 0]];
  for (const t of tries) { const q = nudgeClear(d2, data, view, t); if (q !== view.pos) { view.pos = q; break; } if (q === view.pos && !data[p.id]) break; }
  return { doc: d2, view };
}

/** Auxiliary view square to an edge of `parent` that makes `angle` with the view's x axis. */
export async function addAux(doc: DrawingDoc, query: DrawingQuery, data0: Record<string, ViewData | undefined>, parentId: string, angle: number): Promise<{ doc: DrawingDoc; data: Record<string, ViewData>; view: DView } | null> {
  const p = doc.views.find((v) => v.id === parentId);
  const pg = p && data0[p.id];
  if (!p || !pg) return null;
  const fr = auxFrame(p.x, p.y, angle);
  const view = mkView(doc, 'aux', 'Auxiliary', fr, [0, 0], { parent: p.id, scale: p.scale, auxAngle: angle });
  const d2 = { ...doc, views: [...doc.views, view] };
  const data = await fetchViews(d2, query, [view.id]);
  const g = data[view.id];
  if (!g) return null;
  const pb = viewBox(doc, p, pg);
  const s = viewScale(doc, p);
  const half = viewExtent(g, s);
  // the view sits in the direction square to the edge: away from the parent along (-sin, cos) in view space
  const n: V2 = [-Math.sin(angle), -Math.cos(angle)];
  const nn: V2 = n[0] * (pb.x1 + pb.x0 - 2 * p.pos[0]) + n[1] * (pb.y1 + pb.y0 - 2 * p.pos[1]) < 0 ? [-n[0], -n[1]] : n;
  const reach = Math.hypot(pb.x1 - pb.x0, pb.y1 - pb.y0) / 2 + Math.hypot(...half) / 2 + GAP;
  view.pos = [p.pos[0] + nn[0] * reach, p.pos[1] + nn[1] * reach];
  view.pos = nudgeClear(d2, { ...data0, ...data }, view, nn);
  return { doc: d2, data, view };
}

/** Push a new view along `dir` (mm) until it no longer lands on another view (labels included). */
export function nudgeClear(doc: DrawingDoc, data: Record<string, ViewData | undefined>, view: DView, dir: V2): V2 {
  const boxOf = (v: DView, pos: V2) => { const g = v.kind === 'detail' ? data[v.parent ?? ''] : data[v.id]; if (!g) return null; const b = viewBox(doc, { ...v, pos }, g); return { x0: b.x0 - 4, y0: b.y0 - 4, x1: b.x1 + 4, y1: b.y1 + 16 }; };
  const others = doc.views.filter((v) => v.id !== view.id).map((v) => boxOf(v, v.pos)).filter((b): b is NonNullable<typeof b> => !!b);
  const L = Math.hypot(...dir) || 1;
  let pos: V2 = [...view.pos];
  for (let i = 0; i < 60; i++) {
    const b = boxOf(view, pos);
    if (!b || !others.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) return pos;
    pos = [pos[0] + (dir[0] / L) * 6, pos[1] + (dir[1] / L) * 6];
  }
  return view.pos;
}

/** Move a view; its dependants (projected, section, aux) move with it so they stay aligned. A dependant is limited to its alignment axis. */
export function moveView(doc: DrawingDoc, data: Record<string, ViewData | undefined>, id: string, to: V2): DrawingDoc {
  const v = doc.views.find((x) => x.id === id);
  if (!v) return doc;
  const pos = v.parent && v.side && v.kind !== 'detail' ? alignedPos(doc, data, v, to) : to;
  const dx = pos[0] - v.pos[0], dy = pos[1] - v.pos[1];
  const kids = new Set<string>();
  const walk = (p: string) => { for (const k of doc.views) if (k.parent === p && !kids.has(k.id) && k.kind !== 'detail') { kids.add(k.id); walk(k.id); } };
  walk(id);
  return { ...doc, views: doc.views.map((x) => (x.id === id ? { ...x, pos } : kids.has(x.id) ? { ...x, pos: [x.pos[0] + dx, x.pos[1] + dy] as V2 } : x)) };
}

/** Which side of a view's box a point is on (the projected view tool). */
export function sideOfPoint(box: { x0: number; y0: number; x1: number; y1: number }, p: V2): 'right' | 'left' | 'up' | 'down' {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const dx = (p[0] - cx) / Math.max(1, box.x1 - box.x0), dy = (p[1] - cy) / Math.max(1, box.y1 - box.y0);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';
}
void cross;
