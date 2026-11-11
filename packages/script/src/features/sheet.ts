// Sheet metal: rules, base flange, edge flange, hem, fold, contour flange, unfold, refold. Mixed into PartBuilder by features/index.ts.
// Each method writes one kernel feature (the wire shapes are in sheetCatalog.ts and the kernel's docs/sheet-metal.md); numbers may be expressions.
// The base flange and contour flange use the last sketch, as extrude does. Edges are picked by a point on them, an outline index or a role.
import type { EditOp, Num, PartBuilder } from '../recorder';
import { H } from './h';

type P3 = [number, number, number];
type SheetPickBase = { panel?: number; height?: Num; angle?: Num; radius?: Num; heightFrom?: HeightFrom; position?: BendPosition; flip?: boolean };
/** An edge of the base outline: a point on it, {at}, {edge: index}, {role} / {curve}, or a role string such as 'P0.side.e2'. */
export type SheetPick = P3 | string | ({ at: P3 } & SheetPickBase) | ({ edge: number } & SheetPickBase) | ({ role: string } & SheetPickBase) | ({ curve: string } & SheetPickBase);
type HeightFrom = 'outer' | 'inner' | 'tangent';
type BendPosition = 'inside' | 'outside' | 'middle';
/** The outline of a shaped leg: 'sketch' (the last sketch, consumed), { sketch: id }, or an inline closed loop of { line: [[v, h], [v, h]] } / { arc: { center, from, to, ccw } } in the flange's own (v along the flange, h outward) frame. */
export type SheetProfile = 'sketch' | { sketch: string } | Array<{ line: [[number, number], [number, number]] } | { arc: { center: [number, number]; from: [number, number]; to: [number, number]; ccw: boolean } }>;
/** The relief beside a partial flange: 'none', 'rectangular' (the rule's size) or { width, depth } (each defaults to the rule's). */
export type SheetRelief = 'none' | 'rectangular' | { width?: Num | string; depth?: Num | string };

const val = (v: Num | string): number | string => (typeof v === 'string' ? v : H.ref(v));
/** Copy the listed numeric options (as numbers or expressions) and plain options into the feature. */
function put(f: Record<string, unknown>, o: Record<string, unknown>, nums: string[], plain: string[]): void {
  for (const k of nums) if (o[k] !== undefined) f[k] = val(o[k] as Num | string);
  for (const k of plain) if (o[k] !== undefined) f[k] = o[k];
}
const isPoint = (v: unknown): v is P3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
/** The picks of edgeFlange / hem as the kernel takes them; numbers inside an object pick may be expressions. */
function picks(label: string, edges: SheetPick | SheetPick[], line: number): unknown[] {
  const list = isPoint(edges) ? [edges] : Array.isArray(edges) ? edges : [edges];
  if (!list.length) throw new H.SelectorError(`${label}(): name at least one edge: a point on it [x, y, z], { edge: n }, or { role: 'P0.side.e2' }`, line);
  return list.map((p) => {
    if (isPoint(p) || typeof p === 'string') return p;
    if (!p || typeof p !== 'object' || !('at' in p || 'edge' in p || 'role' in p || 'curve' in p)) throw new H.SelectorError(`${label}(): an edge is a point [x, y, z] on it, { at }, { edge: n }, { role: 'P0.side.e2' } or { curve: 'e2' }`, line);
    const out: Record<string, unknown> = { ...p };
    for (const k of ['height', 'angle', 'radius']) if (out[k] !== undefined) out[k] = val(out[k] as Num | string);
    return out;
  });
}
export type SheetCorner = P3 | { panel: number; vertex: number };
const flangeOpts = (f: Record<string, unknown>, o: Record<string, unknown>): void => put(f, o, ['height', 'angle', 'radius'], ['heightFrom', 'position', 'flip']);
/** The part-of-the-edge options: start / length (mm along the edge), or two world points from / to; relief for the notch beside the flange. */
function spanOpts(f: Record<string, unknown>, o: Record<string, unknown>, hem: boolean): void {
  put(f, o, hem ? ['start'] : ['start', 'length'], ['from', 'to']);
  const r = o.relief;
  if (r !== undefined) f.relief = r && typeof r === 'object' ? Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : H.ref(v as Num)])) : r;
}

export const sheetFeatures = {
  /**
   * Sheet stock rule: thickness, k-factor, bend radius.
   *
   * Adds a sheetRules feature. The rule named by baseFlange (or the active rule, the latest one) gives the part its thickness and the bend arithmetic (bend allowance BA = (r + k t) angle). Lengths in mm; any value may be an expression string such as "=Thickness*4" (Thickness is this rule's thickness) or a number with a unit ("2 mm"). Defaults follow the thickness (2.5 when none is given): bendRadius = thickness, kFactor 0.44, reliefWidth = thickness, reliefDepth = thickness / 2, cornerRelief = 4 x thickness, gap = thickness, hemGap 0.01. Put it before the sketch of the base flange.
   * @domain features
   * @param o.name rule name (a rule with an existing name replaces it); baseFlange({ rule }) names it
   * @param o.thickness stock thickness in mm (default 2.5)
   * @param o.kFactor neutral line position 0..1 (default 0.44)
   * @param o.bendRadius default inside bend radius in mm (default = thickness)
   * @param o.reliefWidth bend relief width in mm (default = thickness)
   * @param o.reliefDepth bend relief depth in mm (default thickness / 2)
   * @param o.cornerRelief corner relief size in mm (default 4 x thickness)
   * @param o.cornerReliefShape 'notch' (default) | 'round' | 'rectangular' | 'tear'; the others are stored but built as notch for now
   * @param o.hemGap default inside radius of a hem in mm (default 0.01)
   * @param o.gap gap between the legs of flanges on neighbouring edges made in one feature, mm (default = thickness)
   * @param o.active make this the rule of the next base flange (default true)
   * @example
   * part('Tray').sheetRules({ name: 'Steel2', thickness: 2, kFactor: 0.44, bendRadius: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange({ rule: 'Steel2' });
   * @see part.baseFlange, part.edgeFlange
   */
  sheetRules(this: PartBuilder, o: { name?: string; thickness?: Num | string; kFactor?: Num | string; bendRadius?: Num | string; reliefWidth?: Num | string; reliefDepth?: Num | string; cornerRelief?: Num | string; cornerReliefShape?: 'notch' | 'round' | 'rectangular' | 'tear'; hemGap?: Num | string; gap?: Num | string; active?: boolean } = {}): PartBuilder {
    const line = H.callerLine();
    if (!o || typeof o !== 'object') throw new H.SelectorError('sheetRules() takes an options object, e.g. { name: "Steel2", thickness: 2 }', line);
    this.steps.push({ line, label: 'sheetRules', run: (ctx) => {
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'sheetRules', id };
      put(f, o as Record<string, unknown>, ['thickness', 'kFactor', 'bendRadius', 'reliefWidth', 'reliefDepth', 'cornerRelief', 'hemGap', 'gap'], ['name', 'cornerReliefShape', 'active']);
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Sheet base plate from the last closed sketch.
   *
   * Adds a baseFlange from the last sketch (which it consumes, as extrude does). The sketch must hold ONE closed outline (holes inside it are allowed); the sheet extends along the sketch normal (against it with flip), the sketch plane is the front face and the opposite face the back (cap) face. The thickness comes from the rule (rule name, else the latest sheetRules, else 2.5 mm). One base flange per part, as the first body feature. After it, edgeFlange, hem or fold shape the part, and the flat pattern is read with the sheet_info tool.
   * @domain features
   * @param o.rule name of a sheetRules rule (default: the active rule)
   * @param o.flip extrude against the sketch normal
   * @param o.regions which sketch regions to use, as for extrude (default: the one closed region)
   * @example
   * part('Plate').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange({ rule: 'S2' });
   * @see part.sheetRules, part.edgeFlange, part.contourFlange
   */
  baseFlange(this: PartBuilder, o: { rule?: string; flip?: boolean; regions?: unknown[] } = {}): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'baseFlange', run: (ctx) => {
      if (!ctx.lastSketch) throw new H.SelectorError('baseFlange() needs a sketch before it: sketch(plane, (s) => s.rect(w, h)).baseFlange()', line);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'baseFlange', id, sketch: ctx.lastSketch };
      put(f, o as Record<string, unknown>, [], ['rule', 'flip', 'regions']);
      ctx.lastFeature = id;
      ctx.lastSketch = null;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Bent flange on edges of the base plate.
   *
   * Adds an edgeFlange on the straight outline edges you pick. An edge is a world point ON it ([x, y, z]; the nearest outline edge wins; its height only chooses the side), { edge: n } (index into the outline, counter-clockwise from the sketch), or a role such as { role: 'P0.side.e2' } / { curve: 'e2' } (follows the sketch curve when the sketch changes). On the panel tree any panel takes a flange: 'P2.tip' (free end of leg 2), 'P1.side.start', { edge: n, panel: k }. A point on the cap (back) face bends the flange towards the cap (direction up in the bend table), a point on the front face bends it the other way; flip reverses. Object picks may carry their own height, angle, radius, heightFrom, position and flip. height is measured from heightFrom (outer virtual sharp by default); it must reach the end of the bend (flangeHeightTooLow otherwise). Several edges in one call stay `gap` apart at the corners. then chains further bends on the far edge of the leg.
   * @domain features
   * @param edges a pick or a list of picks: [x, y, z] | { at } | { edge: n } | { role } | { curve } | 'P0.side.e2'
   * @param o.height flange height in mm (required)
   * @param o.angle angle the leg turns through in degrees, 0 < angle < 180 (default 90)
   * @param o.radius inside bend radius in mm (default the rule's)
   * @param o.heightFrom 'outer' (default) | 'inner' | 'tangent': where the height is measured from
   * @param o.position 'inside' (default, the flange's outer face stays within the outline) | 'outside' (the bend starts at the outline edge) | 'middle'
   * @param o.flip bend the other way
   * @param o.then chained bends after the first, at most 16: [{ angle?, height, flip? }]
   * @param o.start part of the edge: mm along the picked edge from its start vertex (the outline runs counter-clockwise); alone it runs to the end of the edge
   * @param o.length part of the edge: how far the flange runs from start (default from the vertex)
   * @param o.from part of the edge: a world point [x, y, z] on the edge (with to; any order, projected onto the edge)
   * @param o.to part of the edge: the other world point
   * @param o.profile a shaped leg: 'sketch' (the last sketch, consumed: its outer loop is the leg, circles inside it are holes; x along the flange from the lower left corner, y outward from the height line), { sketch: id }, or an inline closed loop of lines and arcs in (v, h). height is then the top of the outline
   * @param o.holes holes in a shaped leg: [{ circle: { center: [v, h], radius } }, ...] (or loops), in the profile's frame, beyond the end of the bend
   * @param o.relief the notch beside a partial flange: 'none' (default), 'rectangular' (the rule's reliefWidth x reliefDepth) or { width, depth }
   * @example
   * part('Tray').sheetRules({ name: 'S2', thickness: 2, bendRadius: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange()
   *   .edgeFlange([[50, 0, 2], [50, 60, 2], [0, 30, 2], [100, 30, 2]], { height: 15 });
   * @see part.baseFlange, part.hem, part.fold
   */
  edgeFlange(this: PartBuilder, edges: SheetPick | SheetPick[], o: { height?: Num | string; angle?: Num | string; radius?: Num | string; heightFrom?: HeightFrom; position?: BendPosition; flip?: boolean; then?: Array<{ angle?: Num | string; height: Num | string; flip?: boolean }>; start?: Num | string; length?: Num | string; from?: P3; to?: P3; profile?: SheetProfile; holes?: unknown[]; relief?: SheetRelief }): PartBuilder {
    const line = H.callerLine();
    if (!o || (o.height === undefined && o.profile === undefined)) throw new H.SelectorError('edgeFlange(edges, { height }) needs a height in mm, e.g. edgeFlange([[50, 0, 2]], { height: 20 })', line);
    const list = picks('edgeFlange', edges, line);
    this.steps.push({ line, label: 'edgeFlange', run: (ctx) => {
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'edgeFlange', id, edges: list };
      flangeOpts(f, o as unknown as Record<string, unknown>);
      spanOpts(f, o as unknown as Record<string, unknown>, false);
      if (o.profile !== undefined) {
        if (o.profile === 'sketch') {
          if (!ctx.lastSketch) throw new H.SelectorError("edgeFlange({ profile: 'sketch' }) needs a sketch before it: sketch(plane, (s) => s.rect(w, h)).edgeFlange(edges, { profile: 'sketch' })", line);
          f.profile = { sketch: ctx.lastSketch };
          ctx.lastSketch = null;
        } else f.profile = o.profile;
        if (o.holes !== undefined) f.holes = o.holes;
      }
      if (o.then) f.then = o.then.map((t) => { const c: Record<string, unknown> = {}; put(c, t as Record<string, unknown>, ['angle', 'height'], ['flip']); return c; });
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * 180 degree hem on an edge.
   *
   * Adds a hem on the picked outline edges (picks as for edgeFlange). length is measured to the OUTER face of the hem, so the leg is length - (gap + thickness) and length must be at least gap + thickness (flangeHeightTooLow otherwise). gap is the inside radius of the bend (default the rule's hemGap, 0.01). A point on the cap face curls the hem towards the bottom. Hems on neighbouring edges, or beside an edge flange, are refused.
   * @domain features
   * @param edges a pick or a list of picks (see edgeFlange)
   * @param o.length length to the outer face of the hem in mm (required)
   * @param o.gap inside radius of the hem in mm (default the rule's hemGap)
   * @param o.flip curl the other way
   * @param o.start part of the edge: mm along the picked edge from its start vertex; the hem then runs to the end of the edge
   * @param o.from part of the edge: a world point on the edge (with to; any order)
   * @param o.to part of the edge: the other world point
   * @param o.relief the notch beside a partial hem: 'none' (default), 'rectangular' or { width, depth }
   * @example
   * part('Lip').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange()
   *   .hem([[50, 0, 2]], { length: 10 });
   * @see part.edgeFlange, part.baseFlange
   */
  hem(this: PartBuilder, edges: SheetPick | SheetPick[], o: { length: Num | string; gap?: Num | string; flip?: boolean; start?: Num | string; from?: P3; to?: P3; relief?: SheetRelief }): PartBuilder {
    const line = H.callerLine();
    if (!o || o.length === undefined) throw new H.SelectorError('hem(edges, { length }) needs a length in mm to the outer face of the hem, e.g. hem([[50, 0, 2]], { length: 10 })', line);
    const list = picks('hem', edges, line);
    this.steps.push({ line, label: 'hem', run: (ctx) => {
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'hem', id, edges: list };
      put(f, o as unknown as Record<string, unknown>, ['length', 'gap'], ['flip']);
      spanOpts(f, o as unknown as Record<string, unknown>, true);
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Fold the base along a line.
   *
   * Adds a fold. The line is two world points ([x, y, z], extended across the base) or { curve } of the last sketch (a sketch line, followed when the sketch changes). angle (default 90) is the angle the moving side turns through; position says where the line sits in the bend zone (centerline default, start, end, mould). fixed names the side that stays (a point on it or a wall role; default the larger side); flip turns the moving side down. The flat pattern keeps its size. Folds, flanges and hems combine in any order.
   * @domain features
   * @param o.points two world points [[x, y, z], [x, y, z]] that give the fold line (oblique lines are fine)
   * @param o.panel panel number the line is on, for folds on folded panels when the points are ambiguous
   * @param o.curve id of a line in the last sketch (instead of points)
   * @param o.angle degrees the moving side turns through, 0 < angle < 180 (default 90)
   * @param o.radius inside bend radius in mm (default the rule's)
   * @param o.position 'centerline' (default) | 'start' | 'end' | 'mould'
   * @param o.fixed a point [x, y, z] on the side that stays, or a wall role such as 'P0.side.e4'
   * @param o.flip turn the moving side towards the bottom
   * @example
   * part('Fold').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange()
   *   .fold({ points: [[40, 0, 2], [40, 60, 2]], angle: 60 });
   * @see part.baseFlange, part.unfold
   */
  fold(this: PartBuilder, o: { points?: [P3, P3]; curve?: string; angle?: Num | string; radius?: Num | string; position?: 'centerline' | 'start' | 'end' | 'mould'; fixed?: P3 | string; panel?: number; flip?: boolean }): PartBuilder {
    const line = H.callerLine();
    if (!o || (!o.points && !o.curve)) throw new H.SelectorError('fold({ points: [[x, y, z], [x, y, z]] }) or fold({ curve: "e1" }) (a line of the last sketch) gives the fold line', line);
    this.steps.push({ line, label: 'fold', run: (ctx) => {
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'fold', id };
      if (o.points) f.points = o.points;
      else {
        if (!ctx.lastSketch) throw new H.SelectorError('fold({ curve }) needs a sketch with that line before it', line);
        f.line = { sketch: ctx.lastSketch, curve: o.curve };
      }
      put(f, o as unknown as Record<string, unknown>, ['angle', 'radius'], ['position', 'fixed', 'flip']);
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Sheet base from an open chain of sketch lines.
   *
   * Adds a contourFlange from the last sketch, used INSTEAD of baseFlange. The sketch holds an open chain of lines; curves lists their ids (default every line); distance is the extrusion in mm. The material lies to the right of the direction of travel (left with flip); reverse extrudes against the sketch normal. Corners become bends of the rule's radius; a segment must be at least as long as its two setbacks. Arcs in the chain and further flanges on it come later.
   * @domain features
   * @param o.distance extrusion length of the section in mm (required)
   * @param o.curves ids of the sketch lines to chain (default: every line)
   * @param o.rule sheetRules rule name (default: the active rule)
   * @param o.flip material on the left of the direction of travel
   * @param o.reverse extrude against the sketch normal
   * @example
   * part('Angle').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => { s.line([0, 0], [0, 20]); s.line([0, 20], [30, 20]); })
   *   .contourFlange({ distance: 40, rule: 'S2' });
   * @see part.sheetRules, part.baseFlange
   */
  contourFlange(this: PartBuilder, o: { distance: Num | string; curves?: string[]; rule?: string; flip?: boolean; reverse?: boolean }): PartBuilder {
    const line = H.callerLine();
    if (!o || o.distance === undefined) throw new H.SelectorError('contourFlange({ distance }) needs the extrusion length in mm', line);
    this.steps.push({ line, label: 'contourFlange', run: (ctx) => {
      if (!ctx.lastSketch) throw new H.SelectorError('contourFlange() needs a sketch of lines before it', line);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'contourFlange', id, sketch: ctx.lastSketch };
      put(f, o as unknown as Record<string, unknown>, ['distance'], ['curves', 'rule', 'flip', 'reverse']);
      ctx.lastFeature = id;
      ctx.lastSketch = null;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Turn a bent-plate solid into a sheet metal part.
   *
   * Adds a sheetConvert: the solid (planar panels, straight cylindrical bends, constant thickness) becomes a sheet with a panel tree, flat pattern and bend table, so edgeFlange, fold, sheetCut, sheet_info and sheet_export work on it. thickness is read from the body unless given; rule names the rule that supplies the k-factor (the converted rule is named Converted and becomes active). Refused with sheetMetalUnsupported for sharp corners between panels, cones, tori, free-form bends, reliefs or embossed features (the rebuilt sheet must match the volume within 1 %).
   * @domain features
   * @param o.thickness sheet thickness in mm (default: read from the body)
   * @param o.rule name of a sheetRules rule for the k-factor (default: the active rule)
   * @example
   * part('Tray').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange()
   *   .edgeFlange([[0, -30, 2]], { height: 20 }).sheetConvert();
   * @see part.sheetRules, part.sheetCut
   */
  sheetConvert(this: PartBuilder, o: { thickness?: Num | string; rule?: string } = {}): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'sheetConvert', run: (ctx) => {
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'sheetConvert', id };
      put(f, o as Record<string, unknown>, ['thickness'], ['rule']);
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Cut closed sketch regions out of the sheet, across bends too.
   *
   * Adds a sheetCut from the last sketch (which it consumes). The sketch is read in the FLAT layout: draw it on the plane of the base (or parallel), in flat coordinates. A region is subtracted from every panel it meets and from the flat pattern, so a slot across a bend shows in the DXF; the bend solid loses the matching wedge. Refused if a region misses the sheet, removes or splits a panel, or has an island. Use it instead of a plain cut, which breaks the sheet.
   * @domain features
   * @param o.regions which sketch regions to cut, as for extrude (default: all)
   * @example
   * part('Slot').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange()
   *   .sketch('front', (s) => s.rect(10, 4)).sheetCut();
   * @see part.baseFlange, part.sheetCorner
   */
  sheetCut(this: PartBuilder, o: { regions?: unknown[] } = {}): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'sheetCut', run: (ctx) => {
      if (!ctx.lastSketch) throw new H.SelectorError('sheetCut() needs a sketch of closed regions before it, drawn in the flat layout', line);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'sheetCut', id, sketch: ctx.lastSketch };
      put(f, o as Record<string, unknown>, [], ['regions']);
      ctx.lastFeature = id;
      ctx.lastSketch = null;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Round or chamfer free convex corners of the sheet.
   *
   * Adds a sheetCorner. corners are world points (the nearest panel vertex wins) or { panel: k, vertex: i }. mode is 'round' (default, needs radius) or 'chamfer' (needs distance); size works for either. Both walls of the corner must be free (no bend beside them), the corner convex, and the walls at least as long as the tangent length. The fillet is a cylinder face in the solid and an arc in the DXF.
   * @domain features
   * @param corners a corner or a list: [x, y, z] | { panel, vertex }
   * @param o.mode 'round' (default) | 'chamfer'
   * @param o.radius fillet radius in mm (mode round)
   * @param o.distance chamfer distance in mm (mode chamfer)
   * @param o.size radius or distance in mm, for either mode
   * @example
   * part('Plate').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange()
   *   .sheetCorner([[50, 30, 2], [-50, 30, 2]], { mode: 'round', radius: 5 });
   * @see part.baseFlange, part.sheetCut
   */
  sheetCorner(this: PartBuilder, corners: SheetCorner | SheetCorner[], o: { mode?: 'round' | 'chamfer'; radius?: Num | string; distance?: Num | string; size?: Num | string } = {}): PartBuilder {
    const line = H.callerLine();
    const list = isPoint(corners) ? [corners] : Array.isArray(corners) ? corners : [corners];
    if (!list.length || list.some((c) => !isPoint(c) && !(c && typeof c === 'object' && 'panel' in c && 'vertex' in c))) throw new H.SelectorError('sheetCorner(corners, { mode, radius }) takes corners as [x, y, z] points or { panel, vertex }', line);
    this.steps.push({ line, label: 'sheetCorner', run: (ctx) => {
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'sheetCorner', id, corners: list };
      put(f, o as Record<string, unknown>, ['radius', 'distance', 'size'], ['mode']);
      ctx.lastFeature = id;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Unfold the sheet to its flat body.
   *
   * Adds an unfold directly after the sheet features. The body becomes the flat sheet (the flat pattern extruded by the thickness); while unfolded, flanges, hems and folds are refused until refold. The flat pattern itself (outline, bend lines) is always available from sheet_info, folded or not; unfold is for exporting or checking the flat solid.
   * @domain features
   * @example
   * part('Tray').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange()
   *   .edgeFlange([[50, 0, 2]], { height: 20 })
   *   .unfold();
   * @see part.refold, part.edgeFlange
   */
  unfold(this: PartBuilder): PartBuilder { return this.feature({ type: 'unfold' }); },

  /**
   * Refold an unfolded sheet.
   *
   * Adds a refold directly after an unfold; it rebuilds the folded solid from the bend table, so unfold and refold round-trip exactly (volume, faces, box). A refold of a sheet that is not unfolded is refused (sheetMetalUnsupported).
   * @domain features
   * @example
   * part('Tray').sheetRules({ name: 'S2', thickness: 2 })
   *   .sketch('front', (s) => s.rect(100, 60)).baseFlange()
   *   .edgeFlange([[50, 0, 2]], { height: 20 })
   *   .unfold().refold();
   * @see part.unfold
   */
  refold(this: PartBuilder): PartBuilder { return this.feature({ type: 'refold' }); },
};
