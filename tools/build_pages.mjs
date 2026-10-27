#!/usr/bin/env node
// Builds the public static site (default dist-pages/): app bundle, stripped kernel wasm, allow-listed samples, licenses.html; then runs the leak check.
//   PAGES_BASE=/my-repo/ npm run build:pages        (default base './': works under any sub-path and at a domain root)
// Env: PAGES_OUT output dir (default dist-pages), CK_REBUILD kernel repo checkout, WASM_SRC wasm to publish (default apps/cad/public/kernel/ck_wasm.wasm),
//      WASM_STRIP path of wasm-strip, KERNEL_THIRD_PARTY kernel THIRD_PARTY.md.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { filterSamples, suspectSamples } from './pages/samples.mjs';
import { filterKernelThirdParty, renderLicensesHtml } from './pages/licenses.mjs';
import { scanDir } from './pages_leakcheck.mjs';
import { buildId, precacheList, swSource } from './pages/sw.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, process.env.PAGES_OUT || 'dist-pages');
// the page at /docs/: where the documentation sets are listed
const docsHubHtml = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CadKit documentation</title>
<style>:root{color-scheme:light dark}body{font:16px/1.55 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem}h1{font-size:1.6rem}a{color:#1a5fb4}li{margin:.5rem 0}small{opacity:.7}</style></head>
<body><h1>CadKit documentation</h1>
<ul>
<li><a href="/docs/cad/"><strong>CadKit user guide</strong></a><br><small>Modelling, sketching, importing and exporting, drawings, checks, scripting and agents.</small></li>
<li><a href="/docs/cad/kernel/"><strong>Kernel reference</strong></a><br><small>The part format, the protocol, how the kernel works, and how results are validated.</small></li>
<li><a href="/cad/"><strong>Open CadKit</strong></a></li>
</ul></body></html>
`;
const FW = process.env.CK_REBUILD || fileURLToPath(new URL('../../kernel', import.meta.url));
const die = (m) => { console.error(`build:pages: ${m}`); process.exit(1); };
const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
const fmt = (n) => `${n} bytes (${kb(n)})`;

if (OUT === ROOT || !OUT.startsWith(ROOT + '/')) die(`PAGES_OUT must be a folder inside the repository (got ${OUT})`);

// 0. wasm-strip must exist before anything is built
const stripBin = [process.env.WASM_STRIP, '/opt/homebrew/bin/wasm-strip', '/usr/local/bin/wasm-strip'].filter(Boolean).find((p) => existsSync(p))
  ?? (spawnSync('which', ['wasm-strip'], { encoding: 'utf8' }).stdout.trim() || null);
if (!stripBin) die('wasm-strip not found. Install wabt (macOS: brew install wabt; Debian/Ubuntu: apt install wabt), or set WASM_STRIP=/path/to/wasm-strip.');
const wasmSrc = resolve(ROOT, process.env.WASM_SRC || 'apps/cad/public/kernel/ck_wasm.wasm');
if (!existsSync(wasmSrc)) die(`kernel wasm not found at ${wasmSrc}. It is not committed: copy it there (tools/sync_stack.sh in the kernel repo) or set WASM_SRC.`);

// 1. app bundle
console.log(`building the app into ${OUT} (base ${process.env.PAGES_BASE || './'})`);
const vite = spawnSync('npx', ['vite', 'build', 'apps/cad', '--config', 'vite.config.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PAGES_BUILD: '1', PAGES_OUT: OUT, CK_REBUILD: FW } });
if (vite.status !== 0) die('vite build failed');

// 2. kernel: a COPY goes to the output and is stripped there; the source wasm is never touched
mkdirSync(join(OUT, 'kernel'), { recursive: true });
const wasmOut = join(OUT, 'kernel', 'ck_wasm.wasm');
copyFileSync(wasmSrc, wasmOut);
const before = readFileSync(wasmOut);
const s = spawnSync(stripBin, [wasmOut], { encoding: 'utf8' });
if (s.status !== 0) die(`wasm-strip failed: ${s.stderr || s.stdout}`);
const after = readFileSync(wasmOut);
try { await WebAssembly.compile(after); } catch (e) { die(`stripped wasm does not compile: ${e.message}`); }
console.log(`kernel wasm: raw ${fmt(before.length)}, gzip ${fmt(gzipSync(before).length)}\n             stripped ${fmt(after.length)}, gzip ${fmt(gzipSync(after).length)} (compiles)`);

// 3. samples: only the allow-listed ones
const samplesSrc = join(ROOT, 'apps/cad/public/samples');
const index = JSON.parse(readFileSync(join(samplesSrc, 'index.json'), 'utf8'));
const allow = JSON.parse(readFileSync(join(ROOT, 'apps/cad/pages-samples.allow.json'), 'utf8'));
const { kept, dropped } = filterSamples(index, allow);
mkdirSync(join(OUT, 'samples/thumbs'), { recursive: true });
// 1x1 transparent WebP: a sample without a thumbnail gets this instead of a 404 (the dialog hides a broken image anyway; a static host should not log one)
const BLANK_THUMB = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');
let thumbs = 0, blanks = 0;
for (const e of kept) {
  copyFileSync(join(samplesSrc, e.file), join(OUT, 'samples', e.file));
  const th = join(samplesSrc, 'thumbs', `${e.id}.webp`);
  if (existsSync(th)) { copyFileSync(th, join(OUT, 'samples/thumbs', `${e.id}.webp`)); thumbs++; }
  else { writeFileSync(join(OUT, 'samples/thumbs', `${e.id}.webp`), BLANK_THUMB); blanks++; }
}
writeFileSync(join(OUT, 'samples/index.json'), JSON.stringify(kept, null, 1) + '\n');
console.log(`samples: ${kept.length} published (${thumbs} thumbnails, ${blanks} blank placeholders), ${dropped.length} left out`);
const flagged = suspectSamples(kept);
if (flagged.length) die(`allow-listed samples look private: ${flagged.map((e) => e.id).join(', ')} (remove them from pages-samples.allow.json, or loosen SUSPECT in tools/pages/samples.mjs)`);

// 4. licences
const kernelTp = process.env.KERNEL_THIRD_PARTY || join(FW, 'THIRD_PARTY.md');
let kernel;
if (existsSync(kernelTp)) {
  const f = filterKernelThirdParty(readFileSync(kernelTp, 'utf8'));
  kernel = f.md;
  console.log(`kernel THIRD_PARTY: ${f.filtered.length} line(s) not published:`);
  for (const x of f.filtered) console.log(`  - ${x.why}: ${x.row.replace(/\s+/g, ' ').slice(0, 90)}`);
} else console.warn(`warning: ${kernelTp} not found, licences page has no kernel section`);
const licences = [];
const addText = (title, file) => { if (existsSync(file)) licences.push({ title, text: readFileSync(file, 'utf8') }); else console.warn(`warning: licence text missing: ${file}`); };
const cr = (p) => join(FW, 'crates', p);
addText('SIL Open Font License 1.1: Barlow Condensed (built-in font "gauge")', cr('ck-text/fonts/OFL-BarlowCondensed.txt'));
addText('SIL Open Font License 1.1: PT Serif (built-in font "engrave")', cr('ck-text/fonts/OFL-PTSerif.txt'));
addText('MIT licence: brepkit (check, heal and STEP reader logic)', cr('ck-check/LICENSE-MIT'));
addText('Apache License 2.0: brepkit, sldprt2step', cr('ck-check/LICENSE-APACHE'));
addText('Notice: SolidWorks part reader', cr('ck-sldprt/NOTICE'));
addText('Notice: sldprt2step', cr('ck-sldprt/NOTICE-sldprt2step'));
addText('MIT licence: sldprt-format-research', cr('ck-sldprt/LICENSE-MIT-sldprt-format-research'));
const deps = ['preact', '@preact/signals', '@preact/signals-core', 'three'].flatMap((name) => {
  const dir = ['node_modules', '../kit/node_modules'].map((d) => join(ROOT, d, name)).find((d) => existsSync(join(d, 'package.json')));
  if (!dir) { console.warn(`warning: package ${name} not found for the licences page`); return []; }
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const lic = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((f) => join(dir, f)).find(existsSync);
  const copyright = lic ? (readFileSync(lic, 'utf8').split('\n').find((l) => /copyright/i.test(l)) ?? '').trim() : '';
  return [{ name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : 'see package', copyright }];
});
writeFileSync(join(OUT, 'licenses.html'), renderLicensesHtml({ kit: readFileSync(join(ROOT, 'THIRD_PARTY.md'), 'utf8'), kernel, licences, deps }));

// 5. a small link to the licences page, only in the published index.html (the app has no About dialog)
const idx = join(OUT, 'index.html');
const link = '<a id="licences-link" href="licenses.html">Licences</a><style>#licences-link{position:fixed;left:62%;bottom:4px;z-index:1;font:10px/1.4 system-ui,sans-serif;color:inherit;opacity:.45;text-decoration:none}#licences-link:hover{opacity:1;text-decoration:underline}</style>';
const html = readFileSync(idx, 'utf8');
if (!html.includes('</body>')) die('index.html has no </body> to add the licences link to');
// the documentation (5d below) is built only when PAGES_DOCS=1 (the /cad/ site: the books link to each other by absolute /cad/docs/ paths)
const wantDocs = process.env.PAGES_DOCS === '1';
const docsLink = wantDocs ? '<a id="docs-link" href="/docs/cad/">Documentation</a><style>#docs-link{position:fixed;left:70%;bottom:4px;z-index:1;font:10px/1.4 system-ui,sans-serif;color:inherit;opacity:.45;text-decoration:none}#docs-link:hover{opacity:1;text-decoration:underline}</style>' : '';
writeFileSync(idx, html.replace('</body>', `${link}${docsLink}</body>`));
writeFileSync(join(OUT, '.nojekyll'), '');   // GitHub Pages: serve the assets/ folder as is

// 5a. the web app manifest and its icons (the app build runs without a public folder, so they are copied here)
mkdirSync(join(OUT, 'icons'), { recursive: true });
copyFileSync(join(ROOT, 'apps/cad/public/manifest.webmanifest'), join(OUT, 'manifest.webmanifest'));
for (const f of readdirSync(join(ROOT, 'apps/cad/public/icons'))) copyFileSync(join(ROOT, 'apps/cad/public/icons', f), join(OUT, 'icons', f));

// 5d. documentation (PAGES_DOCS=1): the user guide at <site>/docs/cad/ and the kernel book at <site>/docs/cad/kernel/ (mdBook), where <site> is the folder that
// holds the app folder (so the app at <site>/cad/ and the books at <site>/docs/cad/). The books link to each other by absolute /docs/cad/ paths.
// MDBOOK names the binary (default: mdbook on PATH); a missing mdbook is an error.
if (wantDocs) {
  const mdbook = process.env.MDBOOK || 'mdbook';
  const have = spawnSync(mdbook, ['--version'], { encoding: 'utf8' });
  if (have.status !== 0) {
    die(`PAGES_DOCS=1 but ${mdbook} did not run. Install mdBook (cargo install mdbook) or set MDBOOK=/path/to/mdbook.`);
  } else {
    const book = (src, dest, label) => {
      if (!existsSync(join(src, 'book.toml'))) die(`${label}: ${src}/book.toml not found`);
      const b = spawnSync(mdbook, ['build', src, '--dest-dir', dest], { encoding: 'utf8' });
      if (b.status !== 0) die(`${label}: mdbook build failed\n${b.stderr || b.stdout}`);
      if (/\bWARN|\bERROR/.test(b.stderr || '')) console.warn(`${label}: mdbook reported:\n${b.stderr}`);
    };
    const docsOut = join(dirname(OUT), 'docs');
    if (!docsOut.startsWith(ROOT + '/')) die(`the documentation folder ${docsOut} must be inside the repository`);
    book(join(ROOT, 'guide'), join(docsOut, 'cad'), 'user guide');
    book(join(FW, 'book'), join(docsOut, 'cad', 'kernel'), 'kernel book');
    writeFileSync(join(docsOut, 'index.html'), docsHubHtml());
    // the documentation lives outside the app folder, so the leak check below would not see it: scan it here with the same allow list
    let docsAllow = [];
    try { docsAllow = JSON.parse(readFileSync(join(ROOT, 'tools/pages_leakcheck.allow.json'), 'utf8')).allow ?? []; } catch { /* none */ }
    const dr = scanDir(docsOut, docsAllow);
    for (const h of dr.hits) console.error(`LEAK ${h.id} ${h.file}\n     ${h.context}`);
    if (dr.hits.length) die(`leak check found ${dr.hits.length} hit(s) in the documentation; the site is not safe to publish`);
    console.log(`documentation: built the user guide and the kernel book into ${join(docsOut, 'cad')} (leak check: ${dr.files} files scanned, clean)`);
  }
}

// 5b. the service worker (installable app, offline start): it lists this build's files, so it is written last
const listFiles = (dir, base = '') => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listFiles(join(dir, d.name), `${base}${d.name}/`) : [{ path: `${base}${d.name}`, size: statSync(join(dir, d.name)).size }]));
const built = listFiles(OUT);
const shell = precacheList(built.map((f) => f.path));
for (const need of ['index.html', 'manifest.webmanifest', 'kernel/ck_wasm.wasm', 'icons/icon-192.png', 'icons/icon-512.png']) if (!shell.includes(need)) die(`the installable app needs ${need} in the output`);
writeFileSync(join(OUT, 'sw.js'), swSource(buildId(built), shell));
console.log(`service worker: ${shell.length} files stored at install`);
// 5c. version.json: which commit the app bundle was built from (tools/stack_status.mjs reads it; written after the service worker so it is not stored at install)
const kitRev = (() => { const g = (a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim(); const r = g(['rev-parse', '--short=12', 'HEAD']); return r ? r + (g(['status', '--porcelain', '--untracked-files=no']) ? '-dirty' : '') : ''; })();
writeFileSync(join(OUT, 'version.json'), JSON.stringify({ kit: kitRev }) + '\n');

// 6. leak check: the build fails on any hit
let allowList = [];
try { allowList = JSON.parse(readFileSync(join(ROOT, 'tools/pages_leakcheck.allow.json'), 'utf8')).allow ?? []; } catch { /* none */ }
const r = scanDir(OUT, allowList);
for (const a of r.allowed) console.log(`leak check allowed: ${a.id} ${a.file}: ${a.match} (${a.reason})`);
for (const h of r.hits) console.error(`LEAK ${h.id} ${h.file}\n     ${h.context}`);
// A local preview (tools/serve_local.sh) never leaves this machine, so it may skip the check; the deploy folder never may.
const localOnly = process.env.PAGES_SKIP_LEAKCHECK === '1' && OUT !== resolve(ROOT, 'dist-pages');
if (r.hits.length && localOnly) console.warn(`leak check: ${r.hits.length} hit(s) ignored, this build is for local viewing only`);
else if (r.hits.length) die(`leak check found ${r.hits.length} hit(s); the site is not safe to publish`);
const total = (function sum(d) { let n = 0; for (const f of readdirSync(d)) { const p = join(d, f); n += statSync(p).isDirectory() ? sum(p) : statSync(p).size; } return n; })(OUT);
console.log(`leak check: ${r.files} files scanned, clean. Site: ${OUT} (${kb(total)})`);
