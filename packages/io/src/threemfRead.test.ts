import { describe, expect, it } from 'vitest';
import { meshToThreeMf } from './threemf';
import { MeshReadError, readThreeMf, zipWrite } from './index';
import { cube, cylinder, volumeOf } from './testmesh';

const NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const enc = new TextEncoder();
/** A 3MF package from the model XML body (and extra files), stored uncompressed. */
const pack = (model: string, extra: Array<{ name: string; data: string }> = []) =>
  zipWrite([{ name: '3D/3dmodel.model', data: enc.encode(model) }, ...extra.map((f) => ({ name: f.name, data: enc.encode(f.data) }))], { deflate: false });
const model = (inner: string, unit = 'millimeter', attrs = '') => `<?xml version="1.0"?><model unit="${unit}" xmlns="${NS}" ${attrs}>${inner}</model>`;
/** A triangle (0,0,0) (1,0,0) (0,1,0) as an object. */
const triObj = (id: number, extra = '', tri = '') => `<object id="${id}" type="model" ${extra}><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2" ${tri}/></triangles></mesh></object>`;

describe('readThreeMf round trip with our writer', () => {
  it('a cube: counts, box, volume, watertight; stored and deflated packages read alike', async () => {
    for (const deflate of [false, true]) {
      const r = await readThreeMf((await meshToThreeMf([{ name: 'Block', positions: cube(10) }], { deflate })).data);
      expect(r.triangles).toBe(12);
      expect(r.mesh.vertices.length / 3).toBe(8);
      expect(r.bbox).toEqual({ min: [0, 0, 0], max: [10, 10, 10] });
      expect(volumeOf(r.mesh.vertices, r.mesh.indices)).toBeCloseTo(1000, 3);
      expect(r.check.watertight).toBe(true);
      expect(r.mats).toBeUndefined();
      expect(r.unit).toBe('mm');
    }
  });
  it('two coloured bodies: both colours with opacity, merged and reported', async () => {
    const moved = Float32Array.from(cylinder(3, 8, 16), (v, i) => (i % 3 === 0 ? v + 30 : v));
    const r = await readThreeMf((await meshToThreeMf([{ name: 'A', positions: cube(10), color: '#ff0000' }, { name: 'B', positions: moved, color: '#00ff00', opacity: 0.5 }])).data);
    expect(r.parts).toBe(2);
    expect(r.triangles).toBe(12 + 16 * 4);
    expect(r.mats!.map((m) => `${m.c}/${m.o}`).sort()).toEqual(['#00ff00/0.502', '#ff0000/1']);
    expect(r.notes).toContainEqual({ code: 'partsMerged', n: 2 });
  });
});

describe('readThreeMf by hand', () => {
  it('units: inch, centimeter, micron and foot become millimetres', async () => {
    const cases: Array<[string, number]> = [['inch', 25.4], ['centimeter', 10], ['micron', 0.001], ['foot', 304.8], ['meter', 1000], ['millimeter', 1]];
    for (const [u, k] of cases) {
      const r = await readThreeMf(await pack(model(`<resources>${triObj(1)}</resources><build><item objectid="1"/></build>`, u)));
      expect(r.bbox.max[0]).toBeCloseTo(k, 4);
      if (u !== 'millimeter') expect(r.notes).toContainEqual({ code: 'unitConverted', text: u });
    }
    const inch = await readThreeMf(await pack(model(`<resources>${triObj(1)}</resources><build><item objectid="1"/></build>`, 'inch')));
    expect(inch.unit).toBe('in');
  });
  it('item transform (row vectors: rotation block then translation) and a component with its own transform', async () => {
    // item: rotate 90 degrees about Z (x -> y), then move 10 in x. Row vector convention: (1,0,0) * [0 1 0; -1 0 0; 0 0 1] = (0,1,0)
    const rot = '0 1 0 -1 0 0 0 0 1 10 0 0';
    const xml = model(`<resources>${triObj(1)}<object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 5"/></components></object></resources><build><item objectid="2" transform="${rot}"/></build>`);
    const r = await readThreeMf(await pack(xml));
    // vertices: (0,0,5) (1,0,5) (0,1,5) -> rotate: (0,0,5) (0,1,5) (-1,0,5) -> +10 x: (10,0,5) (10,1,5) (9,0,5)
    const v = Array.from(r.mesh.vertices).map((x) => Math.round(x * 1000) / 1000 + 0);
    expect([0, 1, 2].map((i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]])).toEqual([[10, 0, 5], [10, 1, 5], [9, 0, 5]]);
  });
  it('a mirroring transform flips the winding so the triangle keeps facing the same way', async () => {
    const plain = await readThreeMf(await pack(model(`<resources>${triObj(1)}</resources><build><item objectid="1"/></build>`)));
    const mir = await readThreeMf(await pack(model(`<resources>${triObj(1)}</resources><build><item objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/></build>`)));
    const nz = (m: typeof plain) => { const v = m.mesh.vertices, i = m.mesh.indices; return (v[i[1] * 3] - v[i[0] * 3]) * (v[i[2] * 3 + 1] - v[i[0] * 3 + 1]) - (v[i[1] * 3 + 1] - v[i[0] * 3 + 1]) * (v[i[2] * 3] - v[i[0] * 3]); };
    expect(nz(plain)).toBeGreaterThan(0);
    expect(nz(mir)).toBeGreaterThan(0);
  });
  it('colours: basematerials on the object, and per triangle from a colour group; the materials-extension prefix is fine', async () => {
    const xml = model(
      `<resources><basematerials id="5"><base name="r" displaycolor="#FF0000"/><base name="b" displaycolor="#0000FF80"/></basematerials>` +
      `<m:colorgroup id="6"><m:color color="#00FF00"/></m:colorgroup>` +
      `<object id="1" pid="5" pindex="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices>` +
      `<triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="2" v3="3" pid="6" p1="0"/><triangle v1="0" v2="1" v3="3" pid="5" p1="0"/></triangles></mesh></object></resources>` +
      `<build><item objectid="1"/></build>`, 'millimeter', 'xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"');
    const r = await readThreeMf(await pack(xml));
    expect(r.mats!.map((m) => m.c).sort()).toEqual(['#00ff00', '#0000ff', '#ff0000'].sort());
    expect(r.mats!.find((m) => m.c === '#0000ff')!.o).toBeCloseTo(0.502, 3);
    expect(r.tm!.length).toBe(3);
  });
  it('textures are reported; print supports are left out and reported', async () => {
    const xml = model(`<resources><m:texture2dgroup id="9" texid="1"/>${triObj(1, 'pid="9" pindex="0"')}<object id="2" type="support"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/><item objectid="2"/></build>`);
    const r = await readThreeMf(await pack(xml));
    expect(r.triangles).toBe(1);
    expect(r.notes).toEqual(expect.arrayContaining([{ code: 'textures' }, { code: 'supportObjects', n: 1 }]));
  });
  it('a component in another model file of the package (production path attribute)', async () => {
    const other = model(`<resources>${triObj(1)}</resources>`);
    const xml = model(`<resources><object id="7"><components><component objectid="1" path="/3D/Objects/a.model" transform="1 0 0 0 1 0 0 0 1 3 0 0"/></components></object></resources><build><item objectid="7"/></build>`);
    const r = await readThreeMf(await pack(xml, [{ name: '3D/Objects/a.model', data: other }]));
    expect(r.triangles).toBe(1);
    expect(r.bbox.min[0]).toBe(3);
    const missing = await readThreeMf(await pack(model(`<resources>${triObj(1)}<object id="7"><components><component objectid="1" path="/3D/gone.model"/><component objectid="1"/></components></object></resources><build><item objectid="7"/></build>`)));
    expect(missing.notes).toContainEqual({ code: 'externalParts', n: 1 });
  });
  it('the model path comes from _rels/.rels when it is not the usual one', async () => {
    const data = await zipWrite([
      { name: 'other/m.model', data: enc.encode(model(`<resources>${triObj(1)}</resources><build><item objectid="1"/></build>`)) },
      { name: '_rels/.rels', data: enc.encode('<Relationships><Relationship Target="/other/m.model" Id="r0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    ], { deflate: false });
    expect((await readThreeMf(data)).triangles).toBe(1);
  });
  it('refuses a non-zip, a package with no model, a model with no mesh, and an empty file', async () => {
    const code = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as MeshReadError).code; } return 'none'; };
    expect(await code(readThreeMf(enc.encode('not a zip at all, just text')))).toBe('notZip');
    expect(await code(readThreeMf(await zipWrite([{ name: 'a.txt', data: enc.encode('x') }], { deflate: false })))).toBe('no3mfModel');
    expect(await code(readThreeMf(await pack(model('<resources/><build/>'))))).toBe('noMesh');
    expect(await code(readThreeMf(new Uint8Array(0)))).toBe('empty');
  });
});
