// Loft, sweep, rib, mirror and gear: feature helpers that build several sketches or reuse an app generator. Mixed into PartBuilder by features/index.ts.
import type { EditOp, FeatureHandle, Num, OffsetPlane, Plane, PartBuilder } from '../recorder';
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
   * Builds the profile sketch and the path sketch and sweeps the profile along the path. The profile must lie in a plane that the path starts on and is perpendicular to (a circle on 'front' for a path leaving the origin along +Z, which a path sketch on 'right' or 'top' draws as a line in its y or x direction). The path can be a line chain, arcs or a spline. twist turns the profile by that many degrees over the path; op 'cut' removes the swept volume. The path can also be a helix: sweep(profile, { curve: handle }) with the handle of part.helix(). Guide curves (guides, guideMode) make a tapering or flaring body: a circle r 3 swept 20 along a line with a guide from (3, 0) to (6, 20) is a cone frustum. twist cannot be combined with guides. The kernel has no keep-normal option: the profile follows the path frame.
   * @domain features
   * @param profile closed profile sketch { on, draw }
   * @param path path sketch { on, draw } (open chain starting on the profile plane), or { curve: handle } for a helix
   * @param o.twist total twist in degrees over the path
   * @param o.op 'add' (default) or 'cut'
   * @param o.newBody true or 'Name': keep the swept solid as a separate body instead of fusing it with what it touches
   * @param o.from with op 'cut': a body name or list of names the cut changes; the other bodies stay as they are
   * @param o.guides one or two guide curve sketches ({ on, draw }, each drawing ONE line, arc or spline) the profile follows while it travels; each must touch the profile and run along the path
   * @param o.guideMode with guides: 'scale' (default: scaled and turned so the contact stays on the guide), 'turn' (only turned, the section keeps its shape) or 'stretch' (two guides: stretched between them)
   * @example
   * part('Pipe').sweep(
   *   { on: 'front', draw: (s) => { s.circle(5); s.circle(4); } },
   *   { on: 'right', draw: (s) => s.polyline([[0, 0], [0, 40], [20, 60]]) },
   * );
   * @see part.loft, sketch.polyline, sketch.spline
   */
  sweep(this: PartBuilder, profile: SketchSpec, path: SketchSpec | { curve: FeatureHandle | string }, o: { twist?: Num; op?: 'add' | 'cut'; newBody?: boolean | string; from?: string | string[]; guides?: SketchSpec[]; guideMode?: 'scale' | 'turn' | 'stretch' } = {}): PartBuilder {
    const line = H.callerLine();
    const curve = (path as { curve?: FeatureHandle | string } | undefined)?.curve;
    if (!profile?.on || !profile.draw || !path || (curve === undefined && (!(path as SketchSpec).on || !(path as SketchSpec).draw))) throw new H.SelectorError(`sweep() needs a profile and a path sketch (or { curve: handle } of a helix): ${SKETCH_SPEC}`, line);
    const guides = o.guides ?? [];
    if (guides.length && o.twist !== undefined && o.twist !== 0) throw new H.SelectorError('sweep(): twist cannot be combined with guides (the guides turn the profile)', line);
    if (guides.length > 2) throw new H.SelectorError('sweep(): at most two guide curves', line);
    if (o.guideMode !== undefined && !['scale', 'turn', 'stretch'].includes(o.guideMode)) throw new H.SelectorError("sweep(): guideMode is 'scale' (default), 'turn' or 'stretch'", line);
    if (o.guideMode === 'stretch' && guides.length !== 2) throw new H.SelectorError("sweep(): guideMode 'stretch' needs exactly two guides", line);
    if (o.guideMode !== undefined && !guides.length) throw new H.SelectorError('sweep(): guideMode needs guides', line);
    this.steps.push({ line, label: 'sweep', run: (ctx) => {
      const ops: EditOp[] = [];
      const pid = sketchOps(ctx, profile, ops);
      let pathRef: Record<string, unknown>;
      if (curve !== undefined) {
        const cid = typeof curve === 'string' ? (curve === 'last' ? ctx.lastFeature : curve) : curve.id;
        if (!cid) throw new H.SelectorError('sweep(): the helix handle is not built yet (take part.handle() right after helix())', line);
        pathRef = { kind: 'curve', id: cid };
      } else pathRef = { kind: 'sketch', id: sketchOps(ctx, path as SketchSpec, ops) };
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'sweep', id, op: o.op ?? 'add', sketch: pid, path: pathRef };
      if (guides.length) {
        // each guide sketch holds ONE curve (a line, an arc or a spline); the kernel takes the curve of a sketch as { kind: 'sketchCurve', sketch, entity }
        f.guides = guides.map((g, i) => {
          const gid = sketchOps(ctx, g, ops);
          const ents = ((ops[ops.length - 1] as unknown as { feature: { entities: Array<{ id: string; construction?: boolean }> } }).feature.entities).filter((e) => !e.construction);
          if (ents.length !== 1) throw new H.SelectorError(`sweep(): guide ${i + 1} must draw exactly one curve (line, arc or spline), it drew ${ents.length}`, line);
          return { kind: 'sketchCurve', sketch: gid, entity: ents[0].id };
        });
        if (o.guideMode) f.guideMode = o.guideMode;
      }
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
   * Takes the LAST sketch, an open line or chain (not closed), and adds a web of this total thickness centred on the sketch plane (side: 'left' or 'right' puts it all on one side). The web fills the space between the chain and the body on the side the body encloses: a gusset across the inside corner of an L, a web inside a box. It stops at the outer wall of the body and never fills a bore the line runs through, so the rib may come before or after the bore. A line in open air, or one that does not have material around it, fails with ribNoContact. The chain ends may touch or lie inside the material. flip tries the other side first. fillet rounds the free edge; draft tapers the two sides toward the free edge (one straight line only); target names the body or bodies to extend to.
   * @domain features
   * @param thickness rib thickness in mm
   * @param o.flip try the other side of the chain first
   * @param o.fillet radius of the round on the free edge in mm, below half the thickness
   * @param o.draft taper of the two side faces in degrees (0 to 45): the rib is thickness thick at the free edge and widens toward the body; the sketch must be one straight line
   * @param o.side 'both' (default, centred on the sketch plane) | 'right' (all on the side the sketch normal points to) | 'left' (all on the other side)
   * @param o.target name (or list of names) of the body to extend to; the other bodies are left alone
   * @example
   * part('Gusset').sketch('front', (s) => s.polygon([[0, 0], [50, 0], [50, 6], [6, 6], [6, 40], [0, 40]])).extrude(40)
   *   .sketch(at('front', 20), (s) => s.line([6, 26], [26, 6])).rib(3, { fillet: 1, draft: 2 });
   * @see part.extrude, part.mirror
   */
  rib(this: PartBuilder, thickness: Num, o: { flip?: boolean; fillet?: Num; draft?: Num; side?: 'both' | 'left' | 'right'; target?: string | string[] } = {}): PartBuilder {
    const line = H.callerLine();
    if (o.side !== undefined && o.side !== 'both' && o.side !== 'left' && o.side !== 'right') throw new H.SelectorError(`rib(): side is 'both', 'left' or 'right', got ${JSON.stringify(o.side)}`, line);
    const names = o.target === undefined ? undefined : Array.isArray(o.target) ? o.target : [o.target];
    if (names && (!names.length || names.some((n) => typeof n !== 'string' || !n.trim()))) throw new H.SelectorError("rib(): target is a body name or a list of body names, e.g. target: 'Bracket' (bodies are named by newBody: 'Name')", line);
    this.steps.push({ line, label: 'rib', run: (ctx) => {
      if (!ctx.lastSketch) throw new H.SelectorError('rib() needs an open sketch before it', line);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'rib', id, sketch: ctx.lastSketch, thickness: H.ref(thickness) };
      if (o.flip) f.flip = true;
      if (o.fillet !== undefined) f.fillet = H.ref(o.fillet);
      if (o.draft !== undefined) f.draft = H.ref(o.draft);
      if (o.side !== undefined && o.side !== 'both') f.side = o.side;
      if (names) f.target = names.map((n) => ({ body: n.trim() }));
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
