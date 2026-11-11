import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import '../i18n';
import { CORE_CATEGORIES, categoriesOf, categoryCounts, categoryLabel, filterEntries, foldedGroups, mapCategory, matchEntry, sanitizeFilter, tagCounts, wizardsFor, type LibEntry } from './entries';
import { samplesManifest } from './source';
import { validateManifest } from './manifest';
import { loadFilter, saveFilter } from './state';

let n = 0;
const E = (category: string, tags: string[], title = `Part ${++n}`, origin: 'included' | 'addon' = 'addon'): LibEntry => ({
  key: `l::${title}`, origin, libId: 'l', libName: 'L', kind: 'part', id: title.toLowerCase().replace(/\W+/g, '-'), title, category, group: mapCategory(category), tags,
});
const ids = (l: LibEntry[]): string[] => l.map((e) => e.title);
const F = { q: '', source: 'all' as const, category: 'all', tags: [] as string[] };

describe('mapCategory', () => {
  it('maps external categories onto the core ones; case, & / and, plurals do not matter', () => {
    expect(mapCategory('Tubing & Pipe')).toBe('pipe-fluid');
    expect(mapCategory('tubing and pipe')).toBe('pipe-fluid');
    expect(mapCategory('Fasteners')).toBe('fasteners');
    expect(mapCategory('screws')).toBe('fasteners');
    expect(mapCategory('Threaded Rod')).toBe('fasteners');
    expect(mapCategory('bearings')).toBe('mechanisms');
    expect(mapCategory('linear motion')).toBe('mechanisms');
    expect(mapCategory('sprockets')).toBe('power-transmission');
    expect(mapCategory('Sheet Metal')).toBe('sheet-metal');
    expect(mapCategory('3D printing')).toBe('printing');
    expect(mapCategory('steppers')).toBe('motors-electronics');
    expect(mapCategory('T-Slot')).toBe('brackets-structural');
    expect(mapCategory('boats')).toBe('marine');
  });
  it('maps core ids to themselves, the slash form by its first part, and leaves the unmatched as they are', () => {
    for (const c of CORE_CATEGORIES) expect(mapCategory(c)).toBe(c);
    expect(mapCategory('fasteners/screws')).toBe('fasteners');
    expect(mapCategory('pipe-fluid/hose')).toBe('pipe-fluid');
    expect(mapCategory('origami')).toBe('origami');
    expect(mapCategory('')).toBe('other');
  });
  it('shows a core label for a core category and the library own text otherwise', () => {
    expect(categoryLabel('brackets-structural')).toBe('Brackets & structure');
    expect(categoryLabel('other')).toBe('Other');
    expect(categoryLabel('origami')).toBe('origami');
  });
});

describe('filter, counts and folding', () => {
  const all = [
    E('tubing & pipe', ['pipe', 'tube'], 'Elbow'), E('Tubing', ['pipe'], 'Tee'), E('pipes', ['pipe', 'flange'], 'Flange'),
    E('fasteners', ['bolt', 'threaded'], 'Bolt'), E('screws', ['screw', 'threaded'], 'Screw'), E('rivets', ['rivet'], 'Rivet'),
    E('origami', ['paper'], 'Crane'),
  ];
  it('groups by core category and keeps the part own category', () => {
    expect(all[0].category).toBe('tubing & pipe');
    expect(all[0].group).toBe('pipe-fluid');
    expect(ids(filterEntries(all, { ...F, category: 'pipe-fluid' }))).toEqual(['Elbow', 'Tee', 'Flange']);
  });
  it('folds categories with fewer than 3 parts into Other (the dropdown only; search still finds them by their own category)', () => {
    expect([...foldedGroups(all, 'all')]).toEqual(['origami']);
    expect(categoriesOf(all, 'all')).toEqual(['fasteners', 'pipe-fluid', 'other']);
    expect(ids(filterEntries(all, { ...F, category: 'other' }))).toEqual(['Crane']);
    expect(ids(filterEntries(all, { ...F, q: 'origami' }))).toEqual(['Crane']);
  });
  it('lists library-own categories A to Z after the core ones, Other last', () => {
    const more = [...all, ...['b1', 'b2', 'b3'].map((x) => E('widgets', [], x)), ...['a1', 'a2', 'a3'].map((x) => E('anchors', [], x))];
    expect(categoriesOf(more, 'all')).toEqual(['fasteners', 'pipe-fluid', 'anchors', 'widgets', 'other']);
  });
  it('tags narrow with AND', () => {
    expect(ids(filterEntries(all, { ...F, tags: ['threaded'] }))).toEqual(['Bolt', 'Screw']);
    expect(ids(filterEntries(all, { ...F, tags: ['threaded', 'screw'] }))).toEqual(['Screw']);
    expect(ids(filterEntries(all, { ...F, tags: ['threaded', 'pipe'] }))).toEqual([]);
  });
  it('search matches the title, the own category text, the core label and the tags', () => {
    expect(ids(filterEntries(all, { ...F, q: 'elbow' }))).toEqual(['Elbow']);
    expect(ids(filterEntries(all, { ...F, q: 'tubing' }))).toEqual(['Elbow', 'Tee']);
    expect(ids(filterEntries(all, { ...F, q: 'pipe & fluid' }))).toEqual(['Elbow', 'Tee', 'Flange']);   // the core label, found for parts whose own category differs
    expect(matchEntry(all[1], 'fluid')).toBe(true);
    expect(ids(filterEntries(all, { ...F, q: 'rivet' }))).toEqual(['Rivet']);
  });
  it('category counts reflect the other filters, tag counts the current results', () => {
    expect(categoryCounts(all, F)).toMatchObject({ total: 7 });
    expect(Object.fromEntries(categoryCounts(all, F).counts)).toEqual({ 'pipe-fluid': 3, fasteners: 3, other: 1 });
    expect(Object.fromEntries(categoryCounts(all, { ...F, tags: ['threaded'] }).counts)).toEqual({ fasteners: 2 });
    expect(Object.fromEntries(categoryCounts(all, { ...F, category: 'pipe-fluid', q: 'tee' }).counts)).toEqual({ 'pipe-fluid': 1 });   // its own category is not applied to its own count
    expect(tagCounts(all, { ...F, category: 'fasteners' }).map((x) => `${x.tag}:${x.count}`)).toEqual(['threaded:2', 'bolt:1', 'rivet:1', 'screw:1']);
    expect(tagCounts(all, { ...F, category: 'fasteners', tags: ['screw'] })[0]).toEqual({ tag: 'screw', count: 1 });   // a selected tag stays first
  });
  it('counts only the shown source', () => {
    const mixed = [...all.slice(0, 3), E('pipes', ['pipe'], 'Included pipe', 'included')];
    expect(categoryCounts(mixed, { ...F, source: 'included' }).total).toBe(1);
    expect(categoryCounts(mixed, F).total).toBe(4);
  });
  it('drops a remembered category or tag that no longer exists', () => {
    expect(sanitizeFilter(all, { category: 'marine', tags: ['pipe', 'zzz'], source: 'all' })).toEqual({ category: 'all', tags: ['pipe'] });
    expect(sanitizeFilter(all, { category: 'fasteners', tags: [], source: 'all' })).toEqual({ category: 'fasteners', tags: [] });
  });
});

describe('wizard links', () => {
  it('links the Screw wizard in Fasteners and the Bearing wizard on the bearing tag, and nothing elsewhere', () => {
    expect(wizardsFor('fasteners', [])).toEqual(['screw']);
    expect(wizardsFor('mechanisms', ['bearing'])).toEqual(['bearing']);
    expect(wizardsFor('printing', [])).toEqual([]);
    expect(wizardsFor('all', [])).toEqual([]);
  });
});

describe('remembering the filter', () => {
  const store = (): Storage => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage; };
  afterEach(() => vi.unstubAllGlobals());
  it('keeps the category and tags per surface', () => {
    vi.stubGlobal('localStorage', store());
    saveFilter('picker', { category: 'fasteners', tags: ['bolt'] });
    saveFilter('catalog', { category: 'marine', tags: [] });
    expect(loadFilter('picker')).toEqual({ category: 'fasteners', tags: ['bolt'] });
    expect(loadFilter('catalog')).toEqual({ category: 'marine', tags: [] });
    saveFilter('picker', { category: 'all', tags: [] });
    expect(loadFilter('picker')).toEqual({ category: 'all', tags: [] });
  });
  it('starts empty on junk, and works without storage (missing or throwing)', () => {
    const s = store(); s.setItem('ck.library.filter.picker', '{"category":5}'); vi.stubGlobal('localStorage', s);
    expect(loadFilter('picker')).toEqual({ category: 'all', tags: [] });
    s.setItem('ck.library.filter.picker', 'not json');
    expect(loadFilter('picker')).toEqual({ category: 'all', tags: [] });
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } });
    expect(loadFilter('catalog')).toEqual({ category: 'all', tags: [] });
    expect(() => saveFilter('catalog', { category: 'marine', tags: ['x'] })).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(loadFilter('catalog')).toEqual({ category: 'all', tags: [] });
    expect(() => saveFilter('catalog', { category: 'marine', tags: [] })).not.toThrow();
  });
});

describe('bundled samples carry category and tags', () => {
  const index = JSON.parse(readFileSync('apps/cad/public/samples/index.json', 'utf8')) as Array<{ id: string; title: string; file: string; category?: string; tags?: string[] }>;
  it('every sample has a core category and 2 to 5 well-formed tags', () => {
    for (const e of index) {
      expect(CORE_CATEGORIES as readonly string[], e.id).toContain(e.category);
      expect(e.tags!.length, e.id).toBeGreaterThanOrEqual(2);
      expect(e.tags!.length, e.id).toBeLessThanOrEqual(5);
      for (const t of e.tags!) expect(t, e.id).toMatch(/^[a-z][a-z0-9-]{0,39}$/);
    }
  });
  it('every core category has at least 3 samples', () => {
    for (const c of CORE_CATEGORIES) expect(index.filter((e) => e.category === c).length, c).toBeGreaterThanOrEqual(3);
  });
  it('the samples manifest keeps them and passes the manifest rules', () => {
    const r = validateManifest(samplesManifest(index, 'Samples', 'LicenseRef-bundled'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bolt = r.manifest.parts.find((p) => p.id === 'bench-bolt')!;
      expect(bolt.category).toBe('fasteners');
      expect(bolt.tags).toEqual(['bolt', 'chamfer']);
    }
  });
  it('an entry without them still gets a category from its id prefix and no tags', () => {
    const r = validateManifest(samplesManifest([{ id: 'bench-x', title: 'X', file: 'x.ckpart' }, { id: 'y', title: 'Y', file: 'y.ckpart', category: 'a'.repeat(50), tags: 'no' }], 'S', 'L'));
    expect(r.ok && r.manifest.parts.map((p) => [p.category, p.tags])).toEqual([['bench', []], ['samples', []]]);
  });
});
