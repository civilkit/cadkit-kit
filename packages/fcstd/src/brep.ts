// Reader for OCCT's BRep text format ("CASCADE Topology V1", the *.brp files inside an FCStd), only as far as needed to
// turn FreeCAD's "EdgeN" names into points: the edge order is OCCT's TopExp::MapShapes(shape, TopAbs_EDGE), and the point is
// the middle of the edge (lines and circles exact; other curves fall back to the vertex midpoint, flagged `approx`).
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

interface Shape { type: string; xyz?: V3; curve?: { idx: number; loc: number; t0: number; t1: number }; kids: Array<{ idx: number; loc: number }> }
export interface BrepEdge { at: V3; curve: 'line' | 'circle' | 'other'; approx: boolean }

export function brepEdges(text: string): BrepEdge[] {
  const L = text.split(/\r?\n/);
  let i = 0;
  const find = (h: string) => { while (i < L.length && !L[i].startsWith(h)) i++; return i < L.length; };
  // locations
  i = 0; if (!find('Locations')) return [];
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
  // curves (lines and circles; parsing stops at the first curve type that spans several lines)
  const curves: Array<{ k: 'line' | 'circle'; v: number[] } | null> = [null];
  i = 0;
  if (find('Curves')) {
    const n = Number(L[i].split(/\s+/)[1]); i++;
    for (let k = 0; k < n; k++) {
      const t = L[i].trim().split(/\s+/).map(Number);
      if (t[0] === 1) curves.push({ k: 'line', v: t.slice(1) });
      else if (t[0] === 2) curves.push({ k: 'circle', v: t.slice(1) });
      else if ([3, 4, 5].includes(t[0])) curves.push(null);
      else break;
      i++;
    }
  }
  // shapes
  i = 0; if (!find('TShapes')) return [];
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
    for (const m of kidText.matchAll(/([+\-ie])(\d+)\s+(\d+)/g)) sh.kids.push({ idx: N - Number(m[2]) , loc: Number(m[3]) });
    shapes.push(sh);
  }
  const root = L.slice(i).join(' ').match(/([+\-ie])(\d+)\s+(\d+)/);
  if (!root) return [];
  const rootRef = { idx: N - Number(root[2]), loc: Number(root[3]) };
  // MapShapes(EDGE): depth first, children in order, unique by shape + location
  const seen = new Set<string>();
  const out: BrepEdge[] = [];
  const key = (idx: number, m: M) => idx + ':' + m.map((v) => v.toFixed(6)).join(',');
  const walk = (ref: { idx: number; loc: number }, parent: M) => {
    const sh = shapes[ref.idx]; if (!sh) return;
    const world = mul(parent, locs[ref.loc] ?? IDENT);
    if (sh.type === 'Ed') {
      const k = key(ref.idx, world); if (seen.has(k)) return; seen.add(k);
      const vs = sh.kids.map((c) => shapes[c.idx]).filter((s) => s?.type === 'Ve').map((s) => s.xyz!);
      const cv = sh.curve && curves[sh.curve.idx];
      if (sh.curve && cv) {
        const tm = (sh.curve.t0 + sh.curve.t1) / 2, v = cv.v;
        const lm = mul(world, locs[sh.curve.loc] ?? IDENT);
        if (cv.k === 'line') out.push({ at: apply(lm, [v[0] + v[3] * tm, v[1] + v[4] * tm, v[2] + v[5] * tm]), curve: 'line', approx: false });
        else {
          const [cx, cy, cz, , , , xx, xy, xz, yx, yy, yz, r] = v;
          out.push({ at: apply(lm, [cx + r * (Math.cos(tm) * xx + Math.sin(tm) * yx), cy + r * (Math.cos(tm) * xy + Math.sin(tm) * yy), cz + r * (Math.cos(tm) * xz + Math.sin(tm) * yz)]), curve: 'circle', approx: false });
        }
      } else {
        const a = vs[0] ?? [0, 0, 0], b = vs[1] ?? a;
        out.push({ at: apply(world, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]), curve: 'other', approx: true });
      }
      return;
    }
    if (sh.type === 'Ve') return;
    for (const c of sh.kids) walk(c, world);
  };
  walk(rootRef, IDENT);
  return out;
}
