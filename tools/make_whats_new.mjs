#!/usr/bin/env node
// Writes the static "What's new" page, apps/cad/public/whats-new/index.html (served at /cad/whats-new/).
//   node tools/make_whats_new.mjs            write the page
//   node tools/make_whats_new.mjs --check    fail if the file on disk differs from what would be written now
//
// Inputs: CHANGELOG.md ("## 0.5.0 - 2026-11-10" starts a release; its entries are "- **Title.** text") and docs/whats-new/highlights.json
// (per version: id, title and blurb of each highlight). The page lists every release, newest first: the highlights of that version with a
// short clip each when the clip files exist (apps/cad/public/whats-new/clips/<id>.webm and .mp4, poster posters/<id>.png), then one line
// per changelog entry (its title and first sentence; the full text is in CHANGELOG.md) under "All changes". The page looks right without any clip. Highlights for the coming release go under the key
// "Unreleased"; they stay off the page until tools/release.mjs gives the release its version (rename the key then).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteFooter, siteHeadLinks, siteHeader } from './pages/siteChrome.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE_DIR = join(repo, 'apps', 'cad', 'public', 'whats-new');
const SITE = 'https://civilkit.io/cad/';
const CANONICAL = `${SITE}whats-new/`;
const TITLE = "What's new in CivilKit CAD: release notes with short clips";
const DESCRIPTION = 'Release notes for every CivilKit CAD version, with short looping clips: sheet metal, SolidWorks import, sketch tools, libraries and more.';

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const anchor = (v) => `v${v.replace(/\./g, '-')}`;

/** The releases of CHANGELOG.md, newest first: { version, date, entries: [text] } (a "### Changed" style subheading is ignored, its bullets count). */
export function parseChangelog(text) {
  const releases = [];
  let rel = null, bullet = null;
  const flush = () => { if (bullet != null && rel) rel.entries.push(bullet.trim()); bullet = null; };
  for (const line of text.split(/\r?\n/)) {
    const h = /^## (\d+\.\d+\.\d+)(?: - (\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (h) { flush(); rel = { version: h[1], date: h[2] ?? '', entries: [] }; releases.push(rel); continue; }
    if (/^## /.test(line)) { flush(); rel = null; continue; }
    if (!rel) continue;
    if (/^- /.test(line)) { flush(); bullet = line.slice(2); } else if (bullet != null && /^\s+\S/.test(line)) bullet += ' ' + line.trim(); else if (/^###? /.test(line)) flush();
  }
  flush();
  return releases;
}

/** Inline markdown of an entry (bold, code, links) as HTML; everything else is text. */
export function inline(md) {
  const parts = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(md))) {
    parts.push(esc(md.slice(last, m.index)));
    if (m[1] != null) parts.push(`<code>${esc(m[1])}</code>`);
    else if (m[2] != null) parts.push(`<strong>${esc(m[2])}</strong>`);
    else if (m[3] != null) parts.push(`<em>${esc(m[3])}</em>`);
    else parts.push(`<a href="${esc(m[5])}">${esc(m[4])}</a>`);
    last = m.index + m[0].length;
  }
  parts.push(esc(md.slice(last)));
  return parts.join('');
}

/** The start of an entry's text for the page: its first sentence (up to ". " before a capital, not counting e.g. / i.e. / vs.), and when that is
 *  still longer than 200 characters, cut at the first ": " or "; " after 50 characters, else at the last ", " or space. The full text stays in CHANGELOG.md. */
export function firstSentence(text) {
  const re = /([.!?])\s+(?=[A-Z*`(])/g;
  let m, one = text;
  while ((m = re.exec(text))) {
    const head = text.slice(0, m.index + 1);
    if (/\b(e\.g|i\.e|vs|etc|approx|no)\.$/.test(head)) continue;
    one = head; break;
  }
  if (one.length <= 200) return one;
  const win = one.slice(0, 200);
  const brk = /[:;]\s/g;
  let b;
  while ((b = brk.exec(win))) if (b.index >= 50) return win.slice(0, b.index) + '.';
  const at = Math.max(win.lastIndexOf(', '), win.lastIndexOf(' '));
  return win.slice(0, at).replace(/[,;:]$/, '') + '\u2026';
}

const dateText = (d) => (d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '');

function clipHtml(h) {
  const has = (f) => existsSync(join(PAGE_DIR, f));
  // the poster is committed, the clip files are not (they are copied into the deploy): a highlight with a poster is a clip, and the page
  // does not depend on which machine generated it; the video shows its poster until (and unless) the files load
  if (!has(`posters/${h.id}.png`)) return '';
  const webm = true, mp4 = true;
  const poster = ` poster="posters/${esc(h.id)}.png"`;
  return `<span class="frame"><video class="clip" muted loop playsinline preload="none"${poster} width="1920" height="1080" aria-label="${esc(h.title)}" data-autoplay>${webm ? `<source src="clips/${esc(h.id)}.webm" type="video/webm">` : ''}${mp4 ? `<source src="clips/${esc(h.id)}.mp4" type="video/mp4">` : ''}</video></span>`;
}

export function renderPage(changelog, highlights) {
  const releases = parseChangelog(changelog);
  const nav = releases.map((r) => `<li><a href="#${anchor(r.version)}">${esc(r.version)}</a></li>`).join('');
  const sections = releases.map((r) => {
    const hs = highlights[r.version] ?? [];
    const cards = hs.map((h) => { const clip = clipHtml(h); return clip ? `<article class="card"><figure class="clip" style="margin:0">${clip}<h3>${esc(h.title)}</h3><figcaption><p>${inline(h.blurb)}</p></figcaption></figure></article>` : `<article class="card"><h3>${esc(h.title)}</h3><p>${inline(h.blurb)}</p></article>`; }).join('\n');
    const all = r.entries.map((e) => {
      const m = /^\*\*(.+?)\*\*\s*(.*)$/s.exec(e);
      return m ? `<li><strong>${inline(m[1])}</strong> ${inline(firstSentence(m[2]))}</li>` : `<li>${inline(firstSentence(e))}</li>`;
    }).join('\n');
    return `<section class="release" id="${anchor(r.version)}">
<h2>${esc(r.version)} <time datetime="${esc(r.date)}">${esc(dateText(r.date))}</time></h2>
${cards ? `<div class="cards news">\n${cards}\n</div>` : ''}
<details class="all"${hs.length ? '' : ' open'}><summary>All changes in ${esc(r.version)} (${r.entries.length})</summary>
<ul>
${all}
</ul></details>
</section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESCRIPTION)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${CANONICAL}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CivilKit CAD">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${CANONICAL}">
<meta property="og:image" content="https://civilkit.io/assets/og-civilkit.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(TITLE)}">
<meta name="twitter:description" content="${esc(DESCRIPTION)}">
<meta name="twitter:image" content="https://civilkit.io/assets/og-civilkit.jpg">
${siteHeadLinks()}
<link rel="stylesheet" href="zoom/video-zoom.css">
<style>.cards.news .frame{display:block;position:relative}.cards.news video.clip{height:auto;aspect-ratio:16/9;object-fit:contain}</style>
</head>
<body>
${siteHeader('news')}
<main id="main">
<div class="wrap page">
<h1>What's new in CivilKit CAD</h1>
<p class="lede">Release notes for every version, newest first. The app shows its version at the bottom of Settings. <a href="/docs/cad/">User guide</a> · <a href="../">Open CAD</a></p>
<ul class="versions" aria-label="Versions">${nav}</ul>
${sections}
</div>
</main>
${siteFooter()}
<script src="zoom/video-zoom.js" defer></script>
<script>
// play a clip only while it is on screen
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => { const v = e.target; if (e.isIntersecting) { v.play().catch(() => {}); } else v.pause(); }), { threshold: 0.4 }) : null;
document.querySelectorAll('video[data-autoplay]').forEach((v) => { if (io && !matchMedia('(prefers-reduced-motion: reduce)').matches) io.observe(v); else v.controls = true; });
</script>
</body>
</html>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const changelog = readFileSync(join(repo, 'CHANGELOG.md'), 'utf8');
  const highlights = JSON.parse(readFileSync(join(repo, 'docs', 'whats-new', 'highlights.json'), 'utf8'));
  const out = [[join(PAGE_DIR, 'index.html'), renderPage(changelog, highlights)]];
  if (process.argv.includes('--check')) {
    const bad = out.filter(([f, s]) => !existsSync(f) || readFileSync(f, 'utf8') !== s).map(([f]) => f);
    if (bad.length) { console.error(`whats-new: out of date (run node tools/make_whats_new.mjs): ${bad.join(', ')}`); process.exit(1); }
    console.log('whats-new: up to date');
  } else {
    for (const [f, s] of out) writeFileSync(f, s);
    console.log(`whats-new: wrote ${out.length} file in ${PAGE_DIR} (${parseChangelog(changelog).length} releases)`);
  }
}
