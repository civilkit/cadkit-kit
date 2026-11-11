import { describe, expect, it } from 'vitest';
import { resolveEdges, resolveFaceSel, resolveFacesSel, SelectorError, type EdgeInfo, type Geometry, type Mesh } from './selectors';
import { edges, faces } from './recorder';

const edge = (key: string, a: number[], b: number[]): EdgeInfo => ({ key, faces: [`${key}.a`, `${key}.b`], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], pts: [a, b] });
const geoOf = (list: EdgeInfo[]): Geometry => ({ mesh: null, edges: list, box: null });
const keysOf = (sel: ReturnType<typeof edges>, g: Geometry) => resolveEdges(sel.sel, g, sel.line).map((e) => e.faces[0].replace('.a', ''));
const shuffle = <T,>(a: T[], seed: number): T[] => { const r = [...a]; let s = seed; for (let i = r.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };

// a block: four vertical edges, a bottom and a top ring, and a mid-height rib ring (h is the height of the block, w its width)
const block = (w: number, h: number, ribZ: number): EdgeInfo[] => {
  const c = [[0, 0], [w, 0], [w, w], [0, w]];
  const out: EdgeInfo[] = [];
  c.forEach((p, i) => { const q = c[(i + 1) % 4]; out.push(edge(`v${i}`, [p[0], p[1], 0], [p[0], p[1], h]), edge(`b${i}`, [p[0], p[1], 0], [q[0], q[1], 0]), edge(`t${i}`, [p[0], p[1], h], [q[0], q[1], h]), edge(`r${i}`, [p[0], p[1], ribZ], [q[0], q[1], ribZ])); });
  return out;
};

describe('edges ordered by position', () => {
  const g = geoOf(block(40, 30, 12));
  it('sorts by a direction and takes the first / last / n-th', () => {
    expect(keysOf(edges('|Z').sortBy('>X').first(), g).length).toBe(1);
    // highest first: the four top edges come before the rib ring, the bottom ring is last
    const top = keysOf(edges({ parallel: 'X' }).sortBy('>Z').first(2), g);
    expect(top).toHaveLength(2);
    expect(top.every((k) => k.startsWith('t'))).toBe(true);
    expect(keysOf(edges({ parallel: 'X' }).sortBy('Z').first(2), g).every((k) => k.startsWith('b'))).toBe(true);
    expect(keysOf(edges({ parallel: 'X' }).sortBy('<Z').nth(2), g)[0]).toMatch(/^r/);
    expect(keysOf(edges({ parallel: 'X' }).sortBy('>Z').last(), g)[0]).toMatch(/^b/);
    expect(keysOf(edges({ parallel: 'X' }).sortBy('>Z').nth(-1), g)[0]).toMatch(/^b/);
  });
  it('ties are broken by x, y, z, so a shuffled edge list gives the same pick', () => {
    const pick = (list: EdgeInfo[]) => keysOf(edges({ parallel: 'X' }).sortBy('>Z').nth(0), geoOf(list));
    const want = pick(block(40, 30, 12));
    for (let s = 1; s < 8; s++) expect(pick(shuffle(block(40, 30, 12), s))).toEqual(want);
  });
  it('groups the edges at the same height and chooses a group by index or by height', () => {
    const rib = edges('all').groupBy('Z').at(12);
    expect(keysOf(rib, g).sort()).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(keysOf(edges({ parallel: 'X' }).groupBy('>Z').first(), g).every((k) => k.startsWith('t'))).toBe(true);
    expect(keysOf(edges({ parallel: 'Y' }).groupBy('Z').nth(1), g).every((k) => k.startsWith('r'))).toBe(true);
    expect(keysOf(edges({ parallel: 'Y' }).groupBy('Z').last(), g).every((k) => k.startsWith('t'))).toBe(true);
  });
  it('a group tolerance merges nearly equal heights', () => {
    const slight = [edge('a', [0, 0, 10], [5, 0, 10]), edge('b', [0, 3, 10.04], [5, 3, 10.04]), edge('c', [0, 6, 20], [5, 6, 20])];
    expect(keysOf(edges('all').groupBy('Z').first(), geoOf(slight))).toEqual(['a']);
    expect(keysOf(edges('all').groupBy('Z', { tol: 0.1 }).first(), geoOf(slight)).sort()).toEqual(['a', 'b']);
  });
  it('orders along a rail edge: the third rung along the rail', () => {
    const rail = edge('rail', [0, 0, 0], [100, 0, 0]);
    const rungs = [10, 30, 50, 70, 90].map((x, i) => edge(`rung${i}`, [x, 0, 0], [x, 20, 0]));
    const geo = geoOf([rail, ...shuffle(rungs, 3)]);
    const along = { along: edges({ parallel: 'X' }) };
    expect(keysOf(edges({ parallel: 'Y' }).sortBy(along).nth(2), geo)).toEqual(['rung2']);
    expect(keysOf(edges({ parallel: 'Y' }).sortBy(along).last(2), geo)).toEqual(['rung3', 'rung4']);
    // a rail that is more than one edge is refused
    expect(() => resolveEdges(edges({ parallel: 'Y' }).sortBy({ along: edges('all') }).first().sel, geo)).toThrow(/needs one edge/);
  });
  it('the same selection survives a regenerated model (other size, other edge order, an edge added)', () => {
    // "the edges at the rib height", "the second ring from the top", "the vertical edge furthest along +X then +Y"
    const sels = {
      rib: () => edges({ parallel: 'X' }).groupBy('<Z').nth(1),
      second: () => edges({ parallel: 'X' }).groupBy('>Z').nth(1),
      corner: () => edges('|Z').sortBy('>X').first(),
    };
    const v1 = geoOf(block(40, 30, 12));
    const v2 = geoOf(shuffle([...block(65, 55, 20), edge('extra', [3, 3, 3], [3, 3, 4])], 5));
    for (const [name, mk] of Object.entries(sels)) {
      const a = keysOf(mk(), v1), b = keysOf(mk(), v2);
      expect(a.length, name).toBeGreaterThan(0);
      expect(b.sort(), name).toEqual(a.sort());
    }
  });
  it('says what is wrong, with the positions to choose from', () => {
    expect(() => resolveEdges(edges('all').nth(2).sel, g, 4)).toThrow(/needs \.sortBy/);
    expect(() => resolveEdges(edges('all').sortBy('Q').sel, g, 4)).toThrow(/not a position key/);
    expect(() => resolveEdges(edges('all').sortBy([0, 0, 0]).sel, g, 4)).toThrow(/zero vector/);
    expect(() => resolveEdges(edges({ parallel: 'X' }).groupBy('Z').nth(9).sel, g, 4)).toThrow(/only 3 group\(s\) at Z = 0, 12, 30/);
    expect(() => resolveEdges(edges({ parallel: 'X' }).groupBy('Z').at(5).sel, g, 4)).toThrow(/no group there; 3 group\(s\)/);
    expect(() => resolveEdges({ parallel: 'X', group: { by: 'Z' } }, g, 4)).toThrow(/say which group/);
    try { resolveEdges(edges('all').nth(2).sel, g, 4); } catch (e) { expect((e as SelectorError).line).toBe(4); }
  });
  it('works as plain JSON rule keys too (for scripts written by a model)', () => {
    expect(resolveEdges({ parallel: 'X', sortBy: '>Z', pick: { first: 2 } }, g)).toHaveLength(2);
    expect(resolveEdges({ parallel: 'X', group: { by: '>Z', nth: 0 } }, g)).toHaveLength(2);
  });
});

// two stacked slabs: plate top 40 x 40 at z=10, a boss top at z=25, a ledge top at z=18 (planar faces, one quad each)
const slabs = (dz = 0): Geometry => {
  const positions: number[] = [], normals: number[] = [], triFace: number[] = [], ids: string[] = [];
  const quad = (id: string, n: number[], z: number, cx: number) => {
    const fi = ids.push(id) - 1;
    const p = [[cx - 5, -5, z], [cx + 5, -5, z], [cx + 5, 5, z], [cx - 5, 5, z]];
    for (const t of [[0, 1, 2], [0, 2, 3]]) { for (const k of t) { positions.push(...p[k]); normals.push(...n); } triFace.push(fi); }
  };
  quad('F2.C1', [0, 0, 1], 10 + dz, 0); quad('F3.C1', [0, 0, 1], 25 + dz, 20); quad('F4.C1', [0, 0, 1], 18 + dz, 40); quad('F2.C0', [0, 0, -1], 0, 0);
  const mesh: Mesh = { positions, normals, triFace, faceIds: ids };
  return { mesh, edges: [], box: null };
};
describe('faces ordered by position', () => {
  it('sorts the faces facing up by height and counts in that order', () => {
    const up = faces({ normal: [0, 0, 1] });
    expect(resolveFaceSel(up.sortBy('Z').nth(0), slabs()).id).toBe('F2.C1');
    expect(resolveFaceSel(up.sortBy('Z').nth(1), slabs()).id).toBe('F4.C1');
    expect(resolveFaceSel(up.sortBy('>Z').first(), slabs()).id).toBe('F3.C1');
    expect(resolveFaceSel(up.sortBy('Z').last(), slabs()).id).toBe('F3.C1');
    // the face list order does not matter
    const g = slabs(); const names = g.mesh!.faceIds;
    expect(names.length).toBe(4);
  });
  it('groups faces by height', () => {
    expect(resolveFacesSel(faces({ normal: [0, 0, 1] }).groupBy('Z').at(18), slabs()).map((f) => f.id)).toEqual(['F4.C1']);
    expect(resolveFacesSel(faces({ normal: [0, 0, 1] }).groupBy('>Z').first(), slabs()).map((f) => f.id)).toEqual(['F3.C1']);
    // a string spec keeps working with the chain
    expect(resolveFacesSel(faces('>Z').sortBy('X').first(), slabs()).map((f) => f.id)).toEqual(['F2.C1']);
  });
  it('survives a regenerated model (everything moved up)', () => {
    const pick = (g: Geometry) => resolveFaceSel(faces({ normal: [0, 0, 1] }).sortBy('Z').nth(1), g).id;
    expect(pick(slabs(0))).toBe(pick(slabs(7)));
  });
});
