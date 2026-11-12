import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARINE, MARINE_SAMPLE, MarineError, axialThickness, faceSlopeR, faceZ, halfWidthAt, marineReadout as readoutOf, marineSpacings, pitchAt, chordAt, chordMax, edgeAngles, helicoidPoint, helicoidStations, hubLengthNeeded, marineDocument, marineErrors, marineFeatures, marineReadout, marineRoles,
  marineSpan, midAngleAt, pitchAngleAt, rayInterval, thicknessAt, validateMarine, BACK_POINTS, EDGE_MIN_MM, backFractions, calmOffsets, chordAngle, chordFraction, edgeFraction, foilMean, foilProfile, thicknessLocal, marineOps, marinePlan, marineOwner, readMarine, marineOthers, sameMarine, freeShaftZ, type MarineParams,
} from './marineData';
import { DEFAULT_PROP, propFeatures, readProp, rolesFor } from './propData';

const P = (o: Partial<MarineParams> = {}): MarineParams => ({ ...DEFAULT_MARINE, ...o });
const zf = faceZ;
const codes = (p: MarineParams): string[] => marineErrors(p).map((i) => i.code);

/** mulberry32, so the random parameter sets are the same every run */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('marine propeller distributions', () => {
  it('the default has no errors', () => {
    expect(marineErrors(P())).toEqual([]);
  });
  it('the widest chord gives the requested expanded area ratio, and the readout integrates it back', () => {
    for (const ear of [0.3, 0.5, 0.8, 1.1]) for (const z of [2, 3, 5]) {
      const p = P({ ear, blades: z });
      expect(marineReadout(p).ear).toBeCloseTo(ear, 2);
    }
  });
  it('the chord is finite and positive from the axis to past the tip, held at the root value inside the hub', () => {
    const p = P();
    for (const r of [0, 1, 10, 20, 25, 60, 124.9, 125, 140, 1e5]) { const c = chordAt(p, r); expect(Number.isFinite(c) && c > 0, `chord ${c} at ${r}`).toBe(true); }
    expect(chordAt(p, 10)).toBeCloseTo(chordAt(p, 25), 9);
    expect(chordAt(p, 25)).toBeCloseTo(chordMax(p) * p.rootRatio, 9);
    expect(chordAt(P({ tipRounding: 0 }), 125)).toBeCloseTo(chordMax(P({ tipRounding: 0 })) * p.tipRatio, 9);
  });
  it('tip rounding closes the chord along an ellipse over the outer fraction of the span; 0 is the square-cut tip; the area ratio still comes out as asked', () => {
    const sq = P({ tipRounding: 0 }), rd = P({ tipRounding: 0.2 });
    const { R, hubR } = marineSpan(rd);
    const at = (x: number): number => hubR + x * (R - hubR);
    // unchanged below the rounded part (the chord max differs a little: same ear, less area to spread), ellipse above it
    expect(chordAt(rd, at(0.7)) / chordMax(rd)).toBeCloseTo(chordAt(sq, at(0.7)) / chordMax(sq), 9);
    const q = (x: number): number => (x - 0.8) / 0.2;
    expect(chordAt(rd, at(0.9)) / chordMax(rd)).toBeCloseTo((chordAt(sq, at(0.9)) / chordMax(sq)) * Math.sqrt(1 - q(0.9) ** 2), 9);
    expect(chordAt(rd, R) / chordMax(rd)).toBeCloseTo(0.05 * (chordAt(sq, R) / chordMax(sq)), 9);   // the 5 % floor
    let prev = Infinity;
    for (let k = 0; k <= 10; k++) { const c = chordAt(rd, at(0.8 + 0.02 * k)); expect(c).toBeLessThanOrEqual(prev + 1e-9); prev = c; }
    for (const tr of [0, 0.1, 0.4]) expect(marineReadout(P({ tipRounding: tr })).ear).toBeCloseTo(0.5, 2);
  });
  it('the foil profile: 1 at the maximum position, the edge fraction at both edges, rising along an ellipse at the nose and falling along a parabola behind the maximum, continuous in value and slope at the maximum', () => {
    for (const m of [0.2, 0.45, 0.7]) for (const e of [0.02, 0.06, 0.3]) {
      expect(foilProfile(m, e, m)).toBeCloseTo(1, 12);
      expect(foilProfile(m, e, 0)).toBeCloseTo(e, 12);
      expect(foilProfile(m, e, 1)).toBeCloseTo(e, 12);
      // nose: e + (1 - e) sqrt(1 - ((m - s) / m)^2); tail: e + (1 - e) (1 - ((s - m) / (1 - m))^2)
      expect(foilProfile(m, e, 0.5 * m)).toBeCloseTo(e + (1 - e) * Math.sqrt(1 - 0.25), 12);
      expect(foilProfile(m, e, m + 0.5 * (1 - m))).toBeCloseTo(e + (1 - e) * 0.75, 12);
      let prev = foilProfile(m, e, 0);
      for (let k = 1; k <= 100; k++) { const v = foilProfile(m, e, (m * k) / 100); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }   // rises to the maximum
      for (let k = 1; k <= 100; k++) { const v = foilProfile(m, e, m + ((1 - m) * k) / 100); expect(v).toBeLessThanOrEqual(prev + 1e-12); prev = v; }   // then falls
      const h = 1e-6;   // equal slopes at the maximum (both ends are flat there)
      expect(Math.abs((foilProfile(m, e, m + h) - 1) / h)).toBeLessThan(1e-3);
      expect(Math.abs((foilProfile(m, e, m - h) - 1) / h)).toBeLessThan(0.2);
      // the mean is the integral of the profile
      let sum = 0; const n = 20000; for (let k = 0; k < n; k++) sum += foilProfile(m, e, (k + 0.5) / n) / n;
      expect(foilMean(m, e)).toBeCloseTo(sum, 4);
    }
    expect(foilProfile(0.45, 0.06, -3)).toBeCloseTo(0.06, 12);   // clamped outside the chord
    expect(foilProfile(0.45, 0.06, 7)).toBeCloseTo(0.06, 12);
  });
  it('the maximum thickness keeps its meaning: thicknessAt is the value at the maximum-thickness position, the edges are thinner by the edge fraction, and the absolute edge thickness is at least 0.3 mm', () => {
    const p = P(), { R, hubR } = marineSpan(p);
    for (const r of [hubR + 5, 0.5 * (R + hubR), R - 2]) {
      const phiMax = chordAngle(p, p.maxThickAt, r);
      expect(chordFraction(p, phiMax, r)).toBeCloseTo(p.maxThickAt, 12);
      expect(thicknessLocal(p, phiMax, r)).toBeCloseTo(thicknessAt(p, r), 9);
      const [le, te] = edgeAngles(p, r);
      expect(thicknessLocal(p, le, r)).toBeCloseTo(edgeFraction(p, r) * thicknessAt(p, r), 9);
      expect(thicknessLocal(p, te, r)).toBeCloseTo(edgeFraction(p, r) * thicknessAt(p, r), 9);
      expect(thicknessLocal(p, le, r)).toBeGreaterThanOrEqual(EDGE_MIN_MM - 1e-9);
      expect(thicknessLocal(p, le - 1, r)).toBeCloseTo(thicknessLocal(p, le, r), 12);   // clamped outside the outline
    }
    // the fraction asked holds where the thickness allows it (root: 8.75 mm x 0.06 = 0.53 mm), and the floor takes over at the thin tip (1.25 mm x 0.06 = 0.075 mm < 0.3 mm)
    expect(edgeFraction(p, hubR)).toBeCloseTo(0.06, 12);
    expect(edgeFraction(p, R)).toBeCloseTo(EDGE_MIN_MM / thicknessAt(p, R), 12);
    expect(edgeFraction(P({ thickTip: 0.0005, thickRoot: 0.0005 }), R)).toBe(1);   // thinner than the floor everywhere: no foil
    // edgeThick 0.5 and a very thin foil are still ordered: thickness at the edge never exceeds the maximum
    expect(edgeFraction(P({ edgeThick: 0.5 }), hubR)).toBeLessThanOrEqual(1);
  });
  it('thickness runs linearly from the root value at the hub to the tip value at the tip, held outside', () => {
    const p = P();
    expect(thicknessAt(p, 25)).toBeCloseTo(p.diameter * p.thickRoot, 9);
    expect(thicknessAt(p, 125)).toBeCloseTo(p.diameter * p.thickTip, 9);
    expect(thicknessAt(p, 75)).toBeCloseTo(p.diameter * (p.thickRoot + p.thickTip) / 2, 9);
    expect(thicknessAt(p, 5)).toBeCloseTo(p.diameter * p.thickRoot, 9);
    expect(thicknessAt(p, 500)).toBeCloseTo(p.diameter * p.thickTip, 9);
  });
  it('pitch angle is atan(P / 2 pi r); the skew grows with the square of the span and is zero at the hub', () => {
    const p = P({ pitchRatio: 1.2 });
    for (const r of [20, 50, 100]) expect(pitchAngleAt(p, r)).toBeCloseTo(Math.atan((1.2 * 250) / (2 * Math.PI * r)), 12);
    const { hubR, R } = marineSpan(p);
    expect(midAngleAt(p, hubR)).toBe(0);
    expect(midAngleAt(p, R)).toBeCloseTo((p.skew * Math.PI) / 180, 12);
    expect(midAngleAt(p, (hubR + R) / 2)).toBeCloseTo(((p.skew * Math.PI) / 180) / 4, 12);
  });
  it('the leading edge is below the trailing edge and the blade is wider at the root (in angle) than at the tip', () => {
    const p = P();
    for (const r of [22, 50, 100, 125]) { const [a, b] = edgeAngles(p, r); expect(b).toBeGreaterThan(a); }
    const w = (r: number): number => { const [a, b] = edgeAngles(p, r); return b - a; };
    expect(w(25)).toBeGreaterThan(w(125));
  });
});

describe('marine propeller helicoid stations', () => {
  it('every section lies on the helicoid z = P phi / 2 pi and the whole blade angle range is covered with no gap above the spacing', () => {
    const p = P();
    const st = helicoidStations(p);
    const P0 = p.pitchRatio * p.diameter;
    st.psi.forEach((psi, i) => expect(st.z[i]).toBeCloseTo((P0 * psi) / (2 * Math.PI), 9));   // right hand: psi = phi
    for (let i = 1; i < st.psi.length; i++) expect(st.psi[i] - st.psi[i - 1]).toBeLessThanOrEqual((p.raySpacing * Math.PI) / 180 + 1e-9);
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k <= 80; k++) { const [a, b] = edgeAngles(p, marineSpan(p).r0 + ((marineSpan(p).R - marineSpan(p).r0) * k) / 80); lo = Math.min(lo, a); hi = Math.max(hi, b); }
    expect(st.psi[0] - lo).toBeLessThan((p.raySpacing * Math.PI) / 180);
    expect(hi - st.psi[st.psi.length - 1]).toBeLessThan((p.raySpacing * Math.PI) / 180);
  });
  it('the ends of every ray are on the outline (or on the root and tip radius) and the middle is inside it', () => {
    const p = P();
    const { R, r0 } = marineSpan(p);
    for (const phi of [-0.5, -0.2, 0, 0.2, 0.4]) {
      const iv = rayInterval(p, phi);
      if (!iv) continue;
      const [a, b] = iv;
      const inside = (r: number): number => { const [le, te] = edgeAngles(p, r); return Math.min(phi - le, te - phi); };
      expect(inside(0.5 * (a + b))).toBeGreaterThanOrEqual(0);
      for (const r of [a, b]) expect(Math.abs(inside(r)) < 1e-6 || Math.abs(r - r0) < 1e-9 || Math.abs(r - R) < 1e-9, `end ${r} of the ray at ${phi}`).toBe(true);
    }
    expect(rayInterval(p, 3)).toBeNull();
  });
  it('no ray end lies within 0.6 mm of the hub surface (the kernel boolean fails on a tangent contact)', () => {
    for (const o of [{}, { pitchRatio: 0.8 }, { pitchRatio: 1.5 }, { blades: 5, ear: 0.8 }, { skew: 30 }]) {
      const p = P(o); const { hubR } = marineSpan(p);
      const st = helicoidStations(p);
      st.rA.forEach((a, i) => { expect(Math.abs(a - hubR) >= 0.6 - 1e-9, `rA ${a}`).toBe(true); expect(Math.abs(st.rB[i] - hubR) >= 0.6 - 1e-9, `rB ${st.rB[i]}`).toBe(true); });
    }
  });
  it('a left-hand propeller is the mirror image: the angles and the helicoid points have the opposite sign in y and the same z', () => {
    const rh = helicoidStations(P()), lh = helicoidStations(P({ direction: 'lh' }));
    expect(lh.psi.map((x) => -x)).toEqual(rh.psi);
    const a = helicoidPoint(P(), 0.3, 80), b = helicoidPoint(P({ direction: 'lh' }), 0.3, 80);
    expect(b[0]).toBeCloseTo(a[0], 12); expect(b[1]).toBeCloseTo(-a[1], 12); expect(b[2]).toBeCloseTo(a[2], 12);
  });
  it('a finer spacing gives more sections', () => {
    expect(helicoidStations(P({ raySpacing: 3 })).psi.length).toBeGreaterThan(helicoidStations(P({ raySpacing: 8 })).psi.length);
  });
});

describe('marine propeller validation', () => {
  it('refuses what cannot be built, with a code each', () => {
    expect(codes(P({ blades: 1 }))).toContain('blades');
    expect(codes(P({ blades: 7 }))).toContain('blades');
    expect(codes(P({ blades: 2.5 }))).toContain('blades');
    expect(codes(P({ pitchRatio: 0.2 }))).toContain('pitch');
    expect(codes(P({ ear: 2 }))).toContain('ear');
    expect(codes(P({ ear: 0.1 }))).toContain('ear');
    expect(codes(P({ diameter: 0 }))).toContain('diameter');
    expect(codes(P({ hubDia: 200 }))).toContain('hubDia');
    expect(codes(P({ boreDia: 48 }))).toContain('bore');
    expect(codes(P({ raySpacing: 1 }))).toContain('raySpacing');
    expect(codes(P({ thickTip: 0 }))).toContain('thick');
    expect(codes(P({ rootEmbed: 1.2 }))).toContain('rootEmbed');
    expect(codes(P({ diameter: NaN }))).toContain('notNumber');
  });
  it('a hub too short for the root is an error that names the length needed', () => {
    const p = P({ hubLength: 20 });
    expect(codes(p)).toContain('hubShort');
    const need = hubLengthNeeded(p);
    expect(validateMarine(p).find((i) => i.code === 'hubShort')!.message).toContain(String(Math.round(need * 10) / 10));
    expect(codes(P({ hubLength: Math.ceil(need) + 1 }))).not.toContain('hubShort');
  });
  it('warns, without refusing, on a razor tip and on blades overlapping at the hub', () => {
    const thin = validateMarine(P({ thickTip: 0.001 }));
    expect(thin.find((i) => i.code === 'thinTip')?.level).toBe('warning');
    const wide = validateMarine(P({ blades: 6, ear: 1.1, rootRatio: 1, hubLength: 200 }));
    expect(wide.some((i) => i.code === 'overlap')).toBe(true);
    expect(marineErrors(P({ blades: 6, ear: 1.1, rootRatio: 1, hubLength: 200 })).map((i) => i.code)).not.toContain('overlap');
  });
});

describe('marine propeller features', () => {
  it('the document has unique ids in role order, the record on the hub sketch, and one plane + sketch per section', () => {
    const doc = marineDocument(P()) as { features: Array<Record<string, unknown>>; seq: number };
    const ids = doc.features.map((f) => f.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    const roles = marineRoles(P());
    expect(ids.length).toBe(roles.length);
    expect(doc.seq).toBe(roles.length + 1);
    const hub = doc.features[0] as { prop: { family: string; blades: number; roles: Record<string, number> } };
    expect(hub.prop.family).toBe('marine');
    expect(hub.prop.blades).toBe(3);
    const n = helicoidStations(P()).psi.length;
    expect(doc.features.filter((f) => f.type === 'plane').length).toBe(n);
    expect(doc.features.filter((f) => f.type === 'sketch').length).toBe(n + 2);   // + hub and bore
    const loft = doc.features.find((f) => f.type === 'loft') as { sketches: string[]; op: string };
    expect(loft.op).toBe('add');
    expect(loft.sketches.length).toBe(n);
    const pat = doc.features.find((f) => f.type === 'cpattern') as { count: number; seeds: string[] };
    expect(pat.count).toBe(3);
    expect(pat.seeds).toEqual([(doc.features.find((f) => f.type === 'loft') as { id: string }).id]);
  });
  it('each section sketch is a closed face line, tip end, back spline and root end with the face line at the helicoid height', () => {
    const p = P();
    const st = helicoidStations(p);
    const doc = marineDocument(p) as { features: Array<Record<string, any>> };
    const secs = doc.features.filter((f) => f.type === 'sketch' && String(f.name).startsWith('Blade section'));
    expect(secs.length).toBe(st.psi.length);
    secs.forEach((s, i) => {
      expect(s.entities.map((e: { type: string }) => e.type)).toEqual(['line', 'line', 'spline', 'line']);
      const a = s.points.find((q: { id: string }) => q.id === 'a'), b = s.points.find((q: { id: string }) => q.id === 'b');
      expect(a.x).toBeCloseTo(st.z[i], 5); expect(b.x).toBeCloseTo(st.z[i], 5);
      expect(a.y).toBeCloseTo(st.rA[i], 5); expect(b.y).toBeCloseTo(st.rB[i], 5);
      // the back spline has BACK_POINTS points from the tip end to the root end, an axial offset above the face that is the foil thickness at the two ends (the edges of the blade are thin)
      expect(s.entities[2].pts.length).toBe(BACK_POINTS);
      const h0 = s.points.find((q: { id: string }) => q.id === 'h0'), hl = s.points.find((q: { id: string }) => q.id === 'h' + (BACK_POINTS - 1));
      expect(h0.x - b.x).toBeCloseTo(axialThickness(p, st.phi[i], st.rB[i]), 4);
      expect(hl.x - a.x).toBeCloseTo(axialThickness(p, st.phi[i], st.rA[i]), 4);
      expect(hl.y).toBeCloseTo(st.rA[i], 5); expect(h0.y).toBeCloseTo(st.rB[i], 5);
      for (const q of s.entities[2].pts as string[]) { const h = s.points.find((x: { id: string }) => x.id === q); expect(h.x - zf(p, st.phi[i], h.y)).toBeGreaterThan(0.25); }   // the back never meets the face
    });
  });
  it('the planes go round the shaft axis by the section angle plus 90 degrees', () => {
    const p = P();
    const st = helicoidStations(p);
    const doc = marineDocument(p) as { features: Array<Record<string, any>> };
    const planes = doc.features.filter((f) => f.type === 'plane');
    planes.forEach((pl, i) => { expect(pl.mode).toBe('angle'); expect(pl.axis).toEqual({ kind: 'axis', axis: 'z' }); expect(pl.angle).toBeCloseTo((st.psi[i] * 180) / Math.PI + 90, 4); });
  });
  it('the bore is dropped when it is 0 and a refused parameter set throws MarineError with the issues', () => {
    const doc = marineDocument(P({ boreDia: 0 })) as { features: Array<{ type: string }> };
    expect(doc.features.some((f) => f.type === 'extrude' && (f as { op?: string }).op === 'cut')).toBe(false);
    expect(() => marineDocument(P({ blades: 9 }))).toThrow(MarineError);
  });
  it('seeded hostile parameters never produce NaN in the document: they are either refused or finite everywhere', () => {
    const rand = rng(11);
    let built = 0;
    for (let k = 0; k < 120; k++) {
      const p = P({
        diameter: 20 + 600 * rand(), hubDia: 5 + 150 * rand(), hubLength: 5 + 300 * rand(), boreDia: 20 * rand(), blades: 1 + Math.floor(7 * rand()), pitchRatio: 0.2 + 2 * rand(), ear: 0.1 + 1.3 * rand(),
        peak: rand(), rootRatio: 0.05 + rand(), tipRatio: 0.05 + rand(), skew: 80 * rand() - 20, thickRoot: 0.06 * rand(), thickTip: 0.02 * rand(), rootEmbed: 0.2 + 0.9 * rand(), raySpacing: 2 + 9 * rand(),
        direction: rand() < 0.5 ? 'rh' : 'lh',
      });
      if (marineErrors(p).length) { expect(() => marineDocument(p)).toThrow(MarineError); continue; }
      const json = JSON.stringify(marineFeatures(p, Object.fromEntries(marineRoles(p).map((r, i) => [r, `F${i + 1}`]))));
      expect(json).not.toMatch(/NaN|Infinity|null/);
      built++;
    }
    expect(built).toBeGreaterThan(5);
  });
});

describe('marine propeller edit path', () => {
  const idsOf = (p: MarineParams, from = 1): Record<string, string> => Object.fromEntries(marineRoles(p).map((r, i) => [r, `F${from + i}`]));
  const docOf = (p: MarineParams) => { const d = marineDocument(p) as { features: Array<{ id: string }>; seq: number }; return d; };
  it('the record round-trips; readMarine and readProp each leave the other family alone', () => {
    const p = P({ blades: 4, skew: 22, direction: 'lh' });
    const d = docOf(p);
    const got = readMarine(d.features[0])!;
    expect(got.params).toEqual(p);
    expect(Object.keys(got.roles)).toEqual(marineRoles(p));
    expect(readProp(d.features[0])).toBeNull();
    const airfoil = propFeatures(DEFAULT_PROP, Object.fromEntries(rolesFor(DEFAULT_PROP).map((r, i) => [r, `F${i + 1}`])))[0];
    expect(readMarine(airfoil)).toBeNull();
    expect(readProp(airfoil)).not.toBeNull();
    expect(marineOwner(d.features as unknown[], idsOf(p)['sec3'])?.hubId).toBe('F1');
    expect(marineOwner(d.features as unknown[], 'F9999')).toBeNull();
  });
  it('new propeller: ops add every feature at the end with fresh ids; plan appends them with the next sequence number and no removals', () => {
    const doc = { features: [{ id: 'F1' }, { id: 'F2' }], seq: 3 };
    const ops = marineOps(doc, P());
    expect(ops.every((o) => o.op === 'add')).toBe(true);
    expect(ops.length).toBe(marineRoles(P()).length);
    const plan = marinePlan(doc, P());
    expect(plan.before).toEqual([]);
    expect(plan.patch.append!.length).toBe(ops.length);
    expect((plan.patch.append![0] as { id: string }).id).toBe('F3');
    expect(plan.patch.seq).toBe(3 + ops.length);
  });
  it('same structure: every feature is replaced in place, hub sketch first, ids kept; the plan is one in-place patch', () => {
    const p = P(), d = docOf(p), roles = readMarine(d.features[0])!.roles;
    const next = P({ thickTip: 0.007 });
    expect(helicoidStations(next).psi.length).toBe(helicoidStations(p).psi.length);
    const ops = marineOps(d, next, roles);
    expect(ops.every((o) => o.op === 'replace')).toBe(true);
    expect((ops[0] as { id: string }).id).toBe('F1');
    expect(ops.map((o) => (o as { id: string }).id).sort()).toEqual(d.features.map((f) => f.id).sort());
    const plan = marinePlan(d, next, roles);
    expect(plan.before).toEqual([]);
    expect(plan.patch.append).toBeUndefined();
    expect(Object.keys(plan.patch.features!).length).toBe(d.features.length);
  });
  it('different structure: all old features are removed in reverse document order, then the new ones appended', () => {
    const p = P(), d = docOf(p), roles = readMarine(d.features[0])!.roles;
    const next = P({ ear: 0.7, hubLength: 140 });
    expect(helicoidStations(next).psi.length).not.toBe(helicoidStations(p).psi.length);
    const ops = marineOps(d, next, roles);
    const removes = ops.filter((o) => o.op === 'remove') as Array<{ id: string; cascade?: boolean }>;
    expect(removes.map((o) => o.id)).toEqual(d.features.map((f) => f.id).reverse());
    expect(removes.every((o) => o.cascade)).toBe(true);
    expect(ops.slice(0, removes.length).every((o) => o.op === 'remove')).toBe(true);
    expect(ops.slice(removes.length).every((o) => o.op === 'add')).toBe(true);
    const plan = marinePlan(d, next, roles);
    expect(plan.before.length).toBe(d.features.length);
    expect(plan.patch.append!.length).toBe(marineRoles(next).length);
    // dropping the bore changes the structure too
    expect(marinePlan(d, P({ boreDia: 0 }), roles).before.length).toBe(d.features.length);
  });
  it('refused parameters throw MarineError from both', () => {
    expect(() => marineOps({ features: [] }, P({ blades: 1 }))).toThrow(MarineError);
    expect(() => marinePlan({ features: [] }, P({ blades: 1 }))).toThrow(MarineError);
  });
});

describe('marine propeller: rake and progressive pitch', () => {
  const R0 = (o: Partial<MarineParams>): MarineParams => P(o);
  const combos: Array<Partial<MarineParams>> = [{}, { rake: 15 }, { rake: -12 }, { pitchProgress: 0.3 }, { pitchProgress: -0.15 }, { rake: 20, pitchProgress: 0.3 }, { rake: 30, pitchProgress: 0.5 }, { rake: -20, pitchProgress: -0.15, direction: 'lh' }];

  it('defaults are 0 and 0, and with them the face is the old constant-pitch helicoid exactly', () => {
    expect(DEFAULT_MARINE.rake).toBe(0); expect(DEFAULT_MARINE.pitchProgress).toBe(0);
    const p = P();
    for (const r of [20, 60, 110]) for (const phi of [-0.4, 0, 0.5]) {
      expect(pitchAt(p, r)).toBe(250);
      expect(faceZ(p, phi, r)).toBeCloseTo((250 * phi) / (2 * Math.PI), 12);
      expect(faceSlopeR(p, phi)).toBe(0);
      expect(axialThickness(p, phi, r, false)).toBeCloseTo(thicknessAt(p, r) / Math.cos(pitchAngleAt(p, r)), 12);
    }
  });
  it('pitch is linear in the span fraction: the tip pitch at the tip, more (positive progress) or less at the root, by the fraction asked', () => {
    const { R, hubR } = marineSpan(P());
    for (const pp of [-0.15, -0.1, 0.25, 0.5]) {
      const p = P({ pitchProgress: pp });
      expect(pitchAt(p, R)).toBeCloseTo(250, 9);
      expect(pitchAt(p, hubR)).toBeCloseTo(250 * (1 + pp), 9);
      expect(pitchAt(p, 0.5 * (R + hubR))).toBeCloseTo(250 * (1 + 0.5 * pp), 9);
      expect(pitchAt(p, hubR) > pitchAt(p, R)).toBe(pp > 0);
      // the slope is d(pitch)/dr
      const h = 0.01;
      expect((pitchAt(p, 70 + h) - pitchAt(p, 70 - h)) / (2 * h)).toBeCloseTo(-250 * pp / (R - hubR), 6);
    }
  });
  it('rake adds tan(rake) x (r - hubR) to the face height, zero at the hub surface, and tilts the face in the section plane by tan(rake)', () => {
    const p = P({ rake: 20 }), { hubR } = marineSpan(p);
    expect(faceZ(p, 0, hubR)).toBeCloseTo(0, 12);
    for (const r of [40, 80, 120]) expect(faceZ(p, 0.3, r) - faceZ(P(), 0.3, r)).toBeCloseTo(Math.tan((20 * Math.PI) / 180) * (r - hubR), 9);
    expect(faceSlopeR(p, 0)).toBeCloseTo(Math.tan((20 * Math.PI) / 180), 12);
    // a numeric derivative of the face height along r agrees with the slope
    const q = P({ rake: -10, pitchProgress: 0.4 }), h = 1e-4;
    expect((faceZ(q, 0.35, 80 + h) - faceZ(q, 0.35, 80 - h)) / (2 * h)).toBeCloseTo(faceSlopeR(q, 0.35), 6);
  });
  it('the pitch angle on the face is atan(P(r) / 2 pi r) and the outline width uses it: half angular width = chord cos(local angle) / 2r', () => {
    for (const o of combos) {
      const p = R0(o);
      for (const r of [30, 60, 100]) {
        expect(pitchAngleAt(p, r)).toBeCloseTo(Math.atan(pitchAt(p, r) / (2 * Math.PI * r)), 12);
        expect(halfWidthAt(p, r)).toBeCloseTo((0.5 * chordAt(p, r) * Math.cos(pitchAngleAt(p, r))) / r, 12);
      }
    }
    // progressive pitch narrows the angular width at the root (steeper face), more pitch there means a smaller cos
    expect(halfWidthAt(P({ pitchProgress: 0.5 }), 30)).toBeLessThan(halfWidthAt(P(), 30));
    expect(halfWidthAt(P({ pitchProgress: 0.5 }), 125)).toBeCloseTo(halfWidthAt(P(), 125), 9);   // the tip is untouched
  });
  it('every section lies on the new surface: face ends and the straight face line sit on z = P(r) phi / 2 pi + tan(rake) (r - hubR), and the face line is a line (the law is linear in r)', () => {
    for (const o of combos) {
      const p = R0(o), st = helicoidStations(p);
      const doc = marineDocument(P({ ...o, hubLength: 140 })) as { features: Array<Record<string, any>> };
      const secs = doc.features.filter((f) => f.type === 'sketch' && String(f.name).startsWith('Blade section'));
      expect(secs.length).toBe(st.psi.length);
      secs.forEach((s, i) => {
        const pt = (id: string) => s.points.find((q: { id: string }) => q.id === id);
        expect(pt('a').x).toBeCloseTo(faceZ(p, st.phi[i], st.rA[i]), 5);
        expect(pt('b').x).toBeCloseTo(faceZ(p, st.phi[i], st.rB[i]), 5);
        expect(s.entities[0].type).toBe('line');
        // a mid point of the line is on the surface too
        const rm = 0.5 * (st.rA[i] + st.rB[i]);
        expect(0.5 * (pt('a').x + pt('b').x)).toBeCloseTo(faceZ(p, st.phi[i], rm), 5);
        // the right sign of the direction: the section angle is s x phi
        expect(st.psi[i]).toBeCloseTo((p.direction === 'lh' ? -1 : 1) * st.phi[i], 12);
        // the back sits above the face along all the spline points, by the foil's axial thickness at the ends and never above the full-thickness offset
        s.entities[2].pts.forEach((id: string) => { const h = pt(id); const d = h.x - faceZ(p, st.phi[i], h.y); expect(d).toBeGreaterThan(0); expect(d).toBeLessThan(axialThickness(p, st.phi[i], h.y, false) * 1.2 + 1e-6); });
      });
    }
  });
  it('the axial offset gives the thickness NORMAL to the face: a numeric march along the surface normal to the back meets it at t within 1 %, at several radii and angles', () => {
    for (const o of combos) {
      const p = R0(o);
      for (const r of [35, 60, 90, 120]) for (const phi of [-0.4, 0, 0.4]) {
        // right-hand cartesian field; the left-hand one is its mirror
        const f = (x: number, y: number): number => faceZ(p, Math.atan2(y, x), Math.hypot(x, y));
        const back = (x: number, y: number): number => f(x, y) + axialThickness(p, Math.atan2(y, x), Math.hypot(x, y), false);
        const h = 1e-5, x0 = r * Math.cos(phi), y0 = r * Math.sin(phi), z0 = f(x0, y0);
        const fx = (f(x0 + h, y0) - f(x0 - h, y0)) / (2 * h), fy = (f(x0, y0 + h) - f(x0, y0 - h)) / (2 * h);
        const nn = Math.hypot(fx, fy, 1), n = [-fx / nn, -fy / nn, 1 / nn];
        let lo = 0, hi = 4 * thicknessAt(p, r) + 1;
        for (let k = 0; k < 60; k++) { const m = 0.5 * (lo + hi); if (z0 + m * n[2] - back(x0 + m * n[0], y0 + m * n[1]) < 0) lo = m; else hi = m; }
        const want = thicknessAt(p, r);
        // the constant-pitch case keeps its original first-order offset (0.7 % thin at the root, exact further out)
        expect(Math.abs(lo - want) / want, `${JSON.stringify(o)} r ${r} phi ${phi}: ${lo} vs ${want}`).toBeLessThan(0.01);
      }
    }
  });
  it('sections stay well formed: the back is above the face along the whole spline, the ends are 0.6 mm off the hub surface, and the section count is finite', () => {
    for (const o of combos) {
      const p = R0(o), { hubR } = marineSpan(p);
      const st = helicoidStations(p);
      expect(st.psi.length).toBeGreaterThan(8);
      st.rA.forEach((a, i) => { expect(Math.abs(a - hubR) >= 0.6 - 1e-9).toBe(true); expect(Math.abs(st.rB[i] - hubR) >= 0.6 - 1e-9).toBe(true); expect(axialThickness(p, st.phi[i], a)).toBeGreaterThan(0); });
    }
  });
  it('the hub-length rule follows the root: it is the largest of |face height| inside the hub plus the axial thickness at the embed radius, and building with exactly that length is accepted', () => {
    for (const o of combos) {
      const p = R0(o), { hubR, r0 } = marineSpan(p);
      const need = hubLengthNeeded(p), st = helicoidStations(p);
      let top = 0;
      st.psi.forEach((_x, i) => { if (st.rA[i] > hubR) return; for (let k = 0; k <= 20; k++) { const r = st.rA[i] + ((Math.min(st.rB[i], hubR) - st.rA[i]) * k) / 20; top = Math.max(top, Math.abs(faceZ(p, st.phi[i], r)), faceZ(p, st.phi[i], r) + axialThickness(p, st.phi[i], r)); } });
      expect(need / 2 - 2, JSON.stringify(o)).toBeGreaterThanOrEqual(top - 1e-6);
      expect(codes({ ...p, hubLength: Math.ceil(need) })).not.toContain('hubShort');
      expect(codes({ ...p, hubLength: need - 1 })).toContain('hubShort');
      void r0;
    }
    // progressive pitch makes the root steeper, so it needs a longer hub
    expect(hubLengthNeeded(P({ pitchProgress: 0.5 }))).toBeGreaterThan(hubLengthNeeded(P()));
    expect(hubLengthNeeded(P({ rake: 30 }))).not.toBeCloseTo(hubLengthNeeded(P()), 3);
  });
  it('validation: rake -20..30 and progressive pitch -0.15..0.5, each its own error code; the edges are accepted', () => {
    expect(codes(P({ rake: 31 }))).toContain('rake');
    expect(codes(P({ rake: -21 }))).toContain('rake');
    expect(codes(P({ pitchProgress: 0.51 }))).toContain('pitchProgress');
    expect(codes(P({ pitchProgress: -0.16 }))).toContain('pitchProgress');
    expect(codes(P({ rake: NaN }))).toContain('notNumber');
    expect(codes(P({ pitchProgress: Infinity }))).toContain('notNumber');
    for (const o of [{ rake: -20 }, { rake: 30 }, { pitchProgress: -0.15 }, { pitchProgress: 0.5 }, { rake: 30, pitchProgress: 0.5, hubLength: 140 }]) expect(codes(P(o)).filter((c) => c !== 'hubShort'), JSON.stringify(o)).toEqual([]);
  });
  it('warns on a low pitch at the hub (the hub fuse is touchy there) and on the razor tip, without refusing', () => {
    expect(validateMarine(P({ pitchRatio: 0.9, pitchProgress: -0.15 })).find((i) => i.code === 'rootPitch')?.level).toBe('warning');
    expect(validateMarine(P({ pitchRatio: 0.7 })).some((i) => i.code === 'rootPitch')).toBe(true);
    expect(validateMarine(P()).some((i) => i.code === 'rootPitch')).toBe(false);
    expect(validateMarine(P({ pitchProgress: 0.5 })).some((i) => i.code === 'rootPitch')).toBe(false);
    // a razor tip stays a warning with rake
    expect(validateMarine(P({ rake: 25, thickTip: 0.001 })).find((i) => i.code === 'thinTip')?.level).toBe('warning');
    expect(marineErrors(P({ rake: 25, thickTip: 0.001 })).map((i) => i.code)).not.toContain('thinTip');
  });
  it('the readout shows the tip pitch, the pitch at the hub and the local angles', () => {
    const ro = readoutOf(P({ pitchProgress: 0.3, rake: 10, hubLength: 120 }));
    expect(ro.pitch).toBeCloseTo(250, 9);
    expect(ro.pitchRoot).toBeCloseTo(325, 9);
    expect(ro.rake).toBe(10);
    expect(ro.angleRoot).toBeCloseTo((Math.atan(325 / (2 * Math.PI * 25)) * 180) / Math.PI, 6);
    expect(ro.angleTip).toBeCloseTo((Math.atan(250 / (2 * Math.PI * 125)) * 180) / Math.PI, 6);
  });
  it('the record round-trips with the new fields; an old record without them reads with the defaults filled in and rebuilds the old geometry', () => {
    const p = P({ rake: 12, pitchProgress: 0.25, hubLength: 130 });
    const d = marineDocument(p) as { features: Array<Record<string, any>> };
    expect(readMarine(d.features[0])!.params).toEqual(p);
    expect(d.features[0].prop.rake).toBe(12);
    // an old record: the two fields are missing
    const old = JSON.parse(JSON.stringify(marineDocument(P()))) as { features: Array<Record<string, any>> };
    delete old.features[0].prop.rake; delete old.features[0].prop.pitchProgress;
    const got = readMarine(old.features[0])!;
    expect(got.params.rake).toBe(0); expect(got.params.pitchProgress).toBe(0);
    expect(got.params).toEqual(P());
    expect(JSON.stringify(marineFeatures(got.params, got.roles).slice(1))).toBe(JSON.stringify((marineDocument(P()) as { features: unknown[] }).features.slice(1)));
  });
  it('roles, ops and plan work with the new parameters: same structure replaces in place, a changed section count removes and appends', () => {
    const p = P({ rake: 10, pitchProgress: 0.2, hubLength: 130 }), d = marineDocument(p) as { features: Array<{ id: string }>; seq: number };
    const roles = readMarine(d.features[0])!.roles;
    expect(Object.keys(roles)).toEqual(marineRoles(p));
    const same = P({ ...p, rake: 11 });
    if (helicoidStations(same).psi.length === helicoidStations(p).psi.length) {
      expect(marineOps(d, same, roles).every((o) => o.op === 'replace')).toBe(true);
      expect(marinePlan(d, same, roles).before).toEqual([]);
    }
    const other = P({ ...p, pitchProgress: 0.5, ear: 0.7, hubLength: 150 });
    expect(marinePlan(d, other, roles).patch.append!.length).toBe(marineRoles(other).length);
    expect(() => marineOps(d, P({ rake: 99 }), roles)).toThrow(MarineError);
    expect(marineOwner(d.features as unknown[], roles['sec2'])?.params.rake).toBe(10);
  });
  it('the section spacings the build tries: the requested one first, then 7, 6, 4 and 3 degrees, no repeats', () => {
    expect(marineSpacings(5)).toEqual([5, 7, 6, 4, 3]);
    expect(marineSpacings(7)).toEqual([7, 6, 4, 3]);
    expect(marineSpacings(3)).toEqual([3, 7, 6, 4]);
  });
  it('seeded hostile parameters including rake and progressive pitch: never NaN in the document, refused or finite', () => {
    const rand = rng(23);
    let built = 0;
    for (let k = 0; k < 80; k++) {
      const p = P({ rake: -30 + 70 * rand(), pitchProgress: -0.5 + 1.2 * rand(), pitchRatio: 0.3 + 1.8 * rand(), hubLength: 60 + 200 * rand(), skew: 40 * rand() - 20, direction: rand() < 0.5 ? 'rh' : 'lh' });
      if (marineErrors(p).length) { expect(() => marineDocument(p)).toThrow(MarineError); continue; }
      expect(JSON.stringify(marineFeatures(p, Object.fromEntries(marineRoles(p).map((r, i) => [r, `F${i + 1}`]))))).not.toMatch(/NaN|Infinity|null/);
      built++;
    }
    expect(built).toBeGreaterThan(5);
  });
});

describe('marine propeller: foil sections, tip rounding, smoother outline', () => {
  it('validation: maxThickAt 0.2..0.7, edgeThick 0.02..0.5, tipRounding 0..0.4, each its own code; the limits are accepted', () => {
    expect(codes(P({ maxThickAt: 0.19 }))).toContain('maxThickAt');
    expect(codes(P({ maxThickAt: 0.71 }))).toContain('maxThickAt');
    expect(codes(P({ edgeThick: 0.01 }))).toContain('edgeThick');
    expect(codes(P({ edgeThick: 0 }))).toContain('edgeThick');
    expect(codes(P({ edgeThick: 0.6 }))).toContain('edgeThick');
    expect(codes(P({ tipRounding: -0.01 }))).toContain('tipRounding');
    expect(codes(P({ tipRounding: 0.41 }))).toContain('tipRounding');
    expect(codes(P({ edgeThick: NaN }))).toContain('notNumber');
    expect(codes(P({ maxThickAt: Infinity }))).toContain('notNumber');
    for (const o of [{ maxThickAt: 0.2 }, { maxThickAt: 0.7 }, { edgeThick: 0.02 }, { edgeThick: 0.5 }, { tipRounding: 0 }, { tipRounding: 0.4 }]) expect(codes(P(o)), JSON.stringify(o)).toEqual([]);
  });
  it('defaults: the maximum at 45 % of the chord, edges at 6 % of the maximum, tip rounded over 15 % of the span', () => {
    expect(DEFAULT_MARINE.maxThickAt).toBe(0.45); expect(DEFAULT_MARINE.edgeThick).toBe(0.06); expect(DEFAULT_MARINE.tipRounding).toBe(0.15);
  });
  it('back points are spread over the ray, clustering toward both ends, from 0 to 1', () => {
    const u = backFractions(BACK_POINTS);
    expect(BACK_POINTS).toBeGreaterThanOrEqual(9); expect(BACK_POINTS).toBeLessThanOrEqual(13);
    expect(u[0]).toBe(0); expect(u[u.length - 1]).toBeCloseTo(1, 12);
    for (let k = 1; k < u.length; k++) expect(u[k]).toBeGreaterThan(u[k - 1]);
    expect(u[1] - u[0]).toBeLessThan(1 / (BACK_POINTS - 1));
    expect(u[u.length - 1] - u[u.length - 2]).toBeLessThan(1 / (BACK_POINTS - 1));
  });
  it('the thickness of a section is thin at the edges and fullest at maxThickAt: the offsets of the back spline along a ray that crosses the whole chord rise, peak and fall', () => {
    const p = P(), { hubR, R } = marineSpan(p), r = 0.5 * (hubR + R);
    const [le, te] = edgeAngles(p, r);
    const t = [0, 0.02, 0.1, 0.3, p.maxThickAt, 0.7, 0.9, 0.98, 1].map((s) => thicknessLocal(p, le + s * (te - le), r));
    expect(t[4]).toBe(Math.max(...t));
    for (let k = 1; k <= 4; k++) expect(t[k]).toBeGreaterThan(t[k - 1]);
    for (let k = 5; k < t.length; k++) expect(t[k]).toBeLessThan(t[k - 1]);
    expect(t[0] / t[4]).toBeCloseTo(0.06, 6);
    expect(t[1] / t[4]).toBeGreaterThan(0.2);   // the nose is round: it is 2 % of the chord behind the edge and already more than 20 % thick
  });
  it('calmOffsets leaves a smooth sequence and its end points alone and relaxes a spike', () => {
    const smooth = [1, 1.5, 2.2, 2.9, 3.4, 3.7, 3.8, 3.7, 3.3, 2.6, 1.7];
    expect(calmOffsets(smooth)).toEqual(smooth);
    const spiky = [0.3, 2.4, 0.5, 0.5, 0.5, 2.0, 0.4];
    const c = calmOffsets(spiky);
    expect(c[0]).toBe(0.3); expect(c[c.length - 1]).toBe(0.4);
    expect(Math.max(...c)).toBeLessThan(Math.max(...spiky));
    expect(Math.min(...c)).toBeGreaterThan(0.29);
  });
  it('the section spacing is uniform (extra rays around the rim corners left creases across the face): ordered stations, no gap above the spacing, gaps within a tenth of a spacing of each other', () => {
    for (const o of [{}, { tipRounding: 0 }, { tipRounding: 0.4 }, { blades: 5, ear: 0.8, rootRatio: 0.4, skew: 25 }]) {
      const p = P(o), st = helicoidStations(p);
      expect(p.raySpacing).toBe(3);
      for (let i = 1; i < st.phi.length; i++) { expect(st.phi[i]).toBeGreaterThan(st.phi[i - 1]); expect(st.phi[i] - st.phi[i - 1]).toBeLessThanOrEqual(rad5(p.raySpacing) + 1e-9); }
      const gaps = st.phi.slice(1).map((x, i) => x - st.phi[i]);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(rad5(p.raySpacing) * 0.1 + 1e-9);
    }
  });
  it('the record round-trips with the new fields; an old record without them reads with the new defaults', () => {
    const p = P({ maxThickAt: 0.5, edgeThick: 0.1, tipRounding: 0.25, hubLength: 120 });
    const d = marineDocument(p) as { features: Array<Record<string, any>> };
    expect(readMarine(d.features[0])!.params).toEqual(p);
    expect(d.features[0].prop.maxThickAt).toBe(0.5);
    const old = JSON.parse(JSON.stringify(marineDocument(P()))) as { features: Array<Record<string, any>> };
    delete old.features[0].prop.maxThickAt; delete old.features[0].prop.edgeThick; delete old.features[0].prop.tipRounding;
    const got = readMarine(old.features[0])!;
    expect([got.params.maxThickAt, got.params.edgeThick, got.params.tipRounding]).toEqual([0.45, 0.06, 0.15]);
    expect(marineErrors(got.params)).toEqual([]);
    expect(JSON.stringify(marineFeatures(got.params, got.roles).slice(1))).toBe(JSON.stringify((marineDocument(P()) as { features: unknown[] }).features.slice(1)));
  });
  it('seeded hostile parameters including the new ones: never NaN, refused or finite; the back always above the face', () => {
    const rand = rng(31);
    let built = 0;
    for (let k = 0; k < 80; k++) {
      const p = P({ maxThickAt: 0.1 + 0.7 * rand(), edgeThick: 0.5 * rand(), tipRounding: -0.1 + 0.6 * rand(), rake: -25 + 50 * rand(), pitchProgress: -0.2 + 0.7 * rand(), thickRoot: 0.002 + 0.06 * rand(), thickTip: 0.0005 + 0.02 * rand(), hubLength: 80 + 200 * rand() });
      if (marineErrors(p).length) { expect(() => marineDocument(p)).toThrow(MarineError); continue; }
      const feats = marineFeatures(p, Object.fromEntries(marineRoles(p).map((r, i) => [r, `F${i + 1}`])));
      expect(JSON.stringify(feats)).not.toMatch(/NaN|Infinity|null/);
      for (const f of feats as Array<Record<string, any>>) if (f.type === 'sketch' && String(f.name).startsWith('Blade section')) expect(f.points.filter((q: { id: string }) => /^h\d+$/.test(q.id)).length).toBe(BACK_POINTS);
      built++;
    }
    expect(built).toBeGreaterThan(5);
  });
  it('the axial offset of the foil is positive on every ray of every combination (the Newton factor of the full thickness scales the local offset)', () => {
    for (const o of [{}, { rake: 20, pitchProgress: 0.3 }, { rake: -20, pitchProgress: -0.15 }, { rake: 30, pitchProgress: 0.5, tipRounding: 0.4 }]) {
      const p = P(o), st = helicoidStations(p);
      st.phi.forEach((phi, i) => { for (const u of backFractions(BACK_POINTS)) { const r = st.rB[i] + (st.rA[i] - st.rB[i]) * u; expect(axialThickness(p, phi, r), JSON.stringify(o)).toBeGreaterThan(0.2); } });
    }
  });
});
const rad5 = (d: number): number => (d * Math.PI) / 180;

describe('marine sample', () => {
  it('the shipped marine-propeller.ckpart is what the generator makes from MARINE_SAMPLE (3 blades, mild rake and progressive pitch), valid, with no private paths', () => {
    expect(MARINE_SAMPLE.blades).toBe(3);
    expect(MARINE_SAMPLE.rake).toBeGreaterThan(0); expect(MARINE_SAMPLE.rake).toBeLessThanOrEqual(15);
    expect(MARINE_SAMPLE.pitchProgress).toBeGreaterThan(0); expect(MARINE_SAMPLE.pitchProgress).toBeLessThanOrEqual(0.25);
    expect(marineErrors(MARINE_SAMPLE)).toEqual([]);
    const text = readFileSync('apps/cad/public/samples/marine-propeller.ckpart', 'utf8');
    expect(text).toBe(JSON.stringify(marineDocument(MARINE_SAMPLE, 'Marine propeller')));
    expect(text).not.toMatch(/\/Users\/|\/Volumes\/|\.com|\.au/);
    const idx = JSON.parse(readFileSync('apps/cad/public/samples/index.json', 'utf8')) as Array<{ id: string; file: string }> | { samples: Array<{ id: string; file: string }> };
    const list = Array.isArray(idx) ? idx : idx.samples;
    expect(list.find((x) => x.id === 'marine-propeller')?.file).toBe('marine-propeller.ckpart');
    const allow = JSON.parse(readFileSync('apps/cad/pages-samples.allow.json', 'utf8')) as { samples: string[] };
    expect(allow.samples).toContain('marine-propeller');
  });
});

describe('several marine propellers in one part (kit issue 34)', () => {
  const docWith = (...ps: MarineParams[]) => {
    const features: Array<{ id?: string }> = [];
    for (const p of ps) { const d = marinePlan({ features, seq: 1 + features.length }, p); features.push(...(d.patch.append as Array<{ id?: string }>)); }
    return features;
  };

  it('sameMarine: identical settings at the same position match; another size, direction or position does not; the ray spacing does not count', () => {
    const base = P();
    expect(sameMarine([], base)).toBe(false);
    expect(sameMarine([base], P())).toBe(true);
    expect(sameMarine([base], P({ shaftZ: 0 }))).toBe(true);
    expect(sameMarine([base], P({ raySpacing: 6 }))).toBe(true);
    expect(sameMarine([base], P({ diameter: 200 }))).toBe(false);
    expect(sameMarine([base], P({ direction: 'lh' }))).toBe(false);
    expect(sameMarine([base], P({ shaftZ: 120 }))).toBe(false);
    expect(sameMarine([P({ shaftZ: 120 }), base], P({ shaftZ: 120 }))).toBe(true);
  });

  it('marineOthers reads the settings of the propellers in the document and leaves out the one being edited', () => {
    const feats = docWith(P(), P({ shaftZ: 120, blades: 4 }));
    const all = marineOthers(feats);
    expect(all.length).toBe(2);
    expect(all[1]).toMatchObject({ shaftZ: 120, blades: 4 });
    const hubs = feats.filter((f) => readMarine(f)).map((f) => f.id);
    expect(marineOthers(feats, hubs[0]).map((q) => q.blades)).toEqual([4]);
    expect(sameMarine(marineOthers(feats), P())).toBe(true);
    expect(sameMarine(marineOthers(feats, hubs[0]), P())).toBe(false);
  });

  it('freeShaftZ: 0 when nothing is there; behind an overlapping propeller, one hub length apart; past two in a row', () => {
    expect(freeShaftZ([], P())).toBe(0);
    expect(freeShaftZ([P()], P())).toBe(110);
    expect(freeShaftZ([P(), P({ shaftZ: 110 })], P())).toBe(220);
    expect(freeShaftZ([P({ shaftZ: 500 })], P())).toBe(0);
    expect(freeShaftZ([P({ hubLength: 101 })], P({ hubLength: 50 }))).toBe(76);
  });

  it('a propeller at a position along the shaft: a plane offset by it carries the hub and bore sketches, the section points are raised by it, and the record keeps it', () => {
    const at = P({ shaftZ: 110 });
    expect(marineRoles(at)[0]).toBe('zPlane');
    expect(marineRoles(P())).not.toContain('zPlane');
    const ids = Object.fromEntries(marineRoles(at).map((r, i) => [r, `F${i + 1}`]));
    const f = marineFeatures(at, ids) as Array<Record<string, any>>;
    expect(f[0]).toMatchObject({ type: 'plane', mode: 'offset', offset: 110, base: { kind: 'std', id: 'front' } });
    expect(f[1].plane).toEqual({ kind: 'feature', id: ids.zPlane });
    expect(f.find((x) => x.id === ids.boreSketch)!.plane).toEqual({ kind: 'feature', id: ids.zPlane });
    const oids = Object.fromEntries(marineRoles(P()).map((r, i) => [r, `F${i + 1}`]));
    const o = marineFeatures(P(), oids) as Array<Record<string, any>>;
    const s0 = (x: Array<Record<string, any>>, id: string) => x.find((q) => q.id === id)!.points.find((q: any) => q.id === 'a').x as number;
    expect(s0(f, ids.sec0)).toBeCloseTo(s0(o, oids.sec0) + 110, 4);
    expect(readMarine(f[1])!.params.shaftZ).toBe(110);
  });
});
