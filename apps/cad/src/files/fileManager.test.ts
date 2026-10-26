import { describe, expect, it } from 'vitest';
import { FileManager, type FilePlatform } from './fileManager';
import type { KV } from './storage';

const kv = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const handleStore = () => { const m = new Map<string, unknown>(); return { m, get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } }; };

function fake(opts: { picker?: boolean } = {}) {
  const writes: Array<{ name: string; data: string; handle?: unknown; pick?: boolean }> = [];
  const store = handleStore();
  const platform: FilePlatform = {
    canOverwrite: () => !!opts.picker,
    handleStore: () => store,
    saveFile: async (name, data) => { writes.push({ name, data: String(data) }); },
    saveDocument: async (name, data, o) => {
      writes.push({ name, data, ...o });
      if (!opts.picker) return { name, handle: null };
      const h = (o?.handle as { name: string } | undefined) ?? { name: o?.pick ? `picked-${name}` : name };
      return { name: h.name, handle: h };
    },
    readHandle: async (h) => (h as { gone?: boolean; denied?: boolean; name: string }).denied ? 'denied' : (h as { gone?: boolean }).gone ? null : { name: (h as { name: string }).name, text: '{"name":"R"}' },
  };
  return { platform, writes, store };
}

describe('FileManager save', () => {
  it('Save uses the document name the first time and the remembered file name after', async () => {
    const f = fake(); const m = new FileManager(f.platform, kv(), () => 7);
    expect(await m.save({ name: 'Bracket' })).toMatchObject({ ok: true, file: 'Bracket.ckpart' });
    await m.save({ name: 'Bracket' });
    expect(f.writes.map((w) => w.name)).toEqual(['Bracket.ckpart', 'Bracket.ckpart']);
    expect(m.fileName).toBe('Bracket.ckpart');
  });
  it('embed writes the view field for the document as written (its part name), and drops an old one', async () => {
    const f = fake(); const m = new FileManager(f.platform, kv());
    let seen: unknown = null;
    await m.save({ name: 'Part1', viewCache: 'stale' } as never, { saveAs: true, fileName: 'Hinge.ckpart', embed: async (w) => { seen = w; return { format: 'ck-view', n: 1 }; } });
    expect(seen).toEqual({ name: 'Hinge' });
    expect(JSON.parse(f.writes[0].data)).toMatchObject({ name: 'Hinge', viewCache: { format: 'ck-view', n: 1 } });
    await m.save({ name: 'Part1', viewCache: 'stale' } as never, { embed: async () => null });
    expect('viewCache' in JSON.parse(f.writes[1].data)).toBe(false);
    await m.save({ name: 'Part1' }, { embed: async () => { throw new Error('boom'); } });
    expect(JSON.parse(f.writes[2].data).name).toBe('Hinge');
  });
  it('Save As with a typed name stores it as the part name inside the file and for later saves', async () => {
    const f = fake(); const m = new FileManager(f.platform, kv());
    const r = await m.save({ name: 'Part1' }, { saveAs: true, fileName: 'Hinge.ckpart' });
    expect(r).toMatchObject({ ok: true, file: 'Hinge.ckpart', partName: 'Hinge' });
    expect(JSON.parse(f.writes[0].data).name).toBe('Hinge');
    expect(m.partName).toBe('Hinge');
    await m.save({ name: 'Part1' });
    expect(f.writes[1].name).toBe('Hinge.ckpart');
    expect(JSON.parse(f.writes[1].data).name).toBe('Hinge');
  });
  it('with a picker: first save asks, later saves overwrite the same handle, Save As asks again', async () => {
    const f = fake({ picker: true }); const m = new FileManager(f.platform, kv());
    expect(m.needsNameDialog()).toBe(false);
    await m.save({ name: 'P' }, { saveAs: true });
    expect(f.writes[0].pick).toBe(true);
    await m.save({ name: 'P' });
    expect(f.writes[1].handle).toEqual({ name: 'picked-P.ckpart' });
    expect(f.writes[1].pick).toBe(false);
    expect(m.fileName).toBe('picked-P.ckpart');
    expect(m.partName).toBe('picked-P');
    expect([...f.store.m.keys()]).toEqual(['picked-P.ckpart']);
  });
  it('reports a cancelled picker and a failing write without touching state', async () => {
    const cancel: FilePlatform = { saveFile: async () => {}, saveDocument: async () => null };
    const m = new FileManager(cancel, kv());
    expect(await m.save({ name: 'P' })).toEqual({ ok: false, cancelled: true });
    expect(m.fileName).toBeNull();
    const bad: FilePlatform = { saveFile: async () => {}, saveDocument: async () => { throw new Error('disk full'); } };
    expect(await new FileManager(bad, kv()).save({ name: 'P' })).toEqual({ ok: false, cancelled: false, message: 'disk full' });
  });
  it('opened() forgets the file and part name', async () => {
    const f = fake(); const m = new FileManager(f.platform, kv());
    await m.save({ name: 'A' }, { saveAs: true, fileName: 'A.ckpart' });
    m.opened(null);
    expect([m.fileName, m.partName]).toEqual([null, null]);
  });
});

describe('FileManager recent', () => {
  it('records samples and saved files, newest first, and reopens through a handle', async () => {
    const f = fake({ picker: true }); const m = new FileManager(f.platform, kv(), (() => { let n = 0; return () => ++n; })());
    m.noteSample('bolt', 'Bolt', '/s/bolt.ckpart');
    await m.save({ name: 'P' }, { saveAs: true });
    const list = m.recent();
    expect(list.map((e) => [e.kind, e.id])).toEqual([['file', 'picked-P.ckpart'], ['sample', 'bolt']]);
    const r = await m.reopen(list[0]);
    expect(r).toMatchObject({ ok: true, name: 'picked-P.ckpart' });
    expect(m.fileName).toBe('picked-P.ckpart');
  });
  it('explains why a file cannot be reopened', async () => {
    const f = fake({ picker: true }); const m = new FileManager(f.platform, kv());
    const e = { kind: 'file' as const, id: 'x.ckpart', name: 'x.ckpart', at: 1, handle: true };
    expect(await m.reopen({ ...e, handle: false })).toEqual({ ok: false, reason: 'noHandle' });
    expect(await m.reopen(e)).toEqual({ ok: false, reason: 'noHandle' });   // handle missing from the store
    f.store.m.set('x.ckpart', { name: 'x.ckpart', denied: true });
    expect(await m.reopen(e)).toEqual({ ok: false, reason: 'denied' });
    f.store.m.set('x.ckpart', { name: 'x.ckpart', gone: true });
    expect(await m.reopen(e)).toEqual({ ok: false, reason: 'gone' });
  });
  it('drops the handle of an entry that falls off the list', async () => {
    const f = fake({ picker: true }); const m = new FileManager(f.platform, kv());
    await m.save({ name: 'P' }, { saveAs: true });
    for (let i = 0; i < 8; i++) m.noteSample(`s${i}`, `S${i}`, '/u');
    await Promise.resolve();
    expect(f.store.m.size).toBe(0);
  });
});
