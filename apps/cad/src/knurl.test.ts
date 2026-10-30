import { describe, expect, it } from 'vitest';
import { DEFAULT_KNURL, cosmeticByDefault, cosmeticToCutOps, knurlCosmetic, knurlIssue, knurlOpts, knurlOps, knurlTarget, readCosmeticKnurls, suggestCount, suggestDepth, type KnurlParams } from './knurl';

/** A closed ring of points: a circle of radius r about the axis through c along axis k, at axial position h. */
function ring(k: number, c: number[], r: number, h: number, n = 48): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    const p = [0, 0, 0];
    const u = (k + 1) % 3, v = (k + 2) % 3;
    p[k] = h; p[u] = c[u] + r * Math.cos(a); p[v] = c[v] + r * Math.sin(a);
    pts.push(p);
  }
  return pts;
}
const cylinderEdges = (k: number, c: number[], r: number, h0: number, h1: number) => [
  { faces: ['F2.S.c1', 'F2.S.b'], pts: ring(k, c, r, h0) },
  { faces: ['F2.S.c1', 'F2.S.t'], pts: ring(k, c, r, h1) },
];
const target = (over: Partial<NonNullable<KnurlParams['target']>> = {}) => ({ axis: 'z' as const, center: [0, 0] as [number, number], radius: 10, from: 0, to: 12, ...over });
const P = (o: Partial<KnurlParams> = {}): KnurlParams => ({ ...DEFAULT_KNURL, cosmetic: false, count: 24, depth: 0.6, target: target(), ...o });

describe('knurlTarget: the cylinder a face is', () => {
  it('reads radius, axis, centre and axial range for a cylinder along each world axis', () => {
    for (const [k, axis] of [[0, 'x'], [1, 'y'], [2, 'z']] as const) {
      const c = [3, 4, 5];
      const r = knurlTarget('F2.S.c1', cylinderEdges(k, c, 10, 2, 14));
      expect('target' in r).toBe(true);
      if (!('target' in r)) continue;
      expect(r.target.axis).toBe(axis);
      expect(r.target.radius).toBeCloseTo(10, 2);
      expect(r.target.from).toBeCloseTo(2, 2);
      expect(r.target.to).toBeCloseTo(14, 2);
      // centre: the two world coordinates across the axis, in the order z: [x, y], y: [x, z], x: [y, z]
      const want = axis === 'z' ? [3, 4] : axis === 'y' ? [3, 5] : [4, 5];
      expect(r.target.center[0]).toBeCloseTo(want[0], 2);
      expect(r.target.center[1]).toBeCloseTo(want[1], 2);
    }
  });
  it('says why a face is not usable', () => {
    expect(knurlTarget('F9.S.x', [])).toEqual({ reason: 'notCylinder' });
    // a tilted cylinder: rings in a plane normal to (1,1,0)/sqrt2
    const s = Math.SQRT1_2;
    const tilted = (h: number) => Array.from({ length: 49 }, (_, i) => { const a = (2 * Math.PI * i) / 48; return [s * h + 0 * Math.cos(a) + s * 5 * Math.cos(a) * 0 + (-s) * 5 * Math.cos(a), s * h + s * 5 * Math.cos(a) * 0 + s * 5 * Math.cos(a), 5 * Math.sin(a)]; });
    expect(knurlTarget('F2.S.c1', [{ faces: ['F2.S.c1'], pts: tilted(0) }, { faces: ['F2.S.c1'], pts: tilted(10) }])).toEqual({ reason: 'oblique' });
    expect(knurlTarget('F3.S.h1', cylinderEdges(2, [0, 0, 0], 4, 0, 5).map((e) => ({ ...e, faces: ['F3.S.h1'] })))).toEqual({ reason: 'internal' });
  });
});

describe('knurlIssue / knurlOps', () => {
  it('a sensible straight knurl has no issue and makes a sketch and a cut', () => {
    expect(knurlIssue(P())).toBeNull();
    const ops = knurlOps({ features: [{ id: 'F1' }, { id: 'F2' }] }, P()) as unknown as Array<{ op: string; feature: { type: string; id: string } }>;
    expect(ops.map((o) => o.feature.type)).toEqual(['sketch', 'extrude']);
    expect(ops.map((o) => o.feature.id)).toEqual(['F3', 'F4']);
  });
  it('numbers the ids from the document seq when it is ahead', () => {
    const ops = knurlOps({ features: [{ id: 'F1' }], seq: 7 }, P()) as unknown as Array<{ feature: { id: string } }>;
    expect(ops[0].feature.id).toBe('F7');
  });
  it('faceted (the default) records one knurlBand feature for a diamond or pyramid', () => {
    for (const pattern of ['diamond', 'pyramid'] as const) {
      const ops = knurlOps({ features: [{ id: 'F1' }] }, P({ pattern, count: 12, depth: 0.5, helixAngle: 22 })) as unknown as Array<{ feature: Record<string, unknown> }>;
      expect(ops.map((o) => o.feature.type)).toEqual(['knurlBand']);
      expect(ops[0].feature).toMatchObject({ id: 'F2', axis: 'z', center: [0, 0], radius: 10, from: 0, to: 12, pattern, count: 12, depth: 0.5, angle: 90 });
    }
    // round grooves and straight have no faceted form: the method choice is ignored
    expect(knurlOpts(P({ pattern: 'diamond', profile: 'round' }))).not.toHaveProperty('method');
    expect(knurlOpts(P())).not.toHaveProperty('method');
  });
  it('diamond makes two sweeps, pyramid a cut and a revolve cut (method boolean)', () => {
    const d = knurlOps({ features: [] }, P({ pattern: 'diamond', count: 12, depth: 0.5, helixAngle: 22, method: 'boolean' })) as unknown as Array<{ feature: { type: string } }>;
    expect(d.map((o) => o.feature.type)).toEqual(['sketch', 'sketch', 'sweep', 'sketch', 'sketch', 'sweep']);
    const y = knurlOps({ features: [] }, P({ pattern: 'pyramid', method: 'boolean' })) as unknown as Array<{ feature: { type: string; op?: string } }>;
    expect(y.map((o) => o.feature.type)).toEqual(['sketch', 'extrude', 'sketch', 'revolve']);
    expect(y[3].feature.op).toBe('cut');
  });
  it('reports each problem: no cylinder, count, depth, range, overlapping grooves', () => {
    expect(knurlIssue(P({ target: null }))?.code).toBe('noTarget');
    expect(knurlIssue(P({ count: 2 }))?.code).toBe('count');
    expect(knurlIssue(P({ count: 10.5 }))?.code).toBe('count');
    expect(knurlIssue(P({ depth: 0 }))?.code).toBe('depth');
    expect(knurlIssue(P({ depth: 10 }))?.code).toBe('depth');
    expect(knurlIssue(P({ range: [5, 5] }))?.code).toBe('range');
    const overlap = knurlIssue(P({ count: 90 }));
    expect(overlap?.code).toBe('kernel');
    expect(overlap?.message).toMatch(/overlap/);
  });
  it('options for the helper: the whole face by default, a chosen band when given; the helix angle only for a diamond', () => {
    expect(knurlOpts(P())).toMatchObject({ axis: 'z', radius: 10, from: 0, to: 12, pattern: 'straight', count: 24, depth: 0.6 });
    expect(knurlOpts(P())).not.toHaveProperty('helixAngle');
    expect(knurlOpts(P({ range: [2, 10], pattern: 'diamond', helixAngle: 40 }))).toMatchObject({ from: 2, to: 10, helixAngle: 40 });
  });
  it('suggested count and depth give a 90 degree V that does not overlap', () => {
    for (const r of [3, 10, 25, 60]) {
      const n = suggestCount(r), d = suggestDepth(r, n);
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n % 2).toBe(0);
      expect(knurlIssue(P({ target: target({ radius: r }), count: n, depth: d }))).toBeNull();
    }
  });
});

describe('cosmetic knurls', () => {
  it('Cosmetic (instant) is the default of the wizard, for every pattern', () => {
    expect(DEFAULT_KNURL.cosmetic).toBe(true);
    for (const k of ['straight', 'diamond', 'pyramid'] as const) expect(cosmeticByDefault(k)).toBe(true);
    expect(knurlOpts({ ...DEFAULT_KNURL, target: target() })).toMatchObject({ mode: 'cosmetic' });
    expect(knurlOpts(P())).not.toHaveProperty('mode');   // the real cut stays one click away
  });
  it('the helper options carry the mode; the record has every number resolved', () => {
    expect(knurlOpts(P({ cosmetic: true }))).toMatchObject({ mode: 'cosmetic' });
    expect(knurlOpts(P())).not.toHaveProperty('mode');
    const rec = knurlCosmetic(P({ pattern: 'diamond', cosmetic: true, helixAngle: 40 }));
    expect(rec).toMatchObject({ axis: 'z', radius: 10, from: 0, to: 12, pattern: 'diamond', count: 24, depth: 0.6, helixAngle: 40, profile: 'v', angle: 90 });
  });
  it('a density the real cut refuses is no issue when cosmetic', () => {
    const dense = { pattern: 'diamond' as const, count: 120, depth: 0.2, helixAngle: 45 };
    expect(knurlIssue(P({ ...dense, method: 'boolean' }))?.code).toBe('kernel');   // the boolean cut refuses it; the faceted build and the cosmetic mode do not
    expect(knurlIssue(P({ ...dense, method: 'boolean', cosmetic: true }))).toBeNull();
  });
  it('simple problems are still reported', () => {
    expect(knurlIssue(P({ cosmetic: true, depth: 11 }))?.code).toBe('depth');
    expect(knurlIssue(P({ cosmetic: true, count: 2 }))?.code).toBe('count');
  });
  it('knurlOps always cuts, even for cosmetic parameters (the convert path)', () => {
    expect(knurlOps({ features: [] }, P({ cosmetic: true })).length).toBe(2);
  });
  it('records become cut ops numbered after the document, continuing from one record to the next', () => {
    const a = knurlCosmetic(P({ cosmetic: true }));
    const b = knurlCosmetic(P({ cosmetic: true, range: [2, 6] }));
    const ops = cosmeticToCutOps({ features: [{ id: 'F1' }, { id: 'F2' }] }, [a, b]);
    const ids = ops.map((o) => (o as unknown as { feature: { id: string } }).feature.id);
    expect(ids).toEqual(['F3', 'F4', 'F5', 'F6', 'F7']);   // a: sketch, cut; b: offset plane, sketch, cut
    expect(readCosmeticKnurls([a, 5, {}])).toEqual([a]);
  });
});
