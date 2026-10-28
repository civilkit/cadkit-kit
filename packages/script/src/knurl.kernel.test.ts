import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface Out { vol: number; ok: boolean; faces: number; kinds: Record<string, number>; ms: number; editMs: number; errors: string[]; warnings: string[]; bbox: { min: number[]; max: number[] } }
/** Run a script as a user would, then read the part back through the script's own readbacks (thrown as the one error the sandbox allows). */
async function build(body: string): Promise<Out> {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  let editMs = 0;   // the time the kernel spent regenerating the edits (the script's own readbacks come on top of ms)
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: async (ops, why) => { const t = Date.now(); try { return await controller.edit(ops, why) as never; } finally { editMs += Date.now() - t; } },
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const code = body + `
const vol = await p.volume(); const ok = await p.isValid(); const fs = await p.faces(); const bb = await p.bbox();
throw new Error('KN' + JSON.stringify({ vol, ok, faces: fs.length, bbox: bb, kinds: fs.reduce((a, f) => { a[f.kind] = (a[f.kind] || 0) + 1; return a; }, {}) }));
`;
  const t0 = Date.now();
  const r = await runScript(code, h);
  const ms = Date.now() - t0;
  const e = r.errors.find((x) => x.message.startsWith('KN'));
  if (!e) throw new Error('script failed: ' + r.errors.map((x) => x.message).join(' | '));
  return { ...(JSON.parse(e.message.slice(2)) as Out), ms, editMs, errors: r.errors.map((x) => x.message), warnings: (r.warnings ?? []).map((w: { message: string }) => w.message) };
}

const R = 10, L = 12;
const cyl = Math.PI * R * R * L;
const blank = (axis = 'z') => `const p = part('Knurled').sketch('${axis === 'z' ? 'front' : axis === 'y' ? 'top' : 'right'}', (s) => s.circle(${R})).extrude(${L});\n`;

describe('knurl(): cuts a knurl into a cylinder (straight, round and method boolean)', () => {
  it('straight V grooves: 24 grooves, valid, 3N+2 faces, removed volume about N*d^2*L', async () => {
    const m = await build(blank() + `p.knurl({ axis: 'z', radius: ${R}, from: 0, to: ${L}, pattern: 'straight', count: 24, depth: 0.6 });`);
    console.log('KNURL straight', JSON.stringify({ ...m, kinds: undefined }), m.kinds);
    expect(m.ok).toBe(true);
    expect(m.faces).toBe(3 * 24 + 2);   // 2 ends, 24 remaining cylinder strips, 48 groove walls
    const removed = cyl - m.vol;
    expect(removed).toBeGreaterThan(24 * 0.36 * L * 0.85);   // a 90 degree V of depth d has area about d^2
    expect(removed).toBeLessThan(24 * 0.36 * L * 1.05);
  }, 600_000);

  it('straight round grooves: valid, 2N+2 faces', async () => {
    const m = await build(blank() + `p.knurl({ axis: 'z', radius: ${R}, from: 0, to: ${L}, pattern: 'straight', profile: 'round', count: 20, depth: 0.5 });`);
    console.log('KNURL round', JSON.stringify({ ...m, kinds: undefined }));
    expect(m.ok).toBe(true);
    expect(m.faces).toBe(2 * 20 + 2);
    const removed = cyl - m.vol;
    const half = 20 * (Math.PI / 2) * 0.25 * L;   // depth 0.5 with width 2*depth: a half circle of radius 0.5 per groove
    expect(removed).toBeGreaterThan(half * 0.9);
    expect(removed).toBeLessThan(half * 1.05);
  }, 600_000);

  it('straight knurl on a cylinder along Y that is off the origin (pitch instead of count)', async () => {
    const m = await build(`const p = part('Off').sketch('top', (s) => s.circle(${R}, [15, 5])).extrude(${L});
p.knurl({ axis: 'y', center: [15, -5], radius: ${R}, from: 0, to: ${L}, pitch: 2.6, depth: 0.5 });`);
    // 'top' sketch y = -world Z, so the circle at sketch (15, 5) is at world (15, -5)
    console.log('KNURL offaxis', JSON.stringify({ ...m, kinds: undefined }));
    expect(m.ok).toBe(true);
    const n = Math.round((2 * Math.PI * R) / 2.6);
    expect(m.faces).toBe(3 * n + 2);
    expect(cyl - m.vol).toBeGreaterThan(n * 0.25 * L * 0.8);
  }, 600_000);

  it('diamond: two crossed helical sets, valid, many faces, removed volume close to two straight sets', async () => {
    const m = await build(blank() + `p.knurl({ axis: 'z', radius: ${R}, from: 0, to: ${L}, pattern: 'diamond', count: 12, depth: 0.5, helixAngle: 22, method: 'boolean' });`);
    console.log('KNURL diamond', JSON.stringify({ ...m, kinds: undefined }));
    expect(m.ok).toBe(true);
    expect(m.faces).toBeGreaterThan(100);
    const removed = cyl - m.vol;
    const two = 2 * 12 * 0.25 * L;
    expect(removed).toBeGreaterThan(two * 0.7);
    expect(removed).toBeLessThan(two * 1.05);
  }, 900_000);

  it('pyramid: axial grooves crossed by ring grooves, valid, removed volume between one set and both', async () => {
    const m = await build(blank() + `p.knurl({ axis: 'z', radius: ${R}, from: 0, to: ${L}, pattern: 'pyramid', count: 24, depth: 0.5, method: 'boolean' });`);
    console.log('KNURL pyramid', JSON.stringify({ ...m, kinds: undefined }));
    expect(m.ok).toBe(true);
    expect(m.faces).toBeGreaterThan(200);
    const removed = cyl - m.vol;
    expect(removed).toBeGreaterThan(24 * 0.25 * L);
    expect(removed).toBeLessThan(24 * 0.25 * L + 2 * Math.PI * R * 0.25 * (L / (2 * Math.PI * R / 24)));
  }, 900_000);

  it('diamond along X, off the origin, round grooves: valid, volume removed in range', async () => {
    // 'right' sketch u = -world Z, v = world Y: a circle at sketch (4, 3) is at world y = 3, z = -4
    const m = await build(`const p = part('X').sketch('right', (s) => s.circle(${R}, [4, 3])).extrude(6);
p.knurl({ axis: 'x', center: [3, -4], radius: ${R}, from: 0, to: 6, pattern: 'diamond', profile: 'round', count: 6, depth: 0.5, helixAngle: 30 });`);
    console.log('KNURL diamond-x', JSON.stringify({ ...m, kinds: m.kinds, errors: undefined }));
    expect(m.ok).toBe(true);
    const base = Math.PI * R * R * 6;
    const two = 2 * 6 * (Math.PI / 2) * 0.25 * 6;
    expect(base - m.vol).toBeGreaterThan(two * 0.6);
    expect(base - m.vol).toBeLessThan(two * 1.05);
    expect(m.bbox.min[0]).toBeCloseTo(0, 2); expect(m.bbox.max[0]).toBeCloseTo(6, 2);
  }, 900_000);

  it('pyramid along Y, off the origin: valid, volume removed in range', async () => {
    const m = await build(`const p = part('Y').sketch('top', (s) => s.circle(${R}, [5, 2])).extrude(10);
p.knurl({ axis: 'y', center: [5, -2], radius: ${R}, from: 0, to: 10, pattern: 'pyramid', count: 20, depth: 0.5 });`);
    console.log('KNURL pyramid-y', JSON.stringify({ ...m, kinds: m.kinds, errors: undefined }));
    expect(m.ok).toBe(true);
    const base = Math.PI * R * R * 10;
    expect(base - m.vol).toBeGreaterThan(20 * 0.25 * 10);
    expect(base - m.vol).toBeLessThan(20 * 0.25 * 10 * 2.2);
  }, 900_000);

  it('refuses a diamond whose crossings would exceed the kernel boolean budget, before touching the kernel', async () => {
    await expect(build(blank() + `p.knurl({ axis: 'z', radius: ${R}, from: 0, to: 20, pattern: 'diamond', count: 30, depth: 0.5, helixAngle: 45, method: 'boolean' });`)).rejects.toThrow(/crossings/);
  }, 60_000);

  it('refuses grooves that would overlap, with a message naming the largest count', async () => {
    await expect(build(blank() + `p.knurl({ axis: 'z', radius: ${R}, from: 0, to: ${L}, count: 80, depth: 0.6 });`)).rejects.toThrow(/overlap|too many|too close/i);
  }, 600_000);
});

// Cosmetic mode adds no feature: the solid is the plain cylinder (same volume, faces, validity), however dense the pattern.
describe("knurl({ mode: 'cosmetic' }) leaves the solid alone", () => {
  const plain = async () => build(blank());
  const cosmetic = (extra: string) => build(blank() + `p.knurl({ axis: 'z', radius: ${R}, from: 0, to: ${L}, mode: 'cosmetic', ${extra} });`);
  for (const [name, extra] of [
    ['straight', "pattern: 'straight', count: 24, depth: 0.6"],
    ['pyramid', "pattern: 'pyramid', count: 60, depth: 0.3, ringPitch: 1.2"],
    ['diamond, a density the real cut refuses', "pattern: 'diamond', count: 120, depth: 0.2, helixAngle: 45"],
  ] as const) {
    it(`${name}: volume, face count and validity equal the plain cylinder, and it is quick`, async () => {
      const base = await plain();
      const m = await cosmetic(extra);
      expect(m.ok).toBe(true);
      expect(m.faces).toBe(base.faces);
      expect(m.faces).toBe(3);
      expect(m.vol).toBeCloseTo(base.vol, 6);
      expect(m.vol).toBeCloseTo(cyl, 3);
      expect(m.kinds).toEqual(base.kinds);
      expect(m.ms).toBeLessThan(base.ms + 3000);
    }, 120_000);
  }
});

describe("knurl() method 'faceted': diamond and pyramid built as faces by the kernel", () => {
  const knurlLine = (pattern: string, extra: string) => blank() + `p.knurl({ axis: 'z', radius: ${R}, from: 0, to: ${L}, pattern: '${pattern}', ${extra} });`;
  it('is the default for V diamond and pyramid and records one feature', async () => {
    const m = await build(knurlLine('pyramid', 'count: 24, depth: 0.5'));
    console.log('KNURL faceted pyramid', JSON.stringify({ ...m, kinds: undefined }));
    expect(m.ok).toBe(true);
    expect(m.faces).toBeGreaterThan(200);
  }, 600_000);
  it('matches the boolean version: same parameters, volume within 6 percent, both valid', async () => {
    for (const [pattern, extra] of [['pyramid', 'count: 16, depth: 0.8'], ['diamond', 'count: 12, depth: 0.5, helixAngle: 22']] as const) {
      const f = await build(knurlLine(pattern, `${extra}, method: 'faceted'`));
      const b = await build(knurlLine(pattern, `${extra}, method: 'boolean'`));
      console.log('KNURL compare', pattern, 'faceted', f.editMs, 'ms regen', f.faces, 'faces', (cyl - f.vol).toFixed(2), 'mm3 | boolean', b.editMs, 'ms regen', b.faces, 'faces', (cyl - b.vol).toFixed(2), 'mm3');
      expect(f.ok && b.ok).toBe(true);
      expect(Math.abs((cyl - f.vol) - (cyl - b.vol)) / (cyl - b.vol)).toBeLessThan(0.06);
    }
  }, 900_000);
  it('builds a dense diamond that the boolean method refuses, and the time grows about linearly: 12, 24, 48 grooves', async () => {
    const times: Record<string, number> = {};
    for (const n of [12, 24, 48]) {
      const d = await build(knurlLine('diamond', `count: ${n}, helixAngle: 30`));
      const y = await build(knurlLine('pyramid', `count: ${n}`));
      times[`diamond ${n}`] = d.editMs; times[`pyramid ${n}`] = y.editMs;
      console.log('KNURL faceted', n, 'diamond', d.editMs, 'ms regen', d.faces, 'faces | pyramid', y.editMs, 'ms regen', y.faces, 'faces');
      expect(d.ok && y.ok).toBe(true);
    }
    await expect(build(knurlLine('diamond', `count: 48, helixAngle: 30, method: 'boolean'`))).rejects.toThrow(/crossings/);
    expect(times['diamond 48']).toBeLessThan(times['diamond 24'] * 8);
  }, 900_000);
  it('refuses what it cannot build', async () => {
    await expect(build(knurlLine('straight', `count: 24, method: 'faceted'`))).rejects.toThrow(/faceted/);
    await expect(build(knurlLine('diamond', `count: 24, profile: 'round', method: 'faceted'`))).rejects.toThrow(/V grooves only/);
    await expect(build(knurlLine('pyramid', `count: 80, depth: 0.6`))).rejects.toThrow(/overlap/);
  }, 600_000);
});

// The shipped example, run as pasted, with each pattern. The blank is a 36 x 14 cylinder with a 6 mm bore and a 1.2 chamfer; the knurl band is z 2..12.
describe('knurled knob example (docs/examples/knurled-knob.script.ts)', () => {
  const src = readFileSync(resolve(process.cwd(), 'docs/examples/knurled-knob.script.ts'), 'utf8');
  const run = (pattern: string) => build(src.replace("const pattern = 'straight';", `const pattern = '${pattern}';`).replace(/\bknob\.knurl/, 'knob.knurl') + '\nconst p = knob;\n');
  const smooth = async () => (await build(src.replace(/knob\.knurl\([\s\S]*?\n\}\);/, '') + '\nconst p = knob;\n')).vol;
  it('straight: 36 grooves of a 90 degree V, 0.6 deep, over 10 mm', async () => {
    const base = await smooth();
    const m = await run('straight');
    console.log('KNURL knob straight', m.ms, 'ms', m.faces, 'faces', (base - m.vol).toFixed(1), 'mm3 removed');
    expect(m.ok).toBe(true);
    expect(m.errors.length).toBe(1);   // only the readback
    const removed = base - m.vol;
    expect(removed).toBeGreaterThan(36 * 0.36 * 10 * 0.9);
    expect(removed).toBeLessThan(36 * 0.36 * 10 * 1.02);
  }, 600_000);
  it('pyramid: valid, removes more than the straight set', async () => {
    const base = await smooth();
    const m = await run('pyramid');
    console.log('KNURL knob pyramid', m.ms, 'ms', m.faces, 'faces', (base - m.vol).toFixed(1), 'mm3 removed');
    expect(m.ok).toBe(true);
    expect(base - m.vol).toBeGreaterThan(36 * 0.36 * 10 * 0.95);
    expect(base - m.vol).toBeLessThan(36 * 0.36 * 10 * 2.0);
  }, 900_000);
  it('diamond: valid, removes about two straight sets of 14', async () => {
    const base = await smooth();
    const m = await run('diamond');
    console.log('KNURL knob diamond', m.ms, 'ms', m.faces, 'faces', (base - m.vol).toFixed(1), 'mm3 removed');
    expect(m.ok).toBe(true);
    const two = 2 * 14 * 0.36 * 10;
    expect(base - m.vol).toBeGreaterThan(two * 0.75);
    expect(base - m.vol).toBeLessThan(two * 1.05);
  }, 900_000);
});
