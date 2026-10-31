/**
 * Where each dimension of a sketch is drawn so that nothing lies on anything else. Pure: it works in the screen's own units (pixels), given the
 * view's projection of the sketch plane, and returns for every dimension the drawing (in sketch coordinates), where its label sits and whether it
 * is shown. The app draws what it returns (`SketchAnnotations`); the density setting and the hover rule only decide which dimensions come in.
 *
 * Order: the longest dimensions are placed first and keep the first level; a shorter one tries level 1 to 4 (26 px steps) on one side of its
 * geometry, then on the other, and takes the first place where its label (an oriented rectangle) touches no placed label, no arrowhead, no hit zone
 * of another segment of the sketch and nothing outside the view or over its controls. A segment shorter on screen than its label gets the text
 * outside the extension lines with a short leader (the usual CAD way). When every place is taken the label is hidden (shown again while one of the
 * things it measures is hovered or selected) instead of being drawn over others.
 */
import type { SketchDraft, DraftEntity } from './index';
import { dimensionShape, measuredLength, type Annotation, type DimShape } from './annotations';
import { bsplineCurve, fitCurve } from './tools/splineMath';
import type { Pt } from './tools/types';

export type DimDisplay = 'all' | 'driving' | 'selected';
export const DIM_DISPLAYS: readonly DimDisplay[] = ['all', 'driving', 'selected'];

export interface PxRect { x: number; y: number; w: number; h: number }
export type ToPx = (u: number, v: number) => { x: number; y: number } | null;

/** An oriented rectangle: centre, half sizes along its own axes, angle in radians. */
export interface Obb { x: number; y: number; hw: number; hh: number; a: number }

/** One dimension line level, in pixels. */
export const LEVEL_PX = 26;
export const MAX_LEVEL = 6;
const MARGIN = 2;          // clear space around a label
const ZONE = 4;            // a segment's hit zone: this far each side of the curve

const corners = (o: Obb): Pt[] => {
  const c = Math.cos(o.a), s = Math.sin(o.a);
  return [[-o.hw, -o.hh], [o.hw, -o.hh], [o.hw, o.hh], [-o.hw, o.hh]].map(([x, y]) => ({ x: o.x + x * c - y * s, y: o.y + x * s + y * c }));
};

/** Do two oriented rectangles overlap (separating axis test)? */
export function obbOverlap(p: Obb, q: Obb): boolean {
  if (Math.hypot(p.x - q.x, p.y - q.y) > Math.hypot(p.hw, p.hh) + Math.hypot(q.hw, q.hh)) return false;
  const cp = corners(p), cq = corners(q);
  for (const o of [p, q]) {
    for (const ang of [o.a, o.a + Math.PI / 2]) {
      const ax = Math.cos(ang), ay = Math.sin(ang);
      const proj = (cs: Pt[]) => { const d = cs.map((c) => c.x * ax + c.y * ay); return [Math.min(...d), Math.max(...d)]; };
      const [a0, a1] = proj(cp), [b0, b1] = proj(cq);
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

/** A segment as a thin oriented rectangle (its hit zone). */
export const segmentObb = (a: Pt, b: Pt, half = ZONE): Obb => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, hw: Math.hypot(b.x - a.x, b.y - a.y) / 2 + half, hh: half, a: Math.atan2(b.y - a.y, b.x - a.x) });

const inside = (o: Obb, r: PxRect): boolean => corners(o).every((c) => c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h);
const meets = (o: Obb, r: PxRect): boolean => obbOverlap(o, { x: r.x + r.w / 2, y: r.y + r.h / 2, hw: r.w / 2, hh: r.h / 2, a: 0 });

export interface PlacedDim {
  id: string;
  text: string;
  driven: boolean;
  /** The drawing, in sketch coordinates, at the chosen level and side; null for a dimension without one (a plain label). */
  shape: DimShape | null;
  /** The label on screen: centre, reading angle (degrees, -90..90, never upside down), size. */
  label: { x: number; y: number; slopeDeg: number; w: number; h: number };
  /** The measured segment is shorter than its label: the text sits outside the extension lines (arrowheads point inward). */
  outside: boolean;
  level: number;
  side: 1 | -1;
  /** Not drawn (no free place, or the display setting): shown while hovered / selected when `peek`. */
  hidden: boolean;
  peek: boolean;
}

export interface LayoutOptions {
  to: ToPx;
  /** The drawing area in pixels: labels stay inside it. */
  viewport: { w: number; h: number };
  /** Controls over the drawing area (Display, the view cube ...). */
  keepOut?: PxRect[];
  display?: DimDisplay;
  /** Ids (entities and points) that are selected or under the pointer. */
  focus?: ReadonlySet<string>;
  /** The Dimension tool is active: every dimension is wanted. */
  dimensionTool?: boolean;
  /** Right angles as a square corner mark (default on). */
  squareRight?: boolean;
  /** Label size for a text (px). */
  measure?: (text: string) => { w: number; h: number };
}

export const labelSize = (text: string): { w: number; h: number } => ({ w: text.length * 7 + 14, h: 20 });

/** Sampled screen polyline of an entity (lines, arcs, circles, splines), for its hit zones. */
function entityPolyline(draft: SketchDraft, e: DraftEntity, to: ToPx): Pt[] | null {
  const pts = new Map(draft.points.map((p) => [p.id, { x: p.x, y: p.y }]));
  const at = (id: unknown) => pts.get(String(id));
  let q: Pt[] = [];
  if (e.type === 'line') { const a = at(e.p1), b = at(e.p2); if (a && b) q = [a, b]; }
  else if (e.type === 'circle') { const c = at(e.c); const r = Number(e.r); if (c && r > 0) q = Array.from({ length: 33 }, (_, i) => ({ x: c.x + r * Math.cos((i * Math.PI) / 16), y: c.y + r * Math.sin((i * Math.PI) / 16) })); }
  else if (e.type === 'arc') {
    const c = at(e.c), p1 = at(e.p1), p2 = at(e.p2);
    if (c && p1 && p2) {
      const r = Math.hypot(p1.x - c.x, p1.y - c.y), a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
      let sw = Math.atan2(p2.y - c.y, p2.x - c.x) - a0; sw = ((sw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      q = Array.from({ length: 25 }, (_, i) => ({ x: c.x + r * Math.cos(a0 + (sw * i) / 24), y: c.y + r * Math.sin(a0 + (sw * i) / 24) }));
    }
  } else if ((e.type === 'spline' || e.type === 'cvspline') && Array.isArray(e.pts)) {
    const ps = (e.pts as unknown[]).map(at).filter((p): p is Pt => !!p);
    if (ps.length >= 2) q = e.type === 'spline' ? fitCurve(ps, e.closed === true, 8) : bsplineCurve(ps, Number(e.degree ?? 3), e.closed === true, 48);
  }
  const out = q.map((p) => to(p.x, p.y));
  return out.every((p) => p) ? (out as Pt[]) : null;
}

/** The ids of the entities a dimension measures (its own geometry has no hit zone against its label). */
function ownEntities(draft: SketchDraft, refs: string[]): Set<string> {
  const own = new Set<string>();
  for (const r of refs) {
    if (draft.entities.some((e) => e.id === r)) own.add(r);
    else for (const e of draft.entities) if (refs.length === 2 && refs.every((x) => x === e.p1 || x === e.p2 || x === e.c)) own.add(e.id);
  }
  return own;
}

export function layoutDimensions(draft: SketchDraft, anns: Annotation[], o: LayoutOptions): PlacedDim[] {
  const measure = o.measure ?? labelSize;
  const display = o.display ?? 'all';
  const focus = o.focus ?? new Set<string>();
  const s = (() => { const a = o.to(0, 0), b = o.to(1, 0); return a && b ? Math.hypot(b.x - a.x, b.y - a.y) || 1 : 1; })();   // pixels per sketch unit
  const upp = 1 / s;
  const view: PxRect = { x: 4, y: 4, w: o.viewport.w - 8, h: o.viewport.h - 8 };
  const keepOut = o.keepOut ?? [];

  // hit zones of every curve, by entity
  const zones: Array<{ id: string; obb: Obb }> = [];
  for (const e of draft.entities) {
    if (e.construction === true) continue;
    const poly = entityPolyline(draft, e, o.to);
    if (poly) for (let i = 1; i < poly.length; i++) if (Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y) > 1e-6) zones.push({ id: e.id, obb: segmentObb(poly[i - 1], poly[i]) });
  }

  type Item = { a: Annotation; priority: number; own: Set<string>; wanted: boolean; touches: boolean };
  const items: Item[] = anns.filter((a) => a.kind === 'dimension').map((a) => {
    const own = ownEntities(draft, a.refs);
    const touches = a.refs.some((r) => focus.has(r)) || [...own].some((r) => focus.has(r));
    const wanted = display === 'driving' ? !a.driven : display === 'selected' ? touches || o.dimensionTool === true : true;
    const len = a.value !== undefined ? measuredLength(draft, a.type, a.refs, a.value) : 0;
    return { a, priority: a.type === 'angle' ? len * 0.001 : len, own, wanted, touches };
  });
  items.sort((p, q) => q.priority - p.priority || (p.a.id < q.a.id ? -1 : 1));

  const labels: Obb[] = [];
  const arrows: Obb[] = [];
  const out: PlacedDim[] = [];
  const readable = (deg: number) => { let d = deg; while (d > 90 + 1e-9) d -= 180; while (d <= -90 - 1e-9) d += 180; return d; };

  for (const it of items) {
    const { a } = it;
    const size = measure(a.text);
    if (!it.wanted) { out.push({ id: a.id, text: a.text, driven: !!a.driven, shape: null, label: { x: 0, y: 0, slopeDeg: 0, ...size }, outside: false, level: 0, side: 1, hidden: true, peek: false }); continue; }
    const others = zones.filter((z) => !it.own.has(z.id));
    const candidates: Array<{ level: number; side: 1 | -1 }> = [];
    for (const side of [1, -1] as const) for (let level = 1; level <= MAX_LEVEL; level++) candidates.push({ level, side });

    const build = (level: number, side: 1 | -1) => {
      const shape = a.value !== undefined ? dimensionShape(draft, a.type, a.refs, a.value, { off: LEVEL_PX * upp, level, side, squareRight: o.squareRight !== false }) : null;
      let x: number, y: number, slope = 0, outside = false, line: [Pt, Pt] | null = null;
      if (shape) {
        const t = o.to(shape.text.x, shape.text.y);
        if (!t) return null;
        x = t.x; y = t.y;
        if (shape.kind === 'linear') {
          const p = o.to(shape.line[0].x, shape.line[0].y), q = o.to(shape.line[1].x, shape.line[1].y);
          if (!p || !q) return null;
          line = [p, q];
          slope = readable((Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI);
          const lenPx = Math.hypot(q.x - p.x, q.y - p.y);
          if (lenPx < size.w + 24) {          // too short for its label: the text goes beyond the end of the dimension line
            outside = true;
            const ux = (q.x - p.x) / (lenPx || 1), uy = (q.y - p.y) / (lenPx || 1);
            x = q.x + ux * (size.w / 2 + 16); y = q.y + uy * (size.w / 2 + 16);
          }
        } else if (shape.kind === 'leader') { /* the text sits at the leader's end */ }
      } else {
        const t = o.to(a.at.x, a.at.y);
        if (!t) return null;
        x = t.x; y = t.y - 16;
      }
      const rect: Obb = { x, y, hw: size.w / 2 + MARGIN, hh: size.h / 2 + MARGIN, a: (slope * Math.PI) / 180 };
      const arrowBoxes: Obb[] = [];
      if (shape) for (const ar of shape.arrows) {
        const t = o.to(ar.at.x, ar.at.y), h = o.to(ar.at.x + ar.dir.x * 1e-3, ar.at.y + ar.dir.y * 1e-3);
        if (t && h) { const d = Math.atan2(h.y - t.y, h.x - t.x); arrowBoxes.push({ x: t.x - Math.cos(d) * 4.5, y: t.y - Math.sin(d) * 4.5, hw: 5, hh: 4, a: d }); }
      }
      return { shape, rect, arrowBoxes, line, slope, outside, x, y };
    };
    const free = (b: NonNullable<ReturnType<typeof build>>): boolean => {
      if (!inside(b.rect, view)) return false;
      if (keepOut.some((k) => meets(b.rect, k))) return false;
      if (labels.some((l) => obbOverlap(b.rect, l))) return false;
      if (arrows.some((ar) => obbOverlap(b.rect, ar))) return false;
      if (others.some((z) => obbOverlap(b.rect, z.obb))) return false;
      // its own arrowheads and dimension line must not cross a placed label either
      if (b.arrowBoxes.some((ar) => labels.some((l) => obbOverlap(ar, l)))) return false;
      if (b.line && labels.some((l) => obbOverlap(segmentObb(b.line![0], b.line![1], 1), l))) return false;
      return true;
    };

    let chosen: { b: NonNullable<ReturnType<typeof build>>; level: number; side: 1 | -1 } | null = null;
    for (const c of candidates) {
      const b = build(c.level, c.side);
      if (b && free(b)) { chosen = { b, ...c }; break; }
      if (!a.shape && !b) break;
      if (!a.shape && c.level === 1 && c.side === 1) { if (b) chosen = { b, ...c }; break; }   // a plain label has one place
    }
    if (chosen) {
      labels.push(chosen.b.rect); arrows.push(...chosen.b.arrowBoxes);
      out.push({ id: a.id, text: a.text, driven: !!a.driven, shape: chosen.b.shape, label: { x: chosen.b.x, y: chosen.b.y, slopeDeg: chosen.b.slope, ...size }, outside: chosen.b.outside, level: chosen.level, side: chosen.side, hidden: false, peek: false });
    } else {
      // no free place: hidden, but drawn at the first level while its geometry is hovered or selected (over others, deliberately)
      const b = build(1, 1);
      out.push({ id: a.id, text: a.text, driven: !!a.driven, shape: b?.shape ?? null, label: { x: b?.x ?? 0, y: b?.y ?? 0, slopeDeg: b?.slope ?? 0, ...size }, outside: b?.outside ?? false, level: 1, side: 1, hidden: true, peek: it.touches });
    }
  }
  return out;
}
