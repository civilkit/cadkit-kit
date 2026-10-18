import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { snapshotOf } from '@kit/snapshot';
import { docHash, makeDocThumbnail, readThumbnail, stripThumbnail, THUMB_MAX_BYTES } from './docThumb';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const open = async (doc: unknown) => { const s = await Session.open(doc as PartDoc); sessions.push(s); return s; };
const sample = (name: string): PartDoc => JSON.parse(readFileSync(join(__dirname, '../../public/samples', name), 'utf8')) as PartDoc;

// The thumbnail field is taken off before a file reaches the session (main.tsx load), but a file written by this app is also
// opened by other tools: the kernel and the part model must accept it, or at least ignore it.
describe('thumbnail field in a document', { skip: !process.env.CK_WASM }, () => {
  it('renders a small PNG that fits the limit, and a document carrying it regenerates, validates and measures the same', async () => {
    const doc = sample('mounting-plate.ckpart');
    const s0 = await open(doc);
    const render = async (_d: PartDoc, size: { width: number; height: number }) => (await snapshotOf(s0, { view: 'iso', size })).png;
    const t = await makeDocThumbnail(doc, render);
    expect(t).not.toBeNull();
    expect(t!.data.length * 0.75).toBeLessThanOrEqual(THUMB_MAX_BYTES);
    expect(t!.width).toBe(256);

    const withT = JSON.parse(JSON.stringify({ ...doc, thumbnail: t }));   // as read from a file
    expect(readThumbnail(withT)).toEqual(t);
    expect(docHash(withT)).toBe(docHash(doc));
    const s1 = await open(withT);
    expect((await s1.regenReport()).errors).toEqual([]);
    expect((await s1.validate()).ok).toBe(true);
    expect(((await s1.massProps()) as { volume: number }).volume).toBeCloseTo(((await s0.massProps()) as { volume: number }).volume, 6);
    expect(s1.history().length).toBe(s0.history().length);   // opening it is not a history step

    // the app strips it before the session sees it: the document the session keeps has no such field
    const s2 = await open(stripThumbnail(withT).doc);
    expect('thumbnail' in (s2 as unknown as { doc: object }).doc).toBe(false);
  });
  it('a session handed the field does not keep it in its document (the hash of the geometry is unchanged)', async () => {
    const doc = sample('mounting-plate.ckpart');
    const s = await open({ ...doc, thumbnail: { format: 'png', width: 1, height: 1, hash: 'x', data: 'iVBORw0KGgo=' } });
    const before = docHash(doc);
    expect(docHash((s as unknown as { doc: object }).doc)).toBe(before);
  });
});
