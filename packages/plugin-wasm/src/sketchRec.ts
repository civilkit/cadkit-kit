// A recorded sketch for the plugin host: the points, lines, arcs and circles a plugin draws with sketch.line, sketch.arc.three_point,
// sketch.circle.center and sketch.point, with SolidCraft's ids (lines l1.., arcs a1.., circles c1.., free points p1.., a curve's own points
// "l1.start", "c1.center"). Nothing here solves constraints: a constraint or dimension is kept as a record and the geometry stays where it was drawn.
// It finds the closed profiles (outer loops and the holes inside them, with their areas) the way sketch.inspect reports them, and writes the
// drawn curves as kernel script (`s.line`, `s.arc3`, `s.circle`) for the replay.
export type Pt = [number, number];
export interface SkPoint { id: string; at: Pt; fixed: boolean }
export type SkCurve =
  | { id: string; type: 'line'; a: number; b: number; construction: boolean }
  | { id: string; type: 'arc'; a: number; b: number; through: Pt; construction: boolean }
  | { id: string; type: 'circle'; c: number; r: number; construction: boolean }
  | { id: string; type: 'spline'; pts: Pt[]; closed: boolean; construction: boolean };
export interface Profile { index: number; area: number; centroid: Pt; curves: string[]; holes: string[][] }

const TAU = Math.PI * 2;
const near = (p: Pt, q: Pt, e = 1e-7): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) <= e;
const r6 = (n: number): number => Math.round(n * 1e9) / 1e9 + 0;

/** centre and radius of the circle through three points, or null when they are in a line */
export function circle3(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [x, y], r: Math.hypot(a[0] - x, a[1] - y) };
}

export class SketchRec {
  points: SkPoint[] = [];
  curves: SkCurve[] = [];
  constraints: Array<Record<string, unknown>> = [];
  /** text the label code of the interpreter collects on the same sketch */
  private counters = new Map<string, number>();
  hidden = false;
  /** an offset the sketch plane is shifted along its normal by (a plugin's own copy of a sketch) */
  constructor(readonly id: number, public name: string, readonly origin: number[], readonly xdir: number[], readonly ydir: number[]) {}

  private fresh(prefix: string): string { const n = (this.counters.get(prefix) ?? 0) + 1; this.counters.set(prefix, n); return `${prefix}${n}`; }
  private taken(id: string): boolean { return this.curves.some((c) => c.id === id) || this.points.some((p) => p.id === id); }
  private curveId(id: string | undefined, prefix: string): string {
    if (id !== undefined) { if (this.taken(id)) throw new Error(`the id \`${id}\` is already used in this sketch`); return id; }
    let c = this.fresh(prefix); while (this.taken(c)) c = this.fresh(prefix);
    return c;
  }
  /** the point at `at`: an existing one that lies there when `connect`, else a new one owned by the curve `owner` */
  private pointAt(at: Pt, owner: string, role: string, connect: boolean): number {
    if (connect) { const i = this.points.findIndex((p) => near(p.at, at)); if (i >= 0) return i; }
    this.points.push({ id: `${owner}.${role}`, at, fixed: false });
    return this.points.length - 1;
  }
  /** a point named by its id (`l1.end`, `p2`) */
  pointIndex(ref: string): number { const i = this.points.findIndex((p) => p.id === ref); if (i < 0) throw new Error(`no point \`${ref}\` in sketch ${this.name}`); return i; }
  curveIndex(ref: string): number { const i = this.curves.findIndex((c) => c.id === ref); if (i < 0) throw new Error(`no curve \`${ref}\` in sketch ${this.name}`); return i; }

  line(pts: Pt[], o: { closed?: boolean; ids?: string[]; connect?: boolean; construction?: boolean } = {}): string[] {
    const n = pts.length, segs = o.closed ? n : n - 1, out: string[] = [], conn = o.connect !== false;
    if (n < 2) throw new Error('a line needs 2 or more points');
    let first = -1, prev = -1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n, a = pts[i], b = pts[j];
      if (near(a, b, 1e-9)) throw new Error('zero-length line');
      const id = this.curveId(o.ids?.[i], 'l');
      const ia = i === 0 ? this.pointAt(a, id, 'start', conn) : prev;
      const ib = j === 0 ? first : this.pointAt(b, id, 'end', conn);
      if (i === 0) first = ia;
      this.curves.push({ id, type: 'line', a: ia, b: ib, construction: !!o.construction });
      out.push(id); prev = ib;
    }
    return out;
  }
  arc3(start: Pt, end: Pt, through: Pt, o: { id?: string; connect?: boolean; construction?: boolean } = {}): string {
    if (!circle3(start, through, end)) throw new Error('degenerate arc: the three points are in a line');
    const id = this.curveId(o.id, 'a'), conn = o.connect !== false;
    this.curves.push({ id, type: 'arc', a: this.pointAt(start, id, 'start', conn), b: this.pointAt(end, id, 'end', conn), through, construction: !!o.construction });
    return id;
  }
  circle(c: Pt, r: number, o: { id?: string; connect?: boolean; construction?: boolean } = {}): string {
    if (!(r > 0)) throw new Error('a circle needs a positive radius');
    const id = this.curveId(o.id, 'c');
    this.curves.push({ id, type: 'circle', c: this.pointAt(c, id, 'center', o.connect !== false), r, construction: !!o.construction });
    return id;
  }
  /** a spline through fit points: drawn into the sketch, it makes no profile of its own here */
  spline(pts: Pt[], o: { closed?: boolean; id?: string; construction?: boolean } = {}): string {
    if (pts.length < 2) throw new Error('a spline needs at least two points');
    const id = this.curveId(o.id, 's');
    this.curves.push({ id, type: 'spline', pts, closed: !!o.closed, construction: !!o.construction });
    return id;
  }
  /** `sketch.replace`: this sketch's contents become a copy of another sketch's (its plane stays) */
  replaceWith(o: SketchRec): void {
    this.points = o.points.map((p) => ({ ...p, at: [...p.at] as Pt })); this.curves = o.curves.map((k) => ({ ...k })) as SkCurve[];
    this.constraints = o.constraints.map((c) => ({ ...c }));
  }
  /** a copy in another plane (a pattern's turned copy of a sketch) */
  clone(name: string, id: number, origin: number[], xdir: number[], ydir: number[]): SketchRec {
    const c = new SketchRec(id, name, origin, xdir, ydir);
    c.points = this.points.map((p) => ({ ...p, at: [...p.at] as Pt })); c.curves = this.curves.map((k) => ({ ...k })) as SkCurve[];
    return c;
  }
  point(at: Pt, id?: string): string {
    const pid = id !== undefined ? (this.taken(id) ? (() => { throw new Error(`the id \`${id}\` is already used in this sketch`); })() : id) : (() => { let c = this.fresh('p'); while (this.taken(c)) c = this.fresh('p'); return c; })();
    this.points.push({ id: pid, at, fixed: false });
    return pid;
  }
  /** a curve's end points, in the sketch plane */
  private ends(c: SkCurve): [Pt, Pt] { return c.type === 'line' || c.type === 'arc' ? [this.points[c.a].at, this.points[c.b].at] : c.type === 'circle' ? [this.points[c.c].at, this.points[c.c].at] : [c.pts[0], c.pts[c.pts.length - 1]]; }

  /** the chains of non-construction lines and arcs that close on themselves, as lists of [curve, forward?], and the circles */
  private loops(): Array<Array<[SkCurve, boolean]>> {
    const cs = this.curves.filter((c) => !c.construction && c.type !== 'spline');
    const used = new Set<SkCurve>(), out: Array<Array<[SkCurve, boolean]>> = [];
    for (const c of cs) if (c.type === 'circle') out.push([[c, true]]);
    for (const c0 of cs) {
      if (c0.type === 'circle' || used.has(c0)) continue;
      const chain: Array<[SkCurve, boolean]> = [[c0, true]]; used.add(c0);
      const start = (c0 as { a: number }).a;
      let at = (c0 as { b: number }).b, ok = true;
      while (at !== start) {
        const nx = cs.find((c) => c.type !== 'circle' && !used.has(c) && ((c as { a: number }).a === at || (c as { b: number }).b === at));
        if (!nx) { ok = false; break; }
        used.add(nx);
        const fwd = (nx as { a: number }).a === at;
        chain.push([nx, fwd]); at = fwd ? (nx as { b: number }).b : (nx as { a: number }).a;
      }
      if (ok) out.push(chain);
    }
    const at = (l: Array<[SkCurve, boolean]>): number => Math.min(...l.map(([c]) => this.curves.indexOf(c)));
    return out.sort((x, y) => at(x) - at(y));
  }
  /** polygon samples of a loop, and its signed area (positive counter-clockwise) */
  private outline(ch: Array<[SkCurve, boolean]>): { poly: Pt[]; area: number } {
    if (ch.length === 1 && ch[0][0].type === 'circle') {
      const c = ch[0][0], o = this.points[c.c].at, poly: Pt[] = [];
      for (let k = 0; k < 48; k++) poly.push([o[0] + c.r * Math.cos((k / 48) * TAU), o[1] + c.r * Math.sin((k / 48) * TAU)]);
      return { poly, area: Math.PI * c.r * c.r };
    }
    const poly: Pt[] = [], chord: Pt[] = []; let seg = 0;
    for (const [c, fwd] of ch) {
      const [pa, pb] = this.ends(c), a = fwd ? pa : pb, b = fwd ? pb : pa;
      poly.push(a); chord.push(a);
      if (c.type === 'arc') {
        const k = circle3(pa, c.through, pb)!, ccw = (c.through[0] - pa[0]) * (pb[1] - c.through[1]) - (c.through[1] - pa[1]) * (pb[0] - c.through[0]) > 0;
        let th = Math.atan2(pb[1] - k.c[1], pb[0] - k.c[0]) - Math.atan2(pa[1] - k.c[1], pa[0] - k.c[0]);
        th = ccw ? ((th % TAU) + TAU) % TAU : -(((-th % TAU) + TAU) % TAU);
        const sa = Math.atan2(a[1] - k.c[1], a[0] - k.c[0]), dir = (fwd ? 1 : -1) * Math.sign(th), sw = Math.abs(th), n = Math.max(4, Math.ceil(sw / 0.2));
        for (let s = 1; s < n; s++) { const t = sa + dir * (s / n) * sw; poly.push([k.c[0] + k.r * Math.cos(t), k.c[1] + k.r * Math.sin(t)]); }
        seg += dir * (k.r * k.r / 2) * (sw - Math.sin(sw));
      }
      void b;
    }
    let area = seg;
    for (let i = 0; i < chord.length; i++) { const p = chord[i], q = chain(chord, i + 1); area += (p[0] * q[1] - q[0] * p[1]) / 2; }
    return { poly, area };
  }

  /** the closed regions: each loop is the outer edge of one, with the loops directly inside it as its holes (so a loop inside a hole is a region of its own, material again) */
  profiles(): Profile[] {
    const ls = this.loops().map((ch) => { const o = this.outline(ch); return { ch, ...o, ids: ch.map(([c]) => c.id), area: Math.abs(o.area) }; });
    const inside = (p: Pt, poly: Pt[]): boolean => { let w = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) w = !w; } return w; };
    const parents = ls.map((l, i) => ls.flatMap((m, j) => (j !== i && m.area > l.area + 1e-9 && inside(l.poly[0], m.poly) ? [j] : [])));
    const depth = parents.map((p) => p.length), out: Profile[] = [];
    ls.forEach((l, i) => {
      const holes = ls.flatMap((m, j) => (depth[j] === depth[i] + 1 && parents[j].includes(i) ? [j] : []));
      const area = l.area - holes.reduce((s, j) => s + ls[j].area, 0);
      let cx = 0, cy = 0; for (const p of l.poly) { cx += p[0]; cy += p[1]; }
      out.push({ index: out.length, area, centroid: [r6(cx / l.poly.length), r6(cy / l.poly.length)], curves: [...new Set(l.ids)], holes: holes.map((j) => [...new Set(ls[j].ids)]) });
    });
    return out;
  }

  /** the curves of the profiles a `profiles` argument names (all | [index] | [{point}] | [{curves}]), or undefined for every drawn curve */
  select(sel: unknown): Set<string> | undefined {
    if (sel === undefined || sel === null || sel === 'all') return undefined;
    if (!Array.isArray(sel)) throw new Error('`profiles` is all, or a list of picks');
    const ps = this.profiles(), out = new Set<string>();
    const loopPoly = (ids: string[]): Pt[] => this.outline(this.loops().find((l) => l.every(([c]) => ids.includes(c.id)) && l.length === new Set(ids).size)!).poly;
    const inside = (p: Pt, poly: Pt[]): boolean => { let w = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) w = !w; } return w; };
    for (const pick of sel) {
      let pr: Profile | undefined;
      if (typeof pick === 'number') pr = ps[pick];
      else if (pick && typeof pick === 'object' && Array.isArray((pick as { point?: unknown }).point)) {
        const q = (pick as { point: number[] }).point as Pt;
        pr = ps.find((x) => inside(q, loopPoly(x.curves)) && !x.holes.some((h) => inside(q, loopPoly(h))));
      } else if (pick && typeof pick === 'object' && Array.isArray((pick as { curves?: unknown }).curves)) {
        const want = new Set((pick as { curves: string[] }).curves);
        pr = ps.find((x) => x.curves.length === want.size && x.curves.every((c) => want.has(c)));
      }
      if (!pr) throw new Error(`no profile for the pick ${JSON.stringify(pick)}`);
      for (const c of pr.curves) out.add(c);
      for (const h of pr.holes) for (const c of h) out.add(c);
    }
    return out;
  }

  /** the drawing callback body for the kernel script: only the curves named (the default: every drawn one); construction curves are left out */
  draw(only?: Set<string>, shift: Pt = [0, 0]): string {
    const P = (p: Pt): string => `[${r6(p[0] + shift[0])}, ${r6(p[1] + shift[1])}]`, L: string[] = [];
    for (const c of this.curves) {
      if (c.construction || (only && !only.has(c.id))) continue;
      if (c.type === 'line') L.push(`s.line(${P(this.points[c.a].at)}, ${P(this.points[c.b].at)});`);
      else if (c.type === 'arc') L.push(`s.arc3(${P(this.points[c.a].at)}, ${P(c.through)}, ${P(this.points[c.b].at)});`);
      else if (c.type === 'spline') L.push(`s.spline([${c.pts.map(P).join(', ')}]${c.closed ? ', { closed: true }' : ''});`);
      else L.push(`s.circle(${r6(c.r)}, ${P(this.points[c.c].at)});`);
    }
    return L.join(' ');
  }

  /** what sketch.inspect answers */
  inspect(): Record<string, unknown> {
    const pid = (i: number): string => this.points[i].id;
    const curves = this.curves.map((c) => c.type === 'line' ? { id: c.id, type: 'line', start: pid(c.a), end: pid(c.b), start_at: this.points[c.a].at, end_at: this.points[c.b].at, construction: c.construction, fixed: false, fully_constrained: false }
      : c.type === 'arc' ? (() => { const k = circle3(this.points[c.a].at, c.through, this.points[c.b].at)!; return { id: c.id, type: 'arc', center_at: k.c, start: pid(c.a), end: pid(c.b), start_at: this.points[c.a].at, end_at: this.points[c.b].at, radius: k.r, construction: c.construction, fixed: false, fully_constrained: false }; })()
      : c.type === 'spline' ? { id: c.id, type: 'spline', points_at: c.pts, construction: c.construction, fixed: false, fully_constrained: false }
      : { id: c.id, type: 'circle', center: pid(c.c), center_at: this.points[c.c].at, radius: c.r, construction: c.construction, fixed: false, fully_constrained: false });
    return { id: this.id, name: this.name, plane: { origin: this.origin, x_dir: this.xdir, y_dir: this.ydir }, world_plane: { origin: this.origin, x_dir: this.xdir, y_dir: this.ydir }, links: [], wires: [], visible: !this.hidden, curves, points: this.points.map((p) => ({ id: p.id, at: p.at, fixed: p.fixed, fully_constrained: false })), constraints: this.constraints, profiles: this.profiles().map((p) => ({ index: p.index, area_mm2: p.area, centroid_sketch: p.centroid, curves: p.curves, holes: p.holes })), dof: 0, status: 'ok' };
  }
}
const chain = (a: Pt[], i: number): Pt => a[i % a.length];
