// Minimal ZIP reader (stored + deflate) for FCStd files. Uses the platform DecompressionStream('deflate-raw'), which
// browsers and Node 18+ both have, so no dependency. Entries are returned lazily by name.

export interface ZipEntry { name: string; method: number; compressed: number; size: number; offset: number }

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function zipEntries(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('bad zip directory');
    const nameLen = u16(bytes, p + 28), extra = u16(bytes, p + 30), comment = u16(bytes, p + 32);
    out.push({
      name: new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: u16(bytes, p + 10), compressed: u32(bytes, p + 20), size: u32(bytes, p + 24), offset: u32(bytes, p + 42),
    });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

export async function zipRead(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  const o = e.offset;
  if (u32(bytes, o) !== 0x04034b50) throw new Error('bad zip entry');
  const start = o + 30 + u16(bytes, o + 26) + u16(bytes, o + 28);
  const raw = bytes.subarray(start, start + e.compressed);
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new Error(`zip method ${e.method} not supported`);
  const src = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(raw); c.close(); } });
  const reader = src.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); total += value.length; }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Read one named file from a zip, or null when it is not there. */
export async function zipFile(bytes: Uint8Array, name: string): Promise<Uint8Array | null> {
  const e = zipEntries(bytes).find((x) => x.name === name);
  return e ? zipRead(bytes, e) : null;
}
