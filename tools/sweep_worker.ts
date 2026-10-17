// Worker for tools/sweep.mjs: runs a list of script cases in ONE process against the kernel in CK_WASM, prints one JSON result per case on stdout.
// usage: CK_WASM=<wasm> npx tsx tools/sweep_worker.ts <cases.json> <results.json>
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../apps/cad/src/controller';
import { runScript, type ScriptHost } from '@kit/script';
import { readFileSync, writeFileSync } from 'node:fs';

type Case = { id: string; template: string; params: Record<string, number>; script: string };
const cases: Case[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out: Array<{ id: string; errors: string[]; volume: number | null; regen: string[]; ms: number }> = [];
for (const c of cases) {
  const t0 = Date.now();
  const sessions: Session[] = [];
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const rec = { id: c.id, errors: [] as string[], volume: null as number | null, regen: [] as string[], ms: 0 };
  try {
    const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    await controller.load(emptyPart('x') as never);
    const h: ScriptHost = {
      load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
      edit: (ops, why) => controller.edit(ops, why) as never,
      geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
      build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
    };
    const r = await runScript(c.script, h);
    rec.errors = r.errors.map((e) => e.message);
    const s = sessions.at(-1);
    if (s) {
      try { rec.volume = ((await s.massProps()) as { volume: number }).volume; } catch { /* no solid */ }
      try { rec.regen = (await s.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`); } catch { /* ignore */ }
    }
  } catch (e) { rec.errors.push('thrown: ' + String(e).slice(0, 120)); }
  for (const s of sessions) await s.close().catch(() => {});
  rec.ms = Date.now() - t0;
  out.push(rec);
}
writeFileSync(process.argv[3], JSON.stringify(out));
process.exit(0);
