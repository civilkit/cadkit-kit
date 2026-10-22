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
  it('herringbone: the overlap of one half, the contact on the active width, none of the range warnings at 30 degrees', () => {
    const r = gearReadout({ ...DEFAULT_GEAR, type: 'herringbone', helixAngle: 30, faceWidth: 12, grooveWidth: 3 });
    expect(r.overlapHalf).toBeCloseTo(((6 - 1.5) * Math.sin(Math.PI / 6)) / (Math.PI * 2), 9);
    expect(r.totalContactRatio).toBeCloseTo(r.contactRatio + 2 * r.overlapHalf, 9);
    expect(r.totalContactRatio).toBeGreaterThan(r.contactRatio);
    for (const w of ['helixRange', 'grooveWide', 'sillyTwist']) expect(r.warnings).not.toContain(w);
  });
  it('herringbone hostiles: helix 0 and 60, a groove as wide as the face, a twist around a quarter turn', () => {
    expect(gearReadout({ ...DEFAULT_GEAR, type: 'herringbone', helixAngle: 0 }).warnings).toContain('helixRange');
    expect(gearReadout({ ...DEFAULT_GEAR, type: 'herringbone', helixAngle: 60 }).warnings).toContain('helixRange');
    expect(gearReadout({ ...DEFAULT_GEAR, type: 'herringbone', helixAngle: 0 }).overlapHalf).toBe(0);
    expect(gearReadout({ ...DEFAULT_GEAR, type: 'herringbone', helixAngle: 30 }).overlapHalf).toBeGreaterThan(0);
    expect(gearReadout({ ...DEFAULT_GEAR, type: 'herringbone', helixAngle: 30, grooveWidth: 10 }).warnings).toContain('grooveWide');
    expect(gearReadout({ ...DEFAULT_GEAR, type: 'herringbone', helixAngle: 30, grooveWidth: 0 }).warnings).not.toContain('grooveWide');
    expect(gearReadout({ ...DEFAULT_GEAR, type: 'herringbone', helixAngle: 30, faceWidth: 400 }).warnings).toContain('sillyTwist');
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
  it('herringbone: two opposed half extrudes of half the twist each, a hub on the mid plane, the groove cut below the root circle', () => {
    const p = { ...DEFAULT_GEAR, type: 'herringbone' as const, helixAngle: 30, grooveWidth: 3, hubDia: 16, hubLength: 14, boreDia: 8 };
    const feats = (gearOps(doc, p) as unknown as Array<{ feature: Record<string, unknown> }>).map((o) => o.feature);
    expect(feats.map((f) => `${f.id}:${f.type}`)).toEqual(['F1:sketch', 'F2:extrude', 'F3:extrude', 'F4:sketch', 'F5:extrude', 'F6:sketch', 'F7:extrude', 'F8:sketch', 'F9:extrude']);
    const up = feats[1] as { depth: number; twist: number; twistCentre: number[]; sketch: string };
    const down = feats[2] as { depth: number; twist: number; flip: boolean; sketch: string };
    expect(up.depth).toBeCloseTo(5, 9);
    expect(down.depth).toBeCloseTo(5, 9);
    expect(down.flip).toBe(true);
    expect('flip' in up).toBe(false);
    expect(up.sketch).toBe('F1');
    expect(down.sketch).toBe('F1');
    expect(up.twist).toBeCloseTo(gearGeom(p).twist / 2, 9);
    expect(down.twist).toBeCloseTo(-up.twist, 9);
    expect(Math.abs(up.twist)).toBeGreaterThan(1);
    expect(up.twistCentre).toEqual([0, 0]);
    expect((feats[4] as { end: string; sketch: string })).toMatchObject({ end: 'mid', sketch: 'F4' });
    expect((feats[6] as { op: string; end: string; depth: number; sketch: string })).toMatchObject({ op: 'cut', end: 'mid', depth: 3, sketch: 'F6' });
    const gm = gearGeom(p), rings = (feats[5] as { entities: Array<{ r: number }> }).entities;
    expect(rings.length).toBe(2);
    expect(rings[0].r).toBeCloseTo(gm.rf - 0.5 * gm.mn, 6);
    expect(rings[0].r).toBeLessThan(gm.rf);
    expect(rings[1].r).toBeCloseTo(gm.ra + gm.mn, 6);
    expect((feats[8] as { sketch: string }).sketch).toBe('F8');
  });
  it('regenerating a herringbone adds the groove after the hub and removes it with its sketch', () => {
    const p0 = { ...DEFAULT_GEAR, type: 'herringbone' as const, boreDia: 8 };
    const first = gearOps(doc, p0) as unknown as Array<{ feature: Record<string, unknown> }>;
    expect(first.length).toBe(5);
    const roles = readGear(first[0].feature)!.roles;
    const d2 = { features: first.map((o) => o.feature as { id?: string }), seq: 6 };
    const adds = gearOps(d2, { ...p0, grooveWidth: 3 }, roles) as unknown as Array<{ op: string; id?: string; index?: number; feature?: { id: string } }>;
    expect(adds.filter((o) => o.op === 'add').map((o) => o.feature!.id)).toEqual(['F6', 'F7']);
    expect(adds.filter((o) => o.op === 'add').map((o) => o.index)).toEqual([3, 4]);
    const back = gearOps({ features: d2.features, seq: 8 }, p0, { ...roles, grooveSketch: 'F6', groove: 'F7' }) as unknown as Array<{ op: string; id?: string }>;
    expect(back.filter((o) => o.op === 'remove').map((o) => o.id)).toEqual(['F6']);
  });
  it('the role list follows the options; a pair has the mate roles with an opposite hand when helical', () => {
    expect(rolesFor({ ...DEFAULT_GEAR, boreDia: 0 })).toEqual(['profile', 'body']);
    expect(rolesFor({ ...DEFAULT_GEAR, type: 'internal', hubDia: 20, hubLength: 5 })).toEqual(['profile', 'body']);
    expect(rolesFor({ ...DEFAULT_GEAR, type: 'rack' })).toEqual(['profile', 'body']);
    expect(rolesFor({ ...DEFAULT_GEAR, hubDia: 20, hubLength: 12, keyway: true })).toEqual(['profile', 'body', 'hubSketch', 'hub', 'boreSketch', 'bore', 'keySketch', 'key']);
    expect(rolesFor({ ...DEFAULT_GEAR, type: 'herringbone', boreDia: 0, grooveWidth: 0 })).toEqual(['profile', 'body', 'bodyDown']);
    expect(rolesFor({ ...DEFAULT_GEAR, type: 'herringbone', grooveWidth: 3, hubDia: 20, hubLength: 12, keyway: true }))
      .toEqual(['profile', 'body', 'bodyDown', 'hubSketch', 'hub', 'grooveSketch', 'groove', 'boreSketch', 'bore', 'keySketch', 'key']);
    expect(rolesFor(defaultPair({ type: 'herringbone', grooveWidth: 3 })).filter((r) => r.startsWith('m.')).length).toBe(7);
    expect(rolesFor(defaultPair()).filter((r) => r.startsWith('m.')).length).toBe(4);
    const m = mateParams({ ...defaultPair({ type: 'herringbone', hand: 'right' }), hand: 'right' });
    expect(m.hand).toBe('left');
    expect(m.teeth).toBe(40);
    const mh = mateParams({ ...defaultPair(), type: 'helical', hand: 'right' });
    expect(mh.hand).toBe('left');
    expect(mh.teeth).toBe(40);
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
