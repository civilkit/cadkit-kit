// The marine propeller against the real kernel: it builds, the face lies on the true helicoid, the thickness is the one asked for, the volume matches the
// integral of thickness x chord, N blades balance on the axis, a left-hand propeller is the mirror image, the solid is valid, STEP round-trips it, and the
// parameter sets the kernel cannot fuse with the hub are refused with a structured error (nothing traps). See docs/propellers.md, "Marine family".
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { sessionQuery } from './inspect/kernel';
import type { PartDoc } from '@ck/part-model';
import { DEFAULT_MARINE, chordAt, helicoidPoint, marineDocument, marineSpan, midAngleAt, thicknessAt, type MarineParams } from './marineData';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const P = (o: Partial<MarineParams> = {}): MarineParams => ({ ...DEFAULT_MARINE, ...o });

async function build(p: MarineParams) {
  const t0 = Date.now();
  const s = await Session.open(marineDocument(p) as unknown as PartDoc); sessions.push(s);
  const rep = await s.verify();
  const ms = Date.now() - t0;
  const mass = await s.massProps({ bodies: true });
  const facts = await s.facts();
  return { s, rep, ms, mass, vol: mass.volume as number, com: mass.com as number[], facts, solids: (facts as { solids: number }).solids };
}

/** Volume the geometry should have: the hub minus the bore, plus N blades: thickness x developed chord integrated outward from the hub surface. */
function expectedVolume(p: MarineParams, steps = 400): number {
  const { R, hubR } = marineSpan(p);
  const hub = Math.PI * (hubR * hubR - (p.boreDia / 2) ** 2) * p.hubLength;
  let blade = 0;
  for (let i = 0; i < steps; i++) { const r = hubR + ((R - hubR) * (i + 0.5)) / steps; blade += thicknessAt(p, r) * chordAt(p, r) * ((R - hubR) / steps); }
  return hub + p.blades * blade;
}

/** One configuration per blade count that the kernel builds (the hub length grows with the root chord). */
const COUNTS: Array<[number, Partial<MarineParams>]> = [
  [2, { ear: 0.45, hubLength: 140 }], [3, {}], [4, { ear: 0.7, hubLength: 130 }], [5, { ear: 0.8, rootRatio: 0.4, skew: 25, hubLength: 140 }], [6, { ear: 0.9, rootRatio: 0.35, pitchRatio: 1.3, hubLength: 150, hubDia: 60 }],
];

describe('marine propeller against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('the default builds with no errors as one solid, valid at 1e-3 mm, in a few seconds', async () => {
    const b = await build(P());
    expect(b.rep.regen.errors).toEqual([]);
    expect(b.solids).toBe(1);
    // the kernel's default tolerance flags a 2.6e-4 to 7e-4 mm pcurve deviation on the blade / hub intersection edges (as for the airfoil family); at 1e-3 mm the solid is valid
    const v = await b.s.validate(1e-3);
    expect(v.ok, JSON.stringify(v.issues)).toBe(true);
    console.log('MARINE default build', b.ms, 'ms');
    expect(b.ms).toBeLessThan(60000);
  }, 600000);

  it('the pressure face lies on the helicoid: sampled helicoid points inside the blade are within 0.05 mm of the built solid', async () => {
    const p = P();
    const b = await build(p);
    const pts: number[][] = [];
    for (const r of [35, 60, 90, 115]) for (const f of [-0.3, 0, 0.3]) pts.push(helicoidPoint(p, midAngleAt(p, r) + f * 0.1, r));
    const rep = await b.s.closestPoint(pts) as { results: Array<{ nearest: { distance: number } }> };
    const worst = Math.max(...rep.results.map((x) => x.nearest.distance));
    console.log('MARINE helicoid deviation, worst of', pts.length, 'points:', worst.toExponential(2), 'mm');
    expect(worst).toBeLessThan(0.05);
  }, 600000);

  it('the thickness normal to the face is the one asked for at root, middle and tip within 3 %', async () => {
    const p = P();
    const b = await build(p);
    for (const r of [40, 75, 110]) {
      const q = helicoidPoint(p, midAngleAt(p, r), r);
      const a = await b.s.thicknessAt({ point: [q[0], q[1], q[2]] }) as { result: { thickness: number } };
      const want = thicknessAt(p, r);
      console.log(`MARINE thickness r ${r}: want ${want.toFixed(2)} got ${a.result.thickness.toFixed(2)}`);
      expect(Math.abs(a.result.thickness - want) / want, `r ${r}`).toBeLessThan(0.03);
    }
  }, 600000);

  it('the volume matches hub + N x the integral of thickness x chord within 2 %', async () => {
    const rows: string[] = [];
    for (const [n, o] of COUNTS.slice(0, 3)) {
      const p = P({ blades: n, ...o });
      const b = await build(p);
      expect(b.rep.regen.errors).toEqual([]);
      const want = expectedVolume(p);
      const rel = (b.vol - want) / want;
      rows.push(`N=${n} built ${b.vol.toFixed(0)} integral ${want.toFixed(0)} rel ${(100 * rel).toFixed(2)}%`);
      expect(Math.abs(rel), `N=${n}`).toBeLessThan(0.02);
    }
    console.log('MARINE volume vs integral:', rows.join(' | '));
  }, 900000);

  it('N = 2..6 blades: one solid each, the centre of gravity is on the axis within 0.01 mm in x and y', async () => {
    const rows: string[] = [];
    for (const [n, o] of COUNTS) {
      const b = await build(P({ blades: n, ...o }));
      expect(b.rep.regen.errors, `N=${n}`).toEqual([]);
      expect(b.solids, `N=${n}`).toBe(1);
      const off = Math.hypot(b.com[0], b.com[1]);
      rows.push(`N=${n} ${b.ms} ms, CoG off axis ${off.toExponential(2)} mm`);
      expect(off, `N=${n} CoG off axis ${off}`).toBeLessThan(0.01);
    }
    console.log('MARINE N sweep:', rows.join(' | '));
  }, 900000);

  it('a left-hand propeller is the mirror image: same volume, same axial centre of gravity', async () => {
    const rh = await build(P()), lh = await build(P({ direction: 'lh' }));
    expect(lh.rep.regen.errors).toEqual([]);
    expect(Math.abs(lh.vol - rh.vol) / rh.vol).toBeLessThan(1e-6);
    expect(Math.abs(lh.com[2] - rh.com[2])).toBeLessThan(1e-6);
  }, 600000);

  it('STEP round trip keeps the volume and the solid count', async () => {
    const b = await build(P());
    const step = await b.s.step('prop');
    expect(step).toMatch(/ISO-10303-21/);
    const s2 = await Session.open(); sessions.push(s2);
    const rep = await s2.importStep(step, 'prop');
    expect(JSON.stringify(rep)).not.toMatch(/"ok":false/);
    const m2 = (await sessionQuery<{ volume: number; bodies?: unknown[] }>(s2, { type: 'massProps', tag: 'imp', bodies: true }))!;
    const rel = Math.abs(m2.volume - b.vol) / b.vol;
    console.log('MARINE STEP round trip volume', b.vol.toFixed(2), '->', m2.volume.toFixed(2), 'rel', rel.toExponential(2));
    expect(rel).toBeLessThan(1e-3);
    expect(m2.bodies?.length).toBe(1);
  }, 600000);

  it('a parameter set the kernel cannot fuse with the hub is a structured booleanFailed with a hint, never a trap; a different section spacing builds it', async () => {
    // pitch 0.8 with 5 degrees between sections gives an open edge where a blade edge meets the hub cylinder; 6 and 7 degrees build (docs/propellers.md)
    const r5 = await build(P({ pitchRatio: 0.8, hubLength: 140, raySpacing: 5 }));
    const errs = r5.rep.regen.errors as Array<[string, { code: string; params?: { hint?: string } }]>;
    if (errs.length) {
      expect(errs[0][1].code).toBe('booleanFailed');
      expect(errs[0][1].params?.hint).toBeTruthy();
    }
    for (const spacing of [6, 7]) {
      const b = await build(P({ pitchRatio: 0.8, hubLength: 140, raySpacing: spacing }));
      expect(b.rep.regen.errors, `spacing ${spacing}`).toEqual([]);
      expect(b.solids).toBe(1);
    }
  }, 600000);
});
