// Leaf helpers: edge references from a viewport selection, the view-edge shape and a size for new features.
// Shared by featureCommands and junction without importing each other.

export interface Box { min: number[]; max: number[] }
export interface EdgeRef { faces: string[]; at: number[] }
export interface ViewEdge { key?: string; faces?: string[]; mid?: number[]; /** world-space polyline of the edge */ pts?: number[][]; /** its two faces meet without a crease (see smoothEdges.ts) */ smooth?: boolean }

/** A size for a new feature: about 5% of the smallest box dimension, rounded to 1, 2, 2.5 or 5 times a power of ten. */
export function niceSize(box: Box | null, fraction = 0.05): number {
  if (!box) return 1;
  const dims = [0, 1, 2].map((i) => box.max[i] - box.min[i]).filter((d) => d > 1e-9);
  if (!dims.length) return 1;
  const raw = Math.min(...dims) * fraction;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = raw / mag;
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].reduce((best, x) => (Math.abs(Math.log(x / m)) < Math.abs(Math.log(best / m)) ? x : best));
  return +(nice * mag).toPrecision(6);
}

/** The selected edges as kernel edge references (the two faces and a point on the edge). Names that are not edges of the body are skipped. */
export function edgeRefs(selection: string[], edges: ViewEdge[]): EdgeRef[] {
  const byKey = new Map(edges.filter((e) => e.key).map((e) => [e.key!, e]));
  const out: EdgeRef[] = [];
  const seen = new Set<string>();
  const add = (e: ViewEdge | undefined) => {
    if (e?.faces && e.faces.length === 2 && e.mid && !seen.has(e.key ?? '')) { seen.add(e.key ?? ''); out.push({ faces: [...e.faces], at: [...e.mid] }); }
  };
  for (const name of selection) {
    if (name.startsWith('v:')) {
      // a corner stands for every edge that ends there (rounding a cube corner rounds its three edges)
      const v = name.slice(2).split(',').map(Number);
      const near = (p?: number[]) => !!p && Math.hypot(p[0] - v[0], p[1] - v[1], p[2] - v[2]) < 1e-3;
      for (const e of edges) if (near(e.pts?.[0]) || near(e.pts?.[(e.pts?.length ?? 1) - 1])) add(e);
    } else add(byKey.get(name));
  }
  return out;
}
