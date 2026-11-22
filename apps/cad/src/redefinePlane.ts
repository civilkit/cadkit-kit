// Redefine Sketch Plane: an existing sketch is moved onto another plane, datum plane or flat face. The sketch keeps its curves and
// dimensions (they are in the sketch's own 2D frame); only where that frame sits changes.
import type { EditOp } from '@ck/session';

export type SketchPlaneRef = { kind: 'std' | 'face' | 'feature'; id: string };

/** The edit that puts sketch `id` on `plane`. */
export const redefinePlaneOps = (id: string, plane: SketchPlaneRef): EditOp[] => [{ op: 'set', id, path: 'plane', value: { kind: plane.kind, id: plane.id } }];

/** A picked plane as the sketch stores it: the origin planes by name, a face or a datum plane by id. */
export const planeRefOf = (picked: string | { kind: 'face' | 'feature'; id: string }): SketchPlaneRef => (typeof picked === 'string' ? { kind: 'std', id: picked } : { kind: picked.kind, id: picked.id });

/** A sketch cannot sit on a datum plane that is itself built from it, or on itself: refuse before asking the kernel. */
export const redefineSelf = (sketchId: string, plane: SketchPlaneRef): boolean => plane.kind !== 'std' && plane.id === sketchId;
