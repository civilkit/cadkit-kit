// The recorder: a fluent API whose calls are REMEMBERED (with the script line) and later compiled to EditOps by the runner.
// Selectors (face(), edges()) are resolved at compile time against the body as it is just before that step.
import { resolveEdges, resolveFace, SelectorError, type EdgeRule, type EdgeSel, type FaceSel, type Geometry } from './selectors';

export type EditOp = { op: 'add'; feature: Record<string, unknown>; index?: number };
export type Plane = 'front' | 'top' | 'right';
/** A standard plane moved along its normal (front: +z, top: +y, right: +x): a reference plane feature is added for it. */
export interface OffsetPlane { kind: 'offset'; plane: Plane; offset: Num }
/**
 * A standard plane moved along its normal, for a sketch on a workplane at a distance.
 *
 * at(plane, offset) returns a plane reference for sketch(): front moves along +Z, top along +Y, right along +X. A reference plane feature is added to the part. Use it to sketch above or below the origin without needing a face to select.
 * @domain sketch
 * @param plane the standard plane: front, top or right
 * @param offset distance along the plane normal in mm (a number or expr)
 * @example
 * part('Stack')
 *   .sketch('front', (s) => s.rect(40, 40)).extrude(5)
 *   .sketch(at('front', 20), (s) => s.circle(8)).extrude(5);
 * @see part.sketch
 */
export const at = (plane: Plane, offset: Num): OffsetPlane => ({ kind: 'offset', plane, offset });

/** A parameter written as an expression over the part's variables, e.g. expr('w/2'). */
export class Expr { constructor(public text: string, public value: number) {} valueOf(): number { return this.value; } }
export type Num = number | Expr;
const num = (n: Num): number => (n instanceof Expr ? n.value : n);
const ref = (n: Num): number | string => (n instanceof Expr ? `=${n.text}` : n);

export interface Ctx {
  geo: Geometry;
  nextId(): string;
  /** id of the sketch recorded last / the feature added last */
  lastSketch: string | null;
  lastFeature: string | null;
}
export interface Step { line: number; label: string; run(ctx: Ctx): EditOp[]; sk?: SketchBuilder }
export interface Recorded { name: string; variables: Array<{ name: string; expr: string }>; steps: Step[] }

/** The 1-based script line of the caller, from the stack of the evaluated function (see run.ts: sourceURL + header offset). */
let lineOffset = 2;
export const setLineOffset = (n: number): void => { lineOffset = n; };
export function callerLine(): number {
  const m = /kit-script:(\d+):\d+/.exec(new Error().stack ?? '');
  return m ? Math.max(1, Number(m[1]) - lineOffset) : 0;
}

/**
 * Select one planar face of the current body by direction: >X <X >Y <Y >Z <Z.
 *
 * face(sel) is resolved when the script runs, against the body as it is just before the step that uses it. '>Z' is the planar face whose outward normal is +Z and which lies furthest along +Z (ties: the biggest face). '#top' is '>Z' and '#bottom' is '<Z'. Only planar faces match; it fails with a line number when none does. Pass it to sketch(), hole(), holes.*, shell().
 * @domain selectors
 * @param sel one of '>X' '<X' '>Y' '<Y' '>Z' '<Z' '#top' '#bottom'
 * @example
 * part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10)
 *   .hole(face('>Z'), [0, 0], { diameter: 8 });
 * @see edges, part.sketch, part.hole, part.shell
 */
export const face = (sel: string): FaceSel => ({ kind: 'face', sel, line: callerLine() });
/**
 * Select edges of the current body by direction, extreme plane, or a rule object.
 *
 * edges(sel) is resolved against the body just before the step that uses it. Strings: 'all'; '|X' '|Y' '|Z' straight edges parallel to that axis; '>X' ... '<Z' edges lying in the extreme plane along that axis. A rule object ANDs its keys: parallel ('X'|'Y'|'Z'), outside / inside (box [[x0,y0,z0],[x1,y1,z1]] tested on the edge midpoint), not (another edges()), onFace (a face()), lengthGreater, lengthLess, near + within (radius), and union / intersect / difference (arrays of edges()). It fails with a line number when nothing matches.
 * @domain selectors
 * @param sel a selector string, or an EdgeRule object
 * @example
 * part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20)
 *   .fillet(edges('|Z'), 3)
 *   .chamfer(edges({ onFace: face('>Z') }), 1);
 * @see face, part.fillet, part.chamfer
 */
export const edges = (sel: string | EdgeRule): EdgeSel => ({ kind: 'edges', sel, line: callerLine() });
/**
 * End condition for cut(): through all material.
 *
 * through() is passed to cut() instead of a depth to cut all the way through the body, in the direction the cut goes (against the sketch normal).
 * @domain features
 * @example
 * part('Tube').sketch('front', (s) => s.circle(20)).extrude(30)
 *   .sketch(face('>Z'), (s) => s.circle(12)).cut(through());
 * @see part.cut
 */
export const through = (): { through: true } => ({ through: true });
export type EndSpec = Num | { through: true };

// ---- sketch ----
type Pt = [number, number];
const polarPts = (c: Pt, r: number, n: number, a0: number): Pt[] => Array.from({ length: n }, (_, i) => { const a = (a0 + (360 * i) / n) * Math.PI / 180; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Pt; });
const gridPts = (o: Pt, p: Pt, c: [number, number]): Pt[] => { const out: Pt[] = []; for (let j = 0; j < c[1]; j++) for (let i = 0; i < c[0]; i++) out.push([o[0] + i * p[0], o[1] + j * p[1]]); return out; };
export class SketchBuilder {
  pointList: Array<Record<string, unknown>> = [{ id: 'O', x: 0, y: 0, fixed: true }];
  entities: Array<Record<string, unknown>> = [];
  private np = 0;
  private ne = 0;
  axisId: string | null = null;
  private pt(x: number, y: number): string { const id = `p${++this.np}`; this.pointList.push({ id, x: +x.toFixed(6), y: +y.toFixed(6) }); return id; }
  private ent(e: Record<string, unknown>): void { this.entities.push({ id: `e${++this.ne}`, ...e }); }
  /**
   * Closed polygon through the points.
   *
   * Adds a closed profile of straight lines through the points, in order; the last point joins the first. Coordinates are in the sketch plane in mm. Use it for L, T, U shapes and for revolve profiles (half cross-section).
   * @domain sketch
   * @param pts list of [x, y] points, at least three
   * @example
   * part('L').sketch('front', (s) => s.polygon([[0,0],[40,0],[40,8],[8,8],[8,30],[0,30]])).extrude(20);
   * @see sketch.rect, sketch.polyline, part.revolve
   */
  polygon(pts: Pt[]): this {
    const ids = pts.map(([x, y]) => this.pt(x, y));
    ids.forEach((id, i) => this.ent({ type: 'line', p1: id, p2: ids[(i + 1) % ids.length] }));
    return this;
  }
  /**
   * Open chain of lines through the points.
   *
   * Adds line segments joining consecutive points without closing. An open chain extrudes only when thin walls are requested (thin option) or when it is closed by other entities of the same sketch.
   * @domain sketch
   * @param pts list of [x, y] points
   * @example
   * s.polyline([[0,0],[10,0],[10,10]]);
   * @see sketch.polygon, sketch.line
   */
  polyline(pts: Pt[]): this {
    const ids = pts.map(([x, y]) => this.pt(x, y));
    for (let i = 0; i + 1 < ids.length; i++) this.ent({ type: 'line', p1: ids[i], p2: ids[i + 1] });
    return this;
  }
  /**
   * One line segment between two points.
   *
   * Adds a single line from a to b. Combine with arc or arc3 to close a profile that has curved sides (a half disc is arc3 plus a line).
   * @domain sketch
   * @param a start [x, y]
   * @param b end [x, y]
   * @example
   * s.arc3([10, 0], [5, 5], [0, 0]).line([0, 0], [10, 0]);
   * @see sketch.arc3, sketch.polyline
   */
  line(a: Pt, b: Pt): this { return this.polyline([a, b]); }
  /**
   * Rectangle of width x height centred on a point.
   *
   * Adds a closed rectangle: width along sketch x, height along sketch y, centred on `at` (default the sketch origin). A second rect inside the first makes a frame (ring) that extrudes as a hollow section.
   * @domain sketch
   * @param w width (sketch x) in mm
   * @param h height (sketch y) in mm
   * @param at centre [x, y], default [0, 0]
   * @example
   * part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10);
   * @see sketch.rrect, sketch.polygon, sketch.circle
   */
  rect(w: Num, h: Num, at: Pt = [0, 0]): this {
    const hw = num(w) / 2, hh = num(h) / 2;
    return this.polygon([[at[0] - hw, at[1] - hh], [at[0] + hw, at[1] - hh], [at[0] + hw, at[1] + hh], [at[0] - hw, at[1] + hh]]);
  }
  /**
   * Circle given its RADIUS (not diameter).
   *
   * Adds a circle of radius r centred on `at`. Remember radius: a 10 mm bore is circle(5). Several circles in one sketch with nesting make rings; a circle on a face with cut() makes a round pocket or a through bore.
   * @domain sketch
   * @param r radius in mm
   * @param at centre [x, y], default [0, 0]
   * @example
   * part('Disc').sketch('front', (s) => s.circle(25)).extrude(8);
   * @see part.hole, part.cut
   */
  circle(r: Num, at: Pt = [0, 0]): this { this.ent({ type: 'circle', c: this.pt(at[0], at[1]), r: num(r) }); return this; }
  /**
   * Counter-clockwise arc about a centre from a start point to an end point.
   *
   * Adds an arc on the circle through `start` centred on `centre`, running counter-clockwise to `end` (projected on the radius). For an arc through three points in either direction use arc3.
   * @domain sketch
   * @param centre [x, y] of the arc
   * @param start [x, y] where the arc begins
   * @param end [x, y] where it ends (counter-clockwise from start)
   * @example
   * s.arc([0, 0], [10, 0], [0, 10]);
   * @see sketch.arc3
   */
  arc(centre: Pt, start: Pt, end: Pt): this {
    const c = this.pt(...centre), a = this.pt(...start), b = this.pt(...end);
    this.ent({ type: 'arc', c, p1: a, p2: b });
    return this;
  }
  private apt(id: string): { x: number; y: number } { const p = this.pointList.find((q) => q.id === id) as { x: number; y: number }; return p; }
  private arcIds(c: string, a: string, b: string): void { this.ent({ type: 'arc', c, p1: a, p2: b }); }
  /**
   * Arc from a to b passing through the middle point m (either direction).
   *
   * Adds the arc of the circle through the three points. It fails if the points are in line. Easier than arc() when you know three points on the outline.
   * @domain sketch
   * @param a start [x, y]
   * @param m a point on the arc between a and b
   * @param b end [x, y]
   * @example
   * part('Half disc').sketch('top', (s) => s.arc3([10, 0], [5, 5], [0, 0]).line([0, 0], [10, 0])).extrude(2);
   * @see sketch.arc, sketch.line
   */
  arc3(a: Pt, m: Pt, b: Pt): this {
    const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
    if (Math.abs(d) < 1e-12) throw new Error('arc3: the three points are in line');
    const q = (p: Pt) => p[0] * p[0] + p[1] * p[1];
    const cx = (q(a) * (m[1] - b[1]) + q(m) * (b[1] - a[1]) + q(b) * (a[1] - m[1])) / d;
    const cy = (q(a) * (b[0] - m[0]) + q(m) * (a[0] - b[0]) + q(b) * (m[0] - a[0])) / d;
    const ccw = (m[0] - a[0]) * (b[1] - m[1]) - (m[1] - a[1]) * (b[0] - m[0]) > 0;   // a -> m -> b turns left
    const c = this.pt(cx, cy), pa = this.pt(...a), pb = this.pt(...b);
    if (ccw) this.arcIds(c, pa, pb); else this.arcIds(c, pb, pa);
    return this;
  }
  /**
   * Rounded rectangle: width x height with corner radius r.
   *
   * Adds four lines and four arcs that share end points, centred on `at`. With r <= 0 it is a plain rect. Prefer this over filleting the vertical edges of a plate afterwards: it is faster and more robust.
   * @domain sketch
   * @param w width in mm
   * @param h height in mm
   * @param r corner radius in mm
   * @param at centre [x, y], default [0, 0]
   * @example
   * part('Tile').sketch('front', (s) => s.rrect(60, 40, 8)).extrude(5);
   * @see sketch.rect, part.fillet
   */
  rrect(w: Num, h: Num, r: Num, at: Pt = [0, 0]): this {
    const hw = num(w) / 2, hh = num(h) / 2, rr = num(r), [x, y] = at;
    if (rr <= 0) return this.rect(w, h, at);
    const P = (px: number, py: number) => this.pt(x + px, y + py);
    const b0 = P(-hw + rr, -hh), b1 = P(hw - rr, -hh), r0 = P(hw, -hh + rr), r1 = P(hw, hh - rr);
    const t0 = P(hw - rr, hh), t1 = P(-hw + rr, hh), l0 = P(-hw, hh - rr), l1 = P(-hw, -hh + rr);
    const cs = [P(hw - rr, -hh + rr), P(hw - rr, hh - rr), P(-hw + rr, hh - rr), P(-hw + rr, -hh + rr)];
    this.ent({ type: 'line', p1: b0, p2: b1 }); this.arcIds(cs[0], b1, r0);
    this.ent({ type: 'line', p1: r0, p2: r1 }); this.arcIds(cs[1], r1, t0);
    this.ent({ type: 'line', p1: t0, p2: t1 }); this.arcIds(cs[2], t1, l0);
    this.ent({ type: 'line', p1: l0, p2: l1 }); this.arcIds(cs[3], l1, b0);
    return this;
  }
  /**
   * A single point (a hole centre).
   *
   * Adds a point entity. Points in a sketch are used as hole centres by hole features; for a hole use part.hole or part.holes.* rather than placing points yourself.
   * @domain sketch
   * @param at [x, y]
   * @example
   * s.point([10, 5]);
   * @see sketch.points, part.hole
   */
  point(at: Pt): this { this.ent({ type: 'point', p: this.pt(at[0], at[1]) }); return this; }
  /**
   * Several points (hole centres).
   *
   * Adds one point entity per [x, y]. See holes.points for the usual way to drill them.
   * @domain sketch
   * @param pts list of [x, y]
   * @example
   * s.points([[0, 0], [10, 0], [20, 0]]);
   * @see part.holes.points
   */
  points(pts: Pt[]): this { pts.forEach((p) => this.point(p)); return this; }
  /**
   * Points on a circle: a bolt circle of centres.
   *
   * Adds `n` points on a circle of `radius` about `center`, the first at `startAngle` degrees (counter-clockwise from sketch x). For drilled holes use part.holes.polar.
   * @domain sketch
   * @param center [x, y] of the circle
   * @param radius in mm
   * @param n number of points
   * @param startAngle in degrees, default 0
   * @example
   * s.polarPoints([0, 0], 20, 6);
   * @see part.holes.polar, sketch.grid
   */
  polarPoints(center: Pt, radius: number, n: number, startAngle = 0): this { return this.points(polarPts(center, radius, n, startAngle)); }
  /**
   * Points on a rectangular grid.
   *
   * Adds nx by ny points starting at `origin` with spacing `pitch` along x then y (x varies fastest).
   * @domain sketch
   * @param origin [x, y] of the first point
   * @param pitch [dx, dy] spacing in mm
   * @param count [nx, ny] number of points along x and y
   * @example
   * s.grid([-15, -10], [10, 10], [4, 3]);
   * @see part.holes.grid, sketch.polarPoints
   */
  grid(origin: Pt, pitch: Pt, count: [number, number]): this { return this.points(gridPts(origin, pitch, count)); }
  /**
   * Construction line used as the revolve axis when it is not the sketch Y axis.
   *
   * Adds a construction line between two sketch points and makes it the axis of the next revolve. Normally you pass the same thing as revolve(360, { axis: { from, to } }), which calls this for you.
   * @domain sketch
   * @param from [x, y] start of the axis
   * @param to [x, y] end of the axis
   * @example
   * s.axisAt([30, 0], [30, 10]);
   * @see part.revolve, sketch.axis
   */
  axisAt(from: Pt, to: Pt): this {
    const a = this.pt(...from), b = this.pt(...to);
    this.ent({ type: 'line', p1: a, p2: b, construction: true });
    this.axisId = this.entities[this.entities.length - 1].id as string;
    return this;
  }
  /**
   * Construction line along the sketch Y axis (the default revolve axis).
   *
   * revolve() adds this automatically when the sketch has no axis, so you rarely call it. Profile x is the distance from the axis, profile y the height along it.
   * @domain sketch
   * @example
   * s.axis();
   * @see part.revolve
   */
  axis(): this {
    const a = this.pt(0, 0), b = this.pt(0, 10);
    this.ent({ type: 'line', p1: a, p2: b, construction: true });
    this.axisId = this.entities[this.entities.length - 1].id as string;
    return this;
  }
}

// ---- the part ----
export interface ExtrudeOpts { mid?: boolean; flip?: boolean; draft?: number; thin?: Num }
export class PartBuilder {
  steps: Step[] = [];
  variables: Array<{ name: string; expr: string }> = [];
  constructor(public name: string) {}
  private add(label: string, run: Step['run']): this { this.steps.push({ line: callerLine(), label, run }); return this; }
  /** The feature a step adds is reported to the context once the runner has applied it; steps record their own ids through ctx.nextId. */
  private line = (): number => this.steps[this.steps.length - 1]?.line ?? 0;

  /**
   * Start a sketch on a plane or a face; the next extrude, cut or revolve uses it.
   *
   * Opens a sketch on 'front' (XY, normal +Z), 'top' (XZ, normal +Y), 'right' (ZY, normal +X), on at('front', 20) (a plane moved along its normal), or on a face(): face('>Z'). The callback draws with the sketch builder `s`. A feature needs its own sketch: each extrude / cut / revolve consumes the last sketch. Units mm, Y is up.
   * @domain sketch
   * @param plane 'front' | 'top' | 'right', at(plane, offset), or face(sel)
   * @param build callback receiving the sketch builder s
   * @param name optional name shown in the feature tree
   * @example
   * part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10)
   *   .sketch(face('>Z'), (s) => s.circle(5)).cut(through());
   * @see sketch.rect, face, at, part.extrude
   */
  sketch(plane: Plane | OffsetPlane | FaceSel, build: (s: SketchBuilder) => void, name?: string): this {
    const s = new SketchBuilder();
    build(s);
    const line = callerLine();
    this.steps.push({ line, label: 'sketch', run: (ctx) => {
      const pre: EditOp[] = [];
      let pl: Record<string, unknown>;
      if (typeof plane === 'string') pl = { kind: 'std', id: plane };
      else if (plane.kind === 'offset') {
        const pid = ctx.nextId();
        pre.push({ op: 'add', feature: { type: 'plane', id: pid, mode: 'offset', base: { kind: 'std', id: plane.plane }, offset: ref(plane.offset) } });
        pl = { kind: 'feature', id: pid };
      } else pl = { kind: 'face', id: resolveFace(plane.sel, ctx.geo, plane.line).id };
      const id = ctx.nextId();
      ctx.lastSketch = id;
      ctx.lastFeature = id;
      return [...pre, { op: 'add', feature: { type: 'sketch', id, ...(name ? { name } : {}), plane: pl, points: s.pointList, entities: s.entities, constraints: [] } }];
    } });
    this.steps[this.steps.length - 1].sk = s;
    return this;
  }

  private solid(label: string, op: 'add' | 'cut', end: EndSpec, o: ExtrudeOpts): this {
    return this.add(label, (ctx) => {
      if (!ctx.lastSketch) throw new SelectorError(`${label}() needs a sketch before it`, this.line());
      const id = ctx.nextId();
      const through = typeof end === 'object' && 'through' in end;
      const f: Record<string, unknown> = { type: 'extrude', id, op, sketch: ctx.lastSketch };
      if (through) f.end = 'through'; else { f.end = o.mid ? 'mid' : 'blind'; f.depth = ref(end as Num); }
      if (o.flip) f.flip = true;
      if (o.draft) f.draft = o.draft;
      if (o.thin !== undefined) f.thin = { thickness: ref(o.thin), side: 'mid', ends: 'flat', cornerStyle: 'mitre' };
      ctx.lastFeature = id;
      ctx.lastSketch = null;
      return [{ op: 'add', feature: f }];
    });
  }
  /**
   * Extrude the last sketch into a solid (adds material).
   *
   * Extrudes the last sketch along its plane normal by `depth` mm. Options: mid (symmetric about the plane), flip (opposite direction), draft (taper angle in degrees), thin (hollow wall thickness: closed profile gives a tube, open profile a thin sheet). The first extrude makes the body; later ones add to it (a boss when sketched on a face).
   * @domain features
   * @param depth length in mm (number or expr)
   * @param o.mid extrude half each way
   * @param o.flip reverse direction
   * @param o.draft taper angle in degrees
   * @param o.thin wall thickness for a thin-walled extrude
   * @example
   * part('Boss').sketch('front', (s) => s.rect(50, 50)).extrude(10)
   *   .sketch(face('>Z'), (s) => s.circle(12)).extrude(15);
   * @see part.cut, part.thin, part.revolve
   */
  extrude(depth: Num, o: ExtrudeOpts = {}): this { return this.solid('extrude', 'add', depth, o); }
  /**
   * Cut the last sketch out of the body: a depth or through().
   *
   * Removes material. The cut runs AGAINST the sketch normal: from a face sketch (face('>Z')) that is into the body; from a standard plane whose normal points into the body (the front plane at the start of a Z extrude) it runs away from the body and reports cutNoEffect, so sketch on a face or pass flip: true. Depth is a number or through() for all the way. Same options as extrude (mid, flip, draft, thin).
   * @domain features
   * @param end depth in mm, or through()
   * @param o.mid cut half each way
   * @param o.flip reverse direction
   * @param o.draft taper angle in degrees
   * @example
   * part('Pocketed').sketch('front', (s) => s.rect(60, 40)).extrude(10)
   *   .sketch(face('>Z'), (s) => s.rect(30, 20)).cut(4);
   * @see through, part.extrude, part.hole
   */
  cut(end: EndSpec, o: ExtrudeOpts = {}): this { return this.solid('cut', 'cut', end, o); }
  /**
   * Revolve the last sketch about an axis (lathe parts: pulleys, bushings, flanges).
   *
   * Revolves the last sketch `angle` degrees (default 360). The axis is the sketch Y axis unless axis: { from, to } gives a line in the sketch plane. Profile x is the radius, y the height along the axis, so draw a half cross-section on one side of the axis. op: 'cut' removes the revolved volume instead. thin makes a revolved shell.
   * @domain features
   * @param angle degrees, default 360
   * @param o.op add (default) or cut
   * @param o.thin wall thickness for a thin revolve
   * @param o.axis { from: [x, y], to: [x, y] } axis line in the sketch plane
   * @example
   * part('Flanged bush')
   *   .sketch('front', (s) => s.polygon([[10, 0], [25, 0], [25, 6], [15, 6], [15, 30], [10, 30]]))
   *   .revolve(360);
   * @see sketch.polygon, sketch.axisAt
   */
  revolve(angle: Num = 360, o: { op?: 'add' | 'cut'; thin?: Num; axis?: { from: Pt; to: Pt } } = {}): this {
    const sk = [...this.steps].reverse().find((x) => x.sk)?.sk;
    if (sk && o.axis) sk.axisAt(o.axis.from, o.axis.to);
    else if (sk && !sk.axisId) sk.axis();
    return this.add('revolve', (ctx) => {
      if (!ctx.lastSketch) throw new SelectorError('revolve() needs a sketch before it', this.line());
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'revolve', id, op: o.op ?? 'add', sketch: ctx.lastSketch, axis: sk?.axisId, angle: ref(angle) };
      if (o.thin !== undefined) f.thin = { thickness: ref(o.thin), side: 'mid' };
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    });
  }
  /**
   * Make the previous extrude or revolve a thin-walled one.
   *
   * Edits the step recorded just before it: the same as passing the thin option. Closed profile gives a hollow section of this wall thickness (centred on the profile).
   * @domain features
   * @param thickness wall thickness in mm
   * @example
   * part('Tube').sketch('front', (s) => s.circle(20)).extrude(40).thin(2);
   * @see part.extrude, part.shell
   */
  thin(thickness: Num): this {
    const prev = this.steps.pop();
    if (!prev) throw new SelectorError('thin() needs an extrude or revolve before it', callerLine());
    const line = callerLine();
    this.steps.push({ line: prev.line, label: prev.label, run: (ctx) => {
      const ops = prev.run(ctx);
      const f = ops[0]?.feature;
      if (!f || (f.type !== 'extrude' && f.type !== 'revolve')) throw new SelectorError('thin() applies to an extrude or revolve', line);
      f.thin = { thickness: ref(thickness), side: 'mid', ...(f.type === 'extrude' ? { ends: 'flat', cornerStyle: 'mitre' } : {}) };
      return ops;
    } });
    return this;
  }
  /**
   * A simple drilled hole on a planar face at [x, y].
   *
   * Drills a round hole into the material from the face. [x, y] are coordinates in the sketch plane of that face, measured from the part origin projected onto it (not from a corner). Through unless depth is given. Use flip: true if it cuts the wrong way on an unusual face. Diameter, not radius.
   * @domain holes
   * @param on face(sel) of the planar face to drill from
   * @param at [x, y] hole centre in the face sketch plane
   * @param o.diameter hole diameter in mm
   * @param o.depth blind depth in mm, omit for through
   * @param o.flip reverse the drilling direction
   * @example
   * part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(12)
   *   .hole(face('>Z'), [-15, 0], { diameter: 8 });
   * @see part.holes.polar, part.holes.grid, part.holes.points, part.cut
   */
  hole(on: FaceSel, at: Pt, o: { diameter: Num; depth?: Num; flip?: boolean }): this { return this.holePoints('hole', on, [at], o); }
  /**
   * Hole arrays: ONE hole feature for many centres.
   *
   * The `holes` object offers points, polar and grid, each adding a single sketch of points plus one hole feature. One feature for many holes is far faster and cleaner in the tree than a loop of hole() calls.
   * @domain holes
   * @example
   * part('P').sketch('front', (s) => s.rect(60, 40)).extrude(8)
   *   .holes.grid(face('>Z'), { origin: [-15, -10], pitch: [10, 10], count: [4, 3] }, { diameter: 3 });
   * @see part.hole
   */
  get holes() {
    type HO = { diameter: Num; depth?: Num; flip?: boolean };
    return {
      /**
       * One hole feature at a list of centres.
       *
       * All holes share diameter and depth. Centres are [x, y] in the face sketch plane.
       * @domain holes
       * @param on face(sel) of the face to drill from
       * @param pts list of [x, y] centres
       * @param o.diameter hole diameter in mm
       * @param o.depth blind depth, omit for through
       * @param o.flip reverse direction
       * @example
       * part('P').sketch('front', (s) => s.rect(60, 40)).extrude(8)
       *   .holes.points(face('>Z'), [[-20, 0], [0, 10], [20, 0]], { diameter: 5 });
       * @see part.hole, part.holes.grid
       */
      points: (on: FaceSel, pts: Pt[], o: HO): this => this.holePoints('holes', on, pts, o),
      /**
       * A bolt circle: count holes equally spaced on a circle.
       *
       * Drills `count` holes on a circle of `radius` about `center` (sketch-plane coordinates, usually [0, 0]), the first at startAngle degrees. All holes are one feature.
       * @domain holes
       * @param on face(sel) of the face to drill from
       * @param c { center: [x, y], radius, count, startAngle? degrees }
       * @param o.diameter hole diameter in mm
       * @param o.depth blind depth, omit for through
       * @param o.flip reverse direction
       * @example
       * part('Flange plate').sketch('front', (s) => s.circle(40)).extrude(8)
       *   .holes.polar(face('>Z'), { center: [0, 0], radius: 28, count: 6 }, { diameter: 6 });
       * @see part.holes.points, part.circularPattern
       */
      polar: (on: FaceSel, c: { center: Pt; radius: number; count: number; startAngle?: number }, o: HO): this => this.holePoints('holes.polar', on, polarPts(c.center, c.radius, c.count, c.startAngle ?? 0), o),
      /**
       * A rectangular grid of holes.
       *
       * Drills nx by ny holes from `origin` at `pitch` spacing, as one feature.
       * @domain holes
       * @param on face(sel) of the face to drill from
       * @param g { origin: [x, y], pitch: [dx, dy], count: [nx, ny] }
       * @param o.diameter hole diameter in mm
       * @param o.depth blind depth, omit for through
       * @param o.flip reverse direction
       * @example
       * part('Perf').sketch('front', (s) => s.rect(60, 40)).extrude(4)
       *   .holes.grid(face('>Z'), { origin: [-20, -10], pitch: [10, 10], count: [5, 3] }, { diameter: 4 });
       * @see part.holes.points, part.linearPattern
       */
      grid: (on: FaceSel, g: { origin: Pt; pitch: Pt; count: [number, number] }, o: HO): this => this.holePoints('holes.grid', on, gridPts(g.origin, g.pitch, g.count), o),
    };
  }
  private holePoints(label: string, on: FaceSel, pts: Pt[], o: { diameter: Num; depth?: Num; flip?: boolean }): this {
    return this.add(label, (ctx) => {
      const sid = ctx.nextId(), id = ctx.nextId();
      const fc = resolveFace(on.sel, ctx.geo, on.line);
      ctx.lastFeature = id;
      const hole: Record<string, unknown> = { type: 'hole', id, sketch: sid, kind: 'simple', diameter: ref(o.diameter), end: o.depth === undefined ? 'through' : 'blind', flip: o.flip ?? false };
      if (o.depth !== undefined) hole.depth = ref(o.depth);
      return [
        { op: 'add', feature: { type: 'sketch', id: sid, plane: { kind: 'face', id: fc.id }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map((p, i) => ({ id: `p${i + 1}`, x: +p[0].toFixed(6), y: +p[1].toFixed(6) }))], entities: pts.map((_, i) => ({ id: `e${i + 1}`, type: 'point', p: `p${i + 1}` })), constraints: [] } },
        { op: 'add', feature: hole },
      ];
    });
  }
  /**
   * Round edges with a constant radius.
   *
   * Rounds the edges chosen by edges() with a fillet of the given radius (mm). Fails when the radius is too big for the adjacent faces (blendOverflow): reduce it. Fillet before shelling and before adding small features; select with edges('|Z') for the vertical edges of a block.
   * @domain features
   * @param on edges(sel) the edges to round
   * @param radius in mm (number or expr)
   * @example
   * part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20).fillet(edges('|Z'), 4);
   * @see part.chamfer, edges, sketch.rrect
   */
  fillet(on: EdgeSel, radius: Num): this {
    return this.add('fillet', (ctx) => { const id = ctx.nextId(); ctx.lastFeature = id; return [{ op: 'add', feature: { type: 'fillet', id, radius: ref(radius), edges: resolveEdges(on.sel, ctx.geo, on.line) } }]; });
  }
  /**
   * Bevel edges with an equal distance.
   *
   * Cuts a flat bevel on the chosen edges, the same distance along both faces. Good for edge breaks on bores and rims.
   * @domain features
   * @param on edges(sel) the edges to bevel
   * @param distance in mm
   * @example
   * part('Washer').sketch('front', (s) => s.circle(30)).extrude(5)
   *   .hole(face('>Z'), [0, 0], { diameter: 18 }).chamfer(edges('>Z'), 0.5);
   * @see part.fillet, edges
   */
  chamfer(on: EdgeSel, distance: Num): this {
    return this.add('chamfer', (ctx) => { const id = ctx.nextId(); ctx.lastFeature = id; return [{ op: 'add', feature: { type: 'chamfer', id, chamferType: 'equal', distance: ref(distance), edges: resolveEdges(on.sel, ctx.geo, on.line) } }]; });
  }
  /**
   * Hollow the body to a wall thickness, opening the selected face.
   *
   * Hollows out the solid leaving walls of `thickness` mm and removing the selected face to make an opening (box open at the top: shell(face('>Z'), 2)). Do fillets of the outside edges before the shell. A thickness larger than the smallest feature fails (shellTooThick).
   * @domain features
   * @param open face(sel) of the face left open
   * @param thickness wall thickness in mm
   * @example
   * part('Thin box').sketch('front', (s) => s.rect(50, 30)).extrude(20).shell(face('>Z'), 2);
   * @see part.thin, part.fillet
   */
  shell(open: FaceSel, thickness: Num): this {
    return this.add('shell', (ctx) => { const id = ctx.nextId(); ctx.lastFeature = id; return [{ op: 'add', feature: { type: 'shell', id, faces: [resolveFace(open.sel, ctx.geo, open.line).id], thickness: ref(thickness) } }]; });
  }
  /**
   * Repeat the last feature along a world axis.
   *
   * Repeats the feature added just before it `count` times (including the original) every `spacing` mm along the x, y or z axis. The seed is only the last feature: build the pocket or boss first, then pattern it.
   * @domain patterns
   * @param o.count total number of instances
   * @param o.spacing distance between instances in mm
   * @param o.axis 'x' | 'y' | 'z', default 'x'
   * @example
   * part('Slots').sketch('front', (s) => s.rect(80, 30)).extrude(10)
   *   .sketch(face('>Z'), (s) => s.circle(3, [-30, 0])).cut(through())
   *   .linearPattern({ count: 4, spacing: 20, axis: 'x' });
   * @see part.circularPattern, part.holes.grid
   */
  linearPattern(o: { count: number; spacing: Num; axis?: 'x' | 'y' | 'z' }): this {
    return this.add('linearPattern', (ctx) => {
      if (!ctx.lastFeature) throw new SelectorError('linearPattern() needs a feature before it', this.line());
      const id = ctx.nextId();
      const seed = ctx.lastFeature;
      ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'lpattern', id, seeds: [seed], dir: { kind: 'axis', axis: o.axis ?? 'x' }, count: o.count, spacing: ref(o.spacing), reverse: false } }];
    });
  }
  /**
   * Repeat the last feature about a world axis.
   *
   * Repeats the last feature `count` times around the x, y or z axis over `angle` degrees (360 = equally spaced full circle). The axis passes through the world origin, so centre your part on it. For a ring of drilled holes holes.polar is simpler.
   * @domain patterns
   * @param o.count total instances
   * @param o.axis 'x' | 'y' | 'z', default 'z'
   * @param o.angle total angle in degrees, default 360
   * @example
   * part('Disc').sketch('front', (s) => s.circle(40)).extrude(5)
   *   .sketch(face('>Z'), (s) => s.circle(2, [30, 0])).cut(through())
   *   .circularPattern({ count: 6, axis: 'z' });
   * @see part.holes.polar, part.linearPattern
   */
  circularPattern(o: { count: number; axis?: 'x' | 'y' | 'z'; angle?: number }): this {
    return this.add('circularPattern', (ctx) => {
      if (!ctx.lastFeature) throw new SelectorError('circularPattern() needs a feature before it', this.line());
      const id = ctx.nextId();
      const seed = ctx.lastFeature;
      ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'cpattern', id, seeds: [seed], axis: { kind: 'axis', axis: o.axis ?? 'z' }, count: o.count, angle: o.angle ?? 360, equal: (o.angle ?? 360) === 360 } }];
    });
  }
}

// ---- script-level state: the runner collects what the script built ----
export interface ScriptState { parts: PartBuilder[]; vars: Record<string, number>; varDefs: Array<{ name: string; expr: string }> }
export function makeApi(state: ScriptState) {
  const evalExpr = (text: string): number => {
    const names = Object.keys(state.vars);
    if (!/^[\w\s.+\-*/%()^,]*$/.test(text.replace(/Math\.\w+/g, ''))) throw new SelectorError(`expression "${text}" has characters that are not allowed`, callerLine());
    const v = new Function(...names, 'Math', `return (${text.replace(/\^/g, '**')});`)(...names.map((n) => state.vars[n]), Math);
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new SelectorError(`expression "${text}" is not a number`, callerLine());
    return v;
  };
  return {
    /**
     * Start the part the script builds; returns the fluent builder.
     *
     * Every script builds one part (the last wins). Chain sketch, extrude, cut, holes, fillet, ... on the result. The name appears as the document name.
     * @domain utilities
     * @param name part name, default "Script part"
     * @example
     * part('Bracket').sketch('front', (s) => s.rect(60, 40)).extrude(12);
     * @see part.sketch, variables
     */
    part: (name = 'Script part'): PartBuilder => {
      const p = new PartBuilder(name);
      state.parts.push(p);
      return p;
    },
    /**
     * Declare named values; strings are expressions over earlier ones.
     *
     * variables({ w: 60, t: 'w/10' }) defines document variables (editable in the Variables tab) and returns their numbers for use in the script. Use expr('w*2') to keep a feature parameter linked to a variable instead of a fixed number.
     * @domain utilities
     * @param defs { name: number | 'expression' }
     * @example
     * const { w, t } = variables({ w: 60, t: 'w/10' });
     * part('Bar').sketch('front', (s) => s.rect(w, 10)).extrude(expr('t'));
     * @see expr
     */
    variables: (defs: Record<string, number | string>): Record<string, number> => {
      for (const [name, v] of Object.entries(defs)) {
        const text = String(v).replace(/^=/, '');
        state.vars[name] = typeof v === 'number' ? v : evalExpr(text);
        state.varDefs.push({ name, expr: text });
      }
      return { ...state.vars };
    },
    /**
     * A parameter written as an expression over the variables.
     *
     * expr('w/2') keeps the feature parameter linked to the variable w (stored as =w/2). Inside a sketch an expr contributes its current number only. Characters are limited to arithmetic and Math.*.
     * @domain utilities
     * @param text expression string
     * @example
     * const { w } = variables({ w: 40 });
     * part('Bar').sketch('front', (s) => s.rect(w, 10)).extrude(expr('w/4'));
     * @see variables
     */
    expr: (text: string): Expr => new Expr(text, evalExpr(text)),
    face, edges, through, at,
  };
}
export type ScriptApi = ReturnType<typeof makeApi>;
