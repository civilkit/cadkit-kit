#!/usr/bin/env node
// Dev-time: read the dimension tables of a public manufacturer catalogue of structural hollow sections (Australian Tube Mills,
// "Design Capacity Tables for Structural Steel Hollow Sections", August 2013, Tables 3.1-1 to 3.1-6) from the layout-preserving
// text of its PDF and write the rows to apps/cad/src/frame/data/au-hollow-atm.json.
//   pdftotext -layout <catalogue>.pdf catalogue.txt
//   node tools/extract_atm_hollow.mjs catalogue.txt
// Only the nominal size (mm), mass per metre (kg/m) and gross area (mm2) of each row are kept: facts that the catalogue publishes
// for each section. Each row is checked on the way: mass must equal area x 7850 kg/m3 within 1.5 %, or the run fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('usage: node tools/extract_atm_hollow.mjs catalogue.txt'); process.exit(64); }
const lines = readFileSync(src, 'utf8').split('\n');
const NUM = '(\\d+(?:\\.\\d+)?)';
const first = new RegExp(`^\\s*${NUM}\\s+x\\s+(?:${NUM}\\s+x\\s+)?${NUM}\\s+(CHS|SHS|RHS)\\s+((?:\\d[\\d.]*\\s+){0,7})`);
const cont = new RegExp(`^\\s+${NUM}\\s+(CHS|SHS|RHS)\\s+((?:\\d[\\d.]*\\s+){3,7})`);
const GRADE_OF_TABLE = (text) => (/C450PLUS/.test(text) ? 'C450L0' : /Grade (C\d{3}L0)/.exec(text)?.[1] ?? null);
const out = [];
let table = null, grade = null, cur = null;
const bad = [], skipped = [];
lines.forEach((ln, i) => {
  const th = /^TABLE (\S+)/.exec(ln.trim());
  if (th) {
    table = /^3\.1-\d(?:\(\d\))?$/.test(th[1]) ? th[1] : null;
    if (!table) { cur = null; return; }
    grade = GRADE_OF_TABLE(lines.slice(i + 1, i + 4).join(' '));
    cur = null;
    return;
  }
  if (!table) return;
  let m = first.exec(ln), t;
  if (m) {
    const kind = m[4];
    cur = kind === 'CHS' ? { d: +m[1], b: +m[1] } : { d: +m[1], b: +m[2] };
    t = +m[3];
    if (kind === 'CHS' && m[2] !== undefined) return;       // not a CHS row shape
    take(kind, t, m[5]);   // a row whose figures the PDF text put elsewhere has none here: its size is kept for the rows under it, the row is skipped
    return;
  }
  m = cont.exec(ln);
  if (m && cur) take(m[2], +m[1], m[3]);
  function take(kind, thick, rest) {
    const f = rest.trim().split(/\s+/).map(Number);
    if (f.length < 5 || f.some((x) => !Number.isFinite(x))) { skipped.push(`${table} ${cur.d}x${cur.b}x${thick}: figures not on the row`); return; }
    const mass = f[0], area = f[kind === 'RHS' ? 5 : 4];
    // the table's own wall ratios must agree with the size read for the row (guards against a figure row attached to the wrong size)
    const want = kind === 'CHS' ? [cur.d / thick] : kind === 'SHS' ? [(cur.b - 2 * thick) / thick] : [(cur.b - 2 * thick) / thick, (cur.d - 2 * thick) / thick];
    if (want.some((w, k) => Math.abs(f[3 + k] / w - 1) > 0.03)) { skipped.push(`${table} ${cur.d}x${cur.b}x${thick}: ratios ${f.slice(3, 3 + want.length)} vs ${want.map((x) => x.toFixed(1))}`); return; }
    if (!(mass > 0 && area > 0)) { bad.push(`${table} line ${i + 1}: ${ln.trim().slice(0, 60)}`); return; }
    const dev = mass / (area * 7850e-6) - 1;
    if (Math.abs(dev) > 0.015) bad.push(`${table} line ${i + 1}: mass ${mass} vs area ${area} (${(dev * 100).toFixed(1)} %)`);
    out.push({ kind, d: cur.d, ...(kind === 'CHS' ? {} : { b: cur.b }), t: thick, mass, area, table: `Table ${table}`, grade });
  }
});
if (bad.length) { console.error('rows failing the checks:\n' + bad.join('\n')); process.exit(1); }
const noGrade = out.filter((r) => !r.grade);
if (noGrade.length) { console.error('rows without a grade: ' + noGrade.length); process.exit(1); }
const key = (r) => `${r.kind} ${r.d} ${r.b ?? ''} ${r.t} ${r.grade}`;
const seen = new Map();
for (const r of out) { if (seen.has(key(r))) { const o = seen.get(key(r)); console.error('dup', key(r), o.table, o.mass, o.area, '|', r.table, r.mass, r.area); } seen.set(key(r), r); }
const doc = {
  format: 'frame-source-atm-hollow', version: 1,
  source: { document: 'Australian Tube Mills, Design Capacity Tables for Structural Steel Hollow Sections', edition: 'August 2013', tables: 'Tables 3.1-1 to 3.1-6 (Dimensions and Properties)', standard: 'AS/NZS 1163', note: 'Grades as printed in each table heading. The C450PLUS tables are headed "designed as AS/NZS 1163 Grade C450L0". Units: mm, kg/m, mm2.' },
  rows: out,
};
writeFileSync(join(root, 'apps/cad/src/frame/data/au-hollow-atm.json'), JSON.stringify(doc, null, 1).replace(/\n\s{3,}/g, ' ').replace(/\n\s*\}/g, ' }') + '\n');
const cnt = {};
for (const r of out) cnt[`${r.kind} ${r.grade}`] = (cnt[`${r.kind} ${r.grade}`] ?? 0) + 1;
console.log(out.length, 'rows', cnt);
if (skipped.length) console.log('skipped (not read reliably from the text):\n  ' + skipped.join('\n  '));
