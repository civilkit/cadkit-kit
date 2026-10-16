// The recorder: a fluent API whose calls are REMEMBERED (with the script line) and later compiled to EditOps by the runner.
// Selectors (face(), edges()) are resolved at compile time against the body as it is just before that step.
import { resolveEdgeInfos, resolveEdges, resolveFace, resolveFaceSel, resolveFacesSel, SelectorError, type EdgeRule, type EdgeSel, type FaceInfo, type FacePick, type FaceRule, type FaceSel, type FacesSel, type FeatureRefLike, type Geometry, type SurfaceKind, type Vec } from './selectors';
import { Expr, num, ref } from './num';
import { buildPlane, type PlaneBase, type PlaneOpts, type PlaneRotate, type PlaneSpec } from './planes';
export { Expr };
export type { PlaneSpec, PlaneRotate };
import { holeOps, installFeatures } from './features';
import { CURATED_FONT_IDS, isKnownFont, unknownFontMessage } from './fonts';
export type Plane = 'front' | 'top' | 'right';

export type EditOp = { op: 'add'; feature: Record<string, unknown>; index?: number };
/** A workplane: a base plane, face, plane feature or point+normal, moved along its normal and optionally rotated. A reference plane feature is added for it. */
export interface OffsetPlane { kind: 'offset'; plane: PlaneBase; offset: Num; opts: PlaneOpts; line: number }
/** A feature of the part, taken with part.handle() once it exists; its id is filled in when the script runs. */
export class FeatureHandle { id: string | null = null; constructor(public label = 'feature') {} toString(): string { return this.id ?? ''; } }
/**
 * A workplane for a sketch: an offset plane, a face, a plane feature, a point and normal, or a tilt.
 *
 * at(base, offset, opts) returns a plane reference for sketch(). base is 'front' (moves along +Z), 'top' (+Y), 'right' (+X); a face(...) (the plane of that planar face, offset along its outward normal); a plane feature handle from part.workplane(...) + part.handle(); or { origin: [x,y,z], normal: [x,y,z], xdir? } for any plane (axis-aligned normals use a standard plane, others add three helper points and a three-point plane). opts.rotate = { axis: 'x'|'y'|'z' | edges(...), angle } tilts the plane about that line (the plane passes through the axis; an offset is applied before the rotation). A reference plane feature is added to the part.
 * @domain sketch
 * @param base 'front' | 'top' | 'right', face(sel), a plane feature handle, { origin, normal, xdir? }, or { between: [a, b] } (the mid plane of two planes or faces)
 * @param offset distance along the plane normal in mm (a number or expr), default 0
 * @param opts { rotate: { axis, angle degrees }, flip }
 * @example
 * part('Stack')
 *   .sketch('front', (s) => s.rect(40, 40)).extrude(5)
 *   .sketch(at('front', 20), (s) => s.circle(8)).extrude(5)
 *   .sketch(at(face('>Z'), 3), (s) => s.circle(4)).extrude(2);
 * @see part.sketch, plane, part.workplane
 */
export const at = (base: PlaneBase, offset: Num = 0, opts: PlaneOpts = {}): OffsetPlane => ({ kind: 'offset', plane: base, offset, opts, line: callerLine() });

/** Sketch-plane frame as the kernel reports it: sketch x / y / normal in world axes. */
export interface PlaneInfo {
  name: Plane;
  origin: Vec; x: Vec; y: Vec; normal: Vec;
  /** world point of the sketch point [u, v] on the plane moved `offset` mm along its normal */
  toWorld(p: [number, number], offset?: number): Vec;
}
const FRAMES: Record<Plane, { x: Vec; y: Vec; z: Vec }> = {
  front: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  top: { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
  right: { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] },
};
/**
 * The frame of a standard sketch plane: which world axes its sketch x, y and normal are.
 *
 * plane(name) returns { origin, x, y, normal, toWorld }. front: sketch x = world X, y = world Y, normal +Z. top: x = X, y = -Z (sketch y points to world -Z, so +sketch y is towards the back), normal +Y. right: x = -Z, y = Y, normal +X. Y is up. These come from the kernel's sketch frames; use toWorld([u, v], offset) to place a sketch point in the world, e.g. to aim a face selector or an expectBBox.
 * @domain sketch
 * @param name 'front' | 'top' | 'right'
 * @example
 * // t.y is [0, 0, -1]: a point at sketch y = 10 on the top plane is at world z = -10
 * const p = plane('top').toWorld([5, 10], 20);   // [5, 20, -10]
 * part('Offset ring').sketch('top', (s) => s.circle(4, [5, 10])).extrude(2).expectBBox({ min: [1, 0, -14], max: [9, 2, -6] });
 * @see at, part.sketch
 */
export const plane = (name: Plane): PlaneInfo => {
  const f = FRAMES[name];
  if (!f) throw new SelectorError(`plane('${name}'): use 'front', 'top' or 'right'`, callerLine());
  return { name, origin: [0, 0, 0], x: f.x, y: f.y, normal: f.z, toWorld: (p, offset = 0) => [0, 1, 2].map((k) => p[0] * f.x[k] + p[1] * f.y[k] + offset * f.z[k]) as Vec };
};

export type Num = number | Expr;

export interface Ctx {
  geo: Geometry;
  nextId(): string;
  /** id of the sketch recorded last / the feature added last */
  lastSketch: string | null;
  lastFeature: string | null;
  /** Report a warning for the script line (the run result lists them). */
  warn?(message: string, line: number): void;
  /** Cut features whose direction may be flipped once if the kernel finds nothing to cut (cut direction 'auto'). */
  autoFlip?: Set<string>;
}
/** What a read-back step may ask of the runner: a build of everything recorded so far plus the kernel's answers. */
export interface ReadRuntime {
  facts(need: FactNeed): Promise<Facts>;
  /** Report a failed expectation on a script line (the run goes on). */
  fail(message: string, line: number): void;
}
export interface TextMetricsFact { advance: number; bbox: [number, number, number, number]; width: number; capHeight: number; chars: number; advances: number[]; warnings: unknown[] }
export interface FactNeed { mass?: boolean; validate?: boolean; geometry?: boolean; /** measure a string (the kernel's textMetrics) */ text?: { string: string; font?: string; height: number; spacing?: number } }
export interface FaceFact {
  /** persistent face name, usable in face('F3.C1') */
  name: string;
  kind: SurfaceKind;
  area: number;
  /** outward unit normal of a planar face, else null */
  normal: Vec | null;
  center: Vec;
  radius?: number;
  /** the feature that created the face */
  feature: string;
}
export interface Facts {
  volume: number | null; area: number | null; com: Vec | null;
  valid: boolean | null; issues: Array<{ code: string; entity: string; detail: string }>;
  bbox: { min: Vec; max: Vec } | null;
  faceCount: number; edgeCount: number; faces: FaceFact[];
  edges: Array<{ key: string; mid: Vec; length: number; faces: string[] }>;
  text?: TextMetricsFact;
}
export interface Step { line: number; label: string; /** feature name given by the script (`{ name }` option); a missing one is derived from the sketch it consumes */ name?: string; /** tree folder the step's features belong to (see part.group) */ group?: string; run(ctx: Ctx): EditOp[]; sk?: SketchBuilder; /** a read-back step: builds what was recorded, asks the kernel, resolves a script promise or checks an expectation */ read?(rt: ReadRuntime): Promise<void> }
export interface Recorded { name: string; variables: Array<{ name: string; expr: string }>; steps: Step[] }

/** The 1-based script line of the caller, from the stack of the evaluated function (see run.ts: sourceURL + header offset). */
let lineOffset = 2;
export const setLineOffset = (n: number): void => { lineOffset = n; };
export function callerLine(): number {
  const m = /kit-script:(\d+):\d+/.exec(new Error().stack ?? '');
  return m ? Math.max(1, Number(m[1]) - lineOffset) : 0;
}

/**
 * Select ONE face of the current body: by direction, by persistent name, by feature, or by a rule.
 *
 * face(sel, opts) is resolved when the script runs, against the body as it is just before the step that uses it. A direction '>X' '<X' '>Y' '<Y' '>Z' '<Z' ('#top' '#bottom') is the planar face whose outward normal is that axis and which lies furthest along it (ties: the biggest). AFTER A BOSS OR POCKET '>Z' means the boss top, and the plate top facing the same way is a different face: when other faces face the same way but belong to another feature, the run result carries a warning naming the face it resolved to; pick on purpose with face('>Z', { of: handle }) (only faces created by that feature: a handle from part.handle(), or an id like 'F2'). A persistent face name such as 'F3.C1' (cap 1 of F3) selects exactly that face; 'F3.*' is a prefix. A rule object ANDs its keys: dir, normal [x,y,z] (planar faces facing that way), planar, at [x,y,z] (planar: the point lies on its plane), kind ('plane'|'cylinder'|'sphere'|'other'), radius, createdBy / of (feature), areaGreater, areaLess, near [x,y,z] (+ within), not / union / intersect / difference (arrays of face() or faces()). It must match exactly one face (faces(rule).nth(i), .largest(), .smallest(), .near(p) choose among several); it fails with a line number otherwise. Pass it to sketch(), at(), hole(), holes.*, shell().
 * @domain selectors
 * @param sel '>X' '<X' '>Y' '<Y' '>Z' '<Z' '#top' '#bottom', a face name ('F3.C1'), or a FaceRule object
 * @param opts { of: feature handle or id } restrict to the faces that feature created
 * @example
 * part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10)
 *   .sketch(face('>Z'), (s) => s.circle(12)).extrude(15)
 *   .hole(face('>Z'), [0, 0], { diameter: 8 })
 *   .hole(face('>Z', { of: 'F2' }), [25, 0], { diameter: 5 });
 * @see faces, edges, part.handle, part.sketch, part.hole, part.shell
 */
export const face = (sel: string | FaceRule, opts: { of?: FeatureRefLike } = {}): FaceSel => ({ kind: 'face', sel, line: callerLine(), ...(opts.of !== undefined ? { of: opts.of } : {}) });
/**
 * Select SEVERAL faces (a set) of the current body, or choose one of them by order, size or position.
 *
 * faces(sel, opts) takes the same specs as face() but returns every match: faces({ kind: 'cylinder', radius: 5 }) is every R5 cylindrical face, faces({ createdBy: h }) every face a feature created, faces('>Z') every face facing +Z. Use it where several faces are wanted (shell(faces(...), t) opens them all, edges({ onFace: faces(...) })), or chain one pick: .nth(i) (position in the body's face list), .largest(), .smallest(), .first(), .last(), .near([x, y, z]) (centroid nearest the point); each returns a face() you can pass to sketch() or hole().
 * @domain selectors
 * @param sel a direction, a face name or prefix ('F3.*'), or a FaceRule (see face)
 * @param opts { of: feature handle or id } restrict to the faces that feature created
 * @example
 * part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20)
 *   .sketch(face('>Z'), (s) => s.circle(6)).cut(through())
 *   .fillet(edges({ onFace: faces({ kind: 'cylinder', radius: 6 }) }), 1)
 *   .shell(faces('<Z').largest(), 2);
 * @see face, edges, part.shell
 */
export const faces = (sel: string | FaceRule, opts: { of?: FeatureRefLike } = {}): FacesSel => {
  const line = callerLine();
  const base = { sel, line, ...(opts.of !== undefined ? { of: opts.of } : {}) };
  const one = (pick: FacePick): FaceSel => ({ kind: 'face', ...base, pick });
  return { kind: 'faces', ...base, nth: (i) => one({ nth: i }), largest: () => one('largest'), smallest: () => one('smallest'), first: () => one('first'), last: () => one('last'), near: (p) => one({ near: p }) };
};
/**
 * Select edges of the current body by direction, extreme plane, or a rule object.
 *
 * edges(sel) is resolved against the body just before the step that uses it. Strings: 'all'; '|X' '|Y' '|Z' straight edges parallel to that axis; '>X' ... '<Z' edges lying in the extreme plane along that axis. A rule object ANDs its keys: parallel ('X'|'Y'|'Z'), outside / inside (box [[x0,y0,z0],[x1,y1,z1]] tested on the edge midpoint), not (another edges()), onFace (a face() or faces()), createdBy (edges that bound a face a feature created: a handle or id), lengthGreater, lengthLess, near + within (radius), and union / intersect / difference (arrays of edges()). It fails with a line number when nothing matches.
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
/** Options of sketch.text(). */
export interface TextOpts {
  /** 'gauge' | 'engrave' or a library font id (barlow, source-sans-3, barlow-condensed, bebas-neue, pt-serif, special-elite, ibm-plex-mono, great-vibes, satisfy, anton) */
  font?: string; height?: Num; anchor?: [('left' | 'center' | 'right')?, ('baseline' | 'middle' | 'top')?] | string;
  angle?: Num; spacing?: Num; mirror?: boolean; polyline?: boolean; name?: string;
  arc?: { centre?: Pt; radius: Num; angleCentre?: Num; side?: 'outside' | 'inside' };
}
export class SketchBuilder {
  pointList: Array<Record<string, unknown>> = [{ id: 'O', x: 0, y: 0, fixed: true }];
  entities: Array<Record<string, unknown>> = [];
  private np = 0;
  private ne = 0;
  axisId: string | null = null;
  private pt(x: number, y: number): string { const id = `p${++this.np}`; this.pointList.push({ id, x: +x.toFixed(10), y: +y.toFixed(10) }); return id; }
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
   * Lettering: the outlines of a string as closed regions (engrave it with cut, emboss it with extrude).
   *
   * Adds a `text` entity: the letters of a built-in font become closed loops that extrude and cut like any sketch profile, so ENGRAVE = sketch on the face + cut(0.3), EMBOSS = sketch + extrude(0.3). `at` is the anchor [x, y] (or {x, y}); `height` is the CAP height in mm (the height of an H, default 5); fonts: 'gauge' (condensed sans, default) and 'engrave' (serif), or the id of a library font ('barlow', 'source-sans-3', 'barlow-condensed', 'bebas-neue', 'pt-serif', 'special-elite', 'ibm-plex-mono', 'great-vibes', 'satisfy', 'anton': the app loads it, nothing else to do; no kerning or ligatures; overlapping strokes of a font may fail to engrave); anchor is [horizontal, vertical] = 'left'|'center'|'right' x 'baseline'|'middle'|'top' (or one string 'center middle'), default left baseline, measured on the ink box; angle in degrees counter-clockwise about the anchor; spacing scales the letter pitch (default 1); mirror flips the text (for the back of a clear part); arc: { centre: [x, y], radius, angleCentre (deg, default 90), side: 'outside' (tops away from the centre, reads clockwise) | 'inside' (tops toward the centre, reads counter-clockwise) } lays the letters along a circle (radius is the baseline). KEEP LETTERING IN A SKETCH OF ITS OWN (its loops are not intersected with other curves of the sketch); several text() calls in one sketch are fine (dial numerals). Text under 0.8 mm cap height warns textTooSmall; characters outside Latin-1 are skipped (textMissingGlyph). `name` sets the entity id (letters, digits, - and _), which shows in the sketch's inspect `texts`. Use await part.textMetrics(string, opts) to size a plate or centre by the real width.
   * @domain sketch
   * @param string the text (1 to 500 characters, one line)
   * @param at anchor [x, y] or {x, y} in the sketch plane, mm
   * @param opts { font: 'gauge'|'engrave'|library id (see above), height, anchor, angle, spacing, mirror, arc, polyline, name }
   * @example
   * part('Plate').sketch('front', (s) => s.rect(60, 20)).extrude(4)
   *   .sketch(at('front', 4), (s) => s.text('SEA SPRITE', [0, 0], { font: 'engrave', height: 5, anchor: ['center', 'middle'] })).cut(0.3);
   * @see part.textMetrics, part.cut, part.extrude
   */
  text(string: string, at: Pt | { x: number; y: number }, opts: TextOpts = {}): this {
    if (typeof string !== 'string' || string.length === 0) throw new Error('text(): the string is empty: pass the characters to draw, e.g. s.text("RPM", [0, 0], { height: 4 })');
    const xy: Pt = Array.isArray(at) ? [Number(at[0]), Number(at[1])] : [Number((at as { x: number }).x), Number((at as { y: number }).y)];
    if (!xy.every(Number.isFinite)) throw new Error('text(): the position must be [x, y] numbers, got ' + JSON.stringify(at));
    const o = opts ?? {};
    const font = o.font ?? 'gauge';
    if (!isKnownFont(font)) throw new Error(unknownFontMessage('text()', font));
    const height = o.height === undefined ? 5 : num(o.height);
    if (!(height > 0) || !Number.isFinite(height)) throw new Error('text(): height is the CAP height in mm and must be greater than 0 (got ' + String(o.height) + ')');
    const e: Record<string, unknown> = { type: 'text', string, font, height, p: this.pt(xy[0], xy[1]) };
    if (o.anchor !== undefined) {
      const a = typeof o.anchor === 'string' ? o.anchor.trim().split(/\s+/) : o.anchor;
      const H = ['left', 'center', 'right'], V = ['baseline', 'middle', 'top'];
      const h = a[0] ?? 'left', v = a[1] ?? 'baseline';
      if (!H.includes(h) || !V.includes(v)) throw new Error(`text(): anchor is [horizontal, vertical] with horizontal left|center|right and vertical baseline|middle|top, got ${JSON.stringify(o.anchor)}`);
      e.anchor = [h, v];
    }
    if (o.angle !== undefined) e.angle = num(o.angle);
    if (o.spacing !== undefined) { const sp = num(o.spacing); if (!(sp > 0 && sp < 20)) throw new Error('text(): spacing is a letter-pitch factor above 0 and below 20 (1 = the font\'s own)'); e.spacing = sp; }
    if (o.mirror) e.mirror = true;
    if (o.polyline) e.polyline = true;
    if (o.arc) {
      const r = num(o.arc.radius);
      if (!(r > 0)) throw new Error('text(): arc.radius must be greater than 0');
      const c = o.arc.centre ?? [0, 0];
      const side = o.arc.side ?? 'outside';
      if (side !== 'outside' && side !== 'inside') throw new Error("text(): arc.side is 'outside' or 'inside'");
      e.arc = { c: this.pt(c[0], c[1]), radius: r, angleCentre: o.arc.angleCentre === undefined ? 90 : num(o.arc.angleCentre), side };
    }
    if (o.name !== undefined) {
      if (!/^[A-Za-z][\w-]{0,40}$/.test(o.name)) throw new Error("text(): name must start with a letter and use letters, digits, '-' and '_'");
      if (this.entities.some((x) => x.id === o.name)) throw new Error(`text(): the name '${o.name}' is used twice in this sketch`);
      this.entities.push({ id: o.name, ...e });
      return this;
    }
    this.ent(e);
    return this;
  }
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
/** Hole options. diameter or an ISO size is required; the kind picks the head shape (counterbore, countersink) or the thread (tapped). */
export interface HoleOpts {
  /** name shown in the feature tree */
  name?: string;
  /** hole diameter in mm (not radius); optional when size is given */
  diameter?: Num;
  /** ISO metric size 'M2'..'M24': the kernel picks the hole diameter for the fit */
  size?: string;
  /** with size: 'normal' (default) | 'close' | 'loose' */
  fit?: 'normal' | 'close' | 'loose';
  /** 'simple' (default) | 'cbore' | 'csk' | 'tapped' */
  kind?: 'simple' | 'cbore' | 'csk' | 'tapped';
  /** 'through' (default without depth) | 'blind' (default with depth) | 'upTo' (up to the next face) */
  end?: 'through' | 'blind' | 'upTo';
  /** blind depth in mm */
  depth?: Num;
  /** reverse the drilling direction */
  flip?: boolean;
  /** counterbore diameter in mm (cbore); give with cboreDepth, else the ISO 4762 table values of size */
  cboreDiameter?: Num;
  /** counterbore depth in mm (cbore) */
  cboreDepth?: Num;
  /** countersink head diameter in mm (csk), default the ISO 10642 value of size */
  cskDiameter?: Num;
  /** countersink included angle in degrees (csk), default 90 */
  cskAngle?: Num;
  /** tapped: thread designation 'M6' (sets the tap-drill hole and adds the thread feature), or { size, length, hand, modeled } */
  thread?: string | boolean | { size?: string; length?: Num; hand?: 'right' | 'left'; modeled?: boolean; class?: string };
  /** tapped: cut the real helical groove instead of a cosmetic thread */
  modeled?: boolean;
}
export interface ExtrudeOpts { /** name shown in the feature tree (default: `Extrude <sketch name>`) */ name?: string; mid?: boolean; /** same as mid / direction 'both' */ symmetric?: boolean; flip?: boolean; draft?: number; thin?: Num; direction?: 'into' | 'away' | 'both' | 'auto' }
export type BodyFinish = 'matte' | 'plastic' | 'chrome' | 'glass' | 'brushed';
export const BODY_FINISHES: readonly BodyFinish[] = ['matte', 'plastic', 'chrome', 'glass', 'brushed'];
/** Colour, opacity and finish of a body. `colour` is the same as `color`: '#rrggbb' or '#rgb'. */
export interface LookOpts { colour?: string; color?: string; opacity?: number; finish?: BodyFinish }
export type AppearanceTarget = LookOpts & { feature?: string | FeatureHandle; body?: string | FeatureHandle; face?: string | FeatureHandle };
/** What appearance() and bodyName() recorded; applied to the document once the feature ids are known (see applyDecor). */
export interface Decor { line: number; ref?: string | FeatureHandle; face?: string; /** every face the feature `ref` created */ allFaces?: boolean; look?: { color?: string; opacity?: number; finish?: BodyFinish }; name?: string }
function hex6(c: unknown, line: number): string {
  const m = typeof c === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim()) : null;
  if (!m) throw new SelectorError(`appearance(): colour must be '#rrggbb' or '#rgb', got ${JSON.stringify(c)}`, line);
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return '#' + h.toLowerCase();
}
export class PartBuilder {
  steps: Step[] = [];
  decor: Decor[] = [];
  variables: Array<{ name: string; expr: string }> = [];
  /** the folder name set by an enclosing group(); every feature added inside carries it */
  private curGroup: string | undefined;
  /** names of the sketches seen so far, by feature id: a solid made from one is called `Extrude <sketch name>` */
  private sketchNames = new Map<string, string>();
  constructor(public name: string) {
    // every step gets the current group and decorates the features it adds with the names / group (applied when the step runs)
    const push = this.steps.push.bind(this.steps);
    this.steps.push = (...ss: Step[]) => push(...ss.map((s) => this.decorate(s)));
    // every method that records steps takes an optional `name` in its last options object: it names the feature(s) added by that call
    const proto = Object.getPrototypeOf(this) as Record<string, unknown>;
    const skip = new Set(['constructor', 'group', 'handle', 'workplane', 'thin']);
    for (const k of Object.getOwnPropertyNames(proto)) {
      const fn = proto[k];
      if (skip.has(k) || typeof fn !== 'function' || k.startsWith('_')) continue;
      const own = (...a: unknown[]): unknown => {
        const n0 = this.steps.length;
        const r = (fn as (...x: unknown[]) => unknown).apply(this, a);
        const last = a[a.length - 1];
        const nm = last && typeof last === 'object' && !Array.isArray(last) && typeof (last as { name?: unknown }).name === 'string' ? (last as { name: string }).name : null;
        if (nm) for (let i = n0; i < this.steps.length; i++) this.steps[i].name ??= nm;
        return r;
      };
      Object.defineProperty(this, k, { value: own, writable: true, configurable: true });
    }
  }
  /**
   * Put the features recorded inside `build` in a named folder of the feature tree.
   *
   * group('Tach gauge', () => { ... }) tags every feature added by the calls inside (sketches, planes, solids, holes) with group: 'Tach gauge'; the tree shows consecutive features with the same group under one collapsible folder. Groups do not nest: an inner group replaces the outer one until it ends. Also available as the free function group(name, build).
   * @domain utilities
   * @param name folder name
   * @param build callback that records the features
   * @example
   * const p = part('Dash');
   * p.group('Panel', () => { p.sketch('front', (s) => s.rect(100, 50), 'Panel').extrude(5); });
   * @see part.sketch, part.extrude
   */
  group(name: string, build: () => void): this {
    const prev = this.curGroup;
    this.curGroup = name;
    try { build(); } finally { this.curGroup = prev; }
    return this;
  }
  private decorate(s: Step): Step {
    const grp = this.curGroup;
    if (grp !== undefined) s.group ??= grp;
    const run = s.run;
    const part = this;
    s.run = function (this: unknown, ctx) {
      const ops = run.call(this, ctx);
      const adds = ops.filter((o) => o.op === 'add' && o.feature);
      for (const o of adds) {
        const f = o.feature;
        if (f.type === 'sketch' && typeof f.name === 'string') part.sketchNames.set(f.id as string, f.name);
        if (s.group !== undefined && f.group === undefined) f.group = s.group;
      }
      // the step's main feature: the sketch of a sketch step, else the last feature that is not a helper sketch or a thread
      const main = s.label === 'sketch' ? adds.find((o) => o.feature.type === 'sketch') : [...adds].reverse().find((o) => o.feature.type !== 'sketch' && o.feature.type !== 'thread') ?? adds.at(-1);
      const f = main?.feature;
      if (f && f.name === undefined) {
        if (s.name) f.name = s.name;
        else if ((f.type === 'extrude' || f.type === 'revolve') && typeof f.sketch === 'string' && part.sketchNames.has(f.sketch)) {
          f.name = `${f.type === 'revolve' ? 'Revolve' : f.op === 'cut' ? 'Cut' : 'Extrude'} ${part.sketchNames.get(f.sketch)}`;
        }
      }
      return ops;
    };
    return s;
  }
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
        const b = buildPlane(plane.plane, plane.offset, plane.opts, { geo: ctx.geo, nextId: ctx.nextId, warn: ctx.warn }, plane.line);
        pre.push(...b.ops);
        pl = b.ref;
      } else pl = { kind: 'face', id: resolveFaceSel(plane, ctx.geo, ctx.warn).id };
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
      const dir = o.direction ?? (op === 'cut' && !o.flip && !o.mid && !o.symmetric ? 'auto' : undefined);
      if (dir !== undefined && !['into', 'away', 'both', 'auto'].includes(dir)) throw new SelectorError(`${label}(): direction must be 'into', 'away', 'both' or 'auto'`, this.line());
      const both = dir === 'both' || !!o.mid || !!o.symmetric;
      if (through) f.end = both ? 'throughBoth' : 'through'; else { f.end = both ? 'mid' : 'blind'; f.depth = ref(end as Num); }
      // the kernel runs an extrude ALONG the sketch normal and a cut AGAINST it; 'into' / 'away' are relative to the normal for both
      let flip = !!o.flip;
      if (dir === 'into' && op === 'add') flip = !flip;
      if (dir === 'away' && op === 'cut') flip = !flip;
      if (flip && !both) f.flip = true;
      if (dir === 'auto' && op === 'cut' && !flip) ctx.autoFlip?.add(id);
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
   * Extrudes the last sketch along its plane normal by `depth` mm. Options: direction ('away' = along the sketch normal, the default; 'into' = against it; 'both' = symmetric about the plane, depth is the total, same as mid), flip (the old way to reverse), draft (taper angle in degrees), thin (hollow wall thickness: closed profile gives a tube, open profile a thin sheet). Sketch normals: front +Z, top +Y, right +X (see plane()); a face sketch's normal points out of the body. The first extrude makes the body; later ones add to it (a boss when sketched on a face).
   * @domain features
   * @param depth length in mm (number or expr)
   * @param o.direction 'away' (along the sketch normal, default) | 'into' (against it) | 'both' (symmetric, depth is the total)
   * @param o.mid extrude half each way (same as direction: 'both'; symmetric: true is the same)
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
   * Removes material. direction: 'into' (the kernel default: AGAINST the sketch normal, which is into the body from a face sketch), 'away' (along the normal), 'both' (symmetric about the sketch plane; depth is the total) or 'auto' (the default for cuts: try 'into'; if the kernel reports cutNoEffect because the body is on the other side, flip once and add the warning 'cut direction flipped automatically'). Give direction explicitly to avoid the extra build. Depth is a number or through() for all the way. Same other options as extrude (mid, flip, draft, thin).
   * @domain features
   * @param end depth in mm, or through()
   * @param o.direction 'auto' (default: into, flip once if nothing is cut) | 'into' | 'away' | 'both'
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
  revolve(angle: Num = 360, o: { name?: string; op?: 'add' | 'cut'; thin?: Num; axis?: { from: Pt; to: Pt } } = {}): this {
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
    this.steps.push({ line: prev.line, label: prev.label, ...(prev.name ? { name: prev.name } : {}), ...(prev.group ? { group: prev.group } : {}), run: (ctx) => {
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
   * Drills a round hole into the material from the face. kind selects the shape: 'simple' (default), 'cbore' (counterbore: cboreDiameter and cboreDepth), 'csk' (countersink: cskDiameter, cskAngle default 90) or 'tapped' (thread: 'M6' drills the tap drill and adds the thread; modeled: true for the real helix). size: 'M6' + fit instead of diameter uses the ISO table. end: 'upTo' drills to the next face. [x, y] are coordinates in the sketch plane of that face, measured from the part origin projected onto it (not from a corner). Through unless depth is given. Use flip: true if it cuts the wrong way on an unusual face. Diameter, not radius.
   * @domain holes
   * @param on face(sel) of the planar face to drill from
   * @param at [x, y] hole centre in the face sketch plane
   * @param o.diameter hole diameter in mm
   * @param o.depth blind depth in mm, omit for through
   * @param o.flip reverse the drilling direction
   * @param o.kind 'cbore' counterbore (cboreDiameter, cboreDepth), 'csk' countersink (cskDiameter, cskAngle) or 'tapped' (thread: 'M6')
   * @example
   * part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(12)
   *   .hole(face('>Z'), [-15, 0], { diameter: 8 })
   *   .hole(face('>Z'), [15, 0], { kind: 'cbore', diameter: 6.6, cboreDiameter: 11, cboreDepth: 6 });
   * @see part.holes.polar, part.holes.grid, part.holes.points, part.cut
   */
  hole(on: FaceSel, at: Pt, o: HoleOpts): this { return this.holePoints('hole', on, [at], o); }
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
    type HO = HoleOpts;
    return {
      /**
       * Drill holes at listed coordinates: one hole feature at a list of centres.
       *
       * All holes share diameter and depth. Centres are [x, y] coordinates in the face sketch plane.
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
  private holePoints(label: string, on: FaceSel, pts: Pt[], o: HoleOpts): this {
    const line = callerLine();
    return this.add(label, (ctx) => holeOps(ctx, on, pts, o, line));
  }
  /**
   * Round edges: one radius, a radius per edge, or a variable radius.
   *
   * Rounds the edges chosen by edges(). radius is a number (constant), or an options object: { radius: number | number[] | {[edgeKey]: number} } where an array gives one radius per selected edge in selection order (its length must equal the edge count) and an object maps edge keys (like 'F2.C0|F2.S.l1#0', as listed by part.edges... or '*' for the rest) to radii; edges with different radii become one fillet feature per distinct radius, applied in order of increasing radius (so a sequence of fillets, not one simultaneous blend: edges that meet at a vertex can fail with blendOverflow, then give them the same radius). { variable: [near, far] } makes ONE fillet whose radius changes linearly along each selected edge from the end nearer the start to the far end. Fails when a radius is too big for the adjacent faces (blendOverflow). Fillet before shelling and before adding small features; select with edges('|Z') for the vertical edges of a block.
   * @domain features
   * @param on edges(sel) the edges to round
   * @param radius radius in mm (number or expr), or { radius, variable }
   * @param radius.radius number | number[] (per edge) | object (edge key to radius, '*' default)
   * @param radius.variable [near, far] radii of a variable-radius fillet
   * @example
   * part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20)
   *   .fillet(edges('|Z'), 4)
   *   .fillet(edges({ onFace: face('>Z') }), { radius: [2, 2, 1, 1, 1, 1, 1, 1] });
   * @see part.chamfer, edges, sketch.rrect
   */
  fillet(on: EdgeSel, radius: Num | { name?: string; radius?: Num | Num[] | Record<string, Num>; variable?: [Num, Num] }): this {
    return this.add('fillet', (ctx) => {
      const infos = resolveEdgeInfos(on.sel, ctx.geo, on.line, ctx.warn);
      const refs = infos.map((e) => ({ faces: [...e.faces!], at: [...e.mid!] }));
      const o = typeof radius === 'number' || radius instanceof Expr ? { radius } : radius;
      const mk = (id: string, edges: typeof refs, extra: Record<string, unknown>): EditOp => ({ op: 'add', feature: { type: 'fillet', id, edges, ...extra } });
      if (o.variable) {
        const id = ctx.nextId(); ctx.lastFeature = id;
        return [mk(id, refs, { radius: ref(o.variable[0]), filletType: 'variable', radii: o.variable.map((v) => ref(v)) })];
      }
      const r = o.radius;
      if (r === undefined) throw new SelectorError('fillet(): give a radius (a number, an array, an object) or variable: [near, far]', on.line);
      if (!Array.isArray(r) && (typeof r === 'number' || r instanceof Expr)) { const id = ctx.nextId(); ctx.lastFeature = id; return [mk(id, refs, { radius: ref(r) })]; }
      const per: Num[] = Array.isArray(r)
        ? (r.length === refs.length ? r : (() => { throw new SelectorError(`fillet(): ${r.length} radii for ${refs.length} selected edges (one per edge, in selection order)`, on.line); })())
        : infos.map((e) => { const v = r[e.key ?? ''] ?? r['*']; if (v === undefined) throw new SelectorError(`fillet(): no radius for edge '${e.key}' (add it to the object or give '*')`, on.line); return v; });
      const groups = new Map<string, { r: Num; edges: typeof refs }>();
      per.forEach((v, i) => { const k = String(ref(v)); const g = groups.get(k) ?? { r: v, edges: [] }; g.edges.push(refs[i]); groups.set(k, g); });
      const ops: EditOp[] = [];
      for (const g of [...groups.values()].sort((x, y) => num(x.r) - num(y.r))) { const id = ctx.nextId(); ctx.lastFeature = id; ops.push(mk(id, g.edges, { radius: ref(g.r) })); }
      return ops;
    });
  }
  /**
   * Bevel edges: equal distance, two distances, or distance and angle.
   *
   * Cuts a flat bevel on the chosen edges. A number is the equal distance on both faces. An options object: { distance, distance2 } measures distance on one face and distance2 on the other (chamferType distanceDistance); { distance, angle } a distance and an angle in degrees (angleDistance); flip swaps the two faces. NOTE: the current kernel implements only the equal-distance chamfer: the two-distance and angle forms are emitted as the kernel's features but fail with an `unsupported` error until the kernel adds them; model those bevels with a cut or a sketch polygon instead. Good for edge breaks on bores and rims.
   * @domain features
   * @param on edges(sel) the edges to bevel
   * @param distance mm (number or expr), or { distance, distance2?, angle?, flip? }
   * @param distance.distance first distance in mm
   * @param distance.distance2 second distance in mm (distanceDistance)
   * @param distance.angle angle in degrees (angleDistance)
   * @param distance.flip swap which face gets which distance
   * @example
   * part('Washer').sketch('front', (s) => s.circle(30)).extrude(5)
   *   .hole(face('>Z'), [0, 0], { diameter: 18 }).chamfer(edges('>Z'), 0.5);
   * @see part.fillet, edges
   */
  chamfer(on: EdgeSel, distance: Num | { name?: string; distance: Num; distance2?: Num; angle?: Num; flip?: boolean }): this {
    return this.add('chamfer', (ctx) => {
      const id = ctx.nextId(); ctx.lastFeature = id;
      const o = typeof distance === 'number' || distance instanceof Expr ? { distance } : distance;
      const type = o.distance2 !== undefined ? 'distanceDistance' : o.angle !== undefined ? 'angleDistance' : 'equal';
      return [{ op: 'add', feature: { type: 'chamfer', id, chamferType: type, distance: ref(o.distance), ...(o.distance2 !== undefined ? { distance2: ref(o.distance2) } : {}), ...(o.angle !== undefined ? { angle: ref(o.angle) } : {}), ...(o.flip ? { flip: true } : {}), edges: resolveEdgeInfos(on.sel, ctx.geo, on.line, ctx.warn).map((e) => ({ faces: [...e.faces!], at: [...e.mid!] })) } }];
    });
  }
  /**
   * Hollow the body to a wall thickness, opening the selected face(s).
   *
   * Hollows out the solid leaving walls of `thickness` mm and removing the selected face to make an opening (box open at the top: shell(face('>Z'), 2)). faces(...) opens several faces at once. Do fillets of the outside edges before the shell. A thickness larger than the smallest feature fails (shellTooThick).
   * @domain features
   * @param open face(sel) or faces(sel) of the face(s) left open
   * @param thickness wall thickness in mm
   * @example
   * part('Thin box').sketch('front', (s) => s.rect(50, 30)).extrude(20).shell(face('>Z'), 2);
   * @see part.thin, part.fillet
   */
  shell(open: FaceSel | FacesSel, thickness: Num): this {
    return this.add('shell', (ctx) => { const id = ctx.nextId(); ctx.lastFeature = id; return [{ op: 'add', feature: { type: 'shell', id, faces: resolveFacesSel(open, ctx.geo, ctx.warn).map((f) => f.id), thickness: ref(thickness) } }]; });
  }
  /**
   * Repeat features along a direction, optionally as a 2D grid.
   *
   * linearPattern(o) repeats the feature added just before it; linearPattern(seed, o) repeats seed: 'last', a handle from part.handle(), a feature id like 'F4', or an array of those (several features are patterned together). Instances: count in total (including the original), every spacing mm, or totalLength mm from first to last (spacing = totalLength / (count - 1)). direction (or axis) is 'x' | 'y' | 'z', a vector [x, y, z] or a straight edge: the kernel patterns along the WORLD axes only, so a vector or edge must be parallel to x, y or z (its sign picks the way); anything oblique fails with a clear error. reverse flips the way. second: { direction, count, spacing | totalLength } adds a second direction: the original features plus the first pattern are patterned again (a pattern of a pattern, which the kernel supports) giving count x second.count instances, a rectangular grid.
   * @domain patterns
   * @param seed 'last', a handle, a feature id or an array of them (omit to repeat the last feature)
   * @param o.count total number of instances
   * @param o.spacing distance between instances in mm
   * @param o.totalLength first-to-last distance in mm instead of spacing
   * @param o.direction 'x' | 'y' | 'z' | [x, y, z] | edges(...), default 'x'
   * @param o.axis alias of direction ('x' | 'y' | 'z')
   * @param o.reverse go the other way
   * @param o.second { direction, count, spacing | totalLength, reverse? } the second grid direction
   * @example
   * part('Grid plate').sketch('front', (s) => s.rect(80, 60)).extrude(10)
   *   .sketch(face('>Z'), (s) => s.circle(3, [-30, -20])).cut(through())
   *   .linearPattern({ count: 4, spacing: 20, direction: 'x', second: { direction: 'y', count: 3, totalLength: 40 } });
   * @see part.circularPattern, part.holes.grid, part.handle
   */
  linearPattern(seed: PatternSeed | LinearOpts, o?: LinearOpts): this {
    const opts = (o ?? seed) as LinearOpts;
    const seeds = o ? (seed as PatternSeed) : 'last';
    const line = callerLine();
    return this.add('linearPattern', (ctx) => {
      const ids = seedIds(seeds, ctx, line, 'linearPattern');
      const mk = (id: string, sd: string[], d: LinearOpts): EditOp => {
        const ax = worldDir(d.direction ?? d.axis ?? 'x', ctx, line, 'linearPattern');
        if (d.count === undefined) throw new SelectorError('linearPattern(): count is required', line);
        const spacing = d.totalLength !== undefined ? (num(d.totalLength) / Math.max(1, d.count - 1)) : d.spacing;
        if (spacing === undefined) throw new SelectorError('linearPattern(): give spacing or totalLength', line);
        return { op: 'add', feature: { type: 'lpattern', id, seeds: sd, dir: { kind: 'axis', axis: ax.axis }, count: d.count, spacing: d.totalLength !== undefined ? spacing : ref(spacing as Num), reverse: ax.negative !== !!d.reverse } };
      };
      const id = ctx.nextId(); ctx.lastFeature = id;
      const out = [mk(id, ids, opts)];
      if (opts.second) { const id2 = ctx.nextId(); ctx.lastFeature = id2; out.push(mk(id2, [...ids, id], opts.second)); }
      return out;
    });
  }
  /**
   * Repeat features around an axis.
   *
   * circularPattern(o) repeats the feature added just before it; circularPattern(seed, o) repeats seed ('last', a handle, a feature id, or an array). Instances: count in total over angle (alias total) degrees, 360 = a full circle. axis is 'x' | 'y' | 'z', [ox, oy, oz, dx, dy, dz] or a straight edge; the kernel rotates about a WORLD axis through the origin only, so an offset or oblique axis fails with a clear error (centre the part on the axis, or use holes.polar for a bolt circle anywhere). equalSpacing (default true for 360) spaces the instances angle / count apart; false spaces them angle / (count - 1) so the last lands exactly at the end angle (use it for an arc fan). A pattern can seed another pattern.
   * @domain patterns
   * @param seed 'last', a handle, a feature id or an array of them (omit to repeat the last feature)
   * @param o.count total instances
   * @param o.axis 'x' | 'y' | 'z' | [ox,oy,oz,dx,dy,dz] | edges(...), default 'z'
   * @param o.angle total angle in degrees, default 360 (alias total)
   * @param o.equalSpacing angle / count apart (default when 360); false: angle / (count - 1)
   * @param o.reverse go the other way
   * @example
   * part('Disc').sketch('front', (s) => s.circle(40)).extrude(5)
   *   .sketch(face('>Z'), (s) => s.circle(2, [30, 0])).cut(through())
   *   .circularPattern({ count: 6, axis: 'z' });
   * @see part.holes.polar, part.linearPattern, part.handle
   */
  circularPattern(seed: PatternSeed | CircularOpts, o?: CircularOpts): this {
    const opts = (o ?? seed) as CircularOpts;
    const seeds = o ? (seed as PatternSeed) : 'last';
    const line = callerLine();
    return this.add('circularPattern', (ctx) => {
      const ids = seedIds(seeds, ctx, line, 'circularPattern');
      const angle = opts.angle ?? opts.total ?? 360;
      const ax = worldAxis(opts.axis ?? 'z', ctx, line);
      const id = ctx.nextId(); ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'cpattern', id, seeds: ids, axis: { kind: 'axis', axis: ax.axis }, count: opts.count, angle, equal: opts.equalSpacing ?? angle === 360, ...(ax.negative !== !!opts.reverse ? { reverse: true } : {}) } }];
    });
  }

  /**
   * A handle on the feature recorded last, for face({ of }) and patterns.
   *
   * handle() returns an object naming the feature the previous call added (its id is filled in when the script runs): const boss = part.handle() after .extrude(15). Then face('>Z', { of: boss }) selects only the faces that feature created, faces({ createdBy: boss }) all of them, edges({ createdBy: boss }) their edges, and linearPattern(boss, ...) repeats it. After a sketch it names the sketch; after a hole() the hole feature (a hole's sketch is internal). Placing a handle costs nothing.
   * @domain utilities
   * @param label optional name for error messages
   * @example
   * const p = part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10);
   * p.sketch(face('>Z'), (s) => s.circle(12)).extrude(15);
   * const boss = p.handle();
   * p.hole(face('>Z', { of: boss }), [0, 0], { diameter: 8 });
   * @see face, faces, part.linearPattern
   */
  handle(label = 'feature'): FeatureHandle {
    const h = new FeatureHandle(label);
    const line = callerLine();
    this.steps.push({ line, label: 'handle', run: (ctx) => {
      if (!ctx.lastFeature) throw new SelectorError('handle() needs a feature before it', line);
      h.id = ctx.lastFeature;
      return [];
    } });
    return h;
  }
  /**
   * Colour, opacity and finish of the bodies a feature made (view only, no geometry change).
   *
   * appearance({ feature: handle, colour: '#1a1a1a', opacity: 0.18, finish: 'glass' }) styles the body (lump) the feature created; when the feature made several bodies (a pattern) all of them. feature is a handle from part.handle() or an id like 'F12' (body is the same). colour (or color) is '#rrggbb' or '#rgb'; opacity is 0.05 to 1 (below 1 the body is drawn as glass in the transparent pass; a click passes through a body below 0.35); finish is 'matte' | 'plastic' | 'chrome' | 'glass' | 'brushed'. { face: 'F3.C1' } or { face: 'F3.*' } (a persistent face name or prefix) or { face: handle } (all the faces a feature created) sets colour and finish of single faces; the opacity of a face is ignored. Stored in the document (appearance, faceAppearance), so the app, the snapshot renderer and a saved file show it. The part's own material is the default for bodies without an appearance.
   * @domain utilities
   * @param o { feature | body | face, colour?, opacity?, finish? }
   * @example
   * p.sketch('front', (s) => s.circle([0, 0], 30)).extrude(3);
   * const lens = p.handle();
   * p.appearance({ feature: lens, colour: '#b9c7d6', opacity: 0.18, finish: 'glass' });
   * @see part.bodyName, part.handle
   */
  appearance(o: AppearanceTarget): this {
    const line = callerLine();
    const targets = [o.feature, o.body, o.face].filter((x) => x !== undefined);
    if (targets.length !== 1) throw new SelectorError('appearance(): give exactly one of feature, body or face', line);
    const look: Decor['look'] = {};
    const c = o.colour ?? o.color;
    if (c !== undefined) look.color = hex6(c, line);
    if (o.opacity !== undefined) {
      if (typeof o.opacity !== 'number' || !isFinite(o.opacity) || o.opacity < 0.05 || o.opacity > 1) throw new SelectorError(`appearance(): opacity must be between 0.05 and 1, got ${String(o.opacity)}`, line);
      if (o.opacity < 1) look.opacity = o.opacity;
    }
    if (o.finish !== undefined) {
      if (!BODY_FINISHES.includes(o.finish)) throw new SelectorError(`appearance(): finish must be one of ${BODY_FINISHES.join(', ')}, got ${JSON.stringify(o.finish)}`, line);
      look.finish = o.finish;
    }
    if (!Object.keys(look).length) throw new SelectorError('appearance(): give a colour, an opacity or a finish', line);
    if (o.face instanceof FeatureHandle) this.decor.push({ line, ref: o.face, allFaces: true, look });
    else if (o.face !== undefined) {
      if (typeof o.face !== 'string' || !/^F\d+[.:|#*]/.test(o.face)) throw new SelectorError(`appearance(): face must be a persistent face name like 'F3.C1' or a prefix like 'F3.*', got ${JSON.stringify(o.face)}`, line);
      this.decor.push({ line, face: o.face, look });
    } else this.decor.push({ line, ref: (o.feature ?? o.body) as string | FeatureHandle, look });
    return this;
  }

  /**
   * Name the bodies a feature made (shown in the Bodies list; the default is Body 1, 2, ...).
   *
   * bodyName(handle, 'Tach lens') names the body the feature created; when it made several they are numbered 'Tach lens 1', 'Tach lens 2'. The target is a handle from part.handle() or an id like 'F12'.
   * @domain utilities
   * @param target handle or feature id
   * @param name the name shown in the Bodies list
   * @example
   * p.sketch('front', (s) => s.circle(0, 0, 20)).extrude(3);
   * p.bodyName(p.handle(), 'Lens');
   * @see part.appearance, part.handle
   */
  bodyName(target: string | FeatureHandle, name: string): this {
    const line = callerLine();
    if (typeof name !== 'string' || !name.trim()) throw new SelectorError('bodyName(): the name must be a non-empty string', line);
    this.decor.push({ line, ref: target, name: name.trim() });
    return this;
  }

  /**
   *   /**
   * Add a reference plane (workplane) feature without a sketch.
   *
   * workplane(base, offset, opts) adds the plane that at() would add, as a feature of its own (visible in the tree, reusable): base is 'front' | 'top' | 'right', face(...), a plane handle, or { origin, normal, xdir? }; opts.rotate tilts it about an axis line. Take part.handle() right after it, then sketch(at(handle), ...) any number of times; at(handle, 5) offsets it further.
   * @domain sketch
   * @param base 'front' | 'top' | 'right', face(sel), a plane handle or { origin, normal, xdir? }
   * @param offset distance along the normal in mm, default 0
   * @param opts { rotate: { axis, angle }, flip }
   * @example
   * const p = part('Wedge').sketch('front', (s) => s.rect(40, 40)).extrude(10);
   * p.workplane('front', 10, { rotate: { axis: 'x', angle: 30 } });
   * const tilted = p.handle();
   * p.sketch(at(tilted), (s) => s.circle(8)).extrude(6);
   * @see at, part.handle, part.sketch
   */
  workplane(base: PlaneBase, offset: Num = 0, opts: PlaneOpts = {}): this {
    const line = callerLine();
    this.steps.push({ line, label: 'workplane', run: (ctx) => {
      const b = buildPlane(base, offset, opts, { geo: ctx.geo, nextId: ctx.nextId, warn: ctx.warn }, line);
      ctx.lastFeature = b.ref.id;
      return b.ops;
    } });
    return this;
  }

  // ---- read back: the runner builds everything recorded so far on the scratch kernel, asks, and continues ----
  private readStep<T>(label: string, need: FactNeed, pick: (f: Facts) => T): Promise<T> {
    const line = callerLine();
    return new Promise<T>((resolve, reject) => {
      this.steps.push({ line, label: `read ${label}`, run: () => [], read: async (rt) => { try { resolve(pick(await rt.facts(need))); } catch (e) { reject(e); throw e; } } });
    });
  }
  /**
   * Read the volume (mm3) of the part built so far.
   *
   * await part.volume() makes the runner build everything recorded up to here on the scratch kernel (a full regeneration of the features so far, then a mass-properties query), returns the number and the script continues recording. Use it to compute the next dimension from a real result or to print a check. The script must use await (top level await is allowed). COST: every read forces an intermediate build; the answer is cached until the next feature is added, so read once, after a group of features, not inside a loop of features. Compare with the expect* helpers, which need no await.
   * @domain utilities
   * @example
   * const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);
   * const v = await p.volume();   // 24000
   * p.expectVolume(v, { tol: 1e-6 });
   * @see part.expectVolume, part.area, part.bbox
   */
  volume(): Promise<number> { return this.readStep('volume', { mass: true }, (f) => f.volume ?? NaN); }
  /**
   * Read the total surface area (mm2) of the part built so far.
   *
   * Like volume(): forces a build of what is recorded so far and a mass-properties query, cached until the next feature. Needs await.
   * @domain utilities
   * @example
   * const p = part('Cube').sketch('front', (s) => s.rect(10, 10)).extrude(10);
   * const a = await p.area();   // 600
   * @see part.volume
   */
  area(): Promise<number> { return this.readStep('area', { mass: true }, (f) => f.area ?? NaN); }
  /**
   * Measure a string before drawing it: width, ink box and per-letter advances.
   *
   * await part.textMetrics(string, { font, height, spacing }) asks the kernel for the real layout of the text (the same one s.text() uses) and returns { width, advance, bbox: [x0, y0, x1, y1], capHeight, chars, advances, warnings }; width is the ink width in mm, bbox is relative to the pen start on the baseline. Use it to size a nameplate, centre a label or fit a font height to a space. It needs await and costs one kernel request; no build is forced.
   * @domain utilities
   * @param string the text
   * @param opts { font: 'gauge'|'engrave'|library id (default gauge), height: cap height mm (default 5), spacing: pitch factor (default 1) }
   * @example
   * const p = part('Plate');
   * const m = await p.textMetrics('SEA SPRITE', { font: 'engrave', height: 5 });
   * p.sketch('front', (s) => s.rect(m.width + 8, 12)).extrude(2);
   * @see sketch.text
   */
  textMetrics(string: string, opts: { font?: string; height?: Num; spacing?: Num } = {}): Promise<TextMetricsFact> {
    const line = callerLine();
    if (opts.font !== undefined && !isKnownFont(opts.font)) throw new Error(unknownFontMessage('textMetrics()', opts.font));
    const text = { string, font: opts.font ?? 'gauge', height: opts.height === undefined ? 5 : num(opts.height), ...(opts.spacing === undefined ? {} : { spacing: num(opts.spacing) }) };
    return new Promise<TextMetricsFact>((resolve, reject) => {
      this.steps.push({ line, label: 'read textMetrics', run: () => [], read: async (rt) => { try { const f = await rt.facts({ text }); if (!f.text) throw new SelectorError('textMetrics(): the kernel did not answer', 0); resolve(f.text); } catch (e) { reject(e); throw e; } } });
    });
  }
  /**
   * Read the bounding box of the part built so far.
   *
   * Returns { min: [x, y, z], max: [x, y, z], size: [dx, dy, dz] } in mm. Forces a view build of what is recorded so far (the display body carries the box); cached until the next feature. Needs await.
   * @domain utilities
   * @example
   * const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);
   * const b = await p.bbox();   // size [40, 30, 20], min [-20, -15, 0]
   * @see part.volume, part.expectBBox
   */
  bbox(): Promise<{ min: Vec; max: Vec; size: Vec }> {
    return this.readStep('bbox', { geometry: true }, (f) => { if (!f.bbox) throw new SelectorError('bbox(): there is no body yet', 0); return { ...f.bbox, size: [0, 1, 2].map((k) => f.bbox!.max[k] - f.bbox!.min[k]) as Vec }; });
  }
  /**
   * Read the centre of mass of the part built so far.
   *
   * Returns [x, y, z] in mm (uniform density). Forces a build and a mass-properties query, cached until the next feature. Needs await.
   * @domain utilities
   * @example
   * const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);
   * const c = await p.centreOfMass();   // [0, 0, 10]
   * @see part.volume
   */
  centreOfMass(): Promise<Vec> { return this.readStep('centre of mass', { mass: true }, (f) => f.com ?? [NaN, NaN, NaN]); }
  /**
   * Read the number of faces of the part built so far.
   *
   * Counts the faces of the display body; cached until the next feature. Needs await.
   * @domain utilities
   * @example
   * const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);
   * const n = await p.faceCount();   // 6
   * @see part.faces, part.edgeCount
   */
  faceCount(): Promise<number> { return this.readStep('face count', { geometry: true }, (f) => f.faceCount); }
  /**
   * Read the number of edges of the part built so far.
   *
   * Counts the edges of the display body (seam-split arcs count once); cached until the next feature. Needs await.
   * @domain utilities
   * @example
   * const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);
   * const n = await p.edgeCount();   // 12
   * @see part.faceCount
   */
  edgeCount(): Promise<number> { return this.readStep('edge count', { geometry: true }, (f) => f.edgeCount); }
  /**
   * Read whether the part built so far passes the kernel's validity check.
   *
   * true when the validator finds no issue; the issues come from part.issues(). Forces a build and a validate query, cached until the next feature. Needs await.
   * @domain utilities
   * @example
   * const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);
   * const ok = await p.isValid();   // true
   * @see part.expectValid
   */
  isValid(): Promise<boolean> { return this.readStep('validity', { validate: true }, (f) => f.valid === true); }
  /**
   * Read the validator's issues for the part built so far.
   *
   * Returns a list of { code, entity, detail }, empty when the part is valid. Needs await.
   * @domain utilities
   * @example
   * const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);
   * const issues = await p.issues();   // []
   * @see part.isValid
   */
  issues(): Promise<Array<{ code: string; entity: string; detail: string }>> { return this.readStep('issues', { validate: true }, (f) => f.issues); }
  /**
   * Read the faces of the part built so far: persistent name, kind, area, normal, centre, radius, feature.
   *
   * Returns a list of { name, kind ('plane' | 'cylinder' | 'sphere' | 'other'), area, normal (planar faces), center, radius (round faces), feature }. The name works in face('F3.C1'). Use it to find the face you mean before selecting it; the surface kind and radius are fitted from the display mesh. Forces a view build of what is recorded so far, cached until the next feature. Needs await.
   * @domain utilities
   * @example
   * const p = part('Plate').sketch('front', (s) => s.rect(60, 40)).extrude(10).hole(face('>Z'), [0, 0], { diameter: 8 });
   * const bores = (await p.faces()).filter((f) => f.kind === 'cylinder');   // one R4 bore
   * @see face, faces, part.faceCount
   */
  faces(): Promise<FaceFact[]> { return this.readStep('faces', { geometry: true }, (f) => f.faces); }
  /**
   * Read the edges of the part built so far: key, midpoint, length, adjacent faces.
   *
   * Returns { key, mid, length, faces } per edge. The key (like 'F2.C0|F2.S.l1#0') is what the object form of fillet({ radius: { [key]: r } }) takes. Needs await.
   * @domain utilities
   * @example
   * const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);
   * const es = await p.edges();   // 12 edges
   * @see part.fillet, edges
   */
  edges(): Promise<Array<{ key: string; mid: Vec; length: number; faces: string[] }>> { return this.readStep('edges', { geometry: true }, (f) => f.edges); }

  private expectStep(label: string, need: FactNeed, check: (f: Facts) => string | null): this {
    const line = callerLine();
    this.steps.push({ line, label: `expect ${label}`, run: () => [], read: async (rt) => { const msg = check(await rt.facts(need)); if (msg) rt.fail(msg, line); } });
    return this;
  }
  /**
   * Check the volume of the part built so far; a mismatch is reported as an error with this line.
   *
   * expectVolume(v, { tol }) compares with relative tolerance tol (default 1e-3), or { abs } in mm3. No await needed: it is a step, checked when the runner reaches it (a build of what is recorded so far, cached with other reads). A failure is listed in the run errors as 'Line N: expected volume V, got W' and the run goes on. The volume is the kernel's exact value, so analytic references (boxes, cylinders) match to 1e-6.
   * @domain utilities
   * @param v expected volume in mm3
   * @param o.tol relative tolerance, default 1e-3
   * @param o.abs absolute tolerance in mm3 (instead of tol)
   * @example
   * part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20).expectVolume(24000, { tol: 1e-6 });
   * @see part.volume, part.expectValid, part.expectBBox
   */
  expectVolume(v: number, o: { tol?: number; abs?: number } = {}): this {
    return this.expectStep('volume', { mass: true }, (f) => {
      const got = f.volume ?? NaN;
      const tol = o.abs !== undefined ? o.abs : Math.abs(v) * (o.tol ?? 1e-3);
      return Math.abs(got - v) <= tol ? null : `expected volume ${v} (tolerance ${+tol.toPrecision(3)}), got ${+got.toPrecision(8)}`;
    });
  }
  /**
   * Check that the part built so far passes the kernel's validity check.
   *
   * expectValid() fails with the validator's first issue (code and entity) as an error with this line. No await needed.
   * @domain utilities
   * @example
   * part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20).expectValid();
   * @see part.isValid, part.expectVolume
   */
  expectValid(): this {
    return this.expectStep('valid', { validate: true }, (f) => (f.valid === true ? null : `the part is not valid: ${f.issues.slice(0, 3).map((i) => `${i.code} on ${i.entity}`).join('; ') || 'no answer from the validator'}`));
  }
  /**
   * Check the bounding box of the part built so far.
   *
   * expectBBox({ min, max, size }, { tol }) checks the keys you give (each [x, y, z]) to an absolute tol in mm (default 1e-3). Use size to check the extents without caring where the part sits. No await needed.
   * @domain utilities
   * @param box { min?, max?, size? } each [x, y, z]
   * @param o.tol absolute tolerance in mm, default 1e-3
   * @example
   * part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20).expectBBox({ size: [40, 30, 20], min: [-20, -15, 0] });
   * @see part.bbox, plane
   */
  expectBBox(box: { min?: Vec; max?: Vec; size?: Vec }, o: { tol?: number } = {}): this {
    const tol = o.tol ?? 1e-3;
    return this.expectStep('bbox', { geometry: true }, (f) => {
      if (!f.bbox) return 'there is no body to measure';
      const got: Record<string, Vec> = { min: f.bbox.min, max: f.bbox.max, size: [0, 1, 2].map((k) => f.bbox!.max[k] - f.bbox!.min[k]) as Vec };
      for (const key of ['min', 'max', 'size'] as const) {
        const want = box[key];
        if (want && want.some((w, k) => Math.abs(w - got[key][k]) > tol)) return `expected bbox ${key} [${want.join(', ')}] (tolerance ${tol}), got [${got[key].map((x) => +x.toFixed(4)).join(', ')}]`;
      }
      return null;
    });
  }
  /**
   * Check the number of faces of the part built so far.
   *
   * expectFaceCount(n) fails with the actual count when it differs. A cheap regression check after patterns and fillets. No await needed.
   * @domain utilities
   * @param n expected face count
   * @example
   * part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20).expectFaceCount(6);
   * @see part.faceCount
   */
  expectFaceCount(n: number): this { return this.expectStep('face count', { geometry: true }, (f) => (f.faceCount === n ? null : `expected ${n} faces, got ${f.faceCount}`)); }
}

export type PatternSeed = 'last' | string | FeatureHandle | Array<string | FeatureHandle>;
export interface LinearOpts {
  count: number; spacing?: Num; totalLength?: Num;
  direction?: 'x' | 'y' | 'z' | Vec | EdgeSel; axis?: 'x' | 'y' | 'z';
  reverse?: boolean;
  second?: { direction?: 'x' | 'y' | 'z' | Vec | EdgeSel; axis?: 'x' | 'y' | 'z'; count: number; spacing?: Num; totalLength?: Num; reverse?: boolean };
}
export interface CircularOpts { count: number; axis?: 'x' | 'y' | 'z' | number[] | EdgeSel; angle?: number; total?: number; equalSpacing?: boolean; reverse?: boolean }

function seedIds(seed: PatternSeed, ctx: Ctx, line: number, who: string): string[] {
  const list = Array.isArray(seed) ? seed : [seed];
  return list.map((x) => {
    if (x === 'last') { if (!ctx.lastFeature) throw new SelectorError(`${who}() needs a feature before it`, line); return ctx.lastFeature; }
    const id = typeof x === 'string' ? x : x.id;
    if (!id) throw new SelectorError(`${who}(): the feature handle is not resolved yet (take part.handle() after the feature)`, line);
    return id;
  });
}
const WORLD = ['x', 'y', 'z'] as const;
/** A direction as a world axis plus a sign: the kernel patterns along x, y, z only. */
function worldDir(d: 'x' | 'y' | 'z' | Vec | EdgeSel | number[], ctx: Ctx, line: number, who: string): { axis: 'x' | 'y' | 'z'; negative: boolean } {
  if (typeof d === 'string') { if (!WORLD.includes(d)) throw new SelectorError(`${who}(): direction must be 'x', 'y', 'z', a vector or an edge`, line); return { axis: d, negative: false }; }
  let v: number[];
  if (Array.isArray(d)) v = d;
  else {
    const e = resolveEdgeInfos(d.sel, ctx.geo, d.line, ctx.warn)[0];
    const pts = e.pts ?? [];
    if (pts.length < 2) throw new SelectorError(`${who}(): the edge has no direction`, line);
    v = [pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1], pts[pts.length - 1][2] - pts[0][2]];
  }
  const l = Math.hypot(v[0], v[1], v[2]);
  const k = l < 1e-12 ? -1 : [0, 1, 2].find((i) => Math.abs(v[i]) / l > 1 - 1e-6);
  if (k === undefined || k < 0) throw new SelectorError(`${who}(): the kernel patterns along the world x, y or z axis only; [${v.map((x) => +x.toFixed(3)).join(', ')}] is oblique (build the repeats with holes.points / separate sketches, or rotate the part so the direction is an axis)`, line);
  return { axis: WORLD[k], negative: v[k] < 0 };
}
function worldAxis(a: 'x' | 'y' | 'z' | number[] | EdgeSel, ctx: Ctx, line: number): { axis: 'x' | 'y' | 'z'; negative: boolean } {
  if (typeof a === 'string') return worldDir(a, ctx, line, 'circularPattern');
  if (Array.isArray(a)) {
    if (a.length === 3) return worldDir(a, ctx, line, 'circularPattern');
    if (a.length !== 6) throw new SelectorError('circularPattern(): axis as [ox, oy, oz, dx, dy, dz]', line);
    const d = worldDir([a[3], a[4], a[5]], ctx, line, 'circularPattern');
    const k = WORLD.indexOf(d.axis);
    if ([0, 1, 2].some((i) => i !== k && Math.abs(a[i]) > 1e-6)) throw new SelectorError('circularPattern(): the kernel rotates about a world axis through the origin; this axis is offset (centre the part on it, or use holes.polar)', line);
    return d;
  }
  const e = resolveEdgeInfos(a.sel, ctx.geo, a.line, ctx.warn)[0];
  const d = worldDir(a, ctx, line, 'circularPattern');
  const k = WORLD.indexOf(d.axis);
  const p = e.pts?.[0] ?? e.mid!;
  if ([0, 1, 2].some((i) => i !== k && Math.abs(p[i]) > 1e-6)) throw new SelectorError('circularPattern(): the edge is not on a world axis through the origin; the kernel cannot rotate about it', line);
  return d;
}

installFeatures({ callerLine, ref, num, SelectorError, resolveFace, resolveFaceSel, resolveEdges, newSketch: () => new SketchBuilder() }, PartBuilder, SketchBuilder);

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
    /**
     * Put the features recorded inside `build` in a named folder of the feature tree.
     *
     * The free-function form of part.group: group('Tach gauge', () => { ... }) applies to the part started last with part().
     * @domain utilities
     * @param name folder name
     * @param build callback that records the features
     * @example
     * const p = part('Dash');
     * group('Panel', () => { p.sketch('front', (s) => s.rect(100, 50), 'Panel').extrude(5); });
     * @see part.group
     */
    group: (name: string, build: () => void): void => {
      const p = state.parts.at(-1);
      if (!p) throw new SelectorError('group() needs a part() before it', callerLine());
      p.group(name, build);
    },
    face, faces, edges, through, at, plane,
  };
}
export type ScriptApi = ReturnType<typeof makeApi>;

/** Write what appearance() and bodyName() recorded into the document fields `appearance`, `faceAppearance` and `bodyNames`, now that handles have ids. Later calls win field by field. */
export function applyDecor(doc: Record<string, unknown>, part: PartBuilder, warn?: (message: string, line: number) => void): void {
  const appearance: Record<string, Record<string, unknown>> = {}, faceAppearance: Record<string, Record<string, unknown>> = {}, bodyNames: Record<string, string> = {};
  for (const d of part.decor) {
    if (d.face !== undefined) { faceAppearance[d.face] = { ...faceAppearance[d.face], ...d.look }; continue; }
    const id = typeof d.ref === 'string' ? d.ref : d.ref?.id ?? null;
    if (id && d.allFaces) { faceAppearance[id + '.*'] = { ...faceAppearance[id + '.*'], ...d.look }; continue; }
    if (!id) { warn?.('appearance / bodyName: the feature handle is not resolved (take part.handle() after the feature)', d.line); continue; }
    if (d.look) appearance[id] = { ...appearance[id], ...d.look };
    if (d.name) bodyNames[id] = d.name;
  }
  if (Object.keys(appearance).length) doc.appearance = appearance; else delete doc.appearance;
  if (Object.keys(faceAppearance).length) doc.faceAppearance = faceAppearance; else delete doc.faceAppearance;
  if (Object.keys(bodyNames).length) doc.bodyNames = bodyNames; else delete doc.bodyNames;
  // library fonts the text entities name: the app loads them by id when it opens the document
  const ids = new Set<string>();
  for (const st of part.steps) for (const e of (st.sk?.entities ?? []) as Array<{ type?: string; font?: unknown }>) if (e.type === 'text' && typeof e.font === 'string' && CURATED_FONT_IDS.includes(e.font)) ids.add(e.font);
  if (ids.size) doc.fonts = [...ids].map((id) => ({ name: id, source: 'curated', id })); else delete doc.fonts;
}
