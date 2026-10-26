import { describe, expect, it } from 'vitest';
import { bytesText, fileText, gzipText, isGzip, wantsGzip } from './gzip';
import { saveDocumentWith, readHandleWith, type FsEnv } from './fsaccess';

const part = JSON.stringify({ format: 'ck-part', features: Array.from({ length: 400 }, (_, i) => ({ type: 'extrude', id: `F${i}`, depth: 10, sketch: `F${i - 1}` })) });

describe('gzip', () => {
  it('round trips text and is much smaller for repetitive JSON', async () => {
    const z = await gzipText(part);
    expect(isGzip(z)).toBe(true);
    expect(z.length).toBeLessThan(part.length / 5);
    expect(await bytesText(z)).toBe(part);
  });
  it('plain bytes are read as UTF-8, whatever the name; non-ASCII survives', async () => {
    expect(isGzip(new TextEncoder().encode(part))).toBe(false);
    expect(await bytesText(new TextEncoder().encode('{"name":"Bracket é 部品"}'))).toBe('{"name":"Bracket é 部品"}');
    expect(await bytesText(await gzipText('é 部品'))).toBe('é 部品');
    const z = await gzipText(part);
    expect(await fileText({ arrayBuffer: async () => z.slice().buffer as ArrayBuffer })).toBe(part);
    expect(await fileText({ text: async () => 'plain' })).toBe('plain');
  });
  it('a name ending in .gz asks for compression', () => {
    expect(wantsGzip('a.ckpart.gz')).toBe(true);
    expect(wantsGzip('a.ckpart')).toBe(false);
  });
});

describe('saving and reading a compressed part', () => {
  it('the name the file ends up with decides: a handle named .gz gets gzip bytes, a plain one text', async () => {
    const written: Array<string | Uint8Array> = [];
    const handle = (name: string) => ({ name, createWritable: async () => ({ write: async (d: string | Uint8Array) => void written.push(d), close: async () => {} }), getFile: async () => ({ arrayBuffer: async () => { const w = written[written.length - 1]; return (typeof w === 'string' ? new TextEncoder().encode(w) : w).slice().buffer as ArrayBuffer; } }) });
    const env = (h: ReturnType<typeof handle>): FsEnv => ({ showSaveFilePicker: async () => h, download: async () => {} });
    const gz = handle('p.ckpart.gz');
    await saveDocumentWith(env(gz), 'p.ckpart.gz', part, { pick: true });
    expect(written[0]).toBeInstanceOf(Uint8Array);
    expect(isGzip(written[0] as Uint8Array)).toBe(true);
    expect(await readHandleWith(gz)).toEqual({ name: 'p.ckpart.gz', text: part });
    const plain = handle('p.ckpart');
    await saveDocumentWith(env(plain), 'p.ckpart', part, { pick: true });
    expect(written[1]).toBe(part);
  });
  it('a download of a .gz name goes out compressed', async () => {
    let got: string | Uint8Array = '';
    await saveDocumentWith({ download: async (_n, d) => { got = d; } }, 'x.ckpart.gz', part);
    expect(typeof got !== 'string' && isGzip(got)).toBe(true);
    await saveDocumentWith({ download: async (_n, d) => { got = d; } }, 'x.ckpart', part);
    expect(got).toBe(part);
  });
});
