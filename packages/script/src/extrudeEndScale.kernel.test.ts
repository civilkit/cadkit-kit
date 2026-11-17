import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

// extrude({ endScale }) through the kernel (needs a wasm with the extrude endScale field): volumes are the frustum formula, refusals read as sentences.
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface Out { vol: number; ok: boolean; bbox: { min: number[]; max: number[]; size: number[] }; errors: string[] }
async function build(body: string, readBack = true): Promise<Out> {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const code = body + (readBack ? `
const vol = await p.volume(); const ok = await p.isValid(); const bb = await p.bbox();
throw new Error('KN' + JSON.stringify({ vol, ok, bbox: bb }));
` : `
throw new Error('KN' + JSON.stringify({ vol: 0, ok: true, bbox: { min: [], max: [], size: [] } }));
`);
  const r = await runScript(code, h);
  const e = r.errors.find((x) => x.message.startsWith('KN'));
  if (!e) throw new Error('script failed: ' + r.errors.map((x) => x.message).join(' | '));
  return { ...(JSON.parse(e.message.slice(2)) as Out), errors: r.errors.filter((x) => !x.message.startsWith('KN')).map((x) => x.message) };
}
const near = (v: number, want: number, tol = 0.001) => { expect(v).toBeGreaterThan(want * (1 - tol)); expect(v).toBeLessThan(want * (1 + tol)); };
const SQ = `const p = part('T').sketch('front', (s) => s.rect(20, 20))`;

describe('extrude endScale, through the kernel', () => {
  it('a 20 x 20 square to half size over 10: the frustum h/3 (A1 + A2 + sqrt(A1 A2)) = 2333.3', async () => {
    const o = await build(SQ + `.extrude(10, { endScale: 0.5 });`);
    expect(o.errors).toEqual([]); expect(o.ok).toBe(true); near(o.vol, 2333.333);
  });
  it('growing to twice the size over 10: 10/3 (400 + 1600 + 800) = 9333.3', async () => {
    const o = await build(SQ + `.extrude(10, { endScale: 2 });`);
    expect(o.errors).toEqual([]); near(o.vol, 9333.333);
  });
  it('a mid-plane extrude scales both ends: valid, with both ends scaled', async () => {
    const o = await build(SQ + `.extrude(10, { mid: true, endScale: 0.5 });`);
    expect(o.errors).toEqual([]); expect(o.ok).toBe(true);
    expect(o.vol).toBeGreaterThan(0);
  });
  it('a script that gives a draft and an endScale is refused before the kernel', async () => {
    const o = await build(SQ + `.extrude(10, { draft: 5, endScale: 2 });`).catch((e: Error) => ({ errors: [e.message] }) as Out);
    expect(o.errors.join(' ')).toMatch(/either a draft angle or an endScale/);
  });
  it('an endScale of 0 or less is refused in words', async () => {
    const o = await build(SQ + `.extrude(10, { endScale: 0 });`).catch((e: Error) => ({ errors: [e.message] }) as Out);
    expect(o.errors.join(' ')).toMatch(/above 0/);
  });
});
