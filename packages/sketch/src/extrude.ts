/**
 * Which way a new extrude should go. Kernel convention, checked by regenerating both: a boss (add) extrudes ALONG the
 * sketch plane's normal, and a cut extrudes AGAINST it (flip reverses either). So a cut needs `flip` when the body lies
 * on the normal's side of the plane, otherwise the default cut removes nothing (`cutNoEffect`). With no body, or a
 * plane through the middle of it, the cut keeps its default.
 *
 * A sketch on a FACE of the body is the exception: its plane normal is the face's outward normal, so the default (against the normal) already goes into
 * the material and never needs a flip. The bounding-box guess is wrong there whenever the box centre is on the outward side of the face, which is
 * every flat plate under a boss or a tall cone (the hole went up into air and "cut nothing"). `onFace` says the plane is a face.
 */
export interface PlaneFrame { o: number[]; z: number[] }

export function defaultFlip(op: 'add' | 'cut', frame: PlaneFrame | null, bodyBox: { min: number[]; max: number[] } | null, onFace = false): boolean {
  if (op !== 'cut' || !frame || !bodyBox || onFace) return false;
  const c = [0, 1, 2].map((i) => (bodyBox.min[i] + bodyBox.max[i]) / 2);
  const d = (c[0] - frame.o[0]) * frame.z[0] + (c[1] - frame.o[1]) * frame.z[1] + (c[2] - frame.o[2]) * frame.z[2];
  return d > 1e-6;
}
