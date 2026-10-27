// The picture saved inside a .ckpart: an optional top-level `thumbnail` field ({ format, width, height, hash, data }), a small PNG
// (base64) of the part in the iso view plus a hash of the document it was drawn from. It is only ever added when the file text is
// written and taken off again when a file is read, so it never reaches the kernel session, the history, the dirty signature or the
// autosave. A thumbnail whose hash no longer matches the document is stale and is drawn again on the next save.
import type { PartDoc } from '@ck/part-model';

/** Largest PNG kept in a file (bytes, before base64). */
export const THUMB_MAX_BYTES = 40_000;
/** Width x height tried in turn until the PNG fits. */
export const THUMB_SIZES: Array<[number, number]> = [[256, 192], [192, 144], [128, 96]];

export interface DocThumbnail { format: 'png'; width: number; height: number; hash: string; data: string }

/** Parts of the document the picture does not depend on. */
const IGNORED = new Set(['thumbnail', 'name']);

/** The format was renamed (fw-part, then ck-part): ck-part hashes as fw-part, the name the stored hashes were made with, at any depth
 *  (a nested part of an assembly has its own `format`), so a picture drawn before the rename is still current. */
function canonicalFormat(v: unknown): string {
  return v === 'ck-part' ? JSON.stringify('fw-part') : canonical(v);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + (k === 'format' ? canonicalFormat(o[k]) : canonical(o[k]))).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

function cyrb53(s: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Hash of what a picture of the document shows: every field except its name and any thumbnail it carries (key order does not matter). */
export function docHash(doc: unknown): string {
  const o = { ...(doc as Record<string, unknown>) };
  for (const k of IGNORED) delete o[k];
  const text = canonical(o);
  return cyrb53(text, 0).toString(16).padStart(14, '0') + cyrb53(text, 1).toString(16).padStart(14, '0');
}

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];

/** A thumbnail field read from a file, or null when it is absent or not usable (never throws: a bad field must not stop a file opening). */
export function readThumbnail(doc: unknown): DocThumbnail | null {
  const t = (doc as { thumbnail?: Partial<DocThumbnail> } | null)?.thumbnail;
  if (!t || typeof t !== 'object' || t.format !== 'png' || typeof t.data !== 'string' || typeof t.hash !== 'string') return null;
  if (t.data.length > Math.ceil(THUMB_MAX_BYTES * 1.4) + 4 || !/^[A-Za-z0-9+/=]+$/.test(t.data)) return null;
  try { const b = base64ToBytes(t.data.slice(0, 8)); if (!PNG_SIG.every((x, i) => b[i] === x)) return null; } catch { return null; }
  return { format: 'png', width: Number(t.width) || 0, height: Number(t.height) || 0, hash: t.hash, data: t.data };
}

/** The document without its thumbnail field, and the thumbnail (null when none or unusable). The input is not changed. */
export function stripThumbnail<T extends object>(doc: T): { doc: T; thumbnail: DocThumbnail | null } {
  if (!('thumbnail' in doc)) return { doc, thumbnail: null };
  const { thumbnail: _t, ...rest } = doc as T & { thumbnail?: unknown };
  return { doc: rest as T, thumbnail: readThumbnail(doc) };
}

export const thumbnailUrl = (t: DocThumbnail): string => 'data:image/png;base64,' + t.data;
export const isFresh = (t: DocThumbnail | null | undefined, doc: unknown): t is DocThumbnail => !!t && t.hash === docHash(doc);

/** Draws a document as PNG bytes at the size asked (null: nothing to show). */
export type DocRenderer = (doc: PartDoc, size: { width: number; height: number }) => Promise<Uint8Array | null>;

/** Make the thumbnail of a document: the largest size whose PNG fits THUMB_MAX_BYTES. Null when it has no solid or no size fits. */
export async function makeDocThumbnail(doc: PartDoc, render: DocRenderer): Promise<DocThumbnail | null> {
  const hash = docHash(doc);
  for (const [width, height] of THUMB_SIZES) {
    const png = await render(doc, { width, height });
    if (!png) return null;
    if (png.length <= THUMB_MAX_BYTES) return { format: 'png', width, height, hash, data: bytesToBase64(png) };
  }
  return null;
}
