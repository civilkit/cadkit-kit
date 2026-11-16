import { describe, expect, it } from 'vitest';
import type { Ctx } from './featureCommands';
import { boundingSolidOps, coilOps, domeOps, offsetSurfaceOps, pipeOps, splitFaceOps, torusOps } from './featureCreators';

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
