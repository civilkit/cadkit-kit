// Hardened, zero-dependency ZIP reader (stored + deflate-raw) for Fusion 360 .f3d / .f3z archives.
// Validates all offsets and lengths so truncated, corrupt, or encrypted archives fail cleanly with
// plain-English errors rather than out-of-bounds reads or crashes.

export interface F3dZipEntry {
  name: string;
  method: number;
  flags: number;
  compressed: number;
  size: number;
  offset: number;
  encrypted: boolean;
}

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number): number =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Quick check for ZIP local-file or empty-archive signature. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.length < 22) return false;
  const sig = u32(bytes, 0);
  return sig === 0x04034b50 || sig === 0x06054b50 || sig === 0x08074b50;
}

/** List all entries in a ZIP archive. Throws a descriptive Error on invalid or truncated ZIP data. */
export function zipEntries(bytes: Uint8Array): F3dZipEntry[] {
  if (bytes.length < 22) throw new Error('archive is too small to be a valid ZIP file');
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a valid ZIP archive (missing end-of-central-directory record)');

  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  let p = u32(bytes, eocd + 16);

  if (count === 0xffff || p === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported');
  }
  if (p > bytes.length || p + cdSize > bytes.length) {
    throw new Error('ZIP central directory is truncated or out of bounds');
  }

  const dec = new TextDecoder();
  const out: F3dZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length) throw new Error('ZIP central directory entry is truncated');
    if (u32(bytes, p) !== 0x02014b50) throw new Error('corrupt ZIP central directory header');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressed = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > bytes.length) {
      throw new Error('ZIP central directory entry extends past end of file');
    }
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    out.push({
      name,
      method,
      flags,
      compressed,
      size,
      offset,
      encrypted: (flags & 0x0001) !== 0,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Extract one entry's bytes from a ZIP archive. */
export async function zipRead(bytes: Uint8Array, e: F3dZipEntry): Promise<Uint8Array> {
  if (e.encrypted) throw new Error(`entry "${e.name}" is password-protected / encrypted`);
  const o = e.offset;
  if (o + 30 > bytes.length) throw new Error(`entry "${e.name}" header is truncated`);
  if (u32(bytes, o) !== 0x04034b50) throw new Error(`entry "${e.name}" has a corrupt local file header`);
  const nameLen = u16(bytes, o + 26);
  const extraLen = u16(bytes, o + 28);
  const start = o + 30 + nameLen + extraLen;
  const end = start + e.compressed;
  if (end > bytes.length) throw new Error(`entry "${e.name}" data is truncated`);
  const raw = bytes.subarray(start, end);
  if (e.method === 0) return raw.slice();
  if (e.method !== 8) throw new Error(`entry "${e.name}" uses unsupported ZIP compression method ${e.method}`);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is unavailable in this runtime');
  }
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(raw);
      c.close();
    },
  });
  const reader = src
    .pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
    .getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
