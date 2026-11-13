// nut(), standoff() and heatSetInsert() on the real kernel: a valid solid of the right size and a volume within 1-2% of a hand calculation.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';
import { INSERT_SIZES, NUT_SIZES, STANDOFF_SIZES, minorInternal } from './features/fastenerData';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface Out { vol: number; ok: boolean; bbox: { min: number[]; max: number[]; size: number[] }; bodies: string[]; threads: number }
async function build(body: string): Promise<Out> {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const code = body + `
const vol = await p.volume(); const ok = await p.isValid(); const bb = await p.bbox();
throw new Error('KN' + JSON.stringify({ vol, ok, bbox: bb }));
`;
  const r = await runScript(code, h);
  const e = r.errors.find((x) => x.message.startsWith('KN'));
  if (!e) throw new Error('script failed: ' + r.errors.map((x) => x.message).join(' | '));
  const feats = (controller.document()?.features ?? []) as unknown as Array<{ type: string; op?: string; body?: string }>;
  return { ...(JSON.parse(e.message.slice(2)) as Out), bodies: feats.filter((f) => f.op === 'newBody').map((f) => String(f.body)), threads: feats.filter((f) => f.type === 'thread').length };
}
const near = (v: number, want: number, tol = 0.015) => { expect(v, `${v} vs ${want}`).toBeGreaterThan(want * (1 - tol)); expect(v, `${v} vs ${want}`).toBeLessThan(want * (1 + tol)); };
const circ = (r: number, h: number) => Math.PI * r * r * h;
const hexArea = (s: number) => (Math.sqrt(3) / 2) * s * s;   // regular hexagon of width s across flats

/** Volume of a hex prism of width s and thickness m after the two 30 degree chamfer cones, by integrating the area of hexagon-cut-by-circle over the height. */
function chamferedHexVolume(s: number, m: number, dw: number): number {
  const area = (rho: number): number => {   // area of the hexagon (flats at s/2) inside a disc of radius rho: 1/2 integral of min(rho, r_hex(theta))^2 dtheta
    const n = 6000; let a = 0;
    for (let i = 0; i < n; i++) {
      const th = ((i + 0.5) / n) * 2 * Math.PI, rh = s / 2 / Math.cos((((th % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6);
      a += 0.5 * Math.min(rho, rh) ** 2 * ((2 * Math.PI) / n);
    }
    return a;
  };
  const t30 = Math.tan(Math.PI / 6), N = 400; let v = 0;
  for (let i = 0; i < N; i++) {
    const z = ((i + 0.5) / N) * m, zz = Math.min(z, m - z);
    v += area(dw / 2 + zz / t30) * (m / N);
  }
  return v;
}

describe('nut()', () => {
  it('M8 regular: a valid solid, ISO 4032 size, volume of the chamfered hexagon less the minor-diameter bore', async () => {
    const o = await build(`const p = part('N').nut({ size: 'M8' });`);
    const row = NUT_SIZES.M8, m = row.m.regular!;
    expect(o.ok).toBe(true);
    expect(o.bodies).toEqual(['Nut']);
    near(o.vol, chamferedHexVolume(row.s, m, 0.9 * row.s) - circ(minorInternal(8, 1.25) / 2, m), 0.01);
    near(o.bbox.size[2], m, 0.001);
    near(o.bbox.size[1], row.s, 0.001);                                  // across flats (the corners point along x)
    near(o.bbox.size[0], (2 * row.s) / Math.sqrt(3) * 0.998, 0.004);   // across corners, the chamfer takes only the very tip of the corner at the faces
    expect(o.bbox.max[2]).toBeLessThan(1e-6);                           // default axis -z: hangs down from the origin
  }, 120000);
  it('without the chamfer it is the plain prism', async () => {
    const o = await build(`const p = part('N').nut({ size: 'M8', chamfer: false });`);
    near(o.vol, hexArea(13) * 6.8 - circ(minorInternal(8, 1.25) / 2, 6.8), 0.003);
  }, 120000);
  it('thin and style 2 take their own thickness; style 2 stops at M5', async () => {
    const thin = await build(`const p = part('N').nut({ size: 'M10', type: 'thin' });`);
    const s2 = await build(`const p = part('N').nut({ size: 'M10', type: 'style2' });`);
    expect(thin.ok && s2.ok).toBe(true);
    near(thin.bbox.size[2], 5, 0.001); near(s2.bbox.size[2], 9.3, 0.001);
    near(thin.vol, chamferedHexVolume(16, 5, 14.4) - circ(minorInternal(10, 1.5) / 2, 5), 0.01);
    expect(await build(`const p = part('N').nut({ size: 'M4', type: 'style2' });`).then(() => 'built', (e: Error) => e.message)).toMatch(/style 2 starts at M5/);
  }, 120000);
  it('every size M2 to M16 builds a valid solid with its tap-drill bore and a cosmetic thread', async () => {
    for (const size of Object.keys(NUT_SIZES)) {
      const row = NUT_SIZES[size];
      const o = await build(`const p = part('N').nut({ size: '${size}', thread: 'cosmetic' });`);
      expect(o.ok, size).toBe(true);
      expect(o.threads, size).toBe(1);
      near(o.vol, chamferedHexVolume(row.s, row.m.regular!, 0.9 * row.s) - circ(row.tap / 2, row.m.regular!), 0.012);
    }
  }, 300000);
  it('puts the nut where origin and axis say', async () => {
    const o = await build(`const p = part('N').nut({ size: 'M5', origin: [10, 20, 30], axis: [1, 0, 0] });`);
    expect(o.ok).toBe(true);
    near(o.bbox.min[0], 10, 0.001); near(o.bbox.max[0], 14.7, 0.001);
    near((o.bbox.min[1] + o.bbox.max[1]) / 2, 20, 0.002); near((o.bbox.min[2] + o.bbox.max[2]) / 2, 30, 0.002);
  }, 120000);
  it('a modelled thread with print clearance cuts the helical groove, and a looser clearance cuts more', async () => {
    const cosmetic = await build(`const p = part('N').nut({ size: 'M5', thread: 'cosmetic' });`);
    const tight = await build(`const p = part('N').nut({ size: 'M5', thread: 'modeled' });`);
    const loose = await build(`const p = part('N').nut({ size: 'M5', thread: 'modeled', clearance: 0.1 });`);
    expect(tight.ok && loose.ok).toBe(true);
    expect(tight.vol).toBeLessThan(cosmetic.vol);   // the groove removes material beyond the tap drill
    expect(loose.vol).toBeLessThan(tight.vol);
    // the groove lies between the tap drill and the major diameter: at most the whole annulus, and not nothing
    const annulus = circ(2.5, 4.7) - circ(2.1, 4.7);
    expect(cosmetic.vol - tight.vol).toBeGreaterThan(0.1 * annulus); expect(cosmetic.vol - tight.vol).toBeLessThan(annulus);
  }, 300000);
  it('refuses numbers that cannot make a nut, with the reason', async () => {
    const bad = (opts: string) => build(`const p = part('N').nut(${opts});`).then(() => 'built', (e: Error) => e.message);
    expect(await bad(`{ size: 'M7' }`)).toMatch(/size must be one of/);
    expect(await bad(`{ size: 'M8', type: 'wing' }`)).toMatch(/type must be/);
    expect(await bad(`{ size: 'M8', thickness: 0.5 }`)).toMatch(/too small for a 30 degree chamfer/);
  });
});

describe('standoff()', () => {
  const bore = (size: string) => minorInternal(STANDOFF_SIZES[size].d, STANDOFF_SIZES[size].pitch) / 2;
  it('round male-female: the body less the female bore plus the stud, along z from the origin', async () => {
    const o = await build(`const p = part('S').standoff({ size: 'M3', length: 12, ends: 'male-female' });`);
    expect(o.ok).toBe(true);
    expect(o.bodies).toEqual(['Standoff']);
    near(o.vol, circ(3, 12) - circ(bore('M3'), 6) + circ(1.5, 6));
    near(o.bbox.size[2], 18, 0.001); expect(o.bbox.min[2]).toBeCloseTo(0, 5);   // body 12 + stud 6
    near(o.bbox.size[0], 6, 0.001);
  }, 120000);
  it('hex female-female: two bores, across flats as given', async () => {
    const o = await build(`const p = part('S').standoff({ size: 'M4', length: 15, kind: 'hex', outer: 7, threadLength: 5 });`);
    expect(o.ok).toBe(true);
    near(o.vol, hexArea(7) * 15 - 2 * circ(bore('M4'), 5));
    near(o.bbox.size[2], 15, 0.001); near(o.bbox.size[1], 7, 0.001);
  }, 120000);
  it('cosmetic threads sit on the bores and the stud; every size and both kinds build', async () => {
    const o = await build(`const p = part('S').standoff({ size: 'M3', length: 12, ends: 'male-female', thread: 'cosmetic' });`);
    expect(o.ok).toBe(true); expect(o.threads).toBe(2);
    near(o.vol, circ(3, 12) - circ(2.5 / 2, 6) + circ(1.5, 6));
    for (const size of Object.keys(STANDOFF_SIZES)) for (const kind of ['round', 'hex']) {
      const r = await build(`const p = part('S').standoff({ size: '${size}', length: 30, kind: '${kind}', ends: 'male-female' });`);
      expect(r.ok, `${size} ${kind}`).toBe(true);
    }
  }, 300000);
  it('puts the standoff where origin and axis say, either way', async () => {
    const o = await build(`const p = part('S').standoff({ size: 'M3', length: 10, threadLength: 4, origin: [5, 6, 7], axis: [0, -1, 0] });`);
    expect(o.ok).toBe(true);
    expect(o.bbox.max[1]).toBeCloseTo(6, 3); expect(o.bbox.min[1]).toBeCloseTo(-4, 3);
    near((o.bbox.min[0] + o.bbox.max[0]) / 2, 5, 0.01); near((o.bbox.min[2] + o.bbox.max[2]) / 2, 7, 0.01);
  }, 120000);
  it('a modelled stud thread is a valid solid with less material than the plain stud', async () => {
    const o = await build(`const p = part('S').standoff({ size: 'M4', length: 12, ends: 'male-female', thread: 'modeled', clearance: 0.1 });`);
    expect(o.ok).toBe(true);
    expect(o.vol).toBeLessThan(circ(3.5, 12) - circ(3.3 / 2, 6) + circ(2, 6));
  }, 300000);
  it('refuses a thread that is longer than the standoff, and a wall that is too thin', async () => {
    const bad = (opts: string) => build(`const p = part('S').standoff(${opts});`).then(() => 'built', (e: Error) => e.message);
    expect(await bad(`{ size: 'M3', length: 10, threadLength: 6 }`)).toMatch(/would meet/);
    expect(await bad(`{ size: 'M3', length: 5, ends: 'male-female', threadLength: 6 }`)).toMatch(/shorter than the length/);
    expect(await bad(`{ size: 'M3', length: 20, outer: 3.5 }`)).toMatch(/at least 4/);
  });
});

describe('heatSetInsert()', () => {
  /** volume of an insert: the ring, less the groove rings (a trapezoid each, by Pappus), by numerical integration */
  function insertVolume(size: string, rings: number): number {
    const r = INSERT_SIZES[size], ro = r.od / 2, rb = minorInternal(r.d, r.pitch) / 2, L = r.length;
    const gd = Math.max(0.15, 0.05 * r.od), gw = Math.min(0.8, L / (2 * (rings + 1)));
    let groove = 0; const n = 2000;
    for (let i = 0; i < n; i++) { const rr = ro - gd + ((i + 0.5) / n) * gd; groove += 2 * Math.PI * rr * (gw / 2 + (gw / 2) * ((rr - (ro - gd)) / gd)) * (gd / n); }
    return Math.PI * (ro * ro - rb * rb) * L - rings * groove;
  }
  it('M3: a valid ring with the groove rings, length along the axis from the origin, volume by Pappus', async () => {
    const o = await build(`const p = part('I').heatSetInsert({ size: 'M3' });`);
    expect(o.ok).toBe(true);
    expect(o.bodies).toEqual(['Insert']);
    near(o.vol, insertVolume('M3', 3), 0.01);
    near(o.bbox.size[2], 5.7, 0.001); near(o.bbox.size[0], 4.6, 0.001);
    expect(o.bbox.max[2]).toBeLessThan(1e-6);   // default axis -z: the insert goes down into the part
  }, 120000);
  it('every size builds, with a cosmetic thread on the bore', async () => {
    for (const size of Object.keys(INSERT_SIZES)) {
      const row = INSERT_SIZES[size];
      const o = await build(`const p = part('I').heatSetInsert({ size: '${size}', thread: 'cosmetic' });`);
      expect(o.ok, size).toBe(true); expect(o.threads, size).toBe(1);
      near(o.bbox.size[2], row.length, 0.001);
    }
  }, 300000);
  it('hole: true cuts the recommended hole into the part before the insert goes in', async () => {
    const o = await build(`const p = part('Block').sketch('front', (s) => s.rect(30, 30)).extrude(12, { newBody: 'Block' }).heatSetInsert({ size: 'M3', hole: true, origin: [0, 0, 12] });`);
    expect(o.ok).toBe(true);
    const r = INSERT_SIZES.M3;
    near(o.vol, 30 * 30 * 12 - circ(r.hole / 2, r.depth) + insertVolume('M3', 3), 0.005);
    expect(o.bodies).toEqual(['Block', 'Insert']);
  }, 120000);
  it('hole: a name cuts only that body, and the insert is not cut by its own hole', async () => {
    const o = await build(`const p = part('Two').sketch('front', (s) => s.rect(30, 30)).extrude(12, { newBody: 'A' })
      .sketch(at('front', 0), (s) => s.rect(30, 30, [40, 0])).extrude(12, { newBody: 'B' })
      .heatSetInsert({ size: 'M3', hole: 'A', origin: [0, 0, 12] }).heatSetInsert({ size: 'M3', hole: 'B', origin: [40, 0, 12], name: 'Insert 2' });`);
    expect(o.ok).toBe(true);
    const r = INSERT_SIZES.M3;
    near(o.vol, 2 * 30 * 30 * 12 - 2 * circ(r.hole / 2, r.depth) + 2 * insertVolume('M3', 3), 0.005);
  }, 120000);
  it('refuses a hole that does not fit the insert', async () => {
    const bad = (opts: string) => build(`const p = part('I').heatSetInsert(${opts});`).then(() => 'built', (e: Error) => e.message);
    expect(await bad(`{ size: 'M3', holeDiameter: 5 }`)).toMatch(/must not be larger/);
    expect(await bad(`{ size: 'M3', holeDepth: 4 }`)).toMatch(/at least the insert length/);
    expect(await bad(`{ size: 'M7' }`)).toMatch(/size must be one of/);
  });
});
