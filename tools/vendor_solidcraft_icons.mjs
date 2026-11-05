#!/usr/bin/env node
// Copies the SolidCraft icon masters named in packages/ui/src/solidcraft/map.json into packages/ui/src/solidcraft/svg/, with the matching
// ATTRIBUTION.md rows and the default accent of each icon (accents.json). Only the files the map uses are copied; nothing is modified.
//   node tools/vendor_solidcraft_icons.mjs [path to the SolidCraft checkout]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? join(ROOT, '..', 'ext', 'solidcraft');
const OUT = join(ROOT, 'packages/ui/src/solidcraft');
const DESIGN = join(SRC, 'assets/icons/ui/design');
const map = JSON.parse(readFileSync(join(OUT, 'map.json'), 'utf8'));
const files = [...new Set(Object.values(map).map((v) => v.split('@')[0]))].filter((f) => !f.startsWith('own/')).sort();   // own/ = our drawings, not vendored

rmSync(join(OUT, 'svg'), { recursive: true, force: true });
for (const f of files) {
  const from = join(DESIGN, 'svg', f + '.svg');
  if (!existsSync(from)) throw new Error('missing master ' + f);
  mkdirSync(dirname(join(OUT, 'svg', f)), { recursive: true });
  copyFileSync(from, join(OUT, 'svg', f + '.svg'));
}

// default accent per master, from palette.toml [icon-accents]
const pal = readFileSync(join(DESIGN, 'palette.toml'), 'utf8');
const sec = pal.slice(pal.indexOf('[icon-accents]'));
const accents = {};
for (const m of sec.matchAll(/^(\w+)\s*=\s*\[([^\]]*)\]/gm)) for (const n of m[2].matchAll(/"([\w]+)"/g)) accents[n[1]] = m[1];
const used = {};
for (const f of files) { const base = f.split('/')[1]; if (accents[base]) used[f] = accents[base]; }
writeFileSync(join(OUT, 'accents.json'), JSON.stringify(used, null, 2) + '\n');

// attribution rows of the copied files, as the SolidCraft table has them
const rows = readFileSync(join(SRC, 'ATTRIBUTION.md'), 'utf8').split('\n');
const keep = files.map((f) => rows.find((r) => r.startsWith('| assets/icons/ui/design/svg/' + f + '.svg |')) ?? `| assets/icons/ui/design/svg/${f}.svg | SOLIDCRAFT ROW NOT FOUND |`);
let commit = '';
try { commit = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a git checkout */ }
writeFileSync(join(OUT, 'ATTRIBUTION.md'), `# Attribution of the vendored SolidCraft icons

Source: https://github.com/tangency-labs/solidcraft (SolidCraft), commit ${commit}. Copyright (c) 2026 SolidCraft contributors. Licence: MIT OR Apache-2.0; we use them under
the MIT licence (LICENSE-MIT beside this file). The files in svg/ are unmodified copies; the rows below are copied from the SolidCraft ATTRIBUTION.md.
Regenerate with tools/vendor_solidcraft_icons.mjs.

| File | Author | Source | Licence |
|---|---|---|---|
${keep.map((r) => r.replace('| assets/icons/ui/design/svg/', '| svg/')).join('\n')}
`);
copyFileSync(join(SRC, 'LICENSE-MIT'), join(OUT, 'LICENSE-MIT'));
console.log(files.length + ' masters copied, commit ' + commit);
