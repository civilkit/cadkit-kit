// Fonts of a document (docs/text.md, "Fonts"). Pure helpers: the curated list, names, hashes, which fonts a document uses, what
// travels in the saved file. The controller does the kernel calls (loadFont / subsetFont) and the pickers do the file reading.
//
// Document field `fonts` (viewer-state like `appearance`; the session never sees it):
//   [{ name, hash, source: 'curated', id }]                       the kit hosts the file; reloaded by id, checked against its sha-256
//   [{ name, hash, source: 'embedded', family?, data, subset? }]  the file itself (base64), or with `subset` the glyphs the text needs
// `name` is what the text entity's `font` says; `hash` is the SHA-256 (hex) of the bytes the entry stands for (of `data` when embedded).
// An older app keeps the field in the file without reading it; the text then reports `textFontNotLoaded`.

/** One row of public/fonts/fonts.json. */
export interface CuratedFont {
  id: string; family: string; role: string; licence: string;
  /** path under the fonts directory */
  file: string; licenceFile?: string; sha256: string; bytes: number; upstream: string; copyright?: string;
}

export interface DocFont {
  name: string;
  hash: string;
  source: 'curated' | 'embedded';
  id?: string;
  family?: string;
  data?: string;
  /** `data` holds only the glyphs of the document's text (the original file was over the embed limit) */
  subset?: boolean;
}

export const BUILTIN_FONTS = ['gauge', 'engrave'] as const;
export const isBuiltinFont = (n: unknown): boolean => n === undefined || n === null || n === 'gauge' || n === 'engrave' || n === 'sans' || n === 'serif' || n === 'default';
/** A user or system font up to this size travels whole in the document; a bigger one as the subset of the document's text. */
export const FONT_EMBED_MAX = 1.5 * 1024 * 1024;
/** Hash prefix an entity pins (`fontHash`). */
export const PIN_LEN = 16;
export const pinOf = (hash: string): string => hash.slice(0, PIN_LEN);

/** Where the kit fetches curated fonts and the manifest from; the app hands in its base URL. */
export interface FontSource {
  manifest(): Promise<CuratedFont[]>;
  fetch(c: CuratedFont): Promise<Uint8Array>;
}

/** `/fonts/fonts.json` and the files beside it, fetched on demand (the browser caches them). */
export function webFontSource(base = '/', fetchFn: typeof fetch = (...a) => fetch(...a)): FontSource {
  const dir = base.replace(/\/?$/, '/') + 'fonts/';
  let manifest: Promise<CuratedFont[]> | null = null;
  return {
    manifest() {
      return (manifest ??= fetchFn(dir + 'fonts.json').then(async (r) => {
        if (!r.ok) throw new Error(`fonts.json: HTTP ${r.status}`);
        return parseManifest(await r.json());
      }).catch((e) => { manifest = null; throw e; }));
    },
    async fetch(c) {
      const r = await fetchFn(dir + c.file);
      if (!r.ok) throw new Error(`${c.file}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

export function parseManifest(j: unknown): CuratedFont[] {
  const list = (j as { fonts?: unknown })?.fonts;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is CuratedFont => !!x && typeof x.id === 'string' && typeof x.file === 'string' && typeof x.sha256 === 'string' && typeof x.family === 'string')
    .map((x) => ({ ...x, role: String(x.role ?? ''), licence: String(x.licence ?? ''), bytes: Number(x.bytes ?? 0), upstream: String(x.upstream ?? '') }));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The kernel name of a user or system font: the family as a lower-case slug and the first eight hex digits of the file hash (the same file always gets the same name, another file never shares it). */
export function fontSlug(family: string, hash: string): string {
  const base = family.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'font';
  return `${base}-${hash.slice(0, 8)}`;
}

/** TTF / OTF / TTC by magic number; WOFF, WOFF2 and anything else false (the kernel refuses them, so the picker says so before loading). */
export function fontKind(b: Uint8Array): 'ttf' | 'otf' | 'ttc' | 'woff' | 'woff2' | 'unknown' {
  if (b.length < 4) return 'unknown';
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'ttcf') return 'ttc';
  if (tag === 'OTTO') return 'otf';
  if (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0 || tag === 'true') return 'ttf';
  return 'unknown';
}

/** Fonts the text entities of the document name, each with the characters it must be able to draw. Built-in fonts are left out. */
export function textFontsUsed(doc: { features?: unknown[] } | null | undefined): Map<string, string> {
  const out = new Map<string, Set<string>>();
  for (const f of doc?.features ?? []) {
    const ents = (f as { entities?: unknown })?.entities;
    if (!Array.isArray(ents)) continue;
    for (const e of ents as Array<{ type?: string; font?: unknown; string?: unknown }>) {
      if (e?.type !== 'text' || typeof e.font !== 'string' || isBuiltinFont(e.font)) continue;
      const set = out.get(e.font) ?? new Set<string>();
      for (const ch of String(e.string ?? '')) set.add(ch);
      out.set(e.font, set);
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v].sort().join('')]));
}

/** The `fonts` field of a file as entries; anything malformed is dropped (an older or damaged file still opens). */
export function readDocFonts(raw: unknown): DocFont[] {
  if (!Array.isArray(raw)) return [];
  const out: DocFont[] = [];
  const seen = new Set<string>();
  for (const x of raw as Array<Record<string, unknown>>) {
    if (!x || typeof x.name !== 'string' || !x.name || seen.has(x.name)) continue;
    const source = x.source === 'curated' ? 'curated' : x.source === 'embedded' ? 'embedded' : null;
    if (!source) continue;
    if (source === 'curated' && typeof x.id !== 'string') continue;
    if (source === 'embedded' && typeof x.data !== 'string') continue;
    seen.add(x.name);
    out.push({
      name: x.name, hash: typeof x.hash === 'string' ? x.hash : '', source,
      ...(typeof x.id === 'string' ? { id: x.id } : {}), ...(typeof x.family === 'string' ? { family: x.family } : {}),
      ...(typeof x.data === 'string' ? { data: x.data } : {}), ...(x.subset === true ? { subset: true } : {}),
    });
  }
  return out;
}

/** Kernel load warning code -> i18n key (the ones the panel shows); other codes are not shown. */
export const FONT_WARNING_CODES = [
  'fontKerningIgnored', 'fontLigaturesIgnored', 'fontVariableDefaultOnly', 'fontCollectionFirstFace', 'fontOverlappingContours',
  'fontEmbeddingRestricted', 'fontNoSubsetting', 'fontNoLatin', 'fontCffApproximated', 'fontNoCapHeight',
] as const;
export const fontWarningKey = (code: string): string | null => ((FONT_WARNING_CODES as readonly string[]).includes(code) ? 'app.font.warn.' + code : null);

/** The kernel's error code out of a failed request (`error` is a string, or `{code, message}`), '' when there is none. */
export function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object') return String((error as { code?: unknown }).code ?? '');
  const m = /\b(font[A-Z]\w+|textFont\w+)\b/.exec(String(error ?? ''));
  return m ? m[1] : '';
}
export function errorTextOf(error: unknown): string {
  if (error && typeof error === 'object') return String((error as { message?: unknown }).message ?? (error as { code?: unknown }).code ?? 'failed');
  return String(error ?? 'failed');
}

/** A face from the Local Font Access API (`queryLocalFonts()`). */
export interface LocalFace { family: string; fullName: string; postscriptName: string; style: string; blob(): Promise<Blob> }

/** Case-insensitive filter of the system faces by family or full name. */
export function filterFaces<T extends { family: string; fullName?: string }>(list: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  return s ? list.filter((f) => f.family.toLowerCase().includes(s) || (f.fullName ?? '').toLowerCase().includes(s)) : list;
}

/** The faces sorted by family, then name (the order the list shows). */
export function sortFaces<T extends { family: string; fullName?: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.family.localeCompare(b.family) || (a.fullName ?? '').localeCompare(b.fullName ?? ''));
}
