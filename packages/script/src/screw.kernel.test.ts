import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';
import { SCREW_SIZES, torxOutline } from './features/screw';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface Out { vol: number; ok: boolean; faces: number; kinds: Record<string, number>; ms: number; errors: string[]; bbox: { min: number[]; max: number[]; size: number[] }; bodies: number }
/** Run a script as a user would, then read the part back through the script's own readbacks (thrown as the one error the sandbox allows). */
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
const vol = await p.volume(); const ok = await p.isValid(); const fs = await p.faces(); const bb = await p.bbox();
throw new Error('KN' + JSON.stringify({ vol, ok, faces: fs.length, bbox: bb, kinds: fs.reduce((a, f) => { a[f.kind] = (a[f.kind] || 0) + 1; return a; }, {}) }));
`;
  const t0 = Date.now();
  const r = await runScript(code, h);
  const ms = Date.now() - t0;
  const e = r.errors.find((x) => x.message.startsWith('KN'));
  if (!e) throw new Error('script failed: ' + r.errors.map((x) => x.message).join(' | '));
  return { ...(JSON.parse(e.message.slice(2)) as Out), ms, errors: r.errors.map((x) => x.message) };
}

// M3 x 6 reference numbers (the table row), the tip chamfer is one pitch
const M3 = SCREW_SIZES.M3;
const Rs = 1.5, L = 6, pitch = 0.5;
const shankVol = Math.PI * Rs * Rs * L - (Math.PI * pitch / 3) * (Rs * Rs + Rs * (Rs - pitch) + (Rs - pitch) ** 2);
const screwSrc = (o: string) => `const p = part('Screw').screw({ size: 'M3', length: ${L}, ${o} });\n`;
const near = (v: number, want: number, tol: number) => { expect(v).toBeGreaterThan(want * (1 - tol)); expect(v).toBeLessThan(want * (1 + tol)); };

describe('screw(): torx outline (pure geometry)', () => {
  it('is 12 arcs that join end to end and are tangent where they meet', () => {
    const arcs = torxOutline(3.86, 2.75);
    expect(arcs.length).toBe(12);
    for (let i = 0; i < arcs.length; i++) {
      const a = arcs[i], b = arcs[(i + 1) % arcs.length];
      expect(Math.hypot(a.to[0] - b.from[0], a.to[1] - b.from[1])).toBeLessThan(1e-9);
      // tangent: the join lies on the line through both centres
      const da = Math.hypot(a.to[0] - a.centre[0], a.to[1] - a.centre[1]), db = Math.hypot(b.from[0] - b.centre[0], b.from[1] - b.centre[1]);
      expect(Math.abs(da - a.radius)).toBeLessThan(1e-9); expect(Math.abs(db - b.radius)).toBeLessThan(1e-9);
      const cross = (a.to[0] - a.centre[0]) * (b.centre[1] - a.centre[1]) - (a.to[1] - a.centre[1]) * (b.centre[0] - a.centre[0]);
      expect(Math.abs(cross)).toBeLessThan(1e-9);
    }
    const r = arcs.flatMap((a) => [Math.hypot(...a.from), Math.hypot(...a.to)]);
    expect(Math.max(...r)).toBeLessThanOrEqual(3.86 / 2 + 1e-9);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(2.75 / 2 - 1e-9);
  });
});

describe('screw(): heads', () => {
  const cases: Array<{ head: string; opts: string; headVol: number; total: number; faces: number }> = [];
  const k = (h: 'pan' | 'button' | 'countersunk' | 'cheese' | 'hex') => M3[h].k, dk = (h: 'pan' | 'button' | 'countersunk' | 'cheese' | 'hex') => M3[h].dk;
  const dome = (h: 'pan' | 'button') => { const Rh = dk(h) / 2, s = M3[h].rise * k(h); return Math.PI * Rh * Rh * (k(h) - s) + (Math.PI * s * (3 * Rh * Rh + s * s)) / 6; };
  cases.push({ head: 'pan', opts: `head: 'pan', drive: 'none'`, headVol: dome('pan'), total: L + k('pan'), faces: 6 });
  cases.push({ head: 'button', opts: `head: 'button', drive: 'none'`, headVol: dome('button'), total: L + k('button'), faces: 6 });
  cases.push({ head: 'cheese', opts: `head: 'cheese', drive: 'none'`, headVol: Math.PI * (dk('cheese') / 2) ** 2 * k('cheese'), total: L + k('cheese'), faces: 7 });
  cases.push({ head: 'hex', opts: `head: 'hex'`, headVol: (Math.sqrt(3) / 2) * dk('hex') ** 2 * k('hex'), total: L + k('hex'), faces: 11 });
  const Rh = dk('countersunk') / 2, kc = k('countersunk');
  cases.push({ head: 'countersunk', opts: `head: 'countersunk', drive: 'none'`, headVol: (Math.PI * kc / 3) * (Rh * Rh + Rh * Rs + Rs * Rs), total: L, faces: 5 });
  for (const c of cases) {
    it(`${c.head}: valid, volume = head + shank, height ${c.total.toFixed(2)}, ${c.faces} faces`, async () => {
      const m = await build(screwSrc(c.opts));
      console.log('SCREW head', c.head, JSON.stringify({ vol: m.vol, faces: m.faces, ms: m.ms, bbox: m.bbox }));
      expect(m.ok).toBe(true);
      // countersunk: the head replaces the top of the shank (length includes the head)
      const shank = c.head === 'countersunk' ? shankVol - Math.PI * Rs * Rs * kc : shankVol;
      near(m.vol, c.headVol + shank, c.head === 'hex' ? 0.02 : 0.03);
      expect(m.faces).toBe(c.faces);
      // default placement: origin 0, shank pointing down -Z, head above
      expect(m.bbox.min[2]).toBeCloseTo(-L, 2);
      expect(m.bbox.max[2]).toBeCloseTo(c.head === 'countersunk' ? 0 : c.total - L, 1);
    }, 600_000);
  }
});

describe('screw(): drives cut into the head', () => {
  // a cheese head is a plain cylinder, so the removed volume is easy to predict
  const base = async () => (await build(screwSrc(`head: 'cheese', drive: 'none'`))).vol;
  const Rh = M3.cheese.dk / 2;

  it('hex socket: valid, removes (sqrt(3)/2) s^2 x depth, 6 walls and a floor', async () => {
    const v0 = await base();
    const m = await build(screwSrc(`head: 'cheese', drive: 'hex', driveSize: 2, driveDepth: 1.2`));
    console.log('SCREW drive hex', JSON.stringify({ vol: m.vol, faces: m.faces, ms: m.ms }));
    expect(m.ok).toBe(true);
    near(v0 - m.vol, (Math.sqrt(3) / 2) * 4 * 1.2, 0.02);
    expect(m.faces).toBe(7 + 7);
  }, 600_000);

  it('slotted: valid, removes about slot width x head diameter x depth', async () => {
    const v0 = await base();
    const m = await build(screwSrc(`head: 'cheese', drive: 'slotted', driveSize: 0.8, driveDepth: 1`));
    console.log('SCREW drive slotted', JSON.stringify({ vol: m.vol, faces: m.faces, ms: m.ms }));
    expect(m.ok).toBe(true);
    near(v0 - m.vol, 0.8 * 2 * Math.sqrt(Rh * Rh - 0.16) * 1, 0.04);
    expect(m.faces).toBeGreaterThanOrEqual(7 + 3);
  }, 600_000);

  it('cross (approximation): valid, removes two tapered arms (trapezoid section, blunt flat tip)', async () => {
    const v0 = await base();
    const m = await build(screwSrc(`head: 'cheese', drive: 'cross', driveSize: 3, driveDepth: 1`));
    console.log('SCREW drive cross', JSON.stringify({ vol: m.vol, faces: m.faces, ms: m.ms }));
    expect(m.ok).toBe(true);
    const w = 3 * 0.2, flat = 0.3, section = ((3 + 2 * flat) / 2) * 1;   // arm width, half-flat, trapezoid area (span 3, depth 1)
    const want = 2 * section * w - w * w * 0.95;                       // two arms minus the shared centre
    near(v0 - m.vol, want, 0.1);
    expect(m.faces).toBeGreaterThanOrEqual(7 + 8);
  }, 600_000);

  it('torx (approximation, real arcs): valid, removes an area between the inner and outer circles', async () => {
    const v0 = await base();
    const m = await build(screwSrc(`head: 'cheese', drive: 'torx', driveDepth: 1`));
    console.log('SCREW drive torx', JSON.stringify({ vol: m.vol, faces: m.faces, ms: m.ms }));
    expect(m.ok).toBe(true);
    const { A, B } = M3.torx;
    expect(v0 - m.vol).toBeGreaterThan(Math.PI * (B / 2) ** 2);
    expect(v0 - m.vol).toBeLessThan(Math.PI * (A / 2) ** 2);
    expect(m.faces).toBe(7 + 12 + 1);
  }, 600_000);

  for (const head of ['pan', 'button', 'countersunk']) {
    for (const drive of ['slotted', 'hex', 'cross', 'torx']) {
      it(`${head} head with a ${drive} drive: valid, material removed, head not split`, async () => {
        const v0 = (await build(screwSrc(`head: '${head}', drive: 'none'`))).vol;
        const m = await build(screwSrc(`head: '${head}', drive: '${drive}'`));
        console.log('SCREW combo', head, drive, JSON.stringify({ removed: +(v0 - m.vol).toFixed(3), faces: m.faces, ms: m.ms }));
        expect(m.ok).toBe(true);
        expect(v0 - m.vol).toBeGreaterThan(0.2);
        expect(v0 - m.vol).toBeLessThan(0.3 * (v0 - shankVol));   // a drive never takes a third of the head
      }, 600_000);
    }
  }

  it('a hex head refuses a drive; unknown size and head are refused with the choices', async () => {
    await expect(build(screwSrc(`head: 'hex', drive: 'torx'`))).rejects.toThrow(/hex head/);
    await expect(build(`const p = part('S').screw({ size: 'M9', length: 6 });`)).rejects.toThrow(/M2.*M8/);
    await expect(build(`const p = part('S').screw({ size: 'M3', length: 6, head: 'dome' });`)).rejects.toThrow(/pan.*button/);
  }, 60_000);
});

describe('screw(): sizes and overrides', () => {
  it('every size M2..M8 builds a valid button head with a hex socket', async () => {
    for (const size of Object.keys(SCREW_SIZES)) {
      const m = await build(`const p = part('S').screw({ size: '${size}', length: 10, head: 'button', drive: 'hex' });`);
      const d = SCREW_SIZES[size as keyof typeof SCREW_SIZES];
      console.log('SCREW size', size, JSON.stringify({ vol: +m.vol.toFixed(2), faces: m.faces, ms: m.ms }));
      expect(m.ok).toBe(true);
      expect(Math.abs(m.bbox.size[2] - (10 + d.button.k))).toBeLessThan(0.1 + 0.15 * d.button.k);   // the mesh box can miss the very apex of a dome
      expect(m.bbox.size[0]).toBeCloseTo(d.button.dk, 0);
    }
  }, 900_000);

  // every head and drive at every size, one test per size (run one at a time: each is about 40 builds)
  for (const size of Object.keys(SCREW_SIZES)) {
    it(`matrix ${size}: every head x drive is valid and the drive removes material`, async () => {
      const d = SCREW_SIZES[size as keyof typeof SCREW_SIZES].d;
      const fails: string[] = [];
      for (const head of ['pan', 'button', 'countersunk', 'cheese', 'hex']) {
        const src = (drive: string) => `const p = part('S').screw({ size: '${size}', length: ${4 * d}, head: '${head}', drive: '${drive}' });`;
        const v0 = (await build(src('none'))).vol;
        for (const drive of head === 'hex' ? [] : ['slotted', 'hex', 'cross', 'torx']) {
          try {
            const m = await build(src(drive));
            console.log('SCREW matrix', size, head, drive, Math.round(m.ms), 'ms');
            if (!m.ok) fails.push(`${head} ${drive}: invalid solid`);
            else if (!(v0 - m.vol > 0)) fails.push(`${head} ${drive}: the drive removed nothing`);
          } catch (e) { fails.push(`${head} ${drive}: ${(e as Error).message}`); }
        }
      }
      expect(fails).toEqual([]);
    }, 280_000);
  }

  it('every value can be overridden', async () => {
    const m = await build(`const p = part('S').screw({ size: 'M4', length: 8, head: 'cheese', drive: 'hex', diameter: 3.6, headDiameter: 9, headHeight: 3, driveSize: 3, driveDepth: 2 });`);
    expect(m.ok).toBe(true);
    expect(m.bbox.size[0]).toBeCloseTo(9, 1);
    expect(m.bbox.size[2]).toBeCloseTo(11, 1);
  }, 600_000);
});

describe('screw(): placement', () => {
  const ref = () => build(screwSrc(`head: 'pan', drive: 'cross'`));
  it('origin and axis: a screw along +X from a point has the same volume and the right box', async () => {
    const r = await ref();
    const m = await build(screwSrc(`head: 'pan', drive: 'cross', origin: [10, 20, 30], axis: [1, 0, 0]`));
    expect(m.ok).toBe(true);
    near(m.vol, r.vol, 0.001);
    expect(m.bbox.min[0]).toBeCloseTo(10 - M3.pan.k, 1);   // head on the near side
    expect(m.bbox.max[0]).toBeCloseTo(16, 1);
    expect(m.bbox.min[1]).toBeCloseTo(20 - M3.pan.dk / 2, 1);
    expect(m.bbox.min[2]).toBeCloseTo(30 - M3.pan.dk / 2, 1);
  }, 600_000);

  it('an oblique axis keeps the volume', async () => {
    const r = await ref();
    const m = await build(screwSrc(`head: 'pan', drive: 'torx', origin: [5, 5, 5], axis: [1, 1, 0]`));
    const r2 = await build(screwSrc(`head: 'pan', drive: 'torx'`));
    expect(m.ok).toBe(true);
    near(m.vol, r2.vol, 0.001);
    expect(r.ok).toBe(true);
    const tip = [5 + 6 / Math.SQRT2, 5 + 6 / Math.SQRT2];
    expect(m.bbox.max[0]).toBeGreaterThan(tip[0] - 0.01);
  }, 600_000);

  it('the free function screw({...}) does the same as part().screw', async () => {
    const m = await build(`const p = screw({ size: 'M3', length: 6, head: 'button', drive: 'hex' });`);
    const r = await build(screwSrc(`head: 'button', drive: 'hex'`));
    expect(m.ok).toBe(true);
    near(m.vol, r.vol, 0.0001);
  }, 600_000);

  it('a screw sits in a clearance hole of a plate as a second body', async () => {
    const m = await build(`const p = part('Plate').sketch('front', (s) => s.rect(30, 30)).extrude(4)
  .hole(face('>Z'), [0, 0], { diameter: 3.4 });
p.screw({ size: 'M3', length: 8, head: 'button', drive: 'hex', origin: [0, 0, 4], axis: [0, 0, -1] });`);
    console.log('SCREW in plate', JSON.stringify({ vol: m.vol, faces: m.faces, ms: m.ms }));
    expect(m.ok).toBe(true);
    const plate = 30 * 30 * 4 - Math.PI * 1.7 * 1.7 * 4;
    expect(m.vol).toBeGreaterThan(plate + 20);
  }, 600_000);
});

describe('screw(): thread', () => {
  it('thread: true is refused with a clear message', async () => {
    let msg = '';
    try { const m = await build(screwSrc(`head: 'cheese', drive: 'hex', thread: true`)); msg = JSON.stringify(m.errors ?? m); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/thread: true is not available yet/);
  }, 120_000);
});
