// A minimal ZIP writer (stored or deflate) and reader, by hand: no dependency. Deflate uses the platform's
// CompressionStream('deflate-raw'), which browsers and Node 18+ have; where it is missing the entries are stored.

export interface ZipFile { name: string; data: Uint8Array }

let crcTable: Uint32Array | null = null;
export function crc32(b: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function pump(data: Uint8Array, ts: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Uint8Array> {
  const w = ts.writable.getWriter();
  void w.write(data).then(() => w.close());
  const r = ts.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); total += value.length; }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const hasDeflate = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Zip the files. `deflate` (default true) compresses an entry when that makes it smaller; otherwise it is stored. */
export async function zipWrite(files: readonly ZipFile[], opts: { deflate?: boolean } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const deflate = (opts.deflate ?? true) && hasDeflate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    let method = 0, body = f.data;
    if (deflate && f.data.length > 64) {
      const d = await pump(f.data, new CompressionStream('deflate-raw') as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> });
      if (d.length < f.data.length) { method = 8; body = d; }
    }
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);   // time 00:00:00, date 1980-01-01 (a fixed stamp keeps the file reproducible)
    lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
    ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

/** Read every entry of a zip written by `zipWrite` (or any stored / deflate zip) and check each CRC. */
export async function zipRead(bytes: Uint8Array): Promise<ZipFile[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: ZipFile[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip directory');
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nl));
    if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('bad zip entry');
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = bytes.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await pump(raw, new DecompressionStream('deflate-raw') as unknown as { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> });
    else throw new Error(`zip method ${method} not supported`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`zip entry ${name} is corrupt`);
    out.push({ name, data });
    p += 46 + nl + el + cl;
  }
  return out;
}
