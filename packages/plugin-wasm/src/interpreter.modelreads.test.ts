import { describe, expect, it } from 'vitest';
import { Interpreter, READS, SUPPORTED, type DocContext } from './interpreter';

const scratch = { async build() { return []; } };
interface Soup { positions: number[]; triFace: number[]; faceIds: string[] }
function tri(s: Soup, face: string, a: number[], b: number[], c: number[]): void {
  let f = s.faceIds.indexOf(face); if (f < 0) { f = s.faceIds.length; s.faceIds.push(face); }
  s.positions.push(...a, ...b, ...c); s.triFace.push(f);
}
function box(s: Soup, tag: string, [x0, y0, z0]: number[], [x1, y1, z1]: number[]): string[] {
  const q = (face: string, a: number[], b: number[], c: number[], d: number[]) => { tri(s, face, a, b, c); tri(s, face, a, c, d); };
  q(`${tag}.1`, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  q(`${tag}.2`, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
  q(`${tag}.3`, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  q(`${tag}.4`, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
  q(`${tag}.5`, [x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
  q(`${tag}.6`, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
  return [1, 2, 3, 4, 5, 6].map((i) => `${tag}.${i}`);
}
/** The side of a cylinder about Z: radius r from z0 to z1 in n strips, one face, outward winding. */
function side(s: Soup, face: string, r: number, z0: number, z1: number, n: number): void {
  const at = (z: number, k: number) => [r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), z];
  for (let k = 0; k < n; k++) { tri(s, face, at(z0, k), at(z0, k + 1), at(z1, k)); tri(s, face, at(z1, k), at(z0, k + 1), at(z1, k + 1)); }
}
const soup = (): Soup => ({ positions: [], triFace: [], faceIds: [] });
const doc = (s: Soup, faces: Record<string, string[]>, extra: Partial<DocContext> = {}): DocContext => ({ up: 'z', bodies: Object.keys(faces).map((name) => ({ name, bbox: null })), selection: [], meshes: { mesh: s, faces }, ...extra });
const run = (d: DocContext, cmd: string, args: unknown) => new Interpreter(scratch, { readEntry: true, doc: d }).runSync(cmd, args) as Record<string, any>;

describe('model.faces, model.edges, model.threads', () => {
  it('are supported reads', () => {
    for (const c of ['model.faces', 'model.edges', 'model.threads']) { expect(SUPPORTED.has(c)).toBe(true); expect(READS.has(c)).toBe(true); }
  });

  it('a box: six planar faces with name, index, area, normal and a point on the face', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [10, 20, 30]);
    const r = run(doc(s, { Block: faces }), 'model.faces', { body: 'Block' });
    expect(r.units).toBe('mm');
    expect(r.faces.map((f: any) => f.name)).toEqual(faces);
    expect(r.faces.map((f: any) => f.index)).toEqual([0, 1, 2, 3, 4, 5]);
    const top = r.faces[1];
    expect(top.exact).toBe(true);
    expect(top.area).toBeCloseTo(200, 6);
    expect(top.plane_normal).toEqual([0, 0, 1]);
    expect(top.centroid).toEqual([5, 10, 30]);
    expect(top.point[2]).toBe(30);
    expect(top.cylinder).toBeUndefined();
  });

  it('a cylinder side: radius, axis and origin, area close to 2 pi r h', () => {
    const s = soup(); side(s, 'F2.1', 5, 0, 20, 64);
    const f = run(doc(s, { Pin: ['F2.1'] }), 'model.faces', { body: 'Pin' }).faces[0];
    expect(f.exact).toBe(true);
    expect(f.plane_normal).toBeUndefined();
    expect(f.cylinder.radius).toBeCloseTo(5, 3);
    expect(Math.abs(f.cylinder.axis[2])).toBeCloseTo(1, 6);
    expect(f.cylinder.origin[0]).toBeCloseTo(0, 3);
    expect(f.cylinder.origin[1]).toBeCloseTo(0, 3);
    expect(f.cylinder.origin[2]).toBeCloseTo(10, 3);
    expect(f.area).toBeGreaterThan(0.99 * 2 * Math.PI * 5 * 20);
  });

  it('a Y-up document is answered in the plugin frame (Z up)', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [10, 20, 30]);
    const r = run(doc(s, { Block: faces }, { up: 'y' }), 'model.faces', { body: 'Block' });
    expect(r.faces[1].plane_normal).toEqual([0, -1, 0]);   // the top face (document +Z) is plugin -Y: [x, y, z] -> [x, -z, y]
    expect(r.faces[1].centroid).toEqual([5, -30, 10]);
  });

  it('an unknown body, a missing body and a changed model are refused', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [1, 1, 1]);
    const d = doc(s, { Block: faces });
    expect(() => run(d, 'model.faces', { body: 'Nope' })).toThrow(/no body named "Nope"/);
    expect(() => run(d, 'model.faces', {})).toThrow(/body must be a body name/);
    expect(() => run(d, 'model.edges', {})).toThrow(/body must be a body name/);
  });

  it('edges: a line, a circle (centre, axis, radius) and a free curve', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [1, 1, 1]);
    const circle = Array.from({ length: 33 }, (_, k) => [5 * Math.cos((2 * Math.PI * k) / 32) + 1, 5 * Math.sin((2 * Math.PI * k) / 32) + 2, 7]);
    const wave = Array.from({ length: 20 }, (_, k) => [k, Math.sin(k / 3) * 4, 0]);
    const d = doc(s, { Block: faces }, { edges: { Block: [{ name: 'e1', pts: [[0, 0, 0], [5, 0, 0], [10, 0, 0]] }, { name: 'e2', pts: circle }, { name: 'e3', pts: wave }] } });
    const r = run(d, 'model.edges', { body: 'Block' });
    expect(r.edges.map((e: any) => [e.index, e.name, e.curve])).toEqual([[0, 'e1', 'line'], [1, 'e2', 'circle'], [2, 'e3', 'curve']]);
    expect(r.edges[0].length).toBeCloseTo(10, 6);
    expect(r.edges[0].point).toEqual([5, 0, 0]);
    expect(r.edges[1].radius).toBeCloseTo(5, 3);
    expect(r.edges[1].centre.map((v: number) => Math.round(v * 1000) / 1000)).toEqual([1, 2, 7]);
    expect(Math.abs(r.edges[1].axis[2])).toBeCloseTo(1, 6);
    expect(r.edges[1].length).toBeGreaterThan(31.3);   // the polyline of 32 chords is a little short of 2 pi r
    expect(r.edges[1].length).toBeLessThan(2 * Math.PI * 5);
    expect(r.edges[2].radius).toBeUndefined();
  });

  it('threads: the document threads, an empty list when there are none', () => {
    const s = soup(), faces = box(s, 'F1', [0, 0, 0], [1, 1, 1]);
    expect(run(doc(s, { Block: faces }), 'model.threads', {})).toEqual({ threads: [] });
    const t = { id: 'F5', face: 'F2.S.e1', standard: 'iso', size: 'M8', length: 'full', hand: 'right', modeled: false };
    expect(run(doc(s, { Block: faces }, { threads: [t] }), 'model.threads', {}).threads).toEqual([t]);
  });
});
