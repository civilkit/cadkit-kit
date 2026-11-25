import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain .mjs module without types
import { releaseCommitCheck, kitCiVerdict, contentOnlyPathsCheck, contentOnlyDecision, parseLiveVersion, readLiveVersion, untrackedProblems } from './gate_rules.mjs';
// @ts-expect-error plain .mjs module without types
import { regenerateWhatsNew, diffEntries, untrackedFiles } from './gate_regen.mjs';

const repo = resolve(__dirname, '..');
const sh = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
const show = (c: string) => sh('show', '--no-color', '--no-renames', '--format=', c);

const R12 = '1d41b10ef44361b3d1e268a707f72921ad75b75e';
const R11 = '7d0eba56';
const IDX = 'apps/cad/public/whats-new/index.html';
const idx12: string = sh('show', `${R12}:${IDX}`);
const gen12 = { indexHtml: idx12, regenerate: () => idx12 };
const d12 = show(R12);
const d11 = show(R11);

describe('release commit rule (real commits)', () => {
  it('accepts 0.8.12 (all six files) and 0.8.11 (three files)', () => {
    const a = releaseCommitCheck({ subject: 'Release 0.8.12', diffText: d12, tagsAtCommit: ['v0.8.12'], ...gen12 });
    expect(a.ok, a.reason).toBe(true);
    expect(a.version).toBe('0.8.12');
    const b = releaseCommitCheck({ subject: 'Release 0.8.11', diffText: d11, tagsAtCommit: [] , tagBeingCut: 'v0.8.11', ...gen12 });
    expect(b.ok, b.reason).toBe(true);
  });
  it('accepts when the tag is only being cut, refuses with no tag', () => {
    expect(releaseCommitCheck({ subject: 'Release 0.8.12', diffText: d12, tagBeingCut: 'v0.8.12', ...gen12 }).ok).toBe(true);
    expect(releaseCommitCheck({ subject: 'Release 0.8.12', diffText: d12, tagsAtCommit: [] }).ok).toBe(false);
  });
  it('refuses a wrong version or tag', () => {
    expect(releaseCommitCheck({ subject: 'Release 0.8.13', diffText: d12, tagsAtCommit: ['v0.8.13'] }).ok).toBe(false); // diff sets 0.8.12
    expect(releaseCommitCheck({ subject: 'Release 0.8.12', diffText: d12, tagsAtCommit: ['v0.8.11'] }).ok).toBe(false);
    expect(releaseCommitCheck({ subject: 'Release 0.8.12', diffText: d12, tagBeingCut: 'v0.8.13' }).ok).toBe(false);
  });
  it('refuses a non-Release subject', () => {
    for (const s of ['Release 0.8.12 and more', 'release 0.8.12', 'Release 0.8', 'Fix things', 'Release 0.8.12\nextra']) {
      expect(releaseCommitCheck({ subject: s, diffText: d12, tagsAtCommit: ['v0.8.12'] }).ok, s).toBe(false);
    }
  });
});

const ok12 = (diff: string, g: Record<string, unknown> = gen12) => releaseCommitCheck({ subject: 'Release 0.8.12', diffText: diff, tagsAtCommit: ['v0.8.12'], ...g });
const extraFile = (path: string) => `${d12}diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,1 @@\n-a\n+b\n`;

describe('release commit rule (generated page)', () => {
  it('the real generator reproduces the committed 0.8.12 page, so the wiring accepts it', () => {
    const regen = regenerateWhatsNew(repo, R12);
    expect(regen).toBe(idx12);
    expect(ok12(d12, { indexHtml: idx12, regenerate: () => regenerateWhatsNew(repo, R12) }).ok).toBe(true);
  });
  it('refuses a page one byte different, a script injected, an unreadable or unregenerable page', () => {
    const one = idx12.replace('What&#39;s new', 'What&#39;s New');
    expect(one).not.toBe(idx12);
    for (const [name, g] of Object.entries({
      'one byte': { indexHtml: one, regenerate: () => idx12 },
      'script tag': { indexHtml: idx12.replace('</body>', '<script>fetch("//x")</script></body>'), regenerate: () => idx12 },
      'trailing newline': { indexHtml: idx12 + '\n', regenerate: () => idx12 },
      'no committed text': { indexHtml: undefined, regenerate: () => idx12 },
      'no provider': { indexHtml: idx12 },
      'provider throws': { indexHtml: idx12, regenerate: () => { throw new Error('boom'); } },
      'provider empty': { indexHtml: idx12, regenerate: () => '' },
    })) {
      const r = ok12(d12, g);
      expect(r.ok, name).toBe(false);
      expect(r.reason, name).toContain(IDX);
    }
  });
});

describe('release commit rule (tampered)', () => {
  it('refuses an extra source file', () => {
    for (const p of ['packages/part-model/src/a.ts', 'apps/cad/src/main.tsx', 'tools/release.mjs', 'docs/whats-new/highlights.json', 'apps/cad/public/whats-new/posters/x.png']) {
      const r = ok12(extraFile(p));
      expect(r.ok, p).toBe(false);
      expect(r.reason).toContain(p);
    }
  });
  it('refuses a version bump hiding another change in package.json', () => {
    const hidden = d12.replace(' {\n   "name": "kit",\n-  "version": "0.8.11",\n+  "version": "0.8.12",\n', ' {\n   "name": "kit",\n-  "version": "0.8.11",\n+  "version": "0.8.12",\n+  "scripts2": "x",\n');
    expect(hidden).not.toBe(d12);
    expect(ok12(hidden).ok).toBe(false);
    const swapped = d12.replace('-  "version": "0.8.11",\n+  "version": "0.8.12",', '-  "private": false,\n+  "private": true,');
    expect(swapped).not.toBe(d12);
    expect(ok12(swapped).ok).toBe(false);
  });
  it('refuses a different version value, a nested version key and a version in the wrong Cargo table', () => {
    expect(ok12(d12.replace('+  "version": "0.8.12",', '+  "version": "0.9.0",')).ok).toBe(false);
    expect(ok12(d12.replace('-  "version": "0.8.11",\n+  "version": "0.8.12",', '-    "version": "0.8.11",\n+    "version": "0.8.12",')).ok).toBe(false);
    expect(ok12(d12.replace(' [package]\n name = "civilkit-cad"\n-version', ' [dependencies]\n name = "civilkit-cad"\n-version')).ok).toBe(false);
    expect(ok12(d12.replace(' name = "civilkit-cad"\n-version = "0.8.11"\n+version = "0.8.12"\n dependencies', ' name = "other"\n-version = "0.8.11"\n+version = "0.8.12"\n dependencies')).ok).toBe(false);
  });
  it('refuses CHANGELOG edits beyond the heading', () => {
    const edited = d12.replace('+## 0.8.12 - 2026-11-24\n', '+## 0.8.12 - 2026-11-24\n+\n+- sneaky new entry\n');
    expect(edited).not.toBe(d12);
    expect(ok12(edited).ok).toBe(false);
    expect(ok12(d12.replace('+## 0.8.12 - 2026-11-24\n', '+## 0.8.11 - 2026-11-24\n')).ok).toBe(false);
    expect(ok12(d12.replace('+## 0.8.12 - 2026-11-24\n', '')).ok).toBe(false);
  });
  it('refuses new, deleted, renamed, binary and mode-changed files, and an unparseable diff', () => {
    const base = d12.replace('index 712de52e', 'new file mode 100644\nindex 712de52e');
    expect(ok12(base).ok).toBe(false);
    expect(ok12(d12.replace('index 712de52e', 'old mode 100644\nnew mode 100755\nindex 712de52e')).ok).toBe(false);
    expect(ok12(`${d12}diff --git a/package.json b/other.json\nsimilarity index 90%\nrename from package.json\nrename to other.json\n`).ok).toBe(false);
    expect(ok12('').ok).toBe(false);
    expect(ok12('garbage').ok).toBe(false);
    expect(ok12(`${d12}diff --git a/desktop/package.json b/desktop/package.json\n@@ -1 +1 @@\nweird line\n`).ok).toBe(false);
  });
  it('refuses a diff missing package.json or CHANGELOG.md', () => {
    const only = d12.split('diff --git ').filter((b) => b.startsWith('a/apps/cad/public/whats-new')).map((b) => `diff --git ${b}`).join('');
    expect(only).toContain('whats-new');
    expect(ok12(only).ok).toBe(false);
  });
});

const P = 'p'.repeat(40), H = 'h'.repeat(40);
const rec = (sha: string, verdict: string, tier = 'full', repoName = 'kit') => ({ repo: repoName, tier, sha, verdict });
const rel = (recs: unknown[], over: Record<string, unknown> = {}) => kitCiVerdict({ head: H, subject: 'Release 0.8.12', tagsAtCommit: ['v0.8.12'], parent: P, diffText: d12, ...gen12, recs, ...over });

describe('kit CI verdict', () => {
  it('uses the parent when it is GREEN and the commit has no verdict', () => {
    const v = rel([rec(P, 'GREEN')]);
    expect(v.problems).toEqual([]);
    expect(v.rule).toBe('release-parent');
    expect(v.note).toContain(`Release commit on green parent ${P.slice(0, 10)}`);
  });
  it('refuses a RED, FLAKY or missing parent', () => {
    for (const recs of [[rec(P, 'RED')], [rec(P, 'FLAKY')], [], [rec(P, 'GREEN', 'quick')], [rec(P, 'GREEN', 'full', 'kernel')], [rec('x'.repeat(40), 'GREEN')]]) {
      const v = rel(recs);
      expect(v.problems.length, JSON.stringify(recs)).toBeGreaterThan(0);
      expect(v.rule).toBe('own');
    }
  });
  it('the newest record wins (a later RED on the parent counts)', () => {
    expect(rel([rec(P, 'GREEN'), rec(P, 'RED')]).problems.length).toBeGreaterThan(0);
    expect(rel([rec(P, 'RED'), rec(P, 'GREEN')]).problems).toEqual([]);
  });
  it('never overrides a verdict on the commit itself', () => {
    expect(rel([rec(P, 'GREEN'), rec(H, 'RED')]).problems[0]).toContain('RED');
    expect(rel([rec(P, 'GREEN'), rec(H, 'FLAKY')]).problems[0]).toContain('FLAKY');
    expect(rel([rec(H, 'GREEN')]).rule).toBe('own');
  });
  it('falls back to the plain rule when the generated page was tampered with', () => {
    expect(rel([rec(P, 'GREEN')], { indexHtml: idx12 + '<script></script>' }).problems.length).toBeGreaterThan(0);
  });
  it('falls back to the plain rule for a non-Release subject, a wrong tag, a tampered diff, no parent or no diff', () => {
    const g = [rec(P, 'GREEN')];
    expect(rel(g, { subject: 'Fix a bug' }).problems.length).toBeGreaterThan(0);
    expect(rel(g, { tagsAtCommit: ['v0.8.11'] }).problems.length).toBeGreaterThan(0);
    expect(rel(g, { diffText: extraFile('apps/cad/src/x.ts') }).problems.length).toBeGreaterThan(0);
    expect(rel(g, { parent: undefined }).problems.length).toBeGreaterThan(0);
    expect(rel(g, { diffText: undefined }).problems.length).toBeGreaterThan(0);
  });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]);
const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]);
const TXT = Buffer.from('<html><script>alert(1)</script>');
const ent = (path: string, o: Record<string, unknown> = {}) => ({ path, status: 'M', oldMode: '100644', newMode: '100644', head: path.match(/\.(png|jpe?g|webp)$/i) ? (/\.png$/i.test(path) ? PNG : /\.webp$/i.test(path) ? WEBP : JPG) : undefined, ...o });
const chk = (entries: unknown[], g: Record<string, unknown> = gen12) => contentOnlyPathsCheck(entries, g);

describe('content-only paths', () => {
  it('accepts a poster, the regenerated whats-new page and the CHANGELOG', () => {
    expect(chk([ent('apps/cad/public/whats-new/posters/gears.png', { status: 'A' }), ent(IDX), ent('CHANGELOG.md')]).ok).toBe(true);
    expect(chk([ent('docs/whats-new/highlights.json'), ent('docs/releasing.md'), ent('tools/clips/12-gear.mjs'), ent('docs/guide/x.md'), ent('apps/cad/public/whats-new/posters/a.webp'), ent('apps/cad/public/whats-new/posters/b.jpg')]).ok).toBe(true);
  });
  it('accepts a deletion of a poster', () => {
    expect(chk([ent('apps/cad/public/whats-new/posters/old.png', { status: 'D', newMode: '000000', head: undefined })]).ok).toBe(true);
  });
  it('refuses app source, package files, config, scripts and empty diffs', () => {
    for (const p of ['apps/cad/src/main.tsx', 'package.json', 'package-lock.json', 'desktop/package.json', 'packages/part-model/src/a.ts', 'apps/cad/src/x.css', 'tools/deploy_site.mjs', 'tools/build_pages.mjs',
      'docs/apps/x.md', 'docs/packages/x.md', 'docs/script.mjs', 'apps/cad/public/whats-new/x.js', 'apps/cad/public/whats-new/evil.svg', 'apps/cad/public/sw.js', 'docs/../package.json', '/etc/passwd', 'tools/clips/../x.mjs']) {
      expect(chk([ent('CHANGELOG.md'), ent(p)]).ok, p).toBe(false);
    }
    expect(chk([]).ok).toBe(false);
  });
  it('refuses svg, js, css, wasm and html (other than index.html) anywhere in the allowlist', () => {
    for (const p of ['apps/cad/public/whats-new/posters/a.svg', 'apps/cad/public/whats-new/zoom/video-zoom.js', 'apps/cad/public/whats-new/zoom/video-zoom.css', 'apps/cad/public/whats-new/a.wasm',
      'apps/cad/public/whats-new/evil.html', 'apps/cad/public/whats-new/posters/evil.html', 'apps/cad/public/whats-new/posters/evil.HTML', 'apps/cad/public/whats-new/index.htm',
      'apps/cad/public/whats-new/sub/index.html', 'tools/clips/a.svg', 'tools/clips/a.html', 'tools/clips/a.css', 'docs/whats-new/a.svg', 'docs/whats-new/a.js']) {
      expect(chk([ent(p)]).ok, p).toBe(false);
    }
  });
  it('refuses committed mp4 and webm and says clips are not committed', () => {
    for (const p of ['apps/cad/public/whats-new/clips/a.mp4', 'apps/cad/public/whats-new/clips/a.webm']) {
      const r = chk([ent(p, { status: 'A', head: MP4 })]);
      expect(r.ok, p).toBe(false);
      expect(r.reason).toContain('clips are not committed: copy them into apps/cad/public/whats-new/clips untracked');
    }
  });
  it('accepts a poster only when its bytes are an image of the named kind', () => {
    expect(chk([ent('apps/cad/public/whats-new/posters/a.png', { head: PNG })]).ok).toBe(true);
    for (const [name, e] of Object.entries({
      'text as png': ent('apps/cad/public/whats-new/posters/a.png', { head: TXT }),
      'jpeg as png': ent('apps/cad/public/whats-new/posters/a.png', { head: JPG }),
      'no bytes': ent('apps/cad/public/whats-new/posters/a.png', { head: undefined }),
      'riff but not webp': ent('apps/cad/public/whats-new/posters/a.webp', { head: Buffer.from('RIFF....WAVEfmt ') }),
      'docs poster text': ent('docs/whats-new/a.png', { head: TXT }),
    })) expect(chk([e]).ok, name).toBe(false);
  });
  it('refuses symlinks, mode changes, new executables and other statuses', () => {
    const P = 'apps/cad/public/whats-new/posters/a.png';
    for (const [name, o] of Object.entries({
      'symlink new': { status: 'A', oldMode: '000000', newMode: '120000' },
      'symlink replacing a file': { newMode: '120000' },
      'file replaced by a symlink typechange': { status: 'T', newMode: '120000' },
      'symlink modified': { oldMode: '120000', newMode: '120000' },
      'executable': { newMode: '100755' },
      'submodule': { newMode: '160000' },
      'rename': { status: 'R' },
      'unknown': { status: '?' },
    })) expect(chk([ent(P, o)]).ok, name).toBe(false);
  });
  it('real git: a committed symlink is mode 120000 and refused; a png-named text file is refused; a real png passes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-git-'));
    try {
      const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
      g('init', '-q'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 'n');
      mkdirSync(join(dir, 'apps/cad/public/whats-new/posters'), { recursive: true });
      writeFileSync(join(dir, 'f'), 'x'); g('add', '.'); g('commit', '-qm', 'base');
      const P = join(dir, 'apps/cad/public/whats-new/posters');
      symlinkSync('/etc/passwd', join(P, 'link.json'));
      writeFileSync(join(P, 'fake.png'), TXT); writeFileSync(join(P, 'real.png'), PNG);
      g('add', '-A'); g('commit', '-qm', 'content');
      const e = diffEntries(dir, 'HEAD~1', 'HEAD');
      const by = Object.fromEntries(e.map((x: { path: string }) => [x.path.split('/').pop(), x]));
      expect(by['link.json'].newMode).toBe('120000');
      expect(chk([by['link.json']]).ok).toBe(false);
      expect(chk([by['fake.png']]).ok).toBe(false);
      expect(chk([by['real.png']]).ok).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('real git: untrackedFiles sees untracked and ignored clips, symlinks and source', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-git-'));
    try {
      const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
      g('init', '-q'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 'n');
      mkdirSync(join(dir, 'apps/cad/public/whats-new/clips'), { recursive: true });
      mkdirSync(join(dir, 'apps/cad/public/kernel'), { recursive: true });
      writeFileSync(join(dir, '.gitignore'), 'apps/cad/public/whats-new/clips/\napps/cad/public/kernel/\n');
      g('add', '.'); g('commit', '-qm', 'base');
      writeFileSync(join(dir, 'apps/cad/public/whats-new/clips/a.mp4'), MP4);
      symlinkSync('/etc/passwd', join(dir, 'apps/cad/public/whats-new/clips/b.mp4'));
      writeFileSync(join(dir, 'apps/cad/public/kernel/ck.wasm'), 'w');
      expect(untrackedProblems(untrackedFiles(dir))).toEqual(['apps/cad/public/whats-new/clips/b.mp4']);
      writeFileSync(join(dir, 'evil.ts'), 'x');
      expect(untrackedProblems(untrackedFiles(dir)).sort()).toEqual(['apps/cad/public/whats-new/clips/b.mp4', 'evil.ts']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('the whats-new page must be regenerated byte for byte (in content-only too)', () => {
    expect(chk([ent(IDX)], { indexHtml: idx12 + ' ', regenerate: () => idx12 }).ok).toBe(false);
    expect(chk([ent(IDX)], { indexHtml: idx12.replace('</body>', '<script src=//x></script></body>'), regenerate: () => idx12 }).ok).toBe(false);
    expect(chk([ent(IDX)], {}).ok).toBe(false);
    expect(chk([ent(IDX, { status: 'D', newMode: '000000' })]).ok).toBe(false);
    expect(chk([ent(IDX, { status: 'A', oldMode: '000000' })]).ok).toBe(true); // an added page that is still the generated one
  });
});

describe('untracked files', () => {
  const u = (path: string, head: Buffer | undefined, regular = true) => ({ path, head, regular });
  it('accepts clips and posters that really are media', () => {
    expect(untrackedProblems([u('apps/cad/public/whats-new/clips/a.mp4', MP4), u('apps/cad/public/whats-new/clips/a.webm', WEBM), u('apps/cad/public/whats-new/posters/a.png', PNG)])).toEqual([]);
    expect(untrackedProblems([])).toEqual([]);
  });
  it('refuses source, scripts, html, svg, fake media, symlinks, nested and unknown input', () => {
    const bad = [u('apps/cad/src/new.ts', TXT), u('apps/cad/public/whats-new/evil.html', TXT), u('apps/cad/public/whats-new/clips/a.html', TXT), u('apps/cad/public/whats-new/clips/a.mp4', TXT),
      u('apps/cad/public/whats-new/clips/a.mp4', WEBM), u('apps/cad/public/whats-new/posters/a.svg', TXT), u('apps/cad/public/whats-new/posters/a.png', TXT), u('apps/cad/public/whats-new/clips/a.mp4', MP4, false),
      u('apps/cad/public/whats-new/clips/sub/a.mp4', MP4), u('apps/cad/public/whats-new/clips/../x.mp4', MP4), u('apps/cad/public/sw.js', TXT), u('apps/cad/public/whats-new/posters/a.mp4', MP4)];
    for (const b of bad) expect(untrackedProblems([b]), b.path).toEqual([b.path]);
    expect(untrackedProblems(undefined as unknown as never[]).length).toBe(1);
    expect(untrackedProblems([u('x.ts', TXT), u('apps/cad/public/whats-new/clips/a.mp4', MP4)])).toEqual(['x.ts']);
  });
});

describe('live version', () => {
  const good = '{"version":"0.8.12","kit":"1d41b10ef443","kernel":"d5aa08b6742d","channel":"release"}\n';
  it('parses a release version.json', () => {
    expect(parseLiveVersion(good)).toEqual({ kit: '1d41b10ef443', kernel: 'd5aa08b6742d', channel: 'release', version: '0.8.12' });
  });
  it('refuses preview, dirty, short, malformed and unreadable', () => {
    for (const t of [good.replace('release', 'preview'), good.replace('1d41b10ef443', '1d41b10ef443-dirty'), good.replace('d5aa08b6742d', 'unknown'), good.replace('1d41b10ef443', '1d41b1'), 'not json', '', 'null', '[]']) {
      expect(parseLiveVersion(t).error, t).toBeTruthy();
    }
  });
  it('reads through an injected fetch and survives its failure', () => {
    expect(readLiveVersion(() => good).kit).toBe('1d41b10ef443');
    expect(readLiveVersion(() => { throw new Error('offline'); }).error).toContain('offline');
  });
});

const LIVE = parseLiveVersion('{"version":"0.8.12","kit":"1d41b10ef443","kernel":"d5aa08b6742d","channel":"release"}');
const WASM = '/x/_release-wasm/ck-full-gate/20261125-031205-d5aa08b674/ck_wasm.wasm';
const facts = (o: Record<string, unknown> = {}) => ({ live: LIVE, liveResolved: '1d41b10ef443' + 'a'.repeat(28), head: 'b'.repeat(40), liveIsAncestor: true,
  entries: [ent('apps/cad/public/whats-new/posters/a.png'), ent(IDX), ent('CHANGELOG.md')], ...gen12, untracked: [], kernelHead: 'd5aa08b6742d' + 'c'.repeat(28), wasm: WASM, clean: true, branch: 'main', ...o });

describe('content-only decision', () => {
  it('accepts the all-content case', () => {
    const d = contentOnlyDecision(facts());
    expect(d.problems).toEqual([]);
    expect(d.ok).toBe(true);
    expect(d.why).toContain('content-only over 1d41b10ef443');
  });
  it('accepts untracked clips and posters', () => {
    const d = contentOnlyDecision(facts({ untracked: [{ path: 'apps/cad/public/whats-new/clips/a.mp4', regular: true, head: MP4 }, { path: 'apps/cad/public/whats-new/posters/a.png', regular: true, head: PNG }] }));
    expect(d.problems).toEqual([]);
  });
  it('refuses each failed condition', () => {
    const bad: Record<string, Record<string, unknown>> = {
      'app source': { entries: [ent('CHANGELOG.md'), ent('apps/cad/src/main.tsx')] },
      'package.json': { entries: [ent('package.json')] },
      'kernel moved': { kernelHead: 'e'.repeat(40) },
      'wasm of another kernel': { wasm: '/x/ck-full-gate/20261125-000000-aaaaaaaaaa/ck_wasm.wasm' },
      'wasm not a gate folder': { wasm: '/x/build/ck_wasm.wasm' },
      'diverged history': { liveIsAncestor: false },
      'live unknown here': { liveResolved: '' },
      'HEAD is live': { head: '1d41b10ef443' + 'a'.repeat(28), liveResolved: '1d41b10ef443' + 'a'.repeat(28) },
      'dirty tree': { clean: false },
      'not main': { branch: 'feature' },
      'no changes': { entries: [] },
      'entries unreadable': { entries: null },
      'tampered page': { indexHtml: idx12 + 'x' },
      'untracked source': { untracked: [{ path: 'apps/cad/src/x.ts', regular: true, head: TXT }] },
      'untracked unknown': { untracked: undefined },
      'untracked symlink clip': { untracked: [{ path: 'apps/cad/public/whats-new/clips/a.mp4', regular: false }] },
      'preview live': { live: parseLiveVersion('{"kit":"1d41b10ef443","kernel":"d5aa08b6742d","channel":"preview"}') },
      'unreadable live': { live: readLiveVersion(() => { throw new Error('x'); }) },
    };
    for (const [name, o] of Object.entries(bad)) {
      const d = contentOnlyDecision(facts(o));
      expect(d.ok, name).toBe(false);
      expect(d.problems.length, name).toBeGreaterThan(0);
    }
  });
});

describe('clipReadiness (RULE 3: four visual changes with a clip each)', () => {
  const all = () => true, none = () => false;
  it('accepts four entries that all have a clip and a poster', async () => {
    const { clipReadiness } = await import('./gate_rules.mjs');
    const r = clipReadiness({ entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], hasClip: all, hasPoster: all });
    expect(r.ok).toBe(true); expect(r.count).toBe(4);
  });
  it('refuses three, and names the shortfall', async () => {
    const { clipReadiness } = await import('./gate_rules.mjs');
    const r = clipReadiness({ entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], hasClip: all, hasPoster: all });
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/only 3 of the 4/);
  });
  it('does not count an entry with a missing clip or poster, and says which', async () => {
    const { clipReadiness } = await import('./gate_rules.mjs');
    const r = clipReadiness({ entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }], hasClip: (id: string) => id !== 'b', hasPoster: (id: string) => id !== 'e' });
    expect(r.ok).toBe(false); expect(r.count).toBe(3);
    expect(r.missing).toEqual(['b (no clip)', 'e (no poster)']);
  });
  it('refuses no highlights at all, an entry without an id, and a non-list', async () => {
    const { clipReadiness } = await import('./gate_rules.mjs');
    expect(clipReadiness({ entries: [], hasClip: all, hasPoster: all }).ok).toBe(false);
    expect(clipReadiness({ entries: undefined, hasClip: all, hasPoster: all }).ok).toBe(false);
    expect(clipReadiness({ entries: [{}, { id: 'a' }, { id: 'b' }, { id: 'c' }], hasClip: all, hasPoster: all }).ok).toBe(false);
    expect(clipReadiness({ entries: [{ id: 'a' }], hasClip: none, hasPoster: none }).ok).toBe(false);
  });
});
