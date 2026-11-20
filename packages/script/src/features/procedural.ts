// Procedural curves and surfaces kept as their definitions: projectCurve (with keepExact), offsetCurve, compositeCurve, sweepSurface,
// blendSurface, the N-sided fill, and the read-only intersection check. Each emits exactly the kernel feature (field names of
// part-model's features.ts). Mixed into PartBuilder by features/index.ts.
import type { Ctx, EditOp, FeatureHandle, Num, PartBuilder } from '../recorder';
import type { EdgeSel, FaceSel, FacesSel } from '../selectors';
import { H, memOf, sketchOps, type SketchSpec } from './h';

type Vec = [number, number, number];
type Wire = Record<string, unknown>;
/** A curve given to a curve or surface feature: a sketch drawn here ({ on, draw }), an earlier curve feature (its handle, its id, or 'last'), or edges(sel). */
export type CurveIn = SketchSpec | FeatureHandle | string | EdgeSel;

const isObj = (v: unknown): v is Wire => !!v && typeof v === 'object' && !Array.isArray(v);
const isEdges = (v: unknown): v is EdgeSel => isObj(v) && v.kind === 'edges' && 'sel' in v;
const isSpec = (v: unknown): v is SketchSpec => isObj(v) && 'on' in v && ('draw' in v || 'point' in v);
const isVec = (v: unknown): v is Vec => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const vec3 = (v: unknown, what: string, line: number): Vec => { if (!isVec(v)) throw new H.SelectorError(`${what} must be [x, y, z]`, line); return v; };
const posNum = (v: unknown, what: string, line: number): void => { if (v !== undefined && !(typeof v === 'number' && v > 0)) throw new H.SelectorError(`${what} must be a number above 0`, line); };

/** The id of a curve feature named by a handle, an id or 'last'. */
function featureId(ctx: Ctx, c: FeatureHandle | string, what: string, line: number): string {
  const id = typeof c === 'string' ? (c === 'last' ? ctx.lastFeature : c) : c.id;
  if (!id) throw new H.SelectorError(`${what}: the curve is not built yet (take part.handle() right after the curve feature)`, line);
  return id;
}
const faceIds = (ctx: Ctx, f: FaceSel | FacesSel): string[] => H.resolveFacesSel(f, ctx.geo, ctx.warn).map((x) => x.id);

/** The curve references of one input, in order: a sketch drawn here gives each of its curves, an edge selection each edge, a feature itself. */
function refsOf(ctx: Ctx, c: CurveIn, ops: EditOp[], what: string, line: number): Wire[] {
  if (isEdges(c)) return H.resolveEdges(c.sel, ctx.geo, c.line).map((e) => ({ kind: 'edge', faces: e.faces, at: e.at }));
  if (isSpec(c)) {
    const sketch = sketchOps(ctx, c, ops);
    const ents = (ops[ops.length - 1] as unknown as { feature: { entities: Array<{ id: string; type: string; construction?: boolean }> } }).feature.entities;
    return ents.filter((e) => !e.construction && e.type !== 'point').map((e) => ({ kind: 'sketchCurve', sketch, entity: e.id }));
  }
  return [{ kind: 'curve', id: featureId(ctx, c as FeatureHandle | string, what, line) }];
}

/** The source fields of projectCurve / offsetCurve / compositeCurve: none given is the last sketch; a list (or edges) is `curves` in chain order. */
function sourceOf(ctx: Ctx, c: CurveIn | CurveIn[] | undefined, ops: EditOp[], what: string, line: number): Wire {
  if (c === undefined) {
    if (!ctx.lastSketch) throw new H.SelectorError(`${what}: draw a sketch before it, or give the curve ({ on, draw }, a curve handle, or edges(sel))`, line);
    const sketch = ctx.lastSketch; ctx.lastSketch = null;
    return { sketch };
  }
  if (Array.isArray(c)) {
    if (!c.length) throw new H.SelectorError(`${what}: the curve list is empty`, line);
    return { curves: c.flatMap((x) => refsOf(ctx, x, ops, what, line)) };
  }
  if (isEdges(c)) return { curves: refsOf(ctx, c, ops, what, line) };
  if (isSpec(c)) return { sketch: sketchOps(ctx, c, ops) };
  return { curve: featureId(ctx, c as FeatureHandle | string, what, line) };
}

/** A profile or path of sweepSurface: a sketch or curve feature id, else a list of curve references. */
function fieldOf(ctx: Ctx, c: CurveIn | CurveIn[], ops: EditOp[], what: string, line: number): string | Wire[] {
  if (Array.isArray(c)) return c.flatMap((x) => refsOf(ctx, x, ops, what, line));
  if (isEdges(c)) return refsOf(ctx, c, ops, what, line);
  if (isSpec(c)) return sketchOps(ctx, c, ops);
  return featureId(ctx, c as FeatureHandle | string, what, line);
}

/** The open (one-face) edges of the sheets built so far (the host's `openEdges`) that lie in the extreme plane `sel` names ('>Z', '<X', ...; 'all': every open edge), chained end to end. */
function openLoop(ctx: Ctx, sel: string, line: number): Array<{ faces: string[]; at: number[] }> {
  type E = { faces?: string[]; mid?: number[]; pts?: number[][] };
  let open = ((ctx.geo.openEdges ?? []) as E[]).filter((e) => e.faces?.length === 1 && e.mid && e.pts && e.pts.length >= 2);
  if (!open.length) throw new H.SelectorError('fillNSided(): there are no open edges (make a sheet first: surfaceExtrude, surfacePlanar, knit)', line);
  if (sel !== 'all') {
    const k = 'XYZ'.indexOf(sel[1].toUpperCase()), sign = sel[0] === '>' ? 1 : -1;
    const best = Math.max(...open.map((e) => e.mid![k] * sign));
    open = open.filter((e) => e.pts!.every((q) => Math.abs(q[k] * sign - best) < 1e-3));
  }
  // chain: each next edge starts where the last one ended (either way round)
  const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-4;
  const left = open.slice(1), out = [open[0]];
  let end = open[0].pts!.at(-1)!;
  while (left.length) {
    const i = left.findIndex((e) => near(e.pts![0], end) || near(e.pts!.at(-1)!, end));
    if (i < 0) break;
    const [e] = left.splice(i, 1);
    end = near(e.pts![0], end) ? e.pts!.at(-1)! : e.pts![0];
    out.push(e);
  }
  if (left.length) throw new H.SelectorError(`fillNSided('${sel}'): the open edges there form more than one loop (${left.length} left over); give the edges as a list of { faces, at }`, line);
  return out.map((e) => ({ faces: [...e.faces!], at: [...e.mid!] }));
}

/** The open (one-face) edges of the surface bodies of a regen reply (`surfaces`: [id, body] pairs), for a script host to add to the
 *  geometry it returns as `openEdges` (apart from the solid's `edges`, so the edge facts and selectors do not change); fillNSided reads them. */
export function openSheetEdges(surfaces: unknown): Array<{ faces: string[]; mid: number[]; pts: number[][] }> {
  if (!Array.isArray(surfaces)) return [];
  const out: Array<{ faces: string[]; mid: number[]; pts: number[][] }> = [];
  for (const pair of surfaces) {
    const edges = Array.isArray(pair) && pair[1] && typeof pair[1] === 'object' ? (pair[1] as { edges?: unknown }).edges : null;
    if (!Array.isArray(edges)) continue;
    for (const e of edges as Array<{ faces?: unknown; mid?: unknown; pts?: unknown }>) {
      if (Array.isArray(e.faces) && e.faces.length === 1 && isVec(e.mid) && Array.isArray(e.pts) && e.pts.length >= 2) out.push({ faces: [...(e.faces as string[])], mid: [...e.mid], pts: e.pts as number[][] });
    }
  }
  return out;
}

/** The kernel's intersection check: per pair of faces, how many spans of the marched intersection curves are proved. */
export interface IntersectionReport {
  curves: number; marched: number; spans: number; proved: number; repaired: number; unresolved: number; pairs: number;
  issues: Array<{ a: string; b: string; curve: number; span: number; reason: string; repaired?: boolean }>;
  truncated?: boolean;
}

export const proceduralFeatures = {
  /**
   * Project a curve onto faces (exact on one).
   *
   * Projects the last sketch (or o.curve: { on, draw }, a curve handle, or edges(sel)) onto the faces given (none: every face). By default the result is one fitted B-spline (degree, tolerance; direction 'both' | 'forward' | 'reverse' from the sketch plane). keepExact: true keeps the projection as its definition onto exactly ONE face, so it stays exact when the face or sketch changes; it then takes a list of curves in chain order and along: 'normal' (closest point) or [x, y, z]. A projection that leaves the face is projectCurveMisses. Adds no body: take part.handle() for a sweep path or a later curve.
   * @domain surfaces
   * @param onto face(sel) or faces(sel) to project onto; keepExact needs exactly one
   * @param o.curve what to project; default the last sketch; with keepExact also a list
   * @param o.keepExact keep the exact projection (procedural) instead of a fitted spline
   * @param o.along keepExact: 'normal' or a direction [x, y, z]; default the sketch normal
   * @param o.direction fitted: 'both' (default), 'forward' or 'reverse'
   * @param o.degree fitted: B-spline degree 2 to 9, default 3
   * @param o.tolerance largest deviation in mm, default 0.001
   * @example
   * part('Mark').sketch('front', (s) => s.rect(40, 25)).extrude(10)
   *   .sketch(at('front', 20), (s) => s.circle(6, [20, 10]))
   *   .projectCurve(face('>Z'), { keepExact: true });
   * @see part.offsetCurve, part.compositeCurve, part.sweepSurface
   */
  projectCurve(this: PartBuilder, onto: FaceSel | FacesSel, o: { curve?: CurveIn | CurveIn[]; keepExact?: boolean; along?: 'normal' | Vec; direction?: 'both' | 'forward' | 'reverse'; degree?: Num; tolerance?: Num; gapTolerance?: Num; name?: string } = {}): PartBuilder {
    const line = H.callerLine();
    if (!o.keepExact && (Array.isArray(o.curve) || isEdges(o.curve))) throw new H.SelectorError('projectCurve(): a list of curves or edges needs keepExact: true (the fitted projection takes one sketch or curve)', line);
    if (!o.keepExact && (o.along !== undefined || o.gapTolerance !== undefined)) throw new H.SelectorError('projectCurve(): along and gapTolerance need keepExact: true', line);
    if (o.keepExact && (o.degree !== undefined || o.direction !== undefined)) throw new H.SelectorError('projectCurve(): degree and direction are for the fitted projection; keepExact uses along', line);
    if (o.along !== undefined && o.along !== 'normal') vec3(o.along, "projectCurve(): along ('normal' or a direction)", line);
    if (o.direction !== undefined && !['both', 'forward', 'reverse'].includes(o.direction)) throw new H.SelectorError("projectCurve(): direction is 'both', 'forward' or 'reverse'", line);
    this.steps.push({ line, label: 'projectCurve', run: (ctx) => {
      const ops: EditOp[] = [];
      const faces = onto ? faceIds(ctx, onto) : [];
      if (o.keepExact && faces.length !== 1) throw new H.SelectorError(`projectCurve(): keepExact projects onto exactly one face (got ${faces.length})`, line);
      const src = sourceOf(ctx, o.curve, ops, 'projectCurve()', line);
      const id = ctx.nextId();
      const f: Wire = { type: 'projectCurve', id, ...(o.name ? { name: o.name } : {}), ...src, faces };
      if (o.keepExact) {
        f.procedural = true;
        if (o.along !== undefined) f.along = o.along;
        if (o.gapTolerance !== undefined) f.gapTolerance = H.ref(o.gapTolerance);
      } else { f.degree = o.degree !== undefined ? H.ref(o.degree) : 3; f.direction = o.direction ?? 'both'; }
      f.tolerance = o.tolerance !== undefined ? H.ref(o.tolerance) : 0.001;
      ops.push({ op: 'add', feature: f });
      ctx.lastFeature = id;
      return ops;
    } });
    return this;
  },

  /**
   * Offset a curve or chain by a distance.
   *
   * Offsets the last sketch (or o.curve: { on, draw }, a curve handle, edges(sel) or a list in chain order) by distance in its own plane: positive to the right of travel seen from the plane normal. o.plane, o.face (offset in the face's tangent planes) or o.normal [x, y, z] say where instead; a straight line alone has no plane (offsetCurvePlane). Lines and arcs stay lines and arcs, so a sweep along it is exact. Adds no body: take part.handle().
   * @domain surfaces
   * @param distance offset in mm, not 0
   * @param o.curve what to offset; default the last sketch
   * @param o.plane plane to offset in: 'front' | 'top' | 'right' or a plane handle
   * @param o.face face(sel) whose tangent planes the offset runs in
   * @param o.normal the normal of the offset plane [x, y, z]
   * @param o.tolerance spline tolerance in mm, default 0.001
   * @example
   * const p = part('Rail').sketch('front', (s) => s.arc([0, 0], [6, 0], [0, 6])).offsetCurve(-1);
   * const rail = p.handle();
   * @see part.compositeCurve, part.projectCurve, part.sweepSurface
   */
  offsetCurve(this: PartBuilder, distance: Num, o: { curve?: CurveIn | CurveIn[]; plane?: 'front' | 'top' | 'right' | FeatureHandle; face?: FaceSel; normal?: Vec; tolerance?: Num; gapTolerance?: Num; name?: string } = {}): PartBuilder {
    const line = H.callerLine();
    if (distance === undefined || distance === 0) throw new H.SelectorError('offsetCurve(distance): give a distance in mm, not 0', line);
    const where = (['plane', 'face', 'normal'] as const).filter((k) => o[k] !== undefined);
    if (where.length > 1) throw new H.SelectorError(`offsetCurve(): give one of plane, face and normal (got ${where.join(' + ')})`, line);
    if (o.normal !== undefined) vec3(o.normal, 'offsetCurve(): normal', line);
    this.steps.push({ line, label: 'offsetCurve', run: (ctx) => {
      const ops: EditOp[] = [];
      const src = sourceOf(ctx, o.curve, ops, 'offsetCurve()', line);
      const id = ctx.nextId();
      const f: Wire = { type: 'offsetCurve', id, ...(o.name ? { name: o.name } : {}), ...src, distance: H.ref(distance) };
      if (typeof o.plane === 'string') f.plane = { kind: 'std', id: o.plane };
      else if (o.plane) f.plane = { kind: 'feature', id: featureId(ctx, o.plane, 'offsetCurve(): plane', line) };
      if (o.face) f.face = H.resolveFaceSel(o.face, ctx.geo, ctx.warn).id;
      if (o.normal) f.normal = o.normal;
      f.tolerance = o.tolerance !== undefined ? H.ref(o.tolerance) : 0.001;
      if (o.gapTolerance !== undefined) f.gapTolerance = H.ref(o.gapTolerance);
      ops.push({ op: 'add', feature: f });
      ctx.lastFeature = id;
      return ops;
    } });
    return this;
  },

  /**
   * Join curves into one exact curve.
   *
   * Joins the curves of the last sketch (walked into one chain), or o.curves: a list of { on, draw } sketches, curve handles and edges(sel), in the order they join. Pieces are turned to run end to end; ends further apart than gapTolerance (default 1e-5 mm) are refused. Adds no body: take part.handle() for a sweep path or an offset.
   * @domain surfaces
   * @param o.curves the curves in chain order; default the last sketch
   * @param o.gapTolerance largest gap between pieces in mm
   * @param o.tolerance spline tolerance in mm, default 0.001
   * @example
   * part('Chain').sketch('front', (s) => s.polyline([[0, 0], [20, 0], [20, 10]])).compositeCurve();
   * @see part.offsetCurve, part.sweepSurface
   */
  compositeCurve(this: PartBuilder, o: { curves?: CurveIn[]; gapTolerance?: Num; tolerance?: Num; name?: string } = {}): PartBuilder {
    const line = H.callerLine();
    if (o.curves !== undefined && !Array.isArray(o.curves)) throw new H.SelectorError('compositeCurve(): curves is a list (sketches { on, draw }, curve handles, edges(sel)) in chain order', line);
    this.steps.push({ line, label: 'compositeCurve', run: (ctx) => {
      const ops: EditOp[] = [];
      const src = sourceOf(ctx, o.curves, ops, 'compositeCurve()', line);
      const id = ctx.nextId();
      const f: Wire = { type: 'compositeCurve', id, ...(o.name ? { name: o.name } : {}), ...src, tolerance: o.tolerance !== undefined ? H.ref(o.tolerance) : 0.001 };
      if (o.gapTolerance !== undefined) f.gapTolerance = H.ref(o.gapTolerance);
      ops.push({ op: 'add', feature: f });
      ctx.lastFeature = id;
      return ops;
    } });
    return this;
  },

  /**
   * Sweep a profile along a path.
   *
   * profile and path are each { on, draw }, a curve handle (helix, offsetCurve, compositeCurve, projectCurve; a procedural one is swept along its definition) or edges(sel). frame 'tangent' (default) turns the profile with the path, 'translate' keeps its orientation; up [x, y, z] fixes the roll. caps: true closes a closed planar profile at both ends, so knit({ solid: true }) makes a solid. Refusals: sweepSurfaceFrame (up along the path), sweepSurfaceFold (profile wider than the bend), sweepSurfaceCaps.
   * @domain surfaces
   * @param profile the curve swept
   * @param path the curve it travels along
   * @param o.frame 'tangent' (default) or 'translate'
   * @param o.up a fixed up direction [x, y, z]
   * @param o.caps close the ends (closed planar profile)
   * @param o.tolerance spline tolerance in mm, default 0.001
   * @example
   * part('Tube').sweepSurface(
   *   { on: 'front', draw: (s) => s.circle(2) },
   *   { on: 'right', draw: (s) => s.line([0, 0], [25, 0]) }, { caps: true })
   *   .knit({ solid: true });
   * @see part.offsetCurve, part.sweep, part.knit
   */
  sweepSurface(this: PartBuilder, profile: CurveIn | CurveIn[], path: CurveIn | CurveIn[], o: { frame?: 'tangent' | 'translate'; up?: Vec; caps?: boolean; tolerance?: Num; gapTolerance?: Num; name?: string } = {}): PartBuilder {
    const line = H.callerLine();
    if (!profile || !path) throw new H.SelectorError('sweepSurface(profile, path): give both, each { on, draw }, a curve handle or edges(sel)', line);
    if (o.frame !== undefined && !['tangent', 'translate'].includes(o.frame)) throw new H.SelectorError("sweepSurface(): frame is 'tangent' (default) or 'translate'", line);
    if (o.up !== undefined) vec3(o.up, 'sweepSurface(): up', line);
    posNum(o.tolerance, 'sweepSurface(): tolerance', line);
    this.steps.push({ line, label: 'sweepSurface', run: (ctx) => {
      const ops: EditOp[] = [];
      const pf = fieldOf(ctx, profile, ops, 'sweepSurface(): profile', line);
      const pa = fieldOf(ctx, path, ops, 'sweepSurface(): path', line);
      const id = ctx.nextId();
      const f: Wire = { type: 'sweepSurface', id, ...(o.name ? { name: o.name } : {}), profile: pf, path: pa, frame: o.frame ?? 'tangent', tolerance: o.tolerance !== undefined ? H.ref(o.tolerance) : 0.001 };
      if (o.up) f.up = o.up;
      if (o.caps) f.caps = true;
      if (o.gapTolerance !== undefined) f.gapTolerance = H.ref(o.gapTolerance);
      memOf(ctx).surfaces.push(id);
      ops.push({ op: 'add', feature: f });
      ctx.lastFeature = id; ctx.lastSketch = null;
      return ops;
    } });
    return this;
  },

  /**
   * Rolling-ball blend of two faces.
   *
   * faces is faces(sel) matching two faces, or [face(a), face(b)]; radius a number or [start, end] for a radius that varies along the span. The span is the edge the faces share (at [x, y, z] picks the nearest when they share several) or the line from o.from to o.to. sides [s1, s2] (+1 the side a face's normal points to, -1 the other) picks where the ball rolls; default each face turns toward the other. Refusals: blendSurfaceRadius (with the largest radius that fits), blendSurfaceNoContact.
   * @domain surfaces
   * @param faces the two faces
   * @param radius radius in mm, or [start, end]
   * @param o.sides [1 | -1, 1 | -1]
   * @param o.at with a shared edge: the point the chosen edge is nearest
   * @param o.from start of a two-point span [x, y, z]
   * @param o.to end of a two-point span [x, y, z]
   * @example
   * part('Round').sketch('front', (s) => s.rect(40, 25)).extrude(10)
   *   .blendSurface([face('>Z'), face('<Y')], 3);
   * @see part.fillet, part.sweepSurface, part.knit
   */
  blendSurface(this: PartBuilder, faces: FacesSel | [FaceSel, FaceSel], radius: Num | [Num, Num], o: { sides?: [number, number]; at?: Vec; from?: Vec; to?: Vec; tolerance?: Num; name?: string } = {}): PartBuilder {
    const line = H.callerLine();
    const rs = Array.isArray(radius) ? radius : [radius];
    if (radius === undefined || rs.length > 2 || rs.some((r) => typeof r === 'number' && !(r > 0))) throw new H.SelectorError('blendSurface(faces, radius): the radius is a number above 0, or [start, end]', line);
    if (o.sides !== undefined && !(Array.isArray(o.sides) && o.sides.length === 2 && o.sides.every((s) => s === 1 || s === -1))) throw new H.SelectorError('blendSurface(): sides is [1 | -1, 1 | -1]', line);
    if ((o.from === undefined) !== (o.to === undefined)) throw new H.SelectorError('blendSurface(): a two-point span needs both from and to', line);
    for (const k of ['at', 'from', 'to'] as const) if (o[k] !== undefined) vec3(o[k], `blendSurface(): ${k}`, line);
    if (o.from && o.at) throw new H.SelectorError('blendSurface(): at chooses a shared edge; with from / to the span is the line between them', line);
    this.steps.push({ line, label: 'blendSurface', run: (ctx) => {
      const ids = Array.isArray(faces) ? faces.map((f) => H.resolveFaceSel(f, ctx.geo, ctx.warn).id) : faceIds(ctx, faces);
      if (ids.length !== 2 || ids[0] === ids[1]) throw new H.SelectorError(`blendSurface(): give two different faces (got ${ids.length === 2 ? 'the same face twice' : ids.length})`, line);
      const id = ctx.nextId();
      const f: Wire = { type: 'blendSurface', id, ...(o.name ? { name: o.name } : {}), faces: ids, radius: Array.isArray(radius) ? radius.map((r) => H.ref(r)) : H.ref(radius), tolerance: o.tolerance !== undefined ? H.ref(o.tolerance) : 0.001 };
      if (o.sides) f.sides = o.sides;
      if (o.at) f.at = o.at;
      if (o.from) { f.from = o.from; f.to = o.to; }
      memOf(ctx).surfaces.push(id);
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Fill a loop of sheet edges with N faces.
   *
   * loop is where the open (one-face) edges of a sheet are: '>Z' / '<Z' (likewise X, Y) the open edges lying in the top / bottom plane, 'all' every open edge, or a list of edge references [{ faces: ['F2.S.e1'], at: [x, y, z] }]. They must close one loop (chained here end to end); the fill is N bicubic faces meeting at a centre vertex, one per edge, merged with the sheet. continuity 'G0' (default) touches the boundary, 'G1' is tangent to the sheet (G2, G3: fillContinuity). tolerance (default 1e-4 mm) bounds the patch.
   * @domain surfaces
   * @param loop '>Z' | '<Z' | ... | 'all', or a list of { faces, at }
   * @param o.continuity 'G0' (default) or 'G1'
   * @param o.tolerance patch tolerance in mm, default 1e-4
   * @example
   * part('Bin').sketch('front', (s) => s.rect(20, 10)).surfaceExtrude(5)
   *   .sketch('front', (s) => s.rect(20, 10)).surfacePlanar().knit()
   *   .fillNSided('>Z', { continuity: 'G1' });
   * @see part.knit, part.surfaceExtrude
   */
  fillNSided(this: PartBuilder, loop: string | Array<{ faces: string[]; at: Vec }>, o: { continuity?: 'G0' | 'G1'; tolerance?: Num; name?: string } = {}): PartBuilder {
    const line = H.callerLine();
    if (typeof loop === 'string' ? !/^(all|[<>][XYZxyz])$/.test(loop.trim()) : !Array.isArray(loop) || loop.some((r) => !isObj(r) || !Array.isArray(r.faces) || !isVec(r.at)))
      throw new H.SelectorError("fillNSided(loop): give '>Z' / '<Z' (likewise X, Y) or 'all' for the open edges of the sheet, or a list of { faces, at }", line);
    if (o.continuity !== undefined && o.continuity !== 'G0' && o.continuity !== 'G1') throw new H.SelectorError("fillNSided(): continuity is 'G0' or 'G1' (the N-sided patch is not G2 / G3)", line);
    posNum(o.tolerance, 'fillNSided(): tolerance', line);
    this.steps.push({ line, label: 'fillNSided', run: (ctx) => {
      const refs = typeof loop === 'string' ? openLoop(ctx, loop.trim(), line) : loop.map((r) => ({ faces: [...r.faces], at: [...r.at] }));
      if (refs.length < 2) throw new H.SelectorError(`fillNSided(): the loop needs at least two edges (got ${refs.length})`, line);
      const id = ctx.nextId();
      ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'fill', id, ...(o.name ? { name: o.name } : {}), edges: refs, merge: true, continuity: o.continuity ?? 'G0', fairing: 'meowNURBS', patch: 'nSided', patchTolerance: o.tolerance !== undefined ? H.ref(o.tolerance) : 1e-4 } }];
    } });
    return this;
  },

  /**
   * Proof check of face intersection curves.
   *
   * await part.checkIntersection(faces?) builds what is recorded so far and asks the kernel to march the intersection curves of the faces given (face(sel) or faces(sel)) against every face of the part, or (none given) of the part against itself, and to prove each span lies on one arc of the true intersection. Returns { pairs, curves, marched, spans, proved, repaired, unresolved, issues }: unresolved 0 means every marched span is proved; issues name the faces and the reason. Read only: adds no feature. Needs await.
   * @domain utilities
   * @param faces face(sel) or faces(sel); default every face
   * @example
   * const p = part('Cross').sketch('top', (s) => s.circle(10)).extrude(20, { mid: true });
   * const r = await p.checkIntersection();
   * @see part.isValid, part.faces
   */
  checkIntersection(this: PartBuilder, faces?: FaceSel | FacesSel): Promise<IntersectionReport> {
    const line = H.callerLine();
    let names: string[] = [];
    if (faces) this.steps.push({ line, label: 'checkIntersection faces', run: (ctx) => { names = faceIds(ctx, faces); return []; } });
    return new Promise<IntersectionReport>((resolve, reject) => {
      this.steps.push({ line, label: 'read intersection', run: () => [], read: async (rt) => {
        try {
          const f = await rt.facts({ intersection: { faces: names } });
          if (!f.intersection) throw new H.SelectorError('checkIntersection(): this host or kernel gives no intersection check', line);
          resolve(f.intersection as unknown as IntersectionReport);
        } catch (e) { reject(e); throw e; }
      } });
    });
  },
};
