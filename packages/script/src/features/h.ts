// Shared plumbing of the feature mixins (loft, sweep, mirror, ...). recorder.ts binds the helpers it owns once, after the classes exist,
// so the mixins never import recorder.ts at run time (no import cycle) and recorder.ts stays untouched by new features.
import type { Ctx, EditOp, Expr, OffsetPlane, Plane, PlaneRef, SketchBuilder as SketchBuilderT } from '../recorder';
import type { EdgeSel, FaceSel, FacesSel, Geometry } from '../selectors';
import { buildPlane } from '../planes';

export interface Helpers {
  callerLine(): number;
  ref(n: number | Expr): number | string;
  num(n: number | Expr): number;
  SelectorError: new (message: string, line?: number) => Error;
  resolveFace(sel: string, geo: Geometry, line?: number): { id: string };
  resolveFaceSel(fs: FaceSel, geo: Geometry, warn?: (message: string, line: number) => void): { id: string };
  resolveFacesSel(fs: FaceSel | FacesSel, geo: Geometry, warn?: (message: string, line: number) => void): Array<{ id: string }>;
  resolveEdges(sel: EdgeSel['sel'], geo: Geometry, line?: number): Array<{ faces: string[]; at: number[] }>;
  newSketch(): SketchBuilderT;
}
export const H = {} as Helpers;
export const bindHelpers = (h: Helpers): void => { Object.assign(H, h); };

/** A sketch described for a feature that takes several: where it lies and how it is drawn (or, for a point section, where the point is). */
export interface SketchSpec {
  /** 'front' | 'top' | 'right', at(plane, offset), or face(sel) */
  on: Plane | OffsetPlane | PlaneRef | FaceSel;
  /** draws the outline with the sketch builder */
  draw?: (s: SketchBuilderT) => void;
  /** a point section ([x, y] in the sketch plane): a single point, the apex of a loft */
  point?: [number, number];
  name?: string;
}

/** Per-run memory of the mixins (ids of holes, surfaces) keyed by the runner's context. */
export interface Memory { holes: Array<{ id: string; n: number }>; surfaces: string[]; inserts: string[] }
const memory = new WeakMap<Ctx, Memory>();
export const memOf = (ctx: Ctx): Memory => { let m = memory.get(ctx); if (!m) memory.set(ctx, (m = { holes: [], surfaces: [], inserts: [] })); return m; };

/** The plane reference of a feature, adding the offset reference plane feature to `pre` when needed. */
export function planeRef(ctx: Ctx, on: Plane | OffsetPlane | PlaneRef | FaceSel, pre: EditOp[]): Record<string, unknown> {
  if (typeof on === 'string') return { kind: 'std', id: on };
  if ((on as PlaneRef).kind === 'planeRef') {   // a plane feature an earlier step of the same part made (its id is known once that step has run)
    const r = on as PlaneRef;
    if (!r.ref.id) throw new H.SelectorError('the plane this sketch sits on is not built yet', r.line);
    return { kind: 'feature', id: r.ref.id };
  }
  if ((on as OffsetPlane).kind === 'offset') {
    // the same builder `sketch(at(...))` uses: the base may be a standard plane, a face, a plane handle, a point + normal spec, between(), with rotate
    const o = on as OffsetPlane;
    const b = buildPlane(o.plane, o.offset, o.opts, { geo: ctx.geo, nextId: ctx.nextId, warn: ctx.warn }, o.line);
    pre.push(...b.ops);
    return b.ref;
  }
  const f = on as FaceSel;
  return { kind: 'face', id: H.resolveFaceSel(f, ctx.geo, ctx.warn).id };
}

/** Ops for one sketch spec (plane feature if offset, then the sketch) and its id. */
export function sketchOps(ctx: Ctx, spec: SketchSpec, ops: EditOp[]): string {
  const s = H.newSketch();
  if (spec.point) s.point(spec.point); else if (spec.draw) spec.draw(s);
  const plane = planeRef(ctx, spec.on, ops);
  const id = ctx.nextId();
  ops.push({ op: 'add', feature: { type: 'sketch', id, ...(spec.name ? { name: spec.name } : {}), plane, points: s.pointList, entities: s.entities, constraints: [] } });
  return id;
}

/** from: 'Name' | ['A', 'B'] on a cut: the kernel's `target` (a list of body selections); the cut then changes only those bodies. */
export function applyFrom(f: Record<string, unknown>, op: 'add' | 'cut', from: string | string[] | undefined, label: string, line: number): void {
  if (from === undefined) return;
  const names = Array.isArray(from) ? from : [from];
  if (!names.length || names.some((n) => typeof n !== 'string' || !n.trim())) throw new H.SelectorError(`${label}(): from is a body name or a list of body names, e.g. from: 'Cup' (bodies are named by newBody: 'Name')`, line);
  if (op !== 'cut') throw new H.SelectorError(`${label}(): from applies to a cut (it names the bodies the cut changes); an added solid joins what it touches, or use newBody`, line);
  f.target = names.map((n) => ({ body: n.trim() }));
}

/** newBody: true | 'Name' on a solid-making feature: the kernel's `newBody` op (a separate body, not united with what it touches); a string names the body. */
export function applyNewBody(f: Record<string, unknown>, op: 'add' | 'cut', newBody: boolean | string | undefined, label: string, line: number): void {
  if (newBody === undefined || newBody === false) return;
  if (op === 'cut') throw new H.SelectorError(`${label}(): newBody applies to material you add, not to a cut (a cut hits every body it reaches; from: 'Name' limits it to named bodies)`, line);
  if (typeof newBody === 'string' && !newBody.trim()) throw new H.SelectorError(`${label}(): newBody must be true or a non-empty body name`, line);
  f.op = 'newBody';
  if (typeof newBody === 'string') f.body = newBody.trim();
}
