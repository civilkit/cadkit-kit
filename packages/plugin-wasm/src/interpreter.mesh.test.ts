import { describe, expect, it } from 'vitest';
import { Interpreter, MESH_MAX_TRIANGLES, READS, SUPPORTED, type DocContext } from './interpreter';

const scratch = { async build() { return []; } };

/** Triangle soup (9 floats per triangle) with the face each triangle belongs to. */
interface Soup { positions: number[]; triFace: number[]; faceIds: string[] }
const soup = (): Soup => ({ positions: [], triFace: [], faceIds: [] });
function tri(s: Soup, face: string, a: number[], b: number[], c: number[]): void {
  let f = s.faceIds.indexOf(face); if (f < 0) { f = s.faceIds.length; s.faceIds.push(face); }
  s.positions.push(...a, ...b, ...c); s.triFace.push(f);
}
/** An outward-wound box: 6 faces, 12 triangles. */
function box(s: Soup, tag: string, [x0, y0, z0]: number[], [x1, y1, z1]: number[]): string[] {
  const q = (face: string, a: number[], b: number[], c: number[], d: number[]) => { tri(s, face, a, b, c); tri(s, face, a, c, d); };
  q(`${tag}.1`, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);   // bottom
  q(`${tag}.2`, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);   // top
  q(`${tag}.3`, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  q(`${tag}.4`, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  q(`${tag}.5`, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
  q(`${tag}.6`, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
  return [1, 2, 3, 4, 5, 6].map((i) => `${tag}.${i}`);
}
/** A turned body: the profile [radius, z] revolved about Z in `n` segments, capped at both ends (a turned baluster). One face per profile segment. */
function lathe(s: Soup, tag: string, profile: number[][], n: number): string[] {
  const at = (r: number, z: number, k: number) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), z];
  const faces: string[] = [];
  const pts = [[0, profile[0][1]], ...profile, [0, profile[profile.length - 1][1]]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const face = `${tag}.${i + 1}`; faces.push(face);
    const [r0, z0] = pts[i], [r1, z1] = pts[i + 1];
    for (let k = 0; k < n; k++) {
      // outward winding; a cap segment has radius 0 at one end, which drops one of the two triangles of its quad
      const A = at(r0, z0, k), B = at(r0, z0, k + 1), C = at(r1, z1, k + 1), D = at(r1, z1, k);
      if (r0 > 0) tri(s, face, A, B, D);
      if (r1 > 0) tri(s, face, D, B, C);
    }
  }
  return faces;
}
const volume = (positions: number[][], indices: number[]): number => {
  let v = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => positions[indices[t + k]]);
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
};
interface Out { units: string; bodies: Array<{ name: string; vertex_count: number; triangle_count: number; positions: number[][]; indices: number[]; triangle_face: number[] }> }
const docOf = (s: Soup, faces: Record<string, string[]>, up: 'y' | 'z' = 'z'): DocContext => ({ up, bodies: Object.keys(faces).map((name) => ({ name, bbox: null })), selection: [], meshes: { mesh: s, faces } });

describe('model.mesh', () => {
  it('is supported and counts as a read, so a read entry may call it and it needs no replay', () => {
    expect(SUPPORTED.has('model.mesh')).toBe(true);
    expect(READS.has('model.mesh')).toBe(true);
  });

  it('a box body is 12 triangles over 8 welded vertices, with the face of each triangle', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [10, 20, 30]);
    const I = new Interpreter(scratch, { readEntry: true, doc: docOf(s, { Board: faces }) });
    const r = I.runSync('model.mesh', { bodies: ['Board'] }) as Out;
    expect(r.units).toBe('mm');
    const b = r.bodies[0];
    expect(b.name).toBe('Board');
    expect(b.triangle_count).toBe(12);
    expect(b.indices).toHaveLength(36);
    expect(b.vertex_count).toBe(8);
    expect(b.positions).toHaveLength(8);
    expect(b.positions.every((p) => p.length === 3)).toBe(true);
    expect(b.triangle_face).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(Math.max(...b.indices)).toBe(7);
    expect(volume(b.positions, b.indices)).toBeCloseTo(10 * 20 * 30, 6);
    const lo = [0, 1, 2].map((k) => Math.min(...b.positions.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...b.positions.map((p) => p[k])));
    expect([lo, hi]).toEqual([[0, 0, 0], [10, 20, 30]]);
  });

  it('a revolved body gives a closed mesh whose volume is the turned volume (a stepped spindle)', () => {
    const s = soup(), n = 48, profile = [[20, 0], [20, 100], [10, 100], [10, 300]];
    const faces = lathe(s, 'F2', profile, n);
    const I = new Interpreter(scratch, { readEntry: true, doc: docOf(s, { Spindle: faces }) });
    const b = (I.runSync('model.mesh', {}) as Out).bodies[0];
    expect(b.triangle_count).toBe(b.indices.length / 3);
    // every edge of a closed mesh is shared by exactly two triangles, one in each direction
    const dir = new Map<string, number>();
    for (let t = 0; t < b.indices.length; t += 3) for (let k = 0; k < 3; k++) { const e = `${b.indices[t + k]}>${b.indices[t + (k + 1) % 3]}`; dir.set(e, (dir.get(e) ?? 0) + 1); }
    for (const [e, c] of dir) { expect(c).toBe(1); const [a, z] = e.split('>'); expect(dir.has(`${z}>${a}`)).toBe(true); }
    // an n-gon prism volume: pi r^2 is n/2 sin(2 pi / n) r^2 for the polygon
    const area = (r: number) => (n / 2) * Math.sin((2 * Math.PI) / n) * r * r;
    expect(volume(b.positions, b.indices)).toBeCloseTo(area(20) * 100 + area(10) * 200, 1);   // positions are rounded to 0.1 micron
    expect(b.triangle_face.every((f) => f >= 0 && f < faces.length)).toBe(true);
  });

  it('a Y-up document comes back in the plugin frame (Z up), the same turn selection.get makes', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [10, 20, 30]);   // document: X 10, Y 20 (up), Z 30
    const I = new Interpreter(scratch, { doc: docOf(s, { Board: faces }, 'y') });
    const b = (I.runSync('model.mesh', { bodies: ['Board'] }) as Out).bodies[0];
    const lo = [0, 1, 2].map((k) => Math.min(...b.positions.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...b.positions.map((p) => p[k])));
    expect([lo, hi]).toEqual([[0, -30, 0], [10, 0, 20]]);   // height 20 is now along Z
    expect(volume(b.positions, b.indices)).toBeCloseTo(6000, 6);   // the winding survived (a mirror would flip the sign)
  });

  it('a request with one `body` (the form the Woodwork cut list sends, with a tolerance) is answered with that body\'s fields at the top level', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [10, 20, 30]);
    const I = new Interpreter(scratch, { readEntry: true, doc: docOf(s, { Board: faces }) });
    const r = I.runSync('model.mesh', { body: 'Board', tolerance: 1 }) as { units: string; name: string; positions: number[][]; triangle_count: number; bodies?: unknown };
    expect(r).toMatchObject({ units: 'mm', name: 'Board', triangle_count: 12 });
    expect(r.positions).toHaveLength(8);
    expect(r.bodies).toBeUndefined();
  });

  it('with no selector every body comes back, in document order, and a list picks some', () => {
    const s = soup(), a = box(s, 'F1', [0, 0, 0], [1, 1, 1]), c = box(s, 'F2', [5, 0, 0], [6, 1, 1]);
    const I = new Interpreter(scratch, { readEntry: true, doc: docOf(s, { A: a, B: c }) });
    expect((I.runSync('model.mesh', {}) as Out).bodies.map((b) => b.name)).toEqual(['A', 'B']);
    const only = (I.runSync('model.mesh', { bodies: ['B'] }) as Out).bodies;
    expect(only.map((b) => b.name)).toEqual(['B']);
    expect(Math.min(...only[0].positions.map((p) => p[0]))).toBe(5);
  });

  it('an unknown body is an error naming it, even next to a good one', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [1, 1, 1]);
    const I = new Interpreter(scratch, { readEntry: true, doc: docOf(s, { Board: faces }) });
    expect(() => I.runSync('model.mesh', { bodies: ['Board', 'Nope'] })).toThrow(/no body named "Nope"/);
    expect(() => I.runSync('model.mesh', { body: 'Nope' })).toThrow(/no body named "Nope"/);
    expect(() => I.runSync('model.mesh', { bodies: 'Board' })).toThrow(/list of body names/);
  });

  it('an empty document gives no bodies; asking for one by name is an error', () => {
    const I = new Interpreter(scratch, { readEntry: true, doc: { bodies: [], selection: [] } });
    expect(I.runSync('model.mesh', {})).toEqual({ units: 'mm', bodies: [] });
    expect(() => I.runSync('model.mesh', { bodies: ['Board'] })).toThrow(/no body named "Board"/);
    expect(new Interpreter(scratch, { readEntry: true }).runSync('model.mesh', {})).toEqual({ units: 'mm', bodies: [] });
  });

  it('a body with no triangles (not shown) is an empty mesh, not an error', () => {
    const I = new Interpreter(scratch, { readEntry: true, doc: { bodies: [{ name: 'Hidden', bbox: null }], selection: [] } });
    expect((I.runSync('model.mesh', { bodies: ['Hidden'] }) as Out).bodies[0]).toMatchObject({ triangle_count: 0, vertex_count: 0, positions: [], indices: [] });
  });

  it('refuses more triangles than one call may carry', () => {
    const s = soup(), faces = ['F1.1'];
    for (let i = 0; i < MESH_MAX_TRIANGLES + 1; i++) tri(s, 'F1.1', [0, 0, 0], [1, 0, 0], [0, 1, i]);
    const I = new Interpreter(scratch, { readEntry: true, doc: docOf(s, { Big: faces }) });
    expect(() => I.runSync('model.mesh', { bodies: ['Big'] })).toThrow(/more than 200000 triangles/);
  });

  it('after this run has recorded an edit, the document mesh is stale, so it is refused', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [1, 1, 1]);
    const I = new Interpreter(scratch, { doc: docOf(s, { Board: faces }) });
    I.runSync('solid.box', { corner: [0, 0, 0], length: 1, width: 1, height: 1, operation: 'new', body_name: 'Tool', name: 'Tool' });
    expect(() => I.runSync('model.mesh', { bodies: ['Board'] })).toThrow(/already changed the model/);
  });
});
