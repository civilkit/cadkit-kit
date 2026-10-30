import { describe, expect, it } from 'vitest';
import { DEFAULT_KNURL, knurlAnchor, knurlOpts, knurlOps, knurlTarget, type KnurlParams } from './knurl';
import { knurlOwner } from './knurlEdit';
import type { FaceMesh } from './bearing';
import { diagnose } from '@kit/viewdata';
import { knurlEditOps } from '@kit/script';

/** A circle of radius 10 about the z axis through (7, -4), at height h. */
const ring = (h: number): number[][] => Array.from({ length: 49 }, (_, i) => { const a = (2 * Math.PI * i) / 48; return [7 + 10 * Math.cos(a), -4 + 10 * Math.sin(a), h]; });
const edges = (h0: number, h1: number, c0 = 'F2.C0', c1 = 'F2.C1') => [
  { faces: ['F2.S.c1', c0], pts: ring(h0) },
  { faces: ['F2.S.c1', c1], pts: ring(h1) },
];
/** The two flat ends of the shaft as a mesh: a triangle fan at each height, normal along -z / +z. */
function ends(h0: number, h1: number, ids = ['F2.C0', 'F2.C1']): FaceMesh {
  const tri = (h: number): number[][] => [[0, 0, h], [14, 0, h], [14, 14, h]];
  const pos = [...tri(h0), ...tri(h1)];
  return { positions: pos.flat(), normals: [...tri(h0).flatMap(() => [0, 0, -1]), ...tri(h1).flatMap(() => [0, 0, 1])], triFace: [0, 1], faceIds: ids };
}
const target = (over: Partial<NonNullable<KnurlParams['target']>> = {}) => ({ axis: 'z' as const, center: [7, -4] as [number, number], radius: 10, from: 0, to: 30, ends: [{ face: 'F2.C0', at: 0 }, { face: 'F2.C1', at: 30 }], ...over });
const P = (o: Partial<KnurlParams> = {}): KnurlParams => ({ ...DEFAULT_KNURL, cosmetic: false, count: 24, depth: 0.5, target: target(), range: [15, 25], ...o });
type Op = { op: string; feature: Record<string, unknown> };

describe('the end faces of the cylinder the wizard reads', () => {
  it('both flat ends are found with their position, from the face on the other side of each end edge', () => {
    const r = knurlTarget('F2.S.c1', edges(0, 30), ends(0, 30));
    expect('target' in r && r.target.ends).toEqual([{ face: 'F2.C0', at: 0 }, { face: 'F2.C1', at: 30 }]);
  });
  it('without the face mesh, or when an end is not flat (a chamfer, a cone) or does not face along the axis, there are no ends', () => {
    expect((knurlTarget('F2.S.c1', edges(0, 30)) as { target: { ends?: unknown } }).target.ends).toBeUndefined();
    const chamfered = knurlTarget('F2.S.c1', edges(0, 30, 'F2.C0', 'F2.X1'), ends(0, 30)) as { target: { ends?: Array<{ face: string }> } };
    expect(chamfered.target.ends).toEqual([{ face: 'F2.C0', at: 0 }]);
    const tilted = ends(0, 30); (tilted.normals as number[]).fill(Math.SQRT1_2);
    expect((knurlTarget('F2.S.c1', edges(0, 30), tilted) as { target: { ends?: unknown } }).target.ends).toBeUndefined();
  });
});

describe('which end the band is built from', () => {
  it('the nearer one: a band 5 mm from the far end follows the far end, one 4 mm from the near end follows the near end', () => {
    expect(knurlAnchor(P())).toEqual({ face: 'F2.C1', at: 30 });
    expect(knurlAnchor(P({ range: [4, 14] }))).toEqual({ face: 'F2.C0', at: 0 });
  });
  it('the whole face is as near to both: the end the extrude moves (.C1) is taken', () => {
    expect(knurlAnchor(P({ range: null }))).toEqual({ face: 'F2.C1', at: 30 });
  });
  it('no anchor for a cosmetic knurl, a faceted band, or a cylinder with no flat end', () => {
    expect(knurlAnchor(P({ cosmetic: true }))).toBeNull();
    expect(knurlAnchor(P({ pattern: 'diamond', method: 'faceted' }))).toBeNull();
    expect(knurlAnchor(P({ pattern: 'diamond', method: 'boolean' }))).not.toBeNull();
    expect(knurlAnchor(P({ pattern: 'diamond', profile: 'round', method: 'faceted' }))).not.toBeNull();   // round grooves are always cut
    expect(knurlAnchor(P({ target: target({ ends: undefined }) }))).toBeNull();
    expect(knurlOpts(P({ cosmetic: true }))).not.toHaveProperty('onFace');
    expect(knurlOpts(P())).toMatchObject({ onFace: { face: 'F2.C1', at: 30 } });
  });
});

describe('the ops of a band built from the end face', () => {
  const ops = (o: Partial<KnurlParams> = {}) => knurlOps({ features: [{ id: 'F1' }, { id: 'F2' }] }, P(o)) as unknown as Op[];
  it('straight: a plane offset from the far end face (the band starts 15 mm in from it), a sketch on it and a cut; no standard plane at the absolute position', () => {
    const o = ops();
    expect(o.map((x) => x.feature.type)).toEqual(['plane', 'sketch', 'extrude']);
    expect(o[0].feature).toMatchObject({ type: 'plane', mode: 'offset', base: { kind: 'face', id: 'F2.C1' }, offset: -15 });
    expect(o[1].feature.plane).toEqual({ kind: 'feature', id: o[0].feature.id });
    expect(o[2].feature).toMatchObject({ op: 'cut', end: 'blind', depth: 10, flip: true });   // along the face's outward normal, which is the way the band runs from its start
  });
  it('the band moves with the face: the same ops whatever the far end is, only the numbers of the band differ', () => {
    // the shaft made 20 long: a band 5 mm from the far end is 5 to 15: the same offset from the face (-15) and the same length
    const o = knurlOps({ features: [] }, P({ target: target({ to: 20, ends: [{ face: 'F2.C0', at: 0 }, { face: 'F2.C1', at: 20 }] }), range: [5, 15] })) as unknown as Op[];
    expect(o[0].feature).toMatchObject({ base: { kind: 'face', id: 'F2.C1' }, offset: -15 });
    expect(o[2].feature).toMatchObject({ depth: 10 });
  });
  it('built from the near end the cut runs the other way round (into the part is along the axis)', () => {
    const o = ops({ range: [4, 14] });
    expect(o[0].feature).toMatchObject({ base: { kind: 'face', id: 'F2.C0' }, offset: -4 });   // the outward normal of the near end points the other way
    expect(o[2].feature).not.toHaveProperty('flip');
  });
  it('pyramid and diamond (cut grooves) add a guide axis in the face and a profile plane through it', () => {
    for (const pattern of ['pyramid', 'diamond'] as const) {
      const o = ops({ pattern, method: 'boolean', count: 8, depth: 0.4 });
      const t = o.map((x) => `${x.feature.type}${x.feature.mode ? ':' + x.feature.mode : ''}`);
      expect(t, pattern).toEqual(expect.arrayContaining(['plane:offset', 'axis', 'plane:perpendicular']));
      expect(JSON.stringify(o), pattern).not.toContain('"kind":"std","id":"front"');
    }
  });
  it('a faceted band and a cosmetic record keep their numbers', () => {
    const o = ops({ pattern: 'diamond', method: 'faceted', count: 12, depth: 0.4 });
    expect(o.map((x) => x.feature.type)).toEqual(['knurlBand']);
    expect(o[0].feature).toMatchObject({ from: 15, to: 25 });
  });
  it('the marker keeps the end faces, so a reopened knurl is still attached', () => {
    const o = ops();
    const features = o.map((x) => x.feature);
    expect(features[0].knurl).toMatchObject({ v: 1, params: { target: { ends: [{ face: 'F2.C0', at: 0 }, { face: 'F2.C1', at: 30 }] } } });
    expect(knurlOwner(features as never, String(features[2].id))?.params.target?.ends).toHaveLength(2);
  });
});

describe('a knurl whose band no longer touches the part', () => {
  const e = (id: string, code: string) => ({ id, code });
  const made = (o: Partial<KnurlParams>) => knurlOps({ features: [{ id: 'F1' }, { id: 'F2' }] }, P(o)).map((x) => (x as unknown as Op).feature) as Array<Record<string, unknown> & { id: string }>;
  it('is told apart by whether it is built from a face', () => {
    const fixed = made({ target: target({ ends: undefined }) });
    const d = diagnose([e(fixed[fixed.length - 1].id, 'cutNoEffect')], fixed as never);
    expect(d.roots[0].knurl).toBe('fixed');
    const face = made({});
    expect(diagnose([e(face[face.length - 1].id, 'cutNoEffect')], face as never).roots[0].knurl).toBe('face');
    expect(diagnose([e('F3', 'nothingToCut')], [{ id: 'F3', type: 'knurlBand' }]).roots[0].knurl).toBe('fixed');
  });
  it('only a cut that found nothing, and only the features of a knurl', () => {
    const fixed = made({ target: target({ ends: undefined }) });
    expect(diagnose([e(fixed[fixed.length - 1].id, 'booleanFailed')], fixed as never).roots[0].knurl).toBeUndefined();
    expect(diagnose([e('F9', 'cutNoEffect')], [...fixed, { id: 'F9', type: 'extrude' }] as never).roots[0].knurl).toBeUndefined();
  });
});

describe('knurl({ onFace }) in a script', () => {
  const base = { radius: 10, from: 15, to: 25, count: 24, depth: 0.5, onFace: { face: 'F2.C1', at: 30 } };
  it('builds the cut grooves from the face', () => {
    const ops = knurlEditOps(base, 3) as unknown as Op[];
    expect(ops.map((x) => x.feature.type)).toEqual(['plane', 'sketch', 'extrude']);
  });
  it('says what it cannot do: a cosmetic knurl, the faceted method, a face with no name', () => {
    expect(() => knurlEditOps({ ...base, mode: 'cosmetic' }, 3)).toThrow(/cosmetic knurl is a record at fixed positions/);
    expect(() => knurlEditOps({ ...base, pattern: 'diamond' }, 3)).toThrow(/method: 'boolean'/);
    expect(() => knurlEditOps({ ...base, onFace: { face: ' ', at: 30 } }, 3)).toThrow(/onFace must be/);
  });
});
