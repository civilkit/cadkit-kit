// Clip encoders without DOM or libraries: an animated GIF (median-cut palette, LZW) and a store-only ZIP for a PNG sequence. Video (WebM, MP4) is
// written by the browser's own MediaRecorder in the app, see apps/cad/src/motion/exportClip.ts.

export interface RgbaFrame { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

// ---- GIF ------------------------------------------------------------------------------------------------------------------------------

/** A 256-colour palette from a sample of the frames' pixels (median cut). `bg` is what transparent pixels are drawn over. */
export function medianCutPalette(frames: ReadonlyArray<RgbaFrame>, bg: [number, number, number], max = 256): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  const total = frames.reduce((n, f) => n + f.width * f.height, 0);
  const stride = Math.max(1, Math.floor(total / 60000));
  let k = 0;
  for (const f of frames) for (let i = 0; i < f.width * f.height; i++, k++) {
    if (k % stride) continue;
    pts.push(over(f.data, i * 4, bg));
  }
  if (!pts.length) return [bg];
  let boxes: Array<Array<[number, number, number]>> = [pts];
  while (boxes.length < max) {
    // split the box with the widest channel range
    let bi = -1, bc = 0, br = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
        if (hi - lo > br) { br = hi - lo; bi = i; bc = c; }
      }
    });
    if (bi < 0 || br === 0) break;
    const b = boxes[bi].slice().sort((p, q) => p[bc] - q[bc]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map((b) => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)] as [number, number, number];
  });
}

function over(d: Uint8ClampedArray | Uint8Array, o: number, bg: [number, number, number]): [number, number, number] {
  const a = d[o + 3] / 255;
  return a >= 1 ? [d[o], d[o + 1], d[o + 2]] : [Math.round(d[o] * a + bg[0] * (1 - a)), Math.round(d[o + 1] * a + bg[1] * (1 - a)), Math.round(d[o + 2] * a + bg[2] * (1 - a))];
}

function lzw(indices: Uint8Array, minCode: number): number[] {
  const clear = 1 << minCode, end = clear + 1;
  const out: number[] = [];
  let cur = 0, bits = 0;
  const put = (code: number, n: number) => { cur |= code << bits; bits += n; while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; } };
  let size = minCode + 1, next = end + 1;
  let dict = new Map<number, number>();
  put(clear, size);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = (prefix << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    put(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      put(clear, size);
      dict = new Map();
      size = minCode + 1;
      next = end + 1;
    }
    prefix = c;
  }
  put(prefix, size);
  put(end, size);
  if (bits > 0) out.push(cur & 255);
  return out;
}

/** An animated GIF of equally sized frames, `fps` frames a second, looping forever (`loop` false: once). */
export function encodeGif(frames: ReadonlyArray<RgbaFrame>, o: { fps: number; bg?: [number, number, number]; loop?: boolean }): Uint8Array {
  if (!frames.length) throw new Error('encodeGif: no frames');
  const { width: w, height: h } = frames[0];
  if (frames.some((f) => f.width !== w || f.height !== h)) throw new Error('encodeGif: frames differ in size');
  const bg = o.bg ?? [24, 26, 30];
  const pal = medianCutPalette(frames, bg);
  let bitsPal = 1;
  while ((1 << bitsPal) < pal.length) bitsPal++;
  const nPal = 1 << bitsPal;
  const out: number[] = [];
  const w16 = (v: number) => { out.push(v & 255, (v >> 8) & 255); };
  out.push(...'GIF89a'.split('').map((c) => c.charCodeAt(0)));
  w16(w); w16(h);
  out.push(0x80 | 0x70 | (bitsPal - 1), 0, 0);
  for (let i = 0; i < nPal; i++) out.push(...(pal[i] ?? [0, 0, 0]));
  if (o.loop !== false) out.push(0x21, 0xff, 11, ...'NETSCAPE2.0'.split('').map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0);
  const delay = Math.max(2, Math.round(100 / o.fps));
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r: number, g: number, b: number): number => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (cache[key] >= 0) return cache[key];
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) { const d = (pal[i][0] - r) ** 2 + (pal[i][1] - g) ** 2 + (pal[i][2] - b) ** 2; if (d < bd) { bd = d; best = i; } }
    cache[key] = best;
    return best;
  };
  const minCode = Math.max(2, bitsPal);
  for (const f of frames) {
    out.push(0x21, 0xf9, 4, 0x04, delay & 255, (delay >> 8) & 255, 0, 0);
    out.push(0x2c); w16(0); w16(0); w16(w); w16(h); out.push(0);
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { const [r, g, b] = over(f.data, i * 4, bg); idx[i] = nearest(r, g, b); }
    out.push(minCode);
    const data = lzw(idx, minCode);
    for (let i = 0; i < data.length; i += 255) { const n = Math.min(255, data.length - i); out.push(n); for (let j = 0; j < n; j++) out.push(data[i + j]); }
    out.push(0);
  }
  out.push(0x3b);
  return Uint8Array.from(out);
}

// ---- ZIP (stored, for a PNG sequence) -----------------------------------------------------------------------------------------------

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(d: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** A ZIP of the files, stored without compression (PNG is compressed already). */
export function zipStore(files: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();
  const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255];
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0)]);
    parts.push(head, name, f.data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + f.data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), 0, 0]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
