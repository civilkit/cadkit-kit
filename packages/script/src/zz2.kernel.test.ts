import { afterEach, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
it('micro', async () => {
  const scripts: Record<string, string> = {
    base: `const p = part('D'); p.sketch('front', (s) => s.circle(40)).extrude(2);`,
    floating: `const p = part('D'); p.sketch('front', (s) => s.circle(40)).extrude(2);
p.sketch(at('front', 2.1), (s) => { for (let v = 0; v <= 8; v++) s.text(String(v*10), [28*Math.cos(v), 28*Math.sin(v)], { height: 4, anchor: ['center','middle'] }); }).extrude(0.15);`,
    touching: `const p = part('D'); p.sketch('front', (s) => s.circle(40)).extrude(2);
p.sketch(at('front', 2), (s) => { for (let v = 0; v <= 8; v++) s.text(String(v*10), [28*Math.cos(v), 28*Math.sin(v)], { height: 4, anchor: ['center','middle'] }); }).extrude(0.15);`,
    floatingPoly: `const p = part('D'); p.sketch('front', (s) => s.circle(40)).extrude(2);
p.sketch(at('front', 2.1), (s) => { for (let v = 0; v <= 8; v++) s.text(String(v*10), [28*Math.cos(v), 28*Math.sin(v)], { height: 4, polyline: true, anchor: ['center','middle'] }); }).extrude(0.15);`,
    cutInto: `const p = part('D'); p.sketch('front', (s) => s.circle(40)).extrude(2);
p.sketch(at('front', 2), (s) => { for (let v = 0; v <= 8; v++) s.text(String(v*10), [28*Math.cos(v), 28*Math.sin(v)], { height: 4, anchor: ['center','middle'] }); }).cut(0.15);`,
  };
  for (const [name, src] of Object.entries(scripts)) {
    const store = createStore();
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
    const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
    const h: ScriptHost = { load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc), edit: (ops, why) => controller.edit(ops, why) as never, geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }), build: (d, view) => controller.scratchBuild(d as never, view) as never, release: () => controller.scratchRelease(), facts: (need) => controller.scratchFacts(need) };
    await controller.load(emptyPart('x') as never);
    const t0 = Date.now();
    const r = await runScript(src, h);
    console.log('MICRO', name, JSON.stringify(r.errors), Date.now() - t0, 'ms');
  }
}, 900000);
