#!/usr/bin/env node
// Dev-time: re-check the rolled-steel rows of apps/cad/src/frame/data/au-sections.json against the text of the public catalogue they
// were read from (InfraBuild, Hot Rolled and Structural Steel Products, 9th Edition, 2019), and record the result per row
// (`verified`, `checkedAgainst`). A row is verified when the catalogue text has a line that carries both its mass per metre and its gross
// area (angles, channels, I sections), or the mass in the right row/column of the size table (rounds, flats). Rows that fail stay false.
//   pdftotext -layout <catalogue>.pdf infrabuild.txt
//   node tools/verify_au_sources.mjs infrabuild.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'apps/cad/src/frame/data/au-sections.json');
const lines = readFileSync(process.argv[2], 'utf8').split('\n');
const doc = JSON.parse(readFileSync(file, 'utf8'));
const tokens = (l) => l.split(/\s+/).filter(Boolean);
const hasTok = (l, v) => tokens(l).some((t) => /^[\d.*,]+$/.test(t) && Math.abs(parseFloat(t.replace(/[*,]/g, '')) - v) < 1e-9);

const rounds = new Map();   // diameter -> mass, from Table 3 (the left table of the two side by side)
const flats = new Map();    // "width x thickness" -> mass, from Table 5
{
  const r0 = lines.findIndex((l) => /Table 3 Rounds/.test(l));
  for (const l of lines.slice(r0 + 2, r0 + 40)) { const m = /^\s{4,}(\d+)\s+(\d+(?:\.\d+)?)(?:\s|$)/.exec(l); if (m) rounds.set(+m[1], +m[2]); }
  const f0 = lines.findIndex((l) => /Table 5 Flats/.test(l));
  const head = lines[f0 + 2];
  const cols = [...head.matchAll(/\d+/g)].filter((m) => m.index > 40).map((m) => ({ t: +m[0], end: m.index + m[0].length }));
  for (const l of lines.slice(f0 + 3, f0 + 20)) {
    const w = /^\s+(\d+)\s/.exec(l);
    if (!w) continue;
    for (const m of l.slice(w[0].length + w.index).matchAll(/\d+(?:\.\d+)?/g)) {
      const end = w[0].length + m.index + m[0].length;
      const c = cols.reduce((a, b) => (Math.abs(b.end - end) < Math.abs(a.end - end) ? b : a));
      if (Math.abs(c.end - end) <= 3) flats.set(`${w[1]}x${c.t}`, +m[0]);
    }
  }
}
const count = {};
for (const s of doc.sections) {
  let ok = false, how = '';
  if (['UB', 'UC', 'PFC', 'EA', 'UA'].includes(s.family)) {
    const A = s.pub.A;
    ok = lines.some((l) => hasTok(l, s.mass) && hasTok(l, A));
    how = 'mass and gross area on one catalogue line';
  } else if (s.family === 'ROD') { ok = rounds.get(s.params.d) === s.mass; how = 'Table 3 row'; }
  else if (s.family === 'FL') { ok = flats.get(`${s.params.d}x${s.params.b}`) === s.mass; how = 'Table 5 cell'; }
  else { how = 'ATM tables: see au-hollow-atm.json'; ok = null; }
  if (ok === null) { delete s.verified; continue; }
  s.verified = ok; s.checkedAgainst = how;
  count[s.family] = count[s.family] ?? [0, 0];
  count[s.family][0]++; if (ok) count[s.family][1]++;
}
console.log(Object.entries(count).map(([f, [n, k]]) => `${f} ${k}/${n}`).join('  '), '| rounds read', rounds.size, 'flat cells', flats.size);
writeFileSync(file, JSON.stringify(doc).replace(/\},\{"id"/g, '},\n{"id"') + '\n');   // one row per line
