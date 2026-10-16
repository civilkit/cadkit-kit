import { describe, expect, it } from 'vitest';
import { renderSnapshot } from './render.js';
import { boxInput } from './testmesh.js';
import { bodyKey, bodyOrigin, faceLooks, lumps } from './appearance.js';
import type { SnapshotInput } from './types.js';

/** Two boxes with kernel-style face names ('F2.+z'), their edges naming the faces they join: F2 behind (z -30..-10), F4 in front (z 10..30). */
function twoBoxes(): SnapshotInput {
  const parts = [boxInput([-20, -20, -30], [20, 20, -10]), boxInput([-20, -20, 10], [20, 20, 30])];
  const owners = ['F2', 'F4'];
  const faceIds: string[] = [], pos: number[] = [], nrm: number[] = [], tf: number[] = [], edges: NonNullable<SnapshotInput['edges']> = [];
  const adj: Record<string, [string, string]> = {};   // box edge i (see boxInput) -> its two faces
  const E = [['-z', '-y'], ['-z', '+y'], ['+y', '-z'], ['-z', '-x'], ['+z', '-y'], ['+z', '+x'], ['+z', '+y'], ['+z', '-x'], ['-x', '-y'], ['+x', '-y'], ['+x', '+y'], ['-x', '+y']] as Array<[string, string]>;
  E.forEach((e, i) => { adj[i] = e; });
  parts.forEach((p, k) => {
    const base = faceIds.length;
    pos.push(...(p.mesh.positions as Float32Array)); nrm.push(...(p.mesh.normals as Float32Array));
    for (const f of p.mesh.triFace as Int32Array) tf.push(f + base);
    const names = p.mesh.faceIds!.map((s) => `${owners[k]}.${s}`);
    faceIds.push(...names);
    p.edges!.forEach((e, i) => edges.push({ ...e, key: `${owners[k]}.e${i}`, faces: [`${owners[k]}.${adj[i][0]}`, `${owners[k]}.${adj[i][1]}`] }));
  });
  return { mesh: { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), triFace: Int32Array.from(tf), faceIds }, edges, box: { min: [-20, -20, -30], max: [20, 20, 30] }, name: 'two' };
}
const centre = (png: { rgba: Uint8Array; width: number; height: number }): [number, number, number] => {
  const i = ((png.height >> 1) * png.width + (png.width >> 1)) * 4;
  return [png.rgba[i], png.rgba[i + 1], png.rgba[i + 2]];
};
const shot = async (input: SnapshotInput, opts = {}) => renderSnapshot(input, { view: { dir: [0, 0, 1], up: [0, 1, 0] } as never, style: 'shaded', size: 96, ...opts });
// F4 is nearest the camera (the view looks along -z from +z): a glass pane in front of a red block

describe('bodies in the snapshot', () => {
  it('finds the lumps from the edges that join faces, and keys them the way the app does', () => {
    const inp = twoBoxes();
    const l = lumps(inp.mesh.faceIds!, inp.edges!);
    expect(l).toHaveLength(2);
    expect(l.map(bodyKey).sort()).toEqual(['@body:F2.+x', '@body:F4.+x']);
    expect(l.map(bodyOrigin).sort()).toEqual(['F2', 'F4']);
  });
  it('a feature entry covers its body, a body entry overrides it, a hidden body has no faces; faceAppearance prefixes work', () => {
    const inp = twoBoxes();
    const r = faceLooks(inp.mesh, inp.edges!, { appearance: { F2: { color: '#112233', opacity: 0.5 }, '@body:F2.+x': { color: '#ffffff' } }, faceAppearance: { 'F4.*': { color: '#00ff00', finish: 'chrome' }, 'F4.+z': { finish: 'matte' } }, view: { hiddenBodies: ['@body:F4.+x'] } });
    expect(r.looks.get('F2.-y')).toEqual({ color: '#ffffff', opacity: 0.5 });
    expect(r.looks.get('F4.+z')).toEqual({ color: '#00ff00', finish: 'matte' });
    expect(r.hidden.has('F4.-x')).toBe(true);
    expect(r.hidden.has('F2.-x')).toBe(false);
  });
  it('draws a body in its colour', async () => {
    const inp = twoBoxes();
    const grey = centre(await shot(inp));
    const red = centre(await shot({ ...inp, appearance: { appearance: { F4: { color: '#ff0000' } } } }));
    expect(red[0]).toBeGreaterThan(red[1] * 3);
    expect(grey[0]).toBeLessThan(grey[2]);   // the default is a blue-grey
  });
  it('shows the body behind a clear one, tinted by it, and the opaque version hides it', async () => {
    const inp = twoBoxes();
    const behind = { F2: { color: '#ff0000' } };
    const opaque = centre(await shot({ ...inp, appearance: { appearance: { ...behind, F4: { color: '#2060ff', opacity: 1 } } } }));
    const glass = centre(await shot({ ...inp, appearance: { appearance: { ...behind, F4: { color: '#2060ff', opacity: 0.2, finish: 'glass' } } } }));
    expect(opaque[2]).toBeGreaterThan(opaque[0] * 2);          // the front block is blue and hides the red one
    expect(glass[0]).toBeGreaterThan(glass[2]);                // through the pane the red block dominates
    expect(glass[0]).toBeGreaterThan(120);
    expect(glass[2]).toBeGreaterThan(30);                      // but the pane tints it
  });
  it('the order of two clear bodies follows depth, not list order', async () => {
    const inp = twoBoxes();
    const a = centre(await shot({ ...inp, appearance: { appearance: { F2: { color: '#ff0000', opacity: 0.5 }, F4: { color: '#0000ff', opacity: 0.5 } } } }));
    // F4 is nearer: it is blended last, so blue weighs more than red
    expect(a[2]).toBeGreaterThan(a[0]);
  });
  it('hidden bodies are not drawn, and opts.appearance:false draws the default grey', async () => {
    const inp = twoBoxes();
    const hid = centre(await shot({ ...inp, appearance: { appearance: { F2: { color: '#ff0000' } }, view: { hiddenBodies: ['@body:F4.+x'] } } }));
    expect(hid[0]).toBeGreaterThan(hid[2] * 2);                // only the red block is left
    const off = centre(await shot({ ...inp, appearance: { appearance: { F4: { color: '#ff0000' } } } }, { appearance: false }));
    expect(off[2]).toBeGreaterThan(off[0]);   // still the default blue-grey, not red
  });
  it('finishes shade differently: chrome is not the matte grey', async () => {
    const inp = twoBoxes();
    const m = await shot({ ...inp, appearance: { appearance: { F4: { color: '#cccccc', finish: 'matte' } } } });
    const c = await shot({ ...inp, appearance: { appearance: { F4: { color: '#cccccc', finish: 'chrome' } } } }, {});
    expect(centre(m)).not.toEqual(centre(c));
  });
});
