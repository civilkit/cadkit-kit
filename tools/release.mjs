#!/usr/bin/env node
// Cuts a release: moves the CHANGELOG's "Unreleased" entries under "## X.Y.Z - date", sets the version in package.json, commits and tags vX.Y.Z
// (the annotated tag carries the release notes) and regenerates the What's new page (tools/make_whats_new.mjs). Nothing is pushed or deployed. See docs/releasing.md.
//   node tools/release.mjs <X.Y.Z | major | minor | patch> [--dry-run] [--kernel-repo DIR] [--no-checks]
//   After committing it checks the new commit against the Release-commit rule (tools/gate_rules.mjs): when it only changed version lines, the CHANGELOG heading and the generated
//   What's new page, deploy_site.mjs accepts it on the strength of this (green) parent without another full CI run; otherwise it needs its own green run.
//   The CI gate (always on, no bypass, not part of --no-checks; tools/ci_gate.mjs): the kit commit being released must have a GREEN full-tier run in the box's kit CI history, and with
//   --kernel-repo the kernel ref must be the commit in that checkout's tools/ci/LAST_GREEN (the last green full kernel gate). Otherwise the release stops.
//   --kernel-repo DIR  also tag that checkout (the kernel the app ships) with the same vX.Y.Z (local tag only), at --kernel-ref REF (default HEAD:
//                      give the commit the published wasm was built from)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciGate } from './ci_gate.mjs';
import { releaseCommitCheck, clipReadiness } from './gate_rules.mjs';
import { INDEX_PATH, committedText, regenerateWhatsNew } from './gate_regen.mjs';

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

// CI gate (tools/ci_gate.mjs, shared with tools/deploy_site.mjs): green kit CI on this commit, kernel on the last green full gate. No bypass.
{
  const problems = ciGate({ root: ROOT, kernelRepo: opt('--kernel-repo'), kernelRef: opt('--kernel-ref') ?? 'HEAD' });
  if (problems.length) {
    const msg = `CI gate not met:\n  - ${problems.join('\n  - ')}`;
    if (dry) console.warn(`release (dry run): ${msg}`); else die(`${msg}\nFix it first.`);
  } else console.log('release: CI gate met');
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
  // the audit needs the network (the npm advisory database); `--no-checks` skips it. High and critical advisories in what ships stop the release.
  for (const [name, cmd, args] of [['i18n', 'node', ['tools/i18n_check.mjs']], ['dependency audit', 'npm', ['audit', '--omit=dev', '--audit-level=high']]]) {
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) die(`${name} check failed:\n${(r.stdout + r.stderr).split('\n').slice(-12).join('\n')}`);
    console.log(`check ok: ${name}`);
  }
}
// RULE 3 (tools/gate_rules.mjs): a release carries 4 visual changes with a clip and a poster each; fewer needs --clips-ok "<reason>" (printed and kept in the Release commit body)
const clipsOk = opt('--clips-ok');
const clipsHl = JSON.parse(readFileSync(join(ROOT, 'docs', 'whats-new', 'highlights.json'), 'utf8'))[next] ?? [];
const clipDir = join(ROOT, 'apps', 'cad', 'public', 'whats-new');
const clipRule = clipReadiness({ entries: clipsHl, hasClip: (id) => existsSync(join(clipDir, 'clips', `${id}.mp4`)) && existsSync(join(clipDir, 'clips', `${id}.webm`)), hasPoster: (id) => existsSync(join(clipDir, 'posters', `${id}.png`)) });
if (!clipRule.ok) {
  const msg = `${clipRule.reason}. Record the clips (docs/releasing.md, What's new clips) or pass --clips-ok "<why this release goes out with fewer>"`;
  if (clipsOk) console.warn(`release: clip rule overridden (${clipsOk}): ${msg}`);
  else if (dry) console.warn(`release (dry run): ${msg}`);
  else die(msg);
} else console.log(`release: ${clipRule.reason}`);
if (dry) { console.log('--dry-run: nothing written\n\n' + notes.slice(0, 1500) + (notes.length > 1500 ? '\n...' : '')); process.exit(0); }

writeFileSync(clPath, cl.replace(m[0], `## Unreleased\n\n${notes}\n`));
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
// the desktop shell (Tauri) carries the app version in three files; tauri.conf.json reads desktop/package.json
const dpkgPath = join(ROOT, 'desktop', 'package.json');
const dpkg = JSON.parse(readFileSync(dpkgPath, 'utf8'));
dpkg.version = next;
writeFileSync(dpkgPath, JSON.stringify(dpkg, null, 2) + '\n');
const cargoPath = join(ROOT, 'desktop', 'src-tauri', 'Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8');
if (!/^version = "[^"]*"/m.test(cargo)) die('desktop/src-tauri/Cargo.toml has no package version line');
writeFileSync(cargoPath, cargo.replace(/^version = "[^"]*"/m, `version = "${next}"`));
const lockPath = join(ROOT, 'desktop', 'src-tauri', 'Cargo.lock');
const lock = readFileSync(lockPath, 'utf8');
const lockRe = /(name = "civilkit-cad"\nversion = ")[^"]*(")/;
if (!lockRe.test(lock)) die('desktop/src-tauri/Cargo.lock has no civilkit-cad entry');
writeFileSync(lockPath, lock.replace(lockRe, `$1${next}$2`));
// the What's new page (apps/cad/public/whats-new): regenerated from the changelog and the highlights of this version
const hl = JSON.parse(readFileSync(join(ROOT, 'docs', 'whats-new', 'highlights.json'), 'utf8'));
if (!hl[next]?.length) console.warn(`release: docs/whats-new/highlights.json has no highlights for ${next}; the page lists the changes only`);
const gen = spawnSync('node', ['tools/make_whats_new.mjs'], { cwd: ROOT, encoding: 'utf8' });
if (gen.status !== 0) die(`the What's new page failed: ${gen.stderr}`);
git(ROOT, 'add', 'CHANGELOG.md', 'package.json', 'desktop/package.json', 'desktop/src-tauri/Cargo.toml', 'desktop/src-tauri/Cargo.lock', 'apps/cad/public/whats-new', 'docs/whats-new');
git(ROOT, 'commit', '-m', `Release ${next}`, ...(!clipRule.ok && clipsOk ? ['-m', `Clip rule overridden: ${clipsOk} (${clipRule.reason})`] : []));
git(ROOT, 'tag', '-a', `v${next}`, '-m', `Version ${next}\n\n${notes}`);
console.log(`committed and tagged v${next} in the kit repo`);
{ // does the new commit qualify for "Release commit on green parent" (no CI run of its own)? Informational: the gate re-checks at deploy time
  const rel = releaseCommitCheck({ subject: git(ROOT, 'log', '-1', '--format=%s'), diffText: git(ROOT, 'diff', '--no-color', '--no-renames', '--no-ext-diff', 'HEAD^', 'HEAD'), tagsAtCommit: git(ROOT, 'tag', '--points-at', 'HEAD').split('\n').filter(Boolean), indexHtml: committedText(ROOT, 'HEAD', INDEX_PATH), regenerate: () => regenerateWhatsNew(ROOT, 'HEAD') });
  console.log(rel.ok ? `release: this is a pure Release commit on green parent ${git(ROOT, 'rev-parse', '--short=10', 'HEAD^')}: deploy_site.mjs needs no CI run on it (${rel.reason})` : `release: WARNING this Release commit does not qualify for the parent's verdict (${rel.reason}): it needs its own green full CI run before deploy`);
}
const kdir = opt('--kernel-repo');
if (kdir) {
  if (git(kdir, 'tag', '--list', `v${next}`)) die(`the kernel repo already has v${next}`);
  const kref = opt('--kernel-ref') ?? 'HEAD';
  git(kdir, 'tag', '-a', `v${next}`, kref, '-m', `Version ${next} (the kernel shipped with kit v${next})`);
  console.log(`tagged v${next} in ${kdir} at ${git(kdir, 'rev-parse', '--short', kref)}`);
}
console.log(`\nNext: push the tag to ci (git push ci main v${next}), build and deploy, and put these notes where users read them:\n\n${notes}`);
