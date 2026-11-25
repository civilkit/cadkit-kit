#!/usr/bin/env node
// The ONLY way the site goes live: civilkit.io/cad. Two modes, chosen by the owner:
//  RELEASE (default, the official one): locked by the go-live gate (tools/ci_gate.mjs). It stops, before building anything, unless
//    1. the kit CI is GREEN on this exact commit (full tier, read from the box), and
//    2. the kernel is the last green full gate and the wasm is the one that gate wrote.
//    There is no flag to skip it. If it says no, fix what it names and run again. A release is never made in preview mode.
//  RELEASE, content-only (--content-only): the same channel and checks, except the kit-CI requirement is skipped, ONLY when everything since the live release is What's new
//    content or prose (clips, posters, the page, CHANGELOG, docs/*.md, tools/clips) and the kernel and wasm are the live ones. Every condition is in tools/gate_rules.mjs
//    (contentOnlyDecision) and is re-read from the live https://civilkit.io/cad/version.json; if any fails it stops (it never falls back to skipping). Logged as
//    "content-only over <live sha>" in ../_export/hist/DEPLOY_LOG.md.
//  PREVIEW (--preview): for the owner to try something on the live site without waiting about 50 minutes for the CI. Skips the gate and the clean-tree/main
//    rule, still builds, smoke-tests and deploys. version.json says "channel":"preview" (and the kit commit ends in -dirty when the tree is dirty) so it
//    can never be mistaken for a release, and the deploy is logged in ../_export/hist/DEPLOY_LOG.md. Use it only when the owner asks for a preview.
// Both: build the pages, smoke them in headless Chrome, deploy to the Cloudflare Pages project civilkit-cad, wait until version.json shows it.
//   node tools/deploy_site.mjs --kernel-repo DIR --wasm <.../ck-full-gate/<time>-<sha10>/ck_wasm.wasm> [--dry-run]            (release)
//   node tools/deploy_site.mjs --content-only --kernel-repo DIR --wasm <the live kernel's full-gate ck_wasm.wasm> [--dry-run]    (release, content only)
//   node tools/deploy_site.mjs --preview --kernel-repo DIR --wasm <any ck_wasm.wasm> [--dry-run]                              (preview)
// --dry-run runs the checks only and says what would happen. See docs/releasing.md.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciGate } from './ci_gate.mjs';
import { INDEX_PATH, committedText, diffEntries, regenerateWhatsNew, untrackedFiles } from './gate_regen.mjs';
import { contentOnlyDecision, readLiveVersion } from './gate_rules.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const a = process.argv.slice(2);
const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const die = (m) => { console.error(`deploy: ${m}`); process.exit(1); };
const run = (cmd, args, env = {}) => { const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } }); if (r.status !== 0) die(`${cmd} ${args.slice(0, 3).join(' ')} failed (exit ${r.status})`); };
const out = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

const kernelRepo = opt('--kernel-repo') && resolve(opt('--kernel-repo'));
const wasm = opt('--wasm') && resolve(opt('--wasm'));
if (!kernelRepo || !wasm) die('usage: node tools/deploy_site.mjs --kernel-repo DIR --wasm <full-gate ck_wasm.wasm> [--dry-run]');
if (!existsSync(wasm)) die(`no wasm at ${wasm}`);
const preview = a.includes('--preview');
const contentOnly = a.includes('--content-only');
if (preview && contentOnly) die('--preview and --content-only are different modes: pick one');
let contentOver = ''; // the live kit sha a content-only deploy builds on
if (contentOnly) {
  // RULE 2 (tools/gate_rules.mjs): skips the kit CI only when nothing but content changed since the live gated release
  const live = readLiveVersion(() => { const r = spawnSync('curl', ['-sf', '--max-time', '20', '-H', 'Cache-Control: no-cache', 'https://civilkit.io/cad/version.json'], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`curl exit ${r.status}`); return r.stdout; });
  const readOrNull = (fn) => { try { return fn(); } catch { return null; } }; // unreadable = refused (the rules fail closed)
  const res = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  const liveResolved = live.error ? '' : (res('git', ['rev-parse', '--verify', '--quiet', `${live.kit}^{commit}`]).stdout || '').trim();
  const dec = contentOnlyDecision({
    live, liveResolved, head: out('git', ['rev-parse', 'HEAD']),
    liveIsAncestor: !!liveResolved && res('git', ['merge-base', '--is-ancestor', liveResolved, 'HEAD']).status === 0,
    entries: liveResolved ? readOrNull(() => diffEntries(ROOT, liveResolved, 'HEAD')) : [],
    indexHtml: committedText(ROOT, 'HEAD', INDEX_PATH), regenerate: () => regenerateWhatsNew(ROOT, 'HEAD'), // the page must equal what the generator makes from HEAD
    untracked: readOrNull(() => untrackedFiles(ROOT)), // clips and posters only
    kernelHead: out('git', ['-C', kernelRepo, 'rev-parse', 'HEAD']), wasm,
    clean: !out('git', ['status', '--porcelain', '--untracked-files=no']), branch: out('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
  });
  if (!dec.ok) die(`content-only deploy REFUSED:\n  - ${dec.problems.join('\n  - ')}\nA full release (without --content-only) needs the kit CI green on the commit.`);
  contentOver = live.kit;
  console.log(`deploy: mode CONTENT-ONLY, kit CI not required: ${dec.why}`);
} else if (!preview) {
  if (out('git', ['status', '--porcelain', '--untracked-files=no'])) die('the working tree has uncommitted changes: a release is deployed from a committed state');
  if (out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') die('a release is deployed from main');
  const problems = ciGate({ root: ROOT, kernelRepo, wasm });
  if (problems.length) die(`NOT GREEN, not deploying:\n  - ${problems.join('\n  - ')}\nGo back and fix it, then run this again.`);
  console.log('deploy: mode RELEASE (full gate)');
}
const dirty = !!out('git', ['status', '--porcelain', '--untracked-files=no']);
let head = out('git', ['rev-parse', '--short=12', 'HEAD']) + (dirty ? '-dirty' : '');
const branch = out('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
console.log(preview ? `deploy: PREVIEW of kit ${head} (${branch}), NOT verified by the CI, channel=preview` : contentOnly ? `deploy: content-only over ${contentOver} for kit ${head}, kernel and wasm unchanged, channel=release` : `deploy: gate met for kit ${head}, kernel ${out('git', ['-C', kernelRepo, 'rev-parse', '--short=12', 'HEAD'])}`);
if (a.includes('--dry-run')) { console.log('deploy: --dry-run, stopping before the build'); process.exit(0); }

const prof = mkdtempSync(join(tmpdir(), 'deploy-smoke-'));
run('npm', ['run', 'build:pages'], { PAGES_CHANNEL: preview ? 'preview' : 'release', PAGES_DOCS: '1', PAGES_OUT: 'dist-pages-civilkit/cad', WASM_SRC: wasm, CK_REBUILD: kernelRepo });
// the kit tree is shared with other sessions: what was built is what version.json says, not what HEAD was when this script started
const built = JSON.parse(readFileSync(join(ROOT, 'dist-pages-civilkit/cad/version.json'), 'utf8'));
if (!preview && !String(built.kit).startsWith(out('git', ['rev-parse', '--short=12', 'HEAD']).slice(0, 12)) || (!preview && built.kit !== head)) die(`the kit commit moved during the build (checked ${head}, built ${built.kit}): nothing was deployed, run it again`);
head = String(built.kit);
const port = 8700 + Math.floor(Math.random() * 100);
run('node', ['tools/pages_smoke.mjs', 'dist-pages-civilkit/cad', '--prefix', '/cad/', '--port', String(port), '--chrome-port', String(port + 100), '--profile', prof, '--sample', 'marine-propeller'], { CDP_TIMEOUT: '240000' });
const wr = process.env.WRANGLER || `${process.env.HOME}/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler`;
run(existsSync(wr) ? wr : 'npx', existsSync(wr) ? ['pages', 'deploy', 'dist-pages-civilkit', '--project-name', 'civilkit-cad', '--branch', 'main', '--commit-dirty=true'] : ['wrangler', 'pages', 'deploy', 'dist-pages-civilkit', '--project-name', 'civilkit-cad', '--branch', 'main', '--commit-dirty=true']);

// verify: the live version.json names this kit commit
try {
  const logDir = join(ROOT, '..', '_export', 'hist'); mkdirSync(logDir, { recursive: true });
  appendFileSync(join(logDir, 'DEPLOY_LOG.md'), `- ${new Date().toISOString()} ${preview ? 'PREVIEW (not CI-verified)' : contentOnly ? `RELEASE (content-only over ${contentOver}, kit CI not required)` : 'RELEASE (gate met)'}: kit ${head} on ${branch}, kernel ${out('git', ['-C', kernelRepo, 'rev-parse', '--short=10', 'HEAD'])}, wasm ${wasm}\n`);
} catch { /* the log is a convenience */ }
const want = head.slice(0, 8);
for (let i = 0; i < 60; i++) {
  const r = spawnSync('curl', ['-s', '-H', 'Cache-Control: no-cache', 'https://civilkit.io/cad/version.json'], { encoding: 'utf8' });
  try { const v = JSON.parse(r.stdout); if (String(v.kit).startsWith(want)) { console.log(`deploy: LIVE (${v.channel}), version.json ${r.stdout.trim()}`); process.exit(0); } } catch { /* not yet */ }
  spawnSync('sleep', ['5']);
}
die(`deployed, but https://civilkit.io/cad/version.json does not show kit ${want} after 5 minutes: check it by hand`);
