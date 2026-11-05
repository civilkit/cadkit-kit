import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brepEdges, brepFaces } from './brep';
import { zipFile } from './zip';

const GEN = process.cwd() + '/packages/fcstd/corpus/generated/';
const brp = async (model: string, file: string) => new TextDecoder().decode((await zipFile(new Uint8Array(readFileSync(GEN + model + '.FCStd')), file))!);
const near = (a: number[], b: number[], tol = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < tol);

describe('BRep text reader', () => {
  it('faces of a 20 x 30 x 10 pad: six planes with outward normals and a point in each', async () => {
    const faces = brepFaces(await brp('10_sketch_rect_pad', 'Pad.Shape.brp'));
    expect(faces).toHaveLength(6);
    expect(faces.every((f) => f.surface === 'plane')).toBe(true);
    const find = (n: number[]) => faces.filter((f) => near(f.normal!, n));
    expect(find([0, 0, 1])).toHaveLength(1);
    expect(near(find([0, 0, 1])[0].at, [10, 15, 10])).toBe(true);
    expect(near(find([0, 0, -1])[0].at, [10, 15, 0])).toBe(true);
    expect(near(find([-1, 0, 0])[0].at, [0, 15, 5])).toBe(true);
    expect(near(find([1, 0, 0])[0].at, [20, 15, 5])).toBe(true);
    expect(near(find([0, -1, 0])[0].at, [10, 0, 5])).toBe(true);
    expect(near(find([0, 1, 0])[0].at, [10, 30, 5])).toBe(true);
  });
  it('a cylinder with a filleted top: the planar caps, the cylinder and the torus are told apart', async () => {
    const faces = brepFaces(await brp('38_fillet_cylinder_edges', 'Fillet.Shape.brp'));
    const kinds = faces.map((f) => f.surface).sort();
    expect(kinds).toContain('cylinder');
    expect(kinds).toContain('torus');
    expect(kinds.filter((k) => k === 'plane').length).toBeGreaterThanOrEqual(2);
  });
  it('edges and faces come in the same numbering FreeCAD uses (Edge12 of the pad is its top edge at x = 0)', async () => {
    const e = brepEdges(await brp('36_chamfer', 'BaseEqual.Shape.brp'));
    expect(e).toHaveLength(12);
    expect(near(e[11].at, [0, 15, 10])).toBe(true); // the edge the chamfer corpus model names Edge12
  });
});
