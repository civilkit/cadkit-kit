// Library sources and the one place bytes come in: `github:owner/repo[@ref]`, an HTTPS URL to a library.json, a local set of
// files, and the app's own bundled samples. All network access goes through one injectable fetch-like function, so tests never
// touch the network. No GitHub API is used: files come from raw.githubusercontent.com, with the jsDelivr mirror as a fallback.
import { httpsUrl, MANIFEST_MAX_BYTES, relativePathOk } from './manifest';

export type LibraryErrorCode = 'scheme' | 'source' | 'http' | 'network' | 'tooLarge' | 'parse' | 'schema' | 'sha' | 'size' | 'part' | 'path' | 'origin' | 'offline' | 'needsConfirm' | 'missing' | 'exists' | 'unsupported';
export class LibraryError extends Error {
  constructor(readonly code: LibraryErrorCode, readonly detail?: string) { super(detail ? `${code}: ${detail}` : code); this.name = 'LibraryError'; }
}

/** What the library code needs of `fetch`: a URL in, a Response-like out. */
export type FetchLike = (url: string, init?: { credentials?: 'omit'; redirect?: 'follow' | 'error'; referrerPolicy?: 'no-referrer'; signal?: AbortSignal }) => Promise<FetchResponse>;
export interface FetchResponse {
  ok: boolean;
  status: number;
  url?: string;
  headers?: { get(name: string): string | null };
  body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> | void } } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Source =
  | { kind: 'github'; owner: string; repo: string; ref: string | null }
  | { kind: 'url'; url: string }
  | { kind: 'local'; name: string }
  | { kind: 'bundled'; base: string };

export interface SourceOptions { allowLocalhost?: boolean }

const GH = /^github:([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:@([A-Za-z0-9_./-]{1,100}))?$/;

/** Parse what the user typed. Throws LibraryError('scheme' | 'source'). */
export function parseSource(input: string, opts: SourceOptions = {}): Source {
  const s = input.trim();
  const gh = GH.exec(s) ?? /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(s);
  if (gh) {
    const ref = gh[3] ?? null;
    if (ref && (ref.includes('..') || ref.startsWith('/') || ref.endsWith('/'))) throw new LibraryError('source');
    return { kind: 'github', owner: gh[1], repo: gh[2], ref };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    const url = httpsUrl(s, opts.allowLocalhost);
    if (!url) throw new LibraryError('scheme');
    const u = new URL(url);
    if (u.username || u.password) throw new LibraryError('source');
    u.hash = '';
    if (u.pathname.endsWith('/')) u.pathname += 'library.json';
    return { kind: 'url', url: u.href };
  }
  throw new LibraryError('source');
}

/** The text a source is stored and shown as (and the registry key is derived from). */
export function sourceKey(s: Source): string {
  switch (s.kind) {
    case 'github': return `github:${s.owner}/${s.repo}${s.ref ? '@' + s.ref : ''}`;
    case 'url': return s.url;
    case 'local': return `local:${s.name}`;
    case 'bundled': return `bundled:${s.base}`;
  }
}
/** A page a person can open to see the library (never fetched by us). */
export function sourceLink(s: Source): string | null {
  if (s.kind === 'github') return `https://github.com/${s.owner}/${s.repo}${s.ref ? '/tree/' + s.ref : ''}`;
  if (s.kind === 'url') return s.url;
  return null;
}

/** Read the body of a response, refusing more than `max` bytes (checked on the declared length, then while reading). */
export async function readLimited(r: FetchResponse, max: number): Promise<Uint8Array> {
  const cl = Number(r.headers?.get('content-length') ?? NaN);
  if (Number.isFinite(cl) && cl > max) { try { await r.body?.getReader().cancel(); } catch { /* ignore */ } throw new LibraryError('tooLarge'); }
  const reader = r.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > max) throw new LibraryError('tooLarge');
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { n += value.length; if (n > max) { await reader.cancel(); throw new LibraryError('tooLarge'); } chunks.push(value); }
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Reads files of one library. `manifest()` reads library.json; `read(path, max)` a file named by the manifest. */
export interface Transport {
  manifest(): Promise<Uint8Array>;
  read(path: string, max: number): Promise<Uint8Array>;
}

export interface TransportDeps { fetch: FetchLike; allowLocalhost?: boolean; localFiles?: LocalFiles }
/** Files of a local library by path relative to its folder (what a folder picker gives). */
export type LocalFiles = Map<string, { arrayBuffer(): Promise<ArrayBuffer>; size?: number }>;

function remote(bases: string[], file: string, d: TransportDeps): Transport {
  const get = async (rel: string, max: number): Promise<Uint8Array> => {
    if (rel !== file && !relativePathOk(rel)) throw new LibraryError('path', rel);
    let last: LibraryError | null = null;
    for (const base of bases) {
      const u = new URL(rel, base);
      if (u.origin !== new URL(base).origin) throw new LibraryError('origin', rel);
      if (!httpsUrl(u.href, d.allowLocalhost)) throw new LibraryError('scheme');
      let r: FetchResponse;
      try { r = await d.fetch(u.href, { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' }); } catch { last = new LibraryError('network'); continue; }
      if (r.url && !httpsUrl(r.url, d.allowLocalhost)) throw new LibraryError('scheme');   // a redirect must stay on HTTPS
      if (!r.ok) {
        last = new LibraryError('http', String(r.status));
        if (r.status >= 500 || r.status === 429) continue;   // try the mirror; a 404 is final
        throw last;
      }
      return readLimited(r, max);
    }
    throw last ?? new LibraryError('network');
  };
  return { manifest: () => get(file, MANIFEST_MAX_BYTES), read: get };
}

export function makeTransport(s: Source, d: TransportDeps): Transport {
  if (s.kind === 'github') {
    const ref = s.ref ?? 'HEAD';
    return remote([
      `https://raw.githubusercontent.com/${s.owner}/${s.repo}/${ref}/`,
      `https://cdn.jsdelivr.net/gh/${s.owner}/${s.repo}${s.ref ? '@' + s.ref : ''}/`,
    ], 'library.json', d);
  }
  if (s.kind === 'url') {
    const u = new URL(s.url);
    const name = u.pathname.split('/').pop() || 'library.json';
    u.pathname = u.pathname.slice(0, u.pathname.length - name.length);
    u.search = '';
    return remote([u.href], name, d);
  }
  if (s.kind === 'local') {
    const files = d.localFiles;
    const get = async (path: string, max: number): Promise<Uint8Array> => {
      const f = files?.get(path);
      if (!f) throw new LibraryError('missing', path);
      if ((f.size ?? 0) > max) throw new LibraryError('tooLarge');
      const buf = new Uint8Array(await f.arrayBuffer());
      if (buf.length > max) throw new LibraryError('tooLarge');
      return buf;
    };
    return { manifest: () => get('library.json', MANIFEST_MAX_BYTES), read: get };
  }
  // the app's own samples: same origin, trusted content
  const base = s.base.endsWith('/') ? s.base : s.base + '/';
  const get = async (rel: string, max: number): Promise<Uint8Array> => {
    if (!relativePathOk(rel)) throw new LibraryError('path', rel);
    let r: FetchResponse;
    try { r = await d.fetch(base + rel, { credentials: 'omit' }); } catch { throw new LibraryError('network'); }
    if (!r.ok) throw new LibraryError('http', String(r.status));
    return readLimited(r, max);
  };
  return { manifest: () => get('index.json', MANIFEST_MAX_BYTES), read: get };
}

/** The bundled samples list (`[{id, title, file, category?, tags?}]`) as a manifest object. The index gives each sample its category and
 *  tags (like a manifest part); an entry without them gets its category from the id prefix and no tags. */
export function samplesManifest(raw: unknown, name: string, licence: string): unknown {
  const list = Array.isArray(raw) ? raw : [];
  return {
    format: 'fwlib', version: 1, name, licence,
    parts: list.filter((e) => e && typeof e.id === 'string' && typeof e.file === 'string').map((e: { id: string; title?: string; file: string; category?: unknown; tags?: unknown }) => ({
      id: e.id, title: e.title ?? e.id,
      category: typeof e.category === 'string' && e.category.trim() && e.category.length <= 40 ? e.category : e.id.includes('-') ? e.id.split('-')[0] : 'samples',
      tags: Array.isArray(e.tags) && e.tags.length <= 20 && e.tags.every((x) => typeof x === 'string' && x.trim() && x.length <= 40) ? e.tags : [],
      file: e.file, thumb: `thumbs/${e.id}.webp`,
    })),
  };
}
