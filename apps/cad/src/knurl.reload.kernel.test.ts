// A knurl made in the app must still be there after Save and reopen: a cosmetic one (a record in the document's `cosmeticKnurls`) and a cut one (features).
// Written through the real FileManager, read back the way the app's open does (JSON, thumbnail and stored view taken out), loaded into a new Controller
// on a real kernel; checked in the tree rows, the parameters, after a rebuild, after the cylinder is resized, from a stored view, and in the autosave copy.
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { takeEmbedded } from '@kit/viewdata';
import { Controller, type KernelFactory } from './controller';
import { stripThumbnail } from './files/docThumb';
import { FileManager, type FilePlatform } from './files/fileManager';
import { DEFAULT_KNURL, knurlCosmetic, knurlOps, readCosmeticKnurls, type KnurlParams } from './knurl';
import { knurlOwner, paramsFromCosmetic } from './knurlEdit';
import { treeKnurlRows } from './treeModel';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function open(doc: PartDoc, cached?: Parameters<Controller['load']>[1]) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const c = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await c.load(doc, cached);
  return c;
}
const cylinderDoc = (r = 10, h = 24) => ({
  ...emptyPart('Knob'),
  features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'o', x: 0, y: 0, fixed: true }], entities: [{ type: 'circle', id: 'e1', c: 'o', r }], constraints: [] },
    { type: 'extrude', id: 'F2', name: 'Cylinder', op: 'add', sketch: 'F1', end: 'blind', depth: h },
  ],
}) as never as PartDoc;
const band = { axis: 'z' as const, center: [0, 0] as [number, number], radius: 10 };
const params = (o: Partial<KnurlParams> & { from?: number; to?: number }): KnurlParams => ({ ...DEFAULT_KNURL, cosmetic: false, count: 24, depth: 0.6, ...o, target: { ...band, from: o.from ?? 0, to: o.to ?? 24 } });
const fail = (r: unknown) => JSON.stringify((r as { errors?: unknown }).errors ?? r);
const cosmeticOf = (c: Controller) => readCosmeticKnurls((c.document() as unknown as Record<string, unknown>).cosmeticKnurls);
const vol = async (c: Controller) => ((await c.massProps()) as { volume: number }).volume;

/** Save through the FileManager (as Save does) and read the text back the way the app's open does. */
async function saveAndRead(c: Controller, o: { saveAs?: boolean; fileName?: string } = {}) {
  const writes: Array<{ name: string; data: string }> = [];
  const platform: FilePlatform = { canOverwrite: () => false, saveFile: async (name, data) => { writes.push({ name, data: String(data) }); } };
  const files = new FileManager(platform, null);
  const r = await files.save(c.document()!, o);
  expect(r.ok).toBe(true);
  expect(writes.length).toBe(1);
  const { doc: plain } = stripThumbnail(JSON.parse(writes[0].data) as PartDoc);
  return { doc: takeEmbedded(plain).doc, text: writes[0].data, file: writes[0].name };
}

describe('a knurl survives Save and reopen', { skip: !process.env.CK_WASM }, () => {
  it('cosmetic: the record is in the saved text, comes back with the same numbers, has its tree row and is editable', async () => {
    const c = await open(cylinderDoc());
    const rec = knurlCosmetic(params({ pattern: 'diamond', cosmetic: true, helixAngle: 30, count: 120, depth: 0.92 }));
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    const saved = await saveAndRead(c);
    expect(JSON.parse(saved.text).cosmeticKnurls).toEqual([rec]);
    const c2 = await open(saved.doc);
    expect(cosmeticOf(c2)).toEqual([rec]);
    expect(treeKnurlRows(c2.document() as never).map((r) => r.id)).toEqual(['knurl:0']);
    expect(treeKnurlRows(c2.document() as never)[0].label).toMatch(/display only/);
    expect(paramsFromCosmetic(cosmeticOf(c2)[0])).toMatchObject({ pattern: 'diamond', count: 120, depth: 0.92, helixAngle: 30, cosmetic: true });
  }, 300000);

  it('cosmetic: Save As (a chosen file name) writes it too, and a second Save after reopen keeps it', async () => {
    const c = await open(cylinderDoc());
    const rec = knurlCosmetic(params({ pattern: 'straight', cosmetic: true }));
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    const a = await saveAndRead(c, { saveAs: true, fileName: 'Other.ckpart' });
    expect(a.file).toBe('Other.ckpart');
    const c2 = await open(a.doc);
    const b = await saveAndRead(c2);
    expect(JSON.parse(b.text).cosmeticKnurls).toEqual([rec]);
  }, 300000);

  it('cosmetic: still there after a rebuild, after an edit of the cylinder, and after an undo and redo of that edit', async () => {
    const c = await open(cylinderDoc());
    const rec = knurlCosmetic(params({ pattern: 'pyramid', cosmetic: true, helixAngle: 30 }));
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    const c2 = await open((await saveAndRead(c)).doc);
    await c2.rebuild();
    expect(cosmeticOf(c2)).toEqual([rec]);
    const r = await c2.edit([{ op: 'set', id: 'F1', path: 'entities.0.r', value: 12 } as never]);
    expect(r.ok, fail(r)).toBe(true);
    expect(cosmeticOf(c2)).toEqual([rec]);
    await c2.undo();
    expect(cosmeticOf(c2)).toEqual([rec]);
    await c2.redo();
    expect(cosmeticOf(c2)).toEqual([rec]);
  }, 300000);

  it('cosmetic: opened from a stored view (the cached path) the record is there at once and after the real build', async () => {
    const c = await open(cylinderDoc());
    const rec = knurlCosmetic(params({ pattern: 'diamond', cosmetic: true }));
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    const data = c.viewData()!;
    const doc = (await saveAndRead(c)).doc;
    const c2 = await open(doc, { cached: data });
    expect(cosmeticOf(c2)).toEqual([rec]);
    await c2.settled();
    expect(cosmeticOf(c2)).toEqual([rec]);
    expect(c2.document()!.features.length).toBe(2);
  }, 300000);

  it('cosmetic: the autosave copy (the document as the app stores it) holds the record', async () => {
    const c = await open(cylinderDoc());
    const rec = knurlCosmetic(params({ pattern: 'diamond', cosmetic: true }));
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    const stored = JSON.parse(JSON.stringify({ name: 'Knob', doc: c.document() })) as { doc: PartDoc };
    expect(cosmeticOf(await open(stored.doc))).toEqual([rec]);
  }, 300000);

  it('cut: the knurl features, their folder and the volume come back, and the owner reads the same parameters', async () => {
    const c = await open(cylinderDoc());
    const r = await c.commit(knurlOps(c.document() as never, params({ pattern: 'straight', count: 24 })), 'knurl');
    expect(r.ok, fail(r)).toBe(true);
    const v = await vol(c);
    const c2 = await open((await saveAndRead(c)).doc);
    expect(await vol(c2)).toBeCloseTo(v, 6);
    const feats = c2.document()!.features as unknown as Array<Record<string, unknown>>;
    expect(feats.filter((f) => f.group === 'Knurl').length).toBeGreaterThan(0);
    const cut = feats.find((f) => f.group === 'Knurl' && f.type === 'extrude')!;
    expect(knurlOwner(feats, String(cut.id))?.params).toMatchObject({ pattern: 'straight', count: 24 });
  }, 300000);

  it('cut and cosmetic together: both come back', async () => {
    const c = await open(cylinderDoc());
    const r = await c.commit(knurlOps(c.document() as never, params({ pattern: 'straight', from: 0, to: 10 })), 'knurl');
    expect(r.ok, fail(r)).toBe(true);
    const rec = knurlCosmetic(params({ pattern: 'diamond', cosmetic: true, from: 14, to: 24 }));
    c.setUndoableExtra('cosmeticKnurls', [rec]);
    const v = await vol(c);
    const c2 = await open((await saveAndRead(c)).doc);
    expect(cosmeticOf(c2)).toEqual([rec]);
    expect(await vol(c2)).toBeCloseTo(v, 6);
  }, 300000);
});
