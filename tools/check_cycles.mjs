#!/usr/bin/env node
// Import-cycle check (no dependencies). Finds strongly connected components
// (SCCs) in the relative-import graph of each root and exits 1 if a file is in
// a cycle that is not listed in tools/cycles_baseline.json.
//   node tools/check_cycles.mjs            check against the baseline
//   node tools/check_cycles.mjs --report   print SCC sizes only, exit 0
//   node tools/check_cycles.mjs --update   rewrite the baseline
//   node tools/check_cycles.mjs --runtime  ignore `import type` edges
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['packages/sketch/src', 'packages/script/src', 'apps/cad/src'];
const baselinePath = path.join(repo, 'tools/cycles_baseline.json');
const args = new Set(process.argv.slice(2));
const runtimeOnly = args.has('--runtime');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolveSpec(from, spec, files) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec.replace(/\.(js|jsx)$/, ''));
  for (const c of [base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (files.has(c)) return c;
  }
  return null;
}

const RE = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function analyse(root) {
  const files = new Set(walk(path.join(repo, root)));
  const graph = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const deps = new Set();
    for (const m of src.matchAll(RE)) {
      if (runtimeOnly && m[2]) continue;
      const t = resolveSpec(f, m[3], files);
      if (t && t !== f) deps.add(t);
    }
    graph.set(f, [...deps]);
  }
  // Tarjan, iterative
  let idx = 0; const index = new Map(), low = new Map(), on = new Set(), stack = [], sccs = [];
  for (const start of graph.keys()) {
    if (index.has(start)) continue;
    const work = [[start, 0]];
    while (work.length) {
      const [v, i] = work[work.length - 1];
      if (i === 0) { index.set(v, idx); low.set(v, idx); idx++; stack.push(v); on.add(v); }
      const ws = graph.get(v);
      if (i < ws.length) {
        work[work.length - 1][1]++;
        const w = ws[i];
        if (!index.has(w)) work.push([w, 0]);
        else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      } else {
        work.pop();
        if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
        if (low.get(v) === index.get(v)) {
          const c = []; let w;
          do { w = stack.pop(); on.delete(w); c.push(path.relative(repo, w)); } while (w !== v);
          if (c.length > 1) sccs.push(c.sort());
        }
      }
    }
  }
  return sccs;
}

const result = {};
for (const r of ROOTS) result[r] = analyse(r);
for (const r of ROOTS) console.log(`${r}: ${result[r].length ? result[r].map((c) => c.length).join(', ') + ' file SCC(s)' : 'no cycles'}`);
if (args.has('--report')) process.exit(0);
const current = Object.fromEntries(ROOTS.map((r) => [r, result[r].flat().sort()]));
if (args.has('--update')) { fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2) + '\n'); process.exit(0); }
const base = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, 'utf8')) : {};
let bad = 0;
for (const r of ROOTS) {
  const known = new Set(base[r] ?? []);
  for (const f of current[r]) if (!known.has(f)) { console.error(`NEW cycle member: ${f}`); bad++; }
}
if (bad) { console.error('Import cycle check failed. Move shared types/helpers to a leaf module.'); process.exit(1); }
