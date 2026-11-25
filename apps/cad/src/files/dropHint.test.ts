import { describe, expect, it } from 'vitest';
import { filesEn } from './strings';

// The drop hint and the "cannot open" text list what the app advertises as openable. Importers whose results are not proven by tests are still reachable (a dropped file is tried), but are not advertised.
const UNADVERTISED = ['.ipt', '.ifc', '.3dm', '.dwg', '.rvt'];

describe('the advertised file formats', () => {
  it('the drop hint and the cannot-open text do not name importers that are not proven', () => {
    for (const key of ['files.drop.hint', 'files.drop.unknown'] as const) {
      const text = filesEn[key].toLowerCase();
      for (const ext of UNADVERTISED) expect(text, `${key} names ${ext}`).not.toContain(ext);
    }
  });
  it('both texts list the same formats', () => {
    const ext = (s: string) => [...s.toLowerCase().matchAll(/\.[a-z0-9]+/g)].map((m) => m[0]).filter((e) => e !== '.').sort();
    expect(ext(filesEn['files.drop.unknown'].replace(/Cannot open "\{name\}"/, ''))).toEqual(ext(filesEn['files.drop.hint']));
  });
});
