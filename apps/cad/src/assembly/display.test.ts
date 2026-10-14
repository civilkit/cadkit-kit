import { describe, expect, it } from 'vitest';
import { componentCentres, displayBody, type ShowBody } from './display';

// two triangles of component F1 (face "a@F1.1") and two of F2 ("b@F2.1"; one of them a pattern copy "c@F2.1@F9.1")
const tri = (x: number) => [x, 0, 0, x + 1, 0, 0, x, 1, 0];
const body = (): ShowBody => ({
  mesh: { positions: Float32Array.from([...tri(0), ...tri(10), ...tri(20)]), normals: new Float32Array(27), triFace: Int32Array.from([0, 1, 2]), faceIds: ['a@F1.1', 'b@F2.1', 'c@F2.1@F9.1'] },
  edges: [{ key: 'a@F1.1', pts: [[0, 0, 0], [1, 0, 0]] }, { key: 'b@F2.1|c@F2.1', pts: [[10, 0, 0], [11, 0, 0]], mid: [10.5, 0, 0] }, { pts: [[0, 0, 0], [0, 1, 0]] }],
  box: { min: [0, 0, 0], max: [21, 1, 0] },
});
const ins = new Set(['F1', 'F2']);

describe('displayBody', () => {
  it('is the same object when nothing is hidden or exploded', () => {
    const b = body();
    expect(displayBody(b, { inserts: ins, hidden: new Set(), explode: { spread: 0, dir: 'auto', manual: {} } })).toBe(b);
  });
  it('leaves out hidden components: triangles and edges', () => {
    const d = displayBody(body(), { inserts: ins, hidden: new Set(['F2']), explode: { spread: 0, dir: 'auto', manual: {} } });
    expect(d.mesh.triFace.length).toBe(1);
    expect(d.edges.map((e) => e.key)).toEqual(['a@F1.1', undefined]);
    expect(d.box.max[0]).toBe(1);
  });
  it('moves each component instance from the middle; picking names stay', () => {
    const b = body();
    const { centres, middle } = componentCentres(b, ins);
    expect([...centres.keys()]).toEqual(['F1', 'F2', 'F2@F9.1']);
    expect(middle[0]).toBeCloseTo(10.5);
    const d = displayBody(b, { inserts: ins, hidden: new Set(), explode: { spread: 1, dir: 'x', manual: {} } });
    expect(d.mesh.faceIds).toEqual(b.mesh.faceIds);
    expect(d.mesh.positions[0]).toBeCloseTo(0 + (0.5 - 10.5));   // F1 centre 0.5 -> moves by -10
    expect(d.mesh.positions[9]).toBeCloseTo(10 + (10.5 - 10.5)); // F2 centre = middle -> stays
    expect(d.mesh.positions[18]).toBeCloseTo(20 + 10);            // the copy moves by +10
    expect(d.edges[1].pts[0][0]).toBeCloseTo(10);
    expect(b.mesh.positions[0]).toBe(0);                            // the source is untouched
  });
  it('does nothing for a part with no components', () => {
    const b = body();
    expect(displayBody(b, { inserts: new Set(), hidden: new Set(['F1']), explode: { spread: 2, dir: 'auto', manual: {} } })).toBe(b);
  });
});
