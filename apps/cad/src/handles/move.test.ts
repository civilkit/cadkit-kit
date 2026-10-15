import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { edgeDistance, gridStep, moveCandidates, moveToEdgeDistance, NO_CANDS, resolveMove, type MoveCands } from './move';
import { movesFromFields } from './MoveFields';
import { moveCommit, shapeModel, translateSketch, type Box, type Frame3 } from './sizeBox';

const frame: Frame3 = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const box: Box = { u0: 10, u1: 20, v0: 10, v1: 14, d0: -5, d1: 0 };      // centre (15, 12)
const cands: MoveCands = {
  pts: [{ u: 40, v: 30, kind: 'center' }, { u: 0, v: 0, kind: 'vertex' }, { u: 80, v: 0, kind: 'vertex' }, { u: 60, v: 12, kind: 'circle' }],
  host: { u0: 0, u1: 80, v0: 0, v1: 60 },
};

describe('resolveMove', () => {
  it('Shift keeps the larger component; Ctrl rounds to the grid; Alt leaves the pointer where it is', () => {
    expect(resolveMove(box, { du: 7, dv: 2 }, { shift: true }, NO_CANDS, 0, 1)).toMatchObject({ du: 7, dv: 0, snap: 'axis' });
    expect(resolveMove(box, { du: 1, dv: -9 }, { shift: true }, NO_CANDS, 0, 1)).toMatchObject({ du: 0, dv: -9 });
    expect(resolveMove(box, { du: 7.4, dv: -2.6 }, { ctrl: true }, cands, 5, 1)).toMatchObject({ du: 7, dv: -3, snap: 'grid' });
    expect(resolveMove(box, { du: 24.2, dv: 17.9 }, { alt: true }, cands, 5, 1)).toMatchObject({ du: 24.2, dv: 17.9, snap: null });
  });
  it('the centre snaps to the face centre, a hole centre or a corner inside the tolerance, with the Catalog preference order', () => {
    // centre would be at (15+25.5, 12+18.4) = (40.5, 30.4): within 2 of the face centre (40, 30)
    const r = resolveMove(box, { du: 25.5, dv: 18.4 }, {}, cands, 2, 1);
    expect(r.snap).toBe('center');
    expect(15 + r.du).toBeCloseTo(40); expect(12 + r.dv).toBeCloseTo(30);
    const h = resolveMove(box, { du: 45.5, dv: 0.3 }, {}, cands, 2, 1);
    expect(h.snap).toBe('circle'); expect(15 + h.du).toBeCloseTo(60);
    const c = resolveMove(box, { du: -15.5, dv: -12.4 }, {}, cands, 2, 1);
    expect(c.snap).toBe('vertex'); expect(15 + c.du).toBeCloseTo(0); expect(12 + c.dv).toBeCloseTo(0);
    expect(resolveMove(box, { du: 25.5, dv: 18.4 }, {}, cands, 0.1, 1).snap).toBeNull();
  });
  it('failing a point snap, one axis aligns the centre or a side with a feature or the face edge, and a guide is drawn', () => {
    // side u0 = 10 + 0.8 -> aligns with the host edge u = 0? no: far. Centre u 15+25.6 = 40.6 aligns with u 40 (face centre) but v is far
    const r = resolveMove(box, { du: 25.6, dv: 8 }, {}, cands, 1, 1);
    expect(r.snap).toBe('align');
    expect(15 + r.du).toBeCloseTo(40);
    expect(r.dv).toBeCloseTo(8);
    expect(r.guides).toHaveLength(1);
    expect(r.guides[0][0]).toBeCloseTo(40); expect(r.guides[0][2]).toBeCloseTo(40);
    // the left side against the host's left edge (u = 0): the box is dragged to u0 = 0.4
    const e = resolveMove(box, { du: -9.6, dv: 8 }, {}, { pts: [], host: cands.host }, 1, 1);
    expect(box.u0 + e.du).toBeCloseTo(0);
  });
});

describe('move candidates', () => {
  const ring = Array.from({ length: 33 }, (_, i) => [60 + 4 * Math.cos((i / 32) * 2 * Math.PI), 20 + 4 * Math.sin((i / 32) * 2 * Math.PI), 0]);
  const edges = [
    { pts: [[0, 0, 0], [80, 0, 0]], mid: [40, 0, 0] }, { pts: [[80, 0, 0], [80, 60, 0]], mid: [80, 30, 0] },
    { pts: [[80, 60, 0], [0, 60, 0]], mid: [40, 60, 0] }, { pts: [[0, 60, 0], [0, 0, 0]], mid: [0, 30, 0] },
    { pts: ring, mid: [64, 20, 0] },
    { pts: [[0, 0, -20], [80, 0, -20]], mid: [40, 0, -20] },                   // a bottom edge: not in the plane
    { pts: [[12, 11, 0], [18, 11, 0]], mid: [15, 11, 0] },                     // the shape's own outline
  ];
  it('collects the in-plane corners, midpoints, circle centres and the face centre; skips other planes and the shape itself', () => {
    const c = moveCandidates(frame, box, edges, [{ u: 5, v: 5 }]);
    const has = (u: number, v: number, kind: string) => c.pts.some((p) => Math.abs(p.u - u) < 1e-6 && Math.abs(p.v - v) < 1e-6 && p.kind === kind);
    expect(has(40, 30, 'center')).toBe(true);
    expect(has(60, 20, 'circle')).toBe(true);
    expect(has(40, 0, 'midpoint')).toBe(true);
    expect(has(80, 60, 'vertex')).toBe(true);
    expect(has(5, 5, 'feature')).toBe(true);
    expect(c.pts.some((p) => p.u === 15 && p.v === 11)).toBe(false);
    expect(c.host).toEqual({ u0: 0, u1: 80, v0: 0, v1: 60 });
  });
});

describe('distance from edge and typed fields', () => {
  it('measures and sets the clear distance of the near side', () => {
    const host = { u0: 0, u1: 80, v0: 0, v1: 60 };
    expect(edgeDistance(box, host, 'left')).toBe(10);
    expect(edgeDistance(box, host, 'right')).toBe(60);
    expect(edgeDistance(box, host, 'top')).toBe(46);
    expect(moveToEdgeDistance(box, host, 'left', 4)).toEqual({ du: -6, dv: 0 });
    expect(moveToEdgeDistance(box, host, 'right', 5)).toEqual({ du: 55, dv: 0 });
    expect(moveToEdgeDistance(box, host, 'top', 6)).toEqual({ du: 0, dv: 40 });
  });
  const info = { box, host: { u0: 0, u1: 80, v0: 0, v1: 60 }, step: 1, to: () => null };
  it('fields take numbers and expressions; a bad field is refused; an edge distance replaces that axis', () => {
    const vals = { w: 6 } as never;
    expect(movesFromFields(info, { x: '2+3', y: '', edge: '', dist: '' }, vals)).toEqual({ du: 5, dv: 0 });
    expect(movesFromFields(info, { x: 'w*2', y: '-1,5', edge: '', dist: '' }, vals)).toEqual({ du: 12, dv: -1.5 });
    expect(movesFromFields(info, { x: 'abc', y: '', edge: '', dist: '' }, vals)).toBeNull();
    expect(movesFromFields(info, { x: '3', y: '2', edge: 'left', dist: '4' }, vals)).toEqual({ du: -6, dv: 2 });
  });
  it('the grid step grows with the part', () => { expect(gridStep(box)).toBe(1); expect(gridStep({ ...box, u1: 300 })).toBe(5); expect(gridStep({ ...box, u1: 5000 })).toBe(10); });
});

describe('translating a sketch', () => {
  const sk = {
    type: 'sketch', id: 'S1', plane: { kind: 'std', id: 'front' },
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 0, y: 0, fixed: true }, { id: 'b', x: 10, y: 0 }, { id: 'c', x: 10, y: 5 }, { id: 'd', x: 0, y: 5 }, { id: 'x1', x: -5, y: 2 }, { id: 'x2', x: 15, y: 2 }],
    entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([id, p1, p2]) => ({ id, type: 'line', p1, p2 })).concat([{ id: 'ax', type: 'line', p1: 'x1', p2: 'x2', construction: true } as never]),
    constraints: [{ id: 'k1', type: 'fix', refs: ['a'], value: [0, 0] }, { id: 'k2', type: 'distance', refs: ['a', 'b'], value: 10 }],
  };
  const doc = { features: [sk, { type: 'revolve', id: 'R1', sketch: 'S1', axis: 'ax', angle: 360, op: 'add' }, { type: 'extrude', id: 'X2', sketch: 'S1', op: 'add', depth: 3 }], seq: 5 } as unknown as PartDoc;
  const shape = shapeModel(doc, 'R1', () => frame, null)!;
  it('moves the outline, a pinned corner (its fix value follows) and the construction axis together; sizes stay', () => {
    const r = translateSketch(shape, 7, -2)!;
    const p = (id: string) => r.sketch.points.find((q: { id: string }) => q.id === id);
    expect(p('a')).toMatchObject({ x: 7, y: -2, fixed: true });
    expect(p('c')).toMatchObject({ x: 17, y: 3 });
    expect(p('x1')).toMatchObject({ x: 2, y: 0 }); expect(p('x2')).toMatchObject({ x: 22, y: 0 });
    expect(p('O')).toMatchObject({ x: 0, y: 0 });
    expect(r.sketch.constraints.find((c: { id: string }) => c.id === 'k1').value).toEqual([7, -2]);
    expect(r.sketch.constraints.find((c: { id: string }) => c.id === 'k2').value).toBe(10);
    expect(r.dropped).toEqual([]);
  });
  it('the anchor is the profile centre and the sketch is shared with the other extrude', () => {
    expect(shape.anchor).toEqual({ u: 5, v: 2.5 });
    expect(shape.sharedWith).toEqual(['X2']);
    const c = moveCommit(doc, shape, 3, 0)!;
    expect(c.choices?.map((x) => x.id)).toEqual(['all', 'duplicate']);
    const dup = c.choices![1].ops;
    expect(dup[0]).toMatchObject({ op: 'add', index: 1 });
    expect(dup[1]).toMatchObject({ op: 'set', id: 'R1', path: 'sketch', value: 'F5' });
    const solo = moveCommit({ features: [sk, { type: 'revolve', id: 'R1', sketch: 'S1', axis: 'ax', angle: 360, op: 'add' }], seq: 5 } as unknown as PartDoc, shapeModel({ features: [sk, { type: 'revolve', id: 'R1', sketch: 'S1', axis: 'ax', angle: 360, op: 'add' }] } as unknown as PartDoc, 'R1', () => frame, null)!, 3, 0)!;
    expect(solo.choices).toBeUndefined();
    expect(solo.ops).toHaveLength(1);
  });
});
