import { describe, expect, it } from 'vitest';
import { exportObj, exportStep, exportStl, fileStem } from './exportFiles';
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
