import { afterEach, describe, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';
import { matxScript } from './matx';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
describe('probe', () => {
  it('old path timing', async () => {
    const store = createStore();
    let reqs = 0, reqMs = 0, bytes = 0;
    const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s);
      const k = (s as any).kernel; const orig = k.request.bind(k);
      k.request = async (m: any) => { const t = performance.now(); const r = await orig(m); reqMs += performance.now() - t; reqs++; return r; };
      return s; } };
    let setBody = 0;
    const controller = new Controller({ store, view: { setBody() { setBody++; }, setHighlight() {}, setSketchEdit() {} }, kernel });
    let edits = 0, editMs = 0;
    const h: ScriptHost = {
      load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
      edit: async (ops, why) => { const t = performance.now(); const r = await controller.edit(ops, why) as never; editMs += performance.now() - t; edits++; return r; },
      geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    };
    const t0 = performance.now();
    const r = await runScript(matxScript(process.env.MATX_FULL ? undefined : ['blocks', 'strips', 'hoops']), h);
    console.log('PROBE old', JSON.stringify({ total: Math.round(performance.now() - t0), edits, editMs: Math.round(editMs), reqs, reqMs: Math.round(reqMs), setBody, feats: (r.document as any).features.length, errs: r.errors.length }));
  }, 600000);
});
