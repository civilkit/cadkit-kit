// Fonts in the document, against the real kernel: a curated font and a user font survive save -> reload in a fresh kernel,
// a kernel restart (cancel) puts the fonts back, a font that cannot be loaded leaves the document openable.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { fontSlug, parseManifest, type FontSource } from './fonts';
import { runScript, type ScriptHost } from '@kit/script';

const DIR = process.cwd() + '/apps/cad/public/fonts/';
const manifest = parseManifest(JSON.parse(readFileSync(DIR + 'fonts.json', 'utf8')));
const files: FontSource = { async manifest() { return manifest; }, async fetch(c) { return new Uint8Array(readFileSync(DIR + c.file)); } };

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

function world(opts: { fonts?: FontSource; fontEmbedMax?: number } = { fonts: files }) {
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSketchEdit() {} };
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; }, cancel() {} };
  const store = createStore();
  return { controller: new Controller({ store, view, kernel, ...opts }), store };
}
/** a sketch with one text entity and the extrude that embosses it */
const lettering = (font: string, fontHash?: string, string = 'RPM 150', n = 1) => [
  { op: 'add' as const, feature: { type: 'sketch', id: `F${n}`, plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 0, y: 0 }],
    entities: [{ id: 't1', type: 'text', string, font, ...(fontHash ? { fontHash } : {}), height: 6, p: 'a' }], constraints: [] } },
  { op: 'add' as const, feature: { type: 'extrude', id: `F${n + 1}`, op: 'add', sketch: `F${n}`, end: 'blind', depth: 2 } },
] as never;
const volume = async (c: Controller) => (await c.partMass(c.document())).volume;
const saved = (c: Controller) => JSON.parse(JSON.stringify(c.document())) as PartDoc & { fonts?: Array<Record<string, unknown>> };
const errors = (c: Controller, store: ReturnType<typeof createStore>) => store.featureStatus.value.filter((f) => !f.ok).map((f) => f.code);
const kernelFonts = async (s: Session) => (await s.listFonts()).fonts.map((f) => f.name);

describe('fonts in the document', { skip: !process.env.CK_WASM, timeout: 60000 }, () => {
  it('a curated font: letters build, the file keeps only id + checksum, a fresh kernel rebuilds the same volume', async () => {
    const { controller: c, store } = world();
    await c.load(emptyPart('Lettering'));
    const r = await c.addFont({ curated: 'barlow' });
    expect(r.ok).toBe(true);
    const pin = r.ok ? r.pin : undefined;
    expect(pin).toHaveLength(16);
    expect((await c.edit(lettering('barlow', pin))).ok).toBe(true);
    const v = await volume(c);
    expect(v).toBeGreaterThan(50);
    const doc = saved(c);
    const sha = manifest.find((m) => m.id === 'barlow')!.sha256;
    expect(doc.fonts).toEqual([{ name: 'barlow', hash: sha, source: 'curated', id: 'barlow' }]);
    expect(JSON.stringify(doc.fonts)).not.toContain('data');

    const second = world();   // a new kernel instance: no fonts
    await second.controller.load(doc);
    expect(second.controller.fontProblems).toEqual([]);
    expect(errors(second.controller, second.store)).toEqual([]);
    expect(await volume(second.controller)).toBe(v);
    expect(await kernelFonts(sessions[sessions.length - 1])).toContain('barlow');
    expect(errors(c, store)).toEqual([]);
  });

  it('a user font is embedded whole and loads in a kernel that has never seen it', async () => {
    const { controller: c } = world({});   // no curated source needed
    await c.load(emptyPart('Lettering'));
    const bytes = new Uint8Array(readFileSync(DIR + 'ibm-plex-mono/IBMPlexMono-Regular.ttf'));
    const r = await c.addFont({ bytes, family: 'IBM Plex Mono', name: (h) => fontSlug('IBM Plex Mono', h) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toMatch(/^ibm-plex-mono-[0-9a-f]{8}$/);
    await c.edit(lettering(r.name, r.pin));
    const v = await volume(c);
    const doc = saved(c);
    expect(doc.fonts).toHaveLength(1);
    expect(doc.fonts![0]).toMatchObject({ name: r.name, source: 'embedded', hash: r.hash, family: 'IBM Plex Mono' });
    expect(doc.fonts![0].subset).toBeUndefined();
    const second = world({});
    await second.controller.load(doc);
    expect(second.controller.fontProblems).toEqual([]);
    expect(await volume(second.controller)).toBe(v);
  });

  it('a font over the embed limit is saved as the subset of the document text, and says so', async () => {
    const { controller: c } = world({ fonts: files, fontEmbedMax: 100_000 });
    await c.load(emptyPart('Lettering'));
    const bytes = new Uint8Array(readFileSync(DIR + 'great-vibes/GreatVibes-Regular.ttf'));
    const r = await c.addFont({ bytes, family: 'Great Vibes', name: (h) => fontSlug('Great Vibes', h) });
    if (!r.ok) throw new Error(r.problem.message);
    expect(r.pin).toBeUndefined();   // the subset has another hash: the name carries the original's
    await c.edit(lettering(r.name, undefined, 'Nina'));
    const doc = saved(c);
    const f = doc.fonts![0] as { data: string; subset?: boolean };
    expect(f.subset).toBe(true);
    expect(f.data.length).toBeLessThan(bytes.length * 0.5);
    const v = await volume(c);
    const second = world({ fontEmbedMax: 100_000 });
    await second.controller.load(doc);
    expect(second.controller.fontProblems).toEqual([]);
    expect(second.controller.fontInfo(r.name).subset).toBe(true);
    expect(await volume(second.controller)).toBe(v);
    // saved again from the subset: still the subset
    expect(saved(second.controller).fonts![0]).toMatchObject({ subset: true });
  });

  it('a kernel restart (cancel) loads the document fonts into the new kernel before it rebuilds', async () => {
    const { controller: c, store } = world();
    await c.load(emptyPart('Lettering'));
    const bytes = new Uint8Array(readFileSync(DIR + 'ibm-plex-mono/IBMPlexMono-Regular.ttf'));
    const u = await c.addFont({ bytes, family: 'Plex', name: (h) => fontSlug('Plex', h) });
    const k = await c.addFont({ curated: 'anton' });
    if (!u.ok || !k.ok) throw new Error('load');
    await c.edit(lettering(u.name, u.pin, 'AB', 1));
    await c.edit(lettering('anton', k.pin, 'CD', 3));
    const v = await volume(c);
    const before = sessions[sessions.length - 1];
    expect(await kernelFonts(before)).toEqual(expect.arrayContaining(['anton', u.name]));
    await c.cancel();
    const after = sessions[sessions.length - 1];
    expect(after).not.toBe(before);
    expect(await kernelFonts(after)).toEqual(expect.arrayContaining(['anton', u.name]));
    expect(errors(c, store)).toEqual([]);
    expect(await volume(c)).toBe(v);
    // and the text still rebuilds with the restarted kernel
    expect((await c.edit(lettering('anton', k.pin, 'EF', 5))).ok).toBe(true);
    expect(errors(c, store)).toEqual([]);
  });

  it('undo and redo keep the fonts', async () => {
    const { controller: c } = world();
    await c.load(emptyPart('Lettering'));
    const r = await c.addFont({ curated: 'satisfy' });
    if (!r.ok) throw new Error('load');
    await c.edit(lettering('satisfy', r.pin));
    expect(saved(c).fonts).toHaveLength(1);
    await c.undo();
    expect(saved(c).fonts).toBeUndefined();   // nothing uses it now
    await c.redo();
    expect(saved(c).fonts?.[0]).toMatchObject({ name: 'satisfy', source: 'curated' });
  });

  it('a curated font that cannot be fetched is reported by name; the document opens and its text says the font is not loaded', async () => {
    const { controller: a } = world();
    await a.load(emptyPart('Lettering'));
    const r = await a.addFont({ curated: 'barlow' });
    if (!r.ok) throw new Error('load');
    await a.edit(lettering('barlow', r.pin));
    const doc = saved(a);
    const offline: FontSource = { async manifest() { return manifest; }, async fetch() { throw new Error('offline'); } };
    const b = world({ fonts: offline });
    await b.controller.load(doc);
    expect(b.controller.fontProblems.map((p) => [p.name, p.code])).toEqual([['barlow', 'fontFetch']]);
    expect(b.store.notices.value.some((n) => /barlow/.test(n.text))).toBe(true);
    expect(errors(b.controller, b.store)).toContain('textFontNotLoaded');
    expect(b.controller.document()!.features).toHaveLength(2);
  });

  it('an embedded font with damaged data is refused with the font named; a WOFF is refused as fontBadData', async () => {
    const { controller: a } = world({});
    await a.load(emptyPart('Lettering'));
    const bytes = new Uint8Array(readFileSync(DIR + 'ibm-plex-mono/IBMPlexMono-Regular.ttf'));
    const r = await a.addFont({ bytes, family: 'Plex', name: (h) => fontSlug('Plex', h) });
    if (!r.ok) throw new Error('load');
    await a.edit(lettering(r.name, r.pin));
    const doc = saved(a);
    doc.fonts![0].data = (doc.fonts![0].data as string).slice(0, 5000);   // truncated
    const b = world({});
    await b.controller.load(doc);
    expect(b.controller.fontProblems).toHaveLength(1);
    expect(b.controller.fontProblems[0].name).toBe(r.name);
    expect(errors(b.controller, b.store)).toContain('textFontNotLoaded');
    const woff = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 1, 0, 0, 0, 0]);
    const w = await b.controller.addFont({ bytes: woff, family: 'X', name: (h) => fontSlug('X', h) });
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.problem.code).toBe('fontBadData');
  });

  it('a script that names a curated font by id gets it loaded before the features build', async () => {
    const { controller: c, store } = world();
    await c.load(emptyPart('Lettering'));
    expect((await c.edit(lettering('bebas-neue'))).ok).toBe(true);
    expect(errors(c, store)).toEqual([]);
    expect(saved(c).fonts?.[0]).toMatchObject({ name: 'bebas-neue', source: 'curated', id: 'bebas-neue' });
  });

  it('a script with font: "barlow" runs, the document carries the library font, and an unknown id is a clear script error', async () => {
    const { controller: c, store } = world();
    await c.load(emptyPart('open'));
    const h: ScriptHost = {
      load: (d) => c.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
      edit: (ops, why) => c.edit(ops, why) as never,
      geometry: () => ({ mesh: c.bodyFaces(), edges: c.bodyEdges(), box: c.bodyBox() }),
      facts: (need) => c.scratchFacts(need),
      build: (d, view) => c.scratchBuild(d as never, view) as never,
    } as ScriptHost;
    const src = `part('Plate').sketch('front', (s) => s.rect(60, 20)).extrude(4).sketch(at('front', 4), (s) => s.text('SEA', [0, 0], { font: 'barlow', height: 5, anchor: ['center', 'middle'] })).cut(0.3);`;
    const r = await runScript(src, h);
    expect(r.errors).toEqual([]);
    expect(errors(c, store)).toEqual([]);
    expect(saved(c).fonts).toEqual([{ name: 'barlow', hash: manifest.find((m) => m.id === 'barlow')!.sha256, source: 'curated', id: 'barlow' }]);
    const bad = await runScript(`part('P').sketch('front', (s) => s.text('A', [0, 0], { font: 'comic' }));`, h);
    expect(bad.errors[0]?.message).toMatch(/unknown font 'comic'.*gauge.*engrave.*barlow.*anton/);
  });
});
