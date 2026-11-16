// Plugin packages: a folder, a zip or a GitHub tag with `plugin.json` and the script files it names. Inspecting a package never runs it: it
// checks the manifest, the file list, sizes and hashes, and says what installing would do. Nothing here touches the DOM or the kernel.
import { parseManifest, safePath, type PluginManifest } from './manifest';

/** Largest package, one file, and file count: a generator is a few kilobytes of script. */
export const MAX_PACKAGE_BYTES = 1024 * 1024;
export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_SCRIPT_CHARS = 40000;   // the script runner's own limit (MAX_SOURCE in @kit/script)
export const MAX_FILES = 64;
export const ALLOWED_EXTENSIONS = ['.json', '.js', '.md', '.txt'];
/** A wasm package carries a compiled component: bigger files, and .wasm allowed (nothing else changes: every file is hashed, and the component only ever runs in the sandbox). */
export const WASM_MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
export const WASM_MAX_FILE_BYTES = 4 * 1024 * 1024;
/** Text a generator script must not contain: reaching the global scope, building code from strings, importing or loading. This is a lint to catch accidents and
 *  casual abuse, NOT a security boundary (see the plan, section 5: untrusted code needs the sandboxed Worker). */
const BLOCKED = /\b(eval|Function|import|require|fetch|XMLHttpRequest|WebSocket|importScripts|globalThis|window|self|document|localStorage|sessionStorage|indexedDB|process|constructor|prototype|__proto__|Reflect|Proxy|setTimeout|setInterval)\b/;

export interface Inspection {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: PluginManifest;
  /** the text of every file by path (plugin.json included) */
  files?: Record<string, string>;
  /** sha256 over the sorted file list: the pin of this exact package */
  hash?: string;
  /** generator id -> script source */
  scripts?: Record<string, string>;
  /** the .wasm files of a wasm package, by path */
  binaries?: Record<string, Uint8Array>;
}

const hex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer));
}
/** One hash for a whole package: sha256 of "path\0sha256-of-file\n" lines, sorted by path. Same files, same hash, whatever the archive format or compression. */
export async function packageHash(files: Record<string, Uint8Array | string>): Promise<string> {
  const lines: string[] = [];
  for (const path of Object.keys(files).sort()) lines.push(`${path}\0${await sha256Hex(files[path])}\n`);
  return sha256Hex(lines.join(''));
}

/** A zip wraps its files in one folder as often as not ("repo-1.0/plugin.json"): strip a folder that holds everything. */
export function stripWrapper(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  const names = [...files.keys()].filter((n) => !n.endsWith('/'));
  if (names.length && !files.has('plugin.json')) {
    const first = names[0].split('/')[0];
    if (names.every((n) => n.startsWith(first + '/')) && names.some((n) => n === `${first}/plugin.json`)) {
      return new Map(names.map((n) => [n.slice(first.length + 1), files.get(n)!]));
    }
  }
  return new Map(names.map((n) => [n, files.get(n)!]));
}

export async function inspectPackage(input: Map<string, Uint8Array>): Promise<Inspection> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fail = (): Inspection => ({ ok: false, errors, warnings });
  const files = stripWrapper(input);
  if (files.size > MAX_FILES) errors.push(`${files.size} files: a plugin has at most ${MAX_FILES}`);
  const raw = files.get('plugin.json');
  if (!raw) { errors.push('plugin.json is missing at the top of the package'); return fail(); }
  let json: unknown;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch (e) { errors.push(`plugin.json is not valid JSON: ${(e as Error).message}`); return fail(); }
  const wasmPkg = !!json && typeof json === 'object' && (json as { wasm?: unknown }).wasm !== undefined;
  const exts = wasmPkg ? [...ALLOWED_EXTENSIONS, '.wasm'] : ALLOWED_EXTENSIONS;
  const maxFile = wasmPkg ? WASM_MAX_FILE_BYTES : MAX_FILE_BYTES, maxTotal = wasmPkg ? WASM_MAX_PACKAGE_BYTES : MAX_PACKAGE_BYTES;
  let total = 0;
  for (const [path, data] of files) {
    total += data.length;
    if (!safePath(path)) { errors.push(`"${path}" is not a safe relative path`); continue; }
    if (!exts.some((e) => path.toLowerCase().endsWith(e)) && !/^(license|licence|notice|copying)$/i.test(path)) errors.push(`"${path}": only ${exts.join(', ')} files are allowed in this plugin`);
    if (data.length > maxFile) errors.push(`"${path}" is ${Math.round(data.length / 1024)} KB: a file may be at most ${maxFile / 1024} KB`);
  }
  if (total > maxTotal) errors.push(`the package is ${Math.round(total / 1024)} KB: at most ${maxTotal / 1024} KB`);
  if (errors.length) return fail();
  const parsed = parseManifest(json);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings };
  const manifest = parsed.manifest;
  const text: Record<string, string> = {};
  const binaries: Record<string, Uint8Array> = {};
  for (const [path, data] of files) {
    if (path.toLowerCase().endsWith('.wasm')) { binaries[path] = data; continue; }
    try { text[path] = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { errors.push(`"${path}" is not valid UTF-8 text`); }
  }
  const scripts: Record<string, string> = {};
  if (manifest.wasm) {
    if (!manifest.files) errors.push('a wasm plugin must list the sha256 of every file in "files" (tools/plugin_wasm_pack.mjs does)');
    if (text[manifest.wasm.js] === undefined) errors.push(`wasm.js "${manifest.wasm.js}" is not in the package`);
    for (const c of manifest.wasm.cores) if (!binaries[c]) errors.push(`wasm.cores "${c}" is not in the package`);
    for (const [path, data] of Object.entries(binaries)) if (data.length < 8 || data[0] !== 0 || data[1] !== 0x61 || data[2] !== 0x73 || data[3] !== 0x6d) errors.push(`"${path}" is not a WebAssembly module`);
    warnings.push(`this plugin runs compiled code (WebAssembly). It runs sandboxed and can only call these app commands: ${manifest.wasm.commands.join(', ')}`);
  }
  for (const g of manifest.wasm ? [] : manifest.contributes.generators) {
    if (!g.script) { errors.push(`generator "${g.id}" has no "script": an installed plugin's generators are scripts`); continue; }
    if (!g.script.toLowerCase().endsWith('.js')) { errors.push(`generator "${g.id}": the script "${g.script}" must be a .js file`); continue; }
    const src = text[g.script];
    if (src === undefined) { errors.push(`generator "${g.id}": the script "${g.script}" is not in the package`); continue; }
    if (src.length > MAX_SCRIPT_CHARS) errors.push(`"${g.script}" is ${src.length} characters: the script runner takes at most ${MAX_SCRIPT_CHARS}`);
    const bad = BLOCKED.exec(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''));
    if (bad) errors.push(`"${g.script}" uses "${bad[0]}", which generator scripts may not use`);
    scripts[g.id] = src;
  }
  if (manifest.files) {
    for (const [path, want] of Object.entries(manifest.files)) {
      if (path === 'plugin.json') { errors.push('files: plugin.json cannot list itself'); continue; }
      const data = files.get(path);
      if (!data) { errors.push(`files: "${path}" is listed but not in the package`); continue; }
      const got = await sha256Hex(data);
      if (got !== want) errors.push(`"${path}" does not match its sha256 in plugin.json (the package was changed after it was packed)`);
    }
    for (const path of files.keys()) if (path !== 'plugin.json' && !(path in manifest.files)) errors.push(`"${path}" is in the package but not listed in plugin.json "files"`);
  } else warnings.push('plugin.json has no "files" hashes: the package is pinned as a whole only; the author should add them (tools/plugin_pack.mjs does)');
  if (!manifest.license) warnings.push('the plugin does not state a licence');
  if (errors.length) return { ok: false, errors, warnings, manifest };
  const hash = await packageHash(Object.fromEntries([...files].map(([k, v]) => [k, v])));
  return { ok: true, errors, warnings, manifest, files: text, hash, scripts, ...(manifest.wasm ? { binaries } : {}) };
}

/** `github:owner/repo@ref` (a tag or commit): the only form accepted. A moving ref (a branch) installs with a warning. */
export interface GithubSpec { owner: string; repo: string; ref: string }
export function parseGithubSpec(spec: string): GithubSpec | string {
  const m = /^github:([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})(?:@([A-Za-z0-9._/-]{1,100}))?$/.exec(spec.trim());
  if (!m) return 'use github:owner/repo@tag';
  return { owner: m[1], repo: m[2], ref: m[3] ?? 'HEAD' };
}
export const isPinnedRef = (ref: string): boolean => /^v?\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/.test(ref) || /^[0-9a-f]{7,40}$/.test(ref);

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
/** Reads a package from raw.githubusercontent.com (the GitHub API is never called): plugin.json first, then each file its "files" lists. */
export async function fetchGithubPackage(spec: GithubSpec, fetcher: Fetcher): Promise<{ files: Map<string, Uint8Array>; warnings: string[] } | { error: string }> {
  const base = `https://raw.githubusercontent.com/${spec.owner}/${spec.repo}/${spec.ref}/`;
  const get = async (path: string, limit: number): Promise<Uint8Array | string> => {
    let r;
    try { r = await fetcher(base + path); } catch (e) { return `could not reach ${base + path}: ${(e as Error).message}`; }
    if (!r.ok) return `${path}: HTTP ${r.status}`;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.length > limit ? `${path} is larger than ${limit / 1024} KB` : b;
  };
  const warnings: string[] = [];
  if (!isPinnedRef(spec.ref)) warnings.push(`"${spec.ref}" is not a tag or commit: it can move, so a later install may differ. Pin a tag (github:${spec.owner}/${spec.repo}@v1.0.0).`);
  const first = await get('plugin.json', MAX_FILE_BYTES);
  if (typeof first === 'string') return { error: first };
  let json: { files?: Record<string, string> };
  try { json = JSON.parse(new TextDecoder().decode(first)); } catch { return { error: 'plugin.json is not valid JSON' }; }
  if (!json.files || typeof json.files !== 'object') return { error: 'plugin.json has no "files" list: a GitHub install needs it to know what to fetch and verify' };
  const wasm = !!(json as { wasm?: unknown }).wasm;   // a wasm package carries compiled files: bigger limits, the same hash checks
  const fileLimit = wasm ? WASM_MAX_FILE_BYTES : MAX_FILE_BYTES;
  const paths = Object.keys(json.files);
  if (paths.length > MAX_FILES) return { error: `${paths.length} files: a plugin has at most ${MAX_FILES}` };
  const out = new Map<string, Uint8Array>([['plugin.json', first]]);
  let total = first.length;
  for (const path of paths) {
    if (!safePath(path)) return { error: `"${path}" is not a safe relative path` };
    const b = await get(path, fileLimit);
    if (typeof b === 'string') return { error: b };
    total += b.length;
    if (total > (wasm ? WASM_MAX_PACKAGE_BYTES : MAX_PACKAGE_BYTES)) return { error: `the package is larger than ${(wasm ? WASM_MAX_PACKAGE_BYTES : MAX_PACKAGE_BYTES) / 1024} KB` };
    out.set(path, b);
  }
  return { files: out, warnings };
}

/** A package from a direct link to a .zip (https only). The host must allow cross-origin reads (a GitHub release asset does not; raw.githubusercontent.com does). Nothing pins it: the card shows the package hash and says so. */
export async function fetchZipUrl(url: string, fetcher: Fetcher, unzip: (bytes: Uint8Array) => Promise<Map<string, Uint8Array> | { error: string }>): Promise<{ files: Map<string, Uint8Array>; warnings: string[] } | { error: string }> {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return { error: 'not a valid address' }; }
  if (u.protocol !== 'https:') return { error: 'only https:// addresses are accepted' };
  if (!/\.zip$/i.test(u.pathname)) return { error: 'the address must end in .zip' };
  let r;
  try { r = await fetcher(u.href); } catch (e) { return { error: `could not reach ${u.host}: ${(e as Error).message} (the site may not allow reading from other pages)` }; }
  if (!r.ok) return { error: `${u.host}: HTTP ${r.status}` };
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > WASM_MAX_PACKAGE_BYTES) return { error: `the file is larger than ${WASM_MAX_PACKAGE_BYTES / 1024 / 1024} MB` };
  const files = await unzip(bytes);
  if (!(files instanceof Map)) return files;
  return { files, warnings: [`this package came from ${u.host} and is not pinned to a tag or commit: check the package hash against the one the author published`] };
}
