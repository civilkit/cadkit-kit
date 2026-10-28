import { describe, expect, it } from 'vitest';
import { cosmeticToOpts, knurlCosmeticRecord, knurlEditOps, runScript, sanitizeCosmeticKnurls, type ScriptHost } from './index';

const mock = (loaded: Array<Record<string, unknown>>): ScriptHost => ({
  load: async (d) => { loaded.push(d); },
  edit: async () => ({ ok: true }),
  geometry: () => ({ mesh: null, edges: [], box: null }),
  build: async () => ({ errors: [] }),
  release: async () => {},
});
const run = async (code: string) => {
  const loaded: Array<Record<string, unknown>> = [];
  const r = await runScript(code, mock(loaded), {}, { yieldToUi: async () => {} });
  return { r, loaded };
};
const BASE = `const p = part('Knob').sketch('front', (s) => s.circle(10)).extrude(12);\n`;

describe("knurl({ mode: 'cosmetic' })", () => {
  it('records the knurl in the document and adds no feature', async () => {
    const { r, loaded } = await run(BASE + `p.knurl({ axis: 'z', radius: 10, from: 1, to: 11, pattern: 'diamond', count: 24, depth: 0.5, helixAngle: 35, mode: 'cosmetic' });`);
    expect(r.errors).toEqual([]);
    const types = (r.document!.features as Array<{ type: string }>).map((f) => f.type);
    expect(types).toEqual(['sketch', 'extrude']);   // the plain cylinder: nothing was cut
    expect(r.document!.cosmeticKnurls).toEqual([expect.objectContaining({ axis: 'z', center: [0, 0], radius: 10, from: 1, to: 11, pattern: 'diamond', count: 24, depth: 0.5, helixAngle: 35, profile: 'v' })]);
    expect(loaded[0].cosmeticKnurls).toEqual(r.document!.cosmeticKnurls);   // the loaded document carries it
  });
  it('is instant at a density the real cut refuses', async () => {
    const dense = `p.knurl({ axis: 'z', radius: 10, from: 0, to: 12, pattern: 'diamond', count: 120, depth: 0.2, helixAngle: 45, mode: 'cosmetic' });`;
    const a = await run(BASE + dense);
    expect(a.r.errors).toEqual([]);
    const b = await run(BASE + dense.replace("mode: 'cosmetic'", "method: 'boolean'"));
    expect(b.r.errors[0]?.message).toMatch(/crossings/);
  });
  it('count or pitch; round profile keeps its width; several knurls are kept in order', async () => {
    const { r } = await run(BASE + `p.knurl({ radius: 10, from: 0, to: 4, pitch: 2.0944, depth: 0.4, profile: 'round', width: 0.9, mode: 'cosmetic' });
p.knurl({ radius: 10, from: 6, to: 12, pattern: 'pyramid', count: 30, depth: 0.3, ringPitch: 2, mode: 'cosmetic' });`);
    expect(r.errors).toEqual([]);
    const k = r.document!.cosmeticKnurls as Array<Record<string, unknown>>;
    expect(k.map((x) => x.pattern)).toEqual(['straight', 'pyramid']);
    expect(k[0]).toMatchObject({ count: 30, profile: 'round', width: 0.9 });
    expect(k[1]).toMatchObject({ ringPitch: 2, from: 6, to: 12 });
  });
  it('the default still cuts', async () => {
    const { r } = await run(BASE + `p.knurl({ radius: 10, from: 0, to: 12, count: 24, depth: 0.6 });`);
    expect(r.errors).toEqual([]);
    expect(r.document!.cosmeticKnurls).toBeUndefined();
    expect((r.document!.features as unknown[]).length).toBeGreaterThan(2);
  });
  it('refuses a bad mode, a bad helix angle and a missing count', async () => {
    expect((await run(BASE + `p.knurl({ radius: 10, from: 0, to: 12, count: 24, mode: 'fake' });`)).r.errors[0].message).toMatch(/mode must be/);
    expect((await run(BASE + `p.knurl({ radius: 10, from: 0, to: 12, count: 24, pattern: 'diamond', helixAngle: 85, mode: 'cosmetic' });`)).r.errors[0].message).toMatch(/helixAngle/);
    expect((await run(BASE + `p.knurl({ radius: 10, from: 0, to: 12, mode: 'cosmetic' });`)).r.errors[0].message).toMatch(/count/);
  });
});

describe('cosmetic records', () => {
  it('survive JSON (save and load) unchanged; malformed entries are dropped', () => {
    const rec = knurlCosmeticRecord({ axis: 'x', center: [1, 2], radius: 8, from: 0, to: 20, pattern: 'pyramid', count: 40, depth: 0.3 });
    expect(sanitizeCosmeticKnurls(JSON.parse(JSON.stringify([rec])))).toEqual([rec]);
    expect(sanitizeCosmeticKnurls([rec, null, { axis: 'q' }, { ...rec, count: 2 }, { ...rec, depth: 9 }, 7])).toEqual([rec]);
    expect(sanitizeCosmeticKnurls(undefined)).toEqual([]);
  });
  it('fill missing numbers with the helper defaults', () => {
    const [k] = sanitizeCosmeticKnurls([{ axis: 'z', center: [0, 0], radius: 10, from: 0, to: 5, count: 20, depth: 0.5 }]);
    expect(k).toMatchObject({ pattern: 'straight', profile: 'v', angle: 90, helixAngle: 30, width: 1 });
    expect(k.ringPitch).toBeCloseTo((2 * Math.PI * 10) / 20, 9);
  });
  it('convert to the options of a real cut that the helper accepts', () => {
    const rec = knurlCosmeticRecord({ radius: 10, from: 0, to: 12, count: 24, depth: 0.6 });
    const ops = knurlEditOps(cosmeticToOpts(rec), 5);
    expect(ops.map((o) => o.op)).toEqual(['add', 'add']);   // a sketch and the cut
    expect((ops[0] as unknown as { feature: { id: string } }).feature.id).toBe('F5');
  });
});
