// Draws the sheet as a flat list of primitives (millimetres on the sheet, y down); SVG, PDF and DXF are written from that list,
// so the three outputs agree. Nothing here touches the DOM.
import { fmtAngle, fmtLength, dimText, sheetSize, toSheet, viewCentre, viewScale, type DDim, type DrawingDoc, type DView, type V2, type ViewData, scaleText } from './model';
import { shownLines, edgeShape, refreshDim } from './geom';

export type Layer = 'border' | 'visible' | 'hidden' | 'thin' | 'center' | 'dim' | 'text' | 'hatch';
export interface Tag { id: string; kind: 'view' | 'dim' | 'note' | 'balloon' | 'title' | 'bom' | 'label' }
export type Prim =
  | { t: 'poly'; pts: number[]; w: number; layer: Layer; dash?: number[]; fill?: boolean; closed?: boolean; tag?: Tag }
  | { t: 'circle'; c: V2; r: number; w: number; layer: Layer; dash?: number[]; tag?: Tag }
  | { t: 'arc'; c: V2; r: number; a0: number; a1: number; w: number; layer: Layer; tag?: Tag }
  | { t: 'text'; x: number; y: number; s: string; size: number; anchor: 'start' | 'middle' | 'end'; rot: number; bold?: boolean; layer: Layer; tag?: Tag };

export interface BomRow { no: number; part: string; qty: number; material: string; mass: string; /** insertPart ids of the item, to find its edges for balloons */ components?: string[] }
export interface RenderCtx {
  doc: DrawingDoc;
  data: Record<string, ViewData | undefined>;
  /** text for a hole / thread callout by feature id */
  callout?: (feature: string) => string | null;
  bom?: BomRow[];
}

const W = { thick: 0.5, med: 0.35, thin: 0.18 };
const DASH_HID = [2.4, 1.2], DASH_CEN = [8, 1.5, 1.5, 1.5];

// ---- clipping to the circle of a detail view -------------------------------------------------------------------------------
function clipToCircle(pts: number[], c: V2, r: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  const inside = (x: number, y: number) => Math.hypot(x - c[0], y - c[1]) <= r;
  for (let i = 2; i < pts.length; i += 2) {
    const [x0, y0, x1, y1] = [pts[i - 2], pts[i - 1], pts[i], pts[i + 1]];
    const dx = x1 - x0, dy = y1 - y0, fx = x0 - c[0], fy = y0 - c[1];
    const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
    let t0 = 0, t1 = 1;
    if (A < 1e-18) { if (!inside(x0, y0)) { if (cur.length) { out.push(cur); cur = []; } continue; } }
    else {
      const disc = B * B - 4 * A * C;
      if (disc < 0) { if (cur.length) { out.push(cur); cur = []; } continue; }
      const sq = Math.sqrt(disc);
      t0 = Math.max(0, (-B - sq) / (2 * A)); t1 = Math.min(1, (-B + sq) / (2 * A));
      if (t0 >= t1) { if (cur.length) { out.push(cur); cur = []; } continue; }
    }
    const a = [x0 + dx * t0, y0 + dy * t0], b = [x0 + dx * t1, y0 + dy * t1];
    if (!cur.length) cur.push(a[0], a[1]);
    else if (t0 > 0) { out.push(cur); cur = [a[0], a[1]]; }
    cur.push(b[0], b[1]);
    if (t1 < 1) { out.push(cur); cur = []; }
  }
  if (cur.length >= 4) out.push(cur);
  return out.filter((p) => p.length >= 4);
}

/** The data a view draws from: details use the parent's lines. */
export function dataOf(ctx: RenderCtx, v: DView): ViewData | undefined {
  return v.kind === 'detail' && v.parent ? ctx.data[v.parent] : ctx.data[v.id];
}

/** Sheet-millimetre scale of a view; a detail view's scale is its own (default twice the parent's). */
export function scaleOf(doc: DrawingDoc, v: DView): number { return viewScale(doc, v); }

/** Sheet position of view coordinates for a view (detail views centre on the circle). */
export function placer(doc: DrawingDoc, v: DView, g: ViewData): (u: number, w: number) => V2 {
  const s = scaleOf(doc, v);
  if (v.kind === 'detail' && v.circle) {
    const c = v.circle.c;
    return (u, w) => [v.pos[0] + (u - c[0]) * s, v.pos[1] - (w - c[1]) * s];
  }
  return (u, w) => toSheet(v, g, s, u, w);
}

/** The extent of a view on the sheet, mm: centre and half sizes. */
export function viewBox(doc: DrawingDoc, v: DView, g: ViewData): { x0: number; y0: number; x1: number; y1: number } {
  const s = scaleOf(doc, v);
  if (v.kind === 'detail' && v.circle) { const r = v.circle.r * s; return { x0: v.pos[0] - r, y0: v.pos[1] - r, x1: v.pos[0] + r, y1: v.pos[1] + r }; }
  const a = toSheet(v, g, s, g.min[0], g.min[1]), b = toSheet(v, g, s, g.max[0], g.max[1]);
  return { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
}

export function viewLabel(doc: DrawingDoc, v: DView): string {
  const sc = scaleText(scaleOf(doc, v));
  const parts: string[] = [];
  if (v.kind === 'section' && v.cut) parts.push(`SECTION ${v.cut.letter}-${v.cut.letter}`);
  else if (v.kind === 'detail' && v.circle) parts.push(`DETAIL ${v.circle.letter}`);
  else parts.push(v.label.toUpperCase());
  return `${parts[0]}  (${sc})`;
}

// ---- the sheet ------------------------------------------------------------------------------------------------------------
export function renderSheet(ctx: RenderCtx): Prim[] {
  const { doc } = ctx;
  const out: Prim[] = [];
  const [sw, sh] = sheetSize(doc.sheet);
  const m = doc.sheet.margin;
  out.push({ t: 'poly', pts: [m, m, sw - m, m, sw - m, sh - m, m, sh - m], closed: true, w: 0.7, layer: 'border' });
  titleBlock(ctx, out, sw - m, sh - m);

  for (const v of doc.views) {
    const g = dataOf(ctx, v);
    if (!g) continue;
    viewPrims(ctx, v, g, out);
  }
  for (const v of doc.views) {
    const g = ctx.data[v.id] ?? dataOf(ctx, v);
    if (!g) continue;
    if (v.kind === 'section' && v.cut && v.parent) cutLine(ctx, v, out);
    if (v.kind === 'detail' && v.circle && v.parent) detailCircle(ctx, v, out);
  }
  for (const d of doc.dims) {
    const v = doc.views.find((x) => x.id === d.view);
    const g = v && dataOf(ctx, v);
    if (!v || !g) continue;
    dimPrims(ctx, d, v, g, out);
  }
  for (const b of doc.balloons) {
    const v = doc.views.find((x) => x.id === b.view);
    const g = v && dataOf(ctx, v);
    if (!v || !g) continue;
    const P = placer(doc, v, g);
    const at = P(b.at[0], b.at[1]);
    const tag: Tag = { id: b.id, kind: 'balloon' };
    out.push({ t: 'poly', pts: [at[0], at[1], b.pos[0], b.pos[1]], w: W.thin, layer: 'dim', tag });
    out.push({ t: 'circle', c: at, r: 0.6, w: W.thin, layer: 'dim', tag });
    out.push({ t: 'circle', c: b.pos, r: 4.5, w: W.med, layer: 'dim', tag });
    out.push({ t: 'text', x: b.pos[0], y: b.pos[1] + 1.3, s: String(b.n), size: 3.5, anchor: 'middle', rot: 0, layer: 'text', tag });
  }
  for (const n of doc.notes) {
    const tag: Tag = { id: n.id, kind: 'note' };
    n.text.split('\n').forEach((line, i) => out.push({ t: 'text', x: n.pos[0], y: n.pos[1] + i * 4.6, s: line, size: 3.5, anchor: 'start', rot: 0, layer: 'text', tag }));
    if (n.leader) {
      out.push({ t: 'poly', pts: [n.pos[0] - 1, n.pos[1] - 1.2, n.leader[0], n.leader[1]], w: W.thin, layer: 'dim', tag });
      arrow(out, n.leader, [n.pos[0] - 1 - n.leader[0], n.pos[1] - 1.2 - n.leader[1]], tag);
    }
  }
  if (doc.bom.show && ctx.bom && ctx.bom.length) bomTable(ctx, out, sw - m, sh - m);
  return out;
}

function viewPrims(ctx: RenderCtx, v: DView, g: ViewData, out: Prim[]): void {
  const { doc } = ctx;
  const P = placer(doc, v, g);
  const tag: Tag = { id: v.id, kind: 'view' };
  const clip = v.kind === 'detail' && v.circle ? v.circle : null;
  for (const l of shownLines(g, v)) {
    const layer: Layer = l.k === 'h' ? 'hatch' : l.k === 't' ? 'thin' : l.v ? 'visible' : 'hidden';
    const w = layer === 'visible' ? W.thick : W.thin;
    const dash = layer === 'hidden' ? DASH_HID : undefined;
    const pieces = clip ? clipToCircle(l.p, clip.c, clip.r) : [l.p];
    for (const p of pieces) {
      const pts: number[] = [];
      for (let i = 0; i < p.length; i += 2) { const q = P(p[i], p[i + 1]); pts.push(q[0], q[1]); }
      out.push({ t: 'poly', pts, w, layer, ...(dash ? { dash } : {}), tag });
    }
  }
  if (clip) out.push({ t: 'circle', c: v.pos, r: clip.r * scaleOf(doc, v), w: W.med, layer: 'visible', tag });
  if (v.centerlines) centerMarks(ctx, v, g, P, out, tag);
  if (v.showLabel) {
    const b = viewBox(doc, v, g);
    const below = ctx.doc.dims.some((d) => d.view === v.id && d.kind === 'linear' && d.orient !== 'v' && d.offset >= 0);
    out.push({ t: 'text', x: (b.x0 + b.x1) / 2, y: b.y1 + (below ? 21 : 9), s: viewLabel(doc, v), size: 4, anchor: 'middle', rot: 0, bold: true, layer: 'text', tag: { id: v.id, kind: 'label' } });
  }
}

function centerMarks(ctx: RenderCtx, v: DView, g: ViewData, P: (u: number, w: number) => V2, out: Prim[], tag: Tag): void {
  const s = scaleOf(ctx.doc, v);
  const seen = new Set<string>();
  const edges = new Set<number>();
  for (const l of shownLines(g, v)) if (l.v && l.e !== undefined && l.k === 'e') edges.add(l.e);
  for (const e of edges) {
    const sh = edgeShape(g, e);
    if (!sh || sh.kind !== 'circle' || !sh.full) continue;
    const key = `${sh.c[0].toFixed(3)},${sh.c[1].toFixed(3)},${sh.r.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = P(sh.c[0], sh.c[1]);
    const r = sh.r * s;
    if (r < 0.8) continue;
    if (v.kind === 'detail' && v.circle && Math.hypot(sh.c[0] - v.circle.c[0], sh.c[1] - v.circle.c[1]) + sh.r > v.circle.r) continue;
    const ext = r * 1.25 + 1.5;
    out.push({ t: 'poly', pts: [c[0] - ext, c[1], c[0] + ext, c[1]], w: W.thin, layer: 'center', dash: DASH_CEN, tag });
    out.push({ t: 'poly', pts: [c[0], c[1] - ext, c[0], c[1] + ext], w: W.thin, layer: 'center', dash: DASH_CEN, tag });
  }
}

function cutLine(ctx: RenderCtx, v: DView, out: Prim[]): void {
  const { doc } = ctx;
  const p = doc.views.find((x) => x.id === v.parent);
  const g = p && ctx.data[p.id];
  if (!p || !g || !v.cut) return;
  const P = placer(doc, p, g);
  const pad = 6;
  const tag: Tag = { id: v.id, kind: 'view' };
  let a: V2, b: V2, look: V2;
  if (v.cut.dir === 'v') { a = P(v.cut.at, g.min[1]); b = P(v.cut.at, g.max[1]); a[1] += pad; b[1] -= pad; look = [1, 0]; }
  else { a = P(g.min[0], v.cut.at); b = P(g.max[0], v.cut.at); a[0] -= pad; b[0] += pad; look = [0, -1]; }
  const t: V2 = [b[0] - a[0], b[1] - a[1]]; const L = Math.hypot(...t) || 1; const u: V2 = [t[0] / L, t[1] / L];
  const end = 12;
  out.push({ t: 'poly', pts: [a[0], a[1], a[0] + u[0] * end, a[1] + u[1] * end], w: W.thick, layer: 'center', tag });
  out.push({ t: 'poly', pts: [b[0], b[1], b[0] - u[0] * end, b[1] - u[1] * end], w: W.thick, layer: 'center', tag });
  out.push({ t: 'poly', pts: [a[0] + u[0] * end, a[1] + u[1] * end, b[0] - u[0] * end, b[1] - u[1] * end], w: W.thin, layer: 'center', dash: DASH_CEN, tag });
  for (const e of [a, b]) {
    const tip: V2 = [e[0] + look[0] * 6, e[1] + look[1] * 6];
    out.push({ t: 'poly', pts: [e[0], e[1], tip[0], tip[1]], w: W.med, layer: 'visible', tag });
    arrow(out, tip, [-look[0], -look[1]], tag, 3.5);
    out.push({ t: 'text', x: tip[0] + look[0] * 3 + (look[1] !== 0 ? 0 : 0), y: tip[1] + look[1] * 4 + 1.4, s: v.cut.letter, size: 4, anchor: 'middle', rot: 0, bold: true, layer: 'text', tag });
  }
}

function detailCircle(ctx: RenderCtx, v: DView, out: Prim[]): void {
  const { doc } = ctx;
  const p = doc.views.find((x) => x.id === v.parent);
  const g = p && ctx.data[p.id];
  if (!p || !g || !v.circle) return;
  const P = placer(doc, p, g);
  const c = P(v.circle.c[0], v.circle.c[1]);
  const r = v.circle.r * scaleOf(doc, p);
  out.push({ t: 'circle', c, r, w: W.thin, layer: 'thin', tag: { id: v.id, kind: 'view' } });
  out.push({ t: 'text', x: c[0] + r * 0.75, y: c[1] - r * 0.75 - 1, s: v.circle.letter, size: 4, anchor: 'start', rot: 0, bold: true, layer: 'text', tag: { id: v.id, kind: 'view' } });
}

// ---- dimensions -----------------------------------------------------------------------------------------------------------
function arrow(out: Prim[], tip: V2, back: V2, tag: Tag | undefined, len = 3): void {
  const L = Math.hypot(back[0], back[1]) || 1;
  const bx = back[0] / L, by = back[1] / L;
  const w = len / 6;
  out.push({ t: 'poly', pts: [tip[0], tip[1], tip[0] + bx * len - by * w, tip[1] + by * len + bx * w, tip[0] + bx * len + by * w, tip[1] + by * len - bx * w], closed: true, fill: true, w: 0.05, layer: 'dim', tag });
}

/** Text of a dimension, measured from the view data. */
export function dimMeasure(d: DDim, doc: DrawingDoc, ctx?: RenderCtx): string {
  const u = doc.sheet.units;
  if (d.kind === 'linear' && d.b) {
    const dx = d.b[0] - d.a[0], dy = d.b[1] - d.a[1];
    const L = d.orient === 'h' ? Math.abs(dx) : d.orient === 'v' ? Math.abs(dy) : Math.hypot(dx, dy);
    return fmtLength(L, u);
  }
  if (d.kind === 'diameter') return 'Ø' + fmtLength((d.r ?? 0) * 2, u);
  if (d.kind === 'radial') return 'R' + fmtLength(d.r ?? 0, u);
  if (d.kind === 'angular' && d.b && d.c) {
    const a1 = Math.atan2(d.b[1] - d.a[1], d.b[0] - d.a[0]), a2 = Math.atan2(d.c[1] - d.a[1], d.c[0] - d.a[0]);
    let da = Math.abs(a2 - a1); if (da > Math.PI) da = 2 * Math.PI - da;
    return fmtAngle(da);
  }
  if (d.kind === 'callout') return (d.feature && ctx?.callout?.(d.feature)) || 'Ø' + fmtLength((d.r ?? 0) * 2, u);
  return '';
}

function dimPrims(ctx: RenderCtx, d0: DDim, v: DView, g: ViewData, out: Prim[]): void {
  const { doc } = ctx;
  const d = d0;
  const P = placer(doc, v, g);
  const s = scaleOf(doc, v);
  const tag: Tag = { id: d.id, kind: 'dim' };
  const text = dimText(dimMeasure(d, doc, ctx), d.text);
  const tsz = 3.5;
  if (d.kind === 'linear' && d.b) {
    const A = P(d.a[0], d.a[1]), B = P(d.b[0], d.b[1]);
    let n: V2, lineA: V2, lineB: V2;
    if (d.orient === 'h') {
      const y = (d.offset >= 0 ? Math.max(A[1], B[1]) : Math.min(A[1], B[1])) + d.offset;
      n = [0, d.offset >= 0 ? 1 : -1]; lineA = [A[0], y]; lineB = [B[0], y];
    } else if (d.orient === 'v') {
      const x = (d.offset >= 0 ? Math.max(A[0], B[0]) : Math.min(A[0], B[0])) + d.offset;
      n = [d.offset >= 0 ? 1 : -1, 0]; lineA = [x, A[1]]; lineB = [x, B[1]];
    } else {
      const t: V2 = [B[0] - A[0], B[1] - A[1]]; const L = Math.hypot(...t) || 1;
      n = [-t[1] / L, t[0] / L]; if (d.offset < 0) n = [-n[0], -n[1]];
      const o = Math.abs(d.offset);
      lineA = [A[0] + n[0] * o, A[1] + n[1] * o]; lineB = [B[0] + n[0] * o, B[1] + n[1] * o];
    }
    for (const [P0, P1] of [[A, lineA], [B, lineB]] as Array<[V2, V2]>) {
      const e: V2 = [P1[0] - P0[0], P1[1] - P0[1]]; const L = Math.hypot(...e) || 1;
      out.push({ t: 'poly', pts: [P0[0] + (e[0] / L) * 1, P0[1] + (e[1] / L) * 1, P1[0] + (e[0] / L) * 2, P1[1] + (e[1] / L) * 2], w: W.thin, layer: 'dim', tag });
    }
    out.push({ t: 'poly', pts: [lineA[0], lineA[1], lineB[0], lineB[1]], w: W.thin, layer: 'dim', tag });
    const t: V2 = [lineB[0] - lineA[0], lineB[1] - lineA[1]]; const L = Math.hypot(...t) || 1; const u: V2 = [t[0] / L, t[1] / L];
    arrow(out, lineA, u, tag); arrow(out, lineB, [-u[0], -u[1]], tag);
    let ang = Math.atan2(u[1], u[0]) * 180 / Math.PI;
    if (ang > 90 || ang <= -90) ang += ang > 0 ? -180 : 180;
    const mid: V2 = [(lineA[0] + lineB[0]) / 2, (lineA[1] + lineB[1]) / 2];
    const rad = ang * Math.PI / 180;
    const nx = Math.sin(rad), ny = -Math.cos(rad);        // text sits on the side of the line the view is not on
    out.push({ t: 'text', x: mid[0] + nx * 1.4, y: mid[1] + ny * 1.4, s: text, size: tsz, anchor: 'middle', rot: ang, layer: 'text', tag });
    return;
  }
  if ((d.kind === 'diameter' || d.kind === 'radial' || d.kind === 'callout') && d.r !== undefined) {
    const C = P(d.a[0], d.a[1]);
    const r = d.r * s;
    const a = d.angle ?? Math.PI / 4;
    const dir: V2 = [Math.cos(a), -Math.sin(a)];
    const edge: V2 = [C[0] + dir[0] * r, C[1] + dir[1] * r];
    const far: V2 = [C[0] + dir[0] * (r + Math.max(6, d.offset)), C[1] + dir[1] * (r + Math.max(6, d.offset))];
    const start: V2 = d.kind === 'diameter' ? [C[0] - dir[0] * r, C[1] - dir[1] * r] : edge;
    const shelf = dir[0] >= 0 ? 6 : -6;
    out.push({ t: 'poly', pts: [d.kind === 'diameter' ? start[0] : edge[0], d.kind === 'diameter' ? start[1] : edge[1], far[0], far[1], far[0] + shelf, far[1]], w: W.thin, layer: 'dim', tag });
    arrow(out, edge, [-dir[0], -dir[1]], tag);
    if (d.kind === 'diameter') arrow(out, start, dir, tag);
    const lines = text.split('\n');
    lines.forEach((ln, i) => out.push({ t: 'text', x: far[0] + shelf + (shelf > 0 ? 1 : -1), y: far[1] + 1.2 + i * 4.4, s: ln, size: tsz, anchor: shelf > 0 ? 'start' : 'end', rot: 0, layer: 'text', tag }));
    return;
  }
  if (d.kind === 'angular' && d.b && d.c) {
    const V = P(d.a[0], d.a[1]), B = P(d.b[0], d.b[1]), Cc = P(d.c[0], d.c[1]);
    const a1 = Math.atan2(V[1] - B[1], B[0] - V[0]), a2 = Math.atan2(V[1] - Cc[1], Cc[0] - V[0]);
    let d1 = a2 - a1; while (d1 > Math.PI) d1 -= 2 * Math.PI; while (d1 < -Math.PI) d1 += 2 * Math.PI;
    const R = Math.abs(d.offset) + 6;
    const lo = Math.min(a1, a1 + d1), hi = Math.max(a1, a1 + d1);
    out.push({ t: 'arc', c: V, r: R, a0: lo, a1: hi, w: W.thin, layer: 'dim', tag });
    for (const [aa, sgn] of [[a1, d1 >= 0 ? 1 : -1], [a1 + d1, d1 >= 0 ? -1 : 1]] as Array<[number, number]>) {
      const tip: V2 = [V[0] + Math.cos(aa) * R, V[1] - Math.sin(aa) * R];
      arrow(out, tip, [Math.sin(aa) * sgn, Math.cos(aa) * sgn], tag);
    }
    const mid = a1 + d1 / 2;
    out.push({ t: 'text', x: V[0] + Math.cos(mid) * (R + 3), y: V[1] - Math.sin(mid) * (R + 3), s: text, size: tsz, anchor: 'middle', rot: 0, layer: 'text', tag });
  }
}

// ---- title block, BOM -----------------------------------------------------------------------------------------------------
function titleBlock(ctx: RenderCtx, out: Prim[], right: number, bottom: number): void {
  const { doc } = ctx;
  const t = doc.title;
  const [sw] = sheetSize(doc.sheet);
  const w = Math.min(180, sw - 2 * doc.sheet.margin), h = 40, x0 = right - w, y0 = bottom - h;
  const tag: Tag = { id: 'title', kind: 'title' };
  out.push({ t: 'poly', pts: [x0, y0, right, y0, right, bottom, x0, bottom], closed: true, w: 0.5, layer: 'border', tag });
  const rows = [10, 20, 30];
  for (const y of rows) out.push({ t: 'poly', pts: [x0, y0 + y, right, y0 + y], w: W.med, layer: 'border', tag });
  const cw = w / 3;
  for (const r of [1, 2, 3]) for (const c of [1, 2]) out.push({ t: 'poly', pts: [x0 + cw * c, y0 + r * 10 - (r === 1 ? 0 : 0), x0 + cw * c, y0 + r * 10 + 10], w: W.med, layer: 'border', tag });
  const cell = (c: number, r: number, label: string, value: string, span = 1, big = false) => {
    out.push({ t: 'text', x: x0 + cw * c + 1.2, y: y0 + r * 10 + 3, s: label.toUpperCase(), size: 2, anchor: 'start', rot: 0, layer: 'text', tag });
    out.push({ t: 'text', x: x0 + cw * c + 1.5, y: y0 + r * 10 + 8, s: fit(value, (cw * span - 3) / (big ? 2.4 : 1.9)), size: big ? 5 : 3.5, anchor: 'start', rot: 0, bold: big, layer: 'text', tag });
  };
  cell(0, 0, 'Title', t.title, 3, true);
  cell(0, 1, 'Part number', t.partNo); cell(1, 1, 'Revision', t.revision); cell(2, 1, 'Scale', doc.sheet.scale);
  cell(0, 2, 'Material', t.material); cell(1, 2, 'Mass', t.mass); cell(2, 2, 'Date', t.date);
  cell(0, 3, 'Author', t.author); cell(1, 3, 'Company', t.company); cell(2, 3, 'Sheet', '1 / 1');
  // the title row spans all three columns: remove its inner dividers by overdrawing nothing; dividers start at row 1
}
const fit = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, Math.max(1, Math.floor(n) - 1)) + '…');

function bomTable(ctx: RenderCtx, out: Prim[], right: number, bottom: number): void {
  const rows = ctx.bom!;
  const cols = [10, 62, 12, 32, 24];
  const w = cols.reduce((a, b) => a + b, 0), rh = 6;
  const x0 = right - w, yb = bottom - 40;
  const tag: Tag = { id: 'bom', kind: 'bom' };
  const y0 = yb - rh * (rows.length + 1);
  out.push({ t: 'poly', pts: [x0, y0, right, y0, right, yb, x0, yb], closed: true, w: 0.5, layer: 'border', tag });
  for (let r = 1; r <= rows.length; r++) out.push({ t: 'poly', pts: [x0, y0 + rh * r, right, y0 + rh * r], w: W.med, layer: 'border', tag });
  let x = x0;
  cols.forEach((c, i) => { if (i) out.push({ t: 'poly', pts: [x, y0, x, yb], w: W.med, layer: 'border', tag }); x += c; });
  const head = ['No.', 'Part', 'Qty', 'Material', 'Mass (g)'];
  const put = (r: number, vals: string[]) => { let xx = x0; vals.forEach((s, i) => { out.push({ t: 'text', x: xx + 1.2, y: y0 + rh * r + 4.2, s: fit(s, cols[i] / 1.9), size: 3, anchor: 'start', rot: 0, bold: r === 0, layer: 'text', tag }); xx += cols[i]; }); };
  put(0, head);
  rows.forEach((b, i) => put(i + 1, [String(b.no), b.part, String(b.qty), b.material, b.mass]));
}

// ---- outputs --------------------------------------------------------------------------------------------------------------
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number): string => String(+n.toFixed(3));
const COLOR = { ink: '#111', hid: '#444' };

export function toSvg(prims: Prim[], size: V2, opts: { interactive?: boolean; selected?: string | null } = {}): string {
  const body: string[] = [];
  const attr = (p: Prim): string => {
    const tg = p.tag && opts.interactive ? ` data-id="${esc(p.tag.id)}" data-kind="${p.tag.kind}"` : '';
    return tg + (p.tag && opts.selected && p.tag.id === opts.selected ? ' class="sel"' : '');
  };
  for (const p of prims) {
    if (p.t === 'poly') {
      const pts = p.pts.map(num).join(' ');
      const d = p.dash ? ` stroke-dasharray="${p.dash.join(' ')}"` : '';
      if (p.fill) body.push(`<polygon points="${pts}" fill="${COLOR.ink}" stroke="none"${attr(p)}/>`);
      else body.push(`<${p.closed ? 'polygon' : 'polyline'} points="${pts}" fill="none" stroke="${p.layer === 'hidden' ? COLOR.hid : COLOR.ink}" stroke-width="${p.w}"${d} stroke-linecap="round" stroke-linejoin="round"${attr(p)}/>`);
    } else if (p.t === 'circle') {
      body.push(`<circle cx="${num(p.c[0])}" cy="${num(p.c[1])}" r="${num(p.r)}" fill="none" stroke="${COLOR.ink}" stroke-width="${p.w}"${attr(p)}/>`);
    } else if (p.t === 'arc') {
      const sx = p.c[0] + Math.cos(p.a0) * p.r, sy = p.c[1] - Math.sin(p.a0) * p.r, ex = p.c[0] + Math.cos(p.a1) * p.r, ey = p.c[1] - Math.sin(p.a1) * p.r;
      body.push(`<path d="M${num(sx)} ${num(sy)}A${num(p.r)} ${num(p.r)} 0 ${p.a1 - p.a0 > Math.PI ? 1 : 0} 0 ${num(ex)} ${num(ey)}" fill="none" stroke="${COLOR.ink}" stroke-width="${p.w}"${attr(p)}/>`);
    } else {
      const tr = p.rot ? ` transform="rotate(${num(p.rot)} ${num(p.x)} ${num(p.y)})"` : '';
      body.push(`<text x="${num(p.x)}" y="${num(p.y)}" font-size="${p.size}" text-anchor="${p.anchor}" font-family="Helvetica, Arial, sans-serif"${p.bold ? ' font-weight="bold"' : ''} fill="${COLOR.ink}"${tr}${attr(p)}>${esc(p.s)}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(size[0])} ${num(size[1])}" width="${num(size[0])}mm" height="${num(size[1])}mm"><rect width="${num(size[0])}" height="${num(size[1])}" fill="#fff"/>${body.join('')}</svg>`;
}

/** Re-anchor the dimensions of a drawing on fresh view data; those whose edges are gone stay as they were (and are reported). */
export function refreshDims(doc: DrawingDoc, data: Record<string, ViewData | undefined>): { dims: DDim[]; lost: string[] } {
  const lost: string[] = [];
  const dims = doc.dims.map((d) => {
    const v = doc.views.find((x) => x.id === d.view);
    const g = v && (v.kind === 'detail' && v.parent ? data[v.parent] : data[v.id]);
    if (!g || !d.refs?.length) return d;
    const nd = refreshDim(d, g);
    if (!nd) { lost.push(d.id); return d; }
    return nd;
  });
  return { dims, lost };
}
export { viewCentre };
