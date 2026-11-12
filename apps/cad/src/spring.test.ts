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
});
