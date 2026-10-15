import { describe, expect, it } from 'vitest';
import { importFcDocument, importFcstd } from './import';
import { zipEntries, zipFile } from './zip';
import { DOC, pl, zip } from './fixture';

describe('FCStd importer', () => {
  it('maps a sketch and a pad, and turns what it cannot map into warnings', () => {
    const r = importFcDocument(DOC, 'Fixture');
    expect(r.part.name).toBe('Fixture');
    const types = r.part.features.map((f) => f.type);
    expect(types).toEqual(['sketch', 'extrude']);
    const sk = r.part.features[0] as { points: Array<{ id: string }>; entities: Array<{ type: string }>; constraints: Array<{ type: string }>; plane: unknown };
    expect(sk.plane).toEqual({ kind: 'std', id: 'front' });
    expect(sk.entities).toHaveLength(4);
    expect(sk.points).toHaveLength(5); // O + 4 shared corners: coincident endpoints merge
    expect(sk.constraints.map((c) => c.type).sort()).toEqual(['hdist', 'horizontal']);
    expect(r.part.features[1]).toMatchObject({ type: 'extrude', op: 'add', end: 'blind', depth: 5 });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ fc: 'Pad', shape: 'Pad.Shape.brp' });
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['edgeReferences', 'endCondition']));
    expect(r.warnings.find((w) => w.code === 'edgeReferences')?.object).toBe('Fillet');
  });

  it('puts a sketch on an offset plane and flips for a reversed normal', () => {
    // sketch on XY at z = 7 whose normal points down (rotated 180 degrees about X): the pad goes with the FreeCAD normal, so against ours
    const doc = DOC.replace(`<Property name="Placement" type="App::PropertyPlacement">${pl(0, 0, 0)}`, `<Property name="Placement" type="App::PropertyPlacement">${pl(0, 0, 7, [1, 0, 0, 0])}`);
    const r = importFcDocument(doc);
    expect(r.part.features[0]).toMatchObject({ type: 'plane', mode: 'offset', offset: 7, base: { id: 'front' } });
    const ex = r.part.features.find((f) => f.type === 'extrude');
    expect(ex).toMatchObject({ flip: true });
  });

  it('never throws: bad input gives warnings', async () => {
    expect(importFcDocument('not xml <<').warnings.length).toBeGreaterThan(0);
    expect(importFcDocument('<Document><Objects/><ObjectData/></Document>').warnings[0].code).toBe('noBody');
    const r = await importFcstd(new Uint8Array([1, 2, 3]));
    expect(r.warnings[0].code).toBe('zip');
    const r2 = await importFcstd(zip({ 'other.txt': 'x' }));
    expect(r2.warnings[0].code).toBe('noDocument');
  });

  it('reads stored and deflated zip entries', async () => {
    for (const deflate of [false, true]) {
      const z = zip({ 'Document.xml': DOC, 'a.txt': 'hello' }, deflate);
      expect(zipEntries(z).map((e) => e.name)).toEqual(['Document.xml', 'a.txt']);
      expect(new TextDecoder().decode((await zipFile(z, 'a.txt'))!)).toBe('hello');
      const r = await importFcstd(z, 'Zipped');
      expect(r.steps).toHaveLength(1);
    }
  });
});
