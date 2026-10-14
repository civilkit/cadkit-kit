// The closed shapes of a sketch, for choosing which ones an extrude or revolve uses (the kernel's `regions` field).
// A shape is one circle or ellipse, or a connected chain of lines/arcs/splines that closes on itself. Construction geometry
// and open chains are not shapes (the kernel ignores them too).

export interface SketchShape {
  /** One entity id of the shape's outline: what `regions` takes. */
  id: string;
  kind: 'circle' | 'ellipse' | 'loop';
  /** Every entity that makes up the outline. */
  entityIds: string[];
  /** Circle radius, else 0. */
  radius: number;
}

interface FeatureLike { entities?: Array<{ id: string; type?: string; construction?: boolean; [k: string]: unknown }> }

const endpoints = (e: { type?: string; [k: string]: unknown }): string[] => {
  if (e.type === 'line' || e.type === 'arc') return [e.p1, e.p2].filter((x): x is string => typeof x === 'string');
  if (Array.isArray(e.points)) { const p = e.points as unknown[]; return p.length ? [String(p[0]), String(p[p.length - 1])] : []; }
  return [e.p1, e.p2].filter((x): x is string => typeof x === 'string');
};

export function sketchShapes(feature: FeatureLike | null | undefined): SketchShape[] {
  const out: SketchShape[] = [];
  const chain = (feature?.entities ?? []).filter((e) => !e.construction);
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
  const segs: Array<{ id: string; ends: string[] }> = [];
  for (const e of chain) {
    if (e.type === 'circle') { out.push({ id: e.id, kind: 'circle', entityIds: [e.id], radius: typeof e.r === 'number' ? e.r : 0 }); continue; }
    if (e.type === 'ellipse') { out.push({ id: e.id, kind: 'ellipse', entityIds: [e.id], radius: 0 }); continue; }
    const ends = endpoints(e);
    if (ends.length === 2) { union(ends[0], ends[1]); segs.push({ id: e.id, ends }); }
  }
  const groups = new Map<string, Array<{ id: string; ends: string[] }>>();
  for (const s of segs) { const r = find(s.ends[0]); groups.set(r, [...(groups.get(r) ?? []), s]); }
  for (const g of groups.values()) {
    const degree = new Map<string, number>();
    for (const s of g) for (const p of s.ends) degree.set(p, (degree.get(p) ?? 0) + 1);
    // closed when every point joins exactly two segments (a single arc that closes on itself counts: both ends are one point)
    if ([...degree.values()].every((d) => d === 2)) out.push({ id: g[0].id, kind: 'loop', entityIds: g.map((s) => s.id), radius: 0 });
  }
  const order = new Map((feature?.entities ?? []).map((e, i) => [e.id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** The `regions` value for a set of checked shapes: null when all are checked (the kernel then uses every region of the sketch,
 *  holes included), else the id of each checked shape. */
export function regionsFor(shapes: SketchShape[], checked: ReadonlySet<string>): string[] | null {
  const on = shapes.filter((s) => checked.has(s.id));
  return on.length === shapes.length ? null : on.map((s) => s.id);
}
