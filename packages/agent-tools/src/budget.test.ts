import { describe, expect, it } from 'vitest';
import { ToolError } from './errors';
import { budgetJson, clampBudget, fetchResult, ResultStore } from './budget';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `F${i}`, type: 'extrude', name: `Feature number ${i}`, depth: i }));
const big = { ok: true, name: 'Plate', bbox: [0, 0, 0, 10, 20, 30], features: rows(400), note: 'x'.repeat(9000) };

describe('budgetJson', () => {
  it('returns a result that fits untouched', () => {
    const v = { ok: true, features: rows(3) };
    const r = budgetJson(v, { max: 4000, store: new ResultStore() });
    expect(r.exceeded).toBe(false);
    expect(JSON.parse(r.text)).toEqual(v);
  });
  it('summarises one that does not fit: valid JSON within the budget, says so, counts what it cut, and keeps the whole behind a handle', () => {
    const store = new ResultStore();
    const r = budgetJson(big, { max: 4000, store });
    expect(r.exceeded).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(4000);
    const j = JSON.parse(r.text);
    expect(j.ok).toBe(true); expect(j.name).toBe('Plate');
    expect(j.bbox).toEqual([0, 0, 0, 10, 20, 30]);                         // a vector is never cut
    expect(j._budget).toMatchObject({ exceeded: true, maxChars: 4000, totalChars: JSON.stringify(big).length, handle: r.handle, fetch: { tool: 'fetch_result' } });
    const last = j.features[j.features.length - 1];
    expect(last).toMatchObject({ of: 400 }); expect(last._omitted).toBe(400 - (j.features.length - 1));   // nothing dropped silently
    expect(j.note).toMatch(/more characters\]$/);
    expect(store.get(r.handle!)!.value).toBe(big);                         // the whole result is still there
  });
  it('a larger budget keeps more, up to the whole result', () => {
    const store = new ResultStore();
    const small = budgetJson(big, { max: 2000, store }), large = budgetJson(big, { max: 48000, store });
    expect(JSON.parse(large.text).features.length).toBeGreaterThan(JSON.parse(small.text).features.length);
    expect(budgetJson({ a: rows(20) }, { max: 48000, store }).exceeded).toBe(false);
  });
  it('falls back to an outline when even the smallest summary is too big, and without a store says how to ask for less', () => {
    const wide = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`key${i}`, rows(5)]));
    const r = budgetJson(wide, { max: 1000, store: new ResultStore() });
    expect(r.text.length).toBeLessThanOrEqual(1000);
    const j = JSON.parse(r.text);
    expect(j._outline.key0).toBe('array(5)'); expect(j._keysOmitted).toBeGreaterThan(0); expect(j._budget.handle).toBeTruthy();
    expect(JSON.parse(budgetJson(big, { max: 1000 }).text)._budget.note).toMatch(/ask for less/);
  });
  it('clampBudget keeps a request within 500 and 48000', () => {
    expect(clampBudget(undefined)).toBe(4000); expect(clampBudget(10)).toBe(500); expect(clampBudget(1e9)).toBe(48000); expect(clampBudget('x', 123)).toBe(123);
  });
});

describe('ResultStore', () => {
  it('gives the same handle for the same result, drops the oldest past its limits and forgets after its life', () => {
    let t = 0;
    const s = new ResultStore({ maxEntries: 3, ttlMs: 1000, now: () => t });
    const a = s.put({ n: 1 }, 'one');
    expect(s.put({ n: 1 }, 'one')).toBe(a);
    s.put(2, 'two'); s.put(3, 'three'); s.put(4, 'four');
    expect(s.get(a)).toBeNull(); expect(s.size).toBe(3);
    t = 2000;
    expect(s.size).toBe(0);
    const c = new ResultStore({ maxChars: 10 });
    const first = c.put(1, '123456'); c.put(2, '654321');
    expect(c.get(first)).toBeNull();                       // over the size cap: the older one goes
  });
});

describe('fetchResult', () => {
  const store = new ResultStore();
  const h = store.put(big, JSON.stringify(big, null, 1));
  it('pages the text by characters until the end', () => {
    let off = 0, out = '';
    for (let n = 0; n < 100; n++) {
      const r = fetchResult(store, { handle: h, offset: off, limit: 5000 }, 4000).data as { text: string; nextOffset?: number; totalChars: number };
      out += r.text; if (r.nextOffset === undefined) break; off = r.nextOffset;
    }
    expect(JSON.parse(out)).toEqual(big);
  });
  it('gives a part by path, and pages an array by items without cutting a page', () => {
    expect((fetchResult(store, { handle: h, path: 'features.12.name' }, 4000).data as { value: string }).value).toBe('Feature number 12');
    const page = fetchResult(store, { handle: h, path: 'features', offset: 100, limit: 50 }, 1500);
    const d = page.data as { total: number; offset: number; returned: number; nextOffset?: number; items: unknown[] };
    expect(d).toMatchObject({ total: 400, offset: 100 });
    expect(JSON.stringify(d).length).toBeLessThanOrEqual(1500);
    expect(d.nextOffset).toBe(100 + d.returned); expect(d.returned).toBeLessThan(50);   // fewer items so that the page fits
    const tail = fetchResult(store, { handle: h, path: 'features', offset: 390, limit: 50 }, 4000).data as { nextOffset?: number; returned: number };
    expect(tail.returned).toBe(10); expect(tail.nextOffset).toBeUndefined();
  });
  it('says what is wrong: unknown handle, a path that is not there (with the keys that are)', () => {
    const code = (go: () => unknown) => { try { go(); } catch (e) { expect(e).toBeInstanceOf(ToolError); return (e as ToolError).code; } };
    expect(code(() => fetchResult(store, { handle: 'nope' }, 4000))).toBe('no_such_result');
    expect(code(() => fetchResult(store, { handle: h, path: 'feature' }, 4000))).toBe('bad_path');
    expect(code(() => fetchResult(store, { handle: h, path: 'features.999' }, 4000))).toBe('bad_path');
    try { fetchResult(store, { handle: h, path: 'zzz' }, 4000); } catch (e) { expect((e as ToolError).hint).toMatch(/features/); }
  });
});
