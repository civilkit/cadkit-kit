// TEST ONLY: a tiny stand-in for @kit/snapshot so the snapshot tool can be exercised before that package is merged.
// It draws the document's bounding box as a grey rectangle on a white PNG. It is not a renderer.
import { deflateSync } from 'node:zlib';

function crc32(buf: Uint8Array): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
export async function placeholderSnapshot(session: { facts(): Promise<{ box: { min: number[]; max: number[] } | null }> }, opts: Record<string, unknown>): Promise<{ png: Uint8Array; view: string }> {
  const size = Number(opts.size ?? 128);
  const f = await session.facts();
  const raw = new Uint8Array((size * 3 + 1) * size).fill(255);
  for (let y = 0; y < size; y++) raw[y * (size * 3 + 1)] = 0;
  if (f.box) {
    const [w, h] = [f.box.max[0] - f.box.min[0], f.box.max[1] - f.box.min[1]];
    const s = (size * 0.8) / Math.max(w, h, 1e-9);
    const x0 = Math.round(size / 2 - (w * s) / 2), y0 = Math.round(size / 2 - (h * s) / 2);
    for (let y = y0; y < y0 + Math.round(h * s); y++) for (let x = x0; x < x0 + Math.round(w * s); x++) { const o = y * (size * 3 + 1) + 1 + x * 3; raw[o] = raw[o + 1] = raw[o + 2] = 140; }
  }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size); dv.setUint32(4, size); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { png.set(p, o); o += p.length; }
  return { png, view: String(opts.view ?? 'iso') };
}
