// The placement gizmo for a whole body: axis arrows (move along X, Y, Z), three plane squares (move in a plane), three
// rings (rotate about X, Y, Z) and a centre dot (move the gizmo itself). The kernel has no `moveBody` yet (every request
// for it answers "needs ck-ops"), so the app passes no Placement and the gizmo stays off. Everything here is built against
// the `Placement` interface so it is tested with a fake and switches on the day the kernel gains the feature; the field
// names of the moveBody feature below are provisional and must be checked against the kernel then.
import type { EditOp } from '@ck/session';
import type { HandleSpec, Vec3 } from '@kit/viewport';
import type { Box } from '../featureCommands';
import type { HandleSession } from './session';
import { t } from '../i18n';

export interface MoveParams {
  translate: Vec3;
  /** Rotation about a world axis through `origin`, degrees. */
  rotate?: { axis: Vec3; angle: number; origin: Vec3 };
  copy: boolean;
}

export interface Placement {
  /** The moveBody feature already made for this body, if any (a second drag updates it instead of adding another). */
  existing(): { id: string; params: MoveParams } | null;
  /** Ops that create or update the feature for these parameters. */
  ops(p: MoveParams): EditOp[];
}

/** Provisional wire form of a moveBody feature. */
export function moveBodyOps(p: MoveParams, existing: { id: string } | null): EditOp[] {
  const feature = { type: 'moveBody', translate: p.translate, ...(p.rotate ? { rotate: p.rotate } : {}), copy: p.copy };
  return existing ? [{ op: 'replace', id: existing.id, feature: { ...feature, id: existing.id } } as EditOp] : [{ op: 'add', feature } as EditOp];
}

const AXES: Array<{ id: 'x' | 'y' | 'z'; v: Vec3; colour: string }> = [
  { id: 'x', v: [1, 0, 0], colour: '#e5484d' }, { id: 'y', v: [0, 1, 0], colour: '#30a46c' }, { id: 'z', v: [0, 0, 1], colour: '#3e63dd' },
];

/** Handle specs of the gizmo around the box centre. */
export function placementSpecs(box: Box | null): HandleSpec[] {
  const c: Vec3 = box ? [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2) as Vec3 : [0, 0, 0];
  const out: HandleSpec[] = [];
  for (const a of AXES) {
    out.push({ id: `move-${a.id}`, kind: 'arrow', origin: c, axis: a.v, color: a.colour, label: t('handles.move.' + a.id) });
    out.push({ id: `turn-${a.id}`, kind: 'ring', origin: c, axis: a.v, color: a.colour, unit: 'deg', label: t('handles.turn.' + a.id), sizePx: 64 });
  }
  // plane squares: the normal is the missing axis, `u` the next one round
  const planes: Array<[string, Vec3, Vec3]> = [['xy', [0, 0, 1], [1, 0, 0]], ['yz', [1, 0, 0], [0, 1, 0]], ['zx', [0, 1, 0], [0, 0, 1]]];
  for (const [id, n, u] of planes) out.push({ id: `plane-${id}`, kind: 'plane', origin: c, axis: n, u, color: '#9b59d0', label: t('handles.plane.' + id) });
  out.push({ id: 'centre', kind: 'dot', origin: c, axis: [0, 0, 1], sizePx: 6, label: t('handles.centre') });
  return out;
}

/** Whether a body drag should make a copy (Ctrl held; right-drag in IronCAD) is decided by the caller through `copy`. */
export function placementSession(p: Placement, box: Box | null, copy: () => boolean = () => false): HandleSession {
  const c: Vec3 = box ? [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2) as Vec3 : [0, 0, 0];
  const params = (id: string, q: number, vec: Vec3): MoveParams | null => {
    if (id.startsWith('move-') || id.startsWith('plane-')) return { translate: vec, copy: copy() };
    if (id.startsWith('turn-')) {
      const axis = AXES.find((a) => a.id === id.slice(5))!.v;
      return { translate: [0, 0, 0], rotate: { axis, angle: q, origin: c }, copy: copy() };
    }
    return null;   // the centre dot moves the gizmo only, not the body
  };
  const ops = (id: string, q: number, vec: Vec3): EditOp[] | null => {
    const m = params(id, q, vec);
    if (!m) return null;
    if (!m.rotate && Math.hypot(...m.translate) < 1e-9) return null;
    if (m.rotate && Math.abs(m.rotate.angle) < 1e-9) return null;
    return p.ops(m);
  };
  return {
    kind: 'placement', specs: placementSpecs(box),
    preview: ops,
    commit: (id, q, vec) => { const o = ops(id, q, vec); return o ? { ops: o, create: !p.existing() } : null; },
    step: (id) => (id.startsWith('turn-') ? 15 : 1),
  };
}
