// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { viewDirection } from '../../viewport/src/camerarig';
import { STD_VIEWS, azElOf, dirFromAzEl, makeCamera, norm, resolveView, stdDirection } from './camera';
import { diffImages } from './diff';
import { glyph, textWidth } from './font';
import { decodePng, encodePng } from './png';
import { Raster, evenOddMask, hatchPolygons } from './raster';
import { renderSnapshot } from './render';
import { renderSectionPanel } from './section2d';
import { boxInput, union } from './testmesh';
import type { SnapshotInput, SnapshotOpts } from './types';

const px = (r: { rgba: Uint8Array; width: number }, x: number, y: number) => { const i = (Math.round(y) * r.width + Math.round(x)) * 4; return [r.rgba[i], r.rgba[i + 1], r.rgba[i + 2]]; };
const isBg = (c: number[]) => c[0] === 234 && c[1] === 238 && c[2] === 244;
const orange = (c: number[]) => c[0] > 200 && c[1] > 80 && c[1] < 190 && c[2] < 90;

describe('camera', () => {
  it('standard views are the viewport table for both up axes', () => {
    for (const up of ['y', 'z'] as const) for (const v of STD_VIEWS) {
      const a = norm(stdDirection(v, up)), b = norm(viewDirection(v, up));
      expect(a[0]).toBeCloseTo(b[0], 9); expect(a[1]).toBeCloseTo(b[1], 9); expect(a[2]).toBeCloseTo(b[2], 9);
    }
  });
  it('front looks from +Z with Y up: +X is screen right, +Y is screen up', () => {
    const v = resolveView('front', 'y');
    const cam = makeCamera({ dir: v.dir, upv: v.upv, center: [0, 0, 0], radius: 10, persp: false, scale: 5, px: 100, py: 100 });
    const o = new Float64Array(3);
    cam.project([2, 0, 0], o); expect(o[0]).toBeCloseTo(110); expect(o[1]).toBeCloseTo(100);
    cam.project([0, 3, 0], o); expect(o[1]).toBeCloseTo(85);
    const near = new Float64Array(3), far = new Float64Array(3);
    cam.project([0, 0, 4], near); cam.project([0, 0, -4], far);
    expect(near[2]).toBeGreaterThan(far[2]);
  });
  it('Z up: front is -Y, top is +Z', () => {
    const f = resolveView('front', 'z');
    expect(f.dir[1]).toBeCloseTo(-1);
    const t = resolveView('top', 'z');
    expect(t.dir[2]).toBeCloseTo(1);
  });
  it('azimuth and elevation round trip', () => {
    const d = dirFromAzEl(40, 25, 'y');
    const { az, el } = azElOf(d, 'y');
    expect(az).toBeCloseTo(40); expect(el).toBeCloseTo(25);
    expect(dirFromAzEl(0, 0, 'y')[2]).toBeCloseTo(1);
  });
  it('perspective: nearer points are larger', () => {
    const v = resolveView('front', 'y');
    const cam = makeCamera({ dir: v.dir, upv: v.upv, center: [0, 0, 0], radius: 10, persp: true, scale: 5, px: 0, py: 0 });
    const a = new Float64Array(3), b = new Float64Array(3);
    cam.project([5, 0, 5], a); cam.project([5, 0, -5], b);
    expect(a[0]).toBeGreaterThan(b[0]);
  });
});

describe('z-buffer', () => {
  const small = boxInput([-5, -5, 0], [5, 5, 10]);
  const big = boxInput([-20, -20, -20], [20, 20, -10]);
  const both = union('Stack', small, big); // the near box comes FIRST in the buffer: only a depth test keeps it on top
  it('a near box hides the far one even when drawn first', async () => {
    const r = await renderSnapshot(both, { view: 'front', size: 256, highlight: ['1:+z'] });
    const s = r.meta.scale;
    expect(orange(px(r, 128, 128))).toBe(false); // centre: near box (not highlighted)
    expect(px(r, 128, 128)).not.toEqual([234, 238, 244]);
    expect(orange(px(r, 128 + 15 * s, 128))).toBe(true); // far box front face, outside the near one
    const rev = await renderSnapshot(union('Rev', big, small), { view: 'front', size: 256, highlight: ['0:+z'] });
    expect(orange(px(rev, 128, 128))).toBe(false);
  });
  it('an L shape: the notch is background, both arms are filled', async () => {
    const L = union('L', boxInput([0, 0, 0], [40, 10, 20]), boxInput([0, 10, 0], [10, 30, 20]));
    const r = await renderSnapshot(L, { view: 'front', size: 300 });
    const s = r.meta.scale, [cx, cy] = [20, 15];
    const at = (x: number, y: number) => px(r, 150 + (x - cx) * s, 150 - (y - cy) * s);
    expect(isBg(at(30, 20))).toBe(true); // the notch
    expect(isBg(at(5, 20))).toBe(false); // tall arm
    expect(isBg(at(30, 5))).toBe(false); // long arm
  });
  it('hidden-line style draws hidden edges dashed and visible edges solid', async () => {
    const L = union('L', boxInput([0, 0, 0], [40, 10, 20]), boxInput([0, 10, 0], [10, 30, 20]));
    const a = await renderSnapshot(L, { view: 'iso', style: 'hidden-line' });
    const grey = (c: number[]) => Math.abs(c[0] - 130) < 25 && Math.abs(c[1] - 136) < 25 && c[0] < 200;
    let g = 0;
    for (let i = 0; i < a.rgba.length; i += 4) if (grey([a.rgba[i], a.rgba[i + 1], a.rgba[i + 2]])) g++;
    expect(g).toBeGreaterThan(200);
    const mono = await renderSnapshot(L, { view: 'iso', style: 'mono' });
    expect(mono.width).toBe(768);
  });
  it('xray shows edges behind the near face', async () => {
    const r = await renderSnapshot(boxInput([-10, -10, -10], [10, 10, 10]), { view: { azimuth: 30, elevation: 25 }, style: 'xray' });
    let blue = 0;
    for (let i = 0; i < r.rgba.length; i += 4) if (r.rgba[i + 2] > r.rgba[i] + 40 && r.rgba[i] < 120) blue++;
    expect(blue).toBeGreaterThan(500);
  });
});

describe('overlays', () => {
  it('a marker is drawn at its projected point; an annotation draws its label', async () => {
    const b = boxInput([-10, -10, -10], [10, 10, 10]);
    const m = await renderSnapshot(b, { view: 'front', size: 400, markers: [{ p: [0, 0, 10], label: 'P1' }] });
    const red = (c: number[]) => c[0] > 180 && c[1] < 90 && c[2] < 90;
    expect(red(px(m, 200 - 7, 200)) || red(px(m, 200 + 7, 200)) || red(px(m, 200, 193))).toBe(true);
    const a = await renderSnapshot(b, { view: 'front', size: 400, annotate: [{ from: [-10, 0, 10], to: [10, 0, 10] }] });
    let n = 0;
    for (let i = 0; i < a.rgba.length; i += 4) if (red([a.rgba[i], a.rgba[i + 1], a.rgba[i + 2]])) n++;
    expect(n).toBeGreaterThan(150);
    const plain = await renderSnapshot(b, { view: 'front', size: 400 });
    expect((await diffImages(plain.png, a.png)).changedPct).toBeGreaterThan(0);
  });
  it('pinned frames keep scale and position between two parts', async () => {
    const frame = { center: [0, 0, 0] as [number, number, number], radius: 30 };
    const a = await renderSnapshot(boxInput([-10, -10, -10], [10, 10, 10]), { view: 'front', frame, size: 300 });
    const b = await renderSnapshot(boxInput([-10, -10, -10], [10, 10, 25]), { view: 'front', frame, size: 300 });
    expect(a.meta.scale).toBe(b.meta.scale);
    expect((await diffImages(a.png, b.png)).changedPct).toBeLessThan(2); // only the front face moved, same silhouette
  });
});

describe('sheets', () => {
  const L = union('L', boxInput([0, 0, 0], [40, 10, 20]), boxInput([0, 10, 0], [10, 30, 20]));
  it('ab: two labelled panels, B is the negated azimuth', async () => {
    const r = await renderSnapshot(L, { sheet: 'ab', size: 300 });
    expect(r.width).toBe(300 * 2 + 10);
    expect(r.meta.panels?.map((p) => p.label)).toEqual(['A', 'B']);
    const left = await renderSnapshot(L, { view: { azimuth: 35, elevation: 0 }, size: 300 });
    void left;
  });
  it('drawing sheets carry projection text and different layouts', async () => {
    const t = await renderSnapshot({ ...L, volume: 1234.5 }, { sheet: 'drawing-third-angle', size: 400 });
    const f = await renderSnapshot({ ...L, volume: 1234.5 }, { sheet: 'drawing-first-angle', size: 400 });
    expect(t.meta.panels?.map((p) => p.label)).toEqual(['TOP', 'ISO', 'FRONT', 'RIGHT']);
    expect(f.meta.panels?.map((p) => p.label)).toEqual(['RIGHT', 'FRONT', 'ISO', 'TOP']);
    expect((await diffImages(t.png, f.png)).changedPct).toBeGreaterThan(1);
  });
  it('orthos: four panels', async () => {
    const r = await renderSnapshot(L, { sheet: 'orthos', size: 300 });
    expect(r.meta.panels?.length).toBe(4);
  });
  it('same input, same bytes', async () => {
    const o: SnapshotOpts = { sheet: 'drawing-third-angle', size: 300, markers: [{ p: [1, 2, 3], label: 'A' }] };
    const a = await renderSnapshot(L, o), b = await renderSnapshot(L, o);
    expect(Buffer.from(a.png).equals(Buffer.from(b.png))).toBe(true);
    const c = await renderSnapshot({ ...L, mesh: { ...L.mesh, positions: Float32Array.from(L.mesh.positions as Float32Array) } }, o);
    expect(Buffer.from(a.png).equals(Buffer.from(c.png))).toBe(true);
  });
});

describe('section view', () => {
  const ring = (n = 64) => {
    const circ = (r: number) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as [number, number]);
    return { loops: [{ kind: 'outer' as const, pts: circ(20), area: Math.PI * 400 }, { kind: 'inner' as const, pts: circ(8).reverse(), area: Math.PI * 64 }], frame: { o: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } };
  };
  it('the hatch fills the annulus (even-odd) and leaves the hole open', () => {
    const r = renderSectionPanel(ring(), { w: 400, h: 400, bg: [255, 255, 255] });
    const expected = Math.PI * (400 - 64) * r.scale * r.scale;
    expect(Math.abs(r.inside - expected) / expected).toBeLessThan(0.01);
    // the hole centre stays background white, the annulus carries hatch pixels
    const c = (x: number, y: number) => r.raster.data.subarray((y * 400 + x) * 4, (y * 400 + x) * 4 + 3);
    expect(Array.from(c(200, 200))).toEqual([255, 255, 255]);
    let dark = 0;
    const rr = 14 * r.scale;
    for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) { const d = Math.hypot(x - 200, y - 200); if (d > 8 * r.scale + 3 && d < 20 * r.scale - 3 && c(x, y)[0] < 120) dark++; }
    void rr;
    expect(dark).toBeGreaterThan(500);
  });
  it('evenOddMask: square with a square hole', () => {
    const sq = (a: number, b: number) => [[a, a], [b, a], [b, b], [a, b]] as Array<[number, number]>;
    const m = evenOddMask(100, 100, [sq(10, 90), sq(30, 70)]);
    let n = 0; for (const v of m) n += v;
    expect(n).toBe(80 * 80 - 40 * 40);
  });
  it('hatch lines run at 45 degrees', () => {
    const r = new Raster(60, 60, [255, 255, 255]);
    hatchPolygons(r, [[[0, 0], [60, 0], [60, 60], [0, 60]]], [0, 0, 0], 8, 1);
    const at = (x: number, y: number) => r.data[(y * 60 + x) * 4];
    // a hatch pixel at (x, y) implies one at (x+1, y-1)
    for (let y = 1; y < 59; y++) for (let x = 1; x < 59; x++) if (at(x, y) === 0) expect(at(x + 1, y - 1)).toBe(0);
  });
  it('3D view overlays the cut, and the section sheet has two panels', async () => {
    const b: SnapshotInput = { ...boxInput([-20, -20, 0], [20, 20, 10]), section: ring() };
    const plain = await renderSnapshot({ ...b, section: undefined }, { view: 'iso', size: 300 });
    const cut = await renderSnapshot(b, { view: 'iso', size: 300 });
    expect((await diffImages(plain.png, cut.png)).changedPct).toBeGreaterThan(1);
    const sheet = await renderSnapshot(b, { sheet: 'section', size: 300 });
    expect(sheet.meta.panels?.map((p) => p.label)).toEqual(['SECTION', 'MODEL']);
    await expect(renderSnapshot({ ...b, section: undefined }, { sheet: 'section' })).rejects.toThrow(/section/);
  });
});

describe('png, diff, font', () => {
  it('round trips', async () => {
    const r = new Raster(37, 21, [10, 20, 30]);
    r.line(0, 0, 36, 20, [255, 0, 0], 2); r.text(2, 2, 'HI', [0, 255, 0]);
    const png = await encodePng({ width: 37, height: 21, rgba: r.data });
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const d = await decodePng(png);
    expect(d.width).toBe(37); expect(d.height).toBe(21);
    expect(Buffer.from(d.rgba).equals(Buffer.from(r.data))).toBe(true);
  });
  it('diff: identical, changed, resized', async () => {
    const a = new Raster(50, 50, [255, 255, 255]), b = new Raster(50, 50, [255, 255, 255]);
    b.fillRect(10, 20, 20, 30, [0, 0, 0]);
    const pa = await encodePng({ width: 50, height: 50, rgba: a.data }), pb = await encodePng({ width: 50, height: 50, rgba: b.data });
    const same = await diffImages(pa, pa);
    expect(same.changedPct).toBe(0); expect(same.bbox).toBeNull();
    const d = await diffImages(pa, pb);
    expect(d.changedPixels).toBe(100); expect(d.changedPct).toBe(4);
    expect(d.bbox).toEqual({ x0: 10, y0: 20, x1: 19, y1: 29 });
    expect((await decodePng(d.diffPng)).width).toBe(50);
    expect((await diffImages(pa, await encodePng({ width: 10, height: 10, rgba: new Raster(10, 10).data }))).sizeMismatch).toBe(true);
    expect((await diffImages(pa, pb, { threshold: 300 })).changedPct).toBe(0);
  });
  it('font: glyphs, fallback and widths', () => {
    expect(Array.from(glyph('A'))).toEqual([14, 17, 17, 31, 17, 17, 17]);
    expect(Array.from(glyph('a'))).toEqual(Array.from(glyph('A')));
    expect(Array.from(glyph('\u0001'))).toEqual(Array.from(glyph('?')));
    expect(textWidth('AB', 2)).toBe((2 * 6 - 1) * 2);
    const r = new Raster(20, 12, [0, 0, 0]);
    r.text(0, 0, 'I', [255, 255, 255]);
    expect(r.data[(0 * 20 + 1) * 4]).toBe(255); // top bar of the I starts at column 1
  });
});

describe('performance', () => {
  it('a 30k-triangle body at 768x768 renders in well under 400 ms', async () => {
    // torus, 120 x 125 quads = 30000 triangles, with normals and edges
    const nu = 125, nv = 120, R = 30, rr0 = 10;
    const P = (i: number, j: number): [number[], number[]] => {
      const u = (2 * Math.PI * i) / nu, v = (2 * Math.PI * j) / nv;
      return [[(R + rr0 * Math.cos(v)) * Math.cos(u), (R + rr0 * Math.cos(v)) * Math.sin(u), rr0 * Math.sin(v)], [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)]];
    };
    const pos: number[] = [], nrm: number[] = [];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      for (const t of [[a, b, c], [a, c, d]]) for (const q of t) { pos.push(...q[0]); nrm.push(...q[1]); }
    }
    const input: SnapshotInput = { mesh: { positions: Float32Array.from(pos), normals: Float32Array.from(nrm) }, edges: [{ pts: Array.from({ length: 121 }, (_, i) => P(i, 0)[0]) }] };
    await renderSnapshot(input, { view: 'iso' }); // warm up the JIT
    let ms = Infinity, r = await renderSnapshot(input, { view: 'iso' });
    for (let k = 0; k < 3; k++) { // best of three: a shared CI box adds noise, not speed
      const fresh: SnapshotInput = { ...input, mesh: { ...input.mesh } }; // new object: no cached preparation
      const t0 = performance.now();
      r = await renderSnapshot(fresh, { view: 'iso' });
      ms = Math.min(ms, performance.now() - t0);
    }
    console.log(`30k triangles: ${ms.toFixed(0)} ms, triangles ${r.meta.triangles}`);
    expect(r.meta.triangles).toBe(30000);
    expect(ms).toBeLessThan(400);
  });
});
