#!/usr/bin/env node
// Drafts the r/civilkit release post for one version (or several, merged) as a Markdown file. It never posts anything: the owner pastes the text.
//   node tools/release_post.mjs 0.7.0 [--out <dir>] [--catchup 0.6.3] [--mac | --no-mac] [--max 12]
//
// Writes <out>/civilkit-<version>.md (default out: the current directory). Line 1 is the post title (plain text, at most 300 characters),
// a blank line, then the body in Reddit-flavoured Markdown. Inputs: CHANGELOG.md (the "## X.Y.Z - date" sections, entries "- **Title.** text")
// and docs/whats-new/highlights.json (the highlights with clips; a missing file is fine, the post then leads with the first entries).
// --catchup <from> merges every released section from <from> up to <version> into one post ("since <from>").
// The Mac app line is added only with --mac (the GitHub release is a draft until the owner publishes it, so it is not assumed).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { anchor, firstSentence, parseChangelog } from './make_whats_new.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://civilkit.io/cad/';
const NEWS = `${SITE}whats-new/`;
const GUIDE = 'https://civilkit.io/docs/cad/';
const RELEASES = 'https://github.com/civilkit/cadkit-kit/releases';
const KIT = 'https://github.com/civilkit/cadkit-kit';
const KERNEL = 'https://github.com/civilkit/cadkit-kernel';
const TITLE_MAX = 300;

const vkey = (v) => v.split('.').map(Number);
const cmp = (a, b) => { const x = vkey(a), y = vkey(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/** Markdown inline marks removed: for the title line, which Reddit shows as plain text. */
export const plain = (s) => String(s).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();

const words = (s) => new Set(plain(s).toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
/** True when an entry title and a highlight title are about the same thing (shared words; used to keep a highlight out of "Also in this release"). */
export function sameTopic(a, b) {
  const x = words(a), y = words(b);
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n >= 3 && n / Math.min(x.size, y.size) >= 0.6;
}

function splitEntry(e) {
  const m = /^\*\*(.+?)\*\*\s*(.*)$/s.exec(e);
  return m ? { title: m[1].trim(), text: m[2].trim() } : { title: '', text: e.trim() };
}

/** The first sentence of an entry for the post: whole, never ending in a cut-off code span or an ellipsis. */
export function sentence(t) {
  let s = firstSentence(t).trim();
  const count = (x, re) => (x.match(re) ?? []).length;
  const closed = (x) => count(x, /`/g) % 2 === 0 && count(x, /\*\*/g) % 2 === 0 && count(x, /\(/g) === count(x, /\)/g) && count(x, /"/g) % 2 === 0;
  if (s.endsWith('…') || !closed(s)) {
    // cut at the last clause break where nothing is left open (code span, bold, bracket, quote)
    const body = s.replace(/[….]$/, '');
    let cut = -1;
    for (const m of body.matchAll(/[,;:] /g)) if (m.index >= 40 && closed(body.slice(0, m.index))) cut = m.index;
    s = cut > 0 ? body.slice(0, cut) : body.replace(/\s+\S*$/, '');
  }
  s = s.replace(/[,;:]$/, '');
  return /[.!?]$/.test(s) ? s : s + '.';
}

/** Chooses the sections: { versions (newest first), releases (parsed, newest first) }. Throws a clear message when a version is missing. */
export function pickReleases(changelog, version, from) {
  const all = parseChangelog(changelog);
  const known = all.map((r) => r.version);
  if (!known.includes(version)) throw new Error(`CHANGELOG.md has no "## ${version}" section (found: ${known.slice(0, 5).join(', ')}...)`);
  if (from && !known.includes(from)) throw new Error(`CHANGELOG.md has no "## ${from}" section for --catchup`);
  if (from && cmp(from, version) > 0) throw new Error(`--catchup ${from} is newer than ${version}`);
  const releases = all.filter((r) => (from ? cmp(r.version, from) >= 0 && cmp(r.version, version) <= 0 : r.version === version)).sort((a, b) => cmp(b.version, a.version));
  return releases;
}

/** The post as { title, body, text }. highlights: the parsed highlights.json or null/undefined when there is none. */
export function buildPost({ changelog, highlights, version, from, mac = false, max = 12, clipIds = new Set() }) {
  const releases = pickReleases(changelog, version, from);
  const hl = [];   // { id, title, blurb, version }
  for (const r of releases) for (const h of (highlights?.[r.version] ?? []).slice(0, from ? 2 : 99)) if (h && h.title) hl.push({ ...h, version: r.version });
  const entries = [];   // { title, text, version }
  for (const r of releases) for (const e of r.entries) { const p = splitEntry(e); if (p.title || p.text) entries.push({ ...p, version: r.version }); }
  if (!hl.length && !entries.length) throw new Error(`the section(s) for ${version} have no entries`);

  // Title: the 2-3 biggest things. Highlights when there are some (spread over the releases of a catch-up, newest first), else the first entries.
  let picks;
  if (hl.length) {
    const byVer = releases.map((r) => hl.filter((h) => h.version === r.version));
    picks = [];
    for (let i = 0; picks.length < 3 && byVer.some((l) => i < l.length); i++) for (const l of byVer) if (i < l.length && picks.length < 3) picks.push(l[i].title);
  } else picks = entries.slice(0, 3).map((e) => e.title || firstSentence(e.text));
  picks = picks.map((t, i) => plain(t).replace(/[.!]+$/, '').replace(/^(A|An) (?=[A-Z])/, (m) => (i ? m.toLowerCase() : '')));
  const lead = from ? `CivilKit CAD, since ${from}` : `CivilKit CAD ${version}`;
  const join3 = (l) => l.join('; ');
  let title = `${lead}: ${join3(picks)}`;
  while (title.length > TITLE_MAX && picks.length > 1) { picks.pop(); title = `${lead}: ${join3(picks)}`; }
  if (title.length > TITLE_MAX) title = title.slice(0, TITLE_MAX - 1).replace(/\s+\S*$/, '') + '…';

  const link = (v) => `${NEWS}#${anchor(v)}`;
  const span = releases.length > 1 ? `${releases[releases.length - 1].version} to ${releases[0].version}` : version;
  const intro = from
    ? `CivilKit CAD is a parametric CAD that runs in the browser: open it at ${SITE}. This is what changed in the releases from ${span}.`
    : `CivilKit CAD ${version} is out. It is a parametric CAD that runs in the browser: open it at ${SITE}.`;

  const out = [intro, ''];
  if (hl.length) {
    out.push('## Highlights', '');
    for (const h of hl) {
      const clip = clipIds.has(h.id) ? 'Clip' : 'Details';
      const ver = from ? ` (${h.version})` : '';
      out.push(`- **${h.title.trim()}**${ver}: ${sentence(h.blurb ?? '')} [${clip} on the What's new page](${link(h.version)})`);
    }
    out.push('');
  }
  const rest = entries.filter((e) => !hl.some((h) => e.title && sameTopic(e.title, h.title)));
  if (rest.length) {
    const shown = rest.slice(0, max), more = rest.length - shown.length;
    out.push(from ? '## Also in these releases' : '## Also in this release', '');
    for (const e of shown) out.push(e.title ? `- **${e.title}** ${sentence(e.text)}`.trimEnd() : `- ${sentence(e.text)}`);
    if (more > 0) out.push(`- and ${more} smaller ${more === 1 ? 'change' : 'changes and fixes'}`);
    out.push('', `The full list is on the [What's new page](${NEWS}).`, '');
  }
  out.push('## Links', '');
  out.push(`- App: ${SITE}`, `- What's new: ${NEWS}`, `- Guide: ${GUIDE}`);
  if (mac) out.push(`- Mac app: ${RELEASES} (unsigned: macOS blocks the first start, the release notes say how to open it)`);
  out.push(`- Source: ${KIT} and ${KERNEL}`, '');
  out.push('Feedback and bug reports are welcome here in the thread, or as issues on GitHub.', '');
  const body = out.join('\n');
  return { title, body, text: `${title}\n\n${body}` };
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const version = args.find((a, i) => /^\d+\.\d+\.\d+$/.test(a) && !['--out', '--catchup', '--max'].includes(args[i - 1]));
  if (!version) { console.error('usage: node tools/release_post.mjs <version> [--out <dir>] [--catchup <fromVersion>] [--mac] [--max <n>]'); process.exit(2); }
  const from = opt('--catchup');
  const max = opt('--max') ? Number(opt('--max')) : 12;
  const changelog = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
  let highlights = null;
  try { highlights = JSON.parse(readFileSync(join(repo, 'docs', 'whats-new', 'highlights.json'), 'utf8')); } catch { console.error('release_post: no readable docs/whats-new/highlights.json, leading with the first entries'); }
  const posters = join(repo, 'apps', 'cad', 'public', 'whats-new', 'posters');
  const clipIds = new Set(Object.values(highlights ?? {}).flat().filter((h) => h?.id && existsSync(join(posters, `${h.id}.png`))).map((h) => h.id));
  let post;
  try { post = buildPost({ changelog, highlights, version, from, mac: args.includes('--mac'), max, clipIds }); } catch (e) { console.error(`release_post: ${e.message}`); process.exit(1); }
  const dir = resolve(opt('--out') ?? '.');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `civilkit-${version}.md`);
  writeFileSync(file, post.text);
  console.log(`release_post: wrote ${file} (title ${post.title.length} characters). Read it, then hand it to the owner to post; nothing is posted automatically.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv);
