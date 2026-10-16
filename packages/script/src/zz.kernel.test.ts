import { afterEach, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';
import { dashScript } from './dash';
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
it('variants', async () => {
  const variants: Record<string, (s: string) => string> = {
    off: (s) => s.replace('const LETTERS = true;', 'const LETTERS = false;'),
    on: (s) => s,
  };
  for (const [name, f] of Object.entries(variants)) {
    const store = createStore();
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    const h: ScriptHost = { load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc), edit: (ops, why) => controller.edit(ops, why) as never, geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }), build: (d, view) => controller.scratchBuild(d as never, view) as never, release: () => controller.scratchRelease(), facts: (need) => controller.scratchFacts(need) };
    await controller.load(emptyPart('x') as never);
    const t0 = Date.now();
    const r = await runScript(f(dashScript()), h);
    if (false) (await import('node:fs')).writeFileSync('/path/to/work/scratch-kittext/dash.json', JSON.stringify(r.document));
    console.log('VARIANT', name, JSON.stringify(r.errors), Date.now() - t0);
  }
}, 900000);
