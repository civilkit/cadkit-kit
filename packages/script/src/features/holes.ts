// Hole feature JSON for every kind (simple, counterbore, countersink, tapped), shared by hole() and holes.*.
import type { Ctx, EditOp, HoleOpts } from '../recorder';
import type { FaceSel } from '../selectors';
import { H, memOf } from './h';
import { ISO_TABLE, ISO_SIZES } from '../../../../apps/cad/src/holeData';
import { threadOp } from './misc';

const ISO = /^M\d+(\.\d+)?$/;

/** The sketch of points and the hole feature (plus thread features for a tapped hole) for the centres `pts` on face `on`. */
export function holeOps(ctx: Ctx, on: FaceSel, pts: Array<[number, number]>, o: HoleOpts, line: number): EditOp[] {
  const sid = ctx.nextId(), id = ctx.nextId();
  const fc = H.resolveFace(on.sel, ctx.geo, on.line);
  const thread = o.thread === undefined || o.thread === false ? null : typeof o.thread === 'string' ? { size: o.thread } : o.thread === true ? { size: o.size } : o.thread;
  const kind = o.kind === 'tapped' || thread ? 'tapped' : o.kind ?? 'simple';
  if (!['simple', 'cbore', 'csk', 'tapped'].includes(kind)) throw new H.SelectorError(`hole kind must be 'simple', 'cbore', 'csk' or 'tapped', not '${kind}'`, line);
  let size = thread?.size ?? o.size;
  let fit: string = o.fit ?? 'normal';
  const tapped = kind === 'tapped';
  // the kernel cuts a counterbore / countersink only for a standard size: a plain diameter is mapped to the ISO size whose hole it is
  if ((kind === 'cbore' || kind === 'csk') && !size && o.diameter !== undefined) {
    const d = H.num(o.diameter);
    for (const sz of ISO_SIZES) for (const f of ['normal', 'close', 'loose'] as const) if (!size && Math.abs(ISO_TABLE[sz][f] - d) < 0.051) { size = sz; fit = f; }
    if (!size) throw new H.SelectorError(`a ${kind === 'cbore' ? 'counterbore' : 'countersink'} hole takes a standard size: give size ("M6") instead of diameter ${d}, or a diameter that is a standard clearance hole (${ISO_SIZES.map((z) => `${z}: ${ISO_TABLE[z].normal}`).join(', ')})`, line);
  }
  if (tapped && !size) throw new H.SelectorError(`a tapped hole needs the thread designation: { kind: 'tapped', thread: 'M6' }`, line);
  if (o.diameter === undefined && !size) throw new H.SelectorError('a hole needs diameter (mm) or an ISO size such as size: "M6"', line);
  if (kind === 'cbore' && (o.cboreDiameter === undefined) !== (o.cboreDepth === undefined)) throw new H.SelectorError('a counterbore needs cboreDiameter and cboreDepth together (or neither, to use the ISO 4762 table for size)', line);
  const end = o.end === 'upTo' ? 'upToNext' : o.end ?? (o.depth === undefined ? 'through' : 'blind');
  if (end === 'blind' && o.depth === undefined) throw new H.SelectorError("a blind hole needs depth (or end: 'through')", line);
  const hole: Record<string, unknown> = { type: 'hole', id, sketch: sid, kind: kind === 'csk' ? 'countersink' : kind === 'cbore' ? 'cbore' : 'simple', end, flip: o.flip ?? false };
  if (tapped) {
    if (!ISO.test(size!)) throw new H.SelectorError(`a tapped hole takes a metric ISO size (M2..M24), not "${size}"; drill with diameter and add thread() for other standards`, line);
    Object.assign(hole, { standard: 'iso', size, fit: 'tap' });
  } else if (size) Object.assign(hole, { standard: 'iso', size, fit });
  else hole.diameter = H.ref(o.diameter!);
  if (end === 'blind') hole.depth = H.ref(o.depth!);
  if (o.cboreDiameter !== undefined) hole.cboreDiameter = H.ref(o.cboreDiameter);
  if (o.cboreDepth !== undefined) hole.cboreDepth = H.ref(o.cboreDepth);
  if (o.cskDiameter !== undefined) hole.cskDiameter = H.ref(o.cskDiameter);
  if (o.cskAngle !== undefined) hole.cskAngle = H.ref(o.cskAngle);
  ctx.lastFeature = id;
  memOf(ctx).holes.push({ id, n: pts.length });
  const ops: EditOp[] = [
    { op: 'add', feature: { type: 'sketch', id: sid, plane: { kind: 'face', id: fc.id }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map((p, i) => ({ id: `p${i + 1}`, x: +p[0].toFixed(6), y: +p[1].toFixed(6) }))], entities: pts.map((_, i) => ({ id: `e${i + 1}`, type: 'point', p: `p${i + 1}` })), constraints: [] } },
    { op: 'add', feature: hole },
  ];
  if (tapped) {
    const t = typeof o.thread === 'object' && o.thread ? o.thread : {};
    for (let k = 0; k < pts.length; k++) ops.push(threadOp(ctx, `${id}.S.h1${pts.length > 1 ? `~${k + 1}` : ''}`, size!, { ...t, ...(t.modeled === undefined && o.modeled !== undefined ? { modeled: o.modeled } : {}) }));
  }
  return ops;
}
