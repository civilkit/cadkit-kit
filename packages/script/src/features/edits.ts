// Typed helpers for kernel features that had no script method: draft, moveFace, lip / groove, scale, split, deleteBody, deleteFace,
// helix, axis, sphere and moveBody. Each emits exactly the kernel feature (field names of the format book, features-edits.md /
// features-patterns.md / features-solids.md / planes.md). Mixed into PartBuilder by features/index.ts.
import type { EditOp, FeatureHandle, Num, OffsetPlane, PartBuilder, Plane, PlaneRef } from '../recorder';
import type { EdgeSel, FaceSel, FacesSel } from '../selectors';
import { H, applyNewBody, planeRef, sketchOps } from './h';
import { splitByPlane } from './enclosure';

type Vec = [number, number, number];
type Faces = FaceSel | FacesSel;
type PlaneArg = Plane | OffsetPlane | PlaneRef | FaceSel | FeatureHandle;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isHandle = (v: unknown): v is FeatureHandle => isObj(v) && 'label' in v && 'id' in v && !('kind' in v);
const isFaceish = (v: unknown): v is Faces => isObj(v) && (v.kind === 'face' || v.kind === 'faces');
const vec3 = (v: unknown, what: string, line: number): Vec => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw new H.SelectorError(`${what} must be [x, y, z] in mm`, line);
  return v as Vec;
};
const ids = (f: Faces, ctx: { geo: Parameters<typeof H.resolveFacesSel>[1]; warn?: Parameters<typeof H.resolveFacesSel>[2] }, what: string, line: number): string[] => {
  if (!isFaceish(f)) throw new H.SelectorError(`${what}: give face(sel) or faces(sel)`, line);
  return H.resolveFacesSel(f, ctx.geo, ctx.warn).map((x) => x.id);
};
/** A plane argument as the kernel's plane reference ('front' | 'top' | 'right' -> std, face(sel) -> face, a plane handle -> feature, at(...) adds a plane feature). */
const planeOf = (ctx: Parameters<typeof planeRef>[0], on: PlaneArg, pre: EditOp[], what: string, line: number): Record<string, unknown> => {
  if (isHandle(on)) { if (!on.id) throw new H.SelectorError(`${what}: the plane handle is not built yet (take it with part.handle() after the plane)`, line); return { kind: 'feature', id: on.id }; }
  return planeRef(ctx, on as Plane | OffsetPlane | PlaneRef | FaceSel, pre);
};
/** Body selectors: a body name ({body}), face(sel) (the body holding that face) or a handle (the bodies a feature made). */
const bodySel = (b: unknown, ctx: { geo: Parameters<typeof H.resolveFaceSel>[1]; warn?: Parameters<typeof H.resolveFaceSel>[2] }, what: string, line: number): Record<string, unknown> => {
  if (typeof b === 'string' && b.trim()) return { body: b.trim() };
  if (isHandle(b)) { if (!b.id) throw new H.SelectorError(`${what}: the handle is not built yet`, line); return { feature: b.id }; }
  if (isObj(b) && b.kind === 'face') return { face: H.resolveFaceSel(b as unknown as FaceSel, ctx.geo, ctx.warn).id };
  throw new H.SelectorError(`${what}: a body is its name ('Cup', made with newBody), a handle from part.handle() or face(sel) of a face on it`, line);
};
const bodyList = (bodies: unknown, what: string, line: number): unknown[] => {
  const list = Array.isArray(bodies) ? bodies : [bodies];
  if (!list.length) throw new H.SelectorError(`${what}: give at least one body`, line);
  return list;
};

export const editFeatures = {
  /**
   * Draft (taper) faces about a neutral plane.
   *
   * Tilts the chosen faces by `angle` degrees about the neutral plane, which stays put; its normal is the pull direction (reversed by flip). neutral is a standard plane ('front' | 'top' | 'right'), at(plane, offset), a plane handle or a planar face(sel) (a face neutral pulls into its material). A name without ~k selects every piece of a face; faces that continue a drafted face tangentially are drafted with it. Face names do not change. Do the draft before the fillets on those walls. The angle must not be 0; an angle that turns an edge over fails with draftTooLarge.
   * @domain features
   * @param faces face(sel) or faces(sel): the walls to tilt
   * @param angle degrees (not 0)
   * @param o.neutral the plane that stays put: 'front' | 'top' | 'right', at(plane, offset), a plane handle or face(sel)
   * @param o.flip reverse the pull direction
   * @example
   * part('Mould block').sketch('front', (s) => s.rect(40, 20)).extrude(10)
   *   .draft(faces({ dir: 'X' }), 5, { neutral: 'front' });
   * @see part.moveFace, part.fillet, face, faces
   */
  draft(this: PartBuilder, faces: Faces, angle: Num, o: { neutral: PlaneArg; flip?: boolean }): PartBuilder {
    const line = H.callerLine();
    if (!o || o.neutral === undefined) throw new H.SelectorError("draft(faces, angle, { neutral }) needs the neutral plane: 'front' | 'top' | 'right', at(plane, offset) or face(sel)", line);
    this.steps.push({ line, label: 'draft', run: (ctx) => {
      const pre: EditOp[] = [];
      const neutral = planeOf(ctx, o.neutral, pre, 'draft()', line);
      const id = ctx.nextId(); ctx.lastFeature = id;
      return [...pre, { op: 'add', feature: { type: 'draft', id, neutral, faces: ids(faces, ctx, 'draft()', line), angle: H.ref(angle), ...(o.flip ? { flip: true } : {}) } }];
    } });
    return this;
  },

  /**
   * Push or pull faces; their neighbours follow (direct modelling).
   *
   * Give distance to offset each face along its outward normal (positive adds material: a pushed plane grows the part, a cylinder gets a larger radius, a hole wall shrinks the hole), or translate [x, y, z] to move planar faces by the component of the vector along their outward normal. Planes, cylinders, cones, spheres, tori and extruded walls work in offset mode; translate is for planar faces. Neighbours keep their surfaces and are extended or trimmed to meet the moved faces, and face names do not change. Moving a hole sideways is not supported; moving past other geometry is not checked. Fails with moveFaceFailed when an edge collapses or reverses.
   * @domain features
   * @param faces face(sel) or faces(sel)
   * @param o.distance offset along the outward normal in mm (negative pulls in)
   * @param o.translate [x, y, z] mm, planar faces only (use instead of distance)
   * @param o.flip negate the distance
   * @example
   * part('Plate').sketch('front', (s) => s.rect(40, 20)).extrude(10)
   *   .moveFace(face('>Z'), { distance: 2.5 });
   * @see part.draft, part.scale
   */
  moveFace(this: PartBuilder, faces: Faces, o: { distance?: Num; translate?: Vec; flip?: boolean }): PartBuilder {
    const line = H.callerLine();
    if (!o || (o.distance === undefined) === (o.translate === undefined)) throw new H.SelectorError('moveFace(faces, { distance } | { translate: [x, y, z] }): give exactly one of distance and translate', line);
    const translate = o.translate === undefined ? undefined : vec3(o.translate, 'moveFace(): translate', line);
    this.steps.push({ line, label: 'moveFace', run: (ctx) => {
      const id = ctx.nextId(); ctx.lastFeature = id;
      const f: Record<string, unknown> = { type: 'moveFace', id, faces: ids(faces, ctx, 'moveFace()', line), ...(translate ? { mode: 'translate', translate } : { mode: 'offset', distance: H.ref(o.distance as Num) }) };
      if (o.flip) f.flip = true;
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Raise a lip: a band along rim edges (a rabbet for a lid).
   *
   * Adds a raised band of `width` (measured inwards from the rim edge) and `height` (out of the rim face) along the chosen rim edges, for a lid that seats in a box. The rim face must be planar. The outer side of the band merges with the existing wall, so it is a rabbet, not a centred tongue. Pick the rim edges with edges(): each is the boundary between the rim face and its wall. A curved rim or several rim faces in different planes is not built yet. The lid half takes groove() with the same width, plus clearance.
   * @domain features
   * @param rim face(sel) of the planar rim face the lip rises from
   * @param edges edges(sel) of the rim edges the band follows
   * @param o.width band width in mm, default 1
   * @param o.height height out of the rim face in mm, default 1
   * @example
   * part('Box').sketch('front', (s) => s.rect(40, 20)).extrude(10).shell(face('>Z'), 2)
   *   .lip(face('>Z'), edges({ onFace: face('>Z'), outside: [[-21, -11, 9], [21, 11, 11]] }), { width: 1, height: 1.5 });
   * @see part.groove, part.shell, edges
   */
  lip(this: PartBuilder, rim: FaceSel, edges: EdgeSel, o: { width?: Num; height?: Num } = {}): PartBuilder {
    return lipFeature(this, 'lip', rim, edges, o, H.callerLine());
  },

  /**
   * Groove along rim edges (the mating half of a lip).
   *
   * Sinks a band of `width` (measured inwards from the rim edge) and `height` (depth) along the chosen rim edges, a step for a lid. The rim must be planar. Use the same width as the lip it receives, plus clearance for a printed fit.
   * @domain features
   * @param rim face(sel) of the planar rim face the groove is cut into
   * @param edges edges(sel) of the rim edges the groove follows
   * @param o.width band width in mm, default 1
   * @param o.height depth into the rim face in mm, default 1
   * @example
   * part('Lid').sketch('front', (s) => s.rect(40, 20)).extrude(10).shell(face('>Z'), 2)
   *   .groove(face('>Z'), edges({ onFace: face('>Z'), outside: [[-21, -11, 9], [21, 11, 11]] }), { width: 1, height: 1.5 });
   * @see part.lip, part.shell, edges
   */
  groove(this: PartBuilder, rim: FaceSel, edges: EdgeSel, o: { width?: Num; height?: Num } = {}): PartBuilder {
    return lipFeature(this, 'groove', rim, edges, o, H.callerLine());
  },

  /**
   * Scale bodies uniformly or per axis (print shrink compensation, stretched variants).
   *
   * factor is one number (uniform) or [sx, sy, sz] along the world axes; each must be above 0 (use mirror for a flip). The fixed point is `at` [x, y, z], else `about` 'centroid' (default, the centre of mass of the selection) or 'origin'. bodies limits it to named bodies (made with newBody), default all bodies. Bodies change in place and every face keeps its name. Exact for planes, for cylinders and cones stretched along their axis, B-spline faces and for spheres and tori under a uniform factor; a round face stretched across its axis, a sphere under a non-uniform factor, and revolution or extrusion surfaces are refused with invalidValue and the body is left as it was.
   * @domain features
   * @param factor number or [sx, sy, sz]
   * @param o.about 'centroid' (default) | 'origin'
   * @param o.at [x, y, z] fixed point (wins over about)
   * @param o.bodies body name, handle or list of them (default all bodies)
   * @example
   * part('Shrunk').sketch('front', (s) => s.rect(40, 20)).extrude(10)
   *   .scale([1.02, 1.02, 1.03], { about: 'origin' });
   * @see part.moveBody, part.moveFace
   */
  scale(this: PartBuilder, factor: Num | [Num, Num, Num], o: { about?: 'origin' | 'centroid'; at?: Vec; bodies?: string | FeatureHandle | Array<string | FeatureHandle> } = {}): PartBuilder {
    const line = H.callerLine();
    if (factor === undefined) throw new H.SelectorError('scale(factor): give a number or [sx, sy, sz]', line);
    if (o.about !== undefined && o.about !== 'origin' && o.about !== 'centroid') throw new H.SelectorError("scale(): about is 'origin' or 'centroid'", line);
    const at = o.at === undefined ? undefined : vec3(o.at, 'scale(): at', line);
    this.steps.push({ line, label: 'scale', run: (ctx) => {
      const id = ctx.nextId(); ctx.lastFeature = id;
      const f: Record<string, unknown> = { type: 'scale', id, factor: Array.isArray(factor) ? factor.map((v) => H.ref(v)) : H.ref(factor) };
      if (at) f.at = at; else if (o.about) f.about = o.about;
      if (o.bodies !== undefined) f.bodies = bodyList(o.bodies, 'scale()', line).map((b) => bodySel(b, ctx, 'scale()', line));
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Split a body in two: with tool bodies, or at a plane.
   *
   * split(target, tools): the combine feature with op 'split': the target body is cut into the part outside all the tool bodies and the part inside them, two bodies; the tools are used up (keepTools: true keeps them). Bodies are named by newBody: 'Name'. split(plane, { names }): cuts the body at 'front' | 'top' | 'right', at(plane, offset) or a flat face(sel) into two bodies, no tool body needed; names: [below, above] names the halves ("below" is the side the plane normal points away from, for at('front', 15) the part under z = 15). The part must hold one body, or target names the one to split. A plane that misses the body is an error. keep: 'below' or 'above' drops the other half.
   * @domain features
   * @param target name of the body that is split, or the plane to cut at
   * @param tools name or names of the tool bodies; with a plane, the options { names, target, keep, flip }
   * @param o.keepTools keep the tool bodies (default: they are used up)
   * @example
   * part('Halves').sketch('front', (s) => s.rect(40, 20)).extrude(10)
   *   .split(at('front', 5), { names: ['Lower', 'Upper'] });
   * @see part.lipJoint, part.combine, part.deleteBody
   */
  split(this: PartBuilder, target: string | PlaneArg, tools?: string | string[] | { names?: [string, string]; target?: string; keep?: 'both' | 'below' | 'above'; flip?: boolean }, o: { keepTools?: boolean } = {}): PartBuilder {
    if (typeof target === 'string' && (typeof tools === 'string' || Array.isArray(tools))) return this.combine('split', target, tools, o);
    return splitByPlane.call(this, target as Parameters<typeof splitByPlane>[0], (tools ?? {}) as Parameters<typeof splitByPlane>[1]);
  },

  /**
   * Remove whole bodies, or keep only some.
   *
   * Deletes the named bodies (made with newBody: 'Name'; a name matches every body of that name), the body holding a face(sel), or the bodies a handle's feature made. keep: true inverts it: only the listed bodies stay and every other body is removed. Use it to throw away the half of a split or a cutter that was kept with keepTools.
   * @domain features
   * @param bodies body name, face(sel) on the body, handle, or a list of them
   * @param o.keep remove all the OTHER bodies instead
   * @example
   * part('Half').sketch('front', (s) => s.rect(40, 20)).extrude(10, { newBody: 'A' })
   *   .sketch('front', (s) => s.rect(20, 20, [60, 0])).extrude(5, { newBody: 'B' })
   *   .deleteBody('B');
   * @see part.split, part.combine
   */
  deleteBody(this: PartBuilder, bodies: string | FaceSel | FeatureHandle | Array<string | FaceSel | FeatureHandle>, o: { keep?: boolean } = {}): PartBuilder {
    const line = H.callerLine();
    const list = bodyList(bodies, 'deleteBody()', line);
    this.steps.push({ line, label: 'deleteBody', run: (ctx) => {
      const id = ctx.nextId(); ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'deleteBody', id, mode: o.keep ? 'keep' : 'delete', bodies: list.map((b) => bodySel(b, ctx, 'deleteBody()', line)) } }];
    } });
    return this;
  },

  /**
   * Delete faces: the solid becomes an open sheet without them.
   *
   * A solid that loses a face becomes an open sheet and the rest keep their names. The kernel does not heal the gap yet (a mode other than delete is refused), so use it to open a shell for surface work (thicken, knit, fill), not to remove a hole or a fillet from a solid.
   * @domain features
   * @param faces face(sel) or faces(sel)
   * @example
   * part('Open box').sketch('front', (s) => s.rect(40, 20)).extrude(10)
   *   .deleteFace(face('>Z'));
   * @see part.shell, part.moveFace
   */
  deleteFace(this: PartBuilder, faces: Faces): PartBuilder {
    const line = H.callerLine();
    this.steps.push({ line, label: 'deleteFace', run: (ctx) => {
      const id = ctx.nextId(); ctx.lastFeature = id;
      return [{ op: 'add', feature: { type: 'deleteFace', id, faces: ids(faces, ctx, 'deleteFace()', line) } }];
    } });
    return this;
  },

  /**
   * A helix curve (adds no body): the path of a sweep, or a reference.
   *
   * Draws the circle that gives the radius and centre on a plane ('top' by default; its normal is the helix axis) and adds the helix feature. Give TWO of pitch (rise per turn, mm), revolutions and height (total rise, mm): pitch + revolutions, height + revolutions, or height + pitch. startAngle is degrees from the sketch x axis, leftHand turns the other way, reverse rises against the sketch normal. The helix starts at (radius, 0) of the plane and leaves along the plane's y direction. Take part.handle() and pass { curve: handle } as the path of sweep() (the profile sits on the plane normal to the helix start, e.g. 'front' at x = radius for a helix on 'top').
   * @domain features
   * @param o.radius helix radius in mm
   * @param o.pitch rise per turn in mm
   * @param o.revolutions number of turns
   * @param o.height total rise in mm
   * @param o.on plane of the base circle: 'front' | 'top' (default) | 'right', at(plane, offset) or face(sel)
   * @param o.centre [x, y] of the axis in that plane, default [0, 0]
   * @param o.startAngle start angle in degrees, default 0
   * @param o.leftHand left-hand helix
   * @param o.reverse rise against the plane normal
   * @example
   * const p = part('Coil').helix({ radius: 10, pitch: 4, revolutions: 5 });
   * const path = p.handle();
   * p.sweep({ on: 'front', draw: (s) => s.circle(1.5, [10, 0]) }, { curve: path });
   * @see part.sweep, part.spring, part.handle
   */
  helix(this: PartBuilder, o: { radius: Num; pitch?: Num; revolutions?: Num; height?: Num; on?: Plane | OffsetPlane | PlaneRef | FaceSel; centre?: [number, number]; center?: [number, number]; startAngle?: Num; leftHand?: boolean; reverse?: boolean; name?: string }): PartBuilder {
    const line = H.callerLine();
    if (!o || o.radius === undefined) throw new H.SelectorError('helix({ radius, pitch, revolutions }): give the radius and two of pitch, revolutions, height', line);
    const given = (['pitch', 'revolutions', 'height'] as const).filter((k) => o[k] !== undefined);
    if (given.length !== 2) throw new H.SelectorError(`helix(): give exactly two of pitch, revolutions and height (got ${given.length ? given.join(' + ') : 'none'})`, line);
    const definedBy = o.height === undefined ? 'pitchRevs' : o.pitch === undefined ? 'heightRevs' : 'heightPitch';
    const c = o.centre ?? o.center ?? [0, 0];
    this.steps.push({ line, label: 'helix', run: (ctx) => {
      const ops: EditOp[] = [];
      const sk = sketchOps(ctx, { on: o.on ?? 'top', draw: (s) => { s.circle(H.num(o.radius), c); }, name: o.name ? `${o.name} axis circle` : 'Helix axis circle' }, ops);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'helix', id, ...(o.name ? { name: o.name } : {}), sketch: sk, definedBy };
      for (const k of ['pitch', 'revolutions', 'height'] as const) if (o[k] !== undefined) f[k] = H.ref(o[k] as Num);
      if (o.startAngle !== undefined) f.startAngle = H.ref(o.startAngle);
      if (o.leftHand) f.leftHand = true;
      if (o.reverse) f.reverse = true;
      ops.push({ op: 'add', feature: f });
      ctx.lastFeature = id; ctx.lastSketch = null;
      return ops;
    } });
    return this;
  },

  /**
   * A reference axis: a world axis, a straight edge, a cylinder or the line where two planes meet.
   *
   * Adds the axis feature other features take as { kind: 'feature', id } (a plane turned about it, a revolve or pattern axis). One argument: 'x' | 'y' | 'z' (a world axis through the origin), edges(sel) matching one straight edge, or face(sel) of a cylindrical face (its axis; faceNotCylindrical otherwise). Two arguments: two planes ('front' | 'top' | 'right', face(sel), a plane handle, at(plane, offset)): the line where they meet (planesParallel if they do not). Take part.handle() after it to refer to it.
   * @domain features
   * @param a 'x' | 'y' | 'z', edges(sel), face(sel) of a cylinder, or the first plane
   * @param b the second plane, for the line where two planes meet
   * @example
   * const p = part('Tilted').axis('top', 'front');
   * const ax = p.handle();
   * @see part.workplane, part.handle, part.helix
   */
  axis(this: PartBuilder, a: 'x' | 'y' | 'z' | EdgeSel | FaceSel | PlaneArg, b?: PlaneArg): PartBuilder {
    const line = H.callerLine();
    if (a === undefined) throw new H.SelectorError("axis('x' | 'y' | 'z') or axis(edges(sel)) or axis(face(cylinder)) or axis(plane, plane)", line);
    this.steps.push({ line, label: 'axis', run: (ctx) => {
      const pre: EditOp[] = [];
      let refs: Array<Record<string, unknown>>;
      if (b !== undefined) refs = [planeOf(ctx, a as PlaneArg, pre, 'axis()', line), planeOf(ctx, b, pre, 'axis()', line)];
      else if (a === 'x' || a === 'y' || a === 'z') refs = [{ kind: 'axis', axis: a }];
      else if (isObj(a) && a.kind === 'edges') {
        const e = H.resolveEdges((a as unknown as EdgeSel).sel, ctx.geo, (a as unknown as EdgeSel).line);
        if (e.length !== 1) throw new H.SelectorError(`axis(): the edge selection matched ${e.length} edges; it must match exactly one straight edge`, line);
        refs = [{ kind: 'edge', faces: e[0].faces, at: e[0].at }];
      } else if (isObj(a) && a.kind === 'face') refs = [{ kind: 'face', id: H.resolveFaceSel(a as unknown as FaceSel, ctx.geo, ctx.warn).id }];
      else throw new H.SelectorError("axis(a): a is 'x' | 'y' | 'z', edges(sel), face(sel) of a cylinder, or give two planes: axis(plane, plane)", line);
      const id = ctx.nextId(); ctx.lastFeature = id;
      return [...pre, { op: 'add', feature: { type: 'axis', id, refs } }];
    } });
    return this;
  },

  /**
   * A ball, without a sketch.
   *
   * Adds (or cuts, op 'cut') a sphere of radius `radius` at `centre` [x, y, z] (default the origin). The poles lie along +Y; the one face is named S.e1 of the feature. op 'add' fuses with what it touches, newBody: true or 'Name' keeps it as a separate body. The first feature of a part may be a sphere.
   * @domain features
   * @param radius radius in mm (above 0)
   * @param o.centre [x, y, z] centre, default [0, 0, 0]
   * @param o.op 'add' (default) or 'cut'
   * @param o.newBody true or 'Name': keep the ball as a separate body
   * @example
   * part('Ball').sphere(10);
   * @see part.revolve, part.moveBody
   */
  sphere(this: PartBuilder, radius: Num, o: { centre?: [Num, Num, Num]; center?: [Num, Num, Num]; op?: 'add' | 'cut'; newBody?: boolean | string; name?: string } = {}): PartBuilder {
    const line = H.callerLine();
    if (radius === undefined) throw new H.SelectorError('sphere(radius, { centre, op }): give the radius in mm', line);
    const c = o.centre ?? o.center ?? [0, 0, 0];
    if (!Array.isArray(c) || c.length !== 3) throw new H.SelectorError('sphere(): centre must be [x, y, z]', line);
    const op = o.op ?? 'add';
    this.steps.push({ line, label: 'sphere', run: (ctx) => {
      const id = ctx.nextId(); ctx.lastFeature = id; ctx.lastSketch = null;
      const f: Record<string, unknown> = { type: 'sphere', id, ...(o.name ? { name: o.name } : {}), op, center: c.map((v) => H.ref(v)), radius: H.ref(radius) };
      applyNewBody(f, op, o.newBody, 'sphere', line);
      return [{ op: 'add', feature: f }];
    } });
    return this;
  },

  /**
   * Move, rotate or copy whole bodies (also a mirrored copy).
   *
   * moveBody(bodies, { translate, rotate, copy, body, mirror }). bodies is a body name (made with newBody), a handle, face(sel) on the body, or a list; omit it (moveBody({ ... })) for all bodies. The rotation { axis: 'x' | 'y' | 'z' | [x, y, z], origin?: [x, y, z], angle } in degrees is applied first, then the translation [x, y, z]. Without copy the bodies move in place and keep their names; moved bodies are NOT united with what they touch, so use combine afterwards. copy: true keeps the source and adds a moved copy (body: 'Name' names it); mirror (a plane: 'front' | 'top' | 'right', at(plane, offset) or face(sel)) makes the copy the mirror image of the source about that plane (solid bodies only, needs copy).
   * @domain features
   * @param bodies body name, handle, face(sel) or a list (omit for all bodies)
   * @param o options: translate, rotate, copy, body, mirror
   * @param o.translate [x, y, z] mm
   * @param o.rotate { axis, origin?, angle } rotation in degrees, applied before the translation
   * @param o.copy keep the source and add a moved copy
   * @param o.body with copy: name of the copy
   * @param o.mirror with copy: the plane the copy is mirrored about
   * @example
   * part('Pair').sketch('front', (s) => s.rect(20, 10)).extrude(5, { newBody: 'A' })
   *   .moveBody('A', { translate: [0, 0, 30], copy: true, body: 'B' });
   * @see part.combine, part.scale, part.mirror
   */
  moveBody(this: PartBuilder, bodies: string | FaceSel | FeatureHandle | Array<string | FaceSel | FeatureHandle> | MoveBodyOpts, o?: MoveBodyOpts): PartBuilder {
    const line = H.callerLine();
    const all = o === undefined && isObj(bodies) && !('kind' in bodies) && !isHandle(bodies);
    const opts: MoveBodyOpts = all ? (bodies as MoveBodyOpts) : (o ?? {});
    const list = all || bodies === undefined ? null : bodyList(bodies, 'moveBody()', line);
    if (opts.translate === undefined && opts.rotate === undefined && !opts.mirror) throw new H.SelectorError('moveBody(): give translate, rotate or (with copy) mirror', line);
    if (opts.mirror && !opts.copy) throw new H.SelectorError('moveBody(): mirror needs copy: true (the copy is the mirror image; the source stays)', line);
    if (opts.body !== undefined && !opts.copy) throw new H.SelectorError('moveBody(): body names the copy, so it needs copy: true', line);
    const translate = opts.translate === undefined ? undefined : vec3(opts.translate, 'moveBody(): translate', line);
    const rot = opts.rotate;
    if (rot !== undefined) {
      if (!isObj(rot) || rot.angle === undefined) throw new H.SelectorError('moveBody(): rotate is { axis, origin?, angle }', line);
      if (!(rot.axis === 'x' || rot.axis === 'y' || rot.axis === 'z' || Array.isArray(rot.axis))) throw new H.SelectorError("moveBody(): rotate.axis is 'x' | 'y' | 'z' or [x, y, z]", line);
      if (Array.isArray(rot.axis)) vec3(rot.axis, 'moveBody(): rotate.axis', line);
      if (rot.origin !== undefined) vec3(rot.origin, 'moveBody(): rotate.origin', line);
    }
    this.steps.push({ line, label: 'moveBody', run: (ctx) => {
      const pre: EditOp[] = [];
      const id = ctx.nextId(); ctx.lastFeature = id;
      const f: Record<string, unknown> = { type: 'moveBody', id };
      if (list) f.bodies = list.map((b) => bodySel(b, ctx, 'moveBody()', line));
      if (translate) f.translate = translate;
      if (rot) f.rotate = { axis: rot.axis, ...(rot.origin ? { origin: rot.origin } : {}), angle: H.ref(rot.angle) };
      if (opts.copy) f.copy = true;
      if (opts.body !== undefined) f.body = opts.body;
      if (opts.mirror) f.mirror = planeOf(ctx, opts.mirror, pre, 'moveBody()', line);
      return [...pre, { op: 'add', feature: f }];
    } });
    return this;
  },
};

interface MoveBodyOpts {
  translate?: Vec;
  rotate?: { axis: 'x' | 'y' | 'z' | Vec; origin?: Vec; angle: Num };
  copy?: boolean;
  body?: string;
  mirror?: PlaneArg;
}

function lipFeature(p: PartBuilder, kind: 'lip' | 'groove', rim: FaceSel, edges: EdgeSel, o: { width?: Num; height?: Num }, line: number): PartBuilder {
  if (!isObj(rim) || rim.kind !== 'face') throw new H.SelectorError(`${kind}(rim, edges, { width, height }): rim is face(sel) of the planar rim face`, line);
  if (!isObj(edges) || edges.kind !== 'edges') throw new H.SelectorError(`${kind}(rim, edges, { width, height }): edges is edges(sel) of the rim edges to follow`, line);
  p.steps.push({ line, label: kind, run: (ctx) => {
    const id = ctx.nextId(); ctx.lastFeature = id;
    const f: Record<string, unknown> = { type: 'lip', id, kind, faces: [H.resolveFaceSel(rim, ctx.geo, ctx.warn).id], edges: H.resolveEdges(edges.sel, ctx.geo, edges.line) };
    if (o.width !== undefined) f.width = H.ref(o.width);
    if (o.height !== undefined) f.height = H.ref(o.height);
    return [{ op: 'add', feature: f }];
  } });
  return p;
}
