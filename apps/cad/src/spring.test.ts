import { describe, expect, it } from 'vitest';
import { DEFAULT_SPRING, springIssue, springOpts, springOps, springSummary, type SpringParams } from './spring';

const P = (o: Partial<SpringParams> = {}): SpringParams => ({ ...DEFAULT_SPRING, ...o });
type Op = { op: string; feature: { id: string; type?: string; group?: string; path?: { kind: string; id: string }; sketch?: string } };

describe('spring wizard rules', () => {
  it('the default record is valid and makes a helix and a sweep along it', () => {
    expect(springIssue(P())).toBeNull();
    const ops = springOps({ features: [] }, P()) as unknown as Op[];
    expect(ops.map((o) => o.feature.type)).toEqual(['plane', 'sketch', 'helix', 'sketch', 'sweep']);   // the plane lifts the helix half a wire off the end plane
    const helix = ops[2].feature, sweep = ops[4].feature;
    expect(sweep.path).toEqual({ kind: 'curve', id: helix.id });
    expect(sweep.sketch).toBe(ops[3].feature.id);
  });
  it('maps the axis choice to a vector and passes the hand on', () => {
    expect(springOpts(P({ axis: 'nx' })).axis).toEqual([-1, 0, 0]);
    expect(springOpts(P({ hand: 'left' })).hand).toBe('left');
    const helix = (springOps({ features: [] }, P({ hand: 'left' })) as unknown as Op[])[2].feature as unknown as { leftHand?: boolean };
    expect(helix.leftHand).toBe(true);
    expect((springOps({ features: [] }, P()) as unknown as Op[])[2].feature).not.toHaveProperty('leftHand');
  });
  it('reports bad numbers without the kernel', () => {
    expect(springIssue(P({ wire: 0 }))?.code).toBe('wire');
    expect(springIssue(P({ outer: 4 }))?.code).toBe('outer');
    expect(springIssue(P({ length: 2 }))?.code).toBe('length');
    expect(springIssue(P({ coils: 0 }))?.code).toBe('coils');
    expect(springIssue(P({ coils: 40 }))).toMatchObject({ code: 'pitch', params: { wire: 2 } });   // 38 mm of wire path into 40 mm: the pitch would be under the wire
  });
  it('shows the pitch, the gap between turns and the wire length', () => {
    const s = springSummary(P());
    expect(s.pitch).toBeCloseTo(4.75, 9);
    expect(s.gap).toBeCloseTo(2.75, 9);
    expect(s.meanDiameter).toBe(18);
    expect(s.wireLength).toBeGreaterThan(2 * Math.PI * 9 * 8);
    expect(s.wireLength).toBeLessThan(2 * Math.PI * 9 * 8 + 38);
  });
  it('numbers the new features from the next free id and groups them as Spring, Spring 2', () => {
    const ops = springOps({ features: [{ id: 'F1' }, { id: 'F7' }] }, P()) as unknown as Op[];
    expect(ops.map((o) => o.feature.id)).toEqual(['F8', 'F9', 'F10', 'F11', 'F12']);
    expect(new Set(ops.map((o) => o.feature.group))).toEqual(new Set(['Spring']));
    const second = springOps({ features: ops.map((o) => o.feature) }, P({ origin: [30, 0, 0] })) as unknown as Op[];
    expect(new Set(second.map((o) => o.feature.group))).toEqual(new Set(['Spring 2']));
  });
  it('plain ends make a helix; closed ends a spline path; ground ends add one cut at each end that reaches only this spring', () => {
    const types = (p: Partial<SpringParams>) => (springOps({ features: [] }, P(p)) as unknown as Op[]).map((o) => o.feature.type);
    expect(types({ ends: 'plain' })).toContain('helix');
    const closed = types({ ends: 'closed' });
    expect(closed).toContain('sketch3d'); expect(closed).not.toContain('helix'); expect(closed).not.toContain('extrude');
    const ground = springOps({ features: [] }, P({ ends: 'ground' })) as unknown as Array<Op & { feature: { op?: string; target?: Array<{ body: string }>; body?: string } }>;
    const cuts = ground.filter((o) => o.feature.type === 'extrude');
    expect(cuts).toHaveLength(2);
    const sweep = ground.find((o) => o.feature.type === 'sweep')!.feature;
    expect(sweep.body).toBe('Spring');
    for (const c of cuts) { expect(c.feature.op).toBe('cut'); expect(c.feature.target).toEqual([{ body: 'Spring' }]); }
  });
  it('a second ground spring has its own body name, so its cuts never reach the first', () => {
    const first = springOps({ features: [] }, P({ ends: 'ground' })) as unknown as Op[];
    const second = springOps({ features: first.map((o) => o.feature) }, P({ ends: 'ground', origin: [30, 0, 0] })) as unknown as Array<Op & { feature: { body?: string; target?: Array<{ body: string }> } }>;
    expect(second.find((o) => o.feature.type === 'sweep')!.feature.body).toBe('Spring 2');
    expect(second.filter((o) => o.feature.type === 'extrude').every((c) => c.feature.target?.[0].body === 'Spring 2')).toBe(true);
  });
  it('closed turns that leave under one body turn are refused; the plain closed-turn field is ignored', () => {
    expect(springIssue(P({ ends: 'closed', coils: 2.5, closedTurns: 1 }))).toMatchObject({ code: 'closed' });
    expect(springIssue(P({ ends: 'closed', closedTurns: 0 }))?.code).toBe('closed');
    expect(springIssue(P({ ends: 'plain', closedTurns: 0 }))).toBeNull();
    expect(springIssue(P({ ends: 'ground', coils: 8, closedTurns: 1 }))).toBeNull();
  });
  it('closed ends shorten the active turns and tighten them: 8 turns, one closed at each end, 40 mm', () => {
    const s = springSummary(P({ ends: 'closed' }));
    expect(s.activeCoils).toBe(6);
    expect(s.pitch).toBeCloseTo((40 - 2 - 2 * 1 * 2) / 6, 9);   // (length - wire - the two closed turns of one wire each) / body turns
  });
  it('an extension spring is a spline path, a plane normal to it, a wire circle on that plane and a sweep, in one folder', () => {
    const ops = springOps({ features: [] }, P({ kind: 'extension', outer: 12, wire: 1, coils: 15 })) as unknown as Op[];
    expect(ops.map((o) => o.feature.type)).toEqual(['sketch3d', 'plane', 'sketch', 'sweep']);
    expect(new Set(ops.map((o) => o.feature.group))).toEqual(new Set(['Spring']));
  });
  it('extension numbers: too thin a coil for the hooks, fewer than one turn, and the overall length it shows', () => {
    const E = (o: Partial<SpringParams> = {}) => P({ kind: 'extension', outer: 12, wire: 1, coils: 15, ...o });
    expect(springIssue(E())).toBeNull();
    expect(springIssue(E({ outer: 3 }))?.code).toBe('hookOuter');
    expect(springIssue(E({ coils: 0.5 }))?.code).toBe('coils');
    const s = springSummary(E());
    expect(s.length).toBeGreaterThan(15 + 2 * 12);   // the body is 16 mm and each hook stands more than a coil diameter above it
    expect(s.length).toBeLessThan(15 + 4 * 12);
    expect(s.wireLength).toBeGreaterThan(Math.PI * 11 * 15);
  });
  it('a cone or a progressive spring is wound along a spline; a far end the same as the first is still a helix', () => {
    const types = (p: Partial<SpringParams>) => (springOps({ features: [] }, P(p)) as unknown as Op[]).map((o) => o.feature.type);
    expect(types({ topOuter: 12 })).toContain('sketch3d');
    expect(types({ progression: 0.6 })).toContain('sketch3d');
    expect(types({ topOuter: 20 })).toContain('helix');   // equal to the outer: no cone
    expect(types({ topOuter: null, progression: 1 })).toContain('helix');
  });
  it('refuses a progression that closes the turns up, a far end too thin, and a ratio of 0', () => {
    expect(springIssue(P({ progression: 0.2 }))).toMatchObject({ code: 'pitch' });
    expect(springIssue(P({ topOuter: 3 }))?.code).toBe('topOuter');
    expect(springIssue(P({ progression: 0 }))?.code).toBe('progression');
    expect(springIssue(P({ progression: 0.6, topOuter: 14 }))).toBeNull();
  });
  it('a torsion spring is the same four features as an extension spring, and its summary gives the angle between the legs', () => {
    const T = (o: Partial<SpringParams> = {}) => P({ kind: 'torsion', outer: 14, wire: 1.2, coils: 5.25, leg1: 21, leg2: 21, ...o });
    const ops = springOps({ features: [] }, T()) as unknown as Op[];
    expect(ops.map((o) => o.feature.type)).toEqual(['sketch3d', 'plane', 'sketch', 'sweep']);
    expect(springIssue(T())).toBeNull();
    expect(springSummary(T()).legAngle).toBeCloseTo(90, 6);
    expect(springSummary(T({ coils: 5.5 })).legAngle).toBeCloseTo(180, 6);
    expect(springIssue(T({ leg1: 0 }))?.code).toBe('leg');
    expect(springIssue(T({ outer: 2 }))?.code).toBe('outer');
    expect(springIssue(T({ coils: 0.5 }))?.code).toBe('coils');
  });
});
