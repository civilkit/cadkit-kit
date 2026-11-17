// Which local files an agent may ask the app to open (app_open_asset, docs/agent-bridge.md). The model sends a path; this module decides
// whether that path may be read at all. It never exposes an arbitrary file read: a root list the user configures, no `..`, the real path
// (symlinks resolved) inside a root, a regular file with an allowed extension, and a size limit. Anything else is refused with a code.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { delimiter, isAbsolute, join, relative, resolve, basename, sep } from 'node:path';
import { BridgeError } from '@kit/agent-link';
import { stateDir } from './state';

export type AssetKind = 'part' | 'solidcraft' | 'step' | 'stl' | 'obj' | 'glb' | '3mf';
/** The extensions that may be opened, and what each is. Nothing else is ever read. */
export const ASSET_EXTENSIONS: Readonly<Record<string, AssetKind>> = {
  '.ckpart': 'part', '.solidcraft': 'solidcraft', '.step': 'step', '.stp': 'step', '.stl': 'stl', '.obj': 'obj', '.glb': 'glb', '.3mf': '3mf',
};
export const DEFAULT_MAX_MB = 256;
const MAX_PATH_CHARS = 1024;

export interface AssetPolicy {
  /** Real paths of the allowed folders (symlinks in the configured path already resolved). */
  roots: string[];
  /** The roots as configured (before symlinks were resolved): an absolute path may be written either way. */
  configured: string[];
  maxBytes: number;
  /** Where the roots came from, for the error text: 'CK_MCP_ASSET_ROOTS', the config file, or null. */
  source: string | null;
}

export const assetConfigFile = (dir = stateDir()): string => join(dir, 'assets.json');

const real = (p: string): string | null => { try { return realpathSync(p); } catch { return null; } };

/** The user's configuration: the CK_MCP_ASSET_ROOTS list (and CK_MCP_ASSET_MAX_MB) or `<state dir>/assets.json` { roots, maxMb }. Read at each call, so a change needs no restart. Nothing configured: no roots. */
export function loadAssetPolicy(env: NodeJS.ProcessEnv = process.env, dir?: string): AssetPolicy {
  let raw: string[] = [], maxMb = DEFAULT_MAX_MB, source: string | null = null;
  const fromEnv = (env.CK_MCP_ASSET_ROOTS ?? '').split(delimiter).map((s) => s.trim()).filter(Boolean);
  if (fromEnv.length) { raw = fromEnv; source = 'CK_MCP_ASSET_ROOTS'; }
  else {
    try {
      const f = assetConfigFile(dir);
      if (existsSync(f)) {
        const j = JSON.parse(readFileSync(f, 'utf8')) as { roots?: unknown; maxMb?: unknown };
        if (Array.isArray(j.roots)) { raw = j.roots.filter((x): x is string => typeof x === 'string' && !!x.trim()); source = f; }
        if (typeof j.maxMb === 'number' && j.maxMb > 0) maxMb = j.maxMb;
      }
    } catch { /* an unreadable config allows nothing */ }
  }
  const envMb = Number(env.CK_MCP_ASSET_MAX_MB);
  if (Number.isFinite(envMb) && envMb > 0) maxMb = envMb;
  // only absolute roots that exist: a relative root would depend on the daemon's working folder
  const abs = raw.filter((r) => isAbsolute(r)).map((r) => resolve(r));
  const roots = abs.map(real).filter((r): r is string => r !== null);
  return { roots: [...new Set(roots)], configured: [...new Set(abs)], maxBytes: Math.floor(maxMb * 1024 * 1024), source };
}

const inside = (root: string, p: string): boolean => { const r = relative(root, p); return r === '' || (r !== '..' && !r.startsWith('..' + sep) && !isAbsolute(r)); };

export interface ResolvedAsset { file: string; root: string; kind: AssetKind; name: string; bytes: number }

/** Decide whether `userPath` may be opened. Throws BridgeError with a stable code; touches the file system only after the lexical checks pass. */
export async function resolveAsset(policy: AssetPolicy, userPath: unknown): Promise<ResolvedAsset> {
  if (typeof userPath !== 'string' || !userPath.trim() || userPath.length > MAX_PATH_CHARS || userPath.includes('\0')) throw new BridgeError('bad_input', 'path must be a non-empty string of at most 1024 characters');
  if (!policy.roots.length) throw new BridgeError('asset_roots_not_configured', 'no folder is allowed for opening files', `the user sets CK_MCP_ASSET_ROOTS (a list of folders) or writes {"roots": ["<folder>"]} to ${assetConfigFile()}, then calls again`);
  if (userPath.split(/[\\/]+/).includes('..')) throw new BridgeError('path_traversal', 'a path with ".." is not allowed', 'give the path below an allowed folder, without ".."');
  // a relative path is below the first root; an absolute one must already be inside a root
  const wanted = resolve(policy.roots[0], userPath);
  const lexicalRoot = [...policy.roots, ...policy.configured].find((r) => inside(r, wanted));
  if (!lexicalRoot) throw new BridgeError('path_outside_workspace', 'that path is not inside an allowed folder', `allowed: ${policy.roots.join(', ')}`);
  const ext0 = extOf(wanted);
  if (!ext0) throw new BridgeError('asset_extension_not_allowed', `files of that type cannot be opened`, `allowed: ${Object.keys(ASSET_EXTENSIONS).join(' ')}`);
  const file = real(wanted);
  if (!file) throw new BridgeError('asset_not_found', 'no such file in the allowed folders');
  const root = policy.roots.find((r) => inside(r, file));
  if (!root) throw new BridgeError('path_outside_workspace', 'that path leads outside the allowed folders (a link?)', `allowed: ${policy.roots.join(', ')}`);
  const ext = extOf(file);
  if (!ext) throw new BridgeError('asset_extension_not_allowed', 'the file this path leads to is not of an allowed type', `allowed: ${Object.keys(ASSET_EXTENSIONS).join(' ')}`);
  const fh = await open(file, 'r');
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new BridgeError('asset_not_file', 'that is not a regular file');
    if (st.size > policy.maxBytes) throw new BridgeError('asset_too_large', `the file is ${st.size} bytes; the limit is ${policy.maxBytes}`, 'the user can raise it with CK_MCP_ASSET_MAX_MB');
    return { file, root, kind: ASSET_EXTENSIONS[ext], name: basename(file), bytes: st.size };
  } finally { await fh.close(); }
}

const extOf = (p: string): string | null => { const e = /\.[A-Za-z0-9]+$/.exec(basename(p).toLowerCase())?.[0] ?? ''; return e in ASSET_EXTENSIONS ? e : null; };

/** Read a resolved file, at most `maxBytes` (a file that grew since the check is refused, never read whole). */
export async function readAsset(a: ResolvedAsset, policy: AssetPolicy): Promise<Uint8Array> {
  const fh = await open(a.file, 'r');
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.size > policy.maxBytes) throw new BridgeError('asset_too_large', 'the file changed while it was being opened');
    const buf = Buffer.alloc(st.size);
    let got = 0;
    while (got < st.size) { const { bytesRead } = await fh.read(buf, got, st.size - got, got); if (!bytesRead) break; got += bytesRead; }
    return new Uint8Array(buf.buffer, buf.byteOffset, got);
  } finally { await fh.close(); }
}
