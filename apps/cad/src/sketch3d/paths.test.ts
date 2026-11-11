import { describe, expect, it } from 'vitest';
import { isClosedSketch, isOpenSketch, pathPatternOps, sweepOps, hasCurves } from '../featureCreators';
import { sketchInfos } from '../surfaceRules';
import type { Ctx } from '../featureCommands';

const spline3d = { type: 'sketch3d', id: 'P', points: [{ id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: 10, y: 5, z: 5 }], entities: [{ id: 'e1', type: 'spline', pts: ['a', 'b'] }], constraints: [] };
const polyline3d = { type: 'sketch3d', id: 'L', points: [], entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }], constraints: [] };
const circle = { type: 'sketch', id: 'S', plane: { kind: 'std', id: 'front' }, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 3 }], constraints: [] };
const ctx = (features: unknown[], selectedId: string | null = null): Ctx => ({ doc: { features } as never, selection: [], mode: 'face', box: null, edges: [], selectedId });

describe('3D sketches as paths', () => {
  it('a 3D sketch with one spline is an open path; a polyline is not, and no 3D sketch is a profile or a curve source', () => {
    expect(isOpenSketch(spline3d as never)).toBe(true);
    expect(isOpenSketch(polyline3d as never)).toBe(false);
    expect(isClosedSketch(spline3d as never)).toBe(false);
    expect(hasCurves(spline3d as never)).toBe(false);
  });
  it('Sweep picks the profile and the 3D spline as the path', () => {
    expect(sweepOps(ctx([spline3d, circle]))).toEqual([{ op: 'add', feature: { type: 'sweep', op: 'add', sketch: 'S', path: { kind: 'sketch', id: 'P' } } }]);
    expect(sweepOps(ctx([polyline3d, circle]))).toBeNull();
  });
  it('the editors list the spline as an open path, marked 3D so guides and loft sections leave it out', () => {
    const infos = sketchInfos({ features: [spline3d, polyline3d, circle] } as never);
    expect(infos.find((s) => s.id === 'P')).toMatchObject({ open: true, closed: false, point: false, d3: true });
    expect(infos.find((s) => s.id === 'L')).toMatchObject({ open: false, d3: true });
    expect(infos.find((s) => s.id === 'S')?.d3).toBeUndefined();
  });
  it('a path pattern follows the 3D spline too', () => {
    const feat = { type: 'extrude', id: 'X', op: 'add', sketch: 'S', end: 'blind', depth: 5 };
    const ops = pathPatternOps(ctx([circle, feat, spline3d]));
    expect(ops?.[0]).toMatchObject({ op: 'add', feature: { type: 'curvepattern', path: { kind: 'sketch', id: 'P' } } });
  });
});
