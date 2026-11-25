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

/** Names in the zip's central directory (read without inflating anything), to tell a desktop program from a plugin. */
function entryNames(bytes: Uint8Array): string[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return [];
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: string[] = [];
  for (let i = 0; i < count && p + 46 <= bytes.length && dv.getUint32(p, true) === 0x02014b50; i++) {
    const n = dv.getUint16(p + 28, true);
    out.push(new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + n)));
    p += 46 + n + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return out;
}
const NATIVE = /(^|[\/_.-])(linux|win(dows)?|macos|osx|darwin)[-_.]?(x64|x86[-_]64|amd64|arm64|aarch64|x86)(?![a-z0-9])|\.(exe|dll|so|dylib|appimage|msi|dmg)$/i;

/** What to tell a person whose plugin zip is over the limit: its size and the limit, and when the zip holds a program for the desktop, that it is one. */
export function tooBigMessage(bytes: Uint8Array): string {
  const mb = (n: number) => (n / 1048576 >= 10 ? Math.round(n / 1048576) : Math.round((n / 1048576) * 10) / 10);
  const base = `This plugin is bigger than CivilKit can install (${mb(bytes.length)} MB; the limit is ${mb(MAX_PACKAGE_BYTES)} MB).`;
  return NATIVE.test(entryNames(bytes).join('\n')) ? `${base} It contains a program for your computer (Linux, Windows or macOS), not a generator: it is a download for the SolidCraft desktop app.` : base;
}

export async function filesFromZip(bytes: Uint8Array): Promise<Map<string, Uint8Array> | { error: string }> {
  if (bytes.length > MAX_PACKAGE_BYTES) return { error: tooBigMessage(bytes) };
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
