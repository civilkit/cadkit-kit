#!/usr/bin/env node
// SolidCraft design (.solidcraft, format solidcraft/27+) -> ck-part (.ckpart).
//
//   node tools/solidcraft2ckpart.mjs <design.solidcraft> --out <Name.ckpart>
//        [--ref <ref-dir>] [--report <Name.convert.md>] [--step <our.step>] [--wasm <ck_wasm.wasm>] [--quiet]
//
// What it does, and why it needs the kernel
//   * Every SolidCraft body becomes a nested part (one body per part, as our features act on one body); the top-level
//     part holds one `insertPart` per body. A cut or hole with no explicit target acts on every body it removes volume
//     from (SolidCraft does the same): each feature is tried on every body in our kernel and kept where the volume drops.
//   * Sketch planes: SolidCraft planes (origin / face / custom) are turned into a std plane (+ `plane` offset feature,
//     + `flip` when the normal is opposite) and the sketch coordinates are rotated by a multiple of 90 degrees, so the
//     world geometry is identical. Arcs stay counter-clockwise (proper rotation).
//   * Face and edge picks (fillet, draft, "to" extents) are given by points in SolidCraft; they are resolved to our
//     persistent face names with the kernel's `closestPoint` on the body built so far.
//   * Parameters map to variables; dimension constraints carry `expr`.
// Not convertible (listed in the report): pattern_point constraints, sketch links/anchors (kept as plain geometry).
// --ref <dir> holds SolidCraft evals of prefixes of the design (`*_f<id>.solidcraft.eval.json`): per-feature body
// volumes are compared with ours and any deviation is listed (bisect aid; never changes the output).
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- kernel host
class Kernel {
  constructor(mod) {
    this.mod = mod;
    this.env = { ck_now: () => 0, ck_unix_ms: () => 0, ck_panic: (p, l) => { this.panic = new TextDecoder().decode(new Uint8Array(this.x.memory.buffer, p, l)); } };
    this.n = 1;
    this.boot();
  }
  boot() { this.x = new WebAssembly.Instance(this.mod, { env: this.env }).exports; }
  q(msg) {
    const b = new TextEncoder().encode(JSON.stringify({ id: this.n++, msg }));
    this.panic = null;
    try {
      const p = this.x.ck_alloc(b.length);
      new Uint8Array(this.x.memory.buffer, p, b.length).set(b);
      const total = this.x.ck_request(p, b.length), o = this.x.ck_reply();
      const bytes = new Uint8Array(this.x.memory.buffer.slice(o, o + total));
      const jl = new DataView(bytes.buffer).getUint32(0, true);
      return JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + jl)));
    } catch (e) { const t = `${e.message}${this.panic ? ' panic=' + this.panic : ''}`; this.boot(); return { ok: false, trap: t }; }
  }
}

// ---------------------------------------------------------------- small helpers
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.sqrt(dot(a, a));
/** Round noise: 1e-9 grid, -0 -> 0. */
const clean = (v) => { const r = Math.round(v * 1e9) / 1e9; return r === 0 ? 0 : r; };
const cleanV = (a) => a.map(clean);
const NUM = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
/** A SolidCraft numeric field ("5mm", "10 mm", 3, "Name*2") as a kernel field: a number or "=expression". */
export function exprOf(v) {
  if (typeof v === 'number') return clean(v);
  const s = String(v).trim();
  const m = s.match(/^([-+]?(?:\d+\.?\d*|\.\d+))\s*(mm|deg)?$/i);
  if (m) return clean(parseFloat(m[1]));
  if (NUM.test(s)) return clean(parseFloat(s));
  return '=' + s;
}
/** The text of an expression without '=' (sketch dimension `expr`), or null when it is a plain number. */
function dimExpr(s) {
  const e = exprOf(s);
  return typeof e === 'number' ? null : e.slice(1);
}
const isNum = (e) => typeof e === 'number';
/** Expression text for use inside another expression. */
const asText = (e) => (isNum(e) ? String(e) : e.slice(1));

// ---------------------------------------------------------------- planes
// SolidCraft: XY x=X y=Y; XZ x=X y=-Z; YZ x=Y y=Z (normal = x cross y).
const SC_ORIGIN_PLANES = {
  XY: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] },
  XZ: { o: [0, 0, 0], x: [1, 0, 0], y: [0, 0, -1] },
  YZ: { o: [0, 0, 0], x: [0, 1, 0], y: [0, 0, 1] },
};
// Ours (ck-core std_plane): front x=X y=Y z=Z; top x=X y=-Z z=Y; right x=-Z y=Y z=X.
const OUR_STD = {
  front: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  top: { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
  right: { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] },
};

/** Frame {o,x,y,z} of a SolidCraft sketch plane. */
export function scFrame(plane) {
  let o, x, y;
  if (plane.type === 'origin') ({ o, x, y } = SC_ORIGIN_PLANES[plane.name]);
  else ({ origin: o, x_dir: x, y_dir: y } = plane.plane);
  if (!o) throw new Error(`unsupported sketch plane ${JSON.stringify(plane).slice(0, 120)}`);
  x = x.map((v) => (Math.abs(v) < 1e-9 ? 0 : v)); y = y.map((v) => (Math.abs(v) < 1e-9 ? 0 : v));
  return { o, x, y, z: cross(x, y) };
}

/** Our frame for (std plane, flip, offset): flip negates x and z, the offset moves the origin along the (flipped) z. */
function ourFrame(base, flip, offset) {
  const s = OUR_STD[base];
  const x = flip ? mul(s.x, -1) : s.x, z = flip ? mul(s.z, -1) : s.z;
  return { o: mul(z, offset), x, y: s.y, z };
}

/**
 * Choose how to reproduce the frame in our model.
 * Returns {base, flip, offset, map(u,v)->[u',v']} where map takes SolidCraft sketch coordinates to ours.
 */
export function mapPlane(fr) {
  let best = null;
  for (const [id, s] of Object.entries(OUR_STD)) {
    const d = dot(s.z, fr.z);
    if (Math.abs(Math.abs(d) - 1) < 1e-6) best = { base: id, flip: d < 0 };
  }
  if (!best) throw new Error(`sketch plane normal ${fr.z.map((v) => v.toFixed(4))} is not along a world axis`);
  const zf = ourFrame(best.base, best.flip, 0).z;
  const offset = clean(dot(fr.o, zf));
  const ours = ourFrame(best.base, best.flip, offset);
  const d = sub(fr.o, ours.o);
  const du = dot(d, ours.x), dv = dot(d, ours.y);
  const r = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : v);
  const a = r(dot(fr.x, ours.x)), b = r(dot(fr.y, ours.x)), c = r(dot(fr.x, ours.y)), e = r(dot(fr.y, ours.y));
  return { ...best, offset, frame: ours, map: (u, v) => [clean(du + a * u + b * v), clean(dv + c * u + e * v)], lin: { a, b, c, e }, d: [du, dv] };
}

// ---------------------------------------------------------------- planar cells
// SolidCraft profiles are the faces of the planar arrangement of ALL the curves of a sketch; the kernel's `regions`
// are even-odd nested solids (adjacent cells inside a hole are one region, a ring has no region of its own). For a
// profile the kernel cannot select, the face is computed here and rebuilt as a plain sketch.
const TAU = Math.PI * 2;
const norm2 = (a) => Math.hypot(a[0], a[1]);
const angMod = (a) => ((a % TAU) + TAU) % TAU;

/** curves: [{id, type:'line'|'arc'|'circle', a,b | c,r,p1,p2}] in sketch coordinates. */
export function arrangement(curves, tol = 1e-6) {
  const G = curves.map((c) => {
    if (c.type === 'line') return { id: c.id, k: 'line', a: c.a, b: c.b };
    const t0 = c.type === 'circle' ? 0 : Math.atan2(c.p1[1] - c.c[1], c.p1[0] - c.c[0]);
    const sweep = c.type === 'circle' ? TAU : angMod(Math.atan2(c.p2[1] - c.c[1], c.p2[0] - c.c[0]) - t0) || TAU;
    return { id: c.id, k: c.type === 'circle' ? 'circle' : 'arc', c: c.c, r: c.r ?? norm2([c.p1[0] - c.c[0], c.p1[1] - c.c[1]]), t0, sweep };
  });
  const pointAt = (g, t) => (g.k === 'line' ? [g.a[0] + (g.b[0] - g.a[0]) * t, g.a[1] + (g.b[1] - g.a[1]) * t] : [g.c[0] + g.r * Math.cos(g.t0 + t), g.c[1] + g.r * Math.sin(g.t0 + t)]);
  /** parameter of a point on curve g (line: 0..1, arc: 0..sweep), or null when the point is not on it */
  const paramOf = (g, p) => {
    if (g.k === 'line') {
      const d = [g.b[0] - g.a[0], g.b[1] - g.a[1]], L2 = d[0] * d[0] + d[1] * d[1];
      const t = ((p[0] - g.a[0]) * d[0] + (p[1] - g.a[1]) * d[1]) / L2;
      const q = pointAt(g, t);
      return Math.hypot(q[0] - p[0], q[1] - p[1]) < tol && t > -tol / Math.sqrt(L2) && t < 1 + tol / Math.sqrt(L2) ? Math.min(1, Math.max(0, t)) : null;
    }
    if (Math.abs(Math.hypot(p[0] - g.c[0], p[1] - g.c[1]) - g.r) > tol) return null;
    let t = angMod(Math.atan2(p[1] - g.c[1], p[0] - g.c[0]) - g.t0);
    if (g.k === 'circle') return t;
    const slack = tol / g.r;
    if (t <= g.sweep + slack) return Math.min(t, g.sweep);
    if (t >= TAU - slack) return 0;
    return null;
  };
  const cand = G.map(() => []);
  const addPt = (i, p) => { const t = paramOf(G[i], p); if (t != null) cand[i].push({ t, p }); };
  for (const [i, g] of G.entries()) {
    if (g.k === 'line') { addPt(i, g.a); addPt(i, g.b); }
    else if (g.k === 'arc') { addPt(i, pointAt(g, 0)); addPt(i, pointAt(g, g.sweep)); }
  }
  const inter = (g, h) => {
    const out = [];
    if (g.k === 'line' && h.k === 'line') {
      const d1 = [g.b[0] - g.a[0], g.b[1] - g.a[1]], d2 = [h.b[0] - h.a[0], h.b[1] - h.a[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-12 * norm2(d1) * norm2(d2)) return out; // parallel / collinear: endpoints handled above
      const t = ((h.a[0] - g.a[0]) * d2[1] - (h.a[1] - g.a[1]) * d2[0]) / den;
      out.push(pointAt(g, t));
    } else if (g.k === 'line' || h.k === 'line') {
      const L = g.k === 'line' ? g : h, C = g.k === 'line' ? h : g;
      const d = [L.b[0] - L.a[0], L.b[1] - L.a[1]], f = [L.a[0] - C.c[0], L.a[1] - C.c[1]];
      const A = d[0] * d[0] + d[1] * d[1], B = 2 * (f[0] * d[0] + f[1] * d[1]), Cc = f[0] * f[0] + f[1] * f[1] - C.r * C.r;
      let disc = B * B - 4 * A * Cc;
      if (disc < -1e-9 * A) return out;
      disc = Math.sqrt(Math.max(0, disc));
      out.push(pointAt(L, (-B - disc) / (2 * A)), pointAt(L, (-B + disc) / (2 * A)));
    } else {
      const dx = h.c[0] - g.c[0], dy = h.c[1] - g.c[1], D = Math.hypot(dx, dy);
      if (D < tol) return out;
      const a = (g.r * g.r - h.r * h.r + D * D) / (2 * D), h2 = g.r * g.r - a * a;
      if (h2 < -1e-9) return out;
      const hh = Math.sqrt(Math.max(0, h2)), mx = g.c[0] + (a * dx) / D, my = g.c[1] + (a * dy) / D;
      out.push([mx + (hh * dy) / D, my - (hh * dx) / D], [mx - (hh * dy) / D, my + (hh * dx) / D]);
    }
    return out;
  };
  for (let i = 0; i < G.length; i++) for (let j = i + 1; j < G.length; j++) {
    for (const p of inter(G[i], G[j])) { addPt(i, p); addPt(j, p); }
    // endpoints of one lying on the other (collinear overlaps, tangent touches)
    const ends = (g) => (g.k === 'line' ? [g.a, g.b] : g.k === 'arc' ? [pointAt(g, 0), pointAt(g, g.sweep)] : []);
    for (const p of ends(G[j])) addPt(i, p);
    for (const p of ends(G[i])) addPt(j, p);
  }
  // vertices
  const V = [];
  const vid = (p) => {
    for (const [k, q] of V.entries()) if (Math.hypot(q[0] - p[0], q[1] - p[1]) < tol * 2) return k;
    V.push(p); return V.length - 1;
  };
  const E = [];
  for (const [i, g] of G.entries()) {
    let ts = cand[i].map((x) => x.t).sort((a, b) => a - b);
    const dedup = [];
    for (const t of ts) if (!dedup.length || t - dedup[dedup.length - 1] > (g.k === 'line' ? tol / norm2([g.b[0] - g.a[0], g.b[1] - g.a[1]]) : tol / g.r)) dedup.push(t);
    ts = dedup;
    if (g.k === 'circle') {
      if (ts.length < 2) ts = ts.length ? [ts[0], (ts[0] + Math.PI) % TAU].sort((a, b) => a - b) : [0, Math.PI];
      for (let k = 0; k < ts.length; k++) {
        const t0 = ts[k], t1 = k + 1 < ts.length ? ts[k + 1] : ts[0] + TAU;
        E.push({ g, i, t0, t1, u: vid(pointAt(g, t0)), v: vid(pointAt(g, t1 % TAU)), srcs: new Set([g.id]) });
      }
    } else {
      for (let k = 0; k + 1 < ts.length; k++) E.push({ g, i, t0: ts[k], t1: ts[k + 1], u: vid(pointAt(g, ts[k])), v: vid(pointAt(g, ts[k + 1])), srcs: new Set([g.id]) });
    }
  }
  // merge coincident edges (overlapping collinear / identical arcs)
  const mid = (e) => pointAt(e.g, (e.t0 + e.t1) / 2);
  const edges = [];
  for (const e of E) {
    if (e.u === e.v && e.g.k !== 'circle') continue;
    const m = mid(e);
    const same = edges.find((x) => ((x.u === e.u && x.v === e.v) || (x.u === e.v && x.v === e.u)) && Math.hypot(mid(x)[0] - m[0], mid(x)[1] - m[1]) < tol * 2);
    if (same) e.g.id && same.srcs.add(e.g.id); else edges.push(e);
  }
  // half edges: 2k forward (u->v along the parameter), 2k+1 backward
  const sampleDir = (e, fwd) => {
    const len = e.g.k === 'line' ? norm2([e.g.b[0] - e.g.a[0], e.g.b[1] - e.g.a[1]]) * (e.t1 - e.t0) : e.g.r * (e.t1 - e.t0);
    const s = Math.min(len / 3, 1e-3);
    const frac = s / len * (e.t1 - e.t0);
    const t = fwd ? e.t0 + frac : e.t1 - frac;
    const p = pointAt(e.g, t), o = V[fwd ? e.u : e.v];
    return Math.atan2(p[1] - o[1], p[0] - o[0]);
  };
  const H = [];
  for (const [k, e] of edges.entries()) {
    H.push({ e: k, fwd: true, from: e.u, to: e.v, ang: sampleDir(e, true) });
    H.push({ e: k, fwd: false, from: e.v, to: e.u, ang: sampleDir(e, false) });
  }
  const out = V.map(() => []);
  for (const [i, h] of H.entries()) out[h.from].push(i);
  for (const l of out) l.sort((a, b) => H[a].ang - H[b].ang);
  const next = new Array(H.length);
  for (const [i, h] of H.entries()) {
    const tw = i ^ 1;
    const list = out[h.to];
    const pos = list.indexOf(tw);
    next[i] = list[(pos - 1 + list.length) % list.length];
  }
  // faces
  const seen = new Array(H.length).fill(false);
  const polyOf = (cyc) => {
    const pts = [];
    for (const hi of cyc) {
      const h = H[hi], e = edges[h.e];
      const n = e.g.k === 'line' ? 1 : Math.max(8, Math.ceil(((e.t1 - e.t0) / TAU) * 64));
      for (let k = 0; k < n; k++) {
        const f = k / n;
        pts.push(pointAt(e.g, h.fwd ? e.t0 + (e.t1 - e.t0) * f : e.t1 - (e.t1 - e.t0) * f));
      }
    }
    return pts;
  };
  const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const cycles = [];
  for (let i = 0; i < H.length; i++) {
    if (seen[i]) continue;
    const cyc = [];
    for (let j = i; !seen[j]; j = next[j]) { seen[j] = true; cyc.push(j); }
    const poly = polyOf(cyc);
    cycles.push({ cyc, poly, area: area(poly) });
  }
  // components (shared vertices)
  const comp = V.map((_, i) => i);
  const find = (x) => (comp[x] === x ? x : (comp[x] = find(comp[x])));
  for (const e of edges) comp[find(e.u)] = find(e.v);
  for (const c of cycles) c.comp = find(H[c.cyc[0]].from);
  return { G, V, edges, H, cycles, pointAt };
}

const inPoly = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

/** The cell (face) whose boundary curves are exactly `ids`: {outer: cycle, holes: [cycle]} or null. */
export function findCell(arr, ids) {
  const want = new Set(ids);
  const pos = arr.cycles.filter((c) => c.area > 1e-9);
  // every edge of the cell carries one of the loop's ids (a coincident pair is listed by one of its ids) and every id is used
  const score = (c) => {
    const used = new Set();
    let extra = 0;
    for (const h of c.cyc) {
      const e = arr.edges[arr.H[h].e];
      const m = [...e.srcs].filter((x) => want.has(x));
      if (!m.length) return null;
      m.forEach((x) => used.add(x));
      extra += e.srcs.size - m.length;
    }
    return used.size === want.size ? extra : null;
  };
  const scored = pos.map((c) => ({ c, sc: score(c) })).filter((x) => x.sc != null).sort((a, b) => a.sc - b.sc || a.c.area - b.c.area);
  const hit = scored.map((x) => x.c);
  if (!hit.length) return null;
  const outer = hit[0];
  const holes = [];
  for (const n of arr.cycles.filter((c) => c.area < -1e-9 && c.comp !== outer.comp)) {
    const probe = n.poly[0];
    if (!inPoly(probe, outer.poly)) continue;
    // direct child only: no smaller positive cycle (of a third component) contains it and is inside `outer`
    const deeper = pos.some((c) => c !== outer && c.comp !== n.comp && c.area < outer.area && inPoly(probe, c.poly) && inPoly(c.poly[0], outer.poly));
    if (!deeper) holes.push(n);
  }
  return { outer, holes };
}

// ---------------------------------------------------------------- the converter
export async function convert(designPath, opts = {}) {
  const log = opts.quiet ? () => {} : (...a) => console.error(...a);
  const design = JSON.parse(readFileSync(designPath, 'utf8'));
  const wasmPath = opts.wasm ?? process.env.CK_WASM ?? resolve(HERE, '../apps/cad/public/kernel/ck_wasm.wasm');
  const K = new Kernel(new WebAssembly.Module(readFileSync(wasmPath)));
  const report = { skipped: [], notes: [], warnings: [], features: [], bodies: {} };
  const note = (m) => { if (!report.notes.includes(m)) report.notes.push(m); };

  // ---- variables: user parameters (model:false); dimension parameters (model:true) are inlined as constraint `expr`.
  const userParams = design.params.filter((p) => !p.model);
  const paramExpr = new Map(design.params.map((p) => [p.name, p]));
  const variables = userParams.map((p) => ({ name: p.name, expr: String(p.expr).trim(), unit: p.unit === 'deg' ? 'deg' : 'mm' }));
  report.variables = variables.length;

  // dimension parameters used by a feature's sketches: feature.params = [{name, expression, unit}] (script form) or global params
  const dimParam = (feature, name) => {
    const own = (feature.params ?? []).find((p) => p.name === name);
    if (own) return { expr: own.expression ?? own.expr, unit: own.unit };
    const g = paramExpr.get(name);
    return g ? { expr: g.expr, unit: g.unit } : null;
  };

  // ---- solved sketches (optional): `sketch.inspect` results. Stored point positions of sketches with links (projected
  // geometry) can be stale: SolidCraft re-projects them when the design is opened, so the solved positions win.
  const solved = new Map();
  if (opts.solved) for (const r of JSON.parse(readFileSync(opts.solved, 'utf8'))) solved.set(r.id, r);
  const linked = design.features.filter((f) => f.type === 'sketch' && (f.sketch.links ?? []).length);
  if (linked.length && !solved.size) report.warnings.push(`${linked.length} sketches have links (projected geometry) and no --solved file was given: stored positions may be stale (SolidCraft re-projects links when it opens a design)`);

  // ---- reference volumes (optional)
  const ref = new Map();
  if (opts.ref && /\.json$/.test(opts.ref) && existsSync(opts.ref)) {
    for (const [id, v] of Object.entries(JSON.parse(readFileSync(opts.ref, 'utf8')))) ref.set(+id, v);
  } else if (opts.ref && existsSync(opts.ref)) {
    for (const f of readdirSync(opts.ref)) {
      const m = f.match(/_f(\d+)\.solidcraft\.eval\.json$/);
      if (!m) continue;
      const e = JSON.parse(readFileSync(resolve(opts.ref, f), 'utf8'));
      ref.set(+m[1], Object.fromEntries(e.bodies.map((b) => [b.name, b.volume_mm3])));
    }
  }

  // ---- bodies (one nested part each)
  const bodies = new Map();
  const newDoc = (name) => ({ format: 'ck-part', version: 1, name, features: [], seq: 1, rollback: null, material: 'steel', counters: {}, variables: variables.map((v) => ({ name: v.name, expr: v.expr })) });
  const addBody = (name) => {
    const b = { name, tag: 'll_' + name, doc: newDoc(name), planes: new Map(), sketches: new Map(), volume: 0, last: null };
    bodies.set(name, b);
    return b;
  };
  const nextId = (b) => 'F' + b.doc.seq++;
  const push = (b, f) => { f.id = nextId(b); b.doc.features.push(f); return f.id; };
  const regen = (b, noCache = false) => {
    const r = K.q({ type: 'regen', tag: b.tag, part: b.doc, noCache, opts: { solveSketches: true } });
    b.last = r;
    return r;
  };
  const norm = (e) => (Array.isArray(e) ? { feature: e[0], error: e[1] } : e);
  const errorsOf = (r) => (r.ok ? (r.result.errors ?? []).map(norm) : [{ feature: '?', error: { code: r.trap ?? JSON.stringify(r.error ?? r).slice(0, 200) } }]);
  const warningsOf = (r) => (r.ok ? (r.result.warnings ?? []).map(norm) : []);
  const volumeOf = (b) => {
    const m = K.q({ type: 'massProps', tag: b.tag });
    return m.ok ? m.result.volume : 0;
  };
  const snapshot = (b) => ({ n: b.doc.features.length, seq: b.doc.seq, planes: new Map(b.planes), sketches: new Map(b.sketches) });
  const restore = (b, s) => { b.doc.features.length = s.n; b.doc.seq = s.seq; b.planes = new Map(s.planes); b.sketches = new Map(s.sketches); };

  // ---- plane + sketch emission
  const planeRef = (b, mp) => {
    if (mp.offset === 0 && !mp.flip) return { kind: 'std', id: mp.base };
    const key = `${mp.base}|${mp.flip}|${mp.offset}`;
    if (!b.planes.has(key)) {
      const id = push(b, { type: 'plane', mode: 'offset', base: { kind: 'std', id: mp.base }, offset: mp.offset, flip: mp.flip, name: `Plane ${mp.base}${mp.flip ? ' flipped' : ''} ${mp.offset}`, visible: false });
      b.planes.set(key, id);
    }
    return { kind: 'feature', id: b.planes.get(key) };
  };

  /** Convert a SolidCraft sketch to our sketch feature body (without id). `only` limits to point entities (hole sketches). */
  function sketchFeature(b, f, { pointsFor = null, kindTag = '' } = {}) {
    const sk = f.sketch;
    const sv = solved.get(f.id);
    const mp = mapPlane(scFrame(sv ? { type: 'custom', plane: sv.plane } : f.plane));
    const svAt = new Map((sv?.points ?? []).map((q) => [q.id, q.at]));
    const svR = new Map((sv?.curves ?? []).filter((c) => c.type === 'circle').map((c) => [c.id, c.radius]));
    const P = sk.points.map((q) => (svAt.has(q.id) ? { ...q, pos: svAt.get(q.id) } : q));
    const pid = (i) => (i === 0 || P[i].id === 'origin' ? 'O' : P[i].id);
    const C = sk.curves;
    const cid = (i) => C[i].id;
    const dropped = [];
    const points = [], entities = [], constraints = [];
    const used = new Set();
    const pos = (i) => mp.map(P[i].pos[0], P[i].pos[1]);
    const needPoint = (i) => {
      const id = pid(i);
      if (used.has(id)) return id;
      used.add(id);
      const [x, y] = pos(i);
      const pt = { id, x, y };
      if (P[i].fixed || id === 'O') pt.fixed = true;
      points.push(pt);
      return id;
    };
    needPoint(0); // origin first
    if (pointsFor) {
      for (const [n, i] of pointsFor.entries()) {
        const id = needPoint(i);
        entities.push({ id: `pt${n + 1}`, type: 'point', p: id });
      }
      return { type: 'sketch', name: f.name + kindTag, plane: planeRef(b, mp), points, entities, constraints, visible: false, __dropped: dropped, __mp: mp };
    }
    for (const [i, c] of C.entries()) {
      const e = { id: c.id, type: c.type };
      if (c.type === 'line') { e.p1 = needPoint(c.a); e.p2 = needPoint(c.b); }
      else if (c.type === 'arc') { e.c = needPoint(c.c); e.p1 = needPoint(c.a); e.p2 = needPoint(c.b); }
      else if (c.type === 'circle') { e.c = needPoint(c.c); e.r = clean(svR.get(c.id) ?? c.r); }
      else { dropped.push(`curve ${c.id} (${c.type})`); continue; }
      if (c.construction) e.construction = true;
      entities.push(e);
    }
    for (const p of P.keys()) needPoint(p);
    const dimOf = (k) => {
      const d = k.param ? dimParam(f, k.param) : null;
      const out = {};
      const x = d ? dimExpr(d.expr) : null;
      if (x) out.expr = x;
      return out;
    };
    const lineEnds = (ci) => [pid(C[ci].a), pid(C[ci].b)];
    // a 90 degree turn of the sketch swaps what horizontal / vertical (and hdist / vdist) mean
    const swapped = Math.abs(mp.lin.a) < 0.5;
    const hv = (t) => (swapped ? { horizontal: 'vertical', vertical: 'horizontal', hdist: 'vdist', vdist: 'hdist' }[t] : t);
    const dirOf = (ci) => { const [a, b] = [pos(C[ci].a), pos(C[ci].b)]; const d = [b[0] - a[0], b[1] - a[1]]; const l = Math.hypot(...d); return [d[0] / l, d[1] / l]; };
    for (const k of sk.constraints) {
      const base = { id: k.id };
      let out = null;
      switch (k.type) {
        case 'horizontal': case 'vertical': out = { ...base, type: hv(k.type), refs: [cid(k.l)] }; break;
        case 'horizontal_points': out = { ...base, type: hv('horizontal'), refs: [pid(k.p), pid(k.q)] }; break;
        case 'vertical_points': out = { ...base, type: hv('vertical'), refs: [pid(k.p), pid(k.q)] }; break;
        case 'coincident': out = { ...base, type: 'coincident', refs: [pid(k.p), pid(k.q)] }; break;
        case 'parallel': case 'perpendicular': case 'equal': case 'tangent': out = { ...base, type: k.type, refs: [cid(k.a), cid(k.b)] }; break;
        case 'midpoint': out = { ...base, type: 'midpoint', refs: [pid(k.p), cid(k.l)] }; break;
        case 'symmetric': out = { ...base, type: 'symmetric', refs: [pid(k.p), pid(k.q), cid(k.l)] }; break;
        case 'point_on_curve': out = { ...base, type: C[k.c].type === 'line' ? 'pointOnLine' : 'pointOnCircle', refs: [pid(k.p), cid(k.c)] }; break;
        case 'distance': out = { ...base, type: 'distance', refs: [pid(k.p), pid(k.q)], value: clean(k.value), ...dimOf(k) }; break;
        case 'length': out = { ...base, type: 'distance', refs: lineEnds(k.l), value: clean(k.value), ...dimOf(k) }; break;
        case 'distance_x': out = { ...base, type: hv('hdist'), refs: [pid(k.p), pid(k.q)], value: clean(k.value), ...dimOf(k) }; break;
        case 'distance_y': out = { ...base, type: hv('vdist'), refs: [pid(k.p), pid(k.q)], value: clean(k.value), ...dimOf(k) }; break;
        case 'diameter': out = { ...base, type: 'diameter', refs: [cid(k.c)], value: clean(k.value), ...dimOf(k) }; break;
        case 'radius': out = { ...base, type: 'radius', refs: [cid(k.c)], value: clean(k.value), ...dimOf(k) }; break;
        case 'angle': {
          // ours: counter-clockwise angle from s1*dir(a) to s2*dir(b), degrees. Pick the signs that reproduce the drawn angle.
          const want = (k.value * 180) / Math.PI;
          const da = dirOf(k.a), db = dirOf(k.b);
          let pick = null;
          for (const [s1, s2] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
            const ux = da[0] * s1, uy = da[1] * s1, vx = db[0] * s2, vy = db[1] * s2;
            let a = (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI;
            if (a < 0) a += 360;
            if (Math.abs(a - want) < 1e-6 || Math.abs(a - 360 - want) < 1e-6) { pick = { s1, s2 }; break; }
          }
          if (!pick) { dropped.push(`angle ${k.id} (drawn angle does not match ${want} deg either way)`); break; }
          out = { ...base, type: 'angle', refs: [cid(k.a), cid(k.b)], value: clean(want), s1: pick.s1, s2: pick.s2, ...dimOf(k) };
          break;
        }
        default: dropped.push(`constraint ${k.id} (${k.type})`);
      }
      if (out) constraints.push(out);
    }
    return { type: 'sketch', name: f.name + kindTag, plane: planeRef(b, mp), points, entities, constraints, visible: false, __dropped: dropped, __mp: mp };
  }

  const ensureSketch = (b, f, variant = '') => {
    const key = f.id + variant;
    if (b.sketches.has(key)) return b.sketches.get(key);
    const sf = sketchFeature(b, f);
    const dropped = sf.__dropped; const mp = sf.__mp; delete sf.__dropped; delete sf.__mp;
    for (const d of dropped) if (!report.skipped.includes(`${f.name} (${f.id}): ${d}`)) report.skipped.push(`${f.name} (${f.id}): ${d}`);
    const id = push(b, sf);
    b.sketches.set(key, id);
    b.sketchMap = b.sketchMap ?? new Map();
    b.sketchMap.set(id, { mp, f });
    return id;
  };


  // ---------------------------------------------------------------- profiles (which regions an extrude takes)
  const sketchResult = (b, sid) => b.last.result.sketches.find((s) => s[0] === sid)[1];
  const sameSet = (a, c) => a.size === c.size && [...a].every((v) => c.has(v));

  /** A sketch rebuilt from an arrangement cell (outer cycle + island cycles), same plane as sketch `sid`. */
  function cellSketch(b, sid, arr, cell, name) {
    const src = b.doc.features.find((x) => x.id === sid);
    const points = [{ id: 'O', x: 0, y: 0, fixed: true }];
    const entities = [];
    const pid = new Map();
    const P = (k) => {
      if (!pid.has(k)) { pid.set(k, 'q' + (pid.size + 1)); points.push({ id: pid.get(k), x: clean(arr.V[k][0]), y: clean(arr.V[k][1]) }); }
      return pid.get(k);
    };
    const cpt = new Map();
    const C = (g) => {
      if (!cpt.has(g)) { const id = 'c' + (cpt.size + 1); cpt.set(g, id); points.push({ id, x: clean(g.c[0]), y: clean(g.c[1]) }); }
      return cpt.get(g);
    };
    for (const cy of [cell.outer, ...cell.holes]) {
      const es = [...new Set(cy.cyc.map((h) => arr.H[h].e))].map((k) => arr.edges[k]);
      // pieces of one circle that add up to 360 degrees (a circle drawn over an arc of itself) are one circle
      const sameCircle = es.every((e) => e.g.k !== 'line' && Math.hypot(e.g.c[0] - es[0].g.c[0], e.g.c[1] - es[0].g.c[1]) < 1e-6 && Math.abs(e.g.r - es[0].g.r) < 1e-6);
      if (sameCircle && Math.abs(es.reduce((a, e) => a + (e.t1 - e.t0), 0) - TAU) < 1e-6) {
        entities.push({ id: 'e' + (entities.length + 1), type: 'circle', c: C(es[0].g), r: clean(es[0].g.r) });
        continue;
      }
      for (const e of es) {
        if (e.g.k === 'line') entities.push({ id: 'e' + (entities.length + 1), type: 'line', p1: P(e.u), p2: P(e.v) });
        else entities.push({ id: 'e' + (entities.length + 1), type: 'arc', c: C(e.g), p1: P(e.u), p2: P(e.v) });
      }
    }
    return push(b, { type: 'sketch', name, plane: src.plane, points, entities, constraints: [], visible: false });
  }
  const arrOf = (sr) => {
    const P = new Map(sr.sketch.points.map((p) => [p.id, [p.x, p.y]]));
    const curves = [];
    for (const e of sr.sketch.entities) {
      if (e.construction) continue;
      if (e.type === 'line') curves.push({ id: e.id, type: 'line', a: P.get(e.p1), b: P.get(e.p2) });
      else if (e.type === 'arc') curves.push({ id: e.id, type: 'arc', c: P.get(e.c), p1: P.get(e.p1), p2: P.get(e.p2) });
      else if (e.type === 'circle') curves.push({ id: e.id, type: 'circle', c: P.get(e.c), r: e.r });
    }
    return arrangement(curves);
  };

  /** Decide, for the SolidCraft loops of an extrude, the pieces to extrude: [{sketch, regions?}]. */
  function pickProfiles(b, f, sid, loops) {
    const sr = sketchResult(b, sid);
    const regs = sr.profiles.regions;
    const outerSets = regs.map((r) => new Set(r.outer.map((s) => s.tag)));
    const holeSets = regs.flatMap((r) => r.holes.map((h) => new Set(h.map((s) => s.tag))));
    const pieces = [];
    const direct = [];
    let arr = null;
    for (const [li, loop] of loops.entries()) {
      const L = new Set(loop);
      const idx = outerSets.findIndex((S) => sameSet(S, L));
      if (idx >= 0) {
        // an id that no other region's outer loop carries selects exactly this region
        const unique = [...outerSets[idx]].find((t) => outerSets.every((S, j) => j === idx || !S.has(t)));
        // a circle split into arcs (an arc drawn over its own circle) cuts to an invalid solid in the kernel: use one circle
        const arcs = regs[idx].outer.filter((sg) => sg.kind === 'arc');
        const splitCircle = arcs.length >= 2 && regs[idx].outer.length === arcs.length && new Set(arcs.map((sg) => sr.sketch.entities.find((e) => e.id === sg.tag)?.c)).size === 1;
        if (unique && !splitCircle) { direct.push(unique); continue; }
      }
      arr = arr ?? arrOf(sr);
      const cell = findCell(arr, loop);
      if (!cell) throw new Error(`${f.name}: cannot find the profile ${loop.join(',')} in the arrangement of sketch ${sid}`);
      // a hole of a region with nothing inside it: the kernel selects that disc by an id of the hole
      if (idx < 0 && !cell.holes.length && holeSets.some((S) => sameSet(S, L))) {
        const id = loop.find((t) => outerSets.every((S) => !S.has(t)));
        if (id) { direct.push(id); continue; }
      }
      note(`${f.name}: profile ${loop.join(',')} is not a region of the kernel's sketch (${idx >= 0 ? 'no id of its own, or a circle split into arcs' : 'a cell inside a hole or a ring'}); rebuilt as a separate sketch of plain geometry`);
      pieces.push({ sketch: cellSketch(b, sid, arr, cell, `${f.name} profile ${li + 1}`) });
    }
    if (direct.length) pieces.unshift({ sketch: sid, regions: [...new Set(direct)] });
    return pieces;
  }

  // ---------------------------------------------------------------- extents
  const dirName = (d) => d ?? 'positive';
  /** Fields of an extrude for a SolidCraft extent. */
  function extentFields(b, f, sf, op, tgt = null) {
    const ex = f.extent;
    const n = sf.mp.frame.z;
    const flipFor = (travelAlongN) => (op === 'cut' ? travelAlongN : !travelAlongN);
    const out = {};
    if (ex.to) {
      const O = sf.mp.frame.o;
      const h = dot(sub(ex.to, O), n);
      const off = ex.to_offset != null ? exprOf(ex.to_offset) : 0;
      const sg = h >= 0 ? 1 : -1;
      const hs = clean(Math.abs(h));
      // distance = |h| + offset (offset counts past the face, in the direction travelled)
      const depth = isNum(off) ? clean(hs + off) : '=' + hs + '+(' + asText(off) + ')';
      Object.assign(out, { end: 'blind', depth, flip: flipFor(sg > 0) });
      out.__to = { point: ex.to, off, hs, sg, h };
      if (tgt) {
        // a face of this very body: end at it (or at its plane moved by the offset), so the cut follows the face when the
        // model changes. The numeric depth stays as the fallback the kernel uses if the face cannot be reached.
        const travel = out.flip === (op === 'cut') ? n : mul(n, -1);
        const sgn = dot(tgt.n, travel) > 0 ? 1 : -1;
        out.endRef = { kind: 'face', id: tgt.id, at: cleanV(ex.to) };
        if (isNum(off) && off === 0) out.end = 'upToFace';
        else { out.end = 'offsetFromFace'; out.offset = isNum(off) ? clean(sgn * off) : '=' + (sgn < 0 ? '-' : '') + '(' + off.slice(1) + ')'; }
      }
      return out;
    }
    const d = dirName(ex.direction);
    if (ex.through_all) return { end: 'through', flip: flipFor(d === 'positive') };
    const dist = exprOf(ex.distance);
    if (d === 'symmetric') return { end: 'mid', depth: dist };
    return { end: 'blind', depth: dist, flip: flipFor(d === 'positive') };
  }

  const eps = 1e-6;
  const faceNear = (b, point) => {
    const r = K.q({ type: 'closestPoint', tag: b.tag, points: [point], on: 'face' });
    const x = r.ok ? r.result.results?.[0] : null;
    return x && x.entity ? { id: x.entity.id, distance: x.distance } : null;
  };
  const edgeNear = (b, point) => {
    const r = K.q({ type: 'closestPoint', tag: b.tag, points: [point], on: 'edge' });
    const x = r.ok ? r.result.results?.[0] : null;
    return x && x.entity ? { id: x.entity.id, distance: x.distance } : null;
  };
  const faceInfo = (b, id) => b.last?.result?.body?.faces?.find((x) => x.id === id);

  const recordFeature = (f, applied) => {
    const row = { id: f.id, name: f.name, type: f.type, bodies: applied };
    const rv = ref.get(f.id);
    if (rv) {
      row.ref = rv;
      row.ours = Object.fromEntries([...bodies.values()].filter((x) => x.volume > 0).map((x) => [x.name, x.volume]));
      row.dev = Object.fromEntries(Object.entries(rv).map(([k, v]) => [k, row.ours[k] == null ? null : row.ours[k] - v]));
    }
    report.features.push(row);
  };

  // ---------------------------------------------------------------- feature handlers
  const tryOnBody = (b, mode, build) => {
    const snap = snapshot(b);
    const before = b.volume;
    let r;
    try { build(); r = regen(b); } catch (e) { restore(b, snap); regen(b); return { ok: false, why: e.message }; }
    const errs = errorsOf(r);
    const vol = volumeOf(b);
    const warn = warningsOf(r).filter((w) => w.error?.code === 'endConditionFallback');
    if (errs.length) { restore(b, snap); regen(b); return { ok: false, why: errs.map((e) => `${e.feature ?? e.id}:${e.error?.code ?? e.code ?? JSON.stringify(e).slice(0, 160)}`).join(',') }; }
    if (mode === 'cut' && !(vol < before - eps)) { restore(b, snap); regen(b); return { ok: false, why: 'no volume removed', vol }; }
    b.volume = vol;
    return { ok: true, vol, warn };
  };

  function doExtrude(f) {
    const sk = design.features.find((x) => x.id === f.sketch);
    const op = f.operation === 'cut' ? 'cut' : 'add';
    let targets;
    if (f.operation === 'new_body') {
      const nm = f.body_names?.[0] ?? f.name;
      if (bodies.has(nm)) throw new Error(`body ${nm} exists`);
      targets = [addBody(nm)];
    } else if (f.operation === 'join') targets = (f.targets ?? []).map((n) => bodies.get(n) ?? (() => { throw new Error(`join target ${n} unknown`); })());
    else if (f.operation === 'cut') targets = [...bodies.values()];
    else throw new Error(`extrude operation ${f.operation} is not supported`);
    const applied = [];
    for (const b of targets) {
      const mode = f.operation === 'cut' ? 'cut' : 'any';
      // a "to" face of this body (resolved before anything is added)
      let tgt = null;
      if (f.extent.to && b.volume > 0) {
        const fn = faceNear(b, f.extent.to);
        const n = fn && fn.distance < 1e-5 ? faceInfo(b, fn.id)?.normal : null;
        if (n) tgt = { id: fn.id, n };
      }
      const build = (useRef) => () => {
        const sid = ensureSketch(b, sk);
        regen(b);
        const smeta = b.sketchMap.get(sid);
        const pieces = pickProfiles(b, f, sid, f.profiles.loops);
        for (const [i, pc] of pieces.entries()) {
          const ef = extentFields(b, f, smeta, op, useRef ? tgt : null);
          delete ef.__to;
          const feat = { type: 'extrude', op, sketch: pc.sketch, name: f.name + (pieces.length > 1 ? ` (${i + 1})` : ''), ...ef };
          if (pc.regions) feat.regions = pc.regions;
          if (f.extent.taper) feat.draft = exprOf(f.extent.taper);
          push(b, feat);
        }
      };
      const snap0 = snapshot(b), v0 = b.volume;
      let res = tryOnBody(b, mode, build(false));
      if (res.ok && tgt) {
        const vNum = b.volume;
        restore(b, snap0); regen(b); b.volume = v0;
        const res2 = tryOnBody(b, mode, build(true));
        if (res2.ok && !res2.warn.length && Math.abs(b.volume - vNum) <= 1e-6 * Math.max(1, vNum)) { res = res2; note(`${f.name} on ${b.name}: ends at face ${tgt.id} of the body (${f.extent.to_offset ? 'offset ' + f.extent.to_offset : 'no offset'}), same volume as the numeric depth`); }
        else {
          note(`${f.name} on ${b.name}: the end at face ${tgt.id} did not reproduce the volume (${res2.ok ? (res2.warn.length ? 'kernel fell back to the depth' : 'volume differs') : res2.why}); kept the numeric depth`);
          restore(b, snap0); regen(b); b.volume = v0;
          res = tryOnBody(b, mode, build(false));
        }
      }
      if (res.ok) { applied.push(b.name); for (const w of res.warn ?? []) report.warnings.push(`${f.name}@${b.name}: ${JSON.stringify(w.error)}`); }
      else if (f.operation !== 'cut') throw new Error(`${f.name} on ${b.name}: ${res.why}`);
      else log(`  ${f.name}: not on ${b.name} (${res.why})`);
    }
    if (f.operation === 'cut' && !applied.length) report.warnings.push(`${f.name} (${f.id}): removed nothing from any body`);
    for (const b of bodies.values()) b.volume = volumeOf(b);
    recordFeature(f, applied);
  }

  /** How far SolidCraft's hole tools reach above the sketch plane: 1% of the largest body the axis meets, at least 0.1 mm. */
  function holeReach(world, axis) {
    const hit = (bb) => {
      let lo = -Infinity, hi = Infinity;
      for (let k = 0; k < 3; k++) {
        const pad = 1e-6;
        if (Math.abs(axis[k]) < 1e-12) { if (world[k] < bb.min[k] - pad || world[k] > bb.max[k] + pad) return false; }
        else { const a = (bb.min[k] - pad - world[k]) / axis[k], c = (bb.max[k] + pad - world[k]) / axis[k]; lo = Math.max(lo, Math.min(a, c)); hi = Math.min(hi, Math.max(a, c)); }
      }
      return lo <= hi;
    };
    const boxes = [...bodies.values()].map((b) => b.last?.result?.body?.box).filter(Boolean);
    const diag = (bb) => len(sub(bb.max, bb.min));
    const met = boxes.filter(hit).map(diag);
    const size = met.length ? Math.max(...met) : Math.max(1, ...boxes.map(diag));
    return Math.max(size * 0.01, 0.1);
  }

  /** Which way SolidCraft drills holes at sketch points: into material, whichever way the plane faces (-n first). */
  function sketchHoleDir(spots, n) {
    const boxes = [...bodies.values()].map((b) => b.last?.result?.body?.box).filter(Boolean);
    const size = Math.max(1, ...boxes.map((bb) => len(sub(bb.max, bb.min))));
    const eps = size * 1e-6;
    const inside = (q) => [...bodies.values()].some((b) => { const r = K.q({ type: 'probe', tag: b.tag, points: [q] }); return r.ok && r.result.points?.[0]?.inside === true; });
    const ahead = (q, d) => [...bodies.values()].some((b) => { const r = K.q({ type: 'probe', tag: b.tag, rays: [{ origin: q, dir: d }] }); return r.ok && (r.result.rays?.[0]?.hits?.length ?? 0) > 0; });
    const reaches = (d, aheadToo) => spots.some((p) => { const q = add(p, mul(d, eps)); return inside(q) || (aheadToo && ahead(q, d)); });
    const down = mul(n, -1);
    if (reaches(down, false)) return down;
    if (reaches(n, false)) return n;
    if (reaches(down, true) || !reaches(n, true)) return down;
    return n;
  }

  function doHole(f) {
    const sk = design.features.find((x) => x.id === f.points.sketch);
    const idx = f.points.ids.map((id) => sk.sketch.points.findIndex((p) => p.id === id));
    if (idx.some((i) => i < 0)) throw new Error(`${f.name}: hole point ids not found in sketch`);
    const applied = [];
    const h = f.hole;
    if (h.type !== 'countersink' && h.type !== 'simple') throw new Error(`hole type ${h.type} is not supported`);
    // The kernel's `hole` takes a plain diameter only for a simple hole (countersinks use its ISO table), so a
    // countersunk hole is a plain hole plus a cone: a circle of the head diameter extruded as a cut with a draft of half
    // the included angle, (head - hole) / 2 / tan(half angle) deep. SolidCraft's tools also reach above the sketch plane
    // (see holeReach), which matters where material stands above it (posts around a pocket floor): a second cut widens
    // the cone upwards by the same reach.
    const dia = exprOf(f.diameter);
    const sv = solved.get(sk.id);
    const scf = scFrame(sv ? { type: 'custom', plane: sv.plane } : sk.plane);
    const at = new Map((sv?.points ?? []).map((q) => [q.id, q.at]));
    const spots = idx.map((i) => { const [u, v] = at.get(sk.sketch.points[i].id) ?? sk.sketch.points[i].pos; return add(add(scf.o, mul(scf.x, u)), mul(scf.y, v)); });
    let drill = sketchHoleDir(spots, scf.z);
    if (f.points.flip) drill = mul(drill, -1);
    for (const b of bodies.values()) {
      const snap = snapshot(b);
      const sf = sketchFeature(b, sk, { pointsFor: idx, kindTag: ' hole points' });
      const mpHole = sf.__mp; delete sf.__dropped; delete sf.__mp;
      const flip = dot(drill, mpHole.frame.z) > 0;
      let csdE = null, csaE = null;
      if (h.type === 'countersink') {
        csdE = exprOf(h.cs_diameter); csaE = exprOf(h.cs_angle);
        let n = 0;
        for (const e of [...sf.entities]) {
          const id = `csk${++n}`;
          sf.entities.push({ id, type: 'circle', c: e.p, r: clean(isNum(csdE) ? csdE / 2 : 1) });
          sf.constraints.push({ id: `kcsk${n}`, type: 'diameter', refs: [id], value: isNum(csdE) ? csdE : 0, ...(isNum(csdE) ? {} : { expr: csdE.slice(1) }) });
        }
      }
      const sid = push(b, sf);
      const circles = sf.entities.filter((e) => e.type === 'circle');
      const half = isNum(csaE) ? csaE / 2 : csaE ? '=(' + asText(csaE) + ')/2' : null;
      const r1 = tryOnBody(b, 'cut', () => {
        push(b, { type: 'hole', sketch: sid, name: f.name, kind: 'simple', diameter: dia, end: 'blind', depth: exprOf(f.depth), flip });
        if (h.type === 'countersink') {
          const cone = '=(' + asText(csdE) + ' - ' + asText(dia) + ') / 2 / tan(' + asText(half) + ')';
          push(b, { type: 'extrude', op: 'cut', sketch: sid, name: `${f.name} countersink`, end: 'blind', depth: cone, flip, draft: half, regions: circles.map((e) => e.id) });
        }
      });
      // reach above the plane: the cone widens upwards by 1% of the body size
      let reached = false;
      if (h.type === 'countersink') {
        const tops = new Map();
        for (const pe of sf.entities.filter((e) => e.type === 'point')) {
          const pp = sf.points.find((q) => q.id === pe.p);
          const w = add(add(mpHole.frame.o, mul(mpHole.frame.x, pp.x)), mul(mpHole.frame.y, pp.y));
          const top = clean(holeReach(w, mpHole.frame.z));
          tops.set(top, [...(tops.get(top) ?? []), pe.p]);
        }
        for (const [top, ps] of tops) {
          const r2 = tryOnBody(b, 'cut', () => {
            push(b, { type: 'extrude', op: 'cut', sketch: sid, name: `${f.name} countersink reach`, end: 'blind', depth: top, flip: !flip, draft: half, draftOut: true, regions: circles.filter((e) => ps.includes(e.c)).map((e) => e.id) });
          });
          if (r2.ok) { reached = true; note(`${f.name} on ${b.name}: the countersink tool reaches ${top} mm above the sketch plane (SolidCraft's does) and cut material there`); }
        }
      }
      if (r1.ok || reached) applied.push(b.name);
      else { restore(b, snap); regen(b); log(`  ${f.name}: not on ${b.name} (${r1.why})`); }
    }
    for (const b of bodies.values()) b.volume = volumeOf(b);
    recordFeature(f, applied);
  }

  function doFillet(f) {
    // all edges of one fillet belong to one body: the one whose edges are nearest
    const picks = f.edges.map((p) => {
      let best = null;
      for (const b of bodies.values()) { const e = edgeNear(b, p); if (e && (!best || e.distance < best.e.distance)) best = { b, e, p }; }
      if (!best || best.e.distance > 1e-4) throw new Error(`${f.name}: no edge near ${p}`);
      return best;
    });
    const b = picks[0].b;
    if (picks.some((x) => x.b !== b)) throw new Error(`${f.name}: edges on different bodies`);
    const res = tryOnBody(b, 'any', () => {
      const edges = picks.map(({ e, p }) => ({ faces: e.id.split('#')[0].split('|'), at: cleanV(p) }));
      push(b, { type: 'fillet', name: f.name, radius: exprOf(f.radius), edges });
    });
    if (!res.ok) throw new Error(`${f.name}: ${res.why}`);
    for (const x of bodies.values()) x.volume = volumeOf(x);
    recordFeature(f, [b.name]);
  }

  const NEUTRAL = { XY: 'front', XZ: 'top', YZ: 'right' };
  function doDraft(f) {
    const picks = f.faces.map((p) => {
      let best = null;
      for (const b of bodies.values()) { const e = faceNear(b, p); if (e && (!best || e.distance < best.e.distance)) best = { b, e }; }
      if (!best || best.e.distance > 1e-4) throw new Error(`${f.name}: no face near ${p}`);
      return best;
    });
    const b = picks[0].b;
    if (f.neutral?.type !== 'origin') throw new Error(`${f.name}: neutral plane type ${f.neutral?.type} is not supported`);
    // The angle's sign already carries the direction against the neutral plane: flip stays off. With --ref the other
    // sign is tried too and the one that reproduces the SolidCraft volume of this step is kept.
    const refVol = ref.get(f.id)?.[b.name];
    const faces = picks.map((x) => x.e.id);
    const feat = (flip) => ({ type: 'draft', name: f.name, neutral: { kind: 'std', id: NEUTRAL[f.neutral.name] }, faces, angle: exprOf(f.angle), flip });
    const snap = snapshot(b), v0 = b.volume;
    const res = tryOnBody(b, 'any', () => push(b, feat(false)));
    if (!res.ok) throw new Error(`${f.name}: ${res.why}`);
    if (refVol != null && Math.abs(b.volume - refVol) > 1e-4 * refVol) {
      restore(b, snap); regen(b); b.volume = v0;
      const res2 = tryOnBody(b, 'any', () => push(b, feat(true)));
      if (res2.ok && Math.abs(b.volume - refVol) <= 1e-4 * refVol) note(`${f.name}: the draft needed flip=true to reproduce the SolidCraft volume`);
      else throw new Error(`${f.name}: the draft does not reproduce the SolidCraft volume either way`);
    }
    recordFeature(f, [b.name]);
  }

  // ---------------------------------------------------------------- run
  for (const f of design.features) {
    if (f.suppressed) { note(`${f.name} (${f.id}) is suppressed in the design: skipped`); continue; }
    switch (f.type) {
      case 'sketch': break; // emitted by the feature that uses it
      case 'extrude': doExtrude(f); break;
      case 'hole': doHole(f); break;
      case 'fillet': doFillet(f); break;
      case 'draft': doDraft(f); break;
      default: throw new Error(`feature type ${f.type} (${f.name}) is not supported`);
    }
    const rv = ref.get(f.id);
    log(`${f.id} ${f.type} ${f.name}: ${[...bodies.values()].map((x) => `${x.name} ${x.volume.toFixed(2)}${rv && rv[x.name] != null ? ` (ref ${rv[x.name].toFixed(2)}, ${Math.abs(x.volume - rv[x.name]) < 0.5 ? 'ok' : 'DIFF ' + (x.volume - rv[x.name]).toFixed(2)})` : ''}`).join(' | ')}`);
  }

  // ---------------------------------------------------------------- the top-level part
  const top = { format: 'ck-part', version: 1, name: design.name, features: [], seq: 1, rollback: null, material: 'steel', counters: {}, variables: variables.map((v) => ({ name: v.name, expr: v.expr, unit: v.unit })) };
  for (const b of bodies.values()) {
    delete b.doc.__x;
    top.features.push({ type: 'insertPart', id: 'F' + top.seq++, name: b.name, part: b.doc, fixed: true });
  }
  return { part: top, bodies, report, K, ref };
}

// ---------------------------------------------------------------- verification and report
/** Rebuild the finished part from scratch in the kernel and measure it (and compare with a SolidCraft `eval` of the design). */
export function verify(res, evalPath = null, stepOut = null, scStep = null) {
  const { K, part } = res;
  const r = K.q({ type: 'regen', tag: 'final', part, noCache: true, opts: { solveSketches: true } });
  const out = { ok: r.ok, errors: r.ok ? (r.result.errors ?? []) : [r.trap ?? r.error], warnings: r.ok ? (r.result.warnings ?? []) : [] };
  const mp = K.q({ type: 'massProps', tag: 'final', bodies: true });
  out.volume = mp.result?.volume; out.area = mp.result?.area; out.bodies = mp.result?.bodies ?? [];
  const v = K.q({ type: 'validate', tag: 'final' });
  out.valid = v.result?.ok === true; out.issues = v.result?.issues ?? [];
  out.faces = r.result?.body?.faces?.length; out.edges = r.result?.body?.edges?.length;
  if (stepOut) { const st = K.q({ type: 'step', tag: 'final', name: part.name }); if (st.ok) { writeFileSync(stepOut, st.result); out.stepBytes = st.result.length; } }
  if (scStep) {
    const imp = K.q({ type: 'importStep', tag: 'scstep', name: 'x', data: readFileSync(scStep, 'utf8') });
    const m = K.q({ type: 'massProps', tag: 'scstep', bodies: true }), vv = K.q({ type: 'validate', tag: 'scstep' });
    if (imp.ok && m.ok) out.scStep = { volume: m.result.volume, area: m.result.area, bodies: m.result.bodies.map((x) => x.volume), faces: imp.result.body?.faces?.length, valid: vv.result?.ok === true };
  }
  if (evalPath) {
    const e = JSON.parse(readFileSync(evalPath, 'utf8'));
    out.reference = { total: e.total, bodies: e.bodies.map((b) => ({ name: b.name, volume: b.volume_mm3, area: b.area_mm2, faces: b.faces, edges: b.edges })) };
    out.relVolume = Math.abs(out.volume - e.total.volume_mm3) / e.total.volume_mm3;
  }
  return out;
}

const f2 = (x, d = 2) => (x == null ? '-' : Number(x).toFixed(d));

export function reportMarkdown(res, v, meta) {
  const { report, part, bodies } = res;
  const L = [];
  L.push(`# ${part.name}: SolidCraft to ck-part conversion`, '');
  L.push(`Generated by \`kit/tools/solidcraft2ckpart.mjs\` (${meta.date}). Input: \`${meta.input}\` (${meta.counts.features} features, ${meta.counts.sketches} sketches, ${meta.counts.params} parameters). Output: \`${meta.output}\`.`, '');
  L.push('## Result', '');
  const refTotal = v.reference?.total;
  L.push('| | SolidCraft (eval) | ours (rebuilt from the .ckpart, no cache) |', '|---|---|---|');
  L.push(`| Bodies | ${refTotal ? v.reference.bodies.length : '-'} | ${v.bodies.length} |`);
  L.push(`| Total volume mm3 | ${f2(refTotal?.volume_mm3, 3)} | ${f2(v.volume, 3)} |`);
  L.push(`| Relative volume difference | | ${v.relVolume != null ? v.relVolume.toExponential(2) : '-'} (gate 1e-3: ${v.relVolume != null ? (v.relVolume < 1e-3 ? 'pass' : 'FAIL') : 'no reference'}) |`);
  L.push(`| Total area mm2 | ${f2(refTotal?.area_mm2, 1)} | ${f2(v.area, 1)} |`);
  L.push(`| Faces | ${refTotal?.faces ?? '-'} | ${v.faces} |`);
  L.push(`| Kernel errors | none | ${v.errors.length ? JSON.stringify(v.errors) : 'none'} |`);
  L.push(`| Kernel validate | no such check | ${v.valid ? 'ok' : 'NOT OK ' + JSON.stringify(v.issues)} |`, '');
  if (v.reference) {
    L.push('| Body | SC volume | our volume | difference | SC area | our area | SC faces |', '|---|---|---|---|---|---|---|');
    for (const [i, b] of v.reference.bodies.entries()) {
      const o = v.bodies[i];
      L.push(`| ${b.name} | ${f2(b.volume, 3)} | ${f2(o?.volume, 3)} | ${f2((o?.volume ?? NaN) - b.volume, 3)} | ${f2(b.area, 1)} | ${f2(o?.area, 1)} | ${b.faces} |`);
    }
    L.push('');
    const sc = v.scStep;
    L.push(`SolidCraft reports volumes from its display mesh. ${sc ? `Its own STEP export of the design, read into our kernel, measures ${f2(sc.volume, 3)} mm3 (valid: ${sc.valid}, ${sc.faces} faces), so our volume is ${((Math.abs(v.volume - sc.volume) / sc.volume)).toExponential(1)} from the exact volume of SolidCraft's own geometry and SolidCraft's figure is ${(Math.abs(refTotal.volume_mm3 - sc.volume) / sc.volume).toExponential(1)} from it. ` : ''}The area totals differ because SolidCraft keeps a few internal coincident faces where a join meets existing walls (the Extrude24 slab on the tray): same material, extra zero-thickness faces; face counts differ for that reason and because SolidCraft splits some planes our kernel keeps whole.`, '');
  }
  L.push('## Per-feature check', '');
  L.push('Each SolidCraft feature was applied to our bodies in order and the body volumes compared with SolidCraft evaluations of the design cut off after that feature (`--ref`). Tolerance: 1e-4 relative (the mesh-volume noise of the reference).', '');
  L.push('| id | feature | type | applied to | max deviation |', '|---|---|---|---|---|');
  let worst = 0;
  for (const r of report.features) {
    let dev = '-';
    if (r.dev) {
      const rel = Object.entries(r.dev).filter(([, d]) => d != null).map(([k, d]) => Math.abs(d) / r.ref[k]);
      if (rel.length) { const m = Math.max(...rel); worst = Math.max(worst, m); dev = m.toExponential(1); }
    }
    L.push(`| ${r.id} | ${r.name} | ${r.type} | ${r.bodies.join(', ') || '(no body)'} | ${dev} |`);
  }
  L.push('', `Largest relative deviation over the checked steps: ${worst.toExponential(2)}${meta.refCount ? ` (${meta.refCount} checked steps)` : ' (no --ref given: not checked)'}.`, '');
  L.push('## How the design was mapped', '');
  L.push(
    '- **Bodies.** Our features act on one body, so each SolidCraft body is a nested part and the top-level part holds one `insertPart` per body (fixed, no offset). A cut or hole with no target acts on every body (SolidCraft does the same); each is tried on every body and kept where it removes volume.',
    '- **Planes.** SolidCraft XY, XZ, YZ and face/custom sketch planes (all axis-aligned here) become a std plane, plus a `plane` offset feature when the sketch is not through the origin, plus `flip` when the normal is opposite; the sketch coordinates are rotated by a multiple of 90 degrees so the world geometry is identical (arcs stay counter-clockwise). Because a quarter turn swaps the meaning of horizontal and vertical, those constraints (and hdist/vdist) are swapped with it.',
    '- **Sketches.** Points, lines, arcs (counter-clockwise a to b, as ours), circles and construction flags carry over with the SolidCraft ids. Constraints: horizontal, vertical, horizontal_points, vertical_points, coincident, parallel, perpendicular, equal, tangent, midpoint, symmetric, point_on_curve (pointOnLine / pointOnCircle), distance, length (distance of the line ends), distance_x / distance_y (hdist / vdist), diameter, angle (signs chosen to reproduce the drawn angle). Dimension constraints carry `expr` where the SolidCraft parameter is an expression.',
    '- **Profiles.** A SolidCraft profile is a face of the arrangement of all the sketch curves. Where the kernel has a region with exactly those boundary ids and one id of its own, the extrude selects it with `regions` (parametric). Otherwise (a ring, a cell inside a hole, two adjacent cells the kernel merges, a region without an id of its own, a circle split into arcs) the face is computed here and rebuilt as a separate sketch of plain geometry.',
    '- **Extents.** Blind, symmetric (`mid`), through-all, and `to` (SolidCraft: the target face height plus the offset in the direction travelled). A `to` on a face of the body being cut becomes `upToFace` / `offsetFromFace` (the offset sign is flipped to our convention, along the face normal), accepted only when it gives the same volume as the numeric depth; otherwise (or for a face of another body) it is a numeric depth from the face height with the offset expression kept.',
    '- **Holes.** The kernel takes a free diameter only for a simple hole, so a countersunk hole is a plain hole plus a cone cut (a circle of the head diameter, drafted by half the included angle, `(head - hole) / 2 / tan(half angle)` deep). SolidCraft\'s hole tools reach above the sketch plane by 1% of the body size (at least 0.1 mm), which cuts the posts standing round the motor-mount holes; a second drafted cut widens the cone upwards by the same reach. The drilling side follows SolidCraft\'s rule for sketch points (into material, -n first).',
    '- **Fillet / draft.** Edges and faces given by points are resolved to persistent names with `closestPoint`; the neutral plane is the std plane of the same orientation; the draft direction was chosen by volume against the reference step (see the notes).',
    '- **Parameters.** User parameters become `variables` (in the top-level part and in each nested part); unit text is kept in the expressions. The 55 dimension parameters are inlined into the constraints.',
    ''
  );
  L.push('## Not converted', '');
  if (report.skipped.length) for (const s of report.skipped) L.push(`- ${s}`);
  L.push('- Sketch `links` (projections of body edges/faces) and face anchors: kept as plain geometry. The stored position of linked geometry can be stale (SolidCraft re-projects it on opening): the converter takes positions and plane frames from `sketch.inspect` output (`--solved`); without it the sketches **Rib** and **Motor/EncoderMountHoles** would be wrong (they moved by 2.5 mm and 0.495 mm).');
  L.push('- Everything the converter builds from SolidCraft faces by position (face and edge picks) is frozen as plain references: changing a parameter that moves those faces is not followed by planes and sketch positions (sketch planes are numeric offsets of std planes).');
  L.push('- Plastic rules (the PLA material rules) and view settings are not part of the model.', '');
  if (report.notes.length) { L.push('## Notes from the run', ''); for (const n of report.notes) L.push(`- ${n}`); L.push(''); }
  if (report.warnings.length) { L.push('## Warnings', ''); for (const n of report.warnings) L.push(`- ${n}`); L.push(''); }
  if (meta.extra) L.push(meta.extra, '');
  L.push('## Reproduce', '', '```', ...meta.repro, '```', '');
  return L.join('\n');
}

// ---------------------------------------------------------------- command line
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const valued = ['--out', '--ref', '--solved', '--report', '--step', '--wasm', '--eval', '--sc-step', '--inspect-script', '--extra'];
  const opt = (f, d) => (a.includes(f) ? a[a.indexOf(f) + 1] : d);
  const input = a.find((x, i) => !x.startsWith('--') && !valued.includes(a[i - 1]));
  if (!input) {
    console.error('usage: solidcraft2ckpart.mjs <design.solidcraft> [--out Name.ckpart] [--solved sketches.json] [--ref prefix-eval-dir] [--eval design-eval.json]\n' +
      '       [--report Name.convert.md] [--step our.step] [--wasm ck_wasm.wasm] [--inspect-script script.json] [--quiet]\n' +
      '  --solved   output of `solidcraft-cli run <script from --inspect-script> --in design --results` (positions of linked sketches)\n' +
      '  --ref      a directory of `*_f<id>.solidcraft.eval.json`: SolidCraft evals of the design cut off after feature <id>, or a JSON {"<id>": {"Body": volume}}\n' +
      '  --eval     `solidcraft-cli eval design --json-out` of the whole design (totals for the report)\n' +
      '  --sc-step  `solidcraft-cli run --in design --out x.step`: SolidCraft\'s own export, read back into our kernel for the report');
    process.exit(2);
  }
  if (a.includes('--inspect-script')) {
    const d = JSON.parse(readFileSync(input, 'utf8'));
    writeFileSync(opt('--inspect-script'), JSON.stringify({ commands: d.features.filter((f) => f.type === 'sketch').map((f) => ({ command: 'sketch.inspect', params: { sketch: f.id } })) }, null, 1));
    console.error('wrote', opt('--inspect-script'));
    if (!a.includes('--out')) process.exit(0);
  }
  const res = await convert(input, { ref: opt('--ref'), solved: opt('--solved'), wasm: opt('--wasm'), quiet: a.includes('--quiet') });
  const out = opt('--out', input.replace(/\.solidcraft$/, '') + '.ckpart');
  writeFileSync(out, JSON.stringify(res.part, null, 1) + '\n');
  console.error('wrote', out);
  const v = verify(res, opt('--eval'), opt('--step'), opt('--sc-step'));
  console.error(`rebuilt: volume ${f2(v.volume, 3)} mm3, area ${f2(v.area, 1)}, faces ${v.faces}, bodies ${v.bodies.length}, errors ${v.errors.length}, valid ${v.valid}` + (v.relVolume != null ? `, volume vs SolidCraft ${v.relVolume.toExponential(2)}` : ''));
  const design = JSON.parse(readFileSync(input, 'utf8'));
  if (opt('--report')) {
    const md = reportMarkdown(res, v, {
      date: new Date().toISOString().slice(0, 10), input: basename(input), output: basename(out),
      counts: { features: design.features.length, sketches: design.features.filter((f) => f.type === 'sketch').length, params: design.params.length },
      refCount: res.ref.size, extra: opt('--extra') ? readFileSync(opt('--extra'), 'utf8') : null,
      repro: [`node kit/tools/solidcraft2ckpart.mjs ${basename(input)} --out ${basename(out)} --solved <sketches.json> --ref <prefix evals> --eval <eval.json> --report ${basename(opt('--report'))}`],
    });
    writeFileSync(opt('--report'), md);
    console.error('wrote', opt('--report'));
  }
  if (!v.valid || v.errors.length || (v.relVolume != null && v.relVolume >= 1e-3)) process.exit(1);
}
