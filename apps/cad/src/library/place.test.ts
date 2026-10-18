import { describe, expect, it } from 'vitest';
import { analyse, placeFeatures } from './place';
import { inlineVariables } from './insert';
import type { PartDoc } from '@ck/part-model';
import type { PlaceTarget } from '../catalog/shapes';

type Obj = Record<string, unknown>;
const sk = (id: string, plane: unknown, at = 0): Obj => ({ type: 'sketch', id, plane, points: [{ id: 'p1', x: at, y: at, fixed: true }, { id: 'p2', x: at + 10, y: at }], entities: [], constraints: [] });
const ext = (id: string, sketch: string, extra: Obj = {}): Obj => ({ type: 'extrude', id, op: 'add', sketch, end: 'blind', depth: 5, ...extra });
const front = { kind: 'std', id: 'front' };
const groundTop: PlaceTarget = { kind: 'ground', point: [3, 0, -4], plane: { kind: 'std', id: 'top' }, uv: [3, 4] };
const topFace: PlaceTarget = { kind: 'face', face: 'F9.C1', planar: true, frame: { o: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, point: [30, 40, 20] };

describe('which parts can be moved', () => {
  it('a part drawn on one plane can', () => {
    expect(analyse([sk('F1', front), ext('F2', 'F1')])).toMatchObject({ p0: 'front' });
  });
  it('a part on several planes, with world axes or world coordinates, or an assembly, cannot', () => {
    expect(analyse([sk('F1', front), sk('F2', { kind: 'std', id: 'top' }), ext('F3', 'F1')])).toBe('otherPlanes');
    expect(analyse([sk('F1', front), ext('F2', 'F1'), { type: 'revolve', id: 'F3', sketch: 'F1', axis: { kind: 'axis', axis: 'x' } }])).toBe('global');
    expect(analyse([sk('F1', front), ext('F2', 'F1'), { type: 'lpattern', id: 'F3', dir: [1, 0, 0] }])).toBe('global');
    expect(analyse([sk('F1', front), ext('F2', 'F1'), { type: 'mirror', id: 'F3', plane: { kind: 'std', id: 'front' } }])).toBe('otherPlanes');
    expect(analyse([sk('F1', front), { type: 'insertPart', id: 'F2' }])).toBe('assembly');
    expect(analyse([sk('F1', { kind: 'face', id: 'F0.C1' }), ext('F2', 'F1')])).toBe('noStdRoot');
  });
  it('planes made from the part\'s own plane by offsets are followed; other modes are not', () => {
    const off = { type: 'plane', id: 'F2', mode: 'offset', base: front, offset: 5 };
    expect(analyse([sk('F1', front), off, sk('F3', { kind: 'feature', id: 'F2' })])).toMatchObject({ p0: 'front', derived: new Set(['F2']) });
    expect(analyse([sk('F1', front), { ...off, mode: 'perpendicular' }])).toBe('otherPlanes');
  });
});

describe('moving a part', () => {
  it('re-seats the root sketches on the target plane and shifts them to the drop point', () => {
    const f = [sk('F1', front), ext('F2', 'F1')];
    const r = placeFeatures(f, groundTop);
    expect(r.moved).toBe(true);
    expect(f[0].plane).toEqual({ kind: 'std', id: 'top' });
    expect(f[0].points).toEqual([{ id: 'p1', x: 3, y: 4, fixed: true }, { id: 'p2', x: 13, y: 4 }]);
    expect(f[1]).toMatchObject({ id: 'F2', sketch: 'F1' });                 // everything else hangs off the sketch
  });
  it('on a face: the sketch goes on the face, shifted by the drop point in the face frame', () => {
    const f = [sk('F1', front), ext('F2', 'F1')];
    expect(placeFeatures(f, topFace).moved).toBe(true);
    expect(f[0].plane).toEqual({ kind: 'face', id: 'F9.C1' });
    expect((f[0].points as Array<{ x: number; y: number }>)[0]).toMatchObject({ x: 30, y: 40 });
  });
  it('offset planes and the sketches on them move with the part; a sketch on a face of the part does not', () => {
    const f = [sk('F1', front), ext('F2', 'F1'), { type: 'plane', id: 'F3', mode: 'offset', base: front, offset: 5 }, sk('F4', { kind: 'feature', id: 'F3' }), sk('F5', { kind: 'face', id: 'F2.C1' })];
    placeFeatures(f, groundTop);
    expect(f[2].base).toEqual({ kind: 'std', id: 'top' });
    expect((f[3].points as Array<{ x: number }>)[0].x).toBe(3);
    expect((f[4].points as Array<{ x: number }>)[0].x).toBe(0);
    expect(f[4].plane).toEqual({ kind: 'face', id: 'F2.C1' });
  });
  it('an edge point is carried to where the edge is now (face frame, then flipped on a plane)', () => {
    const fillet = (): Obj => ({ type: 'fillet', id: 'F3', radius: 1, edges: [{ faces: ['F2.S.e1', 'F2.S.e2'], at: [10, 0, 2.5] }] });
    const f = [sk('F1', front), ext('F2', 'F1'), fillet()];
    placeFeatures(f, topFace);
    expect(((f[2].edges as Array<{ at: number[] }>)[0]).at).toEqual([40, 40, 22.5]);     // 20 (face) + 2.5 up the normal
    const g = [sk('F1', front), ext('F2', 'F1'), fillet()];
    placeFeatures(g, groundTop, false);
    expect(((g[2].edges as Array<{ at: number[] }>)[0]).at).toEqual([13, 2.5, -4]);      // top plane: up is +Y, sketch y runs along -Z
  });
  it('Direction down flips the extrusions and the edge points on a plane; a datum plane feature cannot carry edge points', () => {
    const f = [sk('F1', front), ext('F2', 'F1'), { type: 'fillet', id: 'F3', edges: [{ faces: ['a', 'b'], at: [0, 0, 2] }] }];
    placeFeatures(f, { ...groundTop, place: { flip: true, rot: 0, mirror: false } }, true);
    expect(f[1].flip).toBe(true);
    expect(((f[2].edges as Array<{ at: number[] }>)[0]).at).toEqual([3, -2, -4]);
    const r = placeFeatures([sk('F1', front), ext('F2', 'F1'), { type: 'fillet', id: 'F3', edges: [{ faces: ['a', 'b'], at: [0, 0, 2] }] }], { kind: 'ground', point: [0, 0, 0], plane: { kind: 'feature', id: 'F7' }, uv: [0, 0] });
    expect(r).toMatchObject({ moved: false, why: 'edges' });
  });
  it('a curved face and a part that cannot move leave the part untouched, with the reason', () => {
    const f = [sk('F1', front), ext('F2', 'F1')];
    expect(placeFeatures(f, { kind: 'face', face: 'F2.S.e1', planar: false, point: [0, 0, 0] })).toMatchObject({ moved: false, why: 'curved' });
    const g = [sk('F1', front), sk('F2', { kind: 'std', id: 'right' })];
    expect(placeFeatures(g, topFace)).toMatchObject({ moved: false, why: 'otherPlanes' });
    expect(g[0].plane).toEqual(front);
    expect((g[0].points as Array<{ x: number }>)[0].x).toBe(0);
  });
});

describe('Rotate: one moveBody after the part, ground drops only', () => {
  it('a ground drop turns the part about the plane normal through the drop point, selecting its own solids by feature id', () => {
    const f = [sk('F1', front), ext('F2', 'F1'), ext('F3', 'F1', { op: 'cut' })];
    const r = placeFeatures(f, groundTop, false, 1);
    expect(r).toMatchObject({ moved: true, rotated: true });
    const m = f[f.length - 1];
    expect(m).toMatchObject({ type: 'moveBody', id: 'F4', bodies: [{ feature: 'F2' }], rotate: { axis: [0, 1, 0], origin: [3, 0, -4], angle: 90 } });
    expect(f.slice(0, 3).map((x) => x.id)).toEqual(['F1', 'F2', 'F3']);          // the part's own features are untouched
  });
  it('quarter turns: 2 is 180 degrees, 3 is 270', () => {
    for (const [rot, angle] of [[2, 180], [3, 270]] as const) {
      const f = [sk('F1', front), ext('F2', 'F1')];
      placeFeatures(f, groundTop, false, rot);
      expect((f[f.length - 1].rotate as { angle: number }).angle).toBe(angle);
    }
  });
  it('no rotation adds nothing', () => {
    const f = [sk('F1', front), ext('F2', 'F1')];
    placeFeatures(f, groundTop, false, 0);
    expect(f).toHaveLength(2);
  });
  it('on a face the part fuses into the body: no moveBody, and the result says the rotation was ignored', () => {
    const f = [sk('F1', front), ext('F2', 'F1')];
    expect(placeFeatures(f, topFace, false, 1)).toMatchObject({ moved: true, rotIgnored: true });
    expect(f).toHaveLength(2);
  });
});

describe('inlineVariables (the live preview works with numbers: the open document does not have the part\'s variables yet)', () => {
  it('works every expression out and drops the variables', () => {
    const part = { features: [{ type: 'extrude', id: 'F1', depth: '=t*2' }, { type: 'sketch', id: 'F2', constraints: [{ id: 'c1', type: 'distance', value: 10, expr: 'w+1' }] }], variables: [{ name: 'w', expr: '9' }, { name: 't', expr: 'w/3' }] } as unknown as PartDoc;
    const out = inlineVariables(part) as unknown as { features: Array<Record<string, unknown>>; variables: unknown[] };
    expect(out.features[0].depth).toBe(6);
    expect((out.features[1].constraints as Array<{ expr: string }>)[0].expr).toBe('10');
    expect(out.variables).toEqual([]);
    expect((part as unknown as { variables: unknown[] }).variables).toHaveLength(2);     // the original is untouched
  });
});
