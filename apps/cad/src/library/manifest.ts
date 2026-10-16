// The library manifest (`library.json`, format `fwlib`): types, the licence allow-list and the validator.
// Everything in a manifest is untrusted text from a remote server: it is checked against this schema, trimmed to the known
// fields (unknown fields are ignored so the format can grow), stripped of control characters and never interpreted as markup.

export const MANIFEST_MAX_BYTES = 1024 * 1024;
export const PART_MAX_BYTES = 16 * 1024 * 1024;
export const THUMB_MAX_BYTES = 1024 * 1024;
export const MAX_PARTS = 5000;

export interface LibraryPart {
  id: string;
  title: string;
  category: string;
  tags: string[];
  /** path relative to the manifest */
  file: string;
  thumb?: string;
  licence?: string;
  source?: string;
  bytes?: number;
  sha256?: string;
}
export interface LibraryManifest {
  format: 'fwlib';
  version: 1;
  name: string;
  description?: string;
  homepage?: string;
  licence?: string;
  parts: LibraryPart[];
}

export interface ManifestIssue { path: string; code: ManifestIssueCode }
export type ManifestIssueCode = 'notObject' | 'format' | 'version' | 'name' | 'description' | 'homepage' | 'licence' | 'parts' | 'tooManyParts'
  | 'partShape' | 'partId' | 'duplicateId' | 'title' | 'category' | 'tags' | 'file' | 'thumb' | 'source' | 'bytes' | 'sha256' | 'sha256Missing'
  /** warning only: the part lists no thumbnail */
  | 'thumbMissing';

/** `warnings` do not fail a manifest: a part without a `thumb` is shown with a thumbnail made on this device, or a placeholder. */
export type ManifestResult = { ok: true; manifest: LibraryManifest; warnings: ManifestIssue[] } | { ok: false; issues: ManifestIssue[] };

/** Licences that need no confirmation (SPDX ids, compared case-insensitively; a version suffix of the families is accepted). */
const PERMISSIVE = [/^MIT(-0)?$/, /^BSD-[23]-Clause(-Clear)?$/, /^0BSD$/, /^Apache-2\.0$/, /^ISC$/, /^CC0-1\.0$/, /^CC-BY-(\d\.\d)$/, /^OFL-1\.1$/, /^Unlicense$/, /^Zlib$/];
export type LicenceClass = 'permissive' | 'other' | 'unknown';
export function licenceClass(l: string | undefined | null): LicenceClass {
  const s = (l ?? '').trim();
  if (!s) return 'unknown';
  if (/\s+(OR|AND|WITH)\s+/i.test(s)) {   // a compound expression is permissive only if every term is
    const terms = s.split(/\s+(?:OR|AND)\s+/i).map((x) => x.replace(/[()]/g, '').trim());
    return terms.every((x) => licenceClass(x) === 'permissive') ? 'permissive' : 'other';
  }
  return PERMISSIVE.some((re) => re.test(s)) ? 'permissive' : 'other';
}

const SPDX = /^[A-Za-z0-9][A-Za-z0-9.+\-() ]{0,63}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SHA = /^[0-9a-fA-F]{64}$/;
// C0/C1 controls, bidi overrides and isolates, zero-width marks: nothing a title or tag needs, and some can fake what a label says
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
export const clean = (s: string): string => s.replace(BAD_CHARS, ' ').replace(/\s+/g, ' ').trim();

/** A path relative to the manifest: no scheme, no absolute path, no `..`, no query or fragment, no backslash. */
export function relativePathOk(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 256) return false;
  if (/^[\\/]/.test(p) || /[\\?#:\u0000-\u001f]/.test(p)) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '' || seg === '.');
}

/** `https://` URLs only (plus `http://localhost` when `allowLocalhost`, for development and tests). */
export function httpsUrl(u: unknown, allowLocalhost = false): string | null {
  if (typeof u !== 'string' || u.length > 2048) return null;
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol === 'https:' || (allowLocalhost && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) return url.href;
  return null;
}

export interface ValidateOptions {
  /** Remote libraries must give a sha256 for every part. */
  requireSha?: boolean;
  allowLocalhost?: boolean;
}

export function validateManifest(raw: unknown, opts: ValidateOptions = {}): ManifestResult {
  const issues: ManifestIssue[] = [];
  const warnings: ManifestIssue[] = [];
  const bad = (path: string, code: ManifestIssueCode) => { issues.push({ path, code }); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: [{ path: '', code: 'notObject' }] };
  const m = raw as Record<string, unknown>;
  if (m.format !== 'fwlib') bad('format', 'format');
  if (m.version !== 1) bad('version', 'version');
  const name = typeof m.name === 'string' ? clean(m.name) : '';
  if (!name || name.length > 100) bad('name', 'name');
  let description: string | undefined;
  if (m.description !== undefined) { if (typeof m.description === 'string' && m.description.length <= 2000) description = clean(m.description); else bad('description', 'description'); }
  let homepage: string | undefined;
  if (m.homepage !== undefined) { const h = httpsUrl(m.homepage); if (h) homepage = h; else bad('homepage', 'homepage'); }
  const licence = readLicence(m.licence, 'licence', bad);
  const parts: LibraryPart[] = [];
  if (!Array.isArray(m.parts)) bad('parts', 'parts');
  else if (m.parts.length > MAX_PARTS) bad('parts', 'tooManyParts');
  else {
    const seen = new Set<string>();
    m.parts.forEach((rp, i) => {
      const at = `parts.${i}`;
      if (!rp || typeof rp !== 'object' || Array.isArray(rp)) { bad(at, 'partShape'); return; }
      const p = rp as Record<string, unknown>;
      const before = issues.length;
      const id = typeof p.id === 'string' && ID.test(p.id) ? p.id : null;
      if (!id) bad(`${at}.id`, 'partId'); else if (seen.has(id)) bad(`${at}.id`, 'duplicateId'); else seen.add(id);
      const title = typeof p.title === 'string' ? clean(p.title) : '';
      if (!title || title.length > 120) bad(`${at}.title`, 'title');
      let category = 'other';
      if (p.category !== undefined) { const c = typeof p.category === 'string' ? clean(p.category).toLowerCase() : ''; if (c && c.length <= 40) category = c; else bad(`${at}.category`, 'category'); }
      const tags: string[] = [];
      if (p.tags !== undefined) {
        if (Array.isArray(p.tags) && p.tags.length <= 20 && p.tags.every((x) => typeof x === 'string' && clean(x) && x.length <= 40)) for (const x of p.tags as string[]) tags.push(clean(x).toLowerCase());
        else bad(`${at}.tags`, 'tags');
      }
      if (!relativePathOk(p.file) || !/\.(ckpart|json)$/i.test(p.file as string)) bad(`${at}.file`, 'file');
      let thumb: string | undefined;
      if (p.thumb === undefined) warnings.push({ path: `${at}.thumb`, code: 'thumbMissing' });
      if (p.thumb !== undefined) { if (relativePathOk(p.thumb) && /\.(png|webp|jpe?g)$/i.test(p.thumb as string)) thumb = p.thumb as string; else bad(`${at}.thumb`, 'thumb'); }
      const plicence = readLicence(p.licence, `${at}.licence`, bad);
      let source: string | undefined;
      if (p.source !== undefined) { const s = httpsUrl(p.source); if (s) source = s; else bad(`${at}.source`, 'source'); }
      let bytes: number | undefined;
      if (p.bytes !== undefined) { if (typeof p.bytes === 'number' && Number.isInteger(p.bytes) && p.bytes >= 0 && p.bytes <= PART_MAX_BYTES) bytes = p.bytes; else bad(`${at}.bytes`, 'bytes'); }
      let sha256: string | undefined;
      if (p.sha256 !== undefined) { if (typeof p.sha256 === 'string' && SHA.test(p.sha256)) sha256 = p.sha256.toLowerCase(); else bad(`${at}.sha256`, 'sha256'); }
      else if (opts.requireSha) bad(`${at}.sha256`, 'sha256Missing');
      if (issues.length === before && id) parts.push({ id, title, category, tags, file: p.file as string, ...(thumb ? { thumb } : {}), ...(plicence ? { licence: plicence } : {}), ...(source ? { source } : {}), ...(bytes !== undefined ? { bytes } : {}), ...(sha256 ? { sha256 } : {}) });
    });
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, warnings, manifest: { format: 'fwlib', version: 1, name, ...(description ? { description } : {}), ...(homepage ? { homepage } : {}), ...(licence ? { licence } : {}), parts } };
}

function readLicence(v: unknown, path: string, bad: (p: string, c: ManifestIssueCode) => void): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;   // missing means "unknown"
  if (typeof v === 'string' && SPDX.test(clean(v))) return clean(v);
  bad(path, 'licence');
  return undefined;
}

/** The licence a part is under: its own, else the library's; undefined is "unknown". */
export const effectiveLicence = (m: Pick<LibraryManifest, 'licence'>, p: Pick<LibraryPart, 'licence'>): string | undefined => p.licence ?? m.licence;
