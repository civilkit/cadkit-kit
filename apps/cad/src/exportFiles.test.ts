import { describe, expect, it } from 'vitest';
import { exportCkpart, exportGlb, exportObj, exportThreeMf, exportStep, exportStl, fileStem, meshRequest } from './exportFiles';
import { cube } from '../../../packages/io/src/testmesh';

describe('exportFiles', () => {
  it('file stems are safe and never empty', () => {
    expect(fileStem('a/b:c*?')).toBe('a_b_c__');
    expect(fileStem('  ')).toBe('part');
    expect(fileStem(undefined)).toBe('part');
    expect(fileStem('..hidden')).toBe('hidden');
  });
  it('STL: binary default, ASCII on request, name from the part', () => {
    const b = exportStl({ positions: cube() }, 'Box 1');
    expect(b.file?.name).toBe('Box 1.stl');
    expect(b.file?.data).toBeInstanceOf(Uint8Array);
    expect(b.notices.map((n) => n.key)).toEqual(['io.done']);
    const a = exportStl({ positions: cube() }, 'Box 1', false);
    expect(typeof a.file?.data).toBe('string');
    expect((a.file?.data as string).startsWith('solid Box 1')).toBe(true);
  });
  it('warns when the mesh is open, with the counts', () => {
    const r = exportStl({ positions: cube().subarray(9) }, 'Open');
    expect(r.file).toBeDefined();
    expect(r.notices[1]).toMatchObject({ level: 'warn', key: 'io.notWatertight', params: { open: 3 } });
  });
  it('a part file is the document text under a safe name', () => {
    const r = exportCkpart('{"format":"ck-part"}', 'Dash - Tach/gauge');
    expect(r.file).toMatchObject({ name: 'Dash - Tach_gauge.ckpart', mime: 'application/json' });
    expect(exportCkpart(null, 'x').notices).toEqual([{ level: 'error', key: 'io.noBody' }]);
  });
  it('no body is an error notice and no file', () => {
    for (const r of [exportStl(null, 'x'), exportObj(null, 'x'), exportStep(null, 'x')]) {
      expect(r.file).toBeUndefined();
      expect(r.notices).toEqual([{ level: 'error', key: 'io.noBody' }]);
    }
  });
  it('OBJ and STEP get their extension and type', () => {
    expect(exportObj({ positions: cube() }, 'P').file).toMatchObject({ name: 'P.obj', mime: 'model/obj' });
    expect(exportStep('ISO-10303-21;', 'P').file).toMatchObject({ name: 'P.step', mime: 'model/step' });
  });
});

describe('meshRequest', () => {
  it('normal with no chord is the mesh on screen; anything else asks the kernel', () => {
    expect(meshRequest('normal', '')).toEqual({ custom: false });
    expect(meshRequest('normal', '  ')).toEqual({ custom: false });
    expect(meshRequest('coarse', '')).toEqual({ custom: true, quality: 'coarse' });
    expect(meshRequest('fine', '')).toEqual({ custom: true, quality: 'fine' });
  });
  it('reads the chord in mm, a decimal comma included, and keeps the preset', () => {
    expect(meshRequest('normal', '0.05')).toEqual({ custom: true, quality: 'normal', chord_mm: 0.05 });
    expect(meshRequest('coarse', ' 0,2 ')).toEqual({ custom: true, quality: 'coarse', chord_mm: 0.2 });
  });
  it('refuses a chord that is not a number above zero', () => {
    for (const bad of ['0', '-1', 'abc', '1e999', '0.1 mm', 'NaN']) expect(meshRequest('normal', bad), bad).toEqual({ error: { level: 'error', key: 'io.badChord' } });
  });
});

describe('3MF and GLB export', () => {
  it('3MF: file name, mime, body count and a zip signature; no bodies is the no-solid error', async () => {
    const r = await exportThreeMf([{ name: 'A', positions: cube(), color: '#00ff00' }, { name: 'B', positions: cube(2) }], 'Two/Boxes');
    expect(r.file).toMatchObject({ name: 'Two_Boxes.3mf', mime: 'model/3mf' });
    expect(Array.from((r.file!.data as Uint8Array).subarray(0, 2))).toEqual([0x50, 0x4b]);
    expect(r.notices[0]).toMatchObject({ key: 'io.done3mf', params: { triangles: 24, bodies: 2 } });
    expect(await exportThreeMf(null, 'x')).toEqual({ notices: [{ level: 'error', key: 'io.noBody' }] });
    expect((await exportThreeMf([], 'x')).file).toBeUndefined();
  });
  it('3MF warns when the skin is open', async () => {
    const r = await exportThreeMf([{ name: 'A', positions: cube().subarray(9) }], 'Open');
    expect(r.notices[1]).toMatchObject({ level: 'warn', key: 'io.notWatertight' });
  });
  it('GLB: file name, mime, magic', () => {
    const r = exportGlb([{ name: 'A', positions: cube() }], 'Box');
    expect(r.file).toMatchObject({ name: 'Box.glb', mime: 'model/gltf-binary' });
    expect(new TextDecoder().decode((r.file!.data as Uint8Array).subarray(0, 4))).toBe('glTF');
    expect(r.notices[0]).toMatchObject({ key: 'io.doneGlb', params: { triangles: 12, bodies: 1 } });
    expect(exportGlb(null, 'x').file).toBeUndefined();
  });
});
