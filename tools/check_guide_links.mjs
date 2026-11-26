#!/usr/bin/env node
// Checks that every "guide" link of docs/whats-new/highlights.json lands on a page and an anchor of the built user guide.
//   node tools/check_guide_links.mjs <built guide folder>      e.g. the folder PAGES_DOCS=1 build_pages writes at <site>/docs/cad
//                                                              or the mdBook output of `mdbook build guide --dest-dir <folder>`
// A guide link is "/docs/cad/<page>.html#<anchor>" (the same form the guide uses between its own pages). Exit 1 when one does not resolve.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The problems of the guide links in `highlights` against the built guide in `dir`: [{ where, link, problem }]. */
export function checkGuideLinks(highlights, dir) {
  const bad = [];
  const ids = new Map();   // file -> Set of ids
  const idsOf = (f) => {
    if (!ids.has(f)) ids.set(f, new Set([...readFileSync(f, 'utf8').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])));
    return ids.get(f);
  };
  for (const [version, list] of Object.entries(highlights)) {
    for (const h of list) {
      if (h.guide == null) continue;
      const where = `${version}/${h.id}`;
      const m = /^\/docs\/cad\/([a-z0-9/_-]+)\.html(?:#([A-Za-z0-9_-]+))?$/.exec(String(h.guide));
      if (!m) { bad.push({ where, link: h.guide, problem: 'not of the form /docs/cad/<page>.html#<anchor>' }); continue; }
      const file = join(dir, `${m[1]}.html`);
      if (!existsSync(file)) { bad.push({ where, link: h.guide, problem: 'no such page' }); continue; }
      if (!m[2]) { bad.push({ where, link: h.guide, problem: 'no anchor' }); continue; }
      if (!idsOf(file).has(m[2])) bad.push({ where, link: h.guide, problem: 'no such anchor on the page' });
      if (!h.guideText || !String(h.guideText).trim()) bad.push({ where, link: h.guide, problem: 'guideText missing' });
    }
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/check_guide_links.mjs <built guide folder>'); process.exit(2); }
  const highlights = JSON.parse(readFileSync(join(repo, 'docs', 'whats-new', 'highlights.json'), 'utf8'));
  const bad = checkGuideLinks(highlights, resolve(dir));
  const total = Object.values(highlights).flat().filter((h) => h.guide != null).length;
  for (const b of bad) console.error(`${b.where}: ${b.link}: ${b.problem}`);
  if (bad.length) { console.error(`guide links: ${bad.length} problem(s) in ${total} links`); process.exit(1); }
  console.log(`guide links: all ${total} resolve`);
}
