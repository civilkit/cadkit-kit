#!/usr/bin/env node
// Is everything current? Compares the kernel wasm and the app bundle in three places with the `main` branches:
//   dev app    apps/cad/public/kernel/ck_wasm.wasm (the wasm `npm run dev` loads)
//   built site dist-pages/ (when present)
//   live site  SITE (default https://cadkit-studio.pages.dev)
// A wasm built by the kernel's tools/remote_build.sh says which commit it came from (`ping` -> "build"); one built any other way is "unstamped".
// The pages build writes version.json ({kit: <commit>}), which says the same for the app bundle.
//
// usage: node tools/stack_status.mjs [--site URL] [--no-site]     env: CK_REBUILD = kernel checkout (default ../rebuild-main)
// Exit 1 when something is behind or unknown, so it can sit in a hook or a release script.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FW = resolve(process.env.CK_REBUILD || join(ROOT, '..', 'rebuild-main'));
const args = process.argv.slice(2);
const SITE = args.includes('--no-site') ? null : (args[args.indexOf('--site') + 1] || process.env.SITE || 'https://cadkit-studio.pages.dev').replace(/\/$/, '');
const git = (dir, ...a) => { try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

const kernelMain = git(FW, 'rev-parse', '--short=12', 'main');
const kitMain = git(ROOT, 'rev-parse', '--short=12', 'main');
if (!kernelMain) { console.error(`no kernel checkout with a main branch at ${FW} (set CK_REBUILD)`); process.exit(2); }

/** "current", "behind N", or why it cannot be told. `rev` may end in -dirty. */
function verdict(dir, rev, head) {
  if (!rev) return { ok: false, text: 'unstamped (built without remote_build.sh, so its source is unknown)' };
  const clean = rev.replace(/-dirty$/, '');
  if (!git(dir, 'cat-file', '-t', clean)) return { ok: false, text: `${rev}: not a commit of this repository` };
  const behind = Number(git(dir, 'rev-list', '--count', `${clean}..${head}`));
  const ahead = Number(git(dir, 'rev-list', '--count', `${head}..${clean}`));
  const dirty = rev.endsWith('-dirty') ? ' (built from uncommitted changes)' : '';
  if (behind === 0 && ahead === 0 && !dirty) return { ok: true, text: `${rev}: current` };
  if (behind === 0 && !dirty) return { ok: true, text: `${rev}: current (${ahead} commit(s) ahead of main, not merged)` };
  return { ok: false, text: `${rev}: ${behind} commit(s) behind main${ahead ? `, ${ahead} not on main` : ''}${dirty}` };
}

const { Kernel } = await import(pathToFileURL(join(FW, 'tools', 'kernel.mjs')).href);
const wasmBuild = (bytes) => {
  try {
    const k = new Kernel(new WebAssembly.Module(bytes));
    const r = JSON.parse(k.request(JSON.stringify({ id: 1, msg: { type: 'ping' } })).json);
    return r.result?.build ?? '';
  } catch (e) { return `error: ${e.message}`; }
};

const rows = [];
const add = (what, v) => rows.push({ what, ...v });
console.log(`kernel main ${kernelMain}   kit main ${kitMain}\n`);

const dev = join(ROOT, 'apps/cad/public/kernel/ck_wasm.wasm');
if (existsSync(dev)) { const b = wasmBuild(readFileSync(dev)); add('dev app wasm', b.startsWith('error') ? { ok: false, text: b } : verdict(FW, b, 'main')); }
else add('dev app wasm', { ok: false, text: 'missing (copy one to apps/cad/public/kernel/)' });

const built = join(ROOT, 'dist-pages');
if (existsSync(join(built, 'version.json'))) {
  const v = JSON.parse(readFileSync(join(built, 'version.json'), 'utf8'));
  add('built site app', verdict(ROOT, v.kit, 'main'));
  const w = join(built, 'kernel/ck_wasm.wasm');
  if (existsSync(w)) add('built site wasm', verdict(FW, wasmBuild(readFileSync(w)), 'main'));
}

if (SITE) {
  const get = async (p, bin) => { const r = await fetch(`${SITE}/${p}?t=${Date.now()}`, { cache: 'no-store' }); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return bin ? new Uint8Array(await r.arrayBuffer()) : r.text(); };
  try { const v = JSON.parse(await get('version.json')); add('live site app', verdict(ROOT, v.kit, 'main')); } catch (e) { add('live site app', { ok: false, text: `no version.json (${e.message}): deployed before the stamp existed, or unreachable` }); }
  try { add('live site wasm', verdict(FW, wasmBuild(await get('kernel/ck_wasm.wasm', true)), 'main')); } catch (e) { add('live site wasm', { ok: false, text: e.message }); }
}

for (const r of rows) console.log(`${r.ok ? 'ok     ' : 'BEHIND '}${r.what.padEnd(17)} ${r.text}`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
