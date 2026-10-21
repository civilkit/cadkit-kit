import { describe, expect, it } from 'vitest';
import { leaveDirection, tangentChain, type ChainEdge } from './tangentChain';

const line = (key: string, faces: string[], a: number[], b: number[], n = 2): ChainEdge => ({ key, faces, pts: Array.from({ length: n }, (_, i) => a.map((x, k) => x + ((b[k] - x) * i) / (n - 1))) });
/** An arc in the z = 0 plane, `n` points (so a coarse arc has few). */
const arc = (key: string, faces: string[], c: number[], r: number, a0: number, a1: number, n = 9, z = 0): ChainEdge => ({
  key, faces, pts: Array.from({ length: n }, (_, i) => { const a = ((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), z]; }),
});

describe('leaveDirection', () => {
  it('is the exact tangent of a coarsely sampled arc, not the first chord', () => {
    const e = arc('a', ['t', 's'], [0, 0], 10, 0, 90, 3);       // two 45 degree chords
    const d = leaveDirection(e.pts, true)!;
    expect(Math.abs(d[0])).toBeLessThan(1e-9);                   // leaves (10,0) straight up
    expect(d[1]).toBeCloseTo(1, 9);
    const end = leaveDirection(e.pts, false)!;                   // leaves (0,10) back into the edge, towards +x
    expect(end[0]).toBeCloseTo(1, 9);
    expect(Math.abs(end[1])).toBeLessThan(1e-9);
  });
  it('is the direction of a line', () => {
    expect(leaveDirection([[0, 0, 0], [0, 5, 0]], true)).toEqual([0, 1, 0]);
    expect(leaveDirection([[0, 0, 0], [0, 5, 0]], false)).toEqual([0, -1, 0]);
  });
});

describe('tangentChain', () => {
  it('a ring split into two arcs: picking one gives both', () => {
    const faces = ['top', 'wall'];
    const edges = [arc('r1', faces, [0, 0], 5, 0, 180, 6), arc('r2', faces, [0, 0], 5, 180, 360, 6)];
    expect(tangentChain(['r1'], edges)).toEqual(['r1', 'r2']);
  });
  it('sibling arcs of a ring are found even where the arc ends do not meet, and a concentric ring of another radius is not', () => {
    const faces = ['top', 'wall'];
    const edges = [arc('r1', faces, [0, 0], 5, 0, 170, 8), arc('r2', faces, [0, 0], 5, 190, 350, 8), arc('big', faces, [0, 0], 8, 0, 90, 8), arc('other', ['top', 'x'], [0, 0], 5, 0, 20, 4)];
    expect(tangentChain(['r1'], edges)).toEqual(['r1', 'r2']);
  });
  it('a closed ring edge stays one edge', () => {
    const ring = arc('c', ['top', 'wall'], [0, 0], 5, 0, 360, 17);
    expect(tangentChain(['c'], [ring])).toEqual(['c']);
  });
  describe('rounded rectangle outline (4 lines, 4 arcs)', () => {
    const W = 40, H = 20, R = 4;
    // the top face edge loop; every edge has the top face and its own wall
    const edges: ChainEdge[] = [
      line('bottom', ['top', 'w1'], [R, 0, 0], [W - R, 0, 0], 2),
      arc('c1', ['top', 'w2'], [W - R, R], R, -90, 0, 7),
      line('right', ['top', 'w3'], [W, R, 0], [W, H - R, 0], 2),
      arc('c2', ['top', 'w4'], [W - R, H - R], R, 0, 90, 7),
      line('topl', ['top', 'w5'], [W - R, H, 0], [R, H, 0], 2),
      arc('c3', ['top', 'w6'], [R, H - R], R, 90, 180, 7),
      line('left', ['top', 'w7'], [0, H - R, 0], [0, R, 0], 2),
      arc('c4', ['top', 'w8'], [R, R], R, 180, 270, 7),
      // the vertical seams between the walls: perpendicular to the outline, never part of the chain
      line('seam', ['w1', 'w2'], [W - R, 0, 0], [W - R, 0, -10], 2),
    ];
    it('one line brings the other seven, in the order met', () => {
      const got = tangentChain(['bottom'], edges);
      expect(new Set(got)).toEqual(new Set(['bottom', 'c1', 'right', 'c2', 'topl', 'c3', 'left', 'c4']));
      expect(got[0]).toBe('bottom');
      expect(got).not.toContain('seam');
    });
    it('one arc brings the lot as well', () => {
      expect(tangentChain(['c3'], edges)).toHaveLength(8);
    });
    it('every seed is kept, unknown keys are ignored', () => {
      expect(tangentChain(['nope', 'seam'], edges)).toEqual(['seam']);
    });
  });
  it('a corner that is not tangent stops the chain', () => {
    const faces = ['top', 'a'];
    const edges = [line('e1', faces, [0, 0, 0], [10, 0, 0]), line('e2', ['top', 'b'], [10, 0, 0], [10, 10, 0]), line('e3', ['top', 'c'], [10, 10, 0], [0, 10, 0]), line('e4', ['top', 'd'], [0, 10, 0], [0, 0, 0])];
    expect(tangentChain(['e1'], edges)).toEqual(['e1']);
  });
  it('a tiny kink is inside the tolerance, a larger one is not', () => {
    const e1 = line('e1', ['top', 'a'], [0, 0, 0], [10, 0, 0]);
    const kink = (deg: number) => line('e2', ['top', 'b'], [10, 0, 0], [10 + 10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180), 0]);
    expect(tangentChain(['e1'], [e1, kink(0.5)])).toEqual(['e1', 'e2']);
    expect(tangentChain(['e1'], [e1, kink(3)])).toEqual(['e1']);
    expect(tangentChain(['e1'], [e1, kink(3)], { tolDeg: 5 })).toEqual(['e1', 'e2']);
  });
  it('tangent edges that share no face are not joined (a coincidence, not a continuation)', () => {
    const e1 = line('e1', ['top', 'a'], [0, 0, 0], [10, 0, 0]);
    const e2 = line('e2', ['p', 'q'], [10, 0, 0], [20, 0, 0]);
    expect(tangentChain(['e1'], [e1, e2])).toEqual(['e1']);
  });
  it('a line leaving an arc at the arc\'s end is followed (tangent line to a circle)', () => {
    const a = arc('a', ['top', 's1'], [0, 0], 5, 0, 90, 5);       // ends at (0,5), leaving towards -x
    const l = line('l', ['top', 's2'], [0, 5, 0], [-12, 5, 0]);
    expect(tangentChain(['l'], [a, l])).toEqual(['l', 'a']);
  });
  it('edges with other than two faces (open borders) are never used', () => {
    const e1 = line('e1', ['top', 'a'], [0, 0, 0], [10, 0, 0]);
    const border: ChainEdge = { key: 'b', faces: ['top'], pts: [[10, 0, 0], [20, 0, 0]] };
    expect(tangentChain(['e1'], [e1, border])).toEqual(['e1']);
  });
});

describe('tangentChain and smooth edges', () => {
  it('does not walk onto an edge with no crease, and does not go on past it; a picked smooth edge stays', () => {
    const top = ['top', 'slot'], seam = ['top', 'round'];
    const slot = line('slot', top, [3.5, 0, 0], [9.5, 0, 0]);
    const left = { ...line('left', seam, [0, 0, 0], [3.5, 0, 0]), smooth: true };
    const right = { ...line('right', seam, [9.5, 0, 0], [14, 0, 0]), smooth: true };
    const beyond = line('beyond', seam, [-4, 0, 0], [0, 0, 0]);
    expect(tangentChain(['slot'], [slot, left, right, beyond])).toEqual(['slot']);
    expect(tangentChain(['slot'], [slot, { ...left, smooth: false }, right])).toEqual(['slot', 'left']);
    expect(tangentChain(['left'], [slot, left, right])).toEqual(['left', 'slot']);
  });
});

