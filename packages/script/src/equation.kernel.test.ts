import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function host() {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    facts: (need) => controller.scratchFacts(need),
  };
  return { h, session: () => sessions.at(-1)!, controller };
}
const vol = async (s: Session) => ((await s.massProps()) as { volume: number }).volume;

describe('script equation curves', () => {
  it('a disc by formula has the exact volume and follows its variable', async () => {
    const { h, session } = await host();
    const r = await runScript(`const v = variables({ R: 10 });
part('Disc').sketch('front', (s) => s.equation({ x: 'R*cos(t)', y: 'R*sin(t)', t: [0, 360], tol: 0.001 })).extrude(5);`, h);
    expect(r.errors).toEqual([]);
    const v = await vol(session());
    expect(Math.abs(v - Math.PI * 100 * 5) / (Math.PI * 100 * 5)).toBeLessThan(3e-4);
  }, 120000);
  it('a wave closed by lines extrudes; a bad formula reports the kernel message', async () => {
    const { h, session } = await host();
    const r = await runScript(`part('Wave').sketch('front', (s) => s.equation({ x: 't/9', y: '3*sin(t)', t: [0, 360] }).polyline([[40, 0], [40, -10], [0, -10], [0, 0]])).extrude(5);`, h);
    expect(r.errors).toEqual([]);
    expect(Math.abs((await vol(session())) - 2000)).toBeLessThan(1);
    const bad = await runScript(`part('P').sketch('front', (s) => s.equation({ x: 't', y: 'q*t', t: [0, 10] }).polyline([[10, 0], [0, 0]])).extrude(1);`, h);
    expect(bad.errors[0]?.message).toMatch(/equationFormula|unknown name 'q'/);
  }, 120000);
  it('the editor query previews the same fit with the document variables', async () => {
    const { h, controller } = await host();
    await runScript(`const v = variables({ R: 20 }); part('P').sketch('front', (s) => s.rect(10, 10)).extrude(1);`, h);
    const ok = await controller.fetchEquationCurve({ x: 'R*cos(t)', y: 'R*sin(t)', t: [0, 360], tol: 0.01 });
    expect('error' in ok).toBe(false);
    if (!('error' in ok)) { expect(ok.closed).toBe(true); expect(ok.count).toBeGreaterThan(8); expect(ok.count).toBeLessThan(30); }
    const bad = await controller.fetchEquationCurve({ x: 't', y: 't', t: [5, 5], tol: 0.01 });
    expect('error' in bad && bad.error).toMatch(/^equationRange: /);
  }, 120000);
});
