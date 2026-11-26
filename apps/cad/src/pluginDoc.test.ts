import { describe, expect, it } from 'vitest';
import { pluginDocContext, selectionItems } from './pluginDoc';
import type { BodyRow } from './bodies';

// two triangles of one flat face (normal +X) and one of another (normal +Z); positions are 9 floats per triangle
const mesh = {
  positions: [10, 0, 0, 10, 5, 0, 10, 0, 7, 10, 5, 0, 10, 5, 7, 10, 0, 7, 0, 0, 7, 4, 0, 7, 0, 5, 7],
  normals: [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  triFace: [0, 0, 1],
  faceIds: ['F1.S1', 'F1.S2'],
};
const rows = [{ key: '@body:F1.S1', name: 'Body 1', docName: 'Rail', faces: ['F1.S1', 'F1.S2'], edges: [], volume: 350 }] as unknown as BodyRow[];

describe('what a plugin may read of the open document', () => {
  it('names a body by its document name and gives its box', () => {
    const d = pluginDocContext(rows, mesh, []);
    expect(d.bodies).toEqual([{ name: 'Rail', bbox: { min: [0, 0, 0], max: [10, 5, 7] }, volume: 350, feature: 'F1' }]);
  });
  it('carries the document\'s variables and what earlier runs stored for the components they made', () => {
    const d = pluginDocContext(rows, mesh, [], [{ name: 'Cabinet_width', expr: '600 mm' }, { name: 5 }], { Cabinet: { meta: { components: { Cabinet: { key: { entry: 'cabinet' } } } } }, Other: {} });
    expect(d.parameters).toEqual([{ name: 'Cabinet_width', expression: '600 mm', value: 0 }]);
    expect(d.components).toEqual({ Cabinet: { key: { entry: 'cabinet' } } });
  });
  it('a picked body and a picked flat face (with its normal); anything else is left out', () => {
    const d = pluginDocContext(rows, mesh, ['@body:F1.S1', 'F1.S1', 'F1.S2', 'F9.E1', 'v:3']);
    expect(d.selection).toEqual([{ type: 'body', name: 'Rail' }, { type: 'face', body: 'Rail', index: 0, normal: [1, 0, 0] }, { type: 'face', body: 'Rail', index: 1, normal: [0, 0, 1] }]);
  });
  it('a picked edge carries a point on it, as SolidCraft\'s selection reference does, and a field that takes edges receives it', () => {
    const withEdges = [{ ...rows[0], edges: ['F1.E1', 'F1.E2'] }] as unknown as BodyRow[];
    const doc = pluginDocContext(withEdges, mesh as never, ['F1.E2'], [], {}, { edges: true, edgePoint: (k) => (k === 'F1.E2' ? [1, 2, 3] : undefined) });
    expect(doc.selection).toEqual([{ type: 'edge', body: 'Rail', index: 1, point: [1, 2, 3], mid: [1, 2, 3] }]);
    expect(selectionItems(doc.selection, { accept: ['edge'] })).toEqual([{ type: 'edge', body: 'Rail', index: 1, point: [1, 2, 3], mid: [1, 2, 3] }]);
    // no point known: the pick is still an edge reference
    expect(pluginDocContext(withEdges, mesh as never, ['F1.E1'], [], {}, { edges: true }).selection).toEqual([{ type: 'edge', body: 'Rail', index: 0 }]);
  });
  it('a face whose triangles disagree has no normal', () => {
    const bent = { ...mesh, normals: [...mesh.normals.slice(0, 9), 0, 1, 0, 0, 1, 0, 0, 1, 0, ...mesh.normals.slice(18)] };
    expect(pluginDocContext(rows, bent, ['F1.S1']).selection).toEqual([{ type: 'face', body: 'Rail', index: 0 }]);
  });
  it('what a selection field takes from it: references, names, only what it accepts, the last picks when there is a maximum', () => {
    const sel = pluginDocContext(rows, mesh, ['@body:F1.S1', 'F1.S1', 'F1.S2']).selection;
    expect(selectionItems(sel, { accept: ['body'] })).toEqual([{ type: 'body', name: 'Rail' }]);
    expect(selectionItems(sel, { accept: ['body'], asNames: true })).toEqual(['Rail']);
    expect(selectionItems(sel, { accept: ['face'] })).toEqual([{ type: 'face', body: 'Rail', index: 0, normal: [1, 0, 0] }, { type: 'face', body: 'Rail', index: 1, normal: [0, 0, 1] }]);
    expect(selectionItems(sel, { accept: ['face'], maxItems: 1 })).toEqual([{ type: 'face', body: 'Rail', index: 1, normal: [0, 0, 1] }]);
    expect(selectionItems(sel, { accept: ['edge'] })).toEqual([]);
    expect(selectionItems(sel, { accept: ['body', 'face'] })).toHaveLength(3);
  });
  it('no mesh: bodies without a box, nothing picked', () => {
    expect(pluginDocContext(rows, null, ['F1.S1']).bodies[0].bbox).toBeNull();
  });
});

import { scratchRows } from './pluginDoc';

/** a closed cube as triangles (9 floats each) and the face id of each triangle's face */
function cube(x0: number, s: number, tag: string): { positions: number[]; triFace: number[]; ids: string[] } {
  const c = (i: number, j: number, k: number) => [x0 + i * s, j * s, k * s];
  const quads: number[][][] = [
    [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)], [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)],
    [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)], [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)],
    [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)], [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)],
  ];
  const positions: number[] = [], triFace: number[] = [], ids: string[] = [];
  quads.forEach((q, f) => { ids.push(`${tag}.${f}`); for (const t of [[0, 1, 2], [0, 2, 3]]) { triFace.push(f); for (const v of t) positions.push(...q[v]); } });
  return { positions, triFace, ids };
}

describe('the bodies of a scratch build, for a plugin that measures', () => {
  it('gives each named body its box from the mesh (two bodies told apart by volume and centre)', () => {
    const a = cube(0, 10, 'A'), b = cube(50, 20, 'B');
    const mesh = { positions: [...a.positions, ...b.positions], normals: [], triFace: [...a.triFace, ...b.triFace.map((f) => f + 6)], faceIds: [...a.ids, ...b.ids] };
    const faceLumps = Object.fromEntries([...a.ids.map((i) => [i, 0]), ...b.ids.map((i) => [i, 1])]);
    const mass = [{ name: 'Big', volume: 8000, com: [60, 10, 10] }, { name: 'Small', volume: 1000, com: [5, 5, 5] }];
    const rows = scratchRows(mesh as never, faceLumps, mass);
    expect(rows).toEqual([{ name: 'Big', volume: 8000, bbox: { min: [50, 0, 0], max: [70, 20, 20] } }, { name: 'Small', volume: 1000, bbox: { min: [0, 0, 0], max: [10, 10, 10] } }]);
  });
  it('a single body has no lump tags: all faces are lump 0', () => {
    const a = cube(0, 10, 'A');
    const rows = scratchRows({ positions: a.positions, normals: [], triFace: a.triFace, faceIds: a.ids } as never, undefined, [{ name: 'Only', volume: 1000, com: [5, 5, 5] }]);
    expect(rows[0].bbox).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
  });
  it('no mesh: names and volumes, no boxes', () => {
    expect(scratchRows(null, undefined, [{ name: 'X', volume: 5, com: [0, 0, 0] }, { volume: 3 }])).toEqual([{ name: 'X', volume: 5, bbox: null }]);
  });
});

describe('the mesh a plugin reads with model.mesh', () => {
  it('is the display mesh and each body\'s faces, shared and not copied; absent without a mesh', () => {
    const d = pluginDocContext(rows, mesh, []);
    expect(d.meshes?.mesh).toBe(mesh);
    expect(d.meshes?.faces).toEqual({ Rail: rows[0].faces });
    expect(pluginDocContext(rows, null, []).meshes).toBeUndefined();
  });
});
