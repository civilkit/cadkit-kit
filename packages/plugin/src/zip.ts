// Reads a plugin zip into a file map. The declared uncompressed sizes are checked BEFORE anything is inflated, so a small archive cannot expand into memory.
import { zipRead } from '@kit/io';
import { MAX_FILES, MAX_PACKAGE_BYTES } from './package';

/** Sum of the uncompressed sizes in the zip's central directory (null when it is not a zip). */
function declared(bytes: Uint8Array): { total: number; count: number } | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true), total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) return null;
    total += dv.getUint32(p + 24, true);
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return { total, count };
}

export async function filesFromZip(bytes: Uint8Array): Promise<Map<string, Uint8Array> | { error: string }> {
  if (bytes.length > MAX_PACKAGE_BYTES) return { error: `the zip is ${Math.round(bytes.length / 1024)} KB: at most ${MAX_PACKAGE_BYTES / 1024} KB` };
  const d = declared(bytes);
  if (!d) return { error: 'not a zip file' };
  if (d.count > MAX_FILES + 8) return { error: `${d.count} entries: a plugin has at most ${MAX_FILES} files` };
  if (d.total > MAX_PACKAGE_BYTES) return { error: `the zip would unpack to ${Math.round(d.total / 1024)} KB: at most ${MAX_PACKAGE_BYTES / 1024} KB` };
  try {
    const out = new Map<string, Uint8Array>();
    for (const f of await zipRead(bytes)) if (!f.name.endsWith('/')) out.set(f.name, f.data);
    return out;
  } catch (e) { return { error: (e as Error).message }; }
}
