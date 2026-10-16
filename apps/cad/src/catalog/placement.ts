// Where a catalog item stands and which way it grows. Pure maths, no DOM and no kernel.
//
// BOSL2 shapes are Z-up: a prismoid's height runs along the sketch plane's normal. Our world is Y-up with the ground the Top plane
// (XZ), so the first body goes on the GROUND plane (the plane whose normal is the up axis) and rises away from it. The user can
// choose another plane (Front / Top / Right or a plane feature), flip the shape to the other side of the plane, turn it in 90 degree
// steps about the plane normal and mirror it. All of that is done in the sketch-plane frame: the profile points are turned about the
// shape's centre, a flip reverses the extrusion (the extrude's own Flip field, a flipped offset plane for a loft), so the features
// stay ordinary, editable features.
import type { V3 } from './geometry';

export type UpAxis = 'y' | 'z';
export type StdPlane = 'front' | 'top' | 'right';
export type PlaneRef = { kind: 'std'; id: StdPlane } | { kind: 'feature'; id: string };
export interface Placement { flip: boolean; rot: 0 | 1 | 2 | 3; mirror: boolean }
export const NO_PLACEMENT: Placement = { flip: false, rot: 0, mirror: false };
/** What the user chose: a plane (auto: the ground plane of the up axis) and how to stand the shape on it. */
export interface PlacementSetting extends Placement { plane: StdPlane | 'auto' }
export const DEFAULT_SETTING: PlacementSetting = { plane: 'auto', ...NO_PLACEMENT };

/** The kernel's standard sketch planes: in-plane axes x and y, and the normal a sketch extrudes along. */
export const STD_FRAMES: Record<StdPlane, { x: V3; y: V3; n: V3 }> = {
  front: { x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] },
  top: { x: [1, 0, 0], y: [0, 0, -1], n: [0, 1, 0] },
  right: { x: [0, 0, -1], y: [0, 1, 0], n: [1, 0, 0] },
};
/** World letter of each plane's normal (edge selectors like '|Z'). */
export const NORMAL_AXIS: Record<StdPlane, 'X' | 'Y' | 'Z'> = { front: 'Z', top: 'Y', right: 'X' };

/** The horizontal plane for an up axis: its normal is the up axis. */
export const groundPlane = (up: UpAxis): StdPlane => (up === 'z' ? 'front' : 'top');
export const isStd = (id: unknown): id is StdPlane => id === 'front' || id === 'top' || id === 'right';

const neg = (v: V3): V3 => [-v[0] || 0, -v[1] || 0, -v[2] || 0];
const norm0 = (v: V3): V3 => [v[0] || 0, v[1] || 0, v[2] || 0];

/**
 * The frame a shape ends up in: `x`/`y` are where the profile's own x and y point in the world after mirror and rotation, `dir`
 * is the direction the shape grows (the plane normal, or its opposite when flipped).
 */
export function placementFrame(plane: StdPlane, p: Placement): { x: V3; y: V3; dir: V3 } {
  const f = STD_FRAMES[plane];
  let x = f.x, y = f.y;
  if (p.mirror) x = neg(x);
  for (let k = 0; k < p.rot; k++) { const nx = y, ny = neg(x); x = nx; y = ny; }       // 90 degrees counter-clockwise: x -> y, y -> -x
  return { x: norm0(x), y: norm0(y), dir: p.flip ? neg(f.n) : f.n };
}

/** Where a ray meets a standard plane (through the origin), world coordinates, or null (parallel / behind). */
export function rayStdPlane(plane: StdPlane, o: ArrayLike<number>, d: ArrayLike<number>): V3 | null {
  const n = STD_FRAMES[plane].n;
  const den = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
  if (Math.abs(den) < 1e-9) return null;
  const t = -(n[0] * o[0] + n[1] * o[1] + n[2] * o[2]) / den;
  return t > 0 ? [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]] : null;
}
/** A world point in a standard plane's sketch coordinates. */
export function toPlaneUV(plane: StdPlane, pt: ArrayLike<number>): [number, number] {
  const f = STD_FRAMES[plane];
  return [pt[0] * f.x[0] + pt[1] * f.x[1] + pt[2] * f.x[2] || 0, pt[0] * f.y[0] + pt[1] * f.y[1] + pt[2] * f.y[2] || 0];
}

type Ent = Record<string, unknown>;
interface Pt { id: string; x: unknown; y: unknown; fixed?: boolean }
type Feat = Record<string, unknown>;

/** A sketch whose plane is a perpendicular helper plane (a revolve profile): only the flip applies to it. */
function perpendicularPlanes(features: Feat[]): Set<string> {
  return new Set(features.filter((f) => f.type === 'plane' && f.mode === 'perpendicular').map((f) => String(f.id)));
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function mapPoints(s: Feat, fn: (x: number, y: number) => [number, number]): void {
  for (const p of (s.points as Pt[]) ?? []) {
    if (p.fixed || !isNum(p.x) || !isNum(p.y)) continue;
    const [x, y] = fn(p.x, p.y);
    p.x = +x.toFixed(9); p.y = +y.toFixed(9);
  }
}
/** A mirror reverses the winding of an arc: swap its ends so it keeps the same side. */
function swapArcs(s: Feat): void {
  for (const e of (s.entities as Ent[]) ?? []) if (e.type === 'arc') { const a = e.p1; e.p1 = e.p2; e.p2 = a; }
}

/**
 * Apply rotation, mirror and flip to the features a shape was built from (they are changed in place; the features are fresh from the
 * builder). `about` is the shape centre in the plane. Sketches on the placement plane (and on offset planes made from it for a
 * loft) are turned; a revolve profile on a perpendicular helper plane is only flipped (a body of revolution is turned already).
 */
export function applyPlacement(features: Feat[], p: Placement, about: [number, number]): void {
  if (!p.flip && !p.rot && !p.mirror) return;
  const perp = perpendicularPlanes(features);
  const [cu, cv] = about;
  for (const f of features) {
    if (f.type === 'sketch') {
      const plane = f.plane as { kind?: string; id?: string } | undefined;
      if (plane?.kind === 'feature' && perp.has(String(plane.id))) {
        if (p.flip) { mapPoints(f, (x, y) => [x, -y]); swapArcs(f); }
        continue;
      }
      const turn = (x: number, y: number): [number, number] => {
        let dx = x - cu, dy = y - cv;
        if (p.mirror) dx = -dx;
        for (let k = 0; k < p.rot; k++) { const t = dx; dx = -dy; dy = t; }
        return [cu + dx, cv + dy];
      };
      if (p.rot || p.mirror) { mapPoints(f, turn); if (p.mirror) swapArcs(f); }
    } else if (f.type === 'extrude' || f.type === 'cut') {
      if (p.flip) f.flip = !f.flip;
    } else if (f.type === 'plane' && f.mode === 'offset' && p.flip) {
      f.flip = !f.flip;
    }
  }
}

/** Short text for the history entry, e.g. `Top plane, down, turned 90`; '' when nothing was changed from the default stand. */
export function describePlacement(plane: string, p: Placement): string {
  const bits = [plane + ' plane'];
  if (p.flip) bits.push('flipped');
  if (p.rot) bits.push(`turned ${p.rot * 90}`);
  if (p.mirror) bits.push('mirrored');
  return bits.join(', ');
}
