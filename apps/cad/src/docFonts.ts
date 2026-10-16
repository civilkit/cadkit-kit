// The fonts of the open document: which ones the kernel has loaded, the bytes behind them, and what the saved file carries.
// The kernel's font table belongs to the kernel instance, so a new or restarted kernel has none: `reload()` puts them all back.
import {
  FONT_EMBED_MAX, errorCodeOf, errorTextOf, fontKind, fromBase64, isBuiltinFont, pinOf, sha256Hex, textFontsUsed, toBase64,
  type CuratedFont, type DocFont, type FontSource,
} from './fonts';

type Reply = { ok?: boolean; trap?: string; error?: unknown; result?: unknown };
export type FontRequest = (m: Record<string, unknown>) => Promise<Reply>;

export interface FontWarning { code: string; detail: string }
/** What the kernel said about a loaded font (the part of the `loadFont` reply the panel uses). */
export interface LoadedFont { name: string; hash: string; family: string | null; bytes: number; chars: number; supported: string[]; warnings: FontWarning[] }

/** A font that could not be loaded; `code` is the kernel's error code (fontBadData ...) or one of ours (`fontFetch`, `fontChecksum`, `fontUnknown`). */
export interface FontProblem { name: string; code: string; message: string }
export type FontResult = { ok: true; name: string; hash: string; info: LoadedFont; curated?: CuratedFont } | { ok: false; problem: FontProblem };

interface Entry {
  name: string; hash: string; source: 'curated' | 'embedded'; id?: string; family?: string;
  /** the bytes the kernel was given */
  bytes: Uint8Array;
  /** `bytes` is a subset that came with a document: the original is not available */
  subset: boolean;
  /** base64 of `bytes`, made when first needed */
  b64?: string;
  /** a big font: the subset for `subsetKey` (the characters the document's text uses) to embed instead of the whole file */
  embed?: { key: string; data: string; hash: string };
  info?: LoadedFont;
  /** the kernel in use holds this font */
  loaded?: boolean;
}

export class DocFontPool {
  private entries = new Map<string, Entry>();
  /** bumps whenever what `fieldsFor` would return could differ */
  rev = 0;
  constructor(private deps: { request(): FontRequest | null; source?: FontSource | null; embedMax?: number }) {}
  private get max(): number { return this.deps.embedMax ?? FONT_EMBED_MAX; }

  has(name: string): boolean { return this.entries.has(name); }
  names(): string[] { return [...this.entries.keys()]; }
  infoOf(name: string): LoadedFont | undefined { return this.entries.get(name)?.info; }
  /** The font came with a document as a subset (editing the text to new characters needs the original file). */
  isSubset(name: string): boolean { const e = this.entries.get(name); return !!e && (e.subset || !!e.embed); }

  private async kernel(m: Record<string, unknown>): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; code: string; message: string }> {
    const req = this.deps.request();
    if (!req) return { ok: false, code: 'noKernel', message: 'no kernel' };
    const r = await req(m);
    if (r.trap) return { ok: false, code: 'trap', message: String(r.trap) };
    if (!r.ok) return { ok: false, code: errorCodeOf(r.error), message: errorTextOf(r.error) };
    return { ok: true, result: (r.result ?? {}) as Record<string, unknown> };
  }

  private async put(e: Entry, replace: boolean): Promise<FontResult> {
    e.b64 ??= toBase64(e.bytes);
    const r = await this.kernel({ type: 'loadFont', name: e.name, data: e.b64, ...(replace ? { replace: true } : {}) });
    if (!r.ok) return { ok: false, problem: { name: e.name, code: r.code || 'fontBadData', message: r.message } };
    const info = r.result as unknown as LoadedFont;
    e.info = { name: e.name, hash: String(info.hash), family: info.family ?? null, bytes: info.bytes, chars: info.chars, supported: info.supported ?? [], warnings: info.warnings ?? [] };
    // a document that carries a hash for a file the kernel read differently is damaged
    if (e.hash && info.hash !== e.hash) {
      await this.kernel({ type: 'unloadFont', name: e.name });
      return { ok: false, problem: { name: e.name, code: 'fontChecksum', message: 'the font data does not match its checksum' } };
    }
    e.hash = String(info.hash);
    e.loaded = true;
    this.entries.set(e.name, e);
    this.rev++;
    return { ok: true, name: e.name, hash: e.hash, info: e.info };
  }

  /** A curated font by id: fetched, checked against the manifest, loaded under its id. */
  async addCurated(id: string, pinned = ''): Promise<FontResult> {
    const have = this.entries.get(id);
    if (have?.source === 'curated') return have.loaded ? { ok: true, name: id, hash: have.hash, info: have.info! } : this.put({ ...have }, true);
    const src = this.deps.source;
    if (!src) return { ok: false, problem: { name: id, code: 'fontFetch', message: 'no font source' } };
    let c: CuratedFont | undefined;
    try { c = (await src.manifest()).find((x) => x.id === id); } catch (e) { return { ok: false, problem: { name: id, code: 'fontFetch', message: (e as Error).message } }; }
    if (!c) return { ok: false, problem: { name: id, code: 'fontUnknown', message: 'not a curated font' } };
    let bytes: Uint8Array;
    try { bytes = await src.fetch(c); } catch (e) { return { ok: false, problem: { name: id, code: 'fontFetch', message: (e as Error).message } }; }
    const hash = await sha256Hex(bytes);
    if (hash !== c.sha256 || (pinned && hash !== pinned)) return { ok: false, problem: { name: id, code: 'fontChecksum', message: 'the font file does not match its checksum' } };
    const r = await this.put({ name: id, hash, source: 'curated', id, family: c.family, bytes, subset: false }, true);
    return r.ok ? { ...r, curated: c } : r;
  }

  /** A font file the user picked (a file or a system font): loaded under a name made of its family and hash. */
  async addBytes(bytes: Uint8Array, family: string, name: (hash: string) => string): Promise<FontResult> {
    const kind = fontKind(bytes);
    const hash = await sha256Hex(bytes);
    const n = name(hash);
    if (kind === 'woff' || kind === 'woff2' || kind === 'unknown') return { ok: false, problem: { name: n, code: 'fontBadData', message: kind === 'unknown' ? 'not a TrueType / OpenType font' : 'WOFF fonts are not supported' } };
    const have = this.entries.get(n);
    if (have && have.hash === hash) return have.loaded ? { ok: true, name: n, hash, info: have.info! } : this.put({ ...have }, true);
    return this.put({ name: n, hash, source: 'embedded', family, bytes, subset: false }, false);
  }

  /** Load the fonts a document lists, before its first regen. Fonts the pool already holds in the kernel stay; the rest of the pool is dropped. */
  async loadAll(fonts: DocFont[], keepOthers = false): Promise<FontProblem[]> {
    const problems: FontProblem[] = [];
    const want = new Set(fonts.map((f) => f.name));
    if (!keepOthers) for (const n of [...this.entries.keys()]) if (!want.has(n)) { this.entries.delete(n); await this.kernel({ type: 'unloadFont', name: n }); }
    this.rev++;
    for (const f of fonts) {
      if (f.source === 'curated') {
        const r = await this.addCurated(f.id ?? f.name, f.hash);
        if (!r.ok) problems.push(r.problem);
        continue;
      }
      let bytes: Uint8Array;
      try { bytes = fromBase64(f.data ?? ''); } catch { problems.push({ name: f.name, code: 'fontBadData', message: 'the embedded data is damaged' }); continue; }
      if (fontKind(bytes) === 'unknown' || fontKind(bytes) === 'woff' || fontKind(bytes) === 'woff2') { problems.push({ name: f.name, code: 'fontBadData', message: 'the embedded data is not a TrueType / OpenType font' }); continue; }
      const hash = await sha256Hex(bytes);
      if (f.hash && f.hash !== hash) { problems.push({ name: f.name, code: 'fontChecksum', message: 'the embedded font does not match its checksum' }); continue; }
      const have = this.entries.get(f.name);
      if (have && have.hash === hash && have.loaded) continue;
      const r = await this.put({ name: f.name, hash, source: 'embedded', family: f.family, bytes, subset: f.subset === true }, true);
      if (!r.ok) problems.push(r.problem);
    }
    return problems;
  }

  /** Another kernel instance took over: it holds none of the fonts until they are loaded again (`loadAll` / `reload`). */
  invalidate(): void { for (const e of this.entries.values()) e.loaded = false; this.rev++; }

  /** The kernel restarted (or a new kernel took over): every font of the pool goes in again from the bytes held here. */
  async reload(): Promise<FontProblem[]> {
    const problems: FontProblem[] = [];
    for (const e of [...this.entries.values()]) {
      const r = await this.put({ ...e }, true);
      if (!r.ok) { problems.push(r.problem); this.entries.delete(e.name); }
    }
    return problems;
  }

  /** Big fonts travel as a subset of the text that uses them; ask the kernel for those that changed (call after an edit). */
  async syncEmbeds(doc: { features?: unknown[] } | null): Promise<void> {
    const used = textFontsUsed(doc);
    for (const [name, chars] of used) {
      const e = this.entries.get(name);
      if (!e || e.source !== 'embedded' || e.subset || e.bytes.length <= this.max) continue;
      if (e.embed?.key === chars) continue;
      const r = await this.kernel({ type: 'subsetFont', name, text: chars });
      if (!r.ok) continue;
      const res = r.result as { data?: string; hash?: string };
      if (typeof res.data === 'string') { e.embed = { key: chars, data: res.data, hash: String(res.hash ?? '') }; this.rev++; }
    }
  }

  /** The `fonts` field for `doc`: every pooled font its text entities use (the pool itself may hold more, so undo can come back to one). */
  fieldsFor(doc: { features?: unknown[] } | null): DocFont[] {
    const out: DocFont[] = [];
    for (const name of textFontsUsed(doc).keys()) {
      const e = this.entries.get(name);
      if (!e) continue;
      if (e.source === 'curated') { out.push({ name, hash: e.hash, source: 'curated', id: e.id }); continue; }
      const big = e.bytes.length > this.max && !e.subset;
      if (big) {
        if (!e.embed) continue;   // not subset yet: syncEmbeds runs after every edit
        out.push({ name, hash: e.embed.hash, source: 'embedded', ...(e.family ? { family: e.family } : {}), data: e.embed.data, subset: true });
      } else {
        e.b64 ??= toBase64(e.bytes);
        out.push({ name, hash: e.hash, source: 'embedded', ...(e.family ? { family: e.family } : {}), data: e.b64, ...(e.subset ? { subset: true } : {}) });
      }
    }
    return out;
  }

  /** The pin an entity gets for this font (`fontHash`), or undefined when the file is embedded as a subset (the name already carries the original's hash). */
  pinFor(name: string): string | undefined {
    const e = this.entries.get(name);
    if (!e || e.subset || (e.source === 'embedded' && e.bytes.length > this.max)) return undefined;
    return pinOf(e.hash);
  }

  /** Text in `features` may name a curated font by its id (a script does) that is not loaded yet: fetch and load those. Other unknown names are left to the kernel (`textFontNotLoaded`). */
  async ensureFor(features: unknown[]): Promise<FontProblem[]> {
    const missing = [...textFontsUsed({ features }).keys()].filter((n) => !this.entries.has(n) && !isBuiltinFont(n));
    if (!missing.length || !this.deps.source) return [];
    let ids: Set<string>;
    try { ids = new Set((await this.deps.source.manifest()).map((c) => c.id)); } catch { return []; }
    const problems: FontProblem[] = [];
    for (const n of missing) if (ids.has(n)) { const r = await this.addCurated(n); if (!r.ok) problems.push(r.problem); }
    return problems;
  }
}
