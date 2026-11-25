// The impure helpers of the go-live gate rules (tools/gate_rules.mjs stays pure): they read git and run the real generator.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, lstatSync, openSync, readSync, closeSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const INDEX_PATH = 'apps/cad/public/whats-new/index.html';

// What tools/make_whats_new.mjs writes for `commit` (default HEAD): only that commit's tracked files are extracted into a temporary
// directory (git archive), the generator of that commit runs there, and the real working tree is never touched. Throws on any failure.
export function regenerateWhatsNew(root, commit = 'HEAD') {
  const tmp = mkdtempSync(join(tmpdir(), 'whatsnew-regen-'));
  try {
    const ar = spawnSync('git', ['archive', '--format=tar', commit, '--', 'tools', 'CHANGELOG.md', 'docs/whats-new', 'apps/cad/public/whats-new'], { cwd: root, maxBuffer: 256 << 20 });
    if (ar.status !== 0) throw new Error(`git archive failed: ${String(ar.stderr).slice(0, 100)}`);
    const tar = spawnSync('tar', ['-x', '-C', tmp], { input: ar.stdout });
    if (tar.status !== 0) throw new Error('tar extract failed');
    const g = spawnSync(process.execPath, ['tools/make_whats_new.mjs'], { cwd: tmp, encoding: 'utf8', timeout: 60000 });
    if (g.status !== 0) throw new Error(`make_whats_new exit ${g.status}: ${(g.stderr || '').slice(0, 100)}`);
    return readFileSync(join(tmp, INDEX_PATH), 'utf8');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// the committed text of a file at a commit, or undefined
export function committedText(root, commit, path) {
  const r = spawnSync('git', ['show', `${commit}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  return r.status === 0 ? r.stdout : undefined;
}

// `git diff --raw -z --no-renames from..to` -> [{ path, status, oldMode, newMode, head }] (head = first 16 bytes of the new blob)
export function diffEntries(root, from, to) {
  const r = spawnSync('git', ['diff', '--raw', '-z', '--no-renames', '--no-ext-diff', `${from}..${to}`], { cwd: root, maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('git diff --raw failed');
  const t = r.stdout.toString('latin1').split('\0');
  const entries = [];
  for (let i = 0; i + 1 < t.length; i += 2) {
    const m = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(t[i]);
    const path = Buffer.from(t[i + 1], 'latin1').toString('utf8');
    if (!m) { entries.push({ path: t[i + 1] || t[i], status: '?', oldMode: '', newMode: '' }); continue; }
    const e = { path, status: m[5], oldMode: m[1], newMode: m[2] };
    if (m[5] !== 'D' && m[2] === '100644') {
      const b = spawnSync('git', ['cat-file', 'blob', m[4]], { cwd: root, maxBuffer: 256 << 20 });
      if (b.status === 0) e.head = b.stdout.subarray(0, 16);
    }
    entries.push(e);
  }
  return entries;
}

// Files not in git that the build would copy into the deploy: untracked (not ignored) anywhere, plus ignored ones under apps/cad/public
// except the build's own kernel/ and quiddity/ folders (the clips folder is ignored). Each { path, regular, head }.
export function untrackedFiles(root) {
  const ls = (...a) => { const r = spawnSync('git', ['ls-files', '-z', '--others', ...a], { cwd: root, maxBuffer: 64 << 20 }); if (r.status !== 0) throw new Error('git ls-files failed'); return r.stdout.toString('utf8').split('\0').filter(Boolean); };
  const ignored = ls('--ignored', '--exclude-standard', '--', 'apps/cad/public').filter((p) => !p.startsWith('apps/cad/public/kernel/') && !p.startsWith('apps/cad/public/quiddity/'));
  return [...new Set([...ls('--exclude-standard'), ...ignored])].map((path) => {
    const full = join(root, path);
    try {
      const st = lstatSync(full);
      if (!st.isFile()) return { path, regular: false };
      const fd = openSync(full, 'r'); const head = Buffer.alloc(16); readSync(fd, head, 0, 16, 0); closeSync(fd);
      return { path, regular: true, head };
    } catch { return { path, regular: false }; }
  });
}
