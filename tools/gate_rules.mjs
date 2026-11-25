// Pure rules of the go-live gate (no git, no network, no clock): text in, verdict out, so they are unit tested (tools/gate_rules.test.ts)
// and tools/ci_gate.mjs, tools/release.mjs and tools/deploy_site.mjs only supply the facts. Every rule FAILS CLOSED: anything it cannot
// parse or does not recognise is a refusal, and a refusal always means "fall back to the full requirement".
//
// == RULE 1: a pure Release commit may use its parent's GREEN full-tier verdict (releaseCommitCheck) ==
//    tools/release.mjs only edits version lines, the CHANGELOG and the generated What's new page, so the full CI on that commit would re-run
//    the same tests as on its parent. The rule accepts only a commit whose subject is "Release X.Y.Z", that carries (or is being given) tag vX.Y.Z,
//    and whose diff touches nothing but the files release.mjs writes, changing in them nothing but what it changes.
// == RULE 2: content-only deploy (contentOnlyPathsCheck, parseLiveVersion, contentOnlyDecision) ==
//    deploy_site.mjs --content-only may skip the kit CI when everything since the live release is What's new content or prose
//    and the kernel and wasm are the live ones. The generated page is regenerated from the commit and compared byte for byte; files not in git that the build
//    would copy in must be clips or posters (untrackedProblems).

const INDEX_PATH = 'apps/cad/public/whats-new/index.html';

// The generated What's new page is served same-origin: it must be exactly what the generator writes from the commit's CHANGELOG and highlights.
// Returns a problem string or null. Anything unverifiable (no provider, a throw, a non-string) is a problem.
export function regeneratedPageProblem(path, committed, regenerate) {
  if (typeof committed !== 'string') return `${path}: the committed page could not be read, so it cannot be checked`;
  if (typeof regenerate !== 'function') return `${path}: no way to regenerate the page, so it cannot be checked`;
  let want;
  try { want = regenerate(); } catch (e) { return `${path}: regenerating the page failed (${String(e?.message ?? e).slice(0, 100)})`; }
  if (typeof want !== 'string' || !want) return `${path}: regenerating the page gave nothing`;
  if (want !== committed) return `${path}: differs from what tools/make_whats_new.mjs generates from this commit's CHANGELOG.md and highlights.json (run it and commit the result)`;
  return null;
}

const RELEASE_SUBJECT = /^Release (\d+\.\d+\.\d+)$/;

// parse `git diff` / `git show` text (any context size) into per-file records
export function parseDiff(text) {
  const files = [];
  let cur = null;
  let hunk = null;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      cur = { path: m ? m[2] : null, special: !m || m[1] !== m[2], hunks: [] };
      if (!m) cur.path = line;
      files.push(cur); hunk = null;
    } else if (!cur) continue; // commit message / header before the first file
    else if (line.startsWith('@@')) { hunk = []; cur.hunks.push(hunk); }
    else if (!hunk) {
      if (/^(new file mode|deleted file mode|old mode|new mode|rename |copy |similarity |dissimilarity |Binary files|GIT binary patch)/.test(line)) cur.special = true;
    } else if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    else if (line.length === 0) hunk.push({ t: ' ', s: '' }); // some tools strip the single space of an empty context line
    else if (' +-'.includes(line[0])) hunk.push({ t: line[0], s: line.slice(1) });
    else return null; // not a diff we understand
  }
  return files;
}

const changed = (f) => f.hunks.flatMap((h) => h.filter((l) => l.t !== ' '));
const NUM = '\\d+\\.\\d+\\.\\d+';

// the single changed pair must be: one "-" version line, one "+" version line of the new version
function versionPairOnly(f, version, oldRe, newLine, where) {
  const ch = changed(f);
  const minus = ch.filter((l) => l.t === '-'), plus = ch.filter((l) => l.t === '+');
  if (minus.length !== 1 || plus.length !== 1) return `${f.path}: more than the version line changed`;
  const om = oldRe.exec(minus[0].s);
  if (!om) return `${f.path}: the removed line is not the version line`;
  if (plus[0].s !== newLine(version)) return `${f.path}: the added line is not the version ${version}`;
  if (om[1] === version) return `${f.path}: the version did not change`;
  if (where) { const bad = where(f); if (bad) return `${f.path}: ${bad}`; }
  return null;
}
// the new-side lines (context and added) of the hunk holding the "+" line, in order, up to and including it
function newSideBefore(f) {
  for (const h of f.hunks) {
    const i = h.findIndex((l) => l.t === '+');
    if (i >= 0) return h.slice(0, i).filter((l) => l.t !== '-').map((l) => l.s);
  }
  return [];
}

function changelogOnlyHeading(f, version) {
  const ch = changed(f).filter((l) => l.s.trim() !== '');
  const heading = new RegExp(`^## ${version.replace(/\./g, '\\.')} - \\d{4}-\\d{2}-\\d{2}$`);
  const heads = ch.filter((l) => l.t === '+' && heading.test(l.s));
  if (heads.length !== 1) return `${f.path}: it does not add exactly one "## ${version} - date" heading`;
  const count = new Map();
  for (const l of ch) { if (l === heads[0]) continue; count.set(l.s, (count.get(l.s) ?? 0) + (l.t === '+' ? 1 : -1)); }
  for (const [s, n] of count) if (n !== 0) return `${f.path}: a line other than the new heading was added or removed ("${s.slice(0, 60)}")`;
  return null;
}

// Rule 1. Input: the commit subject, `git diff parent..commit` (or `git show` of it), the tag names pointing at the commit, the tag release.mjs
// is about to create (or undefined). Output: { ok, reason, version } (the parent's verdict is checked by the caller).
// indexHtml = the committed text of apps/cad/public/whats-new/index.html at the commit, regenerate() = a function returning what
// tools/make_whats_new.mjs writes from the commit's own CHANGELOG.md and highlights (tools/gate_regen.mjs); the page must equal it byte for byte.
export function releaseCommitCheck({ subject, diffText, tagsAtCommit = [], tagBeingCut, indexHtml, regenerate }) {
  const no = (reason) => ({ ok: false, reason, version: null });
  const sm = RELEASE_SUBJECT.exec(String(subject ?? '').trim());
  if (!sm) return no(`the subject "${String(subject).slice(0, 60)}" is not "Release X.Y.Z"`);
  const version = sm[1];
  if (!tagsAtCommit.includes(`v${version}`) && tagBeingCut !== `v${version}`) return no(`no tag v${version} points at this commit`);
  const files = parseDiff(diffText);
  if (!files || !files.length) return no('the diff is empty or cannot be parsed');
  const seen = new Set();
  const byPath = {};
  for (const f of files) {
    if (f.special || !f.path) return no(`${f.path}: not a plain modification (new, deleted, renamed, mode change or binary)`);
    if (seen.has(f.path)) return no(`${f.path} appears twice in the diff`);
    seen.add(f.path); byPath[f.path] = f;
  }
  const checks = {
    'CHANGELOG.md': (f) => changelogOnlyHeading(f, version),
    'package.json': (f) => versionPairOnly(f, version, new RegExp(`^  "version": "(${NUM})",$`), (v) => `  "version": "${v}",`),
    'desktop/package.json': (f) => versionPairOnly(f, version, new RegExp(`^  "version": "(${NUM})",$`), (v) => `  "version": "${v}",`),
    'desktop/src-tauri/Cargo.toml': (f) => versionPairOnly(f, version, new RegExp(`^version = "(${NUM})"$`), (v) => `version = "${v}"`, (g) => {
      const hdr = newSideBefore(g).filter((s) => s.startsWith('[')).pop();
      return hdr === '[package]' ? null : 'the version line is not shown inside the [package] table';
    }),
    'desktop/src-tauri/Cargo.lock': (f) => versionPairOnly(f, version, new RegExp(`^version = "(${NUM})"$`), (v) => `version = "${v}"`, (g) => {
      const before = newSideBefore(g);
      return before[before.length - 1] === 'name = "civilkit-cad"' ? null : 'the version line does not belong to the civilkit-cad entry';
    }),
    [INDEX_PATH]: (f) => regeneratedPageProblem(f.path, indexHtml, regenerate), // generated by tools/make_whats_new.mjs: byte for byte
  };
  for (const p of Object.keys(byPath)) if (!checks[p]) return no(`${p} is not a file a release commit may change`);
  for (const must of ['CHANGELOG.md', 'package.json']) if (!byPath[must]) return no(`${must} is not in the diff: not a release commit`);
  for (const [p, f] of Object.entries(byPath)) { const bad = checks[p](f); if (bad) return no(bad); }
  return { ok: true, reason: `Release ${version}: only the version lines, the CHANGELOG heading and the generated What's new page changed`, version };
}

// The newest full-tier kit record for a sha (the box history is oldest first).
export function fullRecordFor(recs, sha) {
  return recs.filter((x) => x && x.repo === 'kit' && x.tier === 'full' && x.sha === sha).pop();
}

// Rule 1 + the plain rule together: what the kit-CI requirement says about `head`.
// facts: { head, subject, tagsAtCommit, tagBeingCut, parent, diffText, recs, indexHtml, regenerate }. diffText/parent may be undefined (then only the plain rule can apply).
// Returns { problems: [], rule: 'own' | 'release-parent', note }.
export function kitCiVerdict({ head, subject, tagsAtCommit, tagBeingCut, parent, diffText, recs, indexHtml, regenerate }) {
  const own = fullRecordFor(recs, head);
  if (own && own.verdict === 'GREEN') return { problems: [], rule: 'own', note: `GREEN on ${head.slice(0, 10)}` };
  if (own) { // a verdict on the exact commit stands: never overridden by the parent's
    const bad = Object.entries(own.suites ?? {}).filter(([, v]) => v.status !== 'pass').map(([k, v]) => `${k}${v.failed ? ` (${v.failed} failed)` : ''}`).join(', ');
    return { problems: [`the kit CI is ${own.verdict} on ${head.slice(0, 10)}: ${bad || 'see the log'} (box: ci/logs/kit/)`], rule: 'own' };
  }
  const missing = `no full-tier kit CI run for ${head.slice(0, 10)} yet: push it to ci (git push ci main) and wait for the run (about 50 minutes)`;
  if (!parent || diffText === undefined) return { problems: [missing], rule: 'own' };
  const rel = releaseCommitCheck({ subject, diffText, tagsAtCommit, tagBeingCut, indexHtml, regenerate });
  if (!rel.ok) return { problems: [missing], rule: 'own', note: `Release-commit rule not applicable: ${rel.reason}` };
  const prec = fullRecordFor(recs, parent);
  if (!prec) return { problems: [missing, `the Release-commit rule needs the parent ${parent.slice(0, 10)} to have a GREEN full-tier run, and there is none in the box history`], rule: 'own' };
  if (prec.verdict !== 'GREEN') return { problems: [missing, `the Release-commit rule needs a GREEN parent, but ${parent.slice(0, 10)} is ${prec.verdict}`], rule: 'own' };
  return { problems: [], rule: 'release-parent', note: `Release commit on green parent ${parent.slice(0, 10)} (${rel.reason})` };
}

// Rule 2a: which changed entries a content-only deploy accepts. Input: entries from `git diff --raw -z --no-renames live..HEAD`, each
// { path, status ('A'|'M'|'D'|...), oldMode, newMode, head (first bytes of the new blob, Buffer/Uint8Array; absent for D) }.
const startsWith = (h, bytes, at = 0) => !!h && h.length >= at + bytes.length && bytes.every((b, i) => h[at + i] === b);
export function imageKind(h) { // by magic bytes, not by name
  if (startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(h, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(h, [0x52, 0x49, 0x46, 0x46]) && startsWith(h, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith(h, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  return null;
}
export function videoKind(h) {
  if (startsWith(h, [0x66, 0x74, 0x79, 0x70], 4)) return 'mp4';
  if (startsWith(h, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  return null;
}
const IMG_EXT = /\.(png|jpe?g|webp|gif)$/i;
const extKind = (p) => { const e = /\.([a-z0-9]+)$/i.exec(p)?.[1]?.toLowerCase(); return e === 'jpeg' ? 'jpg' : e; };
const NOT_CONTENT = /\.(svg|js|mjs|cjs|css|wasm|htm|html|xhtml|xml|map)$/i;
const PAGE_DIR = 'apps/cad/public/whats-new/';
const goodPath = (p) => typeof p === 'string' && !!p && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === '.' || s === '');

// null when the path may change in a content-only deploy, else the reason. head is only needed for images.
export function contentOnlyPathProblem(p) {
  if (!goodPath(p)) return `${p}: not a plain relative path`;
  if (p === 'CHANGELOG.md') return null;
  if (p === INDEX_PATH) return null; // its bytes are checked separately (regeneratedPageProblem)
  if (p.startsWith(PAGE_DIR)) {
    if (/\.(mp4|webm)$/i.test(p)) return `${p}: clips are not committed: copy them into apps/cad/public/whats-new/clips untracked`;
    if (NOT_CONTENT.test(p)) return `${p}: only index.html (regenerated) and images/json may change in whats-new, not ${extKind(p)}`;
    return /\.(png|jpe?g|webp|gif|json)$/i.test(p) ? null : `${p}: not an image or json`;
  }
  if (p.startsWith('docs/whats-new/')) return /\.(md|json|png|jpe?g|webp)$/i.test(p) ? null : `${p}: not prose, json or an image`;
  if (p.startsWith('tools/clips/')) return /\.(svg|js|css|wasm|html?)$/i.test(p) ? `${p}: not a clip recipe` : null; // the .mjs recipes are not shipped
  if (p.startsWith('docs/')) return p.endsWith('.md') && !p.split('/').some((s) => s === 'apps' || s === 'packages') ? null : `${p}: not a docs .md`;
  return `${p}: not content`;
}
export function contentOnlyPathAllowed(p) { return contentOnlyPathProblem(p) === null; }

// one diff entry -> problem or null
export function contentOnlyEntryProblem(e, { indexHtml, regenerate } = {}) {
  if (!e || typeof e !== 'object') return 'unreadable diff entry';
  const bad = contentOnlyPathProblem(e.path);
  if (bad) return bad;
  if (!['A', 'M', 'D'].includes(e.status)) return `${e.path}: status ${e.status} (only added, modified or deleted files)`;
  if (e.status === 'D') return e.path === INDEX_PATH ? `${e.path}: the page cannot be deleted` : null;
  if (e.newMode !== '100644' || (e.status === 'M' && e.oldMode !== '100644')) return `${e.path}: not a plain file (mode ${e.oldMode} -> ${e.newMode}: symlink, executable or submodule)`;
  if (e.path === INDEX_PATH) return regeneratedPageProblem(e.path, indexHtml, regenerate);
  if (IMG_EXT.test(e.path)) {
    const k = imageKind(e.head);
    if (!k) return `${e.path}: not really an image (the bytes are not PNG, JPEG, WEBP or GIF)`;
    if (k !== extKind(e.path)) return `${e.path}: the name says ${extKind(e.path)} but the bytes are ${k}`;
  }
  return null;
}
export function contentOnlyPathsCheck(entries, ctx = {}) {
  if (!Array.isArray(entries) || !entries.length) return { ok: false, reason: 'nothing changed since the live commit: nothing to deploy', bad: [] };
  const bad = entries.map((e) => contentOnlyEntryProblem(e, ctx)).filter(Boolean);
  return bad.length ? { ok: false, reason: `${bad.length} changed file(s) are not content: ${bad.slice(0, 5).join('; ')}${bad.length > 5 ? '; ...' : ''}`, bad } : { ok: true, reason: `only content changed (${entries.length} files)`, bad: [] };
}

// Rule 2a': files that are not in git but are built into the deploy (the build copies apps/cad/public wholesale). Input: { path, regular, head } for every
// untracked file, and for every ignored one under apps/cad/public except the build's own kernel/ and quiddity/ folders. Only clips and posters, really media.
export function untrackedProblems(files) {
  if (!Array.isArray(files)) return ['the untracked files are unknown'];
  const out = [];
  for (const f of files) {
    const p = f?.path;
    const seg = String(p).split('/');
    const direct = (dir) => goodPath(p) && p.startsWith(dir) && seg.length === dir.split('/').length;
    let ok = false;
    if (f && f.regular === true) {
      if (direct(`${PAGE_DIR}clips/`) && /\.(mp4|webm)$/i.test(p)) ok = videoKind(f.head) === extKind(p);
      else if (direct(`${PAGE_DIR}posters/`) && IMG_EXT.test(p)) ok = imageKind(f.head) === extKind(p);
    }
    if (!ok) out.push(p);
  }
  return out;
}

// Rule 2b: the live version.json (text) -> { kit, kernel, channel, version } or { error }. Only a release-channel deploy of full shas counts.
export function parseLiveVersion(text) {
  let v;
  try { v = JSON.parse(text); } catch { return { error: 'https://civilkit.io/cad/version.json is not readable JSON' }; }
  if (!v || typeof v !== 'object') return { error: 'version.json is not an object' };
  if (v.channel !== 'release') return { error: `the live channel is "${v.channel}", not "release": a content-only deploy needs a gated release to build on` };
  if (typeof v.kit !== 'string' || !/^[0-9a-f]{12}$/.test(v.kit)) return { error: `the live kit "${v.kit}" is not a 12 character commit (a -dirty or unknown build)` };
  if (typeof v.kernel !== 'string' || !/^[0-9a-f]{12}$/.test(v.kernel)) return { error: `the live kernel "${v.kernel}" is not a 12 character commit` };
  return { kit: v.kit, kernel: v.kernel, channel: v.channel, version: v.version };
}
// the live version.json through an injected reader (curl in deploy_site.mjs, a mock in the tests)
export function readLiveVersion(getText) {
  let t;
  try { t = getText(); } catch (e) { return { error: `cannot read the live version.json (${String(e.message ?? e).slice(0, 100)})` }; }
  return parseLiveVersion(t);
}

// Rule 2c: all conditions together. facts: { live (readLiveVersion result), liveIsAncestor (bool), head (full sha), liveResolved (full sha of live.kit or ''),
// entries (see rule 2a), indexHtml, regenerate (rule 1), untracked (rule 2a'), kernelHead (full sha), wasm (path), clean (bool), branch }. Returns { ok, problems, why }.
export function contentOnlyDecision(f) {
  const problems = [];
  if (!f.live || f.live.error) return { ok: false, problems: [f.live?.error ?? 'no live version'], why: '' };
  if (!f.liveResolved || !f.liveResolved.startsWith(f.live.kit)) problems.push(`the live kit commit ${f.live.kit} is not in this repository`);
  else if (f.liveResolved === f.head) problems.push('HEAD is the live commit: nothing to deploy');
  else if (!f.liveIsAncestor) problems.push(`the live kit commit ${f.live.kit} is not an ancestor of HEAD (diverged history)`);
  const pc = contentOnlyPathsCheck(f.entries, { indexHtml: f.indexHtml, regenerate: f.regenerate });
  if (!pc.ok) problems.push(pc.reason);
  if (!f.kernelHead || !f.kernelHead.startsWith(f.live.kernel)) problems.push(`the kernel checkout is at ${String(f.kernelHead).slice(0, 12)}, the live kernel is ${f.live.kernel}`);
  const wm = /(?:^|\/)ck-full-gate\/\d{8}-\d{6}-([0-9a-f]{10})\/[^/]+$/.exec(String(f.wasm ?? ''));
  if (!wm) problems.push('the wasm is not from a ck-full-gate/<time>-<sha10>/ run folder');
  else if (!f.live.kernel.startsWith(wm[1])) problems.push(`the wasm was built from ${wm[1]}, the live kernel is ${f.live.kernel}`);
  if (!f.clean) problems.push('the working tree has uncommitted changes');
  const un = untrackedProblems(f.untracked);
  if (un.length) problems.push(`${un.length} untracked file(s) would be built into the deploy (only clips .mp4/.webm and posters images are allowed): ${un.slice(0, 5).join(', ')}${un.length > 5 ? ', ...' : ''}`);
  if (f.branch !== 'main') problems.push(`on branch ${f.branch}, not main`);
  return { ok: problems.length === 0, problems, why: `content-only over ${f.live.kit}: ${pc.reason}; kernel and wasm are the live ${f.live.kernel}` };
}


// == RULE 3: a release should carry 4 visual changes with a clip each (owner 2026-11-25: "we were aiming for 4 VISUAL changes per deploy, so we would have 4 nice videos") ==
// Pure: highlight entries of the version ({id}), predicates for "the clip files exist" (mp4 and webm) and "the poster exists". Returns { ok, count, min, missing, reason }.
export const MIN_CLIPS = 4;
export function clipReadiness({ entries, hasClip, hasPoster, min = MIN_CLIPS }) {
  const list = Array.isArray(entries) ? entries : [];
  const ready = [], missing = [];
  for (const e of list) {
    const id = e && typeof e.id === 'string' ? e.id : '';
    if (!id) { missing.push('(an entry without an id)'); continue; }
    if (hasClip(id) && hasPoster(id)) ready.push(id);
    else missing.push(`${id} (${!hasClip(id) ? 'no clip' : 'no poster'})`);
  }
  const ok = ready.length >= min;
  return { ok, count: ready.length, min, missing, reason: ok ? `${ready.length} highlights with a clip and a poster` : `only ${ready.length} of the ${min} highlights wanted have a clip and a poster${missing.length ? `; missing: ${missing.join(', ')}` : ''}` };
}
