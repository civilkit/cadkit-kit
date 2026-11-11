// licenses.html for the static site: the kit's THIRD_PARTY.md, the kernel's THIRD_PARTY.md (filtered), the licence texts that travel with
// the kernel binary, and the licences of the npm packages bundled into the app. Pure functions here; tools/build_pages.mjs reads the files.

import { siteFooter, siteHeadLinks, siteHeader } from './siteChrome.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\b(https?:\/\/[^\s<)|,;]+[^\s<)|,;.])/g, '<a href="$1" rel="noopener noreferrer">$1</a>');

const splitRow = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
const isRule = (line) => /^\s*\|?\s*:?-{3,}/.test(line);

/** A small Markdown subset (headings, tables, fences, paragraphs, bullet lists, inline code, bare URLs) to HTML. Heading levels are shifted down by `shift`. */
export function mdToHtml(md, shift = 0) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
      i++;
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
    } else if (/^#{1,6}\s/.test(l)) {
      const n = Math.min(6, l.match(/^#+/)[0].length + shift);
      out.push(`<h${n}>${inline(l.replace(/^#+\s*/, ''))}</h${n}>`); i++;
    } else if (/^\s*\|/.test(l)) {
      const rows = [];
      for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) if (!isRule(lines[i])) rows.push(splitRow(lines[i]));
      const [head, ...body] = rows;
      out.push(`<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^\s*[-*]\s/.test(l)) {
      const items = [];
      for (; i < lines.length && /^\s*[-*]\s/.test(lines[i]); i++) items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
    } else if (l.trim() === '') i++;
    else {
      const buf = [];
      for (; i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,6}\s|\s*\|)/.test(lines[i]); i++) buf.push(lines[i]);
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

/**
 * Decisions for the rows of the kernel's THIRD_PARTY table, by the text of the row. First match wins; a row nothing matches is dropped
 * (a new, unreviewed row is not published by accident). `keep` rows describe code or data that ships inside the kernel binary or the sample parts.
 */
export const KERNEL_ROW_RULES = [
  { re: /crates\/ck-check\//, keep: true },
  { re: /crates\/ck-heal\//, keep: true },
  { re: /crates\/ck-io\/src\/step\//, keep: true },
  { re: /fonts\/gauge\.ttf/, keep: true },
  { re: /fonts\/engrave\.ttf/, keep: true },
  { re: /crates\/ck-sldprt\/src\/\{xt/, keep: true },
  { re: /crates\/ck-sldprt\/src\/container\.rs \(format facts\), crates\/ck-sldprt\/LICENSE-MIT/, keep: true },
  { re: /cadmpeg/, keep: true },
  { re: /crates\/ck-skp\/src\//, keep: true },
  { re: /tools\/bench\/brepjs/, keep: true, note: 'the kit sample parts named brepjs-* are translations of these examples' },
  { re: /sat\/\{mod,parse,build\}/, keep: false, why: 'names a private project (the author\'s own code)' },
  { re: /ck-tess\/src\/cdt\.rs|sectionprops-rs/, keep: false, why: 'names a private project (the author\'s own code)' },
  { re: /(sldprt|skp)\/tests\/fixtures/, keep: false, why: 'test fixtures, not shipped' },
  { re: /nist_ftc_11|step_nist_reference/, keep: false, why: 'test input, not shipped' },
  { re: /build_wasm\.sh/, keep: false, why: 'build tool, not distributed' },
  { re: /ck-text\/src\/(ttf|sha256)\.rs/, keep: false, why: 'own code, nothing to attribute' },
  { re: /ck-text\/tests\/fixtures/, keep: false, why: 'test fixtures, not shipped' },
];

/**
 * Keeps the introductory table of the kernel's THIRD_PARTY.md, minus the rows that describe private work or things that are not shipped.
 * Sections after the first table ("Curated fonts ... hosted by the kit") are dropped: the pages build hosts no fonts.
 * @returns {{md:string, filtered:Array<{row:string, why:string}>}}
 */
export function filterKernelThirdParty(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const kept = [];
  const filtered = [];
  let table = 0, inTable = false, sectionDropped = false;
  for (const l of lines) {
    if (/^##\s/.test(l)) { sectionDropped = true; filtered.push({ row: l, why: 'section about fonts hosted by the kit; the pages build hosts none' }); continue; }
    if (sectionDropped) continue;
    const isRow = /^\s*\|/.test(l);
    if (isRow && !inTable) { inTable = true; table++; }
    if (!isRow) inTable = false;
    if (isRow && table === 1 && !isRule(l) && !/^\s*\|\s*Path\s*\|/.test(l)) {
      const rule = KERNEL_ROW_RULES.find((r) => r.re.test(l));
      if (!rule || !rule.keep) { filtered.push({ row: l.slice(0, 110), why: rule?.why ?? 'not reviewed for publication' }); continue; }
      kept.push(rule.note ? l.replace(/\s*\|\s*$/, ` (${rule.note}) |`) : l);
      continue;
    }
    kept.push(l);
  }
  return { md: kept.join('\n'), filtered };
}

// only what the shared site stylesheet (/styles.css, loaded by the page) does not cover: tables and licence text blocks, in its colours
const CSS = `.page h2{font-size:26px;letter-spacing:-.02em;margin:40px 0 10px}.page h3{font-size:19px;margin:28px 0 8px}
.page pre{font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.8rem 1rem;overflow:auto;white-space:pre-wrap;word-break:break-word}
.page code{word-break:break-word}.tw{overflow-x:auto}.page table{border-collapse:collapse;width:100%;font-size:14px}
.page th,.page td{border:1px solid var(--line);padding:.4rem .6rem;text-align:left;vertical-align:top}.page th{background:var(--panel)}.mut{color:var(--muted)}`;

/**
 * @param {{kit:string, kernel?:string, licences:Array<{title:string,text:string}>, deps:Array<{name:string,version:string,license:string,copyright?:string}>}} p
 */
export function renderLicensesHtml(p) {
  const parts = [];
  parts.push('<h1>Open-source licences and attributions</h1>');
  parts.push('<p class="mut">This application is made of its own code plus the third-party material below. <a href="./">Back to the app</a></p>');
  parts.push('<h2>Application</h2>');
  parts.push(mdToHtml(p.kit, 1));
  if (p.deps.length) {
    parts.push('<h2>JavaScript packages bundled into the app</h2>');
    parts.push(`<div class="tw"><table><thead><tr><th>Package</th><th>Version</th><th>Licence</th><th>Copyright</th></tr></thead><tbody>${p.deps.map((d) => `<tr><td><code>${esc(d.name)}</code></td><td>${esc(d.version)}</td><td>${esc(d.license)}</td><td>${esc(d.copyright ?? '')}</td></tr>`).join('')}</tbody></table></div>`);
  }
  if (p.kernel) {
    parts.push('<h2>Geometry kernel (WebAssembly)</h2>');
    parts.push(mdToHtml(p.kernel, 1));
  }
  if (p.licences.length) {
    parts.push('<h2>Licence texts</h2>');
    for (const l of p.licences) parts.push(`<h3>${esc(l.title)}</h3><pre>${esc(l.text.trim())}</pre>`);
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open-source licences: CivilKit CAD</title>
<meta name="description" content="Open-source licences and attributions for CivilKit CAD, its geometry kernel and the packages bundled into the app.">
<link rel="canonical" href="https://civilkit.io/cad/licenses.html">
${siteHeadLinks()}
<style>${CSS}</style></head>
<body>
${siteHeader('cad')}
<main id="main"><div class="wrap page">
${parts.join('\n')}
</div></main>
${siteFooter()}
</body></html>
`;
}
