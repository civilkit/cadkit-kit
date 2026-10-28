import { describe, expect, it } from 'vitest';
import { DEFAULT_BEARING, bearingIssue, bearingNumbers, bearingOpts, bearingOps, bearingSeat, bearingSpec, findBearings, seatOnFace, withPreset, type BearingParams, type FaceMesh } from './bearing';
import { BEARING_PRESETS } from '@kit/script';

const P = (o: Partial<BearingParams> = {}): BearingParams => ({ ...DEFAULT_BEARING, ...o });

describe('bearing wizard rules', () => {
  it('the default record is a valid 608 and makes ops', () => {
    expect(bearingIssue(P())).toBeNull();
    expect(P()).toMatchObject({ designation: '608', bore: 8, od: 22, width: 7 });
    const ops = bearingOps({ features: [] }, P());
    expect(ops.length).toBeGreaterThanOrEqual(4);   // two sketches and two revolves
  });
  it('every preset is valid in every seal type', () => {
    for (const p of BEARING_PRESETS) for (const seal of ['open', '2Z', '2RS'] as const) {
      expect(bearingIssue(withPreset(P({ seal }), p)), `${p.designation} ${seal}`).toBeNull();
    }
  });
  it('a preset fills the sizes and clears the ball overrides; a seal suffix also sets the seal', () => {
    const r6204 = BEARING_PRESETS.find((p) => p.designation === '6204')!;
    const next = withPreset(P({ balls: 5, ballDiameter: 3 }), r6204, '2RS');
    expect(next).toMatchObject({ designation: '6204', bore: 20, od: 47, width: 14, seal: '2RS', balls: null, ballDiameter: null });
    expect(withPreset(P({ seal: 'open' }), r6204).seal).toBe('open');
  });
  it('maps the options of the helper: sealed bearings drop the ball options, the axis becomes a vector', () => {
    expect(bearingOpts(P({ balls: 6, ballDiameter: 3 }))).not.toHaveProperty('balls');
    expect(bearingOpts(P({ seal: 'open', balls: 6, ballDiameter: 3 }))).toMatchObject({ balls: 6, ballDiameter: 3, seal: 'open' });
    expect(bearingOpts(P({ axis: 'nx' })).axis).toEqual([-1, 0, 0]);
    expect(bearingOpts(P())).toMatchObject({ bore: 8, od: 22, width: 7, name: 'Bearing 608', origin: [0, 0, 0] });
    expect(bearingOpts(P({ designation: '' }))).not.toHaveProperty('name');
    expect(bearingOpts(P({ chamfer: 0.5 }))).toMatchObject({ chamfer: 0.5 });
    expect(bearingOpts(P())).not.toHaveProperty('chamfer');
  });
  it('asks for the seat only when the bearing is placed on a face and the box is ticked', () => {
    expect(bearingOpts(P({ seat: true }))).not.toHaveProperty('seat');
    expect(bearingOpts(P({ seat: false, placedOn: 'F1.C1' }))).not.toHaveProperty('seat');
    expect(bearingOpts(P({ seat: true, placedOn: 'F1.C1', seatFit: 'print' }))).toMatchObject({ seat: { fit: 'print' } });
  });
  it('fills in the numbers the model chose, and none for a bad record', () => {
    const n = bearingNumbers(P({ seal: 'open' }))!;
    expect(n.balls).toBe(7);
    expect(n.chamfer).toBe(0.3);
    expect(bearingNumbers(P({ seal: 'open', balls: 5 }))!.balls).toBe(5);
    expect(bearingNumbers(P({ bore: 30 }))).toBeNull();
    expect(bearingSpec(P({ seal: '2Z', balls: 5 }))).not.toHaveProperty('balls');
  });
  it('the housing seat read-out follows the fit', () => {
    expect(bearingSeat(P()).diameter).toBeCloseTo(22.0105, 3);
    expect(bearingSeat(P()).depth).toBe(7);
    expect(bearingSeat(P({ seatFit: 'press' })).diameter).toBe(22);
    expect(bearingSeat(P({ seatFit: 'print' })).diameter).toBeCloseTo(22.2, 9);
    expect(bearingSeat(P({ od: 47, width: 14 })).note).toMatch(/H7/);
  });
  it('reports bad sizes and model problems without the kernel', () => {
    expect(bearingIssue(P({ bore: 0 }))?.code).toBe('size');
    expect(bearingIssue(P({ width: -1 }))?.code).toBe('size');
    expect(bearingIssue(P({ bore: 22 }))?.code).toBe('size');
    expect(bearingIssue(P({ od: Number.NaN }))?.code).toBe('size');
    expect(bearingIssue(P({ chamfer: 3 }))).toMatchObject({ code: 'model', message: expect.stringMatching(/half the ring thickness/) });
    expect(bearingIssue(P({ seal: 'open', balls: 20 }))).toMatchObject({ code: 'model', message: expect.stringMatching(/do not fit/) });
    expect(bearingIssue(P({ seal: 'open', ballDiameter: 9 }))?.code).toBe('model');
  });
  it('numbers the new features from the next free id', () => {
    const ops = bearingOps({ features: [{ id: 'F1' }, { id: 'F7' }] }, P()) as unknown as Array<{ feature: { id: string } }>;
    expect(ops[0].feature.id).toBe('F8');
  });
  it('an open bearing records the balls too; a seat comes before the rings', () => {
    const open = bearingOps({ features: [] }, P({ seal: 'open' })) as unknown as Array<{ feature: { type: string; op?: string; body?: string } }>;
    const closed = bearingOps({ features: [] }, P()) as unknown as Array<{ feature: { type: string } }>;
    expect(open.length).toBeGreaterThan(closed.length);
    expect(open.filter((o) => o.feature.type === 'revolve').length).toBe(3);   // inner ring, outer ring, one ball (patterned)
    expect(open.some((o) => o.feature.type === 'cpattern')).toBe(true);
    const seated = bearingOps({ features: [] }, P({ seat: true, placedOn: 'F1.C1' })) as unknown as Array<{ feature: { type: string; op?: string } }>;
    const cut = seated.findIndex((o) => o.feature.type === 'extrude' && o.feature.op === 'cut');
    expect(cut).toBeGreaterThan(-1);
    expect(cut).toBeLessThan(seated.findIndex((o) => o.feature.type === 'revolve'));
  });
});

describe('searching the table', () => {
  it('finds sizes by designation and size', () => {
    expect(findBearings('6204').map((p) => p.designation)).toEqual(['6204']);
    expect(findBearings('MR63').map((p) => p.designation)).toEqual(['MR63']);
    expect(findBearings('8x22').map((p) => p.designation)).toEqual(['608']);
  });
});

/** A square face of side 10 centred on (cx, cy) at height z, two triangles, all normals (0, 0, nz). */
function squareMesh(z: number, nz: number, ids = ['F1.C1']): FaceMesh {
  const [a, b, c, d] = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([x, y]) => [x + 5, y - 20, z]);
  const tri = [a, b, c, a, c, d];
  return { positions: tri.flat(), normals: tri.flatMap(() => [0, 0, nz]), triFace: [0, 0], faceIds: ids };
}

describe('seating on a picked face', () => {
  it('sits at the middle of a top face and extends down into the body', () => {
    expect(seatOnFace('F1.C1', squareMesh(12, 1))).toEqual({ origin: [10, -15, 12], axis: 'nz' });
  });
  it('a bottom face (outward normal -Z) makes the bearing extend up', () => {
    expect(seatOnFace('F1.C1', squareMesh(0, -1))?.axis).toBe('pz');
  });
  it('a side face along X', () => {
    const tri = [[5, 0, 0], [5, 10, 0], [5, 10, 10], [5, 0, 0], [5, 10, 10], [5, 0, 10]];
    const m: FaceMesh = { positions: tri.flat(), normals: tri.flatMap(() => [1, 0, 0]), triFace: [0, 0], faceIds: ['F2.S.e1'] };
    expect(seatOnFace('F2.S.e1', m)).toEqual({ origin: [5, 5, 5], axis: 'nx' });
  });
  it('refuses a tilted face, a curved face, an unknown face and no mesh', () => {
    const s = Math.SQRT1_2;
    const tilted = squareMesh(0, 1); tilted.normals = Array.from(tilted.positions, (_, i) => [0, s, s][i % 3]);
    expect(seatOnFace('F1.C1', tilted)).toBeNull();
    const curved = squareMesh(0, 1); (curved.positions as number[])[2] = 4;
    expect(seatOnFace('F1.C1', curved)).toBeNull();
    expect(seatOnFace('F9.C1', squareMesh(0, 1))).toBeNull();
    expect(seatOnFace('F1.C1', null)).toBeNull();
  });
});
