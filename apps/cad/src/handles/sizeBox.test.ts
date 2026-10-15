import { describe, expect, it } from 'vitest';
import type { PartDoc } from '@ck/part-model';
import { BODY } from '@kit/store';
import { boxFor, depthBox, faceScale, layout, niceStep, opsFor, planSizeBox, shapeModel, shapeSelection, shiftBox, sizeAxis, transformSketch, ownerShape, type Frame3 } from './sizeBox';

const frame: Frame3 = { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const rect = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -20, y: -10 }, { id: 'p2', x: 20, y: -10 }, { id: 'p3', x: 20, y: 10 }, { id: 'p4', x: -20, y: 10 }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })),
  constraints: [{ id: 'c1', type: 'horizontal', refs: ['e1'] }, { id: 'c2', type: 'vertical', refs: ['e2'] }, { id: 'c3', type: 'distance', refs: ['p1', 'p2'], value: 40 }, { id: 'c4', type: 'distance', refs: ['p2', 'p3'], value: 20 }, { id: 'c5', type: 'coincident', refs: ['O', 'p1'] }] };
const circle = { type: 'sketch', id: 'S2', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 5, y: 0 }],
  entities: [{ id: 'k1', type: 'circle', c: 'c', r: 10 }], constraints: [{ id: 'd1', type: 'diameter', refs: ['k1'], value: 20 }] };
const holeSk = { type: 'sketch', id: 'S3', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'h', x: 3, y: 4 }], entities: [{ id: 'pt', type: 'point', p: 'h' }], constraints: [] };
const doc = (extra: unknown[] = []): PartDoc => ({ format: 'ck-part', version: 1, name: 'x', material: 'steel', counters: {}, rollback: null, seq: 20,
  features: [rect, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 30 }, circle, { type: 'extrude', id: 'F4', op: 'add', sketch: 'S2', end: 'mid', depth: 8 }, holeSk,
    { type: 'hole', id: 'H1', sketch: 'S3', kind: 'simple', diameter: 6, end: 'blind', depth: 12 }, ...extra] }) as unknown as PartDoc;
const shape = (id: string) => shapeModel(doc(), id, () => frame, null)!;

describe('size box numbers', () => {
  it('sizeAxis: opposite keeps the other face, symmetric both, anchor scales about the anchor', () => {
    expect(sizeAxis(-20, 20, 'hi', 60, 'opposite', 0)).toEqual([-20, 40]);
    expect(sizeAxis(-20, 20, 'lo', 60, 'opposite', 0)).toEqual([-40, 20]);
    expect(sizeAxis(-20, 20, 'hi', 60, 'symmetric', 0)).toEqual([-30, 30]);
    expect(sizeAxis(0, 40, 'hi', 80, 'anchor', 0)).toEqual([0, 80]);
    expect(sizeAxis(-10, 30, 'hi', 80, 'anchor', 0)).toEqual([-20, 60]);
  });
  it('faceScale makes the dragged face follow the pointer', () => {
    expect(faceScale(0, 40, 'hi', 'opposite', 0)).toBe(1);
    expect(faceScale(0, 40, 'hi', 'symmetric', 0)).toBe(2);
    expect(faceScale(-10, 30, 'hi', 'anchor', 0)).toBeCloseTo(40 / 30);
  });
  it('a rectangle keeps its type: width edit moves the right edge, constraints follow, the broken one is dropped', () => {
    const s = shape('F2');
    expect(s.box).toMatchObject({ u0: -20, u1: 20, v0: -10, v1: 10, d0: 0, d1: 30 });
    const r = opsFor(s, boxFor(s, { u: { side: 'hi', dim: 50 } }, 'opposite'))!;
    expect(r.ops).toHaveLength(1);
    const sk = (r.ops[0] as { feature: any }).feature;
    expect(sk.points.find((p: any) => p.id === 'p2').x).toBe(30);
    expect(sk.points.find((p: any) => p.id === 'p1').x).toBe(-20);
    expect(sk.constraints.find((c: any) => c.id === 'c3').value).toBe(50);
    expect(sk.constraints.find((c: any) => c.id === 'c4').value).toBe(20);
    expect(sk.constraints.some((c: any) => c.id === 'c1')).toBe(true);
    expect(sk.points.find((p: any) => p.id === 'O')).toMatchObject({ x: 0, y: 0 });
  });
  it('symmetric about moves both faces; a fixed point that would have to move refuses', () => {
    const s = shape('F2');
    const sk = (opsFor(s, boxFor(s, { v: { side: 'hi', dim: 40 } }, 'symmetric'))!.ops[0] as { feature: any }).feature;
    expect(sk.points.find((p: any) => p.id === 'p3').y).toBe(20);
    expect(sk.points.find((p: any) => p.id === 'p1').y).toBe(-20);
    const onO = { ...rect, points: rect.points.map((p) => (p.id === 'p1' ? { ...p, x: 0, y: 0, fixed: true } : p)) };
    const prof = (shapeModel({ ...doc(), features: [onO, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 5 }] } as unknown as PartDoc, 'F2', () => frame, null))!;
    expect(opsFor(prof, boxFor(prof, { u: { side: 'lo', dim: 90 } }, 'opposite'))).toBeNull();
  });
  it('a coincident constraint the move breaks is dropped and named', () => {
    const s = shape('F2');
    const r = opsFor(s, shiftBox(s.box, 5, 0))!;
    expect(r.dropped).toEqual(['c5']);
  });
  it('depth edits depth; mid keeps the total; a flipped extrude grows the other way', () => {
    const s = shape('F2');
    expect(opsFor(s, depthBox(s, 45))!.ops).toEqual([{ op: 'set', id: 'F2', path: 'depth', value: 45 }]);
    const m = shape('F4');
    expect(m.box).toMatchObject({ d0: -4, d1: 4 });
    expect(opsFor(m, depthBox(m, 20))!.ops).toEqual([{ op: 'set', id: 'F4', path: 'depth', value: 20 }]);
    const fl = shapeModel(doc([]).features.length ? ({ ...doc(), features: doc().features.map((f: any) => (f.id === 'F2' ? { ...f, flip: true } : f)) } as PartDoc) : null, 'F2', () => frame, null)!;
    expect(fl.box).toMatchObject({ d0: -30, d1: 0 });
    expect(depthBox(fl, 50)).toMatchObject({ d0: -50, d1: 0 });
  });
  it('a circle scales uniformly: width edit changes the diameter and the length follows', () => {
    const s = shape('F4');
    expect(s.uniform).toBe(true);
    const b = boxFor(s, { u: { side: 'hi', dim: 40 } }, 'opposite');
    expect(b.v1 - b.v0).toBeCloseTo(40);
    const sk = (opsFor(s, b)!.ops[0] as { feature: any }).feature;
    expect(sk.entities[0].r).toBe(20);
    expect(sk.constraints[0].value).toBe(40);
  });
  it('a hole edits diameter and moves its point; the box is square about the hole', () => {
    const h = shape('H1');
    expect(h.box).toMatchObject({ u0: 0, u1: 6, v0: 1, v1: 7, d0: -12, d1: 0 });
    expect(opsFor(h, boxFor(h, { u: { side: 'hi', dim: 10 } }, 'symmetric'))!.ops[0]).toEqual({ op: 'set', id: 'H1', path: 'diameter', value: 10 });
    const mv = opsFor(h, shiftBox(h.box, 2, -1))!.ops;
    expect((mv[0] as { feature: any }).feature.points.find((p: any) => p.id === 'h')).toMatchObject({ x: 5, y: 3 });
  });
  it('unchanged boxes make no edit', () => {
    const s = shape('F2');
    expect(opsFor(s, s.box)).toBeNull();
  });
  it('transformSketch scales an arc profile through its circle radius', () => {
    const sh = shape('F4');
    const r = transformSketch(circle, sh.profile as never, sh.box, boxFor(sh, { u: { side: 'hi', dim: 10 } }, 'anchor'))!;
    expect(r.sketch.entities[0].r).toBe(5);
    expect(r.sketch.points.find((p: any) => p.id === 'c').x).toBe(5);   // the anchor is the profile's own centre, so Anchor mode keeps it
  });
});

describe('size box selection and layout', () => {
  it('selection: a shape row or the faces of one shape; edges, corners, the body and other features do not', () => {
    const d = doc();
    expect(shapeSelection(d, [], 'face', 'F2')).toBe('F2');
    expect(shapeSelection(d, [], 'face', 'F1')).toBeNull();
    expect(shapeSelection(d, ['F2.C1'], 'face', null)).toBe('F2');
    expect(shapeSelection(d, ['F2.C1', 'F2.S.e1'], 'face', null)).toBe('F2');
    expect(shapeSelection(d, ['F2.C1', 'F4.C1'], 'face', null)).toBeNull();
    expect(shapeSelection(d, ['F2.C1|F2.S.e1'], 'edge', 'F2')).toBeNull();
    expect(shapeSelection(d, ['F2.C1|F2.S.e1'], 'face', 'F2')).toBeNull();
    expect(shapeSelection(d, [BODY], 'face', 'F2')).toBeNull();
    expect(shapeSelection(d, ['FL.B0'], 'face', null)).toBeNull();
    expect(ownerShape(d, 'H1.S.h1')).toBe('H1');
  });
  it('layout: a box, six face handles, four corners, the anchor and three labels for a blind extrude', () => {
    const s = shape('F2');
    const ids = layout(s, s.box, { mode: 'opposite' }).map((x) => x.id);
    expect(ids).toEqual(['box', 'u1', 'u0', 'v1', 'v0', 'df', 'c++', 'c+-', 'c-+', 'c--', 'move', 'anchor', 'ghost', 'guides', 'lw', 'll', 'lh']);
    const box = layout(s, s.box, { mode: 'opposite' })[0];
    expect(box.lines).toHaveLength(24);
    const u1 = layout(s, s.box, { mode: 'opposite' }).find((x) => x.id === 'u1')!;
    expect(u1).toMatchObject({ origin: [20, 0, 15], axis: [1, 0, 0], base: 40, scale: 1, shiftSnaps: true });
    expect(niceStep(7)).toBe(1); expect(niceStep(40)).toBe(5); expect(niceStep(300)).toBe(10);
  });
  it('the session: drag steps preview the same ops a release commits, and a live layout follows the value', () => {
    const s = planSizeBox({ doc: doc(), shapeId: 'F2', frameOf: () => frame, bodyBox: null, mode: 'opposite' })!;
    expect(s.kind).toBe('size-box');
    expect(s.preview('u1', 50, [0, 0, 0])).toEqual(s.commit('u1', 50, [0, 0, 0])!.ops);
    expect(s.preview('u1', 0, [0, 0, 0])).toBeNull();
    expect(s.preview('u1', 40, [0, 0, 0])).toBeNull();
    const live = s.live!('u1', 50, [0, 0, 0])!;
    expect(live.find((x) => x.id === 'lw')!.text).toBe('50');
    expect(s.preview('c++', 0, [10, 5, 0])).not.toBeNull();
    expect(s.format!('u1', 50)).toBe('Width 50 mm');
    const a = s.live!('anchor', 3, [3, 0, 0])!;
    expect(a.find((x) => x.id === 'anchor')!.origin).toEqual([3, 0, 0]);   // the shape's anchor (its centre) is at the origin here
  });
});
