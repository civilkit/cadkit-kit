// The frame of a knurl built from an end face of the cylinder (knurl({ onFace })) instead of from absolute numbers: every plane the grooves are drawn on is
// derived from that face, so when the part is edited and the face moves along its normal, the band moves with it (it keeps its distance from the face).
// Same planes as the bearing built on a face (bearing.ts): a plane offset from the face for the groove profiles across the cylinder, and for everything
// drawn along the axis (rings, the sweep path) a guide axis lying in the face and a plane through that axis, perpendicular to the face, whose sketch y runs
// into the part from the face. The kernel gives the planes; nothing here needs the geometry of the part.
import type { Ctx, EditOp, PartBuilder, PlaneRef } from '../recorder';
import { cross3, dot3, type V3 } from './screw';
import { faceXY, r9 } from './bearing';

type Pt = [number, number];
const STD_OF_AXIS = ['right', 'top', 'front'] as const;   // the standard plane whose normal is world x, y, z
const UNIT: Record<'x' | 'y' | 'z', V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** The same shape as knurl.ts's `frame()` of absolute positions, so the groove code is written once. */
export interface FaceFrame {
  /** the plane across the cylinder at axial position `a` (world coordinate); asking for it records the plane */
  cross(a: number): PlaneRef;
  cu: number;
  cv: number;
  /** a plane containing the axis (recorded on first use) */
  readonly side: PlaneRef;
  axisPt(a: number): Pt;
  ringPt(a: number, r: number): Pt;
  /** direction of a cut from a plane at `from` towards `to` */
  dir: 'into' | 'away';
}

/**
 * @param face  the end face of the cylinder (a flat face whose normal lies along the cylinder axis)
 * @param at    the world position of that face along the axis
 * @param outward  +1 when the face faces along +axis (the far end), -1 when it faces against it (the near end): the band lies on the other side of it
 */
export function knurlFaceFrame(part: PartBuilder, line: number, o: { axis: 'x' | 'y' | 'z'; center: Pt; face: string; at: number; outward: 1 | -1 }): FaceFrame {
  const { axis, face, at, outward } = o;
  const k = 'xyz'.indexOf(axis);
  const p3: V3 = [0, 0, 0];
  const across = ([0, 1, 2].filter((i) => i !== k)) as number[];
  p3[across[0]] = o.center[0]; p3[across[1]] = o.center[1];
  const n: V3 = [UNIT[axis][0] * outward, UNIT[axis][1] * outward, UNIT[axis][2] * outward];   // the face's outward normal
  const d: V3 = [-n[0], -n[1], -n[2]];   // into the part
  const j = (k + 1) % 3;
  const e: V3 = [0, 0, 0]; e[j] = 1;
  const dl = cross3(d, e);   // sketch x of the profile plane: the direction of the guide axis
  const f = faceXY(n);   // the sketch frame of a plane made from the face
  const u = r9(dot3(p3, dl));
  const add = (feature: Record<string, unknown>): EditOp => ({ op: 'add', feature });
  const push = (label: string, run: (ctx: Ctx) => EditOp[]): void => { part.steps.push({ line, label, run }); };

  let facePlane: { id: string | null } | null = null;
  const base = (): { id: string | null } => {
    if (facePlane) return facePlane;
    const h: { id: string | null } = { id: null };
    facePlane = h;
    push('knurl face plane', (ctx) => { h.id = ctx.nextId(); return [add({ type: 'plane', id: h.id, mode: 'offset', base: { kind: 'face', id: face }, offset: 0, flip: true, visible: false, name: 'Knurl face plane' })]; });
    return h;
  };
  const crossPlanes = new Map<number, PlaneRef>();
  let sidePlane: PlaneRef | null = null;
  return {
    cross(a) {
      const key = r9(a);
      let pl = crossPlanes.get(key);
      if (!pl) {
        const h = { id: null as string | null };
        // an unflipped plane made from the face has its normal along the face's outward normal: it sits (a - at) * outward from the face
        push('knurl plane', (ctx) => { h.id = ctx.nextId(); return [add({ type: 'plane', id: h.id, mode: 'offset', base: { kind: 'face', id: face }, offset: r9((a - at) * outward), visible: false, name: 'Knurl plane' })]; });
        pl = { kind: 'planeRef', ref: h, line };
        crossPlanes.set(key, pl);
      }
      return pl;
    },
    cu: dot3(p3, f.x),
    cv: dot3(p3, f.y),
    get side(): PlaneRef {
      if (!sidePlane) {
        const fp = base();
        const h = { id: null as string | null };
        push('knurl guide', (ctx) => {
          const q = ctx.nextId(), ax = ctx.nextId();
          h.id = ctx.nextId();
          return [
            add({ type: 'plane', id: q, mode: 'offset', base: { kind: 'std', id: STD_OF_AXIS[j] }, offset: r9(p3[j]), visible: false, name: 'Knurl guide plane' }),
            add({ type: 'axis', id: ax, refs: [{ kind: 'feature', id: fp.id }, { kind: 'feature', id: q }], name: 'Knurl guide axis' }),
            add({ type: 'plane', id: h.id, mode: 'perpendicular', base: { kind: 'feature', id: fp.id }, axis: { kind: 'feature', id: ax }, visible: false, name: 'Knurl profile plane' }),
          ];
        });
        sidePlane = { kind: 'planeRef', ref: h, line };
      }
      return sidePlane;
    },
    // on the profile plane: x along the guide axis (u is the cylinder axis), y the distance into the part from the face
    axisPt: (a) => [u, r9((at - a) * outward)],
    ringPt: (a, r) => [u + r, r9((at - a) * outward)],
    dir: outward > 0 ? 'away' : 'into',
  };
}
