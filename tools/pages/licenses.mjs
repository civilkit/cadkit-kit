// licenses.html for the static site: the notices the licences ask us to carry (who, which licence, the licence text), nothing more.
// The detailed record of where each piece came from stays in THIRD_PARTY.md. Pure functions here; tools/build_pages.mjs reads the files.

import { siteFooter, siteHeadLinks, siteHeader } from './siteChrome.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// only what the shared site stylesheet (/styles.css, loaded by the page) does not cover: tables and licence text blocks, in its colours
const CSS = `.page h2{font-size:26px;letter-spacing:-.02em;margin:40px 0 10px}.page h3{font-size:19px;margin:28px 0 8px}
.page pre{font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:.8rem 1rem;overflow:auto;white-space:pre-wrap;word-break:break-word}
.page code{word-break:break-word}.tw{overflow-x:auto}.page table{border-collapse:collapse;width:100%;font-size:14px}
.page th,.page td{border:1px solid var(--line);padding:.4rem .6rem;text-align:left;vertical-align:top}.page th{background:var(--panel)}.mut{color:var(--muted)}`;

/**
 * What the app and the kernel ship or are built from, as the licences ask us to credit it. Hand-kept; THIRD_PARTY.md has the detail.
 * npm packages are added from `deps` (their version and copyright come from the installed package).
 */
export const COMPONENTS = [
  { name: 'BOSL2 (shape definitions behind "BOSL2-based parts"; not BOSL2 and not endorsed by its authors)', licence: 'BSD-2-Clause', by: 'Revar Desmera', url: 'https://github.com/BelfrySCAD/BOSL2' },
  { name: 'SolidCraft UI icons', licence: 'MIT', by: 'SolidCraft contributors', url: 'https://github.com/tangency-labs/solidcraft' },
  { name: 'Foxtrot STEP mesher (large-file preview)', licence: 'MIT OR Apache-2.0', by: 'Formlabs and Matt Keeter', url: 'https://github.com/formlabs/foxtrot' },
  { name: 'quiddity (feature recognition from STEP)', licence: 'Apache-2.0', by: 'Betwixt Ltd', url: 'https://github.com/pzfreo/quiddity' },
  { name: 'brepkit (check, heal and STEP reader logic, adapted)', licence: 'MIT OR Apache-2.0', by: 'Andy Mai', url: 'https://github.com/andymai/brepjs' },
  { name: 'sldprt2step and open-sld-to-step (SolidWorks reader structure, rewritten)', licence: 'Apache-2.0', by: 'BlinkingSun; Jozo132', url: 'https://github.com/BlinkingSun/sldprt2step' },
  { name: 'sldprt-format-research (SolidWorks container notes)', licence: 'MIT', by: 'blussyya', url: 'https://github.com/blussyya/sldprt-format-research' },
  { name: 'cadmpeg SolidWorks format description (facts only)', licence: 'CC-BY-4.0', by: 'cadmpeg authors', url: 'https://github.com/cadmpeg/cadmpeg' },
  { name: 'OpenSKP (SketchUp reader, reimplemented)', licence: 'MIT', by: 'Ahsan Mehmood', url: 'https://github.com/iamahsanmehmood/openskp' },
  { name: 'solidcore (n-sided fill scheme, rewritten)', licence: 'Apache-2.0', by: 'tangency-labs', url: 'https://github.com/tangency-labs/solidcore' },
  { name: 'Text-tool fonts: Barlow, Barlow Condensed, Source Sans 3, Bebas Neue, PT Serif, Special Elite, IBM Plex Mono, Great Vibes, Satisfy, Anton', licence: 'SIL OFL 1.1 (Special Elite and Satisfy: Apache-2.0)', by: 'the font authors, named in each font\'s licence text', url: 'https://fonts.google.com' },
  { name: 'Wood textures and HDRI environments from Poly Haven (downloaded only when "Use online libraries" is on)', licence: 'CC0 1.0', by: 'Poly Haven contributors', url: 'https://polyhaven.com' },
];

// Apache-2.0 is one standard text: its copies differ only in the appendix
const hash = (t) => (/Apache License/.test(t) && /Version 2\.0/.test(t) ? 'apache-2.0' : t.replace(/\s+/g, ' ').trim());

/** Groups licence texts: one copy of each licence, the copyright lines of the copies that differ only in those lines listed above it. */
export function groupLicences(texts) {
  const kinds = [
    ['SIL Open Font License 1.1', (t) => /SIL OPEN FONT LICENSE/i.test(t)], // before MIT: the OFL also says "Permission is hereby granted, free of charge"
    ['MIT licence', (t) => /Permission is hereby granted, free of charge/.test(t)],
  ];
  const out = [];
  const seen = new Set();
  const notices = [];
  for (const l of texts) {
    if (/^Notice/i.test(l.title)) { notices.push(l); continue; }
    const kind = kinds.find(([, test]) => test(l.text));
    if (!kind) { const h = hash(l.text); if (!seen.has(h)) { seen.add(h); out.push({ title: l.title.replace(/:.*$/, ''), text: l.text.trim() }); } continue; }
    let g = out.find((x) => x.kind === kind[0]);
    if (!g) { g = { kind: kind[0], title: kind[0], copyrights: [], text: '' }; out.push(g); }
    const lines = l.text.replace(/\r\n/g, '\n').split('\n');
    const cut = lines.findIndex((x) => /^(Permission is hereby granted|PREAMBLE)/i.test(x.trim()));
    const head = (cut > 0 ? lines.slice(0, cut) : []).map((x) => x.trim()).filter((x) => /^(copyright|\(c\))/i.test(x));
    for (const c of head) if (!g.copyrights.includes(c)) g.copyrights.push(c);
    if (!g.text) g.text = (cut > 0 ? lines.slice(cut) : lines).join('\n').trim();
  }
  return { licences: out, notices };
}

/**
 * @param {{licences:Array<{title:string,text:string}>, deps:Array<{name:string,version:string,license:string,copyright?:string}>, components?:typeof COMPONENTS}} p
 */
export function renderLicensesHtml(p) {
  const comps = p.components ?? COMPONENTS;
  const parts = [];
  parts.push('<h1>Open-source licences and attributions</h1>');
  parts.push('<p class="mut">This application is its own code plus the third-party material below, used under the licences named. <a href="./">Back to the app</a></p>');
  parts.push('<h2>Components</h2>');
  parts.push(`<div class="tw"><table><thead><tr><th>Component</th><th>Licence</th><th>Copyright and source</th></tr></thead><tbody>${
    p.deps.map((d) => `<tr><td><code>${esc(d.name)}</code> ${esc(d.version)}</td><td>${esc(d.license)}</td><td>${esc(d.copyright ?? '')}</td></tr>`).join('')
  }${comps.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.licence)}</td><td>${esc(c.by)}, <a href="${esc(c.url)}" rel="noopener noreferrer">${esc(c.url)}</a></td></tr>`).join('')}</tbody></table></div>`);
  if (p.licences.length) {
    const { licences, notices } = groupLicences(p.licences);
    parts.push('<h2>Licence texts</h2>');
    for (const l of licences) {
      parts.push(`<h3>${esc(l.title)}</h3>`);
      if (l.copyrights?.length) parts.push(`<p class="mut">Applies to the material copyrighted by:</p><ul>${l.copyrights.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
      parts.push(`<pre>${esc(l.text)}</pre>`);
    }
    if (notices.length) {
      parts.push('<h2>Notices</h2>');
      for (const l of notices) parts.push(`<h3>${esc(l.title)}</h3><pre>${esc(l.text.trim())}</pre>`);
    }
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
