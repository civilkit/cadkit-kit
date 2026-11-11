// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWebPlatform } from './web';
import { FILE_KINDS, acceptFor, fileKindOf, isBinaryName } from './kinds';

afterEach(() => vi.restoreAllMocks());

/** Run openFile with a fake picker that "selects" the given file. */
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
  return createWebPlatform().openFile();
}

// every byte value, including 0x00, 0xFF, a lone 0x80 and a gzip-looking start, none of which survive a UTF-8 text round trip
const nasty = new Uint8Array(512).map((_, i) => (i * 37 + 11) & 0xff);
nasty[0] = 0x00; nasty[1] = 0xff; nasty[2] = 0x80;

describe('openFile reads every kind intact', () => {
  const exts = Object.values(FILE_KINDS).flatMap((k) => k.exts.filter((e) => e !== 'gz' && e !== 'json' && e !== 'ckpart' && e !== 'ckpart' && e !== 'step' && e !== 'stp' && e !== 'dxf' && e !== 'svg'));
  for (const ext of exts) {
    it(`.${ext}: binary bytes arrive unchanged, no text`, async () => {
      const r = await pick(`thing.${ext}`, nasty);
      expect(r).not.toBeNull();
      expect(Array.from(r!.bytes!)).toEqual(Array.from(nasty));
      expect(r!.text).toBe('');
    });
    it(`.${ext.toUpperCase()}: upper case names too`, async () => {
      const r = await pick(`THING.${ext.toUpperCase()}`, nasty);
      expect(Array.from(r!.bytes!)).toEqual(Array.from(nasty));
    });
  }
  for (const ext of ['ckpart', 'ckpart', 'json', 'step', 'stp', 'dxf', 'svg']) {
    it(`.${ext}: text arrives as text (and the bytes too)`, async () => {
      const src = new TextEncoder().encode('héllo {"a":1}');
      const r = await pick(`thing.${ext}`, src);
      expect(r!.text).toBe('héllo {"a":1}');
      expect(Array.from(r!.bytes!)).toEqual(Array.from(src));
    });
  }
  it('a binary STL whose 80-byte header and counts are not text is not empty', async () => {
    const b = new Uint8Array(84 + 50); b[80] = 1;   // one triangle
    const r = await pick('scan.stl', b);
    expect(r!.bytes!.length).toBe(134);
  });
  it('unknown extensions still get their bytes', async () => {
    const r = await pick('x.bin', nasty);
    expect(Array.from(r!.bytes!)).toEqual(Array.from(nasty));
  });
});

describe('the kinds table', () => {
  it('classifies', () => {
    expect(fileKindOf('A.STL')).toBe('stl');
    expect(isBinaryName('a.stl')).toBe(true);
    expect(isBinaryName('a.step')).toBe(false);
    expect(isBinaryName('a.zzz')).toBe(false);
    expect(acceptFor('step', 'stl')).toEqual(['.step', '.stp', '.stl']);
  });
});
