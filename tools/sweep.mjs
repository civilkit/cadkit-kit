#!/usr/bin/env node
// Sweep parametric script templates through two kernels and report where they disagree.
//   node tools/sweep.mjs [--n 40] [--seed 1] [--templates a,b] [--ours WASM] [--oracle WASM] [--out report.json] [--list]
// Classes: OURS_FAILS (ours errors, the reference works: a robustness gap), REF_FAILS, BOTH_FAIL, VOLUME (volumes differ by > --tol, default 0.5 %), AGREE.
// Each kernel runs all cases in ONE process (tools/sweep_worker.ts), the two in parallel.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d; };
const n = +arg('n', 40), seed = +arg('seed', 1), tol = +arg('tol', 0.5);
const ours = arg('ours', resolve(root, 'apps/cad/public/kernel/ck_wasm.wasm'));
const oracle = arg('oracle', resolve(root, '../kernel.wasm'));
const outFile = arg('out', 'sweep-report.json');

// ---- parameter sampling (seeded, so a report can be reproduced) ----
let st = seed >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const between = (a, b, step = 0.5) => Math.round((a + rnd() * (b - a)) / step) * step;

const PLATE = "const p = part('T'); p.sketch('front', (s) => s.rect(55, 55)).extrude(3).fillet(edges('|Z'), 6);";
const cone = (a, b, h, kind) => `p.${kind}([{ on: face('>Z'), draw: (s) => s.circle(${a}) }, { on: at('front', ${3 + h}), draw: (s) => s.circle(${b}) }])`;
const box = (z) => `edges({ inside: [[-26, -26, ${z - 0.1}], [26, 26, ${z + 0.1}]] })`;
const TEMPLATES = {
  coneSolid: { draw: () => ({ a: between(8, 26), b: between(4, 26), h: between(5, 50) }), script: (q) => `${PLATE}\n${cone(q.a, q.b, q.h, 'loft')};` },
  coneThicken: { draw: () => ({ a: between(8, 26), b: between(4, 24), h: between(5, 50), t: between(0.5, 4) }), script: (q) => `${PLATE}\n${cone(q.a, q.b, q.h, 'surfaceLoft')}.thicken(${q.t});` },
  coneRimFillet: { draw: () => ({ a: between(10, 26), b: between(6, 24), h: between(8, 40), t: between(1.5, 4), r: between(0.5, 1.5) }),
    script: (q) => `${PLATE}\n${cone(q.a, q.b, q.h, 'surfaceLoft')}.thicken(${q.t}).fillet(${box(3 + q.h)}, ${q.r});` },
  coneFootFillet: { draw: () => ({ a: between(10, 24), b: between(6, 22), h: between(8, 40), t: between(1.5, 4), r: between(0.5, 3) }),
    script: (q) => `${PLATE}\n${cone(q.a, q.b, q.h, 'surfaceLoft')}.thicken(${q.t}).fillet(${box(3)}, ${q.r});` },
  bossFoot: { draw: () => ({ r: between(4, 24), h: between(3, 50), f: between(0.5, 3) }),
    script: (q) => `${PLATE}\np.sketch(face('>Z'), (s) => s.circle(${q.r})).extrude(${q.h}).fillet(${box(3)}, ${q.f});` },
  bossTop: { draw: () => ({ r: between(4, 24), h: between(3, 50), f: between(0.5, 3) }),
    script: (q) => `${PLATE}\np.sketch(face('>Z'), (s) => s.circle(${q.r})).extrude(${q.h}).fillet(${box(3 + q.h)}, ${Math.min(q.f, q.r * 0.8)});` },
  loftShell: { draw: () => ({ a: between(8, 24), b: between(4, 22), h: between(8, 40), t: between(0.8, 3) }),
    script: (q) => `${PLATE}\n${cone(q.a, q.b, q.h, 'loft')}.shell(face('>Z'), ${q.t});` },
};
if (process.argv.includes('--list')) { console.log(Object.keys(TEMPLATES).join('\n')); process.exit(0); }
const names = (arg('templates', '') || Object.keys(TEMPLATES).join(',')).split(',');
const cases = [];
for (const name of names) {
  const T = TEMPLATES[name]; if (!T) { console.error('unknown template', name); process.exit(64); }
  for (let i = 0; i < n; i++) { const params = T.draw(); cases.push({ id: `${name}#${i}`, template: name, params, script: T.script(params) }); }
}

// ---- run both kernels, one process each ----
const dir = mkdtempSync(resolve(tmpdir(), 'sweep-'));
writeFileSync(resolve(dir, 'cases.json'), JSON.stringify(cases));
const run = (label, wasm) => new Promise((res, rej) => {
  const o = resolve(dir, label + '.json');
  const p = spawn(resolve(root, 'node_modules/.bin/vite-node'), ['--config', resolve(root, 'vite.config.ts'), resolve(root, 'tools/sweep_worker.ts'), '--', resolve(dir, 'cases.json'), o], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, CK_WASM: wasm } });
  p.on('exit', (c) => (c === 0 ? res(JSON.parse(readFileSync(o, 'utf8'))) : rej(new Error(label + ' worker exit ' + c))));
});
const t0 = Date.now();
const [A, B] = await Promise.all([run('ours', ours), run('oracle', oracle)]);
const secs = ((Date.now() - t0) / 1000).toFixed(0);

// ---- compare ----
const rows = cases.map((c, i) => {
  const a = A[i], b = B[i];
  const af = a.errors.length > 0 || a.regen.length > 0 || a.volume == null, bf = b.errors.length > 0 || b.regen.length > 0 || b.volume == null;
  const dv = !af && !bf ? Math.abs(a.volume - b.volume) / Math.max(1, b.volume) * 100 : 0;
  const cls = af && bf ? 'BOTH_FAIL' : af ? 'OURS_FAILS' : bf ? 'REF_FAILS' : dv > tol ? 'VOLUME' : 'AGREE';
  return { ...c, cls, ours: a, ref: b, dv: +dv.toFixed(3) };
});
const count = (f) => rows.filter(f).length;
console.log(`\nsweep: ${rows.length} cases, seed ${seed}, ${secs} s (ours ${ours.split('/').slice(-3).join('/')} vs reference ${oracle.split('/').pop()})`);
console.log('template'.padEnd(16) + ['AGREE', 'OURS_FAILS', 'REF_FAILS', 'VOLUME', 'BOTH_FAIL'].map((x) => x.padStart(11)).join(''));
for (const name of names) console.log(name.padEnd(16) + ['AGREE', 'OURS_FAILS', 'REF_FAILS', 'VOLUME', 'BOTH_FAIL'].map((k) => String(count((r) => r.template === name && r.cls === k)).padStart(11)).join(''));
for (const k of ['OURS_FAILS', 'VOLUME', 'REF_FAILS']) {
  const list = rows.filter((r) => r.cls === k);
  if (!list.length) continue;
  console.log(`\n${k} (${list.length}); first ${Math.min(6, list.length)}:`);
  for (const r of list.slice(0, 6)) console.log(`  ${r.id.padEnd(18)} ${JSON.stringify(r.params)}  ours: ${r.ours.errors[0] ?? r.ours.regen[0] ?? r.ours.volume?.toFixed(1)}  ref: ${r.ref.errors[0] ?? r.ref.regen[0] ?? r.ref.volume?.toFixed(1)}${r.dv ? '  dV ' + r.dv + ' %' : ''}`);
}
// where do ours failures sit? per template and parameter, min / max of the failing vs the passing cases
const gaps = rows.filter((r) => r.cls === 'OURS_FAILS');
if (gaps.length) {
  console.log('\nparameter ranges of OURS_FAILS (min..max) against all cases of the same template:');
  for (const name of names) {
    const g = gaps.filter((r) => r.template === name); if (!g.length) continue;
    const all = rows.filter((r) => r.template === name);
    console.log(' ' + name + ': ' + Object.keys(g[0].params).map((p) => { const f = g.map((r) => r.params[p]), a2 = all.map((r) => r.params[p]); return `${p} ${Math.min(...f)}..${Math.max(...f)} (of ${Math.min(...a2)}..${Math.max(...a2)})`; }).join(', '));
  }
}
writeFileSync(resolve(process.cwd(), outFile), JSON.stringify({ seed, tol, rows }, null, 1));
console.log(`\nfull report with scripts: ${outFile}`);
