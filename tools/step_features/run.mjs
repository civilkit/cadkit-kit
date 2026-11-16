#!/usr/bin/env node
// Spike: STEP -> quiddity features -> kit script -> rebuilt in the headless kernel, checked against the volume quiddity read from the file.
//   node tools/step_features/run.mjs part.step [--quiddity /path/to/quiddity] [--wasm ck_wasm.wasm] [--json features.json] [--out script.js]
// `--json` skips quiddity and converts an existing `quiddity part.step` output. Needs quiddity on PATH (pip install quiddity) unless --json is given.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert } from '../../apps/cad/src/recognise/convert.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const step = argv.find((a) => !a.startsWith('--') && a !== opt('--quiddity') && a !== opt('--wasm') && a !== opt('--json') && a !== opt('--out'));
const jsonPath = opt('--json');
if (!step && !jsonPath) { console.error('usage: run.mjs part.step [--quiddity bin] [--wasm file] [--json features.json] [--out script.js]'); process.exit(2); }

const features = jsonPath ? JSON.parse(readFileSync(jsonPath, 'utf8')) : JSON.parse(execFileSync(opt('--quiddity', 'quiddity'), [step], { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
// the stock box from our own import of the file (a worker-kernel process under vite-node); quiddity's body_key is the fallback
let stock = null, stockVolume = null, prism = null, turned = null;
try {
  const line = execFileSync(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), '--root', root, '--config', resolve(root, 'vite.config.ts'), resolve(root, 'tools/step_features/stock.ts'), step], { env: { ...process.env, STOCK_TURNED: '1', CK_WASM: resolve(opt('--wasm', process.env.CK_WASM ?? resolve(root, 'apps/cad/public/kernel/ck_wasm.wasm'))) }, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).toString().trim().split('\n').pop();
  const s = JSON.parse(line);
  if (s.box && !s.errors?.length) { stock = s.box; stockVolume = s.volume; prism = s.prism ?? null; turned = s.turned ?? null; }
} catch { /* fall back to quiddity's box */ }
if (!step) stock = null;
const out = convert(features, { stock, prism, turned });
// the file's volume: quiddity's when it describes the same box, else our own import's (tessellated, so the tolerance is looser)
const fileVolume = out.base?.volume ?? stockVolume;
const volumeTol = out.base?.volume != null ? 1e-3 : 5e-3;
console.log(out.base?.turned ? 'stock: plate + revolved profile from our own STEP import' : out.base?.prism ? 'stock: prism outline from our own STEP import' : stock ? 'stock box: from our own STEP import' : 'stock box: from quiddity body_key (no import)');
console.log(`handled ${out.handled.length}: ${out.handled.join(', ') || '-'}`);
for (const s of out.skipped) console.log(`skipped ${s.id}: ${s.why}`);
if (!out.script) { console.log('no script'); process.exit(1); }
if (opt('--out')) writeFileSync(opt('--out'), out.script);
console.log('--- script\n' + out.script + '---');

const wasm = resolve(opt('--wasm', process.env.CK_WASM ?? resolve(root, 'apps/cad/public/kernel/ck_wasm.wasm')));
const p = spawn(process.execPath, [resolve(root, 'packages/mcp/bin/ck-mcp.mjs'), '--stdio-direct'], { env: { ...process.env, CK_WASM: wasm }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const waiters = new Map();
p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiters.get(m.id)?.(m); } catch { /* not a reply */ } } });
let n = 0;
const call = (method, params) => new Promise((res) => { const id = ++n; waiters.set(id, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'step-features', version: '0' } });
p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const data = (r) => { for (const c of r.result?.content ?? []) if (c.text?.startsWith('{')) return JSON.parse(c.text); return {}; };
// Rebuild; when the kernel rejects one feature, drop just that feature and try again, so one bad record does not lose the whole part.
let lines = out.script.split('\n').slice(0, -1), ids = [...out.lineIds];
const failed = [];
let run, facts;
for (let attempt = 0; attempt < 40; attempt++) {
  run = data(await call('tools/call', { name: 'run_script', arguments: { mode: 'new', code: lines.join('\n') + '\n' } }));
  if (run.ok) break;
  const e = run.errors?.[0], at = (e?.line ?? 0) - 1;
  if (!e || at < 1 || ids[at] === 'stock' || !ids[at]) break;   // the stock itself failed: nothing to drop
  failed.push({ id: ids[at], why: `${e.code ?? 'error'}: ${String(e.message).slice(0, 110)}` });
  lines.splice(at, 1); ids.splice(at, 1);
}
facts = run.ok ? data(await call('tools/call', { name: 'facts', arguments: {} })) : {};
p.kill();
for (const f of failed) console.log(`dropped ${f.id}: ${f.why}`);
if (!run.ok) { console.log('rebuild failed:', JSON.stringify(run.errors)); process.exit(1); }
console.log(`rebuilt with ${new Set(ids).size - 1} of ${out.handled.length} recognised features (${failed.length} rejected by the kernel)`);
const got = facts.volume, want = fileVolume;
if (want == null) { console.log(`volume: rebuilt ${got.toFixed(3)}  (no file volume for this stock box, so not checked)  valid ${facts.validity?.ok}  solids ${facts.solids}`); process.exit(2); }
const rel = Math.abs(got - want) / want;
console.log(`volume: file ${want.toFixed(3)}  rebuilt ${got.toFixed(3)}  difference ${(rel * 100).toFixed(4)}%  valid ${facts.validity?.ok}  solids ${facts.solids}`);
process.exit(rel < volumeTol && facts.validity?.ok ? 0 : 1);
