import { describe, it, expect } from 'vitest';
import { filterSamples, suspectSamples } from './samples.mjs';

const idx = [
  { id: 'a', title: 'A', file: 'a.ckpart' },
  { id: 'b', title: 'B', file: 'b.ckpart' },
  { id: 'matx-case', title: 'mATX tower case', file: 'heavy/matx-case.ckpart' },
  { id: 'bldc-2212', title: 'BLDC motor', file: 'bldc-2212.ckpart' },
];

describe('filterSamples', () => {
  it('keeps exactly the allowlisted entries, in index order, and says why the rest are dropped', () => {
    const r = filterSamples(idx, { samples: ['b', 'a'] });
    expect(r.kept.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.dropped).toEqual([
      { id: 'matx-case', reason: expect.stringContaining('heavy') },
      { id: 'bldc-2212', reason: expect.stringContaining('GPL') },
    ]);
  });
  it('refuses a stale id, a duplicate, and anything hard-denied even if listed', () => {
    expect(() => filterSamples(idx, { samples: ['nope'] })).toThrow(/not in samples\/index.json/);
    expect(() => filterSamples(idx, { samples: ['a', 'a'] })).toThrow(/duplicate/);
    expect(() => filterSamples(idx, { samples: ['matx-case'] })).toThrow(/never be published/);
    expect(() => filterSamples(idx, { samples: ['bldc-2212'] })).toThrow(/never be published/);
  });
  it('refuses file names that could escape the samples folder', () => {
    expect(() => filterSamples([{ id: 'x', title: 'x', file: '../x.ckpart' }], { samples: ['x'] })).toThrow(/unexpected file name/);
    expect(() => filterSamples(idx, { samples: 'a' } as never)).toThrow(/array/);
  });
  it('an empty allowlist publishes nothing', () => {
    expect(filterSamples(idx, { samples: [] }).kept).toEqual([]);
  });
});

describe('suspectSamples', () => {
  it('flags names that look like private work', () => {
    expect(suspectSamples([...idx, { id: 'speedboat-dash', title: 'Speedboat analog dash', file: 'speedboat-dash.ckpart' }]).map((e) => e.id)).toEqual(['matx-case', 'speedboat-dash']);
  });
});
