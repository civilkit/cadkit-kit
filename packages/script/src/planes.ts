// Workplane builder: turns the argument of at() / part.workplane() into reference-plane features the kernel understands.
// Modes used: offset (base plane / face / plane feature moved along its normal), angle (base rotated about an axis line), threePoints
// (point + normal: three helper sketch points on offset planes, the kernel has no plane-from-point-and-normal mode).
import { ref, type Num } from './num';
import { resolveEdgeInfos, resolveFaceSel, SelectorError, type EdgeSel, type FaceSel, type Geometry, type Vec, type WarnFn } from './selectors';

export type Plane = 'front' | 'top' | 'right';
/** A plane given by a point and a normal (and optionally the x direction of the sketch). */
export interface PlaneSpec { origin: Vec; normal: Vec; xdir?: Vec }
export type PlaneBase = Plane | FaceSel | { id: string | null } | PlaneSpec;
/** Rotate the plane about an axis line: a world axis, [ox,oy,oz,dx,dy,dz], or a straight edge. */
export interface PlaneRotate { axis: 'x' | 'y' | 'z' | number[] | EdgeSel; angle: Num }
export interface PlaneOpts { rotate?: PlaneRotate; flip?: boolean }
export interface PlaneCtx { geo: Geometry; nextId(): string; warn?: WarnFn }
type Op = { op: 'add'; feature: Record<string, unknown> };

const isSpec = (b: PlaneBase): b is PlaneSpec => typeof b === 'object' && b !== null && 'origin' in b && 'normal' in b;
const isFace = (b: PlaneBase): b is FaceSel => typeof b === 'object' && b !== null && (b as FaceSel).kind === 'face';
const nrm = (v: Vec): Vec => { const l = Math.hypot(v[0], v[1], v[2]); if (l < 1e-12) throw new SelectorError('workplane: a zero vector cannot be a normal or direction', 0); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotv = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The plane (a feature id the sketch can sit on) for `base` moved by `offset`, plus the features that make it. */
export function buildPlane(base: PlaneBase, offset: Num, opts: PlaneOpts, ctx: PlaneCtx, line: number): { ops: Op[]; ref: { kind: string; id: string } } {
  const ops: Op[] = [];
  const add = (f: Record<string, unknown>): string => { const id = ctx.nextId(); ops.push({ op: 'add', feature: { type: 'plane', id, ...f } }); return id; };
  let baseRef: Record<string, unknown>;
  let off: Num = offset;
  if (isSpec(base)) {
    const n = nrm(base.normal), o = base.origin;
    const ax = (i: number) => Math.abs(n[i]) > 1 - 1e-9;
    if (!base.xdir && (ax(0) || ax(1) || ax(2))) {
      // an axis-aligned normal is a standard plane moved along its normal
      const i = ax(2) ? 2 : ax(1) ? 1 : 0;
      const std = (['right', 'top', 'front'] as const)[i];
      baseRef = { kind: 'std', id: std };
      off = o[i];
      if (n[i] < 0) { const id = add({ mode: 'offset', base: baseRef, offset: -o[i], flip: true }); return finish(ops, id, opts, ctx, line, add); }
    } else {
      let u: Vec;
      if (base.xdir) { const x = nrm(base.xdir); const d = dotv(x, n); u = nrm([x[0] - d * n[0], x[1] - d * n[1], x[2] - d * n[2]]); } else u = nrm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const v = cross(n, u);
      const pts: Vec[] = [[o[0], o[1], o[2]], [o[0] + u[0] * 10, o[1] + u[1] * 10, o[2] + u[2] * 10], [o[0] + v[0] * 10, o[1] + v[1] * 10, o[2] + v[2] * 10]];
      // three points -> sketch points on front-plane copies at each z (the kernel resolves sketch points to world points)
      const zs = [...new Set(pts.map((p) => +p[2].toFixed(9)))];
      const refs: Array<{ kind: string; sketch: string; point: string }> = [];
      for (const z of zs) {
        const sid = ctx.nextId();
        const plane: Record<string, unknown> = z === 0 ? { kind: 'std', id: 'front' } : { kind: 'feature', id: add({ mode: 'offset', base: { kind: 'std', id: 'front' }, offset: z, visible: false }) };
        const mine = pts.map((p, i) => [p, i] as const).filter(([p]) => +p[2].toFixed(9) === z);
        ops.push({ op: 'add', feature: { type: 'sketch', id: sid, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...mine.map(([p, i]) => ({ id: `q${i}`, x: +p[0].toFixed(9), y: +p[1].toFixed(9) }))], entities: mine.map(([, i]) => ({ id: `e${i}`, type: 'point', p: `q${i}` })), constraints: [] } });
        for (const [, i] of mine) refs[i] = { kind: 'sketchPoint', sketch: sid, point: `q${i}` };
      }
      const id = add({ mode: 'threePoints', points: refs, ...(opts.flip ? { flip: true } : {}) });
      return finish(ops, id, opts, ctx, line, add);
    }
  } else if (typeof base === 'string') baseRef = { kind: 'std', id: base };
  else if (isFace(base)) baseRef = { kind: 'face', id: resolveFaceSel(base, ctx.geo, ctx.warn).id };
  else {
    if (!base.id) throw new SelectorError('at(): the plane feature handle is not resolved yet (take it with part.handle() right after part.workplane(...))', line);
    baseRef = { kind: 'feature', id: base.id };
  }
  const id = add({ mode: 'offset', base: baseRef, offset: ref(off), ...(opts.flip ? { flip: true } : {}) });
  return finish(ops, id, opts, ctx, line, add);
}

function finish(ops: Op[], id: string, opts: PlaneOpts, ctx: PlaneCtx, line: number, add: (f: Record<string, unknown>) => string): { ops: Op[]; ref: { kind: string; id: string } } {
  if (!opts.rotate) return { ops, ref: { kind: 'feature', id } };
  const r = opts.rotate;
  let axis: Record<string, unknown>;
  if (typeof r.axis === 'string') axis = { kind: 'axis', axis: r.axis };
  else if (Array.isArray(r.axis)) {
    const a = r.axis as number[];
    const d = nrm([a[3], a[4], a[5]]);
    const c = cross([a[0], a[1], a[2]], d);
    const wi = [0, 1, 2].find((i) => Math.abs(d[i]) > 1 - 1e-9);
    if (wi === undefined || Math.hypot(...c) > 1e-6) throw new SelectorError('at(): the rotation axis must be a world axis through the origin (the kernel rotates a plane about x, y, z or a straight edge)', line);
    axis = { kind: 'axis', axis: 'xyz'[wi] };
  } else {
    const e = resolveEdgeInfos(r.axis.sel, ctx.geo, r.axis.line, ctx.warn)[0];
    axis = { kind: 'edge', faces: [...e.faces!], at: [...e.mid!] };
  }
  const pid = add({ mode: 'angle', base: { kind: 'feature', id }, axis, angle: ref(r.angle) });
  return { ops, ref: { kind: 'feature', id: pid } };
}
