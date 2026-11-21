// A string that changes when the document changes in a way that can change what can be driven: its mates and its parts. Cheap enough to compute on every
// redraw (a part's size is measured once per part object).
type Feat = Record<string, unknown> & { id: string; type: string };
const partSize = new WeakMap<object, number>();
const sizeOf = (part: unknown): number => {
  if (!part || typeof part !== 'object') return 0;
  let n = partSize.get(part);
  if (n === undefined) { n = JSON.stringify(part).length; partSize.set(part, n); }
  return n;
};

export function motionDocKey(features: ReadonlyArray<Feat>): string {
  return features.map((f) => [f.id, f.type, f.kind, f.a, f.b, f.a2, f.b2, f.suppressed, f.fixed, f.dx, f.dy, f.dz, f.angle, f.min, f.max, f.ratio, f.distance, f.axis ? JSON.stringify(f.axis) : '', sizeOf(f.part)].join('~')).join('|');
}
