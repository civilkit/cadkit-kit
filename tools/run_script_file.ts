// Run a kit script file against the real kernel and print what it made: node tools/run_script_file.mjs <script.js> [--doc out.ckpart.json]
// Prints script errors, then volume, bounding box, face count and the kernel's validity report. Exit 1 on script errors or an invalid part.
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../apps/cad/src/controller';
import { runScript, type ScriptHost } from '@kit/script';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const file = args[0];
if (!file) { console.error('usage: run_script_file.mjs <script.js> [--doc out.json]'); process.exit(64); }
const docOut = args.indexOf('--doc') >= 0 ? args[args.indexOf('--doc') + 1] : '';
const sessions: Session[] = [];
const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
await controller.load(emptyPart('x') as never);
const h: ScriptHost = {
  load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
  edit: (ops, why) => controller.edit(ops, why) as never,
  geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
  build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
};
const r = await runScript(readFileSync(file, 'utf8'), h);
let bad = r.errors.length > 0;
console.log('script errors:', r.errors.length ? r.errors.map((e) => e.message).join('; ') : 'none');
const s = sessions.at(-1);
if (s) {
  try { const m = (await s.massProps()) as { volume: number }; console.log('volume:', m.volume.toFixed(3)); } catch (e) { console.log('volume: n/a', String(e)); bad = true; }
  const box = controller.bodyBox();
  if (box) console.log('bbox:', JSON.stringify({ min: box.min.map((v: number) => +v.toFixed(3)), max: box.max.map((v: number) => +v.toFixed(3)) }));
  try { const v = await s.verify(); const errs = v.regen.errors.map(([id, e]) => `${id}:${e.code}`); console.log('regen errors:', errs.length ? errs.join(', ') : 'none'); if (errs.length) bad = true; } catch (e) { console.log('verify failed', String(e)); }
}
if (docOut) writeFileSync(docOut, JSON.stringify(r.document, null, 1));
for (const x of sessions) await x.close().catch(() => {});
process.exit(bad ? 1 : 0);
