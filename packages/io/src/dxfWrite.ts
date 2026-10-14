// DXF R12 (AC1009) ASCII writer: the oldest revision every CAD, CAM and laser package still reads. R12 has no LWPOLYLINE
// or ELLIPSE, so polylines are POLYLINE / VERTEX / SEQEND and curves that are not lines, arcs or circles are sampled.
import { bsplineCurve, fitCurve } from '@kit/sketch';

export interface DxfLayerDef { name: string; /** AutoCAD colour index */ color: number; linetype: 'CONTINUOUS' | 'DASHED' }
export type P2 = { x: number; y: number };

/** Fixed notation, at most 6 decimals, no exponent, no "-0". */
export const dxfNum = (v: number): string => {
  const s = (Math.abs(v) < 5e-7 ? 0 : v).toFixed(6);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

export class DxfBuilder {
  private readonly body: string[] = [];
  private readonly layers = new Map<string, DxfLayerDef>();
  private min = { x: Infinity, y: Infinity };
  private max = { x: -Infinity, y: -Infinity };
  count = 0;

  constructor(private readonly units = 4) {
    this.layer({ name: '0', color: 7, linetype: 'CONTINUOUS' });
  }

  layer(def: DxfLayerDef): void { this.layers.set(def.name, def); }

  private pair(code: number, value: string | number): void { this.body.push(String(code), typeof value === 'number' ? dxfNum(value) : value); }
  private grow(x: number, y: number): void {
    this.min.x = Math.min(this.min.x, x); this.min.y = Math.min(this.min.y, y);
    this.max.x = Math.max(this.max.x, x); this.max.y = Math.max(this.max.y, y);
  }
  private head(type: string, layer: string): void {
    this.pair(0, type);
    this.pair(8, layer);
    const def = this.layers.get(layer);
    // the layer's own line type applies (BYLAYER), no per-entity override
    if (!def) throw new Error(`unknown layer ${layer}`);
    this.count++;
  }

  line(layer: string, a: P2, b: P2): void {
    this.head('LINE', layer);
    this.pair(10, a.x); this.pair(20, a.y); this.pair(30, 0);
    this.pair(11, b.x); this.pair(21, b.y); this.pair(31, 0);
    this.grow(a.x, a.y); this.grow(b.x, b.y);
  }
  circle(layer: string, c: P2, r: number): void {
    this.head('CIRCLE', layer);
    this.pair(10, c.x); this.pair(20, c.y); this.pair(30, 0); this.pair(40, r);
    this.grow(c.x - r, c.y - r); this.grow(c.x + r, c.y + r);
  }
  /** Counter-clockwise arc from `a0` to `a1` degrees. */
  arc(layer: string, c: P2, r: number, a0: number, a1: number): void {
    this.head('ARC', layer);
    this.pair(10, c.x); this.pair(20, c.y); this.pair(30, 0); this.pair(40, r);
    this.pair(50, a0); this.pair(51, a1);
    this.grow(c.x - r, c.y - r); this.grow(c.x + r, c.y + r);
  }
  point(layer: string, p: P2): void {
    this.head('POINT', layer);
    this.pair(10, p.x); this.pair(20, p.y); this.pair(30, 0);
    this.grow(p.x, p.y);
  }
  polyline(layer: string, pts: P2[], closed: boolean): void {
    this.head('POLYLINE', layer);
    this.pair(66, 1);
    this.pair(10, 0); this.pair(20, 0); this.pair(30, 0);
    this.pair(70, closed ? 1 : 0);
    for (const p of pts) {
      this.pair(0, 'VERTEX'); this.pair(8, layer);
      this.pair(10, p.x); this.pair(20, p.y); this.pair(30, 0);
      this.grow(p.x, p.y);
    }
    this.pair(0, 'SEQEND'); this.pair(8, layer);
  }

  toString(): string {
    const o: string[] = [];
    const add = (...v: Array<string | number>) => { v.forEach((x, i) => o.push(i % 2 === 0 ? String(x) : typeof x === 'number' ? dxfNum(x) : x)); };
    const empty = this.count === 0;
    const lo = empty ? { x: 0, y: 0 } : this.min, hi = empty ? { x: 0, y: 0 } : this.max;
    add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, this.units,
      9, '$EXTMIN', 10, lo.x, 20, lo.y, 30, 0, 9, '$EXTMAX', 10, hi.x, 20, hi.y, 30, 0, 0, 'ENDSEC');
    add(0, 'SECTION', 2, 'TABLES');
    add(0, 'TABLE', 2, 'LTYPE', 70, 2);
    add(0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0);
    add(0, 'LTYPE', 2, 'DASHED', 70, 0, 3, 'Dashed', 72, 65, 73, 2, 40, 6, 49, 4, 49, -2);
    add(0, 'ENDTAB');
    add(0, 'TABLE', 2, 'LAYER', 70, this.layers.size);
    for (const l of this.layers.values()) add(0, 'LAYER', 2, l.name, 70, 0, 62, l.color, 6, l.linetype);
    add(0, 'ENDTAB', 0, 'ENDSEC');
    add(0, 'SECTION', 2, 'ENTITIES');
    o.push(...this.body);
    add(0, 'ENDSEC', 0, 'EOF');
    return o.join('\n') + '\n';
  }
}

// ---- a sketch ----

export interface SketchLike {
  points: Array<{ id: string; x: number; y: number }>;
  entities: Array<{ id: string; type?: string; construction?: boolean; [k: string]: unknown }>;
}

export interface SketchDxfResult { text: string; entities: number; skipped: number; construction: number }

const deg = (r: number) => (r * 180) / Math.PI;
const norm360 = (a: number) => ((a % 360) + 360) % 360;
export const CONSTRUCTION_LAYER = 'CONSTRUCTION';

/** A sketch as DXF R12. Lines, circles, arcs and points stay exact; ellipses and splines are written as polylines sampled
 *  from the curve the kernel builds. Construction geometry goes to the CONSTRUCTION layer with a dashed line type. */
export function sketchToDxf(sketch: SketchLike): SketchDxfResult {
  const dxf = new DxfBuilder();
  dxf.layer({ name: CONSTRUCTION_LAYER, color: 5, linetype: 'DASHED' });
  const pts = new Map(sketch.points.map((p) => [p.id, { x: p.x, y: p.y }]));
  const at = (id: unknown): P2 | null => (typeof id === 'string' ? pts.get(id) ?? null : null);
  let skipped = 0, construction = 0;
  for (const e of sketch.entities) {
    const layer = e.construction ? CONSTRUCTION_LAYER : '0';
    let done = true;
    switch (e.type) {
      case 'line': {
        const a = at(e.p1), b = at(e.p2);
        if (a && b) dxf.line(layer, a, b); else done = false;
        break;
      }
      case 'circle': {
        const c = at(e.c);
        if (c && typeof e.r === 'number' && e.r > 0) dxf.circle(layer, c, e.r); else done = false;
        break;
      }
      case 'arc': {
        const c = at(e.c), a = at(e.p1), b = at(e.p2);
        if (!c || !a || !b) { done = false; break; }
        const r = Math.hypot(a.x - c.x, a.y - c.y);
        if (!(r > 0)) { done = false; break; }
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) dxf.circle(layer, c, r);   // an arc that closes on itself
        else dxf.arc(layer, c, r, norm360(deg(Math.atan2(a.y - c.y, a.x - c.x))), norm360(deg(Math.atan2(b.y - c.y, b.x - c.x))));
        break;
      }
      case 'ellipse': {
        const c = at(e.c), p = at(e.p);
        if (!c || !p || typeof e.r !== 'number' || !(e.r > 0)) { done = false; break; }
        const ux = p.x - c.x, uy = p.y - c.y, l = Math.hypot(ux, uy);
        if (!(l > 0)) { done = false; break; }
        const vx = (-uy / l) * e.r, vy = (ux / l) * e.r, out: P2[] = [];
        for (let i = 0; i < 72; i++) { const t = (2 * Math.PI * i) / 72; out.push({ x: c.x + ux * Math.cos(t) + vx * Math.sin(t), y: c.y + uy * Math.cos(t) + vy * Math.sin(t) }); }
        dxf.polyline(layer, out, true);
        break;
      }
      case 'point': {
        const p = at(e.p);
        if (p) dxf.point(layer, p); else done = false;
        break;
      }
      case 'spline':
      case 'cvspline': {
        const ctl = Array.isArray(e.pts) ? e.pts.map(at) : [];
        if (ctl.length < 2 || ctl.some((q) => !q)) { done = false; break; }
        const closed = e.closed === true;
        const through = ctl as P2[];
        const curve = e.type === 'spline' ? fitCurve(through, closed, 16) : bsplineCurve(through, typeof e.degree === 'number' ? e.degree : 3, closed, 64);
        if (curve.length < 2) { done = false; break; }
        dxf.polyline(layer, curve, closed && e.type === 'spline');
        break;
      }
      default: done = false;
    }
    if (done) { if (e.construction) construction++; } else skipped++;
  }
  return { text: dxf.toString(), entities: dxf.count, skipped, construction };
}

// ---- orthographic views of a body ----

export interface ViewsDxfOptions {
  /** Space between the views as a fraction of the larger part dimension (default 0.2, at least 5 mm). */
  gap?: number;
}
export interface ViewsDxfResult { text: string; entities: number; views: Array<'front' | 'top' | 'right'> }

type V3 = number[];
/** Sheet coordinates of a world point in each view. World is Y-up: front looks along -Z (u = X, v = Y), top looks down
 *  (u = X, v = -Z) and right looks along -X (u = -Z, v = Y), the same as the viewer's view buttons. */
export const VIEW_PROJECTION: Record<'front' | 'top' | 'right', (p: V3) => P2> = {
  front: (p) => ({ x: p[0], y: p[1] }),
  top: (p) => ({ x: p[0], y: -p[2] }),
  right: (p) => ({ x: -p[2], y: p[1] }),
};

const q = (v: number) => Math.round(v * 1e4);

/** The three orthographic views (front, top above it, right beside it: third-angle projection) of the body's edges.
 *  Edges seen end-on collapse to a line, and edges that land on top of each other (front and back of a box) are
 *  drawn once. Hidden lines are not drawn. */
export function viewsToDxf(edges: Array<{ pts: number[][] }>, box: { min: number[]; max: number[] }, opts: ViewsDxfOptions = {}): ViewsDxfResult {
  const dxf = new DxfBuilder();
  const size = [0, 1, 2].map((i) => Math.max(box.max[i] - box.min[i], 0));
  const gap = Math.max(Math.max(...size) * (opts.gap ?? 0.2), 5);
  // lower-left corner of each view's bounding rectangle, so every view sits on a common grid
  const ext = (name: 'front' | 'top' | 'right') => {
    const a = VIEW_PROJECTION[name]([box.min[0], box.min[1], box.min[2]]);
    const b = VIEW_PROJECTION[name]([box.max[0], box.max[1], box.max[2]]);
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  };
  const f = ext('front'), t = ext('top'), r = ext('right');
  const offset = {
    front: { x: 0, y: 0 },
    top: { x: 0, y: f.y1 + gap - t.y0 },                  // above the front view, same X
    right: { x: f.x1 + gap - r.x0, y: 0 },                // right of the front view, same Y
  };
  const views: Array<'front' | 'top' | 'right'> = ['front', 'top', 'right'];
  for (const name of views) {
    const seen = new Set<string>();
    for (const e of edges) {
      if (!e.pts || e.pts.length < 2) continue;
      let pts = e.pts.map((p) => VIEW_PROJECTION[name](p));
      pts = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1e-9);
      if (pts.length < 2) continue;
      // seen end-on: every point on one line, so keep just the extent of it
      const a = pts[0];
      const dir = pts.find((p) => Math.hypot(p.x - a.x, p.y - a.y) > 1e-6);
      if (!dir) continue;
      const len = Math.hypot(dir.x - a.x, dir.y - a.y);
      const nx = -(dir.y - a.y) / len, ny = (dir.x - a.x) / len;
      if (pts.every((p) => Math.abs((p.x - a.x) * nx + (p.y - a.y) * ny) < 1e-6)) {
        const s = pts.map((p) => ((p.x - a.x) * (dir.x - a.x) + (p.y - a.y) * (dir.y - a.y)) / len);
        const lo = Math.min(...s), hi = Math.max(...s);
        const ux = (dir.x - a.x) / len, uy = (dir.y - a.y) / len;
        pts = [{ x: a.x + ux * lo, y: a.y + uy * lo }, { x: a.x + ux * hi, y: a.y + uy * hi }];
      }
      const fwd = pts.map((p) => `${q(p.x)},${q(p.y)}`);
      const key = fwd.join(' '), rev = [...fwd].reverse().join(' ');
      if (seen.has(key) || seen.has(rev)) continue;
      seen.add(key);
      const o = offset[name];
      const placed = pts.map((p) => ({ x: p.x + o.x, y: p.y + o.y }));
      if (placed.length === 2) dxf.line('0', placed[0], placed[1]);
      else dxf.polyline('0', placed, false);
    }
  }
  return { text: dxf.toString(), entities: dxf.count, views };
}
