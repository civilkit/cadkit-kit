import { describe, expect, it, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evaluate, CURATED_FONT_IDS } from '@kit/script';
import { patchText, textFields, textNotes, addText, type SketchDraft } from '@kit/sketch';
import {
  filterFaces, fontKind, fontSlug, fromBase64, parseManifest, pinOf, readDocFonts, sha256Hex, sortFaces, textFontsUsed, toBase64, webFontSource, errorCodeOf,
} from './fonts';
import { DocFontPool } from './docFonts';
import { readAutosave, writeAutosave } from './files/autosave';
import { createSnapshots, memoryBackend } from './files/snapshots';

const DIR = process.cwd() + '/apps/cad/public/fonts/';
const manifest = parseManifest(JSON.parse(readFileSync(DIR + 'fonts.json', 'utf8')));

describe('the curated font list', () => {
  it('has the ten fonts, and every file is there with its licence and the recorded checksum', () => {
    expect(manifest).toHaveLength(10);
    for (const c of manifest) {
      const bytes = readFileSync(DIR + c.file);
      expect(createHash('sha256').update(bytes).digest('hex'), c.id).toBe(c.sha256);
      expect(bytes.length, c.id).toBe(c.bytes);
      expect(existsSync(DIR + c.licenceFile!), c.id).toBe(true);
      expect(['OFL-1.1', 'Apache-2.0']).toContain(c.licence);
      expect(fontKind(new Uint8Array(bytes.subarray(0, 4))), c.id).toMatch(/ttf|otf/);
    }
  });
  it('the script package knows exactly these ids', () => {
    expect([...CURATED_FONT_IDS].sort()).toEqual(manifest.map((m) => m.id).sort());
  });
  it('every file is named in THIRD_PARTY.md with its checksum', () => {
    const tp = readFileSync(process.cwd() + '/THIRD_PARTY.md', 'utf8');
    for (const c of manifest) expect(tp, c.id).toContain(c.sha256);
  });
});

describe('names and hashes', () => {
  it('a slug is the family and eight hash digits, stable for a file and distinct for another', async () => {
    const h = await sha256Hex(new TextEncoder().encode('abc'));
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(fontSlug('Gill Sans MT Condensed', h)).toBe('gill-sans-mt-condensed-ba7816bf');
    expect(fontSlug('Ärger Ünder', h)).toBe('arger-under-ba7816bf');
    expect(fontSlug('!!!', h)).toBe('font-ba7816bf');
    expect(fontSlug('x'.repeat(100), h).length).toBeLessThanOrEqual(49);
    expect(pinOf(h)).toBe('ba7816bf8f01cfea');
  });
  it('base64 round-trips big arrays', () => {
    const b = new Uint8Array(100_000).map((_, i) => (i * 7) & 255);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });
  it('recognises TTF / OTF / TTC and refuses WOFF', () => {
    const k = (s: string) => fontKind(new Uint8Array([...s].map((c) => c.charCodeAt(0))));
    expect(k('OTTO')).toBe('otf'); expect(k('ttcf')).toBe('ttc'); expect(k('wOFF')).toBe('woff'); expect(k('wOF2')).toBe('woff2');
    expect(fontKind(new Uint8Array([0, 1, 0, 0]))).toBe('ttf'); expect(k('<htm')).toBe('unknown'); expect(fontKind(new Uint8Array(2))).toBe('unknown');
  });
  it('reads the kernel error code from a string or an object', () => {
    expect(errorCodeOf({ code: 'fontBadData', message: 'x' })).toBe('fontBadData');
    expect(errorCodeOf('fontTooLarge: 30 MB')).toBe('fontTooLarge');
    expect(errorCodeOf('boom')).toBe('');
  });
});

const sketchWith = (...texts: Array<Record<string, unknown>>) => ({ type: 'sketch', id: 'F1', entities: texts.map((t, i) => ({ id: 't' + i, type: 'text', ...t })) });
describe('which fonts a document uses', () => {
  it('collects the characters per non-built-in font', () => {
    const doc = { features: [sketchWith({ font: 'barlow', string: 'AB' }, { font: 'barlow', string: 'BC' }, { font: 'gauge', string: 'Z' }, { string: 'Q' }, { font: 'my-font-1234abcd', string: 'x' }), { type: 'extrude' }] };
    expect([...textFontsUsed(doc)]).toEqual([['barlow', 'ABC'], ['my-font-1234abcd', 'x']]);
    expect(textFontsUsed(null).size).toBe(0);
  });
  it('reads the fonts field leniently: a malformed entry is dropped, never an error', () => {
    expect(readDocFonts(undefined)).toEqual([]);
    expect(readDocFonts('x')).toEqual([]);
    const f = readDocFonts([{ name: 'a', source: 'curated', id: 'barlow', hash: 'h' }, { name: 'a', source: 'curated', id: 'again' }, { name: 'b', source: 'embedded' }, { source: 'curated', id: 'x' }, { name: 'c', source: 'future', data: 'x' }, { name: 'd', source: 'embedded', data: 'AAAA', subset: true, extra: 1 }, null]);
    expect(f).toEqual([{ name: 'a', hash: 'h', source: 'curated', id: 'barlow' }, { name: 'd', hash: '', source: 'embedded', data: 'AAAA', subset: true }]);
  });
});

describe('system font list', () => {
  const faces = [{ family: 'Zed', fullName: 'Zed Bold' }, { family: 'Arial', fullName: 'Arial Narrow' }, { family: 'Arial', fullName: 'Arial' }];
  it('sorts by family then name and filters on either', () => {
    expect(sortFaces(faces).map((f) => f.fullName)).toEqual(['Arial', 'Arial Narrow', 'Zed Bold']);
    expect(filterFaces(faces, 'narrow')).toHaveLength(1);
    expect(filterFaces(faces, ' ARIAL ')).toHaveLength(2);
    expect(filterFaces(faces, '')).toHaveLength(3);
  });
});

describe('web font source', () => {
  it('fetches the manifest once and the files from /fonts', async () => {
    const calls: string[] = [];
    const fake = (async (u: string) => { calls.push(u); return u.endsWith('fonts.json') ? { ok: true, json: async () => ({ fonts: manifest }) } : { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; }) as unknown as typeof fetch;
    const src = webFontSource('/app', fake);
    expect((await src.manifest()).length).toBe(10);
    await src.manifest();
    expect(await src.fetch(manifest[0])).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toEqual(['/app/fonts/fonts.json', '/app/fonts/' + manifest[0].file]);
  });
  it('a failed manifest fetch is not cached', async () => {
    let n = 0;
    const fake = (async () => (++n === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ fonts: manifest }) })) as unknown as typeof fetch;
    const src = webFontSource('/', fake);
    await expect(src.manifest()).rejects.toThrow(/503/);
    expect((await src.manifest()).length).toBe(10);
  });
});

describe('text entity font fields', () => {
  const draft = (): { d: SketchDraft; id: string } => {
    const r = addText({ id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }], entities: [], constraints: [] } as never, { x: 1, y: 2 });
    return { d: r.draft, id: r.id };
  };
  it('a font and its pin are set together; picking a built-in clears the pin', () => {
    const { d, id } = draft();
    const a = patchText(d, id, { font: 'barlow', fontHash: 'abcd' });
    expect(textFields(a, id)).toMatchObject({ font: 'barlow', fontHash: 'abcd' });
    const b = patchText(a, id, { font: 'engrave' });
    expect(textFields(b, id)!.font).toBe('engrave');
    expect(textFields(b, id)!.fontHash).toBeUndefined();
    const c = patchText(a, id, { height: 9 });
    expect(textFields(c, id)).toMatchObject({ font: 'barlow', fontHash: 'abcd', height: 9 });
  });
  it('the kernel notes for a missing font and overlapping strokes have messages', () => {
    expect(textNotes({ error: 'textFontNotLoaded: font "x" is not loaded' })[0].key).toBe('app.sketch.text.err.FontNotLoaded');
    expect(textNotes({ error: 'textFontMismatch: x' })[0].key).toBe('app.sketch.text.err.FontMismatch');
    expect(textNotes({ regions: [], bbox: [], area: 0, warnings: [{ code: 'textOverlappingContours', detail: '' }] })[0].key).toBe('app.sketch.text.warn.OverlappingContours');
  });
});

describe('script font option', () => {
  it('accepts built-in names and library ids and records the library fonts in the document', () => {
    const r = evaluate(`part('P').sketch('front', (s) => { s.text('A', [0, 0], { font: 'bebas-neue' }); s.text('B', [5, 0], { font: 'engrave' }); s.text('C', [9, 0], { font: 'bebas-neue' }); }).extrude(1);`);
    expect(r.errors).toEqual([]);
  });
  it('an unknown id names the valid ones', () => {
    const r = evaluate(`part('P').sketch('front', (s) => s.text('A', [0, 0], { font: 'comic' }));`);
    expect(r.errors[0].message).toContain("unknown font 'comic'");
    for (const id of ['gauge', 'engrave', ...CURATED_FONT_IDS]) expect(r.errors[0].message).toContain(id);
  });
});

describe('the fonts field travels with autosave and snapshots', () => {
  const doc = { name: 'P', features: [sketchWith({ font: 'x-12345678', string: 'A' })], fonts: [{ name: 'x-12345678', hash: 'h', source: 'embedded', data: 'AAAA' }] };
  it('autosave keeps it', () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    expect(writeAutosave(kv as never, 'P', doc)).toBe('saved');
    expect((readAutosave(kv as never)!.doc as typeof doc).fonts).toEqual(doc.fonts);
  });
  it('a snapshot keeps it', async () => {
    const b = memoryBackend();
    const s = createSnapshots(b, {});
    await s.note(doc, 'P', 'undo');
    expect(((await s.list())[0].doc as typeof doc).fonts).toEqual(doc.fonts);
  });
});

describe('DocFontPool with a recording kernel', () => {
  const ttf = new Uint8Array([0, 1, 0, 0, 1, 2, 3, 4]);
  function fakeKernel() {
    const log: Array<{ type: string; name?: string }> = [];
    const request = async (m: Record<string, unknown>) => {
      log.push({ type: String(m.type), name: m.name as string });
      if (m.type === 'loadFont') {
        const hash = await sha256Hex(fromBase64(String(m.data)));
        return { ok: true, result: { name: m.name, hash, family: 'Fake', bytes: 8, chars: 1, supported: [], warnings: [{ code: 'fontKerningIgnored', detail: '' }] } };
      }
      return { ok: true, result: { unloaded: true } };
    };
    return { log, request };
  }
  it('reload() sends every pooled font again (a restarted kernel starts empty), invalidate() makes loadAll do the same', async () => {
    const k = fakeKernel();
    const pool = new DocFontPool({ request: () => k.request });
    const r = await pool.addBytes(ttf, 'Fake', (h) => fontSlug('Fake', h));
    expect(r.ok && r.info.warnings[0].code).toBe('fontKerningIgnored');
    const name = (r as { name: string }).name;
    expect(k.log.map((l) => l.type)).toEqual(['loadFont']);
    expect(await pool.reload()).toEqual([]);
    expect(k.log.map((l) => l.type)).toEqual(['loadFont', 'loadFont']);
    // same document again in the same kernel: nothing to send; in another kernel: sent
    const doc = { features: [sketchWith({ font: name, string: 'A' })] };
    const fields = pool.fieldsFor(doc);
    expect(await pool.loadAll(fields)).toEqual([]);
    expect(k.log).toHaveLength(2);
    pool.invalidate();
    expect(await pool.loadAll(fields)).toEqual([]);
    expect(k.log).toHaveLength(3);
  });
  it('a font that is not used by any text is left out of the saved fields', async () => {
    const k = fakeKernel();
    const pool = new DocFontPool({ request: () => k.request });
    await pool.addBytes(ttf, 'Fake', (h) => fontSlug('Fake', h));
    expect(pool.fieldsFor({ features: [] })).toEqual([]);
  });
  it('refuses WOFF and text files before asking the kernel', async () => {
    const k = fakeKernel();
    const pool = new DocFontPool({ request: () => k.request });
    const w = await pool.addBytes(new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0]), 'W', (h) => fontSlug('W', h));
    expect(w).toMatchObject({ ok: false, problem: { code: 'fontBadData' } });
    expect(k.log).toEqual([]);
  });
  it('a document font whose data does not match its checksum is refused by name', async () => {
    const k = fakeKernel();
    const pool = new DocFontPool({ request: () => k.request });
    const ps = await pool.loadAll([{ name: 'bad', hash: 'f'.repeat(64), source: 'embedded', data: toBase64(ttf) }]);
    expect(ps).toEqual([{ name: 'bad', code: 'fontChecksum', message: expect.any(String) }]);
    expect(k.log.filter((l) => l.type === 'loadFont')).toEqual([]);
  });
  it('a curated font whose file fails the manifest checksum is refused', async () => {
    const k = fakeKernel();
    const src = { async manifest() { return manifest; }, async fetch() { return ttf; } };
    const pool = new DocFontPool({ request: () => k.request, source: src });
    const r = await pool.addCurated('anton');
    expect(r).toMatchObject({ ok: false, problem: { name: 'anton', code: 'fontChecksum' } });
    expect(await pool.addCurated('nope')).toMatchObject({ ok: false, problem: { code: 'fontUnknown' } });
    expect(vi.isMockFunction(src.fetch)).toBe(false);
  });
});
