import { describe, expect, it, vi } from 'vitest';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { base64ToBytes, bytesToBase64, docHash, isFresh, makeDocThumbnail, readThumbnail, stripThumbnail, thumbnailUrl, THUMB_MAX_BYTES } from './docThumb';
import { createSaveThumbs } from './saveThumb';
import { FileManager, type FilePlatform } from './fileManager';
import { readRecentThumbs } from './recent';
import type { KV } from './storage';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const doc = (name = 'P'): PartDoc => ({ ...emptyPart(name), features: [{ id: 'F1', type: 'box' } as never], seq: 2 });
const kv = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };

describe('docHash', () => {
  it('ignores the name, the thumbnail and key order; changes with the geometry', () => {
    const a = doc('One');
    expect(docHash(a)).toBe(docHash({ ...doc('Two'), thumbnail: { format: 'png', hash: 'x', data: 'AAAA' } } as never));
    expect(docHash(a)).toBe(docHash(Object.fromEntries(Object.entries(a).reverse())));
    expect(docHash(a)).not.toBe(docHash({ ...a, seq: 3 }));
    expect(docHash(a)).not.toBe(docHash({ ...a, features: [{ id: 'F1', type: 'box', x: 1 }] as never }));
    expect(docHash(a)).toMatch(/^[0-9a-f]{28}$/);
  });
});

describe('thumbnail field', () => {
  it('base64 round-trips and a usable field is read; a damaged one is ignored', async () => {
    expect(Array.from(base64ToBytes(bytesToBase64(PNG)))).toEqual(Array.from(PNG));
    const t = (await makeDocThumbnail(doc(), async () => PNG))!;
    expect(t).toMatchObject({ format: 'png', width: 256, height: 192, hash: docHash(doc()) });
    expect(readThumbnail({ thumbnail: t })).toEqual(t);
    expect(thumbnailUrl(t)).toBe('data:image/png;base64,' + t.data);
    expect(readThumbnail({ thumbnail: { ...t, data: 'not base64!' } })).toBeNull();
    expect(readThumbnail({ thumbnail: { ...t, data: bytesToBase64(new Uint8Array(12)) } })).toBeNull();   // not a PNG
    expect(readThumbnail({ thumbnail: { ...t, data: 'A'.repeat(THUMB_MAX_BYTES * 2) } })).toBeNull();
    expect(readThumbnail({})).toBeNull();
  });
  it('stripThumbnail takes it off without touching the input; a document without one is returned as is', () => {
    const d = doc();
    expect(stripThumbnail(d)).toEqual({ doc: d, thumbnail: null });
    const withT = { ...d, thumbnail: { format: 'png', width: 1, height: 1, hash: 'h', data: bytesToBase64(PNG) } };
    const r = stripThumbnail(withT);
    expect('thumbnail' in r.doc).toBe(false);
    expect(r.thumbnail?.hash).toBe('h');
    expect('thumbnail' in withT).toBe(true);
    expect(isFresh(r.thumbnail, d)).toBe(false);   // hash 'h' is not the document's
  });
  it('tries smaller sizes until the PNG fits, and gives up (null) when none does or there is no solid', async () => {
    const sizes: number[] = [];
    const t = await makeDocThumbnail(doc(), async (_d, s) => { sizes.push(s.width); return new Uint8Array(s.width > 200 ? THUMB_MAX_BYTES + 1 : 100).fill(1); });
    expect(sizes).toEqual([256, 192]);
    expect(t?.width).toBe(192);
    expect(await makeDocThumbnail(doc(), async () => new Uint8Array(THUMB_MAX_BYTES + 1))).toBeNull();
    expect(await makeDocThumbnail(doc(), async () => null)).toBeNull();
  });
});

describe('save thumbnails', () => {
  it('draws once per document state, reuses it while the hash matches, draws again when the geometry changed', async () => {
    const render = vi.fn(async () => PNG);
    const s = createSaveThumbs({ render, hasSolid: () => true });
    const t1 = await s.forSave(doc());
    await s.forSave(doc('Renamed'));
    expect(render).toHaveBeenCalledTimes(1);
    const t2 = await s.forSave({ ...doc(), seq: 9 });
    expect(render).toHaveBeenCalledTimes(2);
    expect(t2?.hash).not.toBe(t1?.hash);
  });
  it('an opened file\'s thumbnail is reused while it is fresh, and replaced when stale', async () => {
    const render = vi.fn(async () => PNG);
    const s = createSaveThumbs({ render, hasSolid: () => true });
    s.remember(await makeDocThumbnail(doc(), async () => PNG));
    await s.forSave(doc());
    expect(render).not.toHaveBeenCalled();
    await s.forSave({ ...doc(), seq: 5 });
    expect(render).toHaveBeenCalledTimes(1);
  });
  it('no solid, a failing renderer, or a render past the time limit: no thumbnail, and the save is not held back', async () => {
    expect(await createSaveThumbs({ render: async () => PNG, hasSolid: () => false }).forSave(doc())).toBeNull();
    expect(await createSaveThumbs({ render: async () => { throw new Error('boom'); }, hasSolid: () => true }).forSave(doc())).toBeNull();
    const slow = createSaveThumbs({ render: () => new Promise(() => {}), hasSolid: () => true, timeoutMs: 20 });
    expect(await slow.forSave(doc())).toBeNull();
  });
  it('waits for the idle gate before drawing', async () => {
    const order: string[] = [];
    const s = createSaveThumbs({ render: async () => { order.push('render'); return PNG; }, hasSolid: () => true, idle: async () => { order.push('idle'); } });
    await s.forSave(doc());
    expect(order).toEqual(['idle', 'render']);
  });
});

describe('FileManager writes the thumbnail', () => {
  const plat = () => { const writes: string[] = []; const p: FilePlatform = { saveFile: async (_n, d) => { writes.push(String(d)); } }; return { p, writes }; };
  it('adds it to the file text as the last field, replaces an old one, and never touches the document object', async () => {
    const { p, writes } = plat();
    const m = new FileManager(p, kv(), () => 1);
    const t = (await makeDocThumbnail(doc(), async () => PNG))!;
    const d = { ...doc('A'), thumbnail: { format: 'png', hash: 'old', data: 'AAAA' } } as PartDoc;
    await m.save(d, { thumbnail: t });
    const out = JSON.parse(writes[0]);
    expect(out.thumbnail.hash).toBe(t.hash);
    expect(Object.keys(out).at(-1)).toBe('thumbnail');
    expect((d as unknown as { thumbnail: { hash: string } }).thumbnail.hash).toBe('old');
    await m.save(doc('A'));
    expect('thumbnail' in JSON.parse(writes[1])).toBe(false);
  });
  it('keeps the picture of a saved file for the recent list, and drops it when the file leaves the list', async () => {
    const { p } = plat();
    const store = kv();
    const m = new FileManager(p, store, () => 1);
    const t = (await makeDocThumbnail(doc(), async () => PNG))!;
    await m.save(doc('A'), { thumbnail: t });
    expect(Object.keys(m.recentThumbs())).toEqual(['A.ckpart']);
    expect(m.recentThumbs()['A.ckpart']).toBe(thumbnailUrl(t));
    for (let i = 0; i < 9; i++) m.noteFile(`f${i}.ckpart`);
    expect(readRecentThumbs(store)).toEqual({});
    m.noteFile('open.ckpart'); m.noteThumb('open.ckpart', t);
    expect(Object.keys(m.recentThumbs())).toEqual(['open.ckpart']);
    m.noteThumb('unknown.ckpart', t);
    expect(Object.keys(m.recentThumbs())).toEqual(['open.ckpart']);
  });
});
