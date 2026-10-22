import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPELLER, ImpellerError, hubContour, hubSurface, impellerDocument, impellerErrors, impellerFeatures, impellerOps, impellerOwner, impellerPlan, impellerReadout, impellerRoles, impellerSection, impellerStationsTried, mainStationMs, readImpeller, splitterStationMs, thicknessAt, validateImpeller, type ImpellerParams,
} from './impellerData';

const P = (o: Partial<ImpellerParams> = {}): ImpellerParams => ({ ...DEFAULT_IMPELLER, ...o });
const codes = (p: ImpellerParams): string[] => impellerErrors(p).map((i) => i.code);

/** mulberry32, so the random parameter sets are the same every run */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('impeller geometry', () => {
  it('the default has no errors', () => {
    expect(impellerErrors(P())).toEqual([]);
  });
  it('the hub contour closes on the axis and the surface follows it, continuous at the knee', () => {
    const p = P();
    const c = hubContour(p);
    expect(c[0]).toEqual([0, 0]);
    expect(c[c.length - 1]).toEqual([p.hubLength, 0]);
    const zKnee = p.hubLength * 0.75;
    expect(hubSurface(zKnee, p)).toBeCloseTo(hubSurface(zKnee - 1e-6, p), 5);
    expect(hubSurface(0, p)).toBeCloseTo(p.inducerDiameter / 2, 9);
    expect(hubSurface(p.hubLength, p)).toBeCloseTo(p.exducerDiameter / 2, 9);
  });
  it('thickness runs from the blade value at the inducer radius to the tip value at the exducer radius, held outside', () => {
    const p = P();
    expect(thicknessAt(p.inducerDiameter / 2, p)).toBeCloseTo(p.bladeThickness, 9);
    expect(thicknessAt(p.exducerDiameter / 2, p)).toBeCloseTo(p.tipThickness, 9);
    expect(thicknessAt(0, p)).toBeCloseTo(p.bladeThickness, 9);
    expect(thicknessAt(1e5, p)).toBeCloseTo(p.tipThickness, 9);
  });
  it('every band section is a non-degenerate quad whose psi grows linearly with m, on the plane psi + 90', () => {
    const p = P();
    for (let i = 0; i < p.stations; i++) {
      const m = (i + 0.5) / p.stations;
      const s = impellerSection(m, p);
      expect(s.psiDeg).toBeCloseTo(p.wrapDeg * m, 9);
      expect(s.planeAngleDeg).toBeCloseTo(s.psiDeg + 90, 9);
      const [Hf, Sf, Sb, Hb] = s.quad;
      expect(Math.hypot(Hf[0] - Hb[0], Hf[1] - Hb[1])).toBeGreaterThan(0.3);   // a real band, not a sliver
      expect(Sf[1]).toBeGreaterThan(Hf[1]);
      expect(Hf[1]).toBeLessThan(hubSurface(Hf[0], p));   // the root end sits below the hub surface
    }
  });
  it('a phase offset rotates the section plane only', () => {
    const p = P();
    const a = impellerSection(0.5, p), b = impellerSection(0.5, p, 10);
    expect(b.psiDeg - a.psiDeg).toBeCloseTo(10, 9);
    expect(b.quad).toEqual(a.quad);
  });
  it('stations: more sections, and the splitters take the tail of the list', () => {
    expect(mainStationMs(P({ stations: 16 }))).toHaveLength(16);
    const p = P();
    const split = splitterStationMs(p);
    expect(split.length).toBeLessThan(p.stations);
    split.forEach((m) => expect(m).toBeGreaterThanOrEqual(p.splitterStart));
    expect(impellerStationsTried(13)).toEqual([13, 12, 10, 14]);
  });
});

describe('impeller validation', () => {
  it('refuses what cannot be built, with a code each', () => {
    expect(codes(P({ exducerDiameter: 0 }))).toContain('exducer');
    expect(codes(P({ inducerDiameter: 50 }))).toContain('inducer');
    expect(codes(P({ inducerDiameter: 0 }))).toContain('inducer');
    expect(codes(P({ hubLength: -1 }))).toContain('hubLength');
    expect(codes(P({ boreDiameter: 19 }))).toContain('bore');
    expect(codes(P({ mainBlades: 2 }))).toContain('mainBlades');
    expect(codes(P({ mainBlades: 13 }))).toContain('mainBlades');
    expect(codes(P({ splitterBlades: 9 }))).toContain('splitters');
    expect(codes(P({ splitterStart: 0.9 }))).toContain('splitterStart');
    expect(codes(P({ splitterStart: 0.85, stations: 8 }))).toContain('splitterStart');
    expect(codes(P({ wrapDeg: 10 }))).toContain('wrap');
    expect(codes(P({ wrapDeg: 200 }))).toContain('wrap');
    expect(codes(P({ bladeThickness: 0 }))).toContain('thick');
    expect(codes(P({ tipThickness: 0.1 }))).toContain('tipThick');
    expect(codes(P({ spanZ: 0 }))).toContain('span');
    expect(codes(P({ rootEmbed: 5 }))).toContain('rootEmbed');
    expect(codes(P({ stations: 4 }))).toContain('stations');
    expect(codes(P({ wrapDeg: NaN }))).toContain('notNumber');
  });
  it('warns, without refusing, on a razor tip, an odd station count, a high wrap and a crowded tip ring', () => {
    expect(validateImpeller(P({ tipThickness: 0.3 })).find((i) => i.code === 'thinTip')?.level).toBe('warning');
    expect(validateImpeller(P({ stations: 20 })).find((i) => i.code === 'stationsLoose')?.level).toBe('warning');
    expect(validateImpeller(P({ wrapDeg: 140 })).find((i) => i.code === 'wrapHigh')?.level).toBe('warning');
    expect(validateImpeller(P({ exducerDiameter: 25, mainBlades: 12, splitterBlades: 12, tipThickness: 2 })).some((i) => i.code === 'tight')).toBe(true);
    expect(impellerErrors(P({ tipThickness: 0.3 }))).toEqual([]);
  });
});

describe('impeller features', () => {
  it('the document has unique ids in role order, the record on the hub sketch, and one plane + sketch per main section', () => {
    const doc = impellerDocument(P()) as { features: Array<Record<string, any>>; seq: number };
    const ids = doc.features.map((f) => f.id as string);
    expect(new Set(ids).size).toBe(ids.length);
    const roles = impellerRoles(P());
    expect(ids.length).toBe(roles.length);
    expect(doc.seq).toBe(roles.length + 1);
    const hubSketch = doc.features.find((f) => f.id === 'F2') as { prop: { family: string; mainBlades: number; roles: Record<string, number> } };
    expect(hubSketch.prop.family).toBe('impeller');
    expect(hubSketch.prop.mainBlades).toBe(7);
    expect(doc.features.filter((f) => f.type === 'revolve')).toHaveLength(1);
    expect(doc.features.filter((f) => f.type === 'loft')).toHaveLength(2);   // blade + splitter
    expect(doc.features.filter((f) => f.type === 'cpattern')).toHaveLength(2);
    const blades = doc.features.find((f) => f.name === 'Impeller blades') as { count: number };
    expect(blades.count).toBe(7);
    const splitters = doc.features.find((f) => f.name === 'Impeller splitters') as { count: number };
    expect(splitters.count).toBe(7);
  });
  it('each band section sketch is a closed quadrilateral of four lines, on its angle plane', () => {
    const p = P();
    const doc = impellerDocument(p) as { features: Array<Record<string, any>> };
    const secs = doc.features.filter((f) => f.type === 'sketch' && String(f.name).startsWith('Blade section'));
    expect(secs).toHaveLength(p.stations);
    secs.forEach((s, i) => {
      expect(s.entities.map((e: { type: string }) => e.type)).toEqual(['line', 'line', 'line', 'line']);
      expect(s.points).toHaveLength(4);
      const m = (i + 0.5) / p.stations;
      expect((s.plane as { id: string }).id).toBe(doc.features.find((f) => f.type === 'plane' && f.name === `Blade plane ${i + 1}`)!.id as string);
      const want = impellerSection(m, p);
      expect(s.points[0].x).toBeCloseTo(want.quad[0][0], 5);
      expect(s.points[3].y).toBeCloseTo(want.quad[3][1], 5);
    });
  });
  it('the splitter loft starts at the splitter stations, phased half a pitch between the mains', () => {
    const p = P();
    const doc = impellerDocument(p) as { features: Array<Record<string, any>> };
    const splitSecs = doc.features.filter((f) => f.type === 'sketch' && String(f.name).startsWith('Splitter section'));
    expect(splitSecs).toHaveLength(splitterStationMs(p).length);
    const sPlane = doc.features.find((f) => f.type === 'plane' && f.name === 'Splitter plane 1') as { angle: number };
    expect(sPlane.angle).toBeCloseTo(impellerSection(splitterStationMs(p)[0], p, 180 / p.splitterBlades).planeAngleDeg, 4);
  });
  it('the bore is dropped when it is 0, splitters off leave one loft, and a refused set throws ImpellerError', () => {
    const doc = impellerDocument(P({ boreDiameter: 0 })) as { features: Array<{ type: string }> };
    expect(doc.features.some((f) => f.type === 'extrude' && (f as { op?: string }).op === 'cut')).toBe(false);
    const bare = impellerDocument(P({ splitterBlades: 0 })) as { features: Array<{ type: string }> };
    expect(bare.features.filter((f) => f.type === 'loft')).toHaveLength(1);
    expect(bare.features.filter((f) => f.type === 'cpattern')).toHaveLength(1);
    expect(() => impellerDocument(P({ mainBlades: 1 }))).toThrow(ImpellerError);
  });
  it('seeded hostile parameters never produce NaN in the document: they are either refused or finite everywhere', () => {
    const rand = rng(23);
    let built = 0;
    for (let k = 0; k < 120; k++) {
      const p = P({
        exducerDiameter: 5 + 200 * rand(), inducerDiameter: 2 + 80 * rand(), hubLength: 3 + 80 * rand(), boreDiameter: 30 * rand(),
        mainBlades: 2 + Math.floor(11 * rand()), splitterBlades: Math.floor(13 * rand()), splitterStart: rand(),
        wrapDeg: 10 + 200 * rand(), bladeThickness: 4 * rand(), tipThickness: 1.5 * rand(), spanZ: 3 * rand(), spanR: 8 * rand(),
        rootEmbed: 4 * rand(), stations: 6 + Math.floor(20 * rand()),
      });
      if (impellerErrors(p).length) { expect(() => impellerDocument(p)).toThrow(ImpellerError); continue; }
      const json = JSON.stringify(impellerFeatures(p, Object.fromEntries(impellerRoles(p).map((r, i) => [r, `F${i + 1}`]))));
      expect(json).not.toMatch(/NaN|Infinity|null/);
      built++;
    }
    expect(built).toBeGreaterThan(5);
  });
});

describe('impeller edit path', () => {
  const idsOf = (p: ImpellerParams, from = 1): Record<string, string> => Object.fromEntries(impellerRoles(p).map((r, i) => [r, `F${from + i}`]));
  const docOf = (p: ImpellerParams) => impellerDocument(p) as { features: Array<{ id: string }>; seq: number };
  it('the record round-trips; readImpeller leaves the other families alone; the owner finds any feature', () => {
    const p = P({ mainBlades: 5, splitterBlades: 5, wrapDeg: 90 });
    const d = docOf(p);
    const got = readImpeller(d.features[1])!;
    expect(got.params).toEqual(p);
    expect(Object.keys(got.roles)).toEqual(impellerRoles(p));
    expect(readImpeller({ id: 'X' })).toBeNull();
    expect(readImpeller({ id: 'X', prop: { family: 'marine' } })).toBeNull();
    expect(impellerOwner(d.features as unknown[], got.roles['sec3'])?.hubId).toBe('F2');
    expect(impellerOwner(d.features as unknown[], 'F9999')).toBeNull();
  });
  it('new impeller: ops add every feature at the end with fresh ids; plan appends them with the next sequence number', () => {
    const doc = { features: [{ id: 'F1' }, { id: 'F2' }], seq: 3 };
    const ops = impellerOps(doc, P());
    expect(ops.every((o) => o.op === 'add')).toBe(true);
    expect(ops.length).toBe(impellerRoles(P()).length);
    const plan = impellerPlan(doc, P());
    expect(plan.before).toEqual([]);
    expect(plan.patch.append!.length).toBe(ops.length);
    expect((plan.patch.append![0] as { id: string }).id).toBe('F3');
    expect(plan.patch.seq).toBe(3 + ops.length);
  });
  it('same structure: every feature is replaced in place, hub sketch first, ids kept; the plan is one in-place patch', () => {
    const p = P(), d = docOf(p), roles = readImpeller(d.features[1])!.roles;
    const next = P({ tipThickness: 0.7 });
    const ops = impellerOps(d, next, roles);
    expect(ops.every((o) => o.op === 'replace')).toBe(true);
    expect((ops[0] as { id: string }).id).toBe('F2');   // the hub sketch leads
    expect(ops.map((o) => (o as { id: string }).id).sort()).toEqual(d.features.map((f) => f.id).sort());
    const plan = impellerPlan(d, next, roles);
    expect(plan.before).toEqual([]);
    expect(Object.keys(plan.patch.features!).length).toBe(d.features.length);
  });
  it('different structure: all old features are removed in reverse document order, then the new ones appended', () => {
    const p = P(), d = docOf(p), roles = readImpeller(d.features[1])!.roles;
    const next = P({ stations: 14 });
    const ops = impellerOps(d, next, roles);
    const removes = ops.filter((o) => o.op === 'remove') as Array<{ id: string; cascade?: boolean }>;
    expect(removes.map((o) => o.id)).toEqual(d.features.map((f) => f.id).reverse());
    expect(removes.every((o) => o.cascade)).toBe(true);
    expect(ops.slice(removes.length).every((o) => o.op === 'add')).toBe(true);
    const plan = impellerPlan(d, next, roles);
    expect(plan.before.length).toBe(d.features.length);
    expect(plan.patch.append!.length).toBe(impellerRoles(next).length);
    // dropping the bore and the splitters changes the structure too
    expect(impellerPlan(d, P({ boreDiameter: 0 }), roles).before.length).toBe(d.features.length);
    expect(impellerPlan(d, P({ splitterBlades: 0 }), roles).before.length).toBe(d.features.length);
  });
  it('refused parameters throw ImpellerError from ops, plan and the readout', () => {
    expect(() => impellerOps({ features: [] }, P({ mainBlades: 1 }))).toThrow(ImpellerError);
    expect(() => impellerPlan({ features: [] }, P({ mainBlades: 1 }))).toThrow(ImpellerError);
    expect(impellerReadout(P({ mainBlades: 1 })).issues.some((i) => i.code === 'mainBlades')).toBe(true);
    expect(idsOf(P()).hubSketch).toBe('F2');
  });
});
