import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROP, PROP_PRESETS, PropError, airfoilShape, bladeSections, chordAt, effectivePitch, freePrefix, lawAngle, mergeVariables, propDocument, propErrors, propFeatures, propOps,
  propOwner, propReadout, propVariables, readProp, rolesFor, sectionAngle, sectionAt, sectionRadii, thicknessAt, validateProp, type PropParams,
} from './propData';

const P = (o: Partial<PropParams> = {}): PropParams => ({ ...DEFAULT_PROP, ...o });
const codes = (p: PropParams): string[] => validateProp(p).filter((i) => i.severity === 'error').map((i) => i.code);

/** mulberry32, so the random parameter sets are the same every run */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('propeller distributions', () => {
  it('chord and thickness are finite and positive for every radius, including inside the hub and past the tip (the old NaN at r < R0)', () => {
    const rand = rng(7);
    for (let k = 0; k < 200; k++) {
      const p = P({ chordRoot: 1 + 40 * rand(), chordMid: 1 + 40 * rand(), chordTip: 1 + 40 * rand(), chordExp: 0.2 + 4.8 * rand(), thickRoot: 0.02 + 0.38 * rand(), thickMid: 0.02 + 0.38 * rand(), thickTip: 0.02 + 0.38 * rand(), thickExp: 0.2 + 4.8 * rand() });
      for (const r of [-5, 0, 0.001, 3, 5, 7.2, 11.99, 12, 12.01, 30, 60, 80, 1e6]) {
        const c = chordAt(p, r), t = thicknessAt(p, r);
        expect(Number.isFinite(c) && c >= 1, `chord ${c} at r ${r}`).toBe(true);
        expect(Number.isFinite(t) && t >= 0.02 && t <= 0.4, `thickness ${t} at r ${r}`).toBe(true);
      }
    }
  });
  it('root, mid and tip values are hit where they should be', () => {
    const p = P({ chordRoot: 20, chordMid: 25, chordTip: 8, chordExp: 1 });
    expect(chordAt(p, 12)).toBeCloseTo(20, 9);        // hub surface = s 0
    expect(chordAt(p, 36)).toBeCloseTo(25, 9);        // s 0.5 of 12..60
    expect(chordAt(p, 60)).toBeCloseTo(8, 9);
    expect(chordAt(p, 7)).toBeCloseTo(20, 9);         // inside the hub: held at the root value, not extrapolated
  });
  it('the pitch law: angle = atan(P / 2 pi r); angle mode derives the same law from the angle at the reference radius; linear interpolates', () => {
    const p = P({ pitch: 90 });
    for (const r of [8, 15, 30, 45, 60]) expect(lawAngle(p, r)).toBeCloseTo((Math.atan(90 / (2 * Math.PI * r)) * 180) / Math.PI, 9);
    const a = P({ twist: 'angle', pitchAngle: 20, refRadius: 0.75 });
    expect(lawAngle(a, 45)).toBeCloseTo(20, 9);
    expect(effectivePitch(a)).toBeCloseTo(2 * Math.PI * 45 * Math.tan((20 * Math.PI) / 180), 9);
    const l = P({ twist: 'linear', rootAngle: 50, tipAngle: 10 });
    expect(lawAngle(l, 60)).toBeCloseTo(10, 9);
    expect(lawAngle(l, 7.2)).toBeCloseTo(50, 9);
  });
  it('the section angle is held at 80 degrees near the axis and never NaN', () => {
    const p = P({ pitch: 400 });
    expect(sectionAngle(p, 7.2)).toBe(80);
    expect(Number.isFinite(sectionAngle(p, 0))).toBe(true);
  });
});

describe('airfoil sections', () => {
  it('NACA 4-digit: sharp trailing edge, leading edge at the origin, upper above lower, max thickness where the ratio says', () => {
    const t = 0.12;
    const a = airfoilShape(P({ airfoil: 'naca4', camber: 0 }), t, 60);
    expect(a.upper.x[0]).toBe(0); expect(a.upper.y[0]).toBe(0);
    const n = a.upper.x.length - 1;
    expect(a.upper.x[n]).toBe(1); expect(a.upper.y[n]).toBe(0); expect(a.lower.y[n]).toBe(0);
    let max = 0;
    for (let i = 0; i <= n; i++) max = Math.max(max, a.upper.y[i] - a.lower.y[i]);
    expect(max).toBeGreaterThan(t * 0.98); expect(max).toBeLessThan(t * 1.02);
    expect(a.upper.y.every((y, i) => y >= a.lower.y[i] - 1e-12)).toBe(true);
  });
  it('camber raises the mean line; the arc and plate options are sharp at the trailing edge too', () => {
    const c = airfoilShape(P({ airfoil: 'naca4', camber: 0.06, camberPos: 0.4 }), 0.1, 40);
    const mid = c.upper.y.map((y, i) => (y + c.lower.y[i]) / 2);
    expect(Math.max(...mid)).toBeGreaterThan(0.055); expect(Math.max(...mid)).toBeLessThan(0.065);
    for (const kind of ['arc', 'plate'] as const) {
      const s = airfoilShape(P({ airfoil: kind, camber: 0.05 }), 0.08, 30);
      const n = s.upper.x.length - 1;
      expect(s.upper.y[n]).toBe(0); expect(s.lower.y[n]).toBe(0);
      expect(s.upper.y.every(Number.isFinite) && s.lower.y.every(Number.isFinite)).toBe(true);
    }
  });
  it('a section is finite everywhere, mirrored for a clockwise propeller, and turned by its angle', () => {
    const p = P();
    const s = sectionAt(p, 30);
    expect([...s.upper, ...s.lower].every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))).toBe(true);
    const m = sectionAt(P({ direction: 'cw' }), 30);
    s.upper.forEach((q, i) => { expect(m.upper[i][0]).toBeCloseTo(-q[0], 9); expect(m.upper[i][1]).toBeCloseTo(q[1], 9); });
    // leading edge to trailing edge makes the section angle with the tangential direction
    const n = s.upper.length - 1;
    const ang = (Math.atan2(s.upper[0][1] - s.upper[n][1], s.upper[0][0] - s.upper[n][0]) * 180) / Math.PI;
    expect(Math.abs(ang - s.angle)).toBeLessThan(0.01);
  });
  it('rake moves the sections toward -Z with the radius, skew trails them tangentially', () => {
    const base = sectionAt(P(), 55), raked = sectionAt(P({ rake: 10 }), 55), skewed = sectionAt(P({ skew: 8 }), 60);
    expect(raked.rakeOffset).toBeLessThan(0);
    expect(raked.upper[3][1] - base.upper[3][1]).toBeCloseTo(raked.rakeOffset, 9);
    expect(skewed.skewOffset).toBeCloseTo(8, 9);
  });
  it('section radii run from the root to exactly the tip, strictly increasing, for 5..12 sections', () => {
    for (let n = 5; n <= 12; n++) {
      const r = sectionRadii(P({ sections: n }));
      expect(r.length).toBe(n);
      expect(r[0]).toBeCloseTo(7.2, 9); expect(r[n - 1]).toBe(60);
      r.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(r[i]));
      expect(bladeSections(P({ sections: n })).length).toBe(n);
    }
  });
});

describe('validation', () => {
  it('the defaults and every preset are clean of errors', () => {
    expect(propErrors(P())).toEqual([]);
    for (const [name, preset] of Object.entries(PROP_PRESETS)) expect(propErrors(P(preset)), name).toEqual([]);
  });
  it('a hub as large as the propeller is refused with a message that names both sizes', () => {
    const i = validateProp(P({ hubDia: 130 })).find((x) => x.code === 'hubTooBig')!;
    expect(i.severity).toBe('error'); expect(i.field).toBe('hubDia'); expect(i.message).toMatch(/130/); expect(i.message).toMatch(/120/);
    expect(codes(P({ hubDia: 90 }))).toContain('hubTooBig');   // more than 60 %
  });
  it('catches the other bad inputs by code', () => {
    expect(codes(P({ boreDia: 23 }))).toContain('boreTooBig');
    expect(codes(P({ boreDia: 12, hubDia: 24, rootEmbed: 0.4 }))).toContain('boreReachesBlade');
    expect(codes(P({ blades: 1 }))).toContain('bladeCount');
    expect(codes(P({ blades: 9 }))).toContain('bladeCount');
    expect(codes(P({ blades: 2.5 }))).toContain('bladeCount');
    expect(codes(P({ sections: 4 }))).toContain('sectionCount');
    expect(codes(P({ sections: 13 }))).toContain('sectionCount');
    expect(codes(P({ pitch: 0 }))).toContain('pitch');
    expect(codes(P({ twist: 'angle', pitchAngle: 85 }))).toContain('pitchAngle');
    expect(codes(P({ thickTip: 0.01 }))).toContain('thickness');
    expect(codes(P({ camber: 0.3 }))).toContain('camber');
    expect(codes(P({ chordTip: 0.2 }))).toContain('chord');
    expect(codes(P({ diameter: 5 }))).toContain('diameterSmall');
    expect(codes(P({ diameter: NaN }))).toEqual(['notNumber']);
    expect(codes(P({ airfoil: 'wing' as never }))).toContain('badAirfoil');
    expect(codes(P({ skew: 40 }))).toContain('skew');
    expect(codes(P({ varPrefix: '1x' }))).toContain('badPrefix');
  });
  it('geometry warnings do not refuse: blade root deeper than the hub, blades wider than the hub, a razor tip', () => {
    const w = (p: PropParams): string[] => validateProp(p).filter((i) => i.severity === 'warning').map((i) => i.code);
    expect(w(P({ hubLength: 6 }))).toContain('rootOverhang');
    expect(w(P({ blades: 8, chordRoot: 30 }))).toContain('bladesOverlap');
    expect(w(P({ chordTip: 3, thickTip: 0.04 }))).toContain('thinTip');
    expect(w(P({ pitch: 400 }))).toContain('angleClamped');
    expect(propErrors(P({ hubLength: 6 }))).toEqual([]);
  });
  it('propOps and propDocument throw a PropError that carries the issues', () => {
    expect(() => propOps({ features: [] }, P({ hubDia: 200 }))).toThrow(PropError);
    try { propDocument(P({ blades: 0 })); } catch (e) { expect((e as PropError).issues[0].code).toBe('bladeCount'); }
  });
});

const allFinite = (v: unknown): boolean => (typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) ? v.every(allFinite) : v && typeof v === 'object' ? Object.values(v).every(allFinite) : true);

describe('hostile parameters', () => {
  it('300 seeded random records over wild ranges (negative, zero, huge, fractional): each is refused with structured issues or yields a document with finite numbers only', () => {
    const rand = rng(99);
    const wild = (): number => { const k = rand(); return k < 0.1 ? 0 : k < 0.2 ? -rand() * 50 : k < 0.3 ? rand() * 1e4 : k < 0.35 ? NaN : rand() * 150; };
    let built = 0, refused = 0;
    for (let i = 0; i < 300; i++) {
      const p = P({
        diameter: wild(), hubDia: wild(), hubLength: wild(), boreDia: wild(), blades: Math.round(wild() / 10), sections: Math.round(wild() / 8), pitch: wild(), pitchAngle: wild(), refRadius: rand() * 1.5,
        rootAngle: wild(), tipAngle: wild(), chordRoot: wild(), chordMid: wild(), chordTip: wild(), chordExp: rand() * 6, thickRoot: rand() * 0.6, thickMid: rand() * 0.6, thickTip: rand() * 0.6,
        camber: rand() * 0.2, camberPos: rand(), pivot: rand() * 1.2, rake: (rand() - 0.5) * 120, skew: wild() - 50, rootEmbed: rand() * 1.2,
        twist: (['pitch', 'angle', 'linear'] as const)[Math.floor(rand() * 3)], airfoil: (['naca4', 'arc', 'plate'] as const)[Math.floor(rand() * 3)],
      });
      const errs = propErrors(p);
      if (errs.length) {
        refused++;
        expect(errs.every((e) => e.code && e.field && e.message)).toBe(true);
        expect(() => propDocument(p)).toThrow(PropError);
      } else {
        built++;
        expect(allFinite(propDocument(p))).toBe(true);   // NaN would serialise as null
      }
    }
    expect(refused).toBeGreaterThan(100);
    // and around the defaults, where most records are valid: the document must never carry a NaN
    for (let i = 0; i < 100; i++) {
      const p = P({ chordRoot: 1 + 40 * rand(), chordMid: 1 + 40 * rand(), chordTip: 1 + 40 * rand(), pitch: 10 + 400 * rand(), rootEmbed: 0.3 + 0.6 * rand(), skew: (rand() - 0.5) * 40, rake: (rand() - 0.5) * 60, blades: 2 + Math.floor(rand() * 7), sections: 5 + Math.floor(rand() * 8) });
      if (propErrors(p).length) continue;
      built++;
      expect(allFinite(propDocument(p))).toBe(true);
    }
    expect(built).toBeGreaterThan(20);
  });
});

describe('features', () => {
  it('the document has the roles in order, unique ids, hub / bore through named variables, and the record on the hub sketch', () => {
    const p = P({ sections: 6 });
    const doc = propDocument(p) as { features: Array<Record<string, unknown>>; variables: Array<{ name: string; expr: string }> };
    expect(doc.features.length).toBe(rolesFor(p).length);
    expect(new Set(doc.features.map((f) => f.id)).size).toBe(doc.features.length);
    expect(doc.features.map((f) => f.type)).toEqual(['sketch', 'extrude', ...Array(6).fill(['plane', 'sketch']).flat(), 'loft', 'cpattern', 'sketch', 'extrude']);
    expect(doc.variables.map((v) => v.name)).toEqual(['prop_hub_d', 'prop_hub_len', 'prop_bore_d', 'prop_blades']);
    const hub = doc.features[1], pat = doc.features.find((f) => f.type === 'cpattern')!;
    expect(hub.depth).toBe('=prop_hub_len'); expect(pat.count).toBe('=prop_blades');
    const rec = readProp(doc.features[0])!;
    expect(rec.params).toEqual(p);
    expect(rec.roles.hub).toBe('F2'); expect(rec.roles.blade).toBe('F15');
    expect(propOwner(doc.features, 'F15')?.hubId).toBe('F1');
    expect(propOwner(doc.features, 'F99')).toBeNull();
  });
  it('the sections are on planes at the section radii and all have the same structure (loft needs that)', () => {
    const p = P({ sections: 8, airfoil: 'arc' });
    const doc = propDocument(p) as { features: Array<Record<string, any>> };
    const planes = doc.features.filter((f) => f.type === 'plane');
    expect(planes.map((f) => f.offset)).toEqual(sectionRadii(p));
    const sk = doc.features.filter((f) => f.type === 'sketch' && f.plane?.kind === 'feature');
    expect(sk.length).toBe(8);
    for (const s of sk) { expect(s.entities.length).toBe(2); expect(s.points.length).toBe(s.entities[0].pts.length + s.entities[1].pts.length - 2); }
    expect(new Set(sk.map((s) => s.points.length)).size).toBe(1);
  });
  it('no bore: no bore variable and no bore features', () => {
    const p = P({ boreDia: 0 });
    expect(propVariables(p).map((v) => v.name)).not.toContain('prop_bore_d');
    expect((propDocument(p) as { features: unknown[] }).features.length).toBe(rolesFor(p).length);
    expect(rolesFor(p)).not.toContain('bore');
  });
  it('propOps creates with fresh ids after the existing ones, regenerates in place keeping ids, grows and shrinks the section list', () => {
    const doc = { features: [{ id: 'F1' }, { id: 'F2' }], seq: 3 };
    const ops = propOps(doc, P({ sections: 5 }));
    const ids = ops.map((o) => (o as unknown as { feature: { id: string } }).feature.id);
    expect(ids[0]).toBe('F3'); expect(new Set(ids).size).toBe(ids.length);
    const made = { features: [...doc.features, ...ops.map((o) => (o as unknown as { feature: { id: string } }).feature)], seq: 3 };
    const rec = readProp(made.features[2])!;
    const same = propOps(made, { ...rec.params, diameter: 100 }, rec.roles);
    expect(same.every((o) => o.op === 'replace')).toBe(true);
    expect((same[0] as { id: string }).id).toBe(rec.roles.hubSketch);
    const more = propOps(made, { ...rec.params, sections: 7 }, rec.roles);
    expect(more.filter((o) => o.op === 'add').length).toBe(4);
    expect(more.filter((o) => o.op === 'replace').length).toBe(ops.length);
    const fewer = propOps(made, { ...rec.params, sections: 5, boreDia: 0 }, rec.roles);
    expect(fewer.filter((o) => o.op === 'remove').map((o) => (o as { id: string }).id)).toEqual([rec.roles.bore, rec.roles.boreSketch]);
  });
  it('merging variables keeps the document\'s own and replaces ours; a second propeller gets a free prefix', () => {
    const own = [{ name: 'w', expr: '4' }, { name: 'prop_hub_d', expr: '1' }];
    const merged = mergeVariables(own, P({ hubDia: 30 })) as Array<{ name: string; expr: string }>;
    expect(merged.filter((v) => v.name === 'prop_hub_d')).toEqual([expect.objectContaining({ expr: '30' })]);
    expect(merged[0].name).toBe('w');
    expect(freePrefix(own)).toBe('prop2');
    expect(freePrefix([])).toBe('prop');
  });
  it('propFeatures is deterministic (same record, same document: the regeneration cache can reuse unchanged features)', () => {
    const ids = Object.fromEntries(rolesFor(P()).map((r, i) => [r, `F${i + 1}`]));
    expect(JSON.stringify(propFeatures(P(), ids))).toBe(JSON.stringify(propFeatures(P(), ids)));
    const a = propFeatures(P(), ids), b = propFeatures(P({ hubLength: 30, boreDia: 8 }), ids);
    // a hub length or bore change leaves every blade section sketch identical
    expect(a.filter((f) => f.type === 'sketch' && (f.plane as { kind: string }).kind === 'feature')).toEqual(b.filter((f) => f.type === 'sketch' && (f.plane as { kind: string }).kind === 'feature'));
  });
});

describe('readout', () => {
  it('gives the pitch, angles and blade area ratio', () => {
    const r = propReadout(P());
    expect(r.pitch).toBe(90); expect(r.pitchRatio).toBeCloseTo(0.75, 9);
    expect(r.angleTip).toBeCloseTo((Math.atan(90 / (2 * Math.PI * 60)) * 180) / Math.PI, 6);
    expect(r.angleRoot).toBeGreaterThan(r.angle70);
    expect(r.areaRatio).toBeGreaterThan(0.05); expect(r.areaRatio).toBeLessThan(0.6);
    expect(r.issues).toEqual([]);
  });
});
