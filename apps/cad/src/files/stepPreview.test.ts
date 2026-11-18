import { describe, expect, it } from 'vitest';
import { buildPreviewMesh, resultOfBodies, type OcctResult } from './stepPreviewMesh';
import { previewStep, viewOfPreview, type PreviewWorker } from './stepPreview';

// Two products: a unit tetrahedron with normals and two faces, and a single triangle without normals or face ranges.
const sample: OcctResult = {
  success: true,
  meshes: [
    { name: 'tet', attributes: { position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }, normal: { array: [0, 0, -1, 0, 0, -1, 0, 0, -1, 1, 1, 1] } },
      index: { array: [0, 2, 1, 0, 1, 3] }, brep_faces: [{ first: 0, last: 0 }, { first: 1, last: 1 }] },
    { name: 'flat', attributes: { position: { array: [10, 0, 0, 12, 0, 0, 10, 3, 0] } }, index: { array: [0, 1, 2] } },
  ],
  root: { children: [{ name: 'a', meshes: [0], children: [] }, { name: 'b', meshes: [1], children: [] }] },
};

describe('buildPreviewMesh', () => {
  it('flattens indexed meshes into 9 floats per triangle with a face id per triangle', () => {
    const m = buildPreviewMesh(sample);
    expect(m.triangles).toBe(3);
    expect(m.positions.length).toBe(27);
    expect([...m.triFace]).toEqual([0, 1, 2]);
    expect(m.faceIds).toEqual(['F2.0', 'F2.1', 'F4.0']);   // the owner is the body's tree row (the unnamed root is skipped)
    expect(m.meshes).toBe(2);
    expect(m.products).toBe(2);
  });
  it('gives the bounding box of every vertex', () => {
    const m = buildPreviewMesh(sample);
    expect(m.box).toEqual({ min: [0, 0, 0], max: [12, 3, 1] });
  });
  it('uses file normals when present and a flat normal when not', () => {
    const m = buildPreviewMesh(sample);
    expect([...m.normals.slice(0, 3)]).toEqual([0, 0, -1]);
    // third triangle (x, y plane, counter-clockwise seen from +z): normal +z
    expect([...m.normals.slice(18, 21)]).toEqual([0, 0, 1]);
  });
  it('handles an empty result as an empty box, not Infinity', () => {
    const m = buildPreviewMesh({ success: true, meshes: [] });
    expect(m.triangles).toBe(0);
    expect(m.box).toEqual({ min: [0, 0, 0], max: [0, 0, 0] });
  });
});

function fakeWorker(reply: (w: PreviewWorker) => void): { spawn: () => PreviewWorker; terminated: () => boolean; sent: () => number } {
  let terminated = false, sent = 0;
  const w: PreviewWorker = {
    onmessage: null, onerror: null,
    postMessage(m) { sent = m.bytes.byteLength; reply(w); },
    terminate() { terminated = true; },
  };
  return { spawn: () => w, terminated: () => terminated, sent: () => sent };
}

describe('the assembly nodes', () => {
  it('make a product per named node and a body per mesh under it, with triangle counts rolled up', () => {
    const m = buildPreviewMesh({ ...sample, root: { name: '', children: [{ name: 'Asm', children: [{ name: 'a', meshes: [0] }, { name: 'b', meshes: [1] }] }] } });
    expect(m.nodes.map((n) => [n.id, n.name, n.parent, n.kind, n.triangles])).toEqual([
      [1, 'Asm', 0, 'product', 3], [2, 'a', 1, 'product', 2], [3, 'tet', 2, 'body', 2], [4, 'b', 1, 'product', 1], [5, 'flat', 4, 'body', 1],
    ]);
    expect(m.faceIds).toEqual(['F3.0', 'F3.1', 'F5.0']);
  });
  it('put meshes no product lists under Other', () => {
    const m = buildPreviewMesh({ ...sample, root: { name: 'x', meshes: [0] } });
    expect(m.nodes.map((n) => n.name)).toEqual(['x', 'tet', 'Other', 'flat']);
    expect(m.faceIds[2]).toBe('F4.0');
  });
});

describe('resultOfBodies', () => {
  const pos = new Float32Array(9 * 4).map((_, i) => i), nor = new Float32Array(9 * 4);
  it('makes a mesh per body and a product tree from the paths, siblings of one name sharing a node', () => {
    const r = resultOfBodies(pos, nor, ['a', 'b', 'c'], ['Top\u001fArm', 'Top\u001fArm', 'Top'], [0, 1, 1, 3, 3, 4]);
    expect(r.meshes.map((m) => m.name)).toEqual(['a', 'b', 'c']);
    expect(r.meshes[1].index.array.length).toBe(6);
    const top = r.root!.children![0];
    expect(top.name).toBe('Top');
    expect(top.meshes).toEqual([2]);
    expect(top.children![0]).toMatchObject({ name: 'Arm', meshes: [0, 1] });
    const m = buildPreviewMesh(r);
    expect(m.triangles).toBe(4);
    expect(m.nodes.filter((n) => n.kind === 'body').length).toBe(3);
    expect(m.products).toBe(2);
  });
  it('puts a body with no product path at the top', () => {
    const r = resultOfBodies(pos, nor, ['solo'], [''], [0, 2]);
    expect(r.root!.meshes).toEqual([0]);
  });
});

describe('previewStep', () => {
  it('sends the text as bytes and returns a view body from the worker mesh', async () => {
    const f = fakeWorker((w) => w.onmessage?.({ data: { ok: true, mesh: buildPreviewMesh(sample) } }));
    const r = await previewStep('ISO-10303-21;', { spawn: f.spawn });
    expect(f.sent()).toBe(13);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.seconds).toBeGreaterThanOrEqual(0); expect(r.nodes.length).toBe(4); expect(r.triangles).toBe(3); expect(r.products).toBe(2); expect(r.view.mesh.triFace.length).toBe(3); expect(r.view.edges).toEqual([]); }
    expect(f.terminated()).toBe(true);
  });
  it('restarts the read with a trapped face skipped, and gives up on a face that traps twice', async () => {
    const skips: number[][] = [];
    let n = 0;
    const w: PreviewWorker = { onmessage: null, onerror: null, terminate() {}, postMessage(m) { skips.push(m.skip); n++; w.onmessage?.({ data: n === 1 ? { retry: 7 } : { ok: true, mesh: buildPreviewMesh(sample), unmeshed: 2 } }); } };
    const r = await previewStep('x', { spawn: () => w });
    expect(skips).toEqual([[], [7]]);
    expect(r.ok && r.unmeshed).toBe(2);
    const stuck: PreviewWorker = { onmessage: null, onerror: null, terminate() {}, postMessage() { stuck.onmessage?.({ data: { retry: 3 } }); } };
    expect(await previewStep('x', { spawn: () => stuck })).toMatchObject({ ok: false, code: 'failed' });
  });
  it('reports a worker error and an empty file as failures', async () => {
    const bad = fakeWorker((w) => w.onmessage?.({ data: { ok: false, message: 'boom' } }));
    expect(await previewStep('x', { spawn: bad.spawn })).toEqual({ ok: false, code: 'failed', message: 'boom' });
    const empty = fakeWorker((w) => w.onmessage?.({ data: { ok: true, mesh: buildPreviewMesh({ success: true, meshes: [] }) } }));
    const r = await previewStep('x', { spawn: empty.spawn });
    expect(r).toEqual({ ok: false, code: 'failed', message: 'no solid in the file' });
    const crash = fakeWorker((w) => w.onerror?.({ message: 'wasm trap' }));
    expect(await previewStep('x', { spawn: crash.spawn })).toEqual({ ok: false, code: 'failed', message: 'wasm trap' });
  });
  it('cancelling terminates the worker and resolves as cancelled', async () => {
    const f = fakeWorker(() => {});
    const ac = new AbortController();
    const p = previewStep('x', { spawn: f.spawn, signal: ac.signal });
    ac.abort();
    expect(await p).toEqual({ ok: false, code: 'cancelled', message: 'cancelled' });
    expect(f.terminated()).toBe(true);
  });
  it('viewOfPreview keeps the mesh arrays as they are', () => {
    const m = buildPreviewMesh(sample);
    expect(viewOfPreview(m).mesh.positions).toBe(m.positions);
  });
});
