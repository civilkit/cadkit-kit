import { describe, expect, it } from 'vitest';
import { cleanSigAfterSave, mayClearAutosave } from './saveState';
import { FileManager, type FilePlatform } from './fileManager';

type Doc = { name: string; n: number };
const sigOf = (d: Doc | null) => (d ? JSON.stringify(d) : null);

describe('after a save', () => {
  it('a part edited while the write was running stays unsaved', async () => {
    let live: Doc = { name: 'P', n: 1 };
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const written: string[] = [];
    const platform: FilePlatform = {
      canOverwrite: () => true,
      handleStore: () => ({ get: async () => undefined, set: async () => {}, delete: async () => {} }),
      saveFile: async () => {},
      saveDocument: async (name, data) => { await gate; written.push(data); return { name, handle: null }; },
      readHandle: async () => null,
    };
    const m = new FileManager(platform, null);
    const saved = live;
    const pending = m.save(saved, {});
    live = { ...live, n: 2 };   // the edit lands while the file is being written
    release();
    const r = await pending;
    expect(r.ok).toBe(true);
    expect(JSON.parse(written[0]).n).toBe(1);   // the file holds the part as it was when the write began
    const clean = cleanSigAfterSave(saved, live, sigOf);
    expect(sigOf(live)).not.toBe(clean);        // so the edited part is still modified
    expect(mayClearAutosave(saved, live)).toBe(false);
  });
  it('an untouched part is clean and its autosave may go', () => {
    const d: Doc = { name: 'P', n: 1 };
    expect(cleanSigAfterSave(d, d, sigOf)).toBe(sigOf(d));
    expect(mayClearAutosave(d, d)).toBe(true);
    expect(cleanSigAfterSave(null, d, sigOf)).toBe(sigOf(d));
  });
});
