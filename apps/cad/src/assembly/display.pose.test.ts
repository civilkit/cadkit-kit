import { describe, expect, it } from 'vitest';
import { deltaBetween, type Frame } from '@kit/motion';
import { displayBody, type ShowBody } from './display';

const frame = (o: number[], deg = 0): Frame => {
  const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
  return { o, x: [c, 0, -s], y: [0, 1, 0], z: [s, 0, c] };
};
const near = (a: number[], b: number[], tol = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));

describe('displayBody with a pose', () => {
  const body: ShowBody = {
    mesh: { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), triFace: new Int32Array([0, 1]), faceIds: ['F1.C0@F1.1', 'F1.C0@F2.1'] },
    edges: [{ key: 'F1.S.e1@F2.1|F1.S.e2@F2.1', pts: [[5, 0, 0], [6, 0, 0]] }],
    box: { min: [0, 0, 0], max: [6, 1, 0] },
  };
  const inserts = new Set(['F1', 'F2']);
  const base = { inserts, hidden: new Set<string>(), explode: { spread: 0, dir: 'auto' as const, manual: {} } };
  it('returns the same body with no pose', () => { expect(displayBody(body, base)).toBe(body); });
  it('moves only the posed component, with its normals and edges', () => {
    const turn90 = deltaBetween(frame([0, 0, 0]), frame([0, 0, 0], 90)); // about +y: x -> -z
    const shown = displayBody(body, { ...base, pose: new Map([['F2', turn90]]) });
    const P = shown.mesh.positions;
    near([...P.slice(0, 9)], [0, 0, 0, 1, 0, 0, 0, 1, 0]); // F1 untouched
    near([...P.slice(9, 12)], [0, 0, -5], 1e-6); // (5,0,0) turned about y by 90 degrees
    near([...shown.mesh.normals.slice(9, 12)], [1, 0, 0], 1e-6); // (0,0,1) -> (1,0,0)
    near(shown.edges[0].pts[1], [0, 0, -6], 1e-6);
  });
});
