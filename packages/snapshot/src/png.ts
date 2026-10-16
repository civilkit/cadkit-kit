// Pure-TS PNG encoder / decoder. Compression goes through CompressionStream / DecompressionStream ('deflate' = zlib
// format, which is exactly what PNG wants), available in Node 18+ and every current browser. If they are missing the
// encoder falls back to stored (uncompressed) deflate blocks, so the API stays async and environment-agnostic.

export interface RgbaImage { width: number; height: number; rgba: Uint8Array | Uint8ClampedArray }

let crcTable: Uint32Array | null = null;
function crc32(b: Uint8Array, start: number, end: number): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pump(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function run(format: 'deflate', Ctor: typeof CompressionStream | typeof DecompressionStream, data: Uint8Array): Promise<Uint8Array> {
  const cs = new Ctor(format);
  const w = cs.writable.getWriter();
  void w.write(data as unknown as BufferSource).catch(() => {});
  void w.close().catch(() => {});
  return pump(cs.readable);
}

function adler32(d: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < d.length; i++) { a = (a + d[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream made of stored blocks: no compression, always available. */
function deflateStored(d: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(d.length / 65535));
  const out = new Uint8Array(2 + d.length + blocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const s = i * 65535, len = Math.min(65535, d.length - s);
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = len & 255; out[o++] = len >> 8; out[o++] = ~len & 255; out[o++] = (~len >> 8) & 255;
    out.set(d.subarray(s, s + len), o); o += len;
  }
  const ad = adler32(d);
  out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 255; out[o++] = (ad >>> 8) & 255; out[o++] = ad & 255;
  return out;
}

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    try { return await run('deflate', CompressionStream, raw); } catch { /* fall through */ }
  }
  return deflateStored(raw);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('png: DecompressionStream is not available in this environment');
  return run('deflate', DecompressionStream, data);
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/** Encode RGBA8 pixels as a PNG (filter 0 on every row: deterministic and fast). */
export async function encodePng(img: RgbaImage): Promise<Uint8Array> {
  const { width: w, height: h } = img;
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set((img.rgba as Uint8Array).subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const z = await deflate(raw);
  const out = new Uint8Array(8 + 25 + 12 + z.length + 12);
  const dv = new DataView(out.buffer);
  out.set(SIG, 0);
  let o = 8;
  const chunk = (type: string, body: Uint8Array) => {
    dv.setUint32(o, body.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(body, o + 8);
    dv.setUint32(o + 8 + body.length, crc32(out, o + 4, o + 8 + body.length));
    o += 12 + body.length;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w); hv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  chunk('IHDR', ihdr);
  chunk('IDAT', z);
  chunk('IEND', new Uint8Array(0));
  return out;
}

/** Decode an 8-bit, non-interlaced PNG (gray, gray+alpha, RGB, RGBA, palette) to RGBA8. */
export async function decodePng(buf: Uint8Array): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) throw new Error('png: bad signature');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8, w = 0, h = 0, ct = 0;
  const idat: Uint8Array[] = [];
  let plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  while (p + 8 <= buf.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8); h = dv.getUint32(p + 12);
      if (buf[p + 16] !== 8 || buf[p + 20] !== 0) throw new Error('png: only 8-bit non-interlaced images are supported');
      ct = buf[p + 17];
    } else if (type === 'IDAT') idat.push(d);
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : ct === 0 || ct === 3 ? 1 : 0;
  if (!bpp) throw new Error('png: unsupported colour type ' + ct);
  let total = 0;
  for (const c of idat) total += c.length;
  const z = new Uint8Array(total);
  let zo = 0;
  for (const c of idat) { z.set(c, zo); zo += c.length; }
  const raw = await inflate(z);
  const stride = w * bpp;
  const rgba = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * bpp;
      if (ct === 6) { rgba[o] = line[s]; rgba[o + 1] = line[s + 1]; rgba[o + 2] = line[s + 2]; rgba[o + 3] = line[s + 3]; }
      else if (ct === 2) { rgba[o] = line[s]; rgba[o + 1] = line[s + 1]; rgba[o + 2] = line[s + 2]; rgba[o + 3] = 255; }
      else if (ct === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = line[s]; rgba[o + 3] = line[s + 1]; }
      else if (ct === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = line[s]; rgba[o + 3] = 255; }
      else {
        const k = line[s];
        rgba[o] = plte?.[k * 3] ?? 0; rgba[o + 1] = plte?.[k * 3 + 1] ?? 0; rgba[o + 2] = plte?.[k * 3 + 2] ?? 0;
        rgba[o + 3] = trns && k < trns.length ? trns[k] : 255;
      }
    }
    prev = line;
  }
  return { width: w, height: h, rgba };
}
