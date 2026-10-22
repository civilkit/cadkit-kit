// The marine propeller against the real kernel: it builds, the face lies on the true helicoid, the thickness is the one asked for, the volume matches the
// integral of thickness x chord, N blades balance on the axis, a left-hand propeller is the mirror image, the solid is valid, STEP round-trips it, and the
// parameter sets the kernel cannot fuse with the hub are refused with a structured error (nothing traps). See docs/propellers.md, "Marine family".
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { sessionQuery } from './inspect/kernel';
import type { PartDoc } from '@ck/part-model';
import { DEFAULT_MARINE, MARINE_PRESETS, chordAngle, chordFraction, chordAt, helicoidStations, edgeFraction, foilMean, foilProfile, faceSlopeR, helicoidPoint, hubLengthNeeded, marineDocument, marineErrors, marineSpacings, marineSpan, midAngleAt, pitchAngleAt, thicknessAt, type MarineParams } from './marineData';

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

/** Volume the geometry should have: the hub minus the bore, plus N blades: maximum thickness x developed chord x the mean of the foil profile over the chord, integrated outward from the hub surface. */
function expectedVolume(p: MarineParams, steps = 400): number {
  const { R, hubR } = marineSpan(p);
  const hub = Math.PI * (hubR * hubR - (p.boreDia / 2) ** 2) * p.hubLength;
  let blade = 0;
  for (let i = 0; i < steps; i++) { const r = hubR + ((R - hubR) * (i + 0.5)) / steps; blade += thicknessAt(p, r) * chordAt(p, r) * foilMean(p.maxThickAt, edgeFraction(p, r)) * ((R - hubR) / steps); }
  return hub + p.blades * blade;
}

/** A point of the face at the maximum-thickness chord position near radius r, IN the plane of the nearest section (the blade is the loft through the sections, so it is exactly the sketched profile in
 *  those planes; between planes the loft blends them): the ray whose angle is closest to the maximum-thickness line at r, and the radius along that ray where the chord fraction is `maxThickAt`. */
function maxPoint(p: MarineParams, r: number): { point: number[]; r: number; s: number } {
  const st = helicoidStations(p), want = chordAngle(p, p.maxThickAt, r);
  let k = 0; st.phi.forEach((x, i) => { if (Math.abs(x - want) < Math.abs(st.phi[k] - want)) k = i; });
  const phi = st.phi[k];
  let best = r, bd = Infinity;
  for (let i = 0; i <= 400; i++) { const rr = Math.max(st.rA[k] + 1, Math.min(st.rB[k] - 1, r - 12 + (24 * i) / 400)); const d = Math.abs(chordFraction(p, phi, rr) - p.maxThickAt); if (d < bd) { bd = d; best = rr; } }
  return { point: helicoidPoint(p, phi, best), r: best, s: chordFraction(p, phi, best) };
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

  it('the maximum thickness normal to the face, probed at the maximum-thickness chord position, is the one asked for at root, middle and tip within 3 %', async () => {
    const p = P();
    const b = await build(p);
    for (const r0 of [40, 75, 110]) {
      const m = maxPoint(p, r0), q = m.point, r = m.r;
      expect(Math.abs(m.s - p.maxThickAt)).toBeLessThan(0.02);
      const a = await b.s.thicknessAt({ point: [q[0], q[1], q[2]] }) as { result: { thickness: number } };
      const want = thicknessAt(p, r);
      console.log(`MARINE thickness r ${r}: want ${want.toFixed(2)} got ${a.result.thickness.toFixed(2)}`);
      expect(Math.abs(a.result.thickness - want) / want, `r ${r}`).toBeLessThan(0.03);
    }
  }, 600000);

  it('the thickness follows the foil profile along the chord (in the planes of the sections, where the blade is exactly the sketched profile): within 15 % (or 0.1 mm) of the profile times the maximum thickness, also 0.3 mm from the leading and trailing edge ends of the rays; the edges stay thicker than 0.25 mm', async () => {
    const p = P();
    const b = await build(p);
    const st = helicoidStations(p);
    const rows: string[] = [];
    const bad: string[] = [];
    for (const k of [Math.floor(st.phi.length * 0.3), Math.floor(st.phi.length * 0.5), Math.floor(st.phi.length * 0.7)]) {
      const phi = st.phi[k], ra = st.rA[k], rb = st.rB[k];
      const rs = [0.15, 0.3, 0.5, 0.7, 0.85].map((u) => ra + (rb - ra) * u);
      // the ends that lie on the leading or trailing edge (chord fraction 0 or 1): 0.3 mm inside the end
      for (const [re, dir] of [[ra, 1], [rb, -1]] as const) { const sE = chordFraction(p, phi, re); if (sE < 0.01 || sE > 0.99) rs.push(re + dir * 0.3); }
      for (const r of rs) {
        const q = helicoidPoint(p, phi, r);
        const a = await b.s.thicknessAt({ point: [q[0], q[1], q[2]] }) as { result: { thickness: number } };
        const sr = chordFraction(p, phi, r), want = thicknessAt(p, r) * foilProfile(p.maxThickAt, edgeFraction(p, r), sr);
        rows.push(`ray${k} r${r.toFixed(1)} s${sr.toFixed(2)} ${a.result.thickness.toFixed(2)}/${want.toFixed(2)}`);
        if (Math.abs(a.result.thickness - want) >= Math.max(0.15 * want, 0.1) || a.result.thickness <= 0.25) bad.push(rows[rows.length - 1]);
      }
    }
    console.log('MARINE foil thickness got/want:', rows.join(' | '));
    expect(bad).toEqual([]);
  }, 600000);

  it('the volume matches hub + N x the integral of maximum thickness x chord x mean foil profile within 2 %', async () => {
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

/** Rake and progressive pitch. The hub is made long enough for the root of each (hubLengthNeeded). */
const fit = (o: Partial<MarineParams>): MarineParams => { const p = P(o); return { ...p, hubLength: Math.max(p.hubLength, Math.ceil(hubLengthNeeded(p)) + 1) }; };
const MILD = { rake: 12, pitchProgress: 0.2 } as const;
const STRONG = { rake: 20, pitchProgress: 0.3 } as const;
const FORWARD = { rake: -15, pitchProgress: -0.15 } as const;

/** hub + N x integral of thickness x developed area: the surface element of a strip of the blade is chord x sqrt(1 + (cos(pitch angle) dz/dr)^2) dr (the face also slopes along r). */
function expectedVolumeSloped(p: MarineParams, steps = 400): { naive: number; sloped: number } {
  const { R, hubR } = marineSpan(p);
  const hub = Math.PI * (hubR * hubR - (p.boreDia / 2) ** 2) * p.hubLength;
  let naive = 0, sloped = 0;
  for (let i = 0; i < steps; i++) {
    const r = hubR + ((R - hubR) * (i + 0.5)) / steps, dr = (R - hubR) / steps;
    const base = thicknessAt(p, r) * chordAt(p, r) * foilMean(p.maxThickAt, edgeFraction(p, r)) * dr, c = Math.cos(pitchAngleAt(p, r)), fr = faceSlopeR(p, midAngleAt(p, r));
    naive += base; sloped += base * Math.sqrt(1 + (c * fr) ** 2);
  }
  return { naive: hub + p.blades * naive, sloped: hub + p.blades * sloped };
}

describe('marine propeller with rake and progressive pitch against the real kernel', { skip: !process.env.CK_WASM }, () => {
  it('mild, strong and forward combinations build with no errors as one solid, valid at 1e-3 mm', async () => {
    const rows: string[] = [];
    for (const [name, o] of [['mild', MILD], ['strong', STRONG], ['forward', FORWARD], ['rake only', { rake: 25 }], ['progress only', { pitchProgress: 0.5 }]] as const) {
      const p = fit(o);
      const b = await build(p);
      expect(b.rep.regen.errors, name).toEqual([]);
      expect(b.solids, name).toBe(1);
      const v = await b.s.validate(1e-3);
      expect(v.ok, `${name} ${JSON.stringify(v.issues)}`).toBe(true);
      rows.push(`${name} ${b.ms} ms hub ${p.hubLength}`);
    }
    console.log('MARINE rake/progress builds:', rows.join(' | '));
  }, 900000);

  it('the face lies on the intended surface: sampled points of z = P(r) phi / 2 pi + tan(rake) (r - hubR) are within 0.05 mm of the built solid', async () => {
    const rows: string[] = [];
    for (const [name, o] of [['strong', STRONG], ['forward', FORWARD]] as const) {
      const p = fit(o);
      const b = await build(p);
      const pts: number[][] = [];
      for (const r of [35, 60, 90, 115]) for (const f of [-0.3, 0, 0.3]) pts.push(helicoidPoint(p, midAngleAt(p, r) + f * 0.1, r));
      const rep = await b.s.closestPoint(pts) as { results: Array<{ nearest: { distance: number } }> };
      const worst = Math.max(...rep.results.map((x) => x.nearest.distance));
      rows.push(`${name} worst of ${pts.length}: ${worst.toExponential(2)} mm`);
      expect(worst, name).toBeLessThan(0.05);
    }
    console.log('MARINE rake/progress face deviation:', rows.join(' | '));
  }, 900000);

  it('the maximum thickness (probed at the maximum-thickness position) is the one asked for at three radii within 3 %', async () => {
    const rows: string[] = [];
    for (const [name, o] of [['mild', MILD], ['strong', STRONG], ['forward', FORWARD]] as const) {
      const p = fit(o);
      const b = await build(p);
      for (const r0 of [40, 75, 110]) {
        const m = maxPoint(p, r0), q = m.point, r = m.r;
        const a = await b.s.thicknessAt({ point: [q[0], q[1], q[2]] }) as { result: { thickness: number } };
        const want = thicknessAt(p, r);
        rows.push(`${name} r${r} ${a.result.thickness.toFixed(2)}/${want.toFixed(2)}`);
        expect(Math.abs(a.result.thickness - want) / want, `${name} r ${r}`).toBeLessThan(0.03);
      }
    }
    console.log('MARINE rake/progress thickness got/want:', rows.join(' | '));
  }, 900000);

  it('the volume matches hub + N x the integral of maximum thickness x developed area x mean foil profile within 2 % (the plain integral is logged too)', async () => {
    const rows: string[] = [];
    for (const [name, o] of [['mild', MILD], ['strong', STRONG], ['forward', FORWARD], ['4 blades strong', { ...STRONG, blades: 4, ear: 0.7, hubLength: 130 }]] as const) {
      const p = fit(o);
      const b = await build(p);
      expect(b.rep.regen.errors, name).toEqual([]);
      const w = expectedVolumeSloped(p);
      const rs = (b.vol - w.sloped) / w.sloped, rn = (b.vol - w.naive) / w.naive;
      rows.push(`${name} built ${b.vol.toFixed(0)} area-corrected ${(100 * rs).toFixed(2)}% plain ${(100 * rn).toFixed(2)}%`);
      expect(Math.abs(rs), name).toBeLessThan(0.02);
    }
    console.log('MARINE rake/progress volume:', rows.join(' | '));
  }, 900000);

  it('centre of gravity on the axis within 0.01 mm for 3 and 5 blades', async () => {
    const rows: string[] = [];
    for (const o of [{ ...STRONG }, { ...FORWARD, blades: 5, ear: 0.8, rootRatio: 0.4, skew: 25, hubLength: 140 }]) {
      const p = fit(o);
      const b = await build(p);
      expect(b.rep.regen.errors, `N=${p.blades}`).toEqual([]);
      const off = Math.hypot(b.com[0], b.com[1]);
      rows.push(`N=${p.blades} CoG off axis ${off.toExponential(2)} mm`);
      expect(off).toBeLessThan(0.01);
    }
    console.log('MARINE rake/progress CoG:', rows.join(' | '));
  }, 900000);

  it('a left-hand propeller with rake and progressive pitch is the mirror image: same volume and axial centre of gravity', async () => {
    const rh = await build(fit(STRONG)), lh = await build(fit({ ...STRONG, direction: 'lh' }));
    expect(lh.rep.regen.errors).toEqual([]);
    expect(Math.abs(lh.vol - rh.vol) / rh.vol).toBeLessThan(1e-6);
    expect(Math.abs(lh.com[2] - rh.com[2])).toBeLessThan(1e-6);
  }, 600000);

  it('STEP round trip keeps the volume and the solid count', async () => {
    const b = await build(fit(STRONG));
    const step = await b.s.step('prop');
    const s2 = await Session.open(); sessions.push(s2);
    const rep = await s2.importStep(step, 'prop');
    expect(JSON.stringify(rep)).not.toMatch(/"ok":false/);
    const m2 = (await sessionQuery<{ volume: number; bodies?: unknown[] }>(s2, { type: 'massProps', tag: 'imp', bodies: true }))!;
    const rel = Math.abs(m2.volume - b.vol) / b.vol;
    console.log('MARINE rake/progress STEP round trip', b.vol.toFixed(2), '->', m2.volume.toFixed(2), 'rel', rel.toExponential(2));
    expect(rel).toBeLessThan(1e-3);
    expect(m2.bodies?.length).toBe(1);
  }, 600000);

  it('sweep: every rake x progressive pitch combination either builds or is refused with a structured booleanFailed and a hint; the section spacings the wizard retries are tried in order; the table is logged', async () => {
    const rakes = [-20, 0, 15, 30], progs = [-0.15, 0, 0.25, 0.5];
    const bases: Array<[string, Partial<MarineParams>]> = [['outboard3', {}], ['inboard4', MARINE_PRESETS.inboard4], ['quiet5', MARINE_PRESETS.quiet5]];
    const cases: Array<{ base: string; o: Partial<MarineParams> }> = [];
    for (const rake of rakes) for (const pitchProgress of progs) cases.push({ base: 'outboard3', o: { rake, pitchProgress } });
    for (const [base, bo] of bases.slice(1)) for (const o of [{ rake: 12, pitchProgress: 0.2 }, { rake: -8, pitchProgress: -0.1 }, { rake: 25, pitchProgress: 0.4 }]) cases.push({ base, o: { ...bo, ...o } });
    const rows: string[] = [];
    let built = 0, firstTry = 0, refused = 0;
    for (const c of cases) {
      const p = fit(c.o);
      expect(marineErrors(p), JSON.stringify(c)).toEqual([]);
      const tries: string[] = [];
      let ok = false, ms = 0;
      for (const sp of marineSpacings(p.raySpacing)) {
        const t0 = Date.now();
        const b = await build({ ...p, raySpacing: sp });
        ms += Date.now() - t0;
        const errs = b.rep.regen.errors as Array<[string, { code: string; params?: { hint?: string } }]>;
        if (!errs.length) { expect(b.solids).toBe(1); tries.push(`${sp}:ok`); ok = true; break; }
        // a refusal is structured: booleanFailed with a hint, never a trap
        expect(errs[0][1].code, JSON.stringify(c)).toBe('booleanFailed');
        expect(errs[0][1].params?.hint, JSON.stringify(c)).toBeTruthy();
        tries.push(`${sp}:booleanFailed`);
      }
      if (ok) { built++; if (tries.length === 1) firstTry++; } else refused++;
      rows.push(`${c.base} rake ${c.o.rake} pp ${c.o.pitchProgress}: ${tries.join(' ')} (${ms} ms)`);
    }
    console.log(`MARINE sweep ${cases.length} cases: built ${built} (first spacing ${firstTry}), refused at every spacing ${refused}\n` + rows.join('\n'));
    expect(built + refused).toBe(cases.length);
    expect(built / cases.length).toBeGreaterThan(0.8);
  }, 3000000);
});
