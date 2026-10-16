// Shared plumbing of the feature mixins (loft, sweep, mirror, ...). recorder.ts binds the helpers it owns once, after the classes exist,
// so the mixins never import recorder.ts at run time (no import cycle) and recorder.ts stays untouched by new features.
import type { Ctx, EditOp, Expr, OffsetPlane, Plane, SketchBuilder as SketchBuilderT } from '../recorder';
import type { EdgeSel, FaceSel, Geometry } from '../selectors';

export interface Helpers {
  callerLine(): number;
  ref(n: number | Expr): number | string;
  num(n: number | Expr): number;
  SelectorError: new (message: string, line?: number) => Error;
  resolveFace(sel: string, geo: Geometry, line?: number): { id: string };
  resolveEdges(sel: EdgeSel['sel'], geo: Geometry, line?: number): Array<{ faces: string[]; at: number[] }>;
  newSketch(): SketchBuilderT;
}
export const H = {} as Helpers;
export const bindHelpers = (h: Helpers): void => { Object.assign(H, h); };

/** A sketch described for a feature that takes several: where it lies and how it is drawn (or, for a point section, where the point is). */
export interface SketchSpec {
  /** 'front' | 'top' | 'right', at(plane, offset), or face(sel) */
  on: Plane | OffsetPlane | FaceSel;
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
export function planeRef(ctx: Ctx, on: Plane | OffsetPlane | FaceSel, pre: EditOp[]): Record<string, unknown> {
  if (typeof on === 'string') return { kind: 'std', id: on };
  if ((on as OffsetPlane).kind === 'offset') {
    const o = on as OffsetPlane;
    const pid = ctx.nextId();
    pre.push({ op: 'add', feature: { type: 'plane', id: pid, mode: 'offset', base: { kind: 'std', id: o.plane }, offset: H.ref(o.offset) } });
    return { kind: 'feature', id: pid };
  }
  const f = on as FaceSel;
  return { kind: 'face', id: H.resolveFace(f.sel, ctx.geo, f.line).id };
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
