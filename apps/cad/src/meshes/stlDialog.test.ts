// @vitest-environment jsdom
// The Import / Open dialog path for STL: platform.openFile hands over bytes, which go straight to probeStl (as main.tsx does).
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createWebPlatform } from '@kit/platform';
import { meshToStl } from '@kit/io';
import { cube } from '../../../../packages/io/src/testmesh';
import { probeStl } from './meshImport';
import { dropKind, IMPORT_ACCEPT, OPEN_ACCEPT } from '../files/names';

afterEach(() => vi.restoreAllMocks());

function pick(name: string, data: Uint8Array) {
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = real(tag);
    if (tag === 'input') {
      const f = { name, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) } as unknown as File;
      Object.defineProperty(el, 'files', { value: [f] });
      (el as HTMLInputElement).click = () => { void (el as HTMLInputElement).onchange?.(new Event('change')); };
    }
    return el;
  });
  return createWebPlatform().openFile({ accept: IMPORT_ACCEPT });
}

const binary = meshToStl({ positions: cube(10) }).data as Uint8Array;
const ascii = (() => {
  const p = cube(10); let s = 'solid cube\n';
  for (let i = 0; i < p.length; i += 9) s += `facet normal 0 0 0\nouter loop\n${[0, 3, 6].map((o) => `vertex ${p[i + o]} ${p[i + o + 1]} ${p[i + o + 2]}`).join('\n')}\nendloop\nendfacet\n`;
  return new TextEncoder().encode(s + 'endsolid cube\n');
})();

describe('STL through the file dialog', () => {
  for (const [label, data] of [['binary', binary], ['ASCII', ascii]] as const) {
    it(`${label} STL imports with 12 triangles`, async () => {
      const f = await pick('cube.stl', data);
      expect(f).not.toBeNull();
      expect(dropKind(f!.name)).toBe('stl');
      const r = probeStl(f!.bytes ?? new TextEncoder().encode(f!.text));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.probe.triangles).toBe(12);
    });
  }
  it('the Open and Import lists both offer .stl', () => {
    expect(OPEN_ACCEPT).toContain('.stl');
    expect(IMPORT_ACCEPT).toContain('.stl');
  });
});
