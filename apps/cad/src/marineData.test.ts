import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MARINE, MarineError, chordAt, chordMax, edgeAngles, helicoidPoint, helicoidStations, hubLengthNeeded, marineDocument, marineErrors, marineFeatures, marineReadout, marineRoles,
  marineSpan, midAngleAt, pitchAngleAt, rayInterval, thicknessAt, validateMarine, marineOps, marinePlan, marineOwner, readMarine, type MarineParams,
} from './marineData';
import { DEFAULT_PROP, propFeatures, readProp, rolesFor } from './propData';

const P = (o: Partial<MarineParams> = {}): MarineParams => ({ ...DEFAULT_MARINE, ...o });
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
    expect(chordAt(p, 125)).toBeCloseTo(chordMax(p) * p.tipRatio, 9);
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
      // the back is above the face by the axial thickness at the ends
      const h0 = s.points.find((q: { id: string }) => q.id === 'h0');
      expect(h0.x - b.x).toBeCloseTo(thicknessAt(p, st.rB[i]) / Math.cos(pitchAngleAt(p, st.rB[i])), 4);
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
