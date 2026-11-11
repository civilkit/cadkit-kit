#!/usr/bin/env node
// Cuts a release: moves the CHANGELOG's "Unreleased" entries under "## X.Y.Z - date", sets the version in package.json, commits and tags vX.Y.Z
// (the annotated tag carries the release notes) and regenerates the What's new page (tools/make_whats_new.mjs). Nothing is pushed or deployed. See docs/releasing.md.
//   node tools/release.mjs <X.Y.Z | major | minor | patch> [--dry-run] [--kernel-repo DIR] [--no-checks]
//   --kernel-repo DIR  also tag that checkout (the kernel the app ships) with the same vX.Y.Z (local tag only), at --kernel-ref REF (default HEAD:
//                      give the commit the published wasm was built from)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const a = process.argv.slice(2);
const flag = (k) => a.includes(k);
const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const arg = a.find((x, i) => !x.startsWith('--') && a[i - 1] !== '--kernel-repo' && a[i - 1] !== '--kernel-ref');
const die = (m) => { console.error(`release: ${m}`); process.exit(1); };
const git = (dir, ...args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); if (r.status !== 0) die(`git ${args.join(' ')} failed: ${r.stderr.trim()}`); return r.stdout.trim(); };

if (!arg) die('usage: node tools/release.mjs <X.Y.Z | major | minor | patch> [--dry-run] [--kernel-repo DIR] [--no-checks]');
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const cur = pkg.version.split('.').map(Number);
const next = /^\d+\.\d+\.\d+$/.test(arg) ? arg
  : arg === 'major' ? `${cur[0] + 1}.0.0` : arg === 'minor' ? `${cur[0]}.${cur[1] + 1}.0` : arg === 'patch' ? `${cur[0]}.${cur[1]}.${cur[2] + 1}` : die(`not a version or bump: ${arg}`);
const cmp = (x, y) => { for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
if (cmp(next.split('.').map(Number), cur) <= 0) die(`${next} is not newer than the current ${pkg.version}`);

const dry = flag('--dry-run');
if (!dry) {
  if (git(ROOT, 'status', '--porcelain', '--untracked-files=no')) die('the working tree has uncommitted changes');
  if (git(ROOT, 'rev-parse', '--abbrev-ref', 'HEAD') !== 'main') die('release from main');
  if (git(ROOT, 'tag', '--list', `v${next}`)) die(`tag v${next} exists`);
}

// the CHANGELOG: everything between "## Unreleased" and the previous release heading becomes this release
const clPath = join(ROOT, 'CHANGELOG.md');
const cl = readFileSync(clPath, 'utf8');
const m = /^## Unreleased\s*\n([\s\S]*?)(?=^## \d)/m.exec(cl);
if (!m) die('CHANGELOG.md has no "## Unreleased" section followed by a release');
const body = m[1].trim();
const entries = body.split('\n').filter((l) => /^- /.test(l)).length;
if (!entries) die('the Unreleased section has no entries: nothing to release');
const date = new Date().toISOString().slice(0, 10);
const notes = `## ${next} - ${date}\n\n${body}\n`;
console.log(`release ${pkg.version} -> ${next} (${date}): ${entries} changelog entries`);

if (!flag('--no-checks')) {
  for (const [name, cmd, args] of [['i18n', 'node', ['tools/i18n_check.mjs']]]) {
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) die(`${name} check failed:\n${(r.stdout + r.stderr).split('\n').slice(-12).join('\n')}`);
    console.log(`check ok: ${name}`);
  }
}
if (dry) { console.log('--dry-run: nothing written\n\n' + notes.slice(0, 1500) + (notes.length > 1500 ? '\n...' : '')); process.exit(0); }

writeFileSync(clPath, cl.replace(m[0], `## Unreleased\n\n${notes}\n`));
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
// the What's new page (apps/cad/public/whats-new): regenerated from the changelog and the highlights of this version
const hl = JSON.parse(readFileSync(join(ROOT, 'docs', 'whats-new', 'highlights.json'), 'utf8'));
if (!hl[next]?.length) console.warn(`release: docs/whats-new/highlights.json has no highlights for ${next}; the page lists the changes only`);
const gen = spawnSync('node', ['tools/make_whats_new.mjs'], { cwd: ROOT, encoding: 'utf8' });
if (gen.status !== 0) die(`the What's new page failed: ${gen.stderr}`);
git(ROOT, 'add', 'CHANGELOG.md', 'package.json', 'apps/cad/public/whats-new', 'docs/whats-new');
git(ROOT, 'commit', '-m', `Release ${next}`);
git(ROOT, 'tag', '-a', `v${next}`, '-m', `Version ${next}\n\n${notes}`);
console.log(`committed and tagged v${next} in the kit repo`);
const kdir = opt('--kernel-repo');
if (kdir) {
  if (git(kdir, 'tag', '--list', `v${next}`)) die(`the kernel repo already has v${next}`);
  const kref = opt('--kernel-ref') ?? 'HEAD';
  git(kdir, 'tag', '-a', `v${next}`, kref, '-m', `Version ${next} (the kernel shipped with kit v${next})`);
  console.log(`tagged v${next} in ${kdir} at ${git(kdir, 'rev-parse', '--short', kref)}`);
}
console.log(`\nNext: push the tag to ci (git push ci main v${next}), build and deploy, and put these notes where users read them:\n\n${notes}`);
