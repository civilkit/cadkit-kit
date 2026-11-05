// Writes apps/cad/public/samples/assembly-nist-ftc-7-8-9-10.ckpart: the NIST test parts FTC 7, 8, 9 and 10 (public domain, NIST MBE PMI
// models) as one assembly, each part imported through the normal SolidWorks path so it keeps its history folder.
//   CK_WASM=<ck_wasm.wasm> NIST_SAMPLES=<dir holding nist_ftc_07 .. nist_ftc_10, each with a .SLDPRT> npx vite-node apps/cad/scripts/genNistAssembly.ts
// The placements and mates are derived in docs/assemblies.md ("NIST test assembly"); the numbers below are the hole positions of the parts.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../src/controller';
import { sldprtAsPart } from '../src/files/sldprtImport';
import { insertFeature, NO_PLACEMENT } from '../src/assembly/model';
import { mateFeature, newDraft } from '../src/assembly/mateKinds';
import { NIST_EXPLODE, NIST_MATES, NIST_PARTS, NIST_PLACEMENTS } from '../src/nist/nistAssembly';

const WASM = process.env.CK_WASM!;
const DIR = process.env.NIST_SAMPLES ?? resolve(process.cwd(), '../rebuild/corpus-local/samples');
const OUT = 'apps/cad/public/samples/assembly-nist-ftc-7-8-9-10.ckpart';

const kernel = await createWorkerKernel(WASM);
const parts: Record<string, Record<string, unknown>> = {};
for (const p of NIST_PARTS) {
  const d = resolve(DIR, `nist_ftc_${p.n}`);
  if (!existsSync(d)) throw new Error(`missing ${d}`);
  const file = readdirSync(d).find((f) => /\.sldprt$/i.test(f))!;
  const r = await sldprtAsPart(kernel, new Uint8Array(readFileSync(resolve(d, file))), p.title);
  if (!r.ok) throw new Error(`${p.n}: ${JSON.stringify(r)}`);
  parts[p.n] = r.part as unknown as Record<string, unknown>;
  console.log(p.n, 'features', r.part.features.length, 'history', r.history);
}
await kernel.close();

const features = NIST_PARTS.map((p, i) => ({ ...insertFeature(parts[p.n], { ...NO_PLACEMENT, ...NIST_PLACEMENTS[p.n] }, { name: p.title, fixed: p.fixed }), id: `F${i + 1}` }));
const doc = { format: 'ck-part', version: 1, name: 'NIST test assembly (FTC 7, 8, 9, 10)', material: 'steel', rollback: null, counters: {}, seq: features.length + 1, features };
const sessions: Session[] = [];
const factory: KernelFactory = { async open(d) { const s = await Session.open(d, { wasmPath: WASM }); sessions.push(s); return s; } };
const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel: factory });
await c.load(doc as never);
const fr = () => c.components().map((x) => x.id + ' o' + JSON.stringify(x.place?.o.map((v) => +v.toFixed(2))) + ' x' + JSON.stringify(x.place?.x.map((v) => +v.toFixed(3))) + ' z' + JSON.stringify(x.place?.z.map((v) => +v.toFixed(3)))).join('\n');
console.log('seed\n' + fr());
for (const m of NIST_MATES) {
  const d = newDraft(m.kind);
  d.refs = { a: m.a, b: m.b }; d.flip = !!m.flip; d.name = m.name;
  const r = await c.edit([{ op: 'add', feature: mateFeature(d) }]);
  console.log(m.name, r.ok ? 'ok' : JSON.stringify(r.errors ?? r.schemaError)); if (process.env.NIST_TRACE) console.log(fr());
}
console.log(JSON.stringify(c.components().map((x) => [x.id, x.dof])), JSON.stringify(c.assemblyExtra()));
c.setDocExtra('explode', structuredClone(NIST_EXPLODE));
writeFileSync(OUT, JSON.stringify(c.document()));
await Promise.all(sessions.map((s) => s.close().catch(() => {})));
process.exit(0);
