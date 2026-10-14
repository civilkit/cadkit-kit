import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_GEAR, centreDistance, defaultPair, gearGeom, gearModule, gearOps, gearOwner, gearReadout, keySize, mateParams, outline, readGear, rolesFor } from './gearData';
import { PAIR_SAMPLE, SPUR_SAMPLE, samplePart } from './gearSamples';

describe('gear readout', () => {
  it('20 teeth, module 2, 20 degrees: the textbook diameters and ratios', () => {
    const r = gearReadout(DEFAULT_GEAR);
    expect(r.pitchDia).toBeCloseTo(40, 9);
    expect(r.outsideDia).toBeCloseTo(44, 9);
    expect(r.rootDia).toBeCloseTo(35, 9);
    expect(r.baseDia).toBeCloseTo(40 * Math.cos(Math.PI / 9), 9);
    expect(r.minTeeth).toBe(18);
    expect(r.undercut).toBe(false);
    expect(r.contactRatio).toBeGreaterThan(1.5);
    expect(r.contactRatio).toBeLessThan(1.7);
  });
  it('flags undercut below the minimum teeth and suggests the profile shift that fixes it', () => {
    const r = gearReadout({ ...DEFAULT_GEAR, teeth: 12 });
    expect(r.undercut).toBe(true);
    expect(r.warnings).toContain('undercut');
    expect(r.minShift).toBeCloseTo((18 - 12) / 18, 2);
    expect(gearReadout({ ...DEFAULT_GEAR, teeth: 12, shift: r.minShift }).undercut).toBe(false);
  });
  it('diametral pitch gives the module 25.4 / DP, a profile shift raises the outside diameter, helical uses the transverse module', () => {
    expect(gearModule({ sizing: 'dp', module: 9, dp: 12.7 })).toBeCloseTo(2, 9);
    expect(gearReadout({ ...DEFAULT_GEAR, shift: 0.5 }).outsideDia).toBeCloseTo(46, 9);
    const h = gearReadout({ ...DEFAULT_GEAR, type: 'helical', helixAngle: 20 });
    expect(h.pitchDia).toBeCloseTo(40 / Math.cos((20 * Math.PI) / 180), 6);
    expect(h.totalContactRatio).toBeGreaterThan(h.contactRatio);
  });
  it('centre distance of a pair is (z1 + z2) m / 2', () => {
    expect(centreDistance(PAIR_SAMPLE)).toBeCloseTo(60, 9);
    expect(centreDistance({ ...defaultPair(), mate: { teeth: 31, boreDia: 0, hubDia: 0, hubLength: 0 } })).toBeCloseTo(51, 9);
  });
  it('key sizes follow the shaft diameter', () => { expect(keySize(8)).toEqual({ width: 2, depth: 1.0 }); expect(keySize(25)).toEqual({ width: 8, depth: 3.3 }); });
});

describe('gear profile', () => {
  it('the flank points lie on the involute: they are at the base-circle roll angle that matches their radius', () => {
    const p = { ...DEFAULT_GEAR, rootFillet: 0 };
    const o = outline(p);
    const g = gearGeom(p);
    const P = Object.fromEntries(o.points.map((q) => [q.id, q]));
    const first = o.entities.find((e) => e.type === 'spline')!;
    const c0 = g.s / (2 * g.r) + (Math.tan(g.alphaT) - g.alphaT);
    for (const id of first.pts as string[]) {
      const rho = Math.hypot(P[id].x, P[id].y);
      if (rho <= g.rb + 1e-6) continue;
      const a = Math.atan2(P[id].y, P[id].x);
      const t = Math.sqrt((rho / g.rb) ** 2 - 1);
      const want = c0 - (t - Math.atan(t));
      // the point is on the flank at +want or -want of some tooth centre
      const tau = (2 * Math.PI) / g.z;
      const rel = ((a % tau) + tau) % tau;
      const dev = Math.min(Math.abs(rel - want), Math.abs(rel - (tau - want)), Math.abs(rel - want + tau), Math.abs(rel + want - tau));
      expect(dev).toBeLessThan(1e-6);
    }
  });
  it('has one tip arc per tooth and every point on or between the root and outside circles', () => {
    for (const z of [8, 20, 40, 70]) {
      const p = { ...DEFAULT_GEAR, teeth: z };
      const o = outline(p);
      const g = gearGeom(p);
      expect(o.entities.filter((e) => e.type === 'arc' && Math.abs(Math.hypot(o.points.find((q) => q.id === e.p1)!.x, o.points.find((q) => q.id === e.p1)!.y) - g.ra) < 1e-6).length).toBe(z);
      for (const q of o.points.slice(1)) { const rho = Math.hypot(q.x, q.y); expect(rho).toBeGreaterThan(g.rf - 1e-6); expect(rho).toBeLessThan(g.ra + 1e-6); }
    }
  });
  it('rotation by the phase and the centre offset move the whole profile', () => {
    const o = outline({ ...DEFAULT_GEAR, center: [10, 5], phase: 90 });
    expect(o.points[0]).toMatchObject({ x: 10, y: 5 });
  });
  it('warns when the teeth would come to a point', () => { expect(gearReadout({ ...DEFAULT_GEAR, teeth: 10, shift: -0.9, addendum: 1.6 }).warnings.length).toBeGreaterThan(0); });
});

describe('gear features', () => {
  const doc = { features: [] as Array<{ id: string }>, seq: 1 };
  it('a spur gear is profile sketch, extrude, bore sketch and cut, with explicit sequential ids and the record on the profile', () => {
    const ops = gearOps(doc, DEFAULT_GEAR) as unknown as Array<{ op: string; feature: Record<string, unknown> }>;
    expect(ops.map((o) => `${o.feature.id}:${o.feature.type}`)).toEqual(['F1:sketch', 'F2:extrude', 'F3:sketch', 'F4:extrude']);
    expect((ops[1].feature as { depth: number }).depth).toBe(10);
    const rec = readGear(ops[0].feature)!;
    expect(rec.params.teeth).toBe(20);
    expect(rec.roles).toEqual({ profile: 'F1', body: 'F2', boreSketch: 'F3', bore: 'F4' });
    expect(gearOwner(ops.map((o) => o.feature), 'F4')?.profileId).toBe('F1');
    expect(gearOwner(ops.map((o) => o.feature), 'F9')).toBeNull();
  });
  it('helical sets the twist (signed by hand) and its centre', () => {
    const feats = (h: 'left' | 'right') => (gearOps(doc, { ...DEFAULT_GEAR, type: 'helical', helixAngle: 20, hand: h }) as unknown as Array<{ feature: Record<string, unknown> }>).map((o) => o.feature);
    const r = feats('right')[1] as { twist: number; twistCentre: number[] }, l = feats('left')[1] as { twist: number };
    expect(r.twist).toBeGreaterThan(0);
    expect(l.twist).toBeCloseTo(-r.twist, 9);
    expect(r.twistCentre).toEqual([0, 0]);
  });
  it('the role list follows the options; a pair has the mate roles with an opposite hand when helical', () => {
    expect(rolesFor({ ...DEFAULT_GEAR, boreDia: 0 })).toEqual(['profile', 'body']);
    expect(rolesFor({ ...DEFAULT_GEAR, type: 'internal', hubDia: 20, hubLength: 5 })).toEqual(['profile', 'body']);
    expect(rolesFor({ ...DEFAULT_GEAR, type: 'rack' })).toEqual(['profile', 'body']);
    expect(rolesFor({ ...DEFAULT_GEAR, hubDia: 20, hubLength: 12, keyway: true })).toEqual(['profile', 'body', 'hubSketch', 'hub', 'boreSketch', 'bore', 'keySketch', 'key']);
    expect(rolesFor(defaultPair()).filter((r) => r.startsWith('m.')).length).toBe(4);
    const m = mateParams({ ...defaultPair(), type: 'helical', hand: 'right' });
    expect(m.hand).toBe('left');
    expect(m.teeth).toBe(40);
  });
  it('regenerating with existing roles replaces in place, adds optional roles after their predecessor and removes dropped ones with their dependents', () => {
    const first = gearOps(doc, DEFAULT_GEAR) as unknown as Array<{ feature: { id: string } }>;
    const d2 = { features: first.map((o) => o.feature), seq: 5 };
    const roles = readGear(first[0].feature)!.roles;
    const ops = gearOps(d2, { ...DEFAULT_GEAR, hubDia: 20, hubLength: 14 }, roles) as unknown as Array<{ op: string; id?: string; index?: number; feature?: { id: string } }>;
    expect(ops.filter((o) => o.op === 'replace').map((o) => o.id)).toEqual(['F1', 'F2', 'F3', 'F4']);
    const adds = ops.filter((o) => o.op === 'add');
    expect(adds.map((o) => o.feature!.id)).toEqual(['F5', 'F6']);
    expect(adds[0].index).toBe(2);   // right after the body, before the bore
    const back = gearOps({ features: d2.features, seq: 7 }, DEFAULT_GEAR, { ...roles, hubSketch: 'F5', hub: 'F6' }) as unknown as Array<{ op: string; id?: string }>;
    expect(back.filter((o) => o.op === 'remove').map((o) => o.id)).toEqual(['F5']);   // the hub extrude goes with its sketch (cascade)
  });
});

describe('gear samples', () => {
  const read = (n: string, ext = 'ckpart') => JSON.parse(readFileSync(`apps/cad/public/samples/${n}.${ext}`, 'utf8'));
  it('the committed samples are what the generator makes', () => {
    expect(read('spur-gear')).toEqual(JSON.parse(JSON.stringify(samplePart('Spur gear', SPUR_SAMPLE))));
    expect(read('gear-pair')).toEqual(JSON.parse(JSON.stringify(samplePart('Gear pair', PAIR_SAMPLE))));
  });
  it('are listed', () => {
    const idx = read('index', 'json') as unknown as Array<{ id: string }>;
    expect(idx.map((x) => x.id)).toEqual(expect.arrayContaining(['spur-gear', 'gear-pair']));
  });
});
