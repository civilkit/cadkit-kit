// Recorder leaf: the plain types, the plane helpers and the caller-line probe that the recorder and the feature mixins share.
// Kept free of recorder.ts / features so that those can import from here without an import cycle (recorder.ts re-exports all of it).
import { Expr } from './num';
import type { PlaneBase, PlaneOpts } from './planes';
import { SelectorError, type Geometry, type Vec } from './selectors';

/** The 1-based script line of the caller, from the stack of the evaluated function (see run.ts: sourceURL + header offset). */
let lineOffset = 2;
export const setLineOffset = (n: number): void => { lineOffset = n; };
export function callerLine(): number {
  const m = /kit-script:(\d+):\d+/.exec(new Error().stack ?? '');
  return m ? Math.max(1, Number(m[1]) - lineOffset) : 0;
}


export type Plane = 'front' | 'top' | 'right';

export type EditOp = { op: 'add'; feature: Record<string, unknown>; index?: number };
/** A workplane: a base plane, face, plane feature or point+normal, moved along its normal and optionally rotated. A reference plane feature is added for it. */
export interface OffsetPlane { kind: 'offset'; plane: PlaneBase; offset: Num; opts: PlaneOpts; line: number }
/** A plane feature that an earlier step of the same part makes (its id is filled in when the script runs): a sketch sits on it as it is, with no plane added. Used by helpers that build their own planes (bearing). */
export interface PlaneRef { kind: 'planeRef'; ref: { id: string | null }; line: number }
/** A feature of the part, taken with part.handle() once it exists; its id is filled in when the script runs. */
export class FeatureHandle { id: string | null = null; constructor(public label = 'feature') {} toString(): string { return this.id ?? ''; } }
/**
 * A workplane for a sketch: an offset plane, a face, a plane feature, a point and normal, or a tilt.
 *
 * at(base, offset, opts) returns a plane reference for sketch(). base is 'front' (moves along +Z), 'top' (+Y), 'right' (+X); a face(...) (the plane of that planar face, offset along its outward normal); a plane feature handle from part.workplane(...) + part.handle(); or { origin: [x,y,z], normal: [x,y,z], xdir? } for any plane (axis-aligned normals use a standard plane, others add three helper points and a three-point plane). opts.rotate = { axis: 'x'|'y'|'z' | edges(...), angle } tilts the plane about that line (the plane passes through the axis; an offset is applied before the rotation). A reference plane feature is added to the part.
 * @domain sketch
 * @param base 'front' | 'top' | 'right', face(sel), a plane feature handle, { origin, normal, xdir? }, or { between: [a, b] } (the mid plane of two planes or faces)
 * @param offset distance along the plane normal in mm (a number or expr), default 0
 * @param opts { rotate: { axis, angle degrees }, flip }
 * @example
 * part('Stack')
 *   .sketch('front', (s) => s.rect(40, 40)).extrude(5)
 *   .sketch(at('front', 20), (s) => s.circle(8)).extrude(5)
 *   .sketch(at(face('>Z'), 3), (s) => s.circle(4)).extrude(2);
 * @see part.sketch, plane, part.workplane
 */
export const at = (base: PlaneBase, offset: Num = 0, opts: PlaneOpts = {}): OffsetPlane => ({ kind: 'offset', plane: base, offset, opts, line: callerLine() });

/** Sketch-plane frame as the kernel reports it: sketch x / y / normal in world axes. */
export interface PlaneInfo {
  name: Plane;
  origin: Vec; x: Vec; y: Vec; normal: Vec;
  /** world point of the sketch point [u, v] on the plane moved `offset` mm along its normal */
  toWorld(p: [number, number], offset?: number): Vec;
}
const FRAMES: Record<Plane, { x: Vec; y: Vec; z: Vec }> = {
  front: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  top: { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
  right: { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] },
};
/**
 * The frame of a standard sketch plane: which world axes its sketch x, y and normal are.
 *
 * plane(name) returns { origin, x, y, normal, toWorld }. front: sketch x = world X, y = world Y, normal +Z. top: x = X, y = -Z (sketch y points to world -Z, so +sketch y is towards the back), normal +Y. right: x = -Z, y = Y, normal +X. Y is up. These come from the kernel's sketch frames; use toWorld([u, v], offset) to place a sketch point in the world, e.g. to aim a face selector or an expectBBox.
 * @domain sketch
 * @param name 'front' | 'top' | 'right'
 * @example
 * // t.y is [0, 0, -1]: a point at sketch y = 10 on the top plane is at world z = -10
 * const p = plane('top').toWorld([5, 10], 20);   // [5, 20, -10]
 * part('Offset ring').sketch('top', (s) => s.circle(4, [5, 10])).extrude(2).expectBBox({ min: [1, 0, -14], max: [9, 2, -6] });
 * @see at, part.sketch
 */
export const plane = (name: Plane): PlaneInfo => {
  const f = FRAMES[name];
  if (!f) throw new SelectorError(`plane('${name}'): use 'front', 'top' or 'right'`, callerLine());
  return { name, origin: [0, 0, 0], x: f.x, y: f.y, normal: f.z, toWorld: (p, offset = 0) => [0, 1, 2].map((k) => p[0] * f.x[k] + p[1] * f.y[k] + offset * f.z[k]) as Vec };
};

export type Num = number | Expr;

export interface Ctx {
  geo: Geometry;
  nextId(): string;
  /** id of the sketch recorded last / the feature added last */
  lastSketch: string | null;
  lastFeature: string | null;
  /** Report a warning for the script line (the run result lists them). */
  warn?(message: string, line: number): void;
  /** Where the last sketch sits when that is a standard plane at a number: the axis of its normal (0 x, 1 y, 2 z) and the offset along it. Null for a face, a plane feature or an offset that is an expression. */
  lastSketchPlane?: { axis: number; offset: number } | null;
  /** Cut features whose direction may be flipped once if the kernel finds nothing to cut (cut direction 'auto'). */
  autoFlip?: Set<string>;
}

/** Hole options. diameter or an ISO size is required; the kind picks the head shape (counterbore, countersink) or the thread (tapped). */
export interface HoleOpts {
  /** name shown in the feature tree */
  name?: string;
  /** hole diameter in mm (not radius); optional when size is given */
  diameter?: Num;
  /** ISO metric size 'M2'..'M24': the kernel picks the hole diameter for the fit */
  size?: string;
  /** with size: 'normal' (default) | 'close' | 'loose' */
  fit?: 'normal' | 'close' | 'loose';
  /** 'simple' (default) | 'cbore' | 'csk' | 'tapped' */
  kind?: 'simple' | 'cbore' | 'csk' | 'tapped';
  /** 'through' (default without depth) | 'blind' (default with depth) | 'upTo' (up to the next face) */
  end?: 'through' | 'blind' | 'upTo';
  /** blind depth in mm */
  depth?: Num;
  /** reverse the drilling direction */
  flip?: boolean;
  /** counterbore diameter in mm (cbore); give with cboreDepth, else the ISO 4762 table values of size */
  cboreDiameter?: Num;
  /** counterbore depth in mm (cbore) */
  cboreDepth?: Num;
  /** countersink head diameter in mm (csk), default the ISO 10642 value of size */
  cskDiameter?: Num;
  /** countersink included angle in degrees (csk), default 90 */
  cskAngle?: Num;
  /** tapped: thread designation 'M6' (sets the tap-drill hole and adds the thread feature), or { size, length, hand, modeled } */
  thread?: string | boolean | { size?: string; length?: Num; hand?: 'right' | 'left'; modeled?: boolean; class?: string };
  /** tapped: cut the real helical groove instead of a cosmetic thread */
  modeled?: boolean;
}
