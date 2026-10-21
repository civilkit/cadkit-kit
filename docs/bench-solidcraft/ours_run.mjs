// usage: node ours_run.mjs <kernel.wasm> <part.ckpart|part.json> [--step out.step] [--reps 3]
// Cold regen (fresh wasm instance, noCache) of a .ckpart through the CadKit kernel; prints one JSON line per rep.
import { readFileSync, writeFileSync } from 'node:fs';
import { Kernel } from './kernel.mjs';
const a = process.argv.slice(2);
const opt = (f, d) => (a.includes(f) ? a[a.indexOf(f) + 1] : d);
const mod = new WebAssembly.Module(readFileSync(a[0]));
const part = JSON.parse(readFileSync(a[1], 'utf8'));
const reps = +opt('--reps', 3);
for (let i = 0; i < reps; i++) {
  const k = new Kernel(mod);
  const q = (msg) => JSON.parse(k.request(JSON.stringify({ id: 1, msg })).json);
  const c0 = process.cpuUsage(), t0 = process.hrtime.bigint();
  const r = q({ type: 'regen', tag: 'main', part, noCache: true, cacheStats: true, opts: { solveSketches: true } });
  const c = process.cpuUsage(c0), wall = Number(process.hrtime.bigint() - t0) / 1e9;
  const mp = q({ type: 'massProps', tag: 'main', bodies: true }).result;
  const v = q({ type: 'validate', tag: 'main' }).result;
  const body = r.result?.body;
  const out = { rep: i, wall, cpu: (c.user + c.system) / 1e6, ok: r.ok, errors: r.result?.errors, cacheStats: r.result?.cacheStats,
    volume: mp?.volume, area: mp?.area, bodies: mp?.bodies?.length, faces: body?.faces?.length, edges: body?.edges?.length,
    validOk: v?.ok, issues: v?.issues };
  if (i === 0) { const s = q({ type: 'step', tag: 'main', name: 'part' }); out.stepBytes = s.result?.length; if (opt('--step') && s.result) writeFileSync(opt('--step'), s.result); out.bodyKeys = Object.keys(body ?? {}); out.mpKeys = Object.keys(mp ?? {}); }
  console.log(JSON.stringify(out));
}
