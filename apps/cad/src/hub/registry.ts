// Community Package Hub registry schema, validator, search/filter/sort helpers, curated starter catalog,
// and cached custom registry loader with offline fallback.
// Everything loaded from a remote hub index is untrusted JSON: it is validated strictly against the
// `ck-hub` v1 schema, cleaned of control/bidi characters, and never executed as code.
import { clean, httpsUrl } from '../library/manifest';
import { catalogAddress } from './relay';
import { readLimited, type FetchLike, type FetchResponse } from '../library/source';
import type { KV } from '../library/registry';
import { SOLIDCRAFT_PLUGINS_PACKAGES } from './solidcraftCatalog';

export const HUB_FORMAT = 'ck-hub' as const;
export const HUB_VERSION = 1 as const;
export const HUB_MAX_BYTES = 2 * 1024 * 1024;
export const HUB_MAX_PACKAGES = 2000;
export const BUILTIN_REGISTRY_ID = 'builtin';
export const SOLIDCRAFT_PLUGINS_URL = 'https://tharje.github.io/solidcraft-plugins/data/plugins.json';

export type HubPackageKind = 'part' | 'assembly' | 'plugin' | 'library';
export const HUB_PACKAGE_KINDS: readonly HubPackageKind[] = ['part', 'assembly', 'plugin', 'library'];

export interface HubPackage {
  id: string;
  name: string;
  kind: HubPackageKind;
  summary: string;
  author: string;
  version: string;
  /** SPDX license identifier or expression (e.g. `MIT`, `Apache-2.0`, `MIT OR Apache-2.0`). */
  license: string;
  category: string;
  tags: string[];
  /** `github:owner/repo@tag` (or `github:owner/repo`) or an `https://` URL. */
  source: string;
  /** Optional direct `.zip` release download URL (`https://`). */
  downloadUrl?: string;
  /** Optional 64-character lowercase hex SHA-256 integrity hash. */
  sha256?: string;
  /** Optional HTTPS preview image URL. */
  preview?: string;
  /** Optional HTTPS homepage or documentation URL. */
  homepage?: string;
  /** Optional ISO date string (YYYY-MM-DD) for recency sorting. */
  updatedAt?: string;
}

export interface HubIndex {
  format: typeof HUB_FORMAT;
  version: typeof HUB_VERSION;
  name: string;
  description?: string;
  homepage?: string;
  packages: HubPackage[];
}

export interface HubDiagnostic {
  path: string;
  message: string;
}

export type HubParseResult =
  | { ok: true; index: HubIndex; warnings: HubDiagnostic[] }
  | { ok: false; diagnostics: HubDiagnostic[] };

export interface ValidateHubOptions {
  /** Allow `http://localhost` / `http://127.0.0.1` URLs (development and tests only). */
  allowLocalhost?: boolean;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/;
const SPDX_RE = /^[A-Za-z0-9][A-Za-z0-9.+\-() ]{0,63}$/;
const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const GITHUB_RE = /^github:([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:@([A-Za-z0-9_./-]{1,100}))?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;

/** Validate a package source: `github:owner/repo[@tag]` or an `https://` URL without embedded credentials. */
export function normalizeHubSource(raw: unknown, allowLocalhost = false): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  const gh = GITHUB_RE.exec(s);
  if (gh) {
    const ref = gh[3];
    if (ref && (ref.includes('..') || ref.startsWith('/') || ref.endsWith('/'))) return null;
    return `github:${gh[1]}/${gh[2]}${ref ? '@' + ref : ''}`;
  }
  const url = httpsUrl(s, allowLocalhost);
  if (!url) return null;
  const parsed = new URL(url);
  if (parsed.username || parsed.password) return null;
  return parsed.href;
}

export function isValidHubSource(source: string, allowLocalhost = false): boolean {
  return normalizeHubSource(source, allowLocalhost) !== null;
}

/** A human-browsable HTTPS page for a package source (never fetched automatically). */
export function hubSourceLink(source: string): string | null {
  const gh = GITHUB_RE.exec(source.trim());
  if (gh) return `https://github.com/${gh[1]}/${gh[2]}${gh[3] ? `/tree/${gh[3]}` : ''}`;
  return httpsUrl(source);
}

/** Validate an untrusted hub index object against the `ck-hub` v1 schema with plain-English diagnostics. */
export function validateHubIndex(raw: unknown, opts: ValidateHubOptions = {}): HubParseResult {
  const diagnostics: HubDiagnostic[] = [];
  const warnings: HubDiagnostic[] = [];
  const fail = (path: string, message: string) => { diagnostics.push({ path, message }); };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, diagnostics: [{ path: '', message: 'Registry index must be a JSON object.' }] };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.format !== HUB_FORMAT) {
    fail('format', `Expected format "${HUB_FORMAT}", got ${JSON.stringify(obj.format)}.`);
  }
  if (obj.version !== HUB_VERSION) {
    fail('version', `Unsupported registry version ${JSON.stringify(obj.version)} (expected ${HUB_VERSION}).`);
  }

  const name = typeof obj.name === 'string' ? clean(obj.name) : '';
  if (!name || name.length > 100) {
    fail('name', 'Registry name must be a non-empty string (up to 100 characters).');
  }

  let description: string | undefined;
  if (obj.description !== undefined) {
    if (typeof obj.description === 'string' && obj.description.length <= 2000) description = clean(obj.description);
    else fail('description', 'Registry description must be a string up to 2000 characters.');
  }

  let homepage: string | undefined;
  if (obj.homepage !== undefined) {
    const h = httpsUrl(obj.homepage, opts.allowLocalhost);
    if (h) homepage = h;
    else fail('homepage', 'Registry homepage must be a valid https:// URL.');
  }

  const packages: HubPackage[] = [];
  if (!Array.isArray(obj.packages)) {
    fail('packages', 'Registry must include a "packages" array.');
  } else if (obj.packages.length > HUB_MAX_PACKAGES) {
    fail('packages', `Registry lists ${obj.packages.length} packages (maximum is ${HUB_MAX_PACKAGES}).`);
  } else {
    const seen = new Set<string>();
    obj.packages.forEach((item, i) => {
      const at = `packages[${i}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        fail(at, 'Package entry must be a JSON object.');
        return;
      }
      const p = item as Record<string, unknown>;
      const before = diagnostics.length;

      const id = typeof p.id === 'string' && ID_RE.test(p.id.trim()) ? p.id.trim() : null;
      if (!id) fail(`${at}.id`, 'Package id must be 1–64 characters using letters, digits, ".", "_", or "-".');
      else if (seen.has(id)) fail(`${at}.id`, `Duplicate package id "${id}".`);
      else seen.add(id);

      const pkgName = typeof p.name === 'string' ? clean(p.name) : '';
      if (!pkgName || pkgName.length > 120) fail(`${at}.name`, 'Package name must be a non-empty string (up to 120 characters).');

      const kind = typeof p.kind === 'string' && (HUB_PACKAGE_KINDS as readonly string[]).includes(p.kind)
        ? (p.kind as HubPackageKind)
        : null;
      if (!kind) fail(`${at}.kind`, `Package kind must be one of: ${HUB_PACKAGE_KINDS.join(', ')}.`);

      const summary = typeof p.summary === 'string' ? clean(p.summary) : '';
      if (!summary || summary.length > 500) fail(`${at}.summary`, 'Package summary must be a non-empty string (up to 500 characters).');

      const author = typeof p.author === 'string' ? clean(p.author) : '';
      if (!author || author.length > 80) fail(`${at}.author`, 'Package author must be a non-empty string (up to 80 characters).');

      const version = typeof p.version === 'string' && VERSION_RE.test(p.version.trim()) ? p.version.trim() : '';
      if (!version) fail(`${at}.version`, 'Package version must be a valid version string (e.g. "1.0.0").');

      const rawLic = typeof p.license === 'string' ? clean(p.license) : '';
      const license = rawLic && SPDX_RE.test(rawLic) ? rawLic : '';
      if (!license) fail(`${at}.license`, 'Package license must be a valid SPDX license identifier (e.g. "MIT" or "Apache-2.0").');

      let category = 'general';
      if (p.category !== undefined) {
        const c = typeof p.category === 'string' ? clean(p.category).toLowerCase() : '';
        if (c && c.length <= 40) category = c;
        else fail(`${at}.category`, 'Package category must be a non-empty string (up to 40 characters).');
      }

      const tags: string[] = [];
      if (p.tags !== undefined) {
        if (!Array.isArray(p.tags) || p.tags.length > 20) {
          fail(`${at}.tags`, 'Package tags must be an array of up to 20 short strings.');
        } else {
          const tagSet = new Set<string>();
          for (const t of p.tags) {
            const cleaned = typeof t === 'string' ? clean(t).toLowerCase() : '';
            if (!cleaned || cleaned.length > 40) {
              fail(`${at}.tags`, 'Each package tag must be a non-empty string (up to 40 characters).');
              break;
            }
            if (!tagSet.has(cleaned)) { tagSet.add(cleaned); tags.push(cleaned); }
          }
        }
      }

      const source = normalizeHubSource(p.source, opts.allowLocalhost);
      if (!source) fail(`${at}.source`, 'Package source must be a github:owner/repo[@tag] spec or an https:// URL.');

      let downloadUrl: string | undefined;
      if (p.downloadUrl !== undefined && p.downloadUrl !== null && p.downloadUrl !== '') {
        const d = httpsUrl(String(p.downloadUrl), opts.allowLocalhost);
        if (!d) warnings.push({ path: `${at}.downloadUrl`, message: 'Ignored non-HTTPS downloadUrl.' });
        else downloadUrl = d;
      }

      let sha256: string | undefined;
      if (p.sha256 !== undefined && p.sha256 !== '') {
        if (typeof p.sha256 === 'string' && SHA256_RE.test(p.sha256.trim())) sha256 = p.sha256.trim().toLowerCase();
        else fail(`${at}.sha256`, 'Package sha256 must be a 64-character hexadecimal SHA-256 hash.');
      }

      let preview: string | undefined;
      if (p.preview !== undefined && p.preview !== '') {
        const u = httpsUrl(p.preview, opts.allowLocalhost);
        if (u) preview = u;
        else fail(`${at}.preview`, 'Package preview must be a valid https:// image URL.');
      }

      let pkgHomepage: string | undefined;
      if (p.homepage !== undefined && p.homepage !== '') {
        const u = httpsUrl(p.homepage, opts.allowLocalhost);
        if (u) pkgHomepage = u;
        else fail(`${at}.homepage`, 'Package homepage must be a valid https:// URL.');
      }

      let updatedAt: string | undefined;
      if (p.updatedAt !== undefined && p.updatedAt !== '') {
        if (typeof p.updatedAt === 'string' && ISO_DATE_RE.test(p.updatedAt.trim())) updatedAt = p.updatedAt.trim();
        else warnings.push({ path: `${at}.updatedAt`, message: 'Ignored invalid updatedAt date (expected YYYY-MM-DD).' });
      }

      if (diagnostics.length === before && id && kind && source) {
        packages.push({
          id,
          name: pkgName,
          kind,
          summary,
          author,
          version,
          license,
          category,
          tags,
          source,
          ...(downloadUrl ? { downloadUrl } : {}),
          ...(sha256 ? { sha256 } : {}),
          ...(preview ? { preview } : {}),
          ...(pkgHomepage ? { homepage: pkgHomepage } : {}),
          ...(updatedAt ? { updatedAt } : {}),
        });
      }
    });
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    warnings,
    index: {
      format: HUB_FORMAT,
      version: HUB_VERSION,
      name,
      ...(description ? { description } : {}),
      ...(homepage ? { homepage } : {}),
      packages,
    },
  };
}

/** Catalog entries not offered, by id. timber: its catalog zip is the source archive (timber-0.1.1-source.zip), with no timber.wasm in it, so it can never install; a catalog data problem for its maintainer. */
export const HUB_HIDDEN_IDS: ReadonlySet<string> = new Set(['timber']);

/** Convert a SolidCraft Plugins directory index (`https://tharje.github.io/solidcraft-plugins/data/plugins.json`,
 *  shape `{ generated, plugins: [...] }`) into a validated `ck-hub` v1 index, keeping only plugins with published releases. */
export function parseSolidCraftPluginsIndex(raw: unknown, opts: ValidateHubOptions = {}): HubParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, diagnostics: [{ path: '', message: 'SolidCraft plugin index must be a JSON object.' }] };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.plugins)) {
    return { ok: false, diagnostics: [{ path: 'plugins', message: 'Expected a "plugins" array.' }] };
  }
  const packages: HubPackage[] = [];
  const seen = new Set<string>();
  const warnings: HubDiagnostic[] = [];
  for (let i = 0; i < obj.plugins.length; i++) {
    const p = obj.plugins[i];
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const item = p as Record<string, unknown>;
    const rel = item.release;
    if (!rel || typeof rel !== 'object' || Array.isArray(rel)) continue;
    const relObj = rel as Record<string, unknown>;
    const tag = typeof relObj.tag === 'string' ? clean(relObj.tag) : '';
    const rawZip = typeof relObj.zip === 'string' ? relObj.zip.trim() : '';
    const zipUrl = rawZip ? (httpsUrl(rawZip, opts.allowLocalhost) ?? undefined) : undefined;
    // only entries with a release zip: the others (an app tag such as v0.45.0b-android) can never be installed here
    if (!zipUrl) continue;

    const repo = typeof item.repo === 'string' ? clean(item.repo) : '';
    if (!repo || !repo.includes('/')) continue;
    const rawId = typeof item.slug === 'string' ? item.slug : typeof item.id === 'string' ? item.id : repo.split('/')[1];
    let id = clean(rawId).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
    if (!id || !/^[A-Za-z0-9]/.test(id)) id = `p-${id}`;
    if (seen.has(id) || HUB_HIDDEN_IDS.has(id)) continue;

    const rawSource = tag ? `github:${repo}@${tag}` : (zipUrl ?? '');
    const source = normalizeHubSource(rawSource, opts.allowLocalhost);
    if (!source) {
      warnings.push({ path: `plugins[${i}]`, message: `Skipped "${id}": invalid source.` });
      continue;
    }

    seen.add(id);
    const name = clean(typeof item.name === 'string' ? item.name : id).slice(0, 100) || id;
    const summary = clean(typeof item.description === 'string' ? item.description : name).slice(0, 400) || name;
    const author = clean(typeof item.owner === 'string' ? item.owner : repo.split('/')[0]).slice(0, 80) || 'unknown';
    const rawVer = typeof item.version === 'string' ? clean(item.version) : tag.replace(/^v/, '');
    const version = (rawVer && VERSION_RE.test(rawVer) ? rawVer : '0.0.0').slice(0, 40);
    const rawLic = typeof item.license === 'string' ? clean(item.license) : '';
    const license = rawLic && SPDX_RE.test(rawLic) ? rawLic : 'Unknown';
    const category = clean(typeof item.category === 'string' ? item.category : 'plugins').slice(0, 40) || 'plugins';
    const tags: string[] = [];
    if (Array.isArray(item.topics)) {
      const seenTags = new Set<string>();
      for (const t of item.topics) {
        if (typeof t !== 'string') continue;
        const c = clean(t).toLowerCase().slice(0, 32);
        if (c && !seenTags.has(c) && tags.length < 12) { seenTags.add(c); tags.push(c); }
      }
    }
    const preview = typeof item.image === 'string' ? (httpsUrl(item.image, opts.allowLocalhost) ?? undefined) : undefined;
    const homepage = typeof item.url === 'string' ? (httpsUrl(item.url, opts.allowLocalhost) ?? undefined) : undefined;
    const rawUpd = typeof item.updated === 'string' ? item.updated.trim() : '';
    const updatedAt = /^\d{4}-\d{2}-\d{2}/.test(rawUpd) ? rawUpd.slice(0, 10) : undefined;

    packages.push({
      id,
      name,
      kind: 'plugin',
      summary,
      author,
      version,
      license,
      category,
      tags,
      source,
      ...(zipUrl ? { downloadUrl: zipUrl } : {}),
      ...(preview ? { preview } : {}),
      ...(homepage ? { homepage } : {}),
      ...(updatedAt ? { updatedAt } : {}),
    });
  }
  return {
    ok: true,
    warnings,
    index: {
      format: HUB_FORMAT,
      version: HUB_VERSION,
      name: 'SolidCraft Community Plugins',
      description: 'Community SolidCraft plugins with published releases from tharje.github.io/solidcraft-plugins.',
      homepage: 'https://tharje.github.io/solidcraft-plugins/',
      packages,
    },
  };
}

/** Parse a raw JSON string and validate it as a `ck-hub` v1 index (or SolidCraft `data/plugins.json`). */
export function parseHubIndexJson(text: string, opts: ValidateHubOptions = {}): HubParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      diagnostics: [{ path: '', message: `Invalid JSON in registry index: ${(e as Error).message}` }],
    };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('format' in raw) && Array.isArray((raw as Record<string, unknown>).plugins)) {
    return parseSolidCraftPluginsIndex(raw, opts);
  }
  return validateHubIndex(raw, opts);
}

// ---- Search, filter & sort -------------------------------------------------------------------------------------------

export type HubSort = 'name' | 'kind' | 'updated' | 'author';

export interface HubFilter {
  query?: string;
  kind?: HubPackageKind | 'all';
  category?: string | 'all';
  /** Single selected tag (convenience) */
  tag?: string | null;
  /** Multiple required tags (AND semantics) */
  tags?: readonly string[];
  /** Only show packages that declare a SHA-256 integrity hash */
  verifiedOnly?: boolean;
  sort?: HubSort;
}

const KIND_ORDER: Record<HubPackageKind, number> = { plugin: 0, library: 1, assembly: 2, part: 3 };

/** Filter and sort hub packages by query, kind, category, tags, SHA-256 verification, and sort order. */
export function filterHubPackages(packages: readonly HubPackage[], filter: HubFilter = {}): HubPackage[] {
  const tokens = (filter.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const kind = filter.kind && filter.kind !== 'all' ? filter.kind : null;
  const category = filter.category && filter.category !== 'all' ? filter.category.toLowerCase() : null;
  const reqTags = new Set<string>();
  if (filter.tag) reqTags.add(filter.tag.toLowerCase());
  if (filter.tags) for (const tg of filter.tags) if (tg) reqTags.add(tg.toLowerCase());

  const matched = packages.filter((p) => {
    if (kind && p.kind !== kind) return false;
    if (category && p.category.toLowerCase() !== category) return false;
    if (filter.verifiedOnly && !p.sha256) return false;
    if (reqTags.size > 0) {
      const pTags = new Set(p.tags.map((x) => x.toLowerCase()));
      for (const req of reqTags) if (!pTags.has(req)) return false;
    }
    if (tokens.length > 0) {
      const hay = `${p.name} ${p.id} ${p.summary} ${p.author} ${p.category} ${p.license} ${p.tags.join(' ')}`.toLowerCase();
      for (const tok of tokens) if (!hay.includes(tok)) return false;
    }
    return true;
  });

  const sort = filter.sort ?? 'name';
  return [...matched].sort((a, b) => {
    if (sort === 'kind') {
      const d = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (d !== 0) return d;
    } else if (sort === 'updated') {
      const au = a.updatedAt ?? '';
      const bu = b.updatedAt ?? '';
      if (au !== bu) return bu.localeCompare(au);
    } else if (sort === 'author') {
      const d = a.author.localeCompare(b.author);
      if (d !== 0) return d;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Sorted unique categories present in a list of packages. */
export function hubCategories(packages: readonly HubPackage[]): string[] {
  return [...new Set(packages.map((p) => p.category.toLowerCase()))].sort((a, b) => a.localeCompare(b));
}

/** Sorted unique tags present in a list of packages. */
export function hubTags(packages: readonly HubPackage[]): string[] {
  return [...new Set(packages.flatMap((p) => p.tags.map((x) => x.toLowerCase())))].sort((a, b) => a.localeCompare(b));
}

// ---- Built-in SolidCraft Community Plugins catalog (released plugins from tharje.github.io/solidcraft-plugins) ------

export const BUILTIN_HUB_INDEX: HubIndex = {
  format: HUB_FORMAT,
  version: HUB_VERSION,
  name: 'SolidCraft Community Plugins',
  description: 'Community SolidCraft plugins with published releases from tharje.github.io/solidcraft-plugins.',
  homepage: 'https://tharje.github.io/solidcraft-plugins/',
  packages: SOLIDCRAFT_PLUGINS_PACKAGES,
};

// ---- Remote registry fetching, caching & offline fallback ------------------------------------------------------------

export class HubError extends Error {
  constructor(
    readonly code: 'url' | 'network' | 'http' | 'tooLarge' | 'parse' | 'schema',
    message: string,
    readonly diagnostics: HubDiagnostic[] = [],
  ) {
    super(message);
    this.name = 'HubError';
  }
}

export interface FetchHubOptions extends ValidateHubOptions {
  fetch: FetchLike;
  maxBytes?: number;
}

/** Fetch, size-limit, parse, and validate a remote `ck-hub` v1 registry JSON file. */
export async function fetchHubIndex(url: string, opts: FetchHubOptions): Promise<HubIndex> {
  const safeUrl = httpsUrl(url.trim(), opts.allowLocalhost);
  if (!safeUrl) {
    throw new HubError('url', 'Registry URL must use https://.');
  }
  const parsedUrl = new URL(safeUrl);
  if (parsedUrl.username || parsedUrl.password) {
    throw new HubError('url', 'Registry URL must not include a username or password.');
  }
  let res: FetchResponse;
  try {
    res = await opts.fetch(safeUrl, { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer' });
  } catch {
    throw new HubError('network', 'Could not reach the registry server. Check your connection or try again later.');
  }
  if (res.url && !httpsUrl(res.url, opts.allowLocalhost)) {
    throw new HubError('url', 'Registry redirect left https:// and was blocked.');
  }
  if (!res.ok) {
    throw new HubError('http', `Registry server returned HTTP ${res.status}.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = await readLimited(res, opts.maxBytes ?? HUB_MAX_BYTES);
  } catch {
    throw new HubError('tooLarge', 'Registry index exceeds the 2 MB size limit.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HubError('parse', 'Registry index is not valid UTF-8 text.');
  }
  const result = parseHubIndexJson(text, { allowLocalhost: opts.allowLocalhost });
  if (!result.ok) {
    const summary = result.diagnostics.slice(0, 3).map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join(' ');
    throw new HubError('schema', summary || 'Registry index did not match the ck-hub v1 schema.', result.diagnostics);
  }
  return result.index;
}

export interface HubRegistryEntry {
  id: string;
  name: string;
  url?: string;
  builtin?: boolean;
  addedAt: number;
}

export interface HubLoadResult {
  registryId: string;
  index: HubIndex;
  offline: boolean;
  cachedAt?: number;
  error?: string;
}

interface StoredRegistries {
  v: 1;
  active: string;
  custom: HubRegistryEntry[];
}

interface CachedRegistryMap {
  v: 2;
  /** the version of the index parser and filters that produced these entries: a cache made by another one is dropped, so entries since removed or hidden do not stay on screen */
  p: number;
  entries: Record<string, { at: number; index: HubIndex }>;
}

const REG_KEY = 'ck.hub.registries.v1';
const CACHE_KEY = 'ck.hub.cache.v2';
const OLD_CACHE_KEY = 'ck.hub.cache.v1';
/** Raise this whenever parseSolidCraftPluginsIndex or the catalog filters change what an index contains. */
export const HUB_PARSER_VERSION = 2;
/** The built-in registry's cached copy is used for a day; after that the app's own snapshot shows until Refresh. */
const BUILTIN_CACHE_MAX_AGE_MS = 24 * 3600 * 1000;

export interface HubStoreDeps {
  fetch: FetchLike;
  kv: KV | null;
  allowLocalhost?: boolean;
  now?: () => number;
}

/** Manages the built-in starter catalog plus user-added custom registry URLs with memory + localStorage caching and offline fallback. */
export class HubRegistryStore {
  private active = BUILTIN_REGISTRY_ID;
  private custom: HubRegistryEntry[] = [];
  private memCache = new Map<string, { at: number; index: HubIndex }>();
  private listeners = new Set<() => void>();

  constructor(private readonly deps: HubStoreDeps) {
    this.loadSaved();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private loadSaved(): void {
    try {
      const raw = this.deps.kv?.getItem(REG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredRegistries;
        if (parsed && parsed.v === 1 && Array.isArray(parsed.custom)) {
          this.custom = parsed.custom.filter(
            (e): e is HubRegistryEntry =>
              !!e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.url === 'string' && !!httpsUrl(e.url, this.deps.allowLocalhost),
          );
          if (typeof parsed.active === 'string' && (parsed.active === BUILTIN_REGISTRY_ID || this.custom.some((e) => e.id === parsed.active))) {
            this.active = parsed.active;
          }
        }
      }
    } catch { /* ignore corrupt storage */ }
    try {
      const rawCache = this.deps.kv?.getItem(CACHE_KEY);
      if (rawCache) {
        const parsed = JSON.parse(rawCache) as CachedRegistryMap;
        if (parsed && parsed.v === 2 && parsed.p === HUB_PARSER_VERSION && parsed.entries && typeof parsed.entries === 'object') {
          for (const [id, entry] of Object.entries(parsed.entries)) {
            if (entry && typeof entry.at === 'number') {
              const checked = validateHubIndex(entry.index, { allowLocalhost: this.deps.allowLocalhost });
              if (checked.ok) this.memCache.set(id, { at: entry.at, index: checked.index });
            }
          }
        }
      }
    } catch { /* ignore corrupt cache */ }
    try { this.deps.kv?.removeItem(OLD_CACHE_KEY); } catch { /* ignore */ }
  }

  private saveRegistries(): void {
    try {
      const data: StoredRegistries = { v: 1, active: this.active, custom: this.custom };
      this.deps.kv?.setItem(REG_KEY, JSON.stringify(data));
    } catch { /* storage full or unavailable */ }
    this.notify();
  }

  private saveCache(): void {
    try {
      const entries: Record<string, { at: number; index: HubIndex }> = {};
      for (const [id, val] of this.memCache) entries[id] = val;
      const data: CachedRegistryMap = { v: 2, p: HUB_PARSER_VERSION, entries };
      this.deps.kv?.setItem(CACHE_KEY, JSON.stringify(data));
    } catch { /* storage full or unavailable */ }
  }

  listRegistries(): HubRegistryEntry[] {
    return [
      { id: BUILTIN_REGISTRY_ID, name: BUILTIN_HUB_INDEX.name, url: SOLIDCRAFT_PLUGINS_URL, builtin: true, addedAt: 0 },
      ...this.custom,
    ];
  }

  activeRegistryId(): string {
    return this.active;
  }

  setActiveRegistry(id: string): void {
    if (id !== BUILTIN_REGISTRY_ID && !this.custom.some((e) => e.id === id)) return;
    if (this.active === id) return;
    this.active = id;
    this.saveRegistries();
  }

  /** Fetch, validate, cache, and save a custom registry URL, then switch to it. */
  async addRegistry(rawUrl: string): Promise<HubLoadResult> {
    const safeUrl = httpsUrl(rawUrl.trim(), this.deps.allowLocalhost);
    if (!safeUrl) throw new HubError('url', 'Registry URL must use https://.');
    const index = await fetchHubIndex(safeUrl, { fetch: this.deps.fetch, allowLocalhost: this.deps.allowLocalhost });
    const now = (this.deps.now ?? Date.now)();
    const id = safeUrl;
    const existing = this.custom.find((e) => e.id === id);
    if (existing) {
      existing.name = index.name;
    } else {
      this.custom.push({ id, name: index.name, url: safeUrl, addedAt: now });
    }
    this.memCache.set(id, { at: now, index });
    this.active = id;
    this.saveCache();
    this.saveRegistries();
    return { registryId: id, index, offline: false, cachedAt: now };
  }

  /** Remove a custom registry (cannot remove the built-in starter catalog). */
  removeRegistry(id: string): void {
    if (id === BUILTIN_REGISTRY_ID) return;
    this.custom = this.custom.filter((e) => e.id !== id);
    this.memCache.delete(id);
    if (this.active === id) this.active = BUILTIN_REGISTRY_ID;
    this.saveCache();
    this.saveRegistries();
  }

  /** Load a registry by id (defaults to active). Uses cache unless `refresh: true`; falls back to cache or snapshot when offline. */
  async load(id: string = this.active, opts: { refresh?: boolean } = {}): Promise<HubLoadResult> {
    if (id === BUILTIN_REGISTRY_ID) {
      const stored = this.memCache.get(BUILTIN_REGISTRY_ID);
      const cached = stored && (this.deps.now ?? Date.now)() - stored.at < BUILTIN_CACHE_MAX_AGE_MS ? stored : undefined;
      if (!opts.refresh) {
        return cached
          ? { registryId: BUILTIN_REGISTRY_ID, index: cached.index, offline: false, cachedAt: cached.at }
          : { registryId: BUILTIN_REGISTRY_ID, index: BUILTIN_HUB_INDEX, offline: false };
      }
      try {
        const index = await fetchHubIndex(catalogAddress(SOLIDCRAFT_PLUGINS_URL), { fetch: this.deps.fetch, allowLocalhost: this.deps.allowLocalhost });
        const now = (this.deps.now ?? Date.now)();
        this.memCache.set(BUILTIN_REGISTRY_ID, { at: now, index });
        this.saveCache();
        return { registryId: BUILTIN_REGISTRY_ID, index, offline: false, cachedAt: now };
      } catch (e) {
        const msg = (e as Error).message || 'Could not refresh registry.';
        return {
          registryId: BUILTIN_REGISTRY_ID,
          index: cached ? cached.index : BUILTIN_HUB_INDEX,
          offline: true,
          ...(cached ? { cachedAt: cached.at } : {}),
          error: msg,
        };
      }
    }
    const entry = this.custom.find((e) => e.id === id);
    if (!entry?.url) {
      return { registryId: BUILTIN_REGISTRY_ID, index: BUILTIN_HUB_INDEX, offline: false };
    }
    const cached = this.memCache.get(id);
    if (cached && !opts.refresh) {
      return { registryId: id, index: cached.index, offline: false, cachedAt: cached.at };
    }
    try {
      const index = await fetchHubIndex(entry.url, { fetch: this.deps.fetch, allowLocalhost: this.deps.allowLocalhost });
      const now = (this.deps.now ?? Date.now)();
      entry.name = index.name;
      this.memCache.set(id, { at: now, index });
      this.saveCache();
      this.saveRegistries();
      return { registryId: id, index, offline: false, cachedAt: now };
    } catch (e) {
      const msg = (e as Error).message || 'Could not refresh registry.';
      if (cached) {
        return { registryId: id, index: cached.index, offline: true, cachedAt: cached.at, error: msg };
      }
      throw e;
    }
  }
}
