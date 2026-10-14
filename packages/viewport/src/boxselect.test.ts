import { describe, expect, it } from 'vitest';
import { boxPick, normRect, segmentHitsRect, triangleHitsRect, type BoxInput } from './boxselect';
import { groupByFace } from './meshgeom';

// orthographic "camera" looking down -z: screen = (x, y)
const project = (p: number[]): [number, number] => [p[0], p[1]];
const quad = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0];
const mesh = () => {
  const positions = Float32Array.from([...quad(0, 0, 10, 10), ...quad(20, 0, 30, 10), ...quad(5, 20, 25, 30)]);
  return groupByFace({ positions, normals: new Float32Array(positions.length), triFace: Int32Array.from([0, 0, 1, 1, 2, 2]), faceIds: ['A', 'B', 'C'] });
};
const input = (over: Partial<BoxInput>): BoxInput => ({
  rect: { x0: -1, y0: -1, x1: 12, y1: 12 }, crossing: false, project, mode: 'face', grouped: mesh(), edges: [], bodies: [], vertexName: (p) => `v:${p.join(',')}`, ...over,
});

describe('rect helpers', () => {
  it('normalises a backwards rect', () => { expect(normRect({ x0: 5, y0: 9, x1: 1, y1: 2 })).toEqual({ x0: 1, y0: 2, x1: 5, y1: 9 }); });
  it('segments: through, outside, inside', () => {
    const r = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(segmentHitsRect(r, -5, 5, 15, 5)).toBe(true);
    expect(segmentHitsRect(r, -5, 20, 15, 20)).toBe(false);
    expect(segmentHitsRect(r, 2, 2, 3, 3)).toBe(true);
    expect(segmentHitsRect(r, -5, -1, 11, -1)).toBe(false);
  });
  it('triangles: overlap by vertex, by crossing, and by containing the box', () => {
    const r = { x0: 4, y0: 4, x1: 6, y1: 6 };
    expect(triangleHitsRect(r, [0, 0], [100, 0], [0, 100])).toBe(true);   // box inside the triangle
    expect(triangleHitsRect(r, [5, 5], [20, 5], [5, 20])).toBe(true);
    expect(triangleHitsRect(r, [50, 50], [60, 50], [50, 60])).toBe(false);
  });
});

describe('faces', () => {
  it('window: only faces wholly inside', () => {
    expect(boxPick(input({ rect: { x0: -1, y0: -1, x1: 12, y1: 12 } }))).toEqual(['A']);
    expect(boxPick(input({ rect: { x0: -1, y0: -1, x1: 35, y1: 12 } })).sort()).toEqual(['A', 'B']);
  });
  it('window: a face poking out is not picked', () => {
    expect(boxPick(input({ rect: { x0: -1, y0: -1, x1: 8, y1: 12 } }))).toEqual([]);
  });
  it('crossing: anything the box touches', () => {
    expect(boxPick(input({ rect: { x0: 8, y0: 8, x1: 22, y1: 22 }, crossing: true })).sort()).toEqual(['A', 'B', 'C']);
    expect(boxPick(input({ rect: { x0: 11, y0: 11, x1: 19, y1: 19 }, crossing: true }))).toEqual([]);
  });
  it('points behind the camera never window-select', () => {
    expect(boxPick(input({ project: (p) => (p[0] < 5 ? null : [p[0], p[1]]) }))).toEqual([]);
  });
});

describe('edges, corners, bodies', () => {
  const edges = [{ key: 'e0', pts: [[1, 1, 0], [9, 1, 0]] }, { key: 'e1', pts: [[8, 5, 0], [40, 5, 0]] }, { pts: [[50, 50, 0], [60, 60, 0]] }];
  it('edge window needs the whole polyline inside; crossing needs a touch', () => {
    expect(boxPick(input({ mode: 'edge', edges, rect: { x0: 0, y0: 0, x1: 12, y1: 12 } }))).toEqual(['e0']);
    expect(boxPick(input({ mode: 'edge', edges, rect: { x0: 0, y0: 0, x1: 12, y1: 12 }, crossing: true }))).toEqual(['e0', 'e1']);
  });
  it('unnamed edges use the edge#index name', () => {
    expect(boxPick(input({ mode: 'edge', edges, rect: { x0: 45, y0: 45, x1: 70, y1: 70 } }))).toEqual(['edge#2']);
  });
  it('corners are edge ends inside the box (both modes alike)', () => {
    const got = boxPick(input({ mode: 'vertex', edges, rect: { x0: 0, y0: 0, x1: 12, y1: 12 } }));
    expect(got.sort()).toEqual(['v:1,1,0', 'v:8,5,0', 'v:9,1,0']);
  });
  it('bodies: window needs every face inside, crossing needs one touched', () => {
    const bodies = [{ name: '@body:A', faces: ['A', 'B'] }, { name: '@body:C', faces: ['C'] }];
    expect(boxPick(input({ mode: 'body', bodies, rect: { x0: -1, y0: -1, x1: 35, y1: 12 } }))).toEqual(['@body:A']);
    expect(boxPick(input({ mode: 'body', bodies, rect: { x0: -1, y0: -1, x1: 12, y1: 12 } }))).toEqual([]);
    expect(boxPick(input({ mode: 'body', bodies, rect: { x0: -1, y0: -1, x1: 12, y1: 12 }, crossing: true }))).toEqual(['@body:A']);
  });
});
