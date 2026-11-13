// Enclosures and moulds: split a body by a plane, and the lip joint (tongue and groove) of a two-part case.
// Mixed into PartBuilder by features/index.ts.
import type { EditOp, Num, OffsetPlane, PartBuilder, Plane, PlaneRef, SketchBuilder } from '../recorder';
import type { FaceSel } from '../selectors';
import { at, plane as stdPlane } from '../recorder';
import { H, planeRef } from './h';

type PlaneArg = Plane | OffsetPlane | PlaneRef | FaceSel;

/** The fields split() and lipJoint() share: which body, what to call the halves, which way the plane faces. */
type Common = { target?: string; names?: [string, string]; flip?: boolean };

/** Checked when the call is made, so the error carries the line of the call. */
function checkCommon(label: string, line: number, o: Common): void {
  if (o.target !== undefined && (typeof o.target !== 'string' || !o.target.trim())) throw new H.SelectorError(`${label}(): target is the name of the body to split, e.g. target: 'Case'`, line);
  const n = o.names;
  if (n !== undefined && (!Array.isArray(n) || n.length !== 2 || n.some((x) => typeof x !== 'string' || !x.trim()) || n[0].trim() === n[1].trim())) {
    throw new H.SelectorError(`${label}(): names is two different names [below, above], e.g. names: ['Base', 'Lid'] ("below" is the half the plane normal points away from)`, line);
  }
}

function common(f: Record<string, unknown>, o: Common): void {
  if (o.target !== undefined) f.target = { body: o.target.trim() };
  if (o.names !== undefined) f.names = [o.names[0].trim(), o.names[1].trim()];
  if (o.flip) f.flip = true;
}

export function splitByPlane(this: PartBuilder, plane: PlaneArg, o: { names?: [string, string]; target?: string; keep?: 'both' | 'below' | 'above'; flip?: boolean } = {}): PartBuilder {
  const line = H.callerLine();
  if (plane === undefined || plane === null) throw new H.SelectorError("split(plane): give the plane to cut at, e.g. split(at('front', 15), { names: ['Base', 'Lid'] })", line);
  if (o.keep !== undefined && o.keep !== 'both' && o.keep !== 'below' && o.keep !== 'above') throw new H.SelectorError("split(): keep is 'both', 'below' or 'above'", line);
  checkCommon('split', line, o);
  this.steps.push({ line, label: 'split', run: (ctx) => {
    const pre: EditOp[] = [];
    const pl = planeRef(ctx, plane, pre);
    const id = ctx.nextId();
    const f: Record<string, unknown> = { type: 'split', id, plane: pl };
    common(f, o);
    if (o.keep && o.keep !== 'both') f.keep = o.keep;
    ctx.lastFeature = id;
    return [...pre, { op: 'add', feature: f }];
  } });
  return this;
}

/** A closed two-part case: outside size, wall, optional corner radius, where the lid is cut and the lip (tongue). All lengths in mm. */
export interface CaseBoxOpts {
  /** outside width (x), mm */ width: Num;
  /** outside depth (y), mm */ depth: Num;
  /** outside height (z), lid included, mm */ height: Num;
  /** wall thickness, at least 0.4, default 2 */ wall?: Num;
  /** side edges: outside radius of the four vertical corners, default 0 (sharp); above 0 it must be more than the wall */ radius?: Num;
  /** top edges: round the outer edges of the lid top and of the base bottom with this radius, default 0 (sharp); never the seam rim */ topRadius?: Num;
  /** height of the lid: the cut is this far below the top (default a quarter of the height, at least 3 walls) */ lidHeight?: Num;
  /** how far the tongue stands out of its half (default 0.75 of the wall) */ tongueHeight?: Num;
  /** tongue width (default half the wall) */ tongueWidth?: Num;
  /** gap between tongue and groove on each side and on top, default 0.2 */ clearance?: Num;
  /** which half carries the tongue, default 'lid' */ tongueOn?: 'lid' | 'base';
  /** names of the halves [base, lid], default ['Base', 'Lid'] */ names?: [string, string];
  /** the way the case rises from its bottom face: 'y' (default, the app's up axis: the floor is on the Top plane, the lid on top) or 'z' (the case lies on the Front plane and rises towards the viewer). With 'y' the width runs along x and the depth along z */ axis?: 'y' | 'z';
  /** centre of the bottom face (world coordinates), default [0, 0, 0]; the case stands up from there along `axis` (+y by default) */ origin?: [Num, Num, Num];
  /** the body and feature name before the split, default 'Case' */ name?: string;
  /** 'cups' (default): two separate cups, each shelled open on one face, a lip on one rim and a groove on the other; 'lipJoint': one shelled box split by lipJoint (one body in the part only) */ joint?: 'cups' | 'lipJoint';
}
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;
/** A top round bigger than the wall thins the wall where the round meets the (square) inside corner: it is wall x sqrt2 - (sqrt2 - 1) x radius thick there. We keep at least half a wall: radius up to this x the wall. */
export const TOP_WALL_FACTOR = (Math.SQRT2 - 0.5) / (Math.SQRT2 - 1);
export const maxTopRadius = (wall: number): number => TOP_WALL_FACTOR * wall;
/** The numbers of a case after the defaults and the checks; throws SelectorError with the line of the call. */
export function caseGeometry(o: CaseBoxOpts, line?: number): { width: number; depth: number; height: number; wall: number; radius: number; topRadius: number; lidHeight: number; baseHeight: number; cut: number; tongueHeight: number; tongueWidth: number; clearance: number; tongueOn: 'lid' | 'base' } {
  const fail = (m: string): never => { throw new H.SelectorError(`caseBox(): ${m}`, line); };
  if (!o || typeof o !== 'object') fail('needs an options object { width, depth, height }');
  const w = H.num(o.width), d = H.num(o.depth), h = H.num(o.height);
  if (!(w > 0) || !(d > 0) || !(h > 0)) fail('width, depth and height (outside, in mm) must be more than 0');
  const wall = o.wall === undefined ? 2 : H.num(o.wall);
  if (!(wall >= 0.4)) fail(`wall must be at least 0.4 mm, not ${wall}`);
  if (!(2 * wall < Math.min(w, d, h))) fail(`two walls (${r6(2 * wall)} mm) must be less than the smallest outside size (${r6(Math.min(w, d, h))} mm)`);
  const radius = o.radius === undefined ? 0 : H.num(o.radius);
  if (!(radius >= 0)) fail('radius must be 0 or more');
  if (radius > 0 && !(radius > wall)) fail(`a corner radius (${radius}) must be 0 or more than the wall (${wall}), or the inside corner collapses`);
  if (radius > 0 && !(2 * radius <= Math.min(w, d))) fail(`the corner radius (${radius}) is more than half of the width or depth`);
  const topRadius = o.topRadius === undefined ? 0 : H.num(o.topRadius);
  if (!(topRadius >= 0)) fail('topRadius must be 0 or more');
  const lidHeight = o.lidHeight === undefined ? Math.max(h / 4, 3 * wall) : H.num(o.lidHeight);
  const tongueHeight = o.tongueHeight === undefined ? 0.75 * wall : H.num(o.tongueHeight);
  const tongueWidth = o.tongueWidth === undefined ? wall / 2 : H.num(o.tongueWidth);
  const clearance = o.clearance === undefined ? 0.2 : H.num(o.clearance);
  const tongueOn = o.tongueOn ?? 'lid';
  if (tongueOn !== 'lid' && tongueOn !== 'base') fail(`tongueOn is 'lid' or 'base', not ${JSON.stringify(o.tongueOn)}`);
  if (!(tongueHeight > 0)) fail('tongueHeight must be more than 0');
  if (!(tongueWidth > 0)) fail('tongueWidth must be more than 0');
  if (!(clearance >= 0 && clearance <= 1)) fail(`clearance must be between 0 and 1 mm, not ${clearance}`);
  if (!(tongueWidth + 2 * clearance < wall)) fail(`the tongue (${r6(tongueWidth)} mm) and its clearance on both sides (${r6(2 * clearance)} mm) must be less than the ${wall} mm wall: a narrower tongue or a smaller clearance`);
  const baseHeight = h - lidHeight;
  if (!(lidHeight > wall) || !(baseHeight > wall)) fail(`both halves must be taller than the wall (${wall} mm): the lid is ${r6(lidHeight)} mm and the base ${r6(baseHeight)} mm`);
  const groove = tongueHeight + clearance;
  const grooved = tongueOn === 'lid' ? baseHeight : lidHeight;
  if (!(grooved >= groove + wall)) fail(`the ${tongueOn === 'lid' ? 'base' : 'lid'} (${r6(grooved)} mm tall) must leave a wall (${wall} mm) under the groove, which is ${r6(groove)} mm deep: a lower tongue, or a taller ${tongueOn === 'lid' ? 'base' : 'lid'}`);
  if (topRadius > 0) {
    if (o.joint === 'lipJoint') fail("topRadius works with joint 'cups' only");
    if (!(2 * topRadius <= Math.min(w, d))) fail(`the top radius (${topRadius}) is more than half of the width or depth`);
    if (radius > 0 && !(topRadius <= radius)) fail(`the top radius (${topRadius}) must be at most the side radius (${radius}): the round follows the rounded outline`);
    if (!(topRadius <= maxTopRadius(wall))) fail(`the top radius (${topRadius}) is more than ${r6(maxTopRadius(wall))} mm (${r6(TOP_WALL_FACTOR)} x the wall): the wall at the round would be under half a wall thick`);
    const free = (half: number, grooved: boolean): number => half - (grooved ? groove : 0);
    const lidFree = free(lidHeight, tongueOn === 'base'), baseFree = free(baseHeight, tongueOn === 'lid');
    if (!(topRadius < Math.min(lidFree, baseFree))) fail(`the top radius (${topRadius}) must be less than ${r6(Math.min(lidFree, baseFree))} mm, the height of the ${lidFree <= baseFree ? 'lid' : 'base'} less its groove: the round would run into the seam`);
  }
  return { width: w, depth: d, height: h, wall, radius, topRadius, lidHeight, baseHeight, cut: baseHeight, tongueHeight, tongueWidth, clearance, tongueOn };
}

export const enclosureFeatures = {
  /**
   * A closed two-part case (base and lid with a lip joint) from outside sizes.
   *
   * Builds two cups: the base (height - lidHeight tall) and the lid (lidHeight tall), each a rectangle (rounded corners when radius > 0) extruded as its own body named by names and hollowed open at one end (wall thick); a ring tongue (tongueWidth x tongueHeight, centred in the wall) is raised on one rim and a groove (clearance wider on each side and deeper) sunk in the other, and the lid is moved on top: the closed case is width x depth x height and stands up from origin (the centre of the bottom) along axis: +y by default (the floor on the Top plane, the lid on top), +z with axis: 'z'. tongueOn 'lid' (default) puts the tongue on the lid. joint 'lipJoint' instead shells one closed box and splits it with lipJoint (the part must hold no other body). Checks (SelectorError): wall at least 0.4 and under half the smallest size; radius 0 or more than the wall; topRadius at most radius and 2.2 walls; tongue and clearance fit the wall; both halves taller than the wall and a wall left under the groove. Screw bosses, a seal groove and snap fits are not included.
   * @domain features
   * @param o options object { width, depth, height, ... }
   * @param o.width outside width (x) in mm
   * @param o.depth outside depth (y) in mm
   * @param o.height outside height in mm
   * @param o.wall wall thickness in mm, default 2
   * @param o.radius outside corner radius in mm, default 0
   * @param o.topRadius round of the lid top and base bottom edges in mm, default 0
   * @param o.lidHeight height of the lid in mm (the seam is at height - lidHeight), default a quarter of the height
   * @param o.tongueHeight in mm, default 0.75 of the wall
   * @param o.tongueWidth in mm, default half the wall
   * @param o.clearance gap between tongue and groove on each side and on top, in mm, default 0.2
   * @param o.tongueOn 'lid' (default) | 'base'
   * @param o.names [base, lid] body names, default ['Base', 'Lid']
   * @param o.axis 'y' (default, rises along +y, the app's up axis) | 'z'
   * @param o.origin [x, y, z] centre of the bottom, default [0, 0, 0]
   * @param o.name body name of the joint: 'lipJoint' variant only, default 'Case'
   * @param o.joint 'cups' (default) | 'lipJoint'
   * @example
   * part('Case').caseBox({ width: 80, depth: 50, height: 30, wall: 2, lidHeight: 15, tongueHeight: 1.5, tongueWidth: 1 });
   * @see part.lipJoint, part.shell, part.split
   */
  caseBox(this: PartBuilder, o: CaseBoxOpts): PartBuilder {
    const line = H.callerLine();
    const g = caseGeometry(o, line);
    const o3 = [0, 1, 2].map((i) => H.num(o.origin?.[i] ?? 0));
    const name = o.name === undefined ? 'Case' : String(o.name).trim();
    if (!name) throw new H.SelectorError('caseBox(): name must not be empty', line);
    const names = o.names ?? ['Base', 'Lid'];
    if (o.joint !== undefined && o.joint !== 'cups' && o.joint !== 'lipJoint') throw new H.SelectorError(`caseBox(): joint is 'cups' or 'lipJoint', not ${JSON.stringify(o.joint)}`, line);
    if (!Array.isArray(names) || names.length !== 2 || names.some((n) => typeof n !== 'string' || !n.trim()) || names[0].trim() === names[1].trim()) throw new H.SelectorError("caseBox(): names is two different names [base, lid], e.g. ['Base', 'Lid']", line);
    if (o.axis !== undefined && o.axis !== 'y' && o.axis !== 'z') throw new H.SelectorError(`caseBox(): axis is 'y' (default) or 'z', not ${JSON.stringify(o.axis)}`, line);
    // the case is built on the plane normal to its axis: 'top' (XZ, normal +Y) or 'front' (XY, normal +Z). su, sv are the sketch coordinates of the origin on it, rz how far up the axis it is.
    const pn = o.axis === 'z' ? 'front' as const : 'top' as const, fr = stdPlane(pn);
    const dot = (a: number[]): number => r6(a[0] * o3[0] + a[1] * o3[1] + a[2] * o3[2]) + 0;
    const su = dot(fr.x), sv = dot(fr.y), rz = dot(fr.normal);
    const base = rz === 0 ? pn : at(pn, rz);
    if (o.joint === 'lipJoint') {
      this.sketch(base, (s) => { s.rrect(g.width, g.depth, g.radius, [su, sv]); }, `${name} outline`).extrude(g.height, { newBody: name, name });
      this.feature({ type: 'shell', name: `${name} cavity`, faces: [], thickness: g.wall });
      return this.lipJoint(at(pn, r6(rz + g.cut)), { height: g.tongueHeight, width: g.tongueWidth, clearance: g.clearance, tongue: g.tongueOn === 'lid' ? 'above' : 'below', names: [names[0], names[1]], target: name });
    }
    // two cups: the base is built in place, the lid far to one side (clear of the base and of every other body, so nothing can touch its groove on the way) and moved on top at
    // the end. Each cup is an extrude of its own body shelled open at one cap (named by its persistent face name, so no solid is needed to build the ops: the wizard builds them
    // with none). A groove is a ring sketched on the rim and cut into it; a tongue is what is left of a rim layer tongueHeight thick after two cuts (the ring outside it, and the
    // disc inside it), so every step after the extrude is a cut limited to that cup and nothing is united: other bodies in the part, even ones touching each other, stay as they are.
    // Both sit centred in the wall, so the gap is the clearance on both sides and on top.
    const off = r6(10000 + 2 * g.width);
    const bn = names[0].trim(), ln = names[1].trim();
    const e0 = (g.wall - g.tongueWidth) / 2;   // the tongue's outer side, measured in from the outside of the wall
    const loop = (cx: number, e: number) => (s: SketchBuilder): void => { s.rrect(g.width - 2 * e, g.depth - 2 * e, g.radius > 0 ? g.radius - e : 0, [cx, sv]); };
    const plane = (z: number) => (r6(z) === 0 ? pn : at(pn, r6(z)));
    const cup = (cx: number, nm: string, height: number, upper: boolean, tongue: boolean) => {
      let id = '';
      const th = tongue ? g.tongueHeight : 0;   // a cup with a tongue is built that much taller, the tongue is the layer left at the rim
      const z0 = upper ? rz : rz - th;
      this.sketch(plane(z0), loop(cx, 0), `${nm} outline`).extrude(height + th, { newBody: nm, name: nm });
      const handle = this.handle();
      this.steps.push({ line, label: 'shell', run: (ctx) => { id = ctx.lastFeature ?? ''; const fid = ctx.nextId(); ctx.lastFeature = fid; return [{ op: 'add', feature: { type: 'shell', id: fid, faces: [`${id}.${upper ? 'C1' : 'C0'}`], thickness: g.wall } }]; } });
      if (g.topRadius > 0) this.steps.push({ line, label: 'fillet', run: (ctx) => {
        // the outer edges of the closed end: the loop between its cap and each side face of the outline (the sides are named by the sketch entities e1.., a line then an arc per corner)
        const ex = id, fid = ctx.nextId(), zc = upper ? z0 : z0 + height + th, hw = g.width / 2, hd = g.depth / 2, R = g.radius, k = R * (1 - Math.SQRT1_2), cy = sv;
        const pts: Array<[number, number] | null> = R > 0
          ? [2 * R < g.width ? [cx, cy - hd] : null, [cx + hw - k, cy - hd + k], 2 * R < g.depth ? [cx + hw, cy] : null, [cx + hw - k, cy + hd - k], 2 * R < g.width ? [cx, cy + hd] : null, [cx - hw + k, cy + hd - k], 2 * R < g.depth ? [cx - hw, cy] : null, [cx - hw + k, cy - hd + k]]
          : [[cx, cy - hd], [cx + hw, cy], [cx, cy + hd], [cx - hw, cy]];
        const edges = pts.flatMap((q, i) => (q ? [{ faces: [`${ex}.${upper ? 'C0' : 'C1'}`, `${ex}.S.e${i + 1}`], at: fr.toWorld([q[0], q[1]], zc).map((v) => r6(v) + 0) }] : []));
        ctx.lastFeature = fid;
        return [{ op: 'add', feature: { type: 'fillet', id: fid, name: `${nm} top round`, edges, radius: g.topRadius } }];
      } });
      const rim = upper ? z0 + height + th : z0, dir = upper ? 'into' as const : 'away' as const;
      if (tongue) {
        this.sketch(plane(rim), (s) => { s.rrect(g.width + 2, g.depth + 2, g.radius > 0 ? g.radius + 1 : 0, [cx, sv]); loop(cx, e0)(s); }, `${nm} tongue outside`).cut(r6(th), { direction: dir, from: nm, name: `${nm} tongue outside` });
        this.sketch(plane(rim), loop(cx, e0 + g.tongueWidth), `${nm} tongue inside`).cut(r6(th), { direction: dir, from: nm, name: `${nm} tongue inside` });
      } else {
        this.sketch(plane(rim), (s) => { loop(cx, e0 - g.clearance)(s); loop(cx, e0 + g.tongueWidth + g.clearance)(s); }, `${nm} groove`).cut(r6(g.tongueHeight + g.clearance), { direction: dir, from: nm, name: `${nm} groove` });
      }
      return handle;
    };
    cup(su, bn, g.baseHeight, true, g.tongueOn === 'base');
    const hl = cup(su + off, ln, g.lidHeight, false, g.tongueOn === 'lid');
    return this.moveBody(hl, { translate: [0, 1, 2].map((k) => r6(-off * fr.x[k] + g.baseHeight * fr.normal[k]) + 0) as [number, number, number] });
  },
  /**
   * Lip joint of a two-part case: split a shelled body at a plane, tongue on one half, groove on the other.
   *
   * Does split() and then makes, along the outer boundary of the seam (the walls of a shelled box), a centred tongue standing height mm out of one half and a matching channel in the other, wider by clearance on each side and deeper by clearance, so the halves fit with that clearance all round. The tongue is width mm wide (or widthRatio of the wall thickness, default 0.5) and sits inset mm from the outer wall (default: centred in the wall). The wall thickness is measured on the seam; a solid body has none, so give width and inset in mm. tongue: 'below' (default) puts the tongue on the lower half. Needs a flat seam and a closed outline. Errors say what does not fit the wall (invalidValue, field and detail).
   * @domain features
   * @param plane 'front' | 'top' | 'right', at(plane, offset) or face(sel): where to split
   * @param o.height tongue height (groove depth is height + clearance), mm
   * @param o.width tongue width in mm
   * @param o.widthRatio tongue width as a fraction of the wall thickness (default 0.5, when width is not given)
   * @param o.inset distance from the outer wall to the tongue in mm (default centred)
   * @param o.clearance gap between tongue and groove in mm (default 0.2)
   * @param o.tongue 'below' (default) | 'above': the half that carries the tongue
   * @param o.names [below, above] body names
   * @param o.target name of the body to split, when the part has several
   * @param o.flip reverse the plane normal (swaps below and above)
   * @example
   * part('Case').sketch('front', (s) => s.rect(60, 40)).extrude(20)
   *   .shell(face('>Z'), 2)
   *   .lipJoint(at('front', 10), { height: 1.5, width: 1, clearance: 0.2, names: ['Base', 'Lid'] });
   * @see part.split, part.shell, part.feature
   */
  lipJoint(this: PartBuilder, plane: PlaneArg, o: { height: Num; width?: Num; widthRatio?: Num; inset?: Num; clearance?: Num; tongue?: 'below' | 'above'; names?: [string, string]; target?: string; flip?: boolean }): PartBuilder {
    const line = H.callerLine();
    if (plane === undefined || plane === null) throw new H.SelectorError("lipJoint(plane, { height }): give the plane to cut at, e.g. lipJoint(at('front', 10), { height: 1.5, width: 1 })", line);
    if (!o || o.height === undefined) throw new H.SelectorError('lipJoint(): height (the tongue height in mm) is required, e.g. { height: 1.5, width: 1, clearance: 0.2 }', line);
    if (o.tongue !== undefined && o.tongue !== 'below' && o.tongue !== 'above') throw new H.SelectorError("lipJoint(): tongue is 'below' or 'above'", line);
    checkCommon('lipJoint', line, o);
    this.steps.push({ line, label: 'lipJoint', run: (ctx) => {
      const pre: EditOp[] = [];
      const pl = planeRef(ctx, plane, pre);
      const id = ctx.nextId();
      const f: Record<string, unknown> = { type: 'lipJoint', id, plane: pl, height: H.ref(o.height) };
      for (const k of ['width', 'widthRatio', 'inset', 'clearance'] as const) if (o[k] !== undefined) f[k] = H.ref(o[k] as Num);
      if (o.tongue && o.tongue !== 'below') f.tongue = o.tongue;
      common(f, o);
      ctx.lastFeature = id;
      return [...pre, { op: 'add', feature: f }];
    } });
    return this;
  },
};
