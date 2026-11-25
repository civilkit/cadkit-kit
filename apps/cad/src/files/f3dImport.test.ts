import { describe, expect, it } from 'vitest';
import { importF3dView } from './stepImport';
import { dropKind, OPEN_ACCEPT } from './names';

const body = { faces: [{ id: 'f1', pts: [] }], edges: [], box: { min: [0, 0, 0], max: [1, 1, 1] } };
const fake = (rep: unknown) => ({ importF3d: async () => rep }) as never;

describe('Fusion 360 import', () => {
  it('.f3d and .f3z are opened as Fusion 360 files and offered by the picker', () => {
    expect(dropKind('a.f3d')).toBe('f3d');
    expect(dropKind('A.F3Z')).toBe('f3d');
    expect(OPEN_ACCEPT).toEqual(expect.arrayContaining(['.f3d', '.f3z']));
  });
  it('carries what the file brought in: solids, surface bodies, refused bodies and the kernel report', async () => {
    const r = await importF3dView(fake({ errors: [], body, surfaces: [], import: { bodies: 3, solids: 2, surfaces: 1, refused: 0, report: ['Read 3 bodies.', 'A body has a helix edge.'], parts: [] } }), new Uint8Array([1, 2, 3]), 'p');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.f3d).toEqual({ bodies: 3, solids: 2, surfaces: 1, refused: 0, report: ['Read 3 bodies.', 'A body has a helix edge.'] });
  });
  it('a file the kernel cannot read gives its code and message', async () => {
    const r = await importF3dView(fake({ errors: [['import', { code: 'f3d.container', params: { message: 'not a zip' } }]] }), new Uint8Array([0]), 'p');
    expect(r).toEqual({ ok: false, code: 'f3d.container', message: 'f3d.container: not a zip' });
  });
});
