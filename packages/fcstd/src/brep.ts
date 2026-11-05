// Reader for OCCT's BRep text format ("CASCADE Topology V1", the *.brp files inside an FCStd), only as far as needed to turn FreeCAD's
// "EdgeN" / "FaceN" names into places in space. The element order is OCCT's TopExp::MapShapes(shape, TopAbs_EDGE | TopAbs_FACE):
// depth first, children in order, unique by shape and location. An edge is described by the middle of it (lines and circles exact; other
// curves fall back to the vertex midpoint, flagged `approx`); a face by its surface (plane, cylinder, cone, sphere, torus), for a plane
// its outward normal, and a point inside it (the boundary-weighted centre).
type V3 = [number, number, number];
type M = number[]; // 3x4 row-major

const IDENT: M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const mul = (a: M, b: M): M => {
  const r: M = new Array(12).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
    r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
  }
  return r;
};
const inv = (m: M): M => { // rigid or uniformly scaled: rotation transpose
  const t: M = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0];
  t[3] = -(t[0] * m[3] + t[1] * m[7] + t[2] * m[11]); t[7] = -(t[4] * m[3] + t[5] * m[7] + t[6] * m[11]); t[11] = -(t[8] * m[3] + t[9] * m[7] + t[10] * m[11]);
  return t;
};
const apply = (m: M, p: V3): V3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3], m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7], m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]];
const applyDir = (m: M, p: V3): V3 => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[4] * p[0] + m[5] * p[1] + m[6] * p[2], m[8] * p[0] + m[9] * p[1] + m[10] * p[2]];

interface Kid { idx: number; loc: number; sign: 1 | -1 }
interface Shape { type: string; xyz?: V3; curve?: { idx: number; loc: number; t0: number; t1: number }; /** faces: surface index and location */ surf?: { idx: number; loc: number }; kids: Kid[] }
type Curve = { k: 'line' | 'circle'; v: number[] } | null;
type Surface = { k: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus'; v: number[] } | null;
interface Parsed { locs: M[]; curves: Curve[]; surfaces: Surface[]; shapes: Shape[]; root: Kid }

const nums = (s: string) => s.trim().split(/\s+/).map(Number);

/** Index after the curve record that starts at line i (types of OCCT's Geom_Curve text), or -1 when the type is not known. */
function skipCurve(L: string[], i: number): number {
  const t = nums(L[i]);
  switch (t[0]) {
    case 1: case 2: case 3: case 4: case 5: return i + 1;
    case 6: return i + 1 + t[2]; // rational, nbPoles, then the poles
    case 7: return i + 1 + t[4] + t[5]; // rational periodic degree nbPoles nbKnots, poles, knots
    case 8: return skipCurve(L, i + 1); // trimmed: basis curve follows
    case 9: return skipCurve(L, i + 1); // offset
    default: return -1;
  }
}
function skipSurface(L: string[], i: number): number {
  const t = nums(L[i]);
  switch (t[0]) {
    case 1: case 2: case 3: case 4: case 5: return i + 1;
    case 6: case 7: { const j = skipCurve(L, i + 1); return j; }
    case 8: return skipSurface(L, i + 1);
    case 9: return i + 1 + (t[3] + 1) * (t[4] + 1);
    case 10: return i + 1 + t[7] * t[8] + t[9] + t[10];
    case 11: return skipSurface(L, i + 1);
    default: return -1;
  }
}

function parseBrep(text: string): Parsed | null {
  const L = text.split(/\r?\n/);
  let i = 0;
  const find = (h: string) => { while (i < L.length && !L[i].startsWith(h)) i++; return i < L.length; };
  // locations
  i = 0; if (!find('Locations')) return null;
  const nLoc = Number(L[i].split(/\s+/)[1]); i++;
  const locs: M[] = [IDENT];
  const rawLocs: Array<M | Array<[number, number]>> = [];
  for (let k = 0; k < nLoc; k++) {
    const kind = Number(L[i].trim().split(/\s+/)[0]);
    if (kind === 1) { rawLocs.push([...L[i + 1].trim().split(/\s+/), ...L[i + 2].trim().split(/\s+/), ...L[i + 3].trim().split(/\s+/)].map(Number)); i += 4; } else {
      const t = L[i].trim().split(/\s+/).map(Number).slice(1); const pairs: Array<[number, number]> = [];
      for (let q = 0; q + 1 < t.length && t[q] !== 0; q += 2) pairs.push([t[q], t[q + 1]]);
      rawLocs.push(pairs); i++;
    }
  }
  const pow = (m: M, n: number) => { let r = IDENT; const b = n < 0 ? inv(m) : m; for (let q = 0; q < Math.abs(n); q++) r = mul(r, b); return r; };
  for (const r of rawLocs) {
    if (r.length === 12 && typeof r[0] === 'number') locs.push(r as M);
    else { let m = IDENT; for (const [li, p] of r as Array<[number, number]>) m = mul(m, pow(locs[li] ?? IDENT, p)); locs.push(m); }
  }
  // curves (1-based); the ones that are not lines or circles are skipped, an unknown record type ends the table
  const curves: Curve[] = [null];
  i = 0;
  if (find('Curves')) {
    const n = Number(L[i].split(/\s+/)[1]); i++;
    for (let k = 0; k < n; k++) {
      const t = nums(L[i]);
      const next = skipCurve(L, i);
      if (next < 0) { while (curves.length <= n) curves.push(null); break; }
      curves.push(t[0] === 1 ? { k: 'line', v: t.slice(1) } : t[0] === 2 ? { k: 'circle', v: t.slice(1) } : null);
      i = next;
    }
  }
  // surfaces (1-based): the analytic ones are kept, the rest skipped; an unknown record ends the table
  const surfaces: Surface[] = [null];
  i = 0;
  if (find('Surfaces')) {
    const n = Number(L[i].split(/\s+/)[1]); i++;
    const KIND = [null, 'plane', 'cylinder', 'cone', 'sphere', 'torus'] as const;
    for (let k = 0; k < n; k++) {
      const t = nums(L[i]);
      const next = skipSurface(L, i);
      if (next < 0) { while (surfaces.length <= n) surfaces.push(null); break; }
      const kind = t[0] >= 1 && t[0] <= 5 ? KIND[t[0]] : null;
      surfaces.push(kind ? { k: kind, v: t.slice(1) } : null);
      i = next;
    }
  }
  // shapes
  i = 0; if (!find('TShapes')) return null;
  const N = Number(L[i].split(/\s+/)[1]); i++;
  const shapes: Shape[] = [];
  for (let k = 0; k < N; k++) {
    const type = L[i++].trim();
    const sh: Shape = { type, kids: [] };
    const body: string[] = [];
    while (i < L.length && !/^[01]{7}$/.test(L[i].trim())) body.push(L[i++]);
    i++; // flags
    let kidText = '';
    for (;;) { kidText += ' ' + L[i]; if (L[i++].includes('*')) break; }
    if (type === 'Ve') sh.xyz = body[1].trim().split(/\s+/).slice(0, 3).map(Number) as V3;
    if (type === 'Ed') for (const line of body) { const t = line.trim().split(/\s+/); if (t[0] === '1' && t.length >= 5 && !sh.curve) sh.curve = { idx: Number(t[1]), loc: Number(t[2]), t0: Number(t[3]), t1: Number(t[4]) }; }
    if (type === 'Fa') { const t = body[0].trim().split(/\s+/); sh.surf = { idx: Number(t[2]), loc: Number(t[3]) }; }
    for (const m of kidText.matchAll(/([+\-ie])(\d+)\s+(\d+)/g)) sh.kids.push({ idx: N - Number(m[2]), loc: Number(m[3]), sign: m[1] === '-' ? -1 : 1 });
    shapes.push(sh);
  }
  const root = L.slice(i).join(' ').match(/([+\-ie])(\d+)\s+(\d+)/);
  if (!root) return null;
  return { locs, curves, surfaces, shapes, root: { idx: N - Number(root[2]), loc: Number(root[3]), sign: root[1] === '-' ? -1 : 1 } };
}

export interface BrepEdge { at: V3; curve: 'line' | 'circle' | 'other'; approx: boolean }

/** Points on a curve edge (several, for the centre of a face boundary) in world coordinates. */
function edgePoints(P: Parsed, sh: Shape, world: M, count: number): V3[] {
  const { locs, curves, shapes } = P;
  const cv = sh.curve && curves[sh.curve.idx];
  const vs = sh.kids.map((c) => shapes[c.idx]).filter((s) => s?.type === 'Ve').map((s) => s.xyz!);
  if (sh.curve && cv) {
    const lm = mul(world, locs[sh.curve.loc] ?? IDENT);
    const out: V3[] = [];
    for (let q = 0; q < count; q++) {
      const tm = sh.curve.t0 + ((sh.curve.t1 - sh.curve.t0) * (q + 0.5)) / count, v = cv.v;
      if (cv.k === 'line') out.push(apply(lm, [v[0] + v[3] * tm, v[1] + v[4] * tm, v[2] + v[5] * tm]));
      else {
        const [cx, cy, cz, , , , xx, xy, xz, yx, yy, yz, r] = v;
        out.push(apply(lm, [cx + r * (Math.cos(tm) * xx + Math.sin(tm) * yx), cy + r * (Math.cos(tm) * xy + Math.sin(tm) * yy), cz + r * (Math.cos(tm) * xz + Math.sin(tm) * yz)]));
      }
    }
    return out;
  }
  const a = vs[0] ?? [0, 0, 0], b = vs[1] ?? a;
  return [apply(world, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2])];
}

export function brepEdges(text: string): BrepEdge[] {
  const P = parseBrep(text);
  if (!P) return [];
  const { locs, curves, shapes } = P;
  // MapShapes(EDGE): depth first, children in order, unique by shape + location
  const seen = new Set<string>();
  const out: BrepEdge[] = [];
  const key = (idx: number, m: M) => idx + ':' + m.map((v) => v.toFixed(6)).join(',');
  const walk = (ref: { idx: number; loc: number }, parent: M) => {
    const sh = shapes[ref.idx]; if (!sh) return;
    const world = mul(parent, locs[ref.loc] ?? IDENT);
    if (sh.type === 'Ed') {
      const k = key(ref.idx, world); if (seen.has(k)) return; seen.add(k);
      const cv = sh.curve && curves[sh.curve.idx];
      out.push({ at: edgePoints(P, sh, world, 1)[0], curve: cv ? cv.k : 'other', approx: !(sh.curve && cv) });
      return;
    }
    if (sh.type === 'Ve') return;
    for (const c of sh.kids) walk(c, world);
  };
  walk(P.root, IDENT);
  return out;
}

export interface BrepFace {
  surface: 'plane' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'other';
  /** planes: the outward unit normal (the surface normal, reversed when the face is) */
  normal?: V3;
  /** a point on a plane, the axis point of a cylinder / cone, the centre of a sphere / torus */
  origin?: V3;
  /** a point in the face: the centre of its boundary (for a plane, projected on it); used to tell faces of the same kind apart */
  at: V3;
}

export function brepFaces(text: string): BrepFace[] {
  const P = parseBrep(text);
  if (!P) return [];
  const { locs, surfaces, shapes } = P;
  const seen = new Set<string>();
  const out: BrepFace[] = [];
  const key = (idx: number, m: M) => idx + ':' + m.map((v) => v.toFixed(6)).join(',');
  const walk = (ref: Kid, parent: M, orient: 1 | -1) => {
    const sh = shapes[ref.idx]; if (!sh) return;
    const world = mul(parent, locs[ref.loc] ?? IDENT);
    const o = (orient * ref.sign) as 1 | -1;
    if (sh.type === 'Fa') {
      const k = key(ref.idx, world); if (seen.has(k)) return; seen.add(k);
      // the boundary: every edge of every wire, sampled
      const pts: V3[] = []; const w: number[] = [];
      const edges = new Set<number>();
      for (const wire of sh.kids) for (const e of shapes[wire.idx]?.kids ?? []) {
        const es = shapes[e.idx]; if (es?.type !== 'Ed' || edges.has(e.idx * 1000 + e.loc)) continue;
        edges.add(e.idx * 1000 + e.loc);
        const ew = mul(mul(world, locs[wire.loc] ?? IDENT), locs[e.loc] ?? IDENT);
        const ps = edgePoints(P, es, ew, es.curve && P.curves[es.curve.idx]?.k === 'circle' ? 8 : 1);
        for (const p of ps) { pts.push(p); w.push(1 / ps.length); }
        if (ps.length === 1 && es.kids.length) { // a straight or unknown edge: weight by its length (end vertices)
          const vs = es.kids.map((c) => shapes[c.idx]).filter((s) => s?.type === 'Ve').map((s) => apply(ew, s.xyz!));
          if (vs.length === 2) w[w.length - 1] = Math.hypot(vs[0][0] - vs[1][0], vs[0][1] - vs[1][1], vs[0][2] - vs[1][2]);
        }
      }
      let sum = 0, c: V3 = [0, 0, 0];
      pts.forEach((p, q) => { sum += w[q]; c = [c[0] + p[0] * w[q], c[1] + p[1] * w[q], c[2] + p[2] * w[q]]; });
      const at: V3 = sum > 0 ? [c[0] / sum, c[1] / sum, c[2] / sum] : [0, 0, 0];
      const su = sh.surf && surfaces[sh.surf.idx];
      if (su && sh.surf) {
        const sm = mul(world, locs[sh.surf.loc] ?? IDENT);
        const v = su.v;
        const origin = apply(sm, [v[0], v[1], v[2]]);
        if (su.k === 'plane') {
          const n = applyDir(sm, [v[3], v[4], v[5]]);
          const nn: V3 = [n[0] * o, n[1] * o, n[2] * o];
          const len = Math.hypot(...nn) || 1;
          const un: V3 = [nn[0] / len, nn[1] / len, nn[2] / len];
          const d = (at[0] - origin[0]) * un[0] + (at[1] - origin[1]) * un[1] + (at[2] - origin[2]) * un[2];
          out.push({ surface: 'plane', normal: un, origin, at: [at[0] - un[0] * d, at[1] - un[1] * d, at[2] - un[2] * d] });
        } else out.push({ surface: su.k, origin, at });
      } else out.push({ surface: 'other', at });
      return;
    }
    if (sh.type === 'Ed' || sh.type === 'Ve') return;
    for (const c of sh.kids) walk(c, world, o);
  };
  walk(P.root, IDENT, 1);
  return out;
}
