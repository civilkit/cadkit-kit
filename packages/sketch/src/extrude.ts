/**
 * Which way a new extrude should go. Kernel convention, checked by regenerating both: a boss (add) extrudes ALONG the
 * sketch plane's normal, and a cut extrudes AGAINST it (flip reverses either). So a cut needs `flip` when the body lies
 * on the normal's side of the plane, otherwise the default cut removes nothing (`cutNoEffect`). With no body, or a
 * plane through the middle of it, the cut keeps its default.
 */
export interface PlaneFrame { o: number[]; z: number[] }

export function defaultFlip(op: 'add' | 'cut', frame: PlaneFrame | null, bodyBox: { min: number[]; max: number[] } | null): boolean {
  if (op !== 'cut' || !frame || !bodyBox) return false;
  const c = [0, 1, 2].map((i) => (bodyBox.min[i] + bodyBox.max[i]) / 2);
  const d = (c[0] - frame.o[0]) * frame.z[0] + (c[1] - frame.o[1]) * frame.z[1] + (c[2] - frame.o[2]) * frame.z[2];
  return d > 1e-6;
}
