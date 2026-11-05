// Loft, sweep, rib, mirror and gear: feature helpers that build several sketches or reuse an app generator. Mixed into PartBuilder by features/index.ts.
import type { EditOp, Num, OffsetPlane, Plane, PartBuilder } from '../recorder';
import type { FaceSel } from '../selectors';
import { DEFAULT_GEAR, gearFeatures, rolesFor, type GearParams } from '../../../../apps/cad/src/gearData';
import { H, applyFrom, applyNewBody, planeRef, sketchOps, type SketchSpec } from './h';

type End = 'cap' | 'point';
const SKETCH_SPEC = 'a section is { on: plane | at(plane, offset) | face(sel), draw: (s) => ... } or { on, point: [x, y] }';

export const shapeFeatures = {
  /**
   * Loft a solid through two or more section sketches, optionally ending in a point.
   *
   * Builds one sketch per section (on a standard plane, an at(plane, offset) plane or a face) and a loft feature through them in order. Sections are { on, draw } where draw(s) draws a closed outline with the sketch builder, or { on, point: [x, y] } for a single-point section. Only the FIRST and the LAST section may be a point (a bow, a cone tip); ends.first / ends.last say 'cap' (flat end, default) or 'point' and are checked against the sections. Optional guides are sketches the loft follows, centre is a straight centre-line sketch, startNormal / endNormal (true or a tension number) make the loft leave the end sections along their normals. Closed (ring) lofts are not supported by the kernel. Section outlines should have the same number of pieces and be simple closed curves; a hull is a row of arcs or polygons with growing size.
   * @domain features
   * @param sections list of section sketches, at least two, in order
   * @param o.ends { first?: 'cap' | 'point', last?: 'cap' | 'point' }
   * @param o.guides guide curve sketches ({ on, draw }) that touch every section
   * @param o.centre centre-line sketch ({ on, draw }) with a straight line
   * @param o.startNormal true or a tension: leave the first section along its normal
   * @param o.endNormal true or a tension: arrive at the last section along its normal
   * @param o.op 'add' (default) or 'cut'
   * @param o.from with op 'cut': a body name or list of names (bodies made with newBody) the cut changes; the other bodies stay as they are
   * @param o.newBody true or 'Name': keep the lofted solid as a separate body instead of fusing it with what it touches
   * @example
   * part('Cone').loft([
   *   { on: 'front', draw: (s) => s.circle(10) },
   *   { on: at('front', 30), point: [0, 0] },
   * ], { ends: { last: 'point' } });
   * @see at, sketch.circle, part.sweep
   */
  loft(this: PartBuilder, sections: SketchSpec[], o: { ends?: { first?: End; last?: End }; guides?: SketchSpec[]; centre?: SketchSpec; startNormal?: boolean | Num; endNormal?: boolean | Num; op?: 'add' | 'cut'; from?: string | string[]; newBody?: boolean | string } = {}): PartBuilder {
    const line = H.callerLine();
    if (!Array.isArray(sections) || sections.length < 2) throw new H.SelectorError(`loft() needs at least two sections: ${SKETCH_SPEC}`, line);
    const secs = sections.map((s, i) => {
      if (!s || !s.on || (!s.draw && !s.point)) throw new H.SelectorError(`loft(): section ${i + 1} is not valid: ${SKETCH_SPEC}`, line);
      return { ...s };
    });
    const last = secs.length - 1;
    for (const [end, i] of [['first', 0], ['last', last]] as const) {
      const want = o.ends?.[end];
      if (want === 'point') secs[i].point = secs[i].point ?? [0, 0];
      else if (want === 'cap' && secs[i].point) throw new H.SelectorError(`loft(): the ${end} section is a point but ends.${end} is 'cap'`, line);
      if (want !== undefined && want !== 'cap' && want !== 'point') throw new H.SelectorError(`loft(): ends.${end} must be 'cap' or 'point'`, line);
    }
    secs.forEach((s, i) => { if (s.point && i !== 0 && i !== last) throw new H.SelectorError('loft(): only the first or the last section can be a point', line); });
    if (secs[0].point && secs[last].point) throw new H.SelectorError('loft(): the first and the last section cannot both be points', line);
    if (o.guides?.length && (secs[0].point || secs[last].point)) throw new H.SelectorError('loft(): guide curves cannot be combined with a point section', line);
    const guides = o.guides ?? [];
    this.steps.push({ line, label: 'loft', run: (ctx) => {
      const ops: EditOp[] = [];
      const ids = secs.map((s) => sketchOps(ctx, s, ops));
      const gids = guides.map((g) => sketchOps(ctx, g, ops));
      const cid = o.centre ? sketchOps(ctx, o.centre, ops) : null;
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'loft', id, op: o.op ?? 'add', sketches: ids };
      if (gids.length) f.guides = gids.map((sketch) => ({ sketch }));
      if (cid) f.centreLine = { sketch: cid };
      if (o.startNormal !== undefined && o.startNormal !== false) f.startNormal = o.startNormal === true ? true : H.ref(o.startNormal);
      if (o.endNormal !== undefined && o.endNormal !== false) f.endNormal = o.endNormal === true ? true : H.ref(o.endNormal);
      applyFrom(f, o.op ?? 'add', o.from, 'loft', line);
      applyNewBody(f, o.op ?? 'add', o.newBody, 'loft', line);
      ops.push({ op: 'add', feature: f });
      ctx.lastFeature = id; ctx.lastSketch = null;
      return ops;
    } });
    return this;
  },

  /**
   * Sweep a closed profile along a path sketch (pipes, rails, handles).
   *
   * Builds the profile sketch and the path sketch and sweeps the profile along the path. The profile must lie in a plane that the path starts on and is perpendicular to (a circle on 'front' for a path leaving the origin along +Z, which a path sketch on 'right' or 'top' draws as a line in its y or x direction). The path can be a line chain, arcs or a spline. twist turns the profile by that many degrees over the path; op 'cut' removes the swept volume. The kernel has no keep-normal option: the profile follows the path frame.
   * @domain features
   * @param profile closed profile sketch { on, draw }
   * @param path path sketch { on, draw } (open chain starting on the profile plane)
   * @param o.twist total twist in degrees over the path
   * @param o.op 'add' (default) or 'cut'
   * @param o.newBody true or 'Name': keep the swept solid as a separate body instead of fusing it with what it touches
   * @param o.from with op 'cut': a body name or list of names the cut changes; the other bodies stay as they are
   * @example
   * part('Pipe').sweep(
   *   { on: 'front', draw: (s) => { s.circle(5); s.circle(4); } },
   *   { on: 'right', draw: (s) => s.polyline([[0, 0], [0, 40], [20, 60]]) },
   * );
   * @see part.loft, sketch.polyline, sketch.spline
   */
  sweep(this: PartBuilder, profile: SketchSpec, path: SketchSpec, o: { twist?: Num; op?: 'add' | 'cut'; newBody?: boolean | string; from?: string | string[] } = {}): PartBuilder {
    const line = H.callerLine();
    if (!profile?.on || !profile.draw || !path?.on || !path.draw) throw new H.SelectorError(`sweep() needs a profile and a path sketch: ${SKETCH_SPEC}`, line);
    this.steps.push({ line, label: 'sweep', run: (ctx) => {
      const ops: EditOp[] = [];
      const pid = sketchOps(ctx, profile, ops), path_ = sketchOps(ctx, path, ops);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'sweep', id, op: o.op ?? 'add', sketch: pid, path: { kind: 'sketch', id: path_ } };
      if (o.twist !== undefined) f.twist = H.ref(o.twist);
      applyNewBody(f, o.op ?? 'add', o.newBody, 'sweep', line);
      applyFrom(f, o.op ?? 'add', o.from, 'sweep', line);
      ops.push({ op: 'add', feature: f });
      ctx.lastFeature = id; ctx.lastSketch = null;
      return ops;
    } });
    return this;
  },

  /**
   * Rib: a web of a given thickness from an open sketch line, grown to the body.
   *
   * Takes the LAST sketch, an open line or chain (not closed), and adds a web of this total thickness centred on the sketch plane. The web fills the space between the chain and the body on the side the body encloses: a gusset across the inside corner of an L, a web inside a box. A line in open air, or one that does not have material around it, fails with ribNoContact. The chain ends may touch or lie inside the material. flip tries the other side first.
   * @domain features
   * @param thickness rib thickness in mm
   * @param o.flip try the other side of the chain first
   * @example
   * part('Gusset').sketch('front', (s) => s.polygon([[0, 0], [50, 0], [50, 6], [6, 6], [6, 40], [0, 40]])).extrude(40)
   *   .sketch(at('front', 20), (s) => s.line([6, 26], [26, 6])).rib(3);
   * @see part.extrude, part.mirror
   */
  rib(this: PartBuilder, thickness: Num, o: { flip?: boolean } = {}): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'rib', run: (ctx) => {
      if (!ctx.lastSketch) throw new H.SelectorError('rib() needs an open sketch before it', line);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'rib', id, sketch: ctx.lastSketch, thickness: H.ref(thickness) };
      if (o.flip) f.flip = true;
      ctx.lastFeature = id; ctx.lastSketch = null;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Mirror the last feature (or the whole body) about a plane.
   *
   * Adds a mirrored copy about 'front' | 'top' | 'right', at(plane, offset) or a planar face(sel). By default the feature added just before (a boss, pocket, hole) is mirrored; with body: true the whole body is reflected and united with the original. The kernel always keeps the original, there is no move-only mirror. Mirror about a face only when the face is the symmetry plane (a face you sketch on is usually not).
   * @domain patterns
   * @param plane 'front' | 'top' | 'right', at(plane, offset) or face(sel)
   * @param o.body mirror the whole body instead of the last feature
   * @example
   * part('Bracket').sketch('front', (s) => s.polygon([[0, 0], [30, 0], [30, 10], [0, 10]])).extrude(8)
   *   .mirror('right', { body: true });
   * @see part.linearPattern, part.circularPattern
   */
  mirror(this: PartBuilder, plane: Plane | OffsetPlane | FaceSel, o: { body?: boolean } = {}): PartBuilder {
    const line = H.callerLine();
    if ((o as { keepOriginal?: boolean }).keepOriginal === false) throw new H.SelectorError('mirror(): the kernel always keeps the original; there is no keepOriginal: false', line);
    this.steps.push({ line, label: 'mirror', run: (ctx) => {
      if (!ctx.lastFeature) throw new H.SelectorError('mirror() needs a feature before it', line);
      const pre: EditOp[] = [];
      const pl = planeRef(ctx, plane, pre);
      const id = ctx.nextId();
      const seed = ctx.lastFeature;
      ctx.lastFeature = id;
      return [...pre, { op: 'add', feature: { type: 'mirror', id, seeds: [seed], plane: pl, body: o.body === true } }];
    } });
    return this;
  },

  /**
   * Involute spur or helical gear (profile, body extrude, bore) from module and teeth.
   *
   * Adds the app's gear generator output: a profile sketch with true involute teeth, the body extrude and a through bore. The gear is centred on `center` on the 'front' plane (axis +Z) unless plane says otherwise. Pitch diameter = module * teeth; outside diameter = module * (teeth + 2). Use it as the first feature of a part (it makes the body), or on its own plane for a second gear.
   * @domain features
   * @param o.module normal module in mm
   * @param o.teeth number of teeth
   * @param o.thickness face width (extrusion) in mm
   * @param o.bore bore diameter in mm, 0 for none, default 8
   * @param o.pressureAngle pressure angle in degrees, default 20
   * @param o.type 'spur' (default), 'helical' or 'internal'
   * @param o.helixAngle helix angle in degrees for a helical gear, default 15
   * @param o.plane standard plane the gear lies on: "front" (default, axis +Z), "top" or "right"
   * @param o.center [x, y] of the gear centre in the plane, default [0, 0]
   * @example
   * part('Gear').gear({ module: 2, teeth: 20, thickness: 8, bore: 6 });
   * @see part.extrude, part.hole
   */
  gear(this: PartBuilder, o: { module: number; teeth: number; thickness: number; bore?: number; pressureAngle?: number; type?: 'spur' | 'helical' | 'internal'; helixAngle?: number; plane?: Plane; center?: [number, number] }): PartBuilder {
    const line = H.callerLine();
    if (!o || !(o.module > 0) || !(o.teeth >= 6) || !(o.thickness > 0)) throw new H.SelectorError('gear() needs module > 0, teeth >= 6 and thickness > 0', line);
    const p: GearParams = {
      ...DEFAULT_GEAR, type: o.type ?? 'spur', module: o.module, teeth: Math.round(o.teeth), faceWidth: o.thickness, boreDia: o.bore ?? 8,
      pressureAngle: o.pressureAngle ?? 20, helixAngle: o.helixAngle ?? 15, center: o.center ?? [0, 0], plane: { kind: 'std', id: o.plane ?? 'front' },
    };
    this.steps.push({ line, label: 'gear', run: (ctx) => {
      const ids: Record<string, string> = {};
      for (const r of rolesFor(p)) ids[r] = ctx.nextId();
      const ops = (gearFeatures(p, ids) as unknown as Array<Record<string, unknown>>).map((feature): EditOp => ({ op: 'add', feature }));
      ctx.lastFeature = ids.bore ?? ids.body;
      ctx.lastSketch = null;
      return ops;
    } });
    return this;
  },
};
