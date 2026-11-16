// The stock of a STEP file from our own kernel: import it, then read the body's box and volume.
//   vite-node tools/step_features/stock.ts part.step   ->  prints one JSON line {errors, box, faces, volume}
import { readFileSync } from 'node:fs';
import { AgentSession } from '@kit/agent-tools';
import { meshFromBody } from '@ck/mesh';

import { meshVolume, prismStock, turnedLevels } from '../../apps/cad/src/recognise/slices';

setTimeout(() => { console.log(JSON.stringify({ errors: [['timeout', 'no answer from the kernel in 60 s']] })); process.exit(1); }, 60_000).unref();
const text = readFileSync(process.argv[2], 'utf8');
const a = await AgentSession.open({ wasmPath: process.env.CK_WASM });
let out: Record<string, unknown>;
try {
  const rep = await a.session.importStep(text, 'import') as unknown as { errors: unknown[]; body?: { box?: unknown; faces?: unknown[] } | null; tag?: string };
  let volume: unknown = null;
  try {
    const m = await a.transport.request({ type: 'massProps', tag: 'imp' }) as { volume?: number } | null;
    volume = m?.volume ?? null;
    if (process.env.STOCK_DEBUG) console.error('massProps', JSON.stringify(m)?.slice(0, 300), 'rep keys', Object.keys(rep));
  } catch (e) { if (process.env.STOCK_DEBUG) console.error('massProps failed', String((e as Error).message)); }
  if (volume == null && rep.body) volume = meshVolume(meshFromBody(rep.body as never).positions);   // from the tessellation: within about a tenth of a percent on typical parts
  let prism = null;
  if (rep.body?.box) { try { prism = prismStock(meshFromBody(rep.body as never).positions, rep.body.box as never); } catch { /* no outline: the box is used */ } }
  let turned = null;
  if (rep.body?.box && process.env.STOCK_TURNED) { turned = turnedLevels(meshFromBody(rep.body as never).positions, rep.body.box as never, Number(process.env.STOCK_TURNED), Number(process.env.STOCK_LEVELS ?? 36)); }
  out = { errors: rep.errors, box: rep.body?.box ?? null, prism, turned, faces: rep.body?.faces?.length ?? 0, volume, source: 'mesh' };
} catch (e) { out = { errors: [['import', String((e as Error).message)]] }; }
console.log(JSON.stringify(out));
await a.close();
process.exit(0);
