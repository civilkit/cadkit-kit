import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const index = JSON.parse(readFileSync('apps/cad/public/samples/index.json', 'utf8')) as Array<{ id: string; title: string; detail?: string }>;

describe('samples index', () => {
  it('keeps the list titles short; longer explanations go in detail', () => {
    const long = index.filter((e) => e.title.length > 60).map((e) => e.id);
    expect(long).toEqual([]);
  });
  it('has no parenthesised notes left in a title', () => {
    expect(index.filter((e) => e.title.includes(' (')).map((e) => e.id)).toEqual([]);
  });
  it('keeps the full text as detail whenever a title was shortened', () => {
    for (const e of index) if (e.detail !== undefined) expect(e.detail.startsWith(e.title)).toBe(true);
  });
});
