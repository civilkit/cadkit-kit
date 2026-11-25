import { describe, expect, it } from 'vitest';
import type { Ctx } from './featureCommands';
import { surfaceRevolveOps, CREATORS, lipJointOps, wrapOps, boundingSolidOps, coilOps, domeOps, offsetSurfaceOps, pipeOps, splitFaceOps, torusOps } from './featureCreators';

const box = { min: [0, 0, 0], max: [40, 25, 10] };
const open = { id: 'F1', type: 'sketch', entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'line', p1: 'b', p2: 'c' }] };
const ctx = (over: Partial<Ctx> = {}, features: unknown[] = []): Ctx => ({ doc: { features } as never, selection: [], mode: 'face', box, edges: [], ...over });
const one = (ops: unknown): Record<string, unknown> => ((ops as Array<{ feature: Record<string, unknown> }>)[0]).feature;

describe('creators for the solids made from numbers', () => {
  it('torus: a ring at the origin about Z, sized from the body, with no body a 40 mm span; none without a document', () => {
    expect(one(torusOps(ctx()))).toMatchObject({ type: 'torus', op: 'add', center: [0, 0, 0], axis: 'z', majorRadius: 10, minorRadius: 2 });
    expect(one(torusOps(ctx({ box: null })))).toMatchObject({ majorRadius: 10 });
    expect(torusOps(ctx({ doc: null }))).toBeNull();
  });
  it('pipe: needs an open sketch, and runs along it', () => {
    expect(pipeOps(ctx())).toBeNull();
    expect(one(pipeOps(ctx({}, [open])))).toMatchObject({ type: 'pipe', op: 'add', path: { kind: 'sketch', id: 'F1' } });
  });
  it('coil: a 1 mm wire, pitch above its diameter', () => {
    const f = one(coilOps(ctx()));
    expect(f).toMatchObject({ type: 'coil', wireRadius: 1, radius: 10 });
    expect(f.pitch as number).toBeGreaterThan(2);
  });
  it('bounding solid: round every body with nothing picked, round the picked bodies by name or face, needs a body', () => {
    expect(one(boundingSolidOps(ctx()))).toEqual({ type: 'boundingSolid', padding: 0 });
    const rows = () => [{ docName: 'A', faces: ['F2.C1'] }, { faces: ['F4.C1'] }, { faces: ['F6.C1'] }];
    expect(one(boundingSolidOps(ctx({ selection: ['F2.C1', 'F4.C1'], bodyRows: rows })))).toMatchObject({ bodies: [{ body: 'A' }, { face: 'F4.C1' }] });
    expect(boundingSolidOps(ctx({ box: null }))).toBeNull();
  });
});

describe('creators for dome, split face and offset surface', () => {
  it('dome: exactly one picked face', () => {
    expect(domeOps(ctx())).toBeNull();
    expect(domeOps(ctx({ selection: ['F2.C1', 'F2.C0'] }))).toBeNull();
    expect(one(domeOps(ctx({ selection: ['F2.C1'] })))).toMatchObject({ type: 'dome', face: 'F2.C1', height: 2 });
  });
  it('dome: offered only for a face bounded by one round outline (the kernel refuses any other with invalidValue)', () => {
    const ring = (r: number, n = 24) => Array.from({ length: n + 1 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), 5]);
    const edge = (key: string, face: string, pts: number[][]) => ({ key, faces: [face, 'F2.C9'], pts });
    expect(one(domeOps(ctx({ selection: ['F2.C1'], edges: [edge('e', 'F2.C1', ring(10))] })))).toMatchObject({ type: 'dome' });
    // a rectangle: four edges, so refused (the button is off)
    const rect = [[0, 0, 5], [40, 0, 5], [40, 25, 5], [0, 25, 5]];
    const four = rect.map((p, i) => edge('r' + i, 'F2.C1', [p, rect[(i + 1) % 4]]));
    expect(domeOps(ctx({ selection: ['F2.C1'], edges: four }))).toBeNull();
    // one closed outline that is not a circle (an ellipse)
    const ell = ring(10).map(([x, y, z]) => [x * 2, y, z]);
    expect(domeOps(ctx({ selection: ['F2.C1'], edges: [edge('e', 'F2.C1', ell)] }))).toBeNull();
    // an open arc is not a closed outline either
    expect(domeOps(ctx({ selection: ['F2.C1'], edges: [edge('e', 'F2.C1', ring(10).slice(0, 12))] }))).toBeNull();
    // no edge data for the face: not judged
    expect(one(domeOps(ctx({ selection: ['F2.C1'], edges: [] })))).toMatchObject({ type: 'dome' });
  });
  it('lip joint: widths in millimetres on a solid body, a share of the wall after a Shell', () => {
    expect(one(lipJointOps(ctx()))).toMatchObject({ type: 'lipJoint', width: 1, inset: 0.5 });
    expect(one(lipJointOps(ctx()))).not.toHaveProperty('widthRatio');
    const hollow = one(lipJointOps(ctx({}, [{ id: 'F3', type: 'shell' }])));
    expect(hollow).toMatchObject({ widthRatio: 0.5 });
    expect(hollow).not.toHaveProperty('width');
  });
  it('split face: the plane across the middle of the longest side (X: the right plane at 20)', () => {
    expect(splitFaceOps(ctx())).toBeNull();
    expect(one(splitFaceOps(ctx({ selection: ['F2.C1'] })))).toMatchObject({ type: 'splitLine', faces: ['F2.C1'], plane: { kind: 'std', id: 'right' }, offset: 20 });
  });
  it('offset surface: picked faces, else the surface in the tree, else nothing', () => {
    expect(offsetSurfaceOps(ctx())).toBeNull();
    expect(one(offsetSurfaceOps(ctx({ selection: ['F2.C1'] })))).toMatchObject({ type: 'surfaceOffset', faces: ['F2.C1'], distance: 0.5 });
    const surf = { id: 'F4', type: 'surfacePlanar', sketch: 'F1' };
    expect(one(offsetSurfaceOps(ctx({ box: null, selectedId: 'F4' }, [surf])))).toMatchObject({ type: 'surfaceOffset', surface: 'F4' });
  });
});

describe('wrap', () => {
  const closed = { id: 'F1', type: 'sketch', entities: [{ id: 'e1', type: 'circle', c: 'a', r: 3 }] };
  const text = { id: 'F2', type: 'sketch', entities: [{ id: 'e1', type: 'text', text: 'Hi' }] };
  it('needs a body, exactly one picked face, and a sketch of closed shapes or lettering', () => {
    expect(wrapOps(ctx({ selection: ['F3.C1'] }))).toBeNull();                      // no sketch
    expect(wrapOps(ctx({ selection: [] }, [closed]))).toBeNull();                   // no face
    expect(wrapOps(ctx({ selection: ['F3.C1', 'F3.C0'] }, [closed]))).toBeNull();   // two faces
    expect(wrapOps(ctx({ selection: ['F3.C1'], box: null }, [closed]))).toBeNull(); // no body
    expect(wrapOps(ctx({ selection: ['F3.C1'] }, [open]))).toBeNull();              // open curve: that is Project curve
  });
  it('cuts the sketch into the face with the kernel defaults', () => {
    expect(one(wrapOps(ctx({ selection: ['F3.C1'] }, [closed])))).toMatchObject({ type: 'wrap', sketch: 'F1', face: 'F3.C1', op: 'cut', method: 'auto', alongAxis: 0, around: 0, rotation: 0, taper: 0, flip: false, tolerance: 0.001 });
    expect(one(wrapOps(ctx({ selection: ['F3.C1'] }, [closed, text])))).toMatchObject({ sketch: 'F2' });   // the last fitting sketch
  });
});

describe('surface revolve (audit)', () => {
  const sk = (entities: unknown[]) => ({ id: 'F1', type: 'sketch', entities, points: [], constraints: [] });
  const line = (id: string, construction = false) => ({ id, type: 'line', p1: 'a', p2: 'b', ...(construction ? { construction: true } : {}) });
  it('takes an open profile beside a construction axis (the kernel revolves it), as well as a closed one', () => {
    const open = sk([line('e1'), line('ax', true)]);
    expect(one(surfaceRevolveOps(ctx({}, [open])))).toMatchObject({ type: 'surfaceRevolve', sketch: 'F1', axis: 'ax' });
    const enabled = CREATORS.find((k) => k.id === 'add-surface-revolve')!.enabled;
    expect(enabled(ctx({}, [open]))).toBe(true);
    expect(enabled(ctx({}, [sk([line('ax', true)])]))).toBe(false);   // an axis and nothing to turn
    expect(enabled(ctx({}, [sk([line('e1')])]))).toBe(false);   // a profile and no axis
  });
});

