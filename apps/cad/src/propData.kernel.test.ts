// The airfoil-loft propeller against the real kernel: it builds, the pitch law holds in the built geometry, N blades balance on the axis, the volume
// matches the numerical integral of the section areas, the solid is valid, STEP round-trips it, seeded random parameter sets build or are refused
// with a structured error (nothing traps), and the old NaN chord inside the hub cannot happen.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { sessionQuery } from './inspect/kernel';
import type { PartDoc } from '@ck/part-model';
import {
  DEFAULT_PROP, PropError, bladeSections, bladeSpan, propDocument, propErrors, sectionAt, sectionRadii, validateProp, type PropParams,
} from './propData';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const P = (o: Partial<PropParams> = {}): PropParams => ({ ...DEFAULT_PROP, ...o });

async function build(p: PropParams) {
  const t0 = Date.now();
  const s = await Session.open(propDocument(p) as unknown as PartDoc); sessions.push(s);
  const rep = await s.verify();
  const ms = Date.now() - t0;
  const mass = await s.massProps({ bodies: true });
  const facts = await s.facts();
  return { s, rep, ms, mass, vol: mass.volume as number, facts, com: mass.com as number[] };
}

type Pt = [number, number];
/** Sutherland-Hodgman clip of a polygon by the rectangle |x| < hx, |y| < hy. */
function clipRect(poly: Pt[], hx: number, hy: number): Pt[] {
  const edges: Array<(q: Pt) => number> = [(q) => hx - q[0], (q) => q[0] + hx, (q) => hy - q[1], (q) => q[1] + hy];
  let out = poly;
  for (const f of edges) {
    const inp = out; out = [];
    inp.forEach((a, i) => {
      const b = inp[(i + 1) % inp.length], fa = f(a), fb = f(b);
      if (fa >= 0) out.push(a);
      if (fa >= 0 !== fb >= 0) { const t = fa / (fa - fb); out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    });
    if (!out.length) return [];
  }
  return out;
}
const polyArea = (q: Pt[]): number => { let a = 0; q.forEach((p0, i) => { const p1 = q[(i + 1) % q.length]; a += p0[0] * p1[1] - p1[0] * p0[1]; }); return Math.abs(a) / 2; };
const outline = (p: PropParams, r: number): Pt[] => { const s = sectionAt(p, r); return [...s.upper, ...[...s.lower].reverse().slice(1, -1)]; };

/** Volume the geometry should have: the hub, minus the bore, plus N blades integrated section by section (midpoint rule, `steps` radii) with the part inside the hub removed. */
function expectedVolume(p: PropParams, steps = 400): number {
  const { r0, R, hubR } = bladeSpan(p);
  const hub = Math.PI * hubR * hubR * p.hubLength - Math.PI * (p.boreDia / 2) ** 2 * p.hubLength;
  let blade = 0;
  for (let i = 0; i < steps; i++) {
    const r = r0 + ((R - r0) * (i + 0.5)) / steps;
    const poly = outline(p, r);
    const a = polyArea(poly);
    const inside = r < hubR ? polyArea(clipRect(poly, Math.sqrt(hubR * hubR - r * r), p.hubLength / 2)) : 0;
    blade += (a - inside) * ((R - r0) / steps);
  }
  return hub + p.blades * blade;
}

/** Chord angle of a built section: the line between the two points of the section loop that are furthest apart (nose and trailing edge). */
async function builtAngle(s: Session, r: number): Promise<number> {
  const sec = await s.section({ origin: [r, 0, 0], normal: [1, 0, 0] });
  const pts = sec.loops.flatMap((l) => l.pts as number[][]);
  let best = 0, ang = 0;
  for (const a of pts) for (const b of pts) { const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (d > best) { best = d; ang = (Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180) / Math.PI; } }
  return ang;
}

describe('propeller against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('(d) the default propeller builds: no errors, one solid, valid, tip radius and hub where they should be; (a) pitch law in the built sections', async () => {
    const p = P({ blades: 2 });
    const b = await build(p);
    expect(b.rep.regen.errors).toEqual([]);
    expect(b.facts.solids).toBe(1);
    // the kernel's default tolerance flags a 2.6e-4 mm pcurve deviation on the blade / hub intersection edges; at 1e-3 mm the solid is valid
    const v = await b.s.validate(1e-3);
    expect(v.ok, JSON.stringify(v.issues)).toBe(true);
    const box = b.facts.box!;
    expect(box.max[0]).toBeCloseTo(60, 3); expect(box.min[0]).toBeCloseTo(-60, 3);
    expect(Math.abs(box.max[1])).toBeLessThan(12.1);   // two blades along x: only the section depth in y
    // (a) the section angle against atan(P / 2 pi r), at the built stations outside the hub and at radii between stations
    const stations = sectionRadii(p).filter((r) => r > 13);
    const errs: number[] = [];
    for (const r of stations) {
      const want = (Math.atan(p.pitch / (2 * Math.PI * r)) * 180) / Math.PI;
      const got = await builtAngle(b.s, r);
      errs.push(Math.abs(got - want));
      expect(Math.abs(got - want), `station r=${r}: built ${got} want ${want}`).toBeLessThan(0.5);
    }
    const between: number[] = [];
    for (const r of [20, 33, 47, 55]) {
      const want = (Math.atan(p.pitch / (2 * Math.PI * r)) * 180) / Math.PI;
      const got = await builtAngle(b.s, r);
      between.push(Math.abs(got - want));
      expect(Math.abs(got - want), `between stations r=${r}: built ${got} want ${want}`).toBeLessThan(2);
    }
    console.log('PROP pitch-angle error deg: stations max', Math.max(...errs).toFixed(3), 'between stations max', Math.max(...between).toFixed(3), 'build ms', b.ms);
  }, 300000);

  it('(a) the angle also follows the linear twist and the angle mode', async () => {
    const p = P({ blades: 2, twist: 'linear', rootAngle: 45, tipAngle: 15, sections: 6 });
    const b = await build(p);
    expect(b.rep.regen.errors).toEqual([]);
    for (const r of sectionRadii(p).filter((x) => x > 13)) {
      const want = 45 + (15 - 45) * ((r - bladeSpan(p).r0) / (60 - bladeSpan(p).r0));
      expect(Math.abs((await builtAngle(b.s, r)) - want), `r=${r}`).toBeLessThan(0.5);
    }
  }, 300000);

  it('(b) N = 2..6 blades: the centre of gravity is on the axis within 1e-3 mm', async () => {
    const worst: number[] = [];
    for (const n of [2, 3, 4, 5, 6]) {
      const b = await build(P({ blades: n, chordRoot: 12, chordMid: 14, chordTip: 7, sections: 6 }));
      expect(b.rep.regen.errors, `N=${n}`).toEqual([]);
      const off = Math.hypot(b.com[0], b.com[1]);
      worst.push(off);
      expect(off, `N=${n} CoG off axis ${off}`).toBeLessThan(1e-3);
    }
    console.log('PROP CoG off-axis mm for N=2..6', worst.map((w) => w.toExponential(2)).join(' '));
  }, 600000);

  it('(c) volume against the numerical integral of the section areas', async () => {
    const rows: string[] = [];
    for (const [name, p] of [['default', P()], ['arc12', P({ airfoil: 'arc', sections: 12, blades: 4, chordRoot: 14, chordMid: 16 })], ['sec5', P({ sections: 5, blades: 2 })]] as Array<[string, PropParams]>) {
      const b = await build(p);
      expect(b.rep.regen.errors, name).toEqual([]);
      const want = expectedVolume(p);
      const rel = (b.vol - want) / want;
      rows.push(`${name} built ${b.vol.toFixed(1)} integral ${want.toFixed(1)} rel ${(100 * rel).toFixed(2)}%`);
      // The tolerance is 2 %: the probe saw the kernel loft 1.5-1.7 % above the polyline section integral because the splines bulge between the sampled
      // points and the loft interpolates between stations; this integral uses the same polyline outlines, so the same gap is allowed.
      expect(Math.abs(rel), name).toBeLessThan(0.02);
    }
    console.log('PROP volume vs integral:', rows.join(' | '));
  }, 600000);

  it('(e) STEP round trip keeps the volume and the solid count', async () => {
    const b = await build(P({ blades: 3, sections: 6 }));
    const step = await b.s.step('prop');
    expect(step).toMatch(/ISO-10303-21/);
    const s2 = await Session.open(); sessions.push(s2);
    const rep = await s2.importStep(step, 'prop');
    expect(JSON.stringify(rep)).not.toMatch(/"ok":false/);
    const m2 = (await sessionQuery<{ volume: number; bodies?: unknown[] }>(s2, { type: 'massProps', tag: 'imp', bodies: true }))!;
    const rel = Math.abs(m2.volume - b.vol) / b.vol;
    console.log('PROP STEP round trip volume', b.vol.toFixed(2), '->', m2.volume.toFixed(2), 'rel', rel.toExponential(2), 'bodies', m2.bodies?.length);
    expect(rel).toBeLessThan(1e-3);
    expect(m2.bodies?.length).toBe(1);
  }, 600000);

  it('(f) ten seeded random parameter sets build or are refused with a structured error; none traps; time per build is bounded', async () => {
    let seed = 20261020;
    const rand = (): number => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const range = (a: number, b: number): number => a + (b - a) * rand();
    const log: string[] = [];
    let built = 0, refused = 0, kernelRefused = 0;
    for (let k = 0; k < 10; k++) {
      const D = range(60, 300);
      const p: PropParams = P({
        diameter: D, hubDia: range(0.1, 0.5) * D, hubLength: range(8, 40), boreDia: rand() < 0.2 ? 0 : range(2, 8), blades: 2 + Math.floor(rand() * 7), sections: 5 + Math.floor(rand() * 8),
        twist: (['pitch', 'angle', 'linear'] as const)[Math.floor(rand() * 3)], pitch: range(0.4, 1.4) * D, pitchAngle: range(8, 35), rootAngle: range(30, 70), tipAngle: range(5, 25),
        chordRoot: range(8, 0.3 * D), chordMid: range(8, 0.3 * D), chordTip: range(3, 0.15 * D), chordExp: range(0.5, 2), thickRoot: range(0.05, 0.25), thickMid: range(0.04, 0.2), thickTip: range(0.03, 0.12),
        airfoil: (['naca4', 'arc', 'plate'] as const)[Math.floor(rand() * 3)], camber: range(0, 0.08), camberPos: range(0.2, 0.7), pivot: range(0.2, 0.6), rake: range(-10, 20), skew: range(-0.1, 0.2) * D,
        direction: rand() < 0.5 ? 'ccw' : 'cw', rootEmbed: range(0.45, 0.8),
      });
      const errs = propErrors(p);
      if (errs.length) {
        refused++;
        expect(() => propDocument(p)).toThrow(PropError);
        expect(errs.every((e) => typeof e.code === 'string' && typeof e.field === 'string' && e.message.length > 0)).toBe(true);
        log.push(`#${k} refused ${errs.map((e) => e.code).join(',')}`);
        continue;
      }
      const t0 = Date.now();
      let res: Awaited<ReturnType<typeof build>>;
      try { res = await build(p); } catch (e) { throw new Error(`#${k} trapped: ${(e as Error).message}\n${JSON.stringify(p)}`); }
      const ms = Date.now() - t0;
      expect(ms, `#${k} took ${ms} ms`).toBeLessThan(120000);
      const errors = res.rep.regen.errors as Array<{ code?: string }>;
      if (errors.length) {
        kernelRefused++;
        expect(errors.every((e) => typeof e.code === 'string' && e.code.length > 0), JSON.stringify(errors)).toBe(true);
        log.push(`#${k} kernel refused ${JSON.stringify(errors).slice(0, 200)} ${JSON.stringify(p)}`);
      } else {
        built++;
        expect(res.vol).toBeGreaterThan(0);
        const off = Math.hypot(res.com[0], res.com[1]);
        // large random designs show up to ~1.6e-3 of the diameter of CoG offset in massProps (the small ones above are 2e-5 mm): bounded relative to the size
        expect(off, `#${k} CoG ${off}`).toBeLessThan(3e-3 * p.diameter);
        const rel = (res.vol - expectedVolume(p, 150)) / expectedVolume(p, 150);
        log.push(`#${k} CoG off ${off.toExponential(2)} mm, volume vs integral ${(100 * rel).toFixed(2)} %, warnings ${validateProp(p).map((i) => i.code).join(',') || '-'}`);
        log.push(`#${k} built ${ms} ms vol ${res.vol.toFixed(0)} N=${p.blades} sec=${p.sections} ${p.airfoil} ${p.twist} ${p.direction}`);
      }
      await res.s.close();
    }
    console.log('PROP sweep:\n' + log.join('\n'));
    console.log(`PROP sweep: built ${built}, refused by validation ${refused}, refused by the kernel ${kernelRefused}`);
    expect(built + refused + kernelRefused).toBe(10);
  }, 1500000);

  it('(g) the chord is finite at the root and inside the hub, and a blade whose root section sits well inside the hub builds (the old script went NaN there)', async () => {
    const p = P({ rootEmbed: 0.4, hubDia: 30, boreDia: 4, chordRoot: 16, chordMid: 20, chordTip: 8, blades: 3, sections: 6 });
    expect(validateProp(p).filter((i) => i.severity === 'error')).toEqual([]);
    const secs = bladeSections(p);
    expect(secs[0].r).toBeCloseTo(6, 9);   // 0.4 of the hub radius: far inside the hub where (r - R0)^1.5 used to be NaN
    for (const s of secs) {
      expect(Number.isFinite(s.chord) && s.chord >= 1).toBe(true);
      expect([...s.upper, ...s.lower].every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))).toBe(true);
    }
    const b = await build(p);
    expect(b.rep.regen.errors).toEqual([]);
    expect(b.vol).toBeGreaterThan(0);
  }, 300000);
});
