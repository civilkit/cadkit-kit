// Compact storage of an indexed triangle mesh for files and backups. Pure: no DOM, no kernel, no dependency.
//
// Why: a 500,000 triangle scan as JSON number arrays is about 18 MB, and as base64 of the raw float / uint32 arrays 16 MB. A mesh is
// mostly neighbours of neighbours, so it packs far smaller without a lossy trick that matters for sketching:
//   * vertices are rounded to a grid (`step`, at most 1 micron: 1e-5 of the model size for models under 100 mm, in decades so a
//     second save of a loaded mesh lands on the same grid) and stored as the difference to the previous vertex, zigzag + varint;
//   * triangle corners are stored as the distance below the highest vertex index used so far (0 = the next new vertex), zigzag + varint:
//     a mesh welded in first-use order (what the STL reader and the SketchUp import write) is almost all zeros and ones;
//   * the material of each triangle (SketchUp import) is run-length coded;
//   * the result is deflated (`deflateRaw`, the browser's CompressionStream, off the main thread) and base64'd by the caller.
// Float32 itself carries 6e-8 of relative precision (0.00002 mm at 300 mm), so the grid is coarser than the numbers it replaces, but
// 1 micron is far below anything a sketch or a scan resolves. A mesh with a non-finite coordinate or coordinates beyond +-2e6 grid
// units is stored losslessly instead (`step` 0: the raw float bytes, byte planes apart). Indices and materials are always exact.
//
// Layout of a payload (little endian): 'CKM2' | flags u8 (1 = lossless floats) | 3 pad | nVerts u32 | nTris u32 | step f64 |
// vLen u32 | iLen u32 | mLen u32 | vertex section | index section | material section.

export interface PackArrays { vertices: Float32Array; indices: Uint32Array; /** material id per triangle (optional) */ tm?: Uint16Array }
export interface PackStats { step: number; lossless: boolean; bytes: number }

const MAGIC = [0x43, 0x4b, 0x4d, 0x32];
const HEADER = 36;
/** the finest grid ever used and the coarsest: 1 micron */
export const MESH_STEP_MAX = 1e-3;

export class MeshPackError extends Error {
  constructor(readonly code: 'magic' | 'truncated' | 'range' | 'size') { super(`mesh asset ${code}`); }
}

// ---- varints ----

class Out {
  buf: Uint8Array;
  p = 0;
  constructor(cap: number) { this.buf = new Uint8Array(Math.max(64, cap)); }
  private grow(): void { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
  /** non-negative integer below 2^53 */
  put(z: number): void {
    if (this.p + 10 > this.buf.length) this.grow();
    const b = this.buf;
    if (z < 0x80000000) {
      let v = z | 0;
      while (v >= 0x80) { b[this.p++] = (v & 0x7f) | 0x80; v >>>= 7; }
      b[this.p++] = v;
    } else {
      while (z >= 0x80) { b[this.p++] = (z % 128) | 0x80; z = Math.floor(z / 128); }
      b[this.p++] = z;
    }
  }
  done(): Uint8Array { return this.buf.subarray(0, this.p); }
}
const zig = (d: number): number => (d >= 0 ? d * 2 : -d * 2 - 1);
const unzig = (z: number): number => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);

class In {
  p = 0;
  constructor(readonly buf: Uint8Array, end = buf.length) { this.end = end; }
  readonly end: number;
  get(): number {
    const b = this.buf;
    let v = 0, mul = 1;
    for (let k = 0; k < 8; k++) {
      if (this.p >= this.end) throw new MeshPackError('truncated');
      const c = b[this.p++];
      v += (c & 0x7f) * mul;
      if (c < 0x80) return v;
      mul *= 128;
    }
    throw new MeshPackError('range');
  }
}

// ---- grid ----

/** The grid for coordinates up to `scale` (the larger of the extent and the largest |coordinate|), or 0 when the numbers cannot be gridded. */
export function gridStep(vertices: Float32Array): number {
  let lo = Infinity, hi = -Infinity, abs = 0;
  for (let i = 0; i < vertices.length; i++) {
    const x = vertices[i];
    if (!Number.isFinite(x)) return 0;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
    if (Math.abs(x) > abs) abs = Math.abs(x);
  }
  if (vertices.length === 0) return MESH_STEP_MAX;
  const scale = Math.max(hi - lo, abs);
  const raw = Math.min(MESH_STEP_MAX, scale * 1e-5);
  if (!(raw > 0)) return MESH_STEP_MAX;
  const step = Number('1e' + Math.floor(Math.log10(raw)));   // not Math.pow: pow(10, -5) is 9.999999999999999e-6
  return abs / step > 2e9 ? 0 : step;
}

// ---- encode ----

/** Items of work between two `yield`s of the stepwise coders (about 5 ms): the async forms give the page a turn there. */
const SLICE = 120_000;

function* encodeSteps(m: PackArrays, opts: { step?: number }): Generator<void, { payload: Uint8Array; stats: PackStats }> {
  const nv = m.vertices.length / 3, nt = m.indices.length / 3;
  if (!Number.isInteger(nv) || !Number.isInteger(nt)) throw new MeshPackError('size');
  if (m.tm && m.tm.length !== nt) throw new MeshPackError('size');
  const step = opts.step ?? gridStep(m.vertices);
  // vertices
  let vsec: Uint8Array;
  if (step > 0) {
    const o = new Out(nv * 6 + 16);
    const px = [0, 0, 0];
    const v = m.vertices;
    for (let i = 0; i < nv; i++) {
      for (let c = 0; c < 3; c++) {
        const q = Math.round(v[i * 3 + c] / step);
        o.put(zig(q - px[c]));
        px[c] = q;
      }
      if (i % SLICE === SLICE - 1) yield;
    }
    vsec = o.done();
  } else {
    const n = m.vertices.length, raw = new Uint8Array(m.vertices.buffer, m.vertices.byteOffset, n * 4);
    vsec = new Uint8Array(n * 4);
    for (let b = 0; b < 4; b++) { for (let i = 0; i < n; i++) vsec[b * n + i] = raw[i * 4 + b]; yield; }
  }
  // triangle corners
  const io = new Out(nt * 3 + 16);
  let hwm = 0;
  const ix = m.indices;
  for (let k = 0; k < ix.length; k++) {
    const id = ix[k];
    io.put(zig(hwm - id));
    if (id >= hwm) hwm = id + 1;
    if (k % SLICE === SLICE - 1) yield;
  }
  const isec = io.done();
  // materials
  let msec: Uint8Array = new Uint8Array(0);
  if (m.tm) {
    const mo = new Out(64);
    let run = 0, cur = nt ? m.tm[0] : 0;
    for (let t = 0; t < nt; t++) {
      if (m.tm[t] === cur) run++;
      else { mo.put(cur); mo.put(run); cur = m.tm[t]; run = 1; }
    }
    if (nt) { mo.put(cur); mo.put(run); }
    msec = mo.done();
  }
  const out = new Uint8Array(HEADER + vsec.length + isec.length + msec.length);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  out[4] = step > 0 ? 0 : 1;
  dv.setUint32(8, nv, true); dv.setUint32(12, nt, true); dv.setFloat64(16, step, true);
  dv.setUint32(24, vsec.length, true); dv.setUint32(28, isec.length, true); dv.setUint32(32, msec.length, true);
  out.set(vsec, HEADER); out.set(isec, HEADER + vsec.length); out.set(msec, HEADER + vsec.length + isec.length);
  return { payload: out, stats: { step, lossless: step === 0, bytes: out.length } };
}

/** The payload of a mesh, in one go. */
export function encodeMesh(m: PackArrays, opts: { step?: number } = {}): { payload: Uint8Array; stats: PackStats } {
  const g = encodeSteps(m, opts);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** The same, giving the page a turn between slices of about 5 ms (a 500,000 triangle mesh never holds the main thread for long). */
export async function encodeMeshAsync(m: PackArrays, opts: { step?: number } = {}): Promise<{ payload: Uint8Array; stats: PackStats }> {
  const g = encodeSteps(m, opts);
  for (;;) { const r = g.next(); if (r.done) return r.value; await tick(); }
}

// ---- decode ----

function* decodeSteps(payload: Uint8Array): Generator<void, PackArrays & { step: number }> {
  if (payload.length < HEADER || MAGIC.some((b, i) => payload[i] !== b)) throw new MeshPackError('magic');
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const lossless = (payload[4] & 1) === 1;
  const nv = dv.getUint32(8, true), nt = dv.getUint32(12, true), step = dv.getFloat64(16, true);
  const vl = dv.getUint32(24, true), il = dv.getUint32(28, true), ml = dv.getUint32(32, true);
  if (HEADER + vl + il + ml > payload.length) throw new MeshPackError('truncated');
  if (nv > 0x1fffffff || nt > 0x1fffffff) throw new MeshPackError('size');
  const vertices = new Float32Array(nv * 3);
  if (lossless) {
    if (vl !== nv * 12) throw new MeshPackError('size');
    const n = nv * 3, raw = new Uint8Array(vertices.buffer);
    for (let b = 0; b < 4; b++) { for (let i = 0; i < n; i++) raw[i * 4 + b] = payload[HEADER + b * n + i]; yield; }
  } else {
    if (!(step > 0)) throw new MeshPackError('range');
    const r = new In(payload, HEADER + vl);
    r.p = HEADER;
    const px = [0, 0, 0];
    for (let i = 0; i < nv; i++) {
      for (let c = 0; c < 3; c++) { px[c] += unzig(r.get()); vertices[i * 3 + c] = px[c] * step; }
      if (i % SLICE === SLICE - 1) yield;
    }
  }
  const indices = new Uint32Array(nt * 3);
  {
    const r = new In(payload, HEADER + vl + il);
    r.p = HEADER + vl;
    let hwm = 0;
    for (let k = 0; k < indices.length; k++) {
      const id = hwm - unzig(r.get());
      if (!(id >= 0 && id < nv)) throw new MeshPackError('range');
      indices[k] = id;
      if (id >= hwm) hwm = id + 1;
      if (k % SLICE === SLICE - 1) yield;
    }
  }
  let tm: Uint16Array | undefined;
  if (ml > 0 || nt === 0) {
    if (ml > 0) {
      tm = new Uint16Array(nt);
      const r = new In(payload, HEADER + vl + il + ml);
      r.p = HEADER + vl + il;
      let t = 0;
      while (r.p < r.end) {
        const val = r.get(), run = r.get();
        if (t + run > nt || val > 0xffff) throw new MeshPackError('range');
        tm.fill(val, t, t + run);
        t += run;
      }
      if (t !== nt) throw new MeshPackError('size');
    }
  }
  return { vertices, indices, ...(tm ? { tm } : {}), step: lossless ? 0 : step };
}

export function decodeMesh(payload: Uint8Array): PackArrays & { step: number } {
  const g = decodeSteps(payload);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}
export async function decodeMeshAsync(payload: Uint8Array): Promise<PackArrays & { step: number }> {
  const g = decodeSteps(payload);
  for (;;) { const r = g.next(); if (r.done) return r.value; await tick(); }
}

// ---- integrity ----

/** FNV-1a over the bytes, 32 bit: detects a damaged or cut payload that still inflates. */
export function checksumBytes(b: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
  return h >>> 0;
}

// ---- deflate (the platform's streams; nothing to install) ----

type Pipe = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
type StreamCtor = new (format: string) => Pipe;
const ctor = (name: 'CompressionStream' | 'DecompressionStream'): StreamCtor | undefined => (globalThis as unknown as Record<string, StreamCtor | undefined>)[name];

/** Whether this runtime can deflate and inflate (browsers, Node 18+). */
export const canDeflate = (): boolean => !!ctor('CompressionStream') && !!ctor('DecompressionStream');

async function pipeThrough(data: Uint8Array, t: Pipe, limit: number): Promise<Uint8Array> {
  const w = t.writable.getWriter();
  const writing = w.write(data as BufferSource as Uint8Array).then(() => w.close());
  writing.catch(() => { /* surfaced by the reader */ });
  const rd = t.readable.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { value, done } = await rd.read();
    if (done) break;
    n += value.length;
    if (n > limit) { await rd.cancel().catch(() => {}); throw new MeshPackError('size'); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let p = 0;
  for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}

export async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const C = ctor('CompressionStream');
  if (!C) throw new MeshPackError('size');
  return pipeThrough(data, new C('deflate-raw'), data.length + (data.length >> 2) + 1024);
}
/** `limit`: the size the data must inflate to at most (a damaged or hostile stream cannot grow without bound). */
export async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const D = ctor('DecompressionStream');
  if (!D) throw new MeshPackError('size');
  return pipeThrough(data, new D('deflate-raw'), limit);
}
