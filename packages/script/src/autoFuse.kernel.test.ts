import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface MassInfo { volume: number; bodies?: Array<{ name?: string; volume: number; area: number }> }

async function makeHost(batched = true) {
  const store = createStore();
  let last: Session | null = null;
  const kernel: KernelFactory = {
    async open(d) {
      const s = await Session.open(d);
      sessions.push(s);
      last = s;
      return s;
    },
  };
  const controller = new Controller({
    store,
    view: { setBody() {}, setHighlight() {}, setSketchEdit() {} },
    kernel,
  });
  await controller.load(emptyPart('init'));

  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({
      mesh: controller.bodyFaces(),
      edges: controller.bodyEdges(),
      box: controller.bodyBox(),
    }),
    ...(batched
      ? {
          build: (d, view) => controller.scratchBuild(d as never, view) as never,
          release: () => controller.scratchRelease(),
        }
      : {}),
  };
  const mass = async (): Promise<MassInfo> => (await last!.massProps({ bodies: true })) as MassInfo;
  const valid = async (): Promise<boolean> => ((await last!.validate()) as { ok: boolean }).ok;
  return { h, mass, valid };
}

describe('implicit boolean fusion (autoFuse / fuseIntersecting) on the real kernel', () => {
  it('default (autoFuse off) preserves existing behavior: overlapping moveBody copy stays separate', async () => {
    const { h, mass } = await makeHost(true);
    const code = `
      part('DefaultOff')
        .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
        .moveBody('A', { translate: [10, 0, 0], copy: true })
        .sketch('front', (s) => s.rect(10, 10, [60, 0])).extrude(10, { newBody: 'C' });
    `;
    const r = await runScript(code, h);
    expect(r.errors).toEqual([]);
    const m = await mass();
    // 3 separate solids: A (4000) + overlapping copy (4000) + disjoint box (1000) = 9000
    expect(m.bodies?.length).toBe(3);
    expect(m.volume).toBeCloseTo(9000, 1);
  }, 60000);

  it('autoFuse(true) merges overlapping moved/copied boxes into 1 solid while keeping a disjoint third solid separate', async () => {
    for (const batched of [true, false]) {
      const { h, mass, valid } = await makeHost(batched);
      const code = `
        part('AutoFused', { autoFuse: true })
          .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
          .moveBody('A', { translate: [10, 0, 0], copy: true })
          .sketch('front', (s) => s.rect(10, 10, [60, 0])).extrude(10);
      `;
      const r = await runScript(code, h);
      expect(r.errors, `batched=${batched}`).toEqual([]);
      const m = await mass();
      // Overlapping 20x20x10 and [10,0,0]-shifted 20x20x10 fuse into 30x20x10 (6000),
      // while the disjoint 10x10x10 at x=60 remains a separate solid (1000) -> 2 bodies, 7000 total.
      expect(m.bodies?.length, `batched=${batched}`).toBe(2);
      expect(m.volume, `batched=${batched}`).toBeCloseTo(7000, 1);
      const vols = (m.bodies ?? []).map((b) => b.volume).sort((a, b) => a - b);
      expect(vols[0], `batched=${batched}`).toBeCloseTo(1000, 1);
      expect(vols[1], `batched=${batched}`).toBeCloseTo(6000, 1);
      expect(await valid(), `batched=${batched}`).toBe(true);
    }
  }, 60000);

  it('autoFuse(true) with box + overlapping cylinder + disjoint third solid gives exact union volume and 2 bodies', async () => {
    const { h, mass, valid } = await makeHost(true);
    const code = `
      part('BoxCyl')
        .autoFuse(true)
        .sketch('front', (s) => s.rect(20, 20)).extrude(10)
        .sketch('front', (s) => s.circle(8, [10, 0])).extrude(10)
        .sketch('front', (s) => s.rect(10, 10, [60, 0])).extrude(10);
    `;
    const r = await runScript(code, h);
    expect(r.errors).toEqual([]);
    const m = await mass();
    // Box [-10..10, -10..10, 0..10] = 4000; cylinder r=8 centered at x=10 (half inside, half outside) adds 0.5*pi*64*10 = 320*pi
    const fusedVol = 4000 + 320 * Math.PI;
    const disjointVol = 1000;
    expect(m.bodies?.length).toBe(2);
    expect(m.volume).toBeCloseTo(fusedVol + disjointVol, 0);
    const vols = (m.bodies ?? []).map((b) => b.volume).sort((a, b) => a - b);
    expect(vols[0]).toBeCloseTo(disjointVol, 0);
    expect(vols[1]).toBeCloseTo(fusedVol, 0);
    expect(await valid()).toBe(true);
  }, 60000);

  it('fuseIntersecting() merges explicit overlapping newBody solids while leaving disjoint solids untouched', async () => {
    const { h, mass, valid } = await makeHost(true);
    const code = `
      part('ExplicitFuse')
        .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
        .sketch('front', (s) => s.rect(20, 20, [10, 0])).extrude(10, { newBody: 'B' })
        .sketch('front', (s) => s.rect(10, 10, [60, 0])).extrude(10, { newBody: 'C' })
        .fuseIntersecting();
    `;
    const r = await runScript(code, h);
    expect(r.errors).toEqual([]);
    const m = await mass();
    expect(m.bodies?.length).toBe(2);
    expect(m.volume).toBeCloseTo(7000, 1);
    const vols = (m.bodies ?? []).map((b) => b.volume).sort((a, b) => a - b);
    expect(vols[0]).toBeCloseTo(1000, 1);
    expect(vols[1]).toBeCloseTo(6000, 1);
    expect(await valid()).toBe(true);
  }, 60000);

  it('runScript(..., { autoFuse: true }) enables implicit fusion without modifying the script', async () => {
    const { h, mass, valid } = await makeHost(true);
    const code = `
      part('RunnerOption')
        .sketch('front', (s) => s.rect(20, 20)).extrude(10, { newBody: 'A' })
        .moveBody('A', { translate: [10, 0, 0], copy: true })
        .sketch('front', (s) => s.rect(10, 10, [60, 0])).extrude(10);
    `;
    const r = await runScript(code, h, {}, { autoFuse: true });
    expect(r.errors).toEqual([]);
    const m = await mass();
    expect(m.bodies?.length).toBe(2);
    expect(m.volume).toBeCloseTo(7000, 1);
    expect(await valid()).toBe(true);
  }, 60000);
});
