// The list of libraries on this device: add, remove, refresh, the licence confirmations, and the cache-first reads of manifests and
// parts. The list and the confirmations live in the app settings (local storage); a confirmation is never put in a document.
import { MANIFEST_MAX_BYTES, PART_MAX_BYTES, THUMB_MAX_BYTES, licenceClass, validateManifest, effectiveLicence, type LibraryManifest, type LibraryPart } from './manifest';
import { LibraryError, makeTransport, parseSource, samplesManifest, sourceKey, type FetchLike, type LocalFiles, type Source, type Transport } from './source';
import { parsePart, sha256Hex } from './partFile';
import type { CacheStore } from './cache';
import type { PartDoc } from '@ck/part-model';

export interface DefaultLibrary { id: string; name: string; description?: string; source: string; licence?: string }
export interface LibraryRecord {
  /** the source key (`github:o/r@ref`, the library.json URL, `local:name`) or a default's id */
  id: string;
  source: string;
  name: string;
  description?: string;
  homepage?: string;
  licence?: string;
  parts: number;
  addedAt: number;
  /** a default of the app (bundled content: trusted, no licence gate, no cache) */
  builtin?: boolean;
}
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export interface RegistryDeps {
  fetch: FetchLike;
  cache: CacheStore;
  kv: KV | null;
  defaults: DefaultLibrary[];
  /** where `bundled:` sources live (the app's base URL) */
  base?: string;
  /** development and tests only */
  allowLocalhost?: boolean;
  now?: () => number;
}
export interface Preview { record: LibraryRecord; manifest: LibraryManifest; licence: string | undefined; needsConfirm: boolean; source: Source; bytes: Uint8Array; local?: LocalFiles }
export interface ManifestState { manifest: LibraryManifest; offline: boolean }
export interface PartData { part: LibraryPart; doc: PartDoc; bytes: Uint8Array; sha256: string; licence: string | undefined; fromCache: boolean }

interface Stored { v: 1; libs: LibraryRecord[]; removed: string[]; confirmed: Record<string, string[]> }
const KEY = 'ck.libraries.v1';

export class LibraryRegistry {
  private st: Stored = { v: 1, libs: [], removed: [], confirmed: {} };
  private local = new Map<string, LocalFiles>();
  private parsed = new Map<string, LibraryManifest>();
  private listeners = new Set<() => void>();
  /** a counter that changes with every change of the list, for UI subscriptions */
  rev = 0;

  constructor(private d: RegistryDeps) {
    try { const raw = d.kv?.getItem(KEY); if (raw) { const s = JSON.parse(raw) as Stored; if (s && s.v === 1 && Array.isArray(s.libs)) this.st = { v: 1, libs: s.libs.filter(okRecord), removed: Array.isArray(s.removed) ? s.removed.filter((x) => typeof x === 'string') : [], confirmed: s.confirmed && typeof s.confirmed === 'object' ? s.confirmed : {} }; } } catch { /* start empty */ }
  }

  subscribe(f: () => void): () => void { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  private save(): void {
    this.rev++;
    try { this.d.kv?.setItem(KEY, JSON.stringify(this.st)); } catch { /* storage full or blocked: the list lasts for this session */ }
    for (const f of this.listeners) f();
  }

  list(): LibraryRecord[] {
    const defaults: LibraryRecord[] = this.d.defaults.filter((x) => !this.st.removed.includes(x.id)).map((x) => ({ id: x.id, source: x.source, name: x.name, description: x.description, licence: x.licence, parts: 0, addedAt: 0, builtin: true }));
    return [...defaults, ...this.st.libs];
  }
  get(id: string): LibraryRecord | undefined { return this.list().find((l) => l.id === id); }

  private transport(rec: LibraryRecord): Transport {
    if (rec.builtin) return makeTransport({ kind: 'bundled', base: this.bundledBase(rec.source) }, { fetch: this.d.fetch });
    if (isLocal(rec)) return makeTransport({ kind: 'local', name: rec.source.slice(6) }, { fetch: this.d.fetch, localFiles: this.local.get(rec.id) });
    return makeTransport(parseSource(rec.source, { allowLocalhost: this.d.allowLocalhost }), { fetch: this.d.fetch, allowLocalhost: this.d.allowLocalhost });
  }
  private bundledBase(source: string): string {
    const rel = source.replace(/^bundled:/, '');
    if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\/?$/.test(rel)) throw new LibraryError('source');
    return (this.d.base ?? '/') + rel;
  }

  private decode(rec: LibraryRecord | null, bytes: Uint8Array, local = !!rec && isLocal(rec)): LibraryManifest {
    if (bytes.length > MANIFEST_MAX_BYTES) throw new LibraryError('tooLarge');
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new LibraryError('parse'); }
    if (rec?.builtin) raw = samplesManifest(raw, rec.name, rec.licence ?? '');
    const r = validateManifest(raw, { requireSha: !rec?.builtin && !local, allowLocalhost: this.d.allowLocalhost });
    if (!r.ok) throw Object.assign(new LibraryError('schema', r.issues.map((i) => `${i.path}:${i.code}`).join(', ')), { issues: r.issues });
    return r.manifest;
  }

  /** Fetch and validate a library's manifest without adding it. `local` is a folder's files (path relative to the folder). */
  async preview(input: string | { local: LocalFiles; name: string }): Promise<Preview> {
    let source: Source, local: LocalFiles | undefined;
    if (typeof input === 'string') source = parseSource(input, { allowLocalhost: this.d.allowLocalhost });
    else { source = { kind: 'local', name: input.name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 60) || 'library' }; local = input.local; }
    const id = sourceKey(source);
    if (this.get(id)) throw new LibraryError('exists');
    const bytes = await makeTransport(source, { fetch: this.d.fetch, allowLocalhost: this.d.allowLocalhost, localFiles: local }).manifest();
    const manifest = this.decode(null, bytes, source.kind === 'local');
    const record: LibraryRecord = { id, source: id, name: manifest.name, description: manifest.description, homepage: manifest.homepage, licence: manifest.licence, parts: manifest.parts.length, addedAt: (this.d.now ?? Date.now)() };
    return { record, manifest, licence: manifest.licence, needsConfirm: this.needsConfirm(id, manifest.licence, record), source, bytes, local };
  }

  /** Add a previewed library. A licence outside the allow-list needs `confirm: true` (that is the confirmation, remembered). */
  async add(p: Preview, opts: { confirm?: boolean } = {}): Promise<LibraryRecord> {
    if (this.get(p.record.id)) throw new LibraryError('exists');
    if (p.needsConfirm && !opts.confirm) throw new LibraryError('needsConfirm', p.licence ?? '');
    if (p.local) this.local.set(p.record.id, p.local);
    this.st.libs.push(p.record);
    this.parsed.set(p.record.id, p.manifest);
    await this.d.cache.put({ key: this.manifestKey(p.record), lib: p.record.id, kind: 'manifest', bytes: p.bytes, at: p.record.addedAt });
    if (p.needsConfirm && opts.confirm) this.confirm(p.record.id, p.licence);
    else this.save();
    if (p.local) await this.cacheAllParts(p.record, p.manifest);   // a local library cannot be re-read after a reload: keep its parts
    return p.record;
  }

  private async cacheAllParts(rec: LibraryRecord, m: LibraryManifest): Promise<void> {
    for (const part of m.parts) { try { await this.part(rec.id, part.id, { skipGate: true }); } catch { /* a broken part is reported when it is used */ } }
  }

  async remove(id: string): Promise<void> {
    const rec = this.get(id);
    if (!rec) return;
    if (rec.builtin) { if (!this.st.removed.includes(id)) this.st.removed.push(id); }
    else this.st.libs = this.st.libs.filter((l) => l.id !== id);
    delete this.st.confirmed[id];
    this.local.delete(id); this.parsed.delete(id);
    this.save();
    await this.d.cache.removeLibrary(id);
  }

  /** Put the default libraries back (the ones the user removed). */
  restoreDefaults(): void { this.st.removed = []; this.save(); }

  private manifestKey(rec: LibraryRecord): string { return `${rec.id}/library.json#manifest`; }
  private partKey(rec: LibraryRecord, p: LibraryPart): string { return `${rec.id}/${p.file}#${p.sha256 ?? 'local'}`; }

  /** The manifest, from the cache when there is one (so browsing needs no network). */
  async manifest(id: string): Promise<ManifestState> {
    const rec = this.get(id);
    if (!rec) throw new LibraryError('missing', id);
    const hit = this.parsed.get(id);
    if (hit) return { manifest: hit, offline: false };
    if (!rec.builtin) {
      const c = await this.d.cache.get(this.manifestKey(rec));
      if (c) { const m = this.decode(rec, c.bytes); this.parsed.set(id, m); return { manifest: m, offline: false }; }
    }
    return this.refresh(id);
  }

  /** Re-fetch the manifest. Without a network the cached one is returned with `offline: true`. */
  async refresh(id: string): Promise<ManifestState> {
    const rec = this.get(id);
    if (!rec) throw new LibraryError('missing', id);
    let bytes: Uint8Array;
    try { bytes = await this.transport(rec).manifest(); }
    catch (e) {
      const c = rec.builtin ? null : await this.d.cache.get(this.manifestKey(rec));
      if (c && !(e instanceof LibraryError && (e.code === 'scheme' || e.code === 'source'))) { const m = this.decode(rec, c.bytes); this.parsed.set(id, m); return { manifest: m, offline: true }; }
      throw e;
    }
    const m = this.decode(rec, bytes);
    this.parsed.set(id, m);
    if (!rec.builtin) {
      await this.d.cache.put({ key: this.manifestKey(rec), lib: id, kind: 'manifest', bytes, at: (this.d.now ?? Date.now)() });
      await this.d.cache.prune(id, 'part', new Set(m.parts.map((p) => this.partKey(rec, p))));
      await this.d.cache.prune(id, 'thumb', new Set(m.parts.filter((p) => p.thumb).map((p) => `${rec.id}/${p.thumb}#thumb`)));
      const stored = this.st.libs.find((l) => l.id === id);
      if (stored) { stored.name = m.name; stored.description = m.description; stored.homepage = m.homepage; stored.licence = m.licence; stored.parts = m.parts.length; this.save(); }
    }
    return { manifest: m, offline: false };
  }

  // ---- licence confirmation ----
  /** Whether `licence` for this library still needs the user's confirmation (never for the app's own bundled content). */
  needsConfirm(id: string, licence: string | undefined, rec: LibraryRecord | undefined = this.get(id)): boolean {
    if (rec?.builtin) return false;
    if (licenceClass(licence) === 'permissive') return false;
    return !(this.st.confirmed[id] ?? []).includes(licence ?? '');
  }
  confirm(id: string, licence: string | undefined): void {
    const l = this.st.confirmed[id] ?? [];
    if (!l.includes(licence ?? '')) l.push(licence ?? '');
    this.st.confirmed[id] = l;
    this.save();
  }

  // ---- parts ----
  /** Download (or read from the cache), verify and parse one part. Refuses a part whose licence is not confirmed yet. */
  async part(id: string, partId: string, o: { skipGate?: boolean } = {}): Promise<PartData> {
    const rec = this.get(id);
    if (!rec) throw new LibraryError('missing', id);
    const { manifest } = await this.manifest(id);
    const part = manifest.parts.find((p) => p.id === partId);
    if (!part) throw new LibraryError('missing', partId);
    const licence = effectiveLicence(manifest, part);
    if (!o.skipGate && this.needsConfirm(id, licence, rec)) throw new LibraryError('needsConfirm', licence ?? '');
    const key = this.partKey(rec, part);
    const cached = rec.builtin ? null : await this.d.cache.get(key);
    let bytes: Uint8Array, fromCache = false;
    if (cached && (!part.sha256 || (await sha256Hex(cached.bytes)) === part.sha256)) { bytes = cached.bytes; fromCache = true; }
    else bytes = await this.transport(rec).read(part.file, PART_MAX_BYTES);
    if (part.bytes !== undefined && part.bytes !== bytes.length) throw new LibraryError('size', part.id);
    const sha = await sha256Hex(bytes);
    if (part.sha256 && sha !== part.sha256) throw new LibraryError('sha', part.id);
    const doc = parsePart(bytes);
    if (!fromCache && !rec.builtin) await this.d.cache.put({ key, lib: id, kind: 'part', bytes, at: (this.d.now ?? Date.now)() });
    return { part, doc, bytes, sha256: sha, licence, fromCache };
  }

  /** Thumbnail bytes and media type (png, webp or jpeg only), or null when the part has none or it cannot be read. */
  async thumb(id: string, partId: string): Promise<{ bytes: Uint8Array; type: string } | null> {
    const rec = this.get(id);
    if (!rec) return null;
    try {
      const { manifest } = await this.manifest(id);
      const part = manifest.parts.find((p) => p.id === partId);
      if (!part?.thumb) return null;
      const key = `${rec.id}/${part.thumb}#thumb`;
      const c = rec.builtin ? null : await this.d.cache.get(key);
      const bytes = c?.bytes ?? await this.transport(rec).read(part.thumb, THUMB_MAX_BYTES);
      const type = imageType(bytes);
      if (!type) return null;   // not an image we show: whatever the file claims, only these are drawn
      if (!c && !rec.builtin) await this.d.cache.put({ key, lib: id, kind: 'thumb', bytes, at: (this.d.now ?? Date.now)() });
      return { bytes, type };
    } catch { return null; }
  }

  /** Bytes the cache holds for a library. */
  cacheSize(id: string): Promise<number> { return this.d.cache.size(id); }
}

/** Sniff png, webp and jpeg by their magic bytes (the file name and the server's type are not trusted). */
export function imageType(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

const isLocal = (r: LibraryRecord): boolean => r.source.startsWith('local:');

function okRecord(x: unknown): x is LibraryRecord {
  const r = x as LibraryRecord | null;
  return !!r && typeof r.id === 'string' && typeof r.source === 'string' && typeof r.name === 'string' && typeof r.parts === 'number';
}
