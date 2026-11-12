// OBJ, GLB and 3MF as reference meshes: the probe, the record with its colours, the dialog and the file routing, with files made by our own writers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { bodiesToObj, meshToGlb, meshToThreeMf } from '@kit/io';
import { cube } from '../../../../packages/io/src/testmesh';
import { decode, matRuns, meshesOf, readMeshes } from './meshDoc';
import { MeshImportDialog } from './MeshImportDialog';
import { buildMeshRecord, meshKindOf, meshNameOf, meshNoteLines, probeMesh } from './meshImport';
import { dropKind, IMPORT_ACCEPT, OPEN_ACCEPT } from '../files/names';
import { planDrop } from '../files/drop';
import '../i18n';

afterEach(() => cleanup());
const bodies = [{ name: 'A', positions: cube(10), color: '#ff0000' }, { name: 'B', positions: Float32Array.from(cube(5), (v, i) => (i % 3 === 0 ? v + 20 : v)), color: '#0000ff' }];
const enc = new TextEncoder();

describe('routing', () => {
  it('.obj .glb .3mf are mesh kinds, in both picker lists, and name the mesh without the extension', () => {
    for (const f of ['a.obj', 'a.GLB', 'a.3mf']) expect(dropKind(f)).toBe(f.split('.')[1].toLowerCase());
    for (const e of ['.obj', '.glb', '.3mf']) { expect(OPEN_ACCEPT).toContain(e); expect(IMPORT_ACCEPT).toContain(e); }
    expect(meshKindOf('x.3MF')).toBe('3mf');
    expect(meshKindOf('x.step')).toBeNull();
    expect(meshNameOf('dir/Chair.glb')).toBe('Chair');
  });
  it('an .obj dropped with its .mtl is one import; two other files are still too many', () => {
    expect(planDrop(['a.obj', 'a.mtl'])).toEqual({ action: 'open', kind: 'obj', name: 'a.obj', mtl: 'a.mtl' });
    expect(planDrop(['a.mtl', 'a.OBJ'])).toMatchObject({ kind: 'obj', name: 'a.OBJ', mtl: 'a.mtl' });
    expect(planDrop(['a.obj', 'b.obj'])).toEqual({ action: 'multiple' });
    expect(planDrop(['a.stl'])).toEqual({ action: 'open', kind: 'stl', name: 'a.stl' });
  });
});

describe('probe and record', () => {
  it('OBJ: asks for the unit (none fixed), reports the lost MTL, and builds a record in the chosen unit', async () => {
    const data = enc.encode(bodiesToObj(bodies).data.replace('# units: mm', 'mtllib x.mtl\nvn 0 0 1'));
    const pr = await probeMesh('obj', data);
    if (!pr.ok) throw new Error(pr.code);
    expect(pr.probe).toMatchObject({ triangles: 24, format: 'obj', check: { watertight: true } });
    expect(pr.probe.unitFixed).toBeUndefined();
    const lines = meshNoteLines(pr.probe.notes!);
    expect(lines.some((l) => /Colours not read: the \.mtl file was not opened/.test(l))).toBe(true);
    expect(lines.some((l) => /Normals are not kept/.test(l))).toBe(true);
    const { rec } = await buildMeshRecord('obj', data, 'two.obj', 'cm', [], null);
    expect(rec).toMatchObject({ name: 'two', unit: 'cm', tris: 24 });
    expect(decode(rec).box.max[0]).toBeCloseTo(250, 3);   // 25 cm in mm
  });
  it('GLB: the unit is the file\'s (metres), colours are kept as runs, the record survives the document reader', async () => {
    const data = meshToGlb(bodies).data;
    const pr = await probeMesh('glb', data);
    if (!pr.ok) throw new Error(pr.code);
    expect(pr.probe).toMatchObject({ unitFixed: 'm', colours: 2, triangles: 24, format: 'glb' });
    expect(pr.probe.size[0]).toBeCloseTo(25, 2);
    const { rec } = await buildMeshRecord('glb', data, 'two.glb', 'mm', [], null);   // the unit passed is ignored: GLB states metres
    expect(decode(rec).box.max[0]).toBeCloseTo(25, 2);
    expect(rec.unit).toBe('m');
    expect(matRuns(rec)!.map((r) => r.color).sort()).toEqual(['#0000ff', '#ff0000']);
    expect(matRuns(rec)!.reduce((s, r) => s + r.count, 0)).toBe(24);
    expect(readMeshes([JSON.parse(JSON.stringify(rec))])[0].mats).toHaveLength(2);
    expect(meshesOf({ meshes: [rec] })).toHaveLength(1);
  });
  it('3MF: units and colours from the file', async () => {
    const data = (await meshToThreeMf(bodies)).data;
    const pr = await probeMesh('3mf', data);
    if (!pr.ok) throw new Error(pr.code);
    expect(pr.probe).toMatchObject({ unitFixed: 'mm', colours: 2, triangles: 24 });
    const { rec } = await buildMeshRecord('3mf', data, 'two.3mf', 'in', [], null);
    expect(decode(rec).box.max[0]).toBeCloseTo(25, 3);
    expect(rec.mats).toHaveLength(2);
  });
  it('a file that cannot be read gives the reader\'s code, which has a message', async () => {
    expect(await probeMesh('glb', enc.encode('hello world, not a glb'))).toEqual({ ok: false, code: 'notGlb' });
    expect(await probeMesh('3mf', enc.encode('not a zip, just some text'))).toEqual({ ok: false, code: 'notZip' });
    expect(await probeMesh('obj', enc.encode('nothing here'))).toEqual({ ok: false, code: 'notObj' });
  });
});

describe('MeshImportDialog for a GLB', () => {
  it('shows the fixed unit instead of the unit choice, the size as it is, the colours and what is not kept', async () => {
    const pr = await probeMesh('glb', meshToGlb(bodies).data);
    if (!pr.ok) throw new Error(pr.code);
    const onImport = vi.fn();
    const r = render(<MeshImportDialog name="two.glb" kind="glb" probe={pr.probe} unit="m" onImport={onImport} onCancel={() => {}} />);
    expect(r.container.textContent).toContain('Import GLB "two.glb"');
    expect(r.queryByTestId('mesh-import-unit')).toBeNull();
    expect(r.getByTestId('mesh-import-unit-fixed').textContent).toMatch(/Metres/);
    expect(r.getByTestId('mesh-import-size').textContent).toMatch(/25 x 10 x 10 mm/);
    expect(r.container.textContent).toMatch(/Colours read from the file: 2/);
    expect(r.getAllByTestId('mesh-import-note').some((n) => /Metres|metres and Y up/.test(n.textContent ?? ''))).toBe(true);
    fireEvent.click(r.getByTestId('mesh-import-ok'));
    expect(onImport).toHaveBeenCalledWith('m', false);
  });
});
