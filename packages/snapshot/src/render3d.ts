// The 3D panel renderer: CPU z-buffer triangle rasteriser (one fixed directional light plus ambient, Gouraud),
// depth-tested B-rep edges and mesh silhouettes, dashed hidden lines, markers, dimensions and the section overlay.
import { Raster, hatchPolygons, type RGB } from './raster.js';
import { cross, dot, makeCamera, norm, type Camera } from './camera.js';
import { faceLooks, type Finish } from './appearance.js';
import type { Dimension, Frame, Marker, SectionLike, SnapshotInput, StyleName, V3 } from './types.js';

export interface Prepared {
  input: SnapshotInput;
  pos: Float32Array;
  nrm: Float32Array;
  triFace: Int32Array | null;
  nTri: number;
  bbox: { min: V3; max: V3 };
  center: V3;
  radius: number;
  topo?: Topo;
  looks?: TriLooks | null;
}

const cache = new WeakMap<object, Prepared>();

export function prepare(input: SnapshotInput): Prepared {
  const hit = cache.get(input);
  if (hit) return hit;
  const m = input.mesh;
  const pos = m.positions instanceof Float32Array ? m.positions : Float32Array.from(m.positions);
  const nTri = Math.floor(pos.length / 9);
  let nrm: Float32Array;
  if (m.normals && m.normals.length >= nTri * 9) nrm = m.normals instanceof Float32Array ? m.normals : Float32Array.from(m.normals);
  else {
    nrm = new Float32Array(nTri * 9);
    for (let t = 0; t < nTri; t++) {
      const o = t * 9;
      const e1: V3 = [pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2]];
      const e2: V3 = [pos[o + 6] - pos[o], pos[o + 7] - pos[o + 1], pos[o + 8] - pos[o + 2]];
      const n = norm(cross(e1, e2));
      for (let v = 0; v < 3; v++) { nrm[o + v * 3] = n[0]; nrm[o + v * 3 + 1] = n[1]; nrm[o + v * 3 + 2] = n[2]; }
    }
  }
  const tf = m.triFace && m.triFace.length >= nTri ? (m.triFace instanceof Int32Array ? m.triFace : Int32Array.from(m.triFace)) : null;
  let min: V3, max: V3;
  if (input.box && input.box.min.every(isFinite) && input.box.max.every(isFinite) && (nTri === 0 || input.box.max[0] >= input.box.min[0])) { min = [...input.box.min] as V3; max = [...input.box.max] as V3; }
  else {
    min = [Infinity, Infinity, Infinity]; max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i + 2 < pos.length; i += 3) for (let a = 0; a < 3; a++) { const v = pos[i + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
    if (!isFinite(min[0])) { min = [0, 0, 0]; max = [1, 1, 1]; }
  }
  const center: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
  const p: Prepared = { input, pos, nrm, triFace: tf, nTri, bbox: { min, max }, center, radius };
  cache.set(input, p);
  return p;
}

// ---- per-body looks -----------------------------------------------------------------------------------------------

/** Per triangle: colour (0..255), opacity, how metallic (0..1), how glossy (0..1), and whether the body is hidden. null when the input has no appearance. */
export interface TriLooks { rgb: Float32Array; custom: Uint8Array; opacity: Float32Array; metal: Float32Array; gloss: Float32Array; hide: Uint8Array; transparent: number }
const FINISH: Record<Finish, { metal: number; gloss: number }> = {
  matte: { metal: 0, gloss: 0 }, plastic: { metal: 0, gloss: 0.5 }, chrome: { metal: 1, gloss: 1 }, glass: { metal: 0, gloss: 1 }, brushed: { metal: 0.8, gloss: 0.35 },
};
const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function triLooks(p: Prepared): TriLooks | null {
  if (p.looks !== undefined) return p.looks;
  const a = p.input.appearance;
  if (!a || !p.triFace || !p.input.mesh.faceIds || (!a.appearance && !a.faceAppearance && !a.view)) return (p.looks = null);
  const { looks, hidden } = faceLooks(p.input.mesh, p.input.edges ?? [], a);
  if (!looks.size && !hidden.size) return (p.looks = null);
  const ids = p.input.mesh.faceIds;
  const n = p.nTri;
  const out: TriLooks = { rgb: new Float32Array(n * 3), custom: new Uint8Array(n), opacity: new Float32Array(n).fill(1), metal: new Float32Array(n), gloss: new Float32Array(n), hide: new Uint8Array(n), transparent: 0 };
  for (let t = 0; t < n; t++) {
    const name = ids[p.triFace[t]];
    if (hidden.has(name)) { out.hide[t] = 1; continue; }
    const l = looks.get(name);
    if (!l) continue;
    if (l.color) { const c = hexRgb(l.color); out.rgb[t * 3] = c[0]; out.rgb[t * 3 + 1] = c[1]; out.rgb[t * 3 + 2] = c[2]; out.custom[t] = 1; }
    if (l.finish) { out.metal[t] = FINISH[l.finish].metal; out.gloss[t] = FINISH[l.finish].gloss; }
    if (l.opacity !== undefined && l.opacity < 1) { out.opacity[t] = l.opacity; out.transparent++; }
  }
  return (p.looks = out);
}

// ---- silhouette topology ----------------------------------------------------------------------------------------

interface Topo { nE: number; va: Int32Array; vb: Int32Array; t0: Int32Array; t1: Int32Array; verts: Float32Array; fn: Float32Array }

function buildTopo(p: Prepared): Topo {
  const { pos, nTri } = p;
  const q = 65535 / (2 * p.radius);
  const vmap = new Map<number, number>();
  const idx = new Int32Array(nTri * 3);
  const verts: number[] = [];
  for (let i = 0; i < nTri * 3; i++) {
    const x = Math.round((pos[i * 3] - p.bbox.min[0]) * q), y = Math.round((pos[i * 3 + 1] - p.bbox.min[1]) * q), z = Math.round((pos[i * 3 + 2] - p.bbox.min[2]) * q);
    const key = (x * 65536 + y) * 65536 + z;
    let v = vmap.get(key);
    if (v === undefined) { v = verts.length / 3; vmap.set(key, v); verts.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    idx[i] = v;
  }
  const nv = verts.length / 3;
  const fn = new Float32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const e1: V3 = [pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2]];
    const e2: V3 = [pos[o + 6] - pos[o], pos[o + 7] - pos[o + 1], pos[o + 8] - pos[o + 2]];
    const n = norm(cross(e1, e2));
    fn[t * 3] = n[0]; fn[t * 3 + 1] = n[1]; fn[t * 3 + 2] = n[2];
  }
  const emap = new Map<number, number>();
  const va: number[] = [], vb: number[] = [], t0: number[] = [], t1: number[] = [];
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k], b = idx[t * 3 + ((k + 1) % 3)];
      if (a === b) continue;
      const key = Math.min(a, b) * nv + Math.max(a, b);
      const e = emap.get(key);
      if (e === undefined) { emap.set(key, va.length); va.push(a); vb.push(b); t0.push(t); t1.push(-1); }
      else if (t1[e] === -1) t1[e] = t; else t1[e] = -2;
    }
  }
  return { nE: va.length, va: Int32Array.from(va), vb: Int32Array.from(vb), t0: Int32Array.from(t0), t1: Int32Array.from(t1), verts: Float32Array.from(verts), fn };
}

// ---- panel ----------------------------------------------------------------------------------------------------------

export interface PanelOpts {
  w: number; h: number; ss: number;
  dir: V3; upv: V3; persp: boolean;
  style: StyleName;
  /** pinned framing: sphere fit around frame, or an explicit px-per-mm scale about frame.center */
  frame?: Frame; scale?: number;
  /** fraction of the panel the model should fill when not pinned */
  fill?: number;
  bg: RGB;
  markers?: Marker[]; annotate?: Dimension[];
  highlight?: Set<string>;
  section?: SectionLike;
  dims?: boolean;
  label?: string;
  /** draw the document's per-body appearance (default true; only the shaded and edges styles use it) */
  looks?: boolean;
}

export interface PanelResult { raster: Raster; camera: Camera; frame: Frame; ms: number }

const BASE: RGB = [170, 184, 204];
const HILITE: RGB = [255, 150, 40];
const INK: RGB = [38, 46, 58];
const HIDDEN: RGB = [130, 136, 146];
const ACCENT: RGB = [205, 40, 40];

export function renderPanel(p: Prepared, o: PanelOpts): PanelResult {
  const t0 = Date.now();
  const { w, h, ss } = o;
  const W = w * ss, H = h * ss;
  const bbox = p.bbox;
  const corners: V3[] = [];
  for (let i = 0; i < 8; i++) corners.push([i & 1 ? bbox.max[0] : bbox.min[0], i & 2 ? bbox.max[1] : bbox.min[1], i & 4 ? bbox.max[2] : bbox.min[2]]);

  // framing
  const center = o.frame?.center ?? p.center;
  const radius = o.frame?.radius ?? p.radius;
  let scale: number, px = w / 2, py = h / 2;
  if (o.scale !== undefined) scale = o.scale;
  else if (o.frame) scale = (0.46 * Math.min(w, h)) / radius;
  else {
    const probe = makeCamera({ dir: o.dir, upv: o.upv, center, radius, persp: false, scale: 1, px: 0, py: 0 });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const out = new Float64Array(3);
    for (const c of corners) { probe.project(c, out); x0 = Math.min(x0, out[0]); x1 = Math.max(x1, out[0]); y0 = Math.min(y0, out[1]); y1 = Math.max(y1, out[1]); }
    const ex = Math.max(x1 - x0, 1e-9), ey = Math.max(y1 - y0, 1e-9);
    const fill = (o.fill ?? 0.86) * (o.persp ? 0.9 : 1);
    scale = fill * Math.min(w / ex, h / ey);
    px = w / 2 - ((x0 + x1) / 2) * scale; py = h / 2 - ((y0 + y1) / 2) * scale;
  }
  const cam = makeCamera({ dir: o.dir, upv: o.upv, center, radius, persp: o.persp, scale: scale * ss, px: px * ss, py: py * ss });

  const color = new Raster(W, H, o.bg);
  const z = new Float32Array(W * H).fill(-Infinity);
  const style = o.style;

  // project all vertices once
  const nv = p.nTri * 3;
  const pv = new Float64Array(nv * 3);
  const ok = new Uint8Array(nv);
  const tmp = new Float64Array(3);
  for (let i = 0; i < nv; i++) {
    if (cam.projectXYZ(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2], tmp)) { ok[i] = 1; pv[i * 3] = tmp[0]; pv[i * 3 + 1] = tmp[1]; pv[i * 3 + 2] = tmp[2]; }
  }
  // fixed light, in camera space: from the viewer's upper left, a little in front
  const L = norm([cam.right[0] * -0.4 + cam.upv[0] * 0.6 + cam.dir[0] * 0.7, cam.right[1] * -0.4 + cam.upv[1] * 0.6 + cam.dir[1] * 0.7, cam.right[2] * -0.4 + cam.upv[2] * 0.6 + cam.dir[2] * 0.7]);
  const hiTri = new Uint8Array(p.nTri);
  if (o.highlight && o.highlight.size && p.triFace && p.input.mesh.faceIds) {
    const ids = p.input.mesh.faceIds;
    for (let t = 0; t < p.nTri; t++) { const f = p.triFace[t]; if (f >= 0 && o.highlight.has(ids[f])) hiTri[t] = 1; }
  }
  const mono = style === 'mono';
  const xray = style === 'xray';
  const depthOnly = style === 'hidden-line';
  const base = mono ? ([188, 188, 188] as RGB) : BASE;
  const lk = o.looks !== false && (style === 'shaded' || style === 'edges') ? triLooks(p) : null;
  const tc = new Float64Array(3);
  const pos = p.pos, nrm = p.nrm;
  const glass: number[] = [];   // transparent triangles, drawn after the opaque ones, farthest first
  const glassDepth: number[] = [];
  const cc: RGB = [0, 0, 0];
  const shade = (t: number): boolean => {
    const v0 = t * 3;
    if (!ok[v0] || !ok[v0 + 1] || !ok[v0 + 2]) return false;
    const x0 = pv[v0 * 3], y0 = pv[v0 * 3 + 1], x1 = pv[v0 * 3 + 3], y1 = pv[v0 * 3 + 4], x2 = pv[v0 * 3 + 6], y2 = pv[v0 * 3 + 7];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area > -1e-9 && area < 1e-9) return false;
    const metal = lk ? lk.metal[t] : 0, gloss = lk ? lk.gloss[t] : 0;
    for (let k = 0; k < 3; k++) {
      const o9 = t * 9 + k * 3;
      let nx = nrm[o9], ny = nrm[o9 + 1], nz = nrm[o9 + 2];
      let vx = cam.dir[0], vy = cam.dir[1], vz = cam.dir[2];
      if (o.persp) { vx = cam.center[0] + cam.dir[0] * cam.dist - pos[o9]; vy = cam.center[1] + cam.dir[1] * cam.dist - pos[o9 + 1]; vz = cam.center[2] + cam.dir[2] * cam.dist - pos[o9 + 2]; const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l; }
      let nv_ = nx * vx + ny * vy + nz * vz;
      if (nv_ < 0) { nx = -nx; ny = -ny; nz = -nz; nv_ = -nv_; }
      const nl = nx * L[0] + ny * L[1] + nz * L[2];
      let I = 0.3 + 0.5 * (nl > 0 ? nl : 0) + 0.2 * nv_;
      if (I > 1) I = 1;
      if (gloss > 0 || metal > 0) {
        // mirror direction of the view ray about the normal: a sky above, a dark horizon line and a lighter ground; the key light adds a highlight
        const rx = 2 * nv_ * nx - vx, ry = 2 * nv_ * ny - vy, rz = 2 * nv_ * nz - vz;
        const ru = rx * cam.upv[0] + ry * cam.upv[1] + rz * cam.upv[2];
        const sp = Math.max(0, rx * L[0] + ry * L[1] + rz * L[2]);
        const env = 0.3 + 0.5 * Math.min(1, Math.max(0, (ru + 0.25) / 1.1)) - 0.45 * Math.exp(-ru * ru / 0.03);
        const spec = Math.pow(sp, 6 + 40 * gloss) * (0.25 + 0.75 * gloss);
        I = I * (1 - metal) + (env + 0.9 * spec) * metal + (1 - metal) * spec * 0.5;
      }
      tc[k] = I;
    }
    return true;
  };
  for (let t = 0; t < p.nTri; t++) {
    if (lk && lk.hide[t]) continue;
    if (lk && lk.opacity[t] < 1) {
      if (!ok[t * 3] || !ok[t * 3 + 1] || !ok[t * 3 + 2]) continue;
      glass.push(t); glassDepth.push((pv[t * 9 + 2] + pv[t * 9 + 5] + pv[t * 9 + 8]) / 3);
      continue;
    }
    if (!shade(t)) continue;
    const v0 = t * 3;
    const x0 = pv[v0 * 3], y0 = pv[v0 * 3 + 1], n0 = pv[v0 * 3 + 2];
    const x1 = pv[v0 * 3 + 3], y1 = pv[v0 * 3 + 4], n1 = pv[v0 * 3 + 5];
    const x2 = pv[v0 * 3 + 6], y2 = pv[v0 * 3 + 7], n2 = pv[v0 * 3 + 8];
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    let c: RGB = base;
    if (hiTri[t]) c = HILITE; else if (lk && lk.custom[t]) { cc[0] = lk.rgb[t * 3]; cc[1] = lk.rgb[t * 3 + 1]; cc[2] = lk.rgb[t * 3 + 2]; c = cc; }
    fillTri(color, z, W, H, x0, y0, n0, tc[0], x1, y1, n1, tc[1], x2, y2, n2, tc[2], c, area, depthOnly, xray, 1);
  }
  if (glass.length) {
    // the transparent pass: depth-tested against the opaque faces, no depth writes, blended farthest first; a clear body shows a rim (Fresnel)
    const order = glass.map((_, i) => i).sort((a, b) => glassDepth[a] - glassDepth[b]);
    for (const i of order) {
      const t = glass[i];
      if (!shade(t)) continue;
      const v0 = t * 3;
      const x0 = pv[v0 * 3], y0 = pv[v0 * 3 + 1], n0 = pv[v0 * 3 + 2];
      const x1 = pv[v0 * 3 + 3], y1 = pv[v0 * 3 + 4], n1 = pv[v0 * 3 + 5];
      const x2 = pv[v0 * 3 + 6], y2 = pv[v0 * 3 + 7], n2 = pv[v0 * 3 + 8];
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      const o9 = t * 9;
      const facing = Math.abs(nrm[o9] * cam.dir[0] + nrm[o9 + 1] * cam.dir[1] + nrm[o9 + 2] * cam.dir[2]);
      const a0 = lk!.opacity[t];
      const alpha = Math.min(1, a0 + (1 - a0) * 0.55 * Math.pow(1 - Math.min(1, facing), 3));
      const c: RGB = lk!.custom[t] ? [lk!.rgb[t * 3], lk!.rgb[t * 3 + 1], lk!.rgb[t * 3 + 2]] : [190, 205, 220];
      fillTri(color, z, W, H, x0, y0, n0, tc[0], x1, y1, n1, tc[1], x2, y2, n2, tc[2], c, area, false, false, alpha);
    }
  }

  // edges: B-rep polylines then mesh silhouettes
  const wEdge = (style === 'edges' ? 1.7 : style === 'hidden-line' ? 1.4 : 1.1) * ss;
  const drawEdges = style !== 'mono';
  if (drawEdges) {
    const vis: RGB = style === 'xray' ? [30, 70, 130] : INK;
    const hid: RGB | null = style === 'hidden-line' ? HIDDEN : null;
    const a = xray ? 0.75 : 1;
    const A = new Float64Array(3), B = new Float64Array(3);
    for (const pass of hid ? [1, 2] : [0]) for (const e of p.input.edges ?? []) {
      const pts = e.pts;
      let s = 0;
      let okA = pts.length > 0 && cam.project(pts[0], A);
      for (let i = 1; i < pts.length; i++) {
        const okB = cam.project(pts[i], B);
        if (okA && okB) {
          s += zLine(color, z, W, H, A[0], A[1], A[2], B[0], B[1], B[2], wEdge, vis, hid, 6 * ss, 4 * ss, s, cam.bias, a, !xray, pass);
        }
        A.set(B); okA = okB;
      }
    }
    {
      const topo = p.topo ?? (p.topo = buildTopo(p));
      const eyeV = (vx: number, vy: number, vz: number): V3 => (o.persp ? norm([cam.center[0] + cam.dir[0] * cam.dist - vx, cam.center[1] + cam.dir[1] * cam.dist - vy, cam.center[2] + cam.dir[2] * cam.dist - vz]) : cam.dir);
      for (let e = 0; e < topo.nE; e++) {
        const t1 = topo.t1[e];
        if (t1 < 0) continue;
        const ta = topo.va[e] * 3, tb = topo.vb[e] * 3;
        const va = topo.verts;
        const ev = o.persp ? eyeV((va[ta] + va[tb]) / 2, (va[ta + 1] + va[tb + 1]) / 2, (va[ta + 2] + va[tb + 2]) / 2) : cam.dir;
        const f0 = topo.t0[e] * 3;
        const s0 = topo.fn[f0] * ev[0] + topo.fn[f0 + 1] * ev[1] + topo.fn[f0 + 2] * ev[2];
        const s1 = topo.fn[t1 * 3] * ev[0] + topo.fn[t1 * 3 + 1] * ev[1] + topo.fn[t1 * 3 + 2] * ev[2];
        if (!(s0 * s1 < 0)) continue;
        if (!cam.project([va[ta], va[ta + 1], va[ta + 2]], A) || !cam.project([va[tb], va[tb + 1], va[tb + 2]], B)) continue;
        zLine(color, z, W, H, A[0], A[1], A[2], B[0], B[1], B[2], wEdge * 1.1, vis, null, 0, 0, 0, cam.bias * 2, a, !xray);
      }
    }
  }

  const out = color.downsample(ss);
  overlays(out, cam, o, ss, z, W, p.bbox);
  const cam1 = makeCamera({ dir: o.dir, upv: o.upv, center, radius, persp: o.persp, scale, px, py });
  return { raster: out, camera: cam1, frame: { center, radius }, ms: Date.now() - t0 };
}

function overlays(r: Raster, cam: Camera, o: PanelOpts, ss: number, z: Float32Array, W: number, bbox: { min: V3; max: V3 }): void {
  const A = new Float64Array(3), B = new Float64Array(3);
  const s1 = (p: V3, out: Float64Array) => { const ok = cam.project(p, out); out[0] /= ss; out[1] /= ss; return ok; };

  // section overlay: hatched cut face and outline, projected from the exact loops
  const sec = o.section;
  if (sec) {
    const polys: Array<Array<[number, number]>> = [];
    for (const lp of sec.loops) {
      const poly: Array<[number, number]> = [];
      for (const [u, v] of lp.pts) {
        const q: V3 = [sec.frame.o[0] + sec.frame.x[0] * u + sec.frame.y[0] * v, sec.frame.o[1] + sec.frame.x[1] * u + sec.frame.y[1] * v, sec.frame.o[2] + sec.frame.x[2] * u + sec.frame.y[2] * v];
        if (s1(q, A)) poly.push([A[0], A[1]]);
      }
      if (poly.length > 2) polys.push(poly);
    }
    hatchPolygons(r, polys, [200, 70, 20], 5, 1, 0.9, [255, 170, 60], 0.25);
    for (const poly of polys) r.polyline(poly, [200, 70, 20], 1.8, true);
  }

  // dimensions of the bounding rectangle for drawings
  if (o.dims) drawBoxDims(r, cam, bbox, ss);

  for (const d of o.annotate ?? []) {
    if (!s1(d.from, A) || !s1(d.to, B)) continue;
    const len = Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1], d.to[2] - d.from[2]);
    dimLine(r, A[0], A[1], B[0], B[1], d.label ?? fmtMm(len), ACCENT);
  }

  for (const m of o.markers ?? []) {
    if (!s1(m.p, A)) continue;
    const col = m.color ?? ACCENT;
    // occluded (or inside the material) markers are drawn dashed
    const zi = Math.min(z.length - 1, Math.max(0, Math.round(A[1] * ss)) * W + Math.max(0, Math.round(A[0] * ss)));
    cam.project(m.p, B);
    const hidden = o.style !== 'xray' && z[zi] > -Infinity && B[2] + 2 * cam.bias < z[zi];
    r.circle(A[0], A[1], 7, col, 1.6, 1, hidden);
    r.line(A[0] - 11, A[1], A[0] - 3, A[1], col, 1.4); r.line(A[0] + 3, A[1], A[0] + 11, A[1], col, 1.4);
    r.line(A[0], A[1] - 11, A[0], A[1] - 3, col, 1.4); r.line(A[0], A[1] + 3, A[0], A[1] + 11, col, 1.4);
    if (m.label) r.text(A[0] + 12, A[1] - 12, m.label, col, 2, [255, 255, 255]);
  }

  if (o.label) r.text(8, 8, o.label, [20, 24, 32], 2, [255, 255, 255]);
}

export const fmtMm = (v: number): string => {
  const s = (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

/** Dimension line with end ticks and a label on a plate at the middle. */
export function dimLine(r: Raster, x0: number, y0: number, x1: number, y1: number, label: string, c: RGB): void {
  r.line(x0, y0, x1, y1, c, 1.3);
  const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  for (const [x, y] of [[x0, y0], [x1, y1]]) { r.line(x - nx * 5, y - ny * 5, x + nx * 5, y + ny * 5, c, 1.3); r.line(x - nx * 4 - (dx / l) * 4, y - ny * 4 - (dy / l) * 4, x + nx * 4 + (dx / l) * 4, y + ny * 4 + (dy / l) * 4, c, 1); }
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  r.text(Math.round(mx - (label.length * 6 * 2 - 2) / 2), Math.round(my - 7), label, c, 2, [255, 255, 255]);
}

function drawBoxDims(r: Raster, cam: Camera, bb: { min: V3; max: V3 }, ss: number): void {
  const out = new Float64Array(3);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    cam.project([i & 1 ? bb.max[0] : bb.min[0], i & 2 ? bb.max[1] : bb.min[1], i & 4 ? bb.max[2] : bb.min[2]], out);
    const x = out[0] / ss, y = out[1] / ss;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const sc = cam.scale / ss;
  rectDims(r, x0, y0, x1, y1, (x1 - x0) / sc, (y1 - y0) / sc);
}

/** Overall width (below) and height (right) dimension lines of a screen rectangle, with extension lines. */
export function rectDims(r: Raster, x0: number, y0: number, x1: number, y1: number, wmm: number, hmm: number): void {
  const c: RGB = [20, 70, 160];
  const yb = y1 + 22, xr = x1 + 22;
  r.line(x0, y1 + 3, x0, yb + 5, c, 1); r.line(x1, y1 + 3, x1, yb + 5, c, 1);
  dimLine(r, x0, yb, x1, yb, fmtMm(wmm), c);
  r.line(x1 + 3, y0, xr + 5, y0, c, 1); r.line(x1 + 3, y1, xr + 5, y1, c, 1);
  dimLine(r, xr, y0, xr, y1, fmtMm(hmm), c);
}

// ---- inner loops ---------------------------------------------------------------------------------------------------

function fillTri(r: Raster, z: Float32Array, W: number, H: number, x0: number, y0: number, n0: number, i0: number, x1: number, y1: number, n1: number, i1: number, x2: number, y2: number, n2: number, i2: number, c: RGB, area: number, depthOnly: boolean, xray: boolean, alpha = 1): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  if (minX > maxX || minY > maxY) return;
  const inv = 1 / area;
  const d = r.data;
  const eps = -1e-7;
  // barycentrics, depth and intensity are linear in screen space: step them along the row
  const dw0 = (y1 - y2) * inv, dw1 = (y2 - y0) * inv;
  const dn = dw0 * (n0 - n2) + dw1 * (n1 - n2), di = dw0 * (i0 - i2) + dw1 * (i1 - i2);
  const px0 = minX + 0.5;
  const cr = c[0], cg = c[1], cb = c[2];
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    let w0 = ((x1 - px0) * (y2 - py) - (x2 - px0) * (y1 - py)) * inv;
    let w1 = ((x2 - px0) * (y0 - py) - (x0 - px0) * (y2 - py)) * inv;
    let n = n2 + w0 * (n0 - n2) + w1 * (n1 - n2);
    let I = i2 + w0 * (i0 - i2) + w1 * (i1 - i2);
    let entered = false;
    let idx = y * W + minX;
    for (let x = minX; x <= maxX; x++, idx++, w0 += dw0, w1 += dw1, n += dn, I += di) {
      if (w0 < eps || w1 < eps || 1 - w0 - w1 < eps) { if (entered) break; continue; }
      entered = true;
      const o4 = idx * 4;
      if (xray) {
        const a = 0.14;
        d[o4] = d[o4] + (cr * I - d[o4]) * a + 0.5; d[o4 + 1] = d[o4 + 1] + (cg * I - d[o4 + 1]) * a + 0.5; d[o4 + 2] = d[o4 + 2] + (cb * I - d[o4 + 2]) * a + 0.5;
        continue;
      }
      if (n <= z[idx]) continue;
      if (alpha < 1) {
        // blended over what is there; the depth buffer is left alone
        d[o4] = d[o4] + (Math.min(255, cr * I) - d[o4]) * alpha + 0.5; d[o4 + 1] = d[o4 + 1] + (Math.min(255, cg * I) - d[o4 + 1]) * alpha + 0.5; d[o4 + 2] = d[o4 + 2] + (Math.min(255, cb * I) - d[o4 + 2]) * alpha + 0.5; d[o4 + 3] = 255;
        continue;
      }
      z[idx] = n;
      if (depthOnly) { d[o4] = 252; d[o4 + 1] = 252; d[o4 + 2] = 252; d[o4 + 3] = 255; continue; }
      d[o4] = Math.min(255, cr * I + 0.5); d[o4 + 1] = Math.min(255, cg * I + 0.5); d[o4 + 2] = Math.min(255, cb * I + 0.5); d[o4 + 3] = 255;
    }
  }
}

/** Depth-tested anti-aliased line; hidden parts drawn dashed in `hid` (or not at all). Returns its screen length. */
function zLine(r: Raster, z: Float32Array, W: number, H: number, x0: number, y0: number, n0: number, x1: number, y1: number, n1: number, w: number, vis: RGB, hid: RGB | null, dOn: number, dOff: number, s0: number, bias: number, alpha: number, test: boolean, pass = 0): number {
  const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
  const hw = w / 2 + 0.5;
  const ya = Math.max(0, Math.floor(Math.min(y0, y1) - hw)), yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + hw));
  const d = r.data;
  for (let y = ya; y <= yb; y++) {
    // x extent of the segment inside this row's band (long diagonal edges must not scan their whole bounding box)
    let xl: number, xr: number;
    if (Math.abs(dy) < 1e-9) { xl = Math.min(x0, x1); xr = Math.max(x0, x1); }
    else {
      const ta = Math.min(1, Math.max(0, (y - hw - y0) / dy)), tb = Math.min(1, Math.max(0, (y + 1 + hw - y0) / dy));
      const xa_ = x0 + ta * dx, xb_ = x0 + tb * dx;
      xl = Math.min(xa_, xb_); xr = Math.max(xa_, xb_);
    }
    const xa = Math.max(0, Math.floor(xl - hw)), xb = Math.min(W - 1, Math.ceil(xr + hw));
    for (let x = xa; x <= xb; x++) {
    const px = x + 0.5, py = y + 0.5;
    let t = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x0 + t * dx - px, ey = y0 + t * dy - py;
    let cov = w / 2 + 0.5 - Math.sqrt(ex * ex + ey * ey);
    if (cov <= 0) continue;
    if (cov > 1) cov = 1;
    const idx = y * W + x;
    let c = vis;
    if (test) {
      const n = n0 + t * (n1 - n0);
      if (n + bias < z[idx]) {
        if (!hid || pass === 2) continue;
        if ((s0 + t * len) % (dOn + dOff) >= dOn) continue;
        c = hid;
      } else if (pass === 1) continue;
    }
    const a = cov * alpha, o4 = idx * 4;
    d[o4] = d[o4] + (c[0] - d[o4]) * a + 0.5; d[o4 + 1] = d[o4 + 1] + (c[1] - d[o4 + 1]) * a + 0.5; d[o4 + 2] = d[o4 + 2] + (c[2] - d[o4 + 2]) * a + 0.5; d[o4 + 3] = 255;
    }
  }
  return len;
}

export { cross, dot };
