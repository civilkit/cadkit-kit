// usage: node step_in_ours.mjs <kernel.wasm> <file.step>...  : import STEP into our kernel, print volume/area/faces/valid
import { readFileSync } from 'node:fs';
import { Kernel } from './kernel.mjs';
const mod = new WebAssembly.Module(readFileSync(process.argv[2]));
for (const f of process.argv.slice(3)) {
  const k = new Kernel(mod); const q = (msg) => JSON.parse(k.request(JSON.stringify({ id: 1, msg })).json);
  const t0 = process.hrtime.bigint();
  const imp = q({ type: 'importStep', tag: 'imp', name: 'x', data: readFileSync(f, 'utf8') });
  const wall = Number(process.hrtime.bigint() - t0) / 1e9;
  const mp = q({ type: 'massProps', tag: 'imp', bodies: true }).result, v = q({ type: 'validate', tag: 'imp' }).result;
  console.log(JSON.stringify({ file: f.split('/').pop(), ok: imp.ok, err: imp.error ?? imp.result?.errors, wall, volume: mp?.volume, area: mp?.area, bodies: mp?.bodies?.map(b => b.volume), faces: imp.result?.body?.faces?.length, valid: v?.ok, issues: v?.issues }));
}
