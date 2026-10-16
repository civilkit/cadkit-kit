import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../script/src/index';
import { generate, render, OUT } from '../tools/generate.mjs';
import { docs, getRecipe, listMethods, recipes, registry, search, systemPromptFragment } from './index';

const tokens = (s: string) => Math.ceil(s.length / 4);   // rough: 4 characters per token

describe('generated registry', () => {
  it('is not stale: regenerating from the script source gives the committed file (run npm run skill:generate)', () => {
    expect(fs.readFileSync(OUT, 'utf8')).toBe(render(generate()));
  });
  it('every method has a summary, description, domain, signature and an example; related ids exist', () => {
    const ids = new Set(registry.data.methods.map((m) => m.id));
    for (const m of registry.data.methods) {
      expect(m.summary.length, m.id).toBeGreaterThan(10);
      expect(m.summary.length, `${m.id} summary should be one line`).toBeLessThan(110);
      expect(m.description.length, m.id).toBeGreaterThan(30);
      expect(m.example, m.id).not.toBe('');
      expect(m.signature, m.id).toContain('(');
      for (const r of m.related) expect(ids.has(r), `${m.id} related ${r}`).toBe(true);
    }
    expect(registry.data.methods.length).toBeGreaterThanOrEqual(35);
  });
  it('every example that is a whole script records without errors', () => {
    let n = 0;
    for (const m of registry.data.methods) {
      if (!/^(part\(|const )/.test(m.example)) continue;
      n++;
      expect(evaluate(m.example).errors, m.id).toEqual([]);
    }
    expect(n).toBeGreaterThan(20);
  });
});

describe('token budgets (4 characters per token)', () => {
  it('the full compact index (id + summary of every method) stays under 5k tokens', () => {
    const idx = listMethods().map((m) => `${m.id} - ${m.summary}`).join('\n');
    const t = tokens(idx);
    console.log('SKILL index tokens', t, 'methods', listMethods().length);
    expect(t).toBeLessThan(5000);
  });
  it('the system prompt fragment is 1 to 2k tokens', () => {
    const t = tokens(systemPromptFragment());
    console.log('SKILL prompt fragment tokens', t);
    expect(t).toBeGreaterThan(700);
    expect(t).toBeLessThan(2200);
  });
  it('the prompt fragment names the rule, the conventions and every method', () => {
    const p = systemPromptFragment();
    expect(p).toContain('docs([...])');
    expect(p).toMatch(/front = XY/);
    expect(p).toMatch(/AGAINST the sketch normal/);
    for (const m of registry.data.methods) expect(p, m.id).toContain(m.signature.slice(0, m.signature.indexOf('(')));
  });
});

describe('listMethods and docs', () => {
  it('filters by domain and query', () => {
    expect(listMethods({ domain: 'holes' }).map((m) => m.id)).toEqual(['part.hole', 'part.holes.grid', 'part.holes.points', 'part.holes.polar']);
    expect(listMethods({ query: 'fillet' })[0].id).toBe('part.fillet');
  });
  it('docs returns the full entry with parameters, example, related and notes', () => {
    const r = docs(['part.extrude', 'face']);
    expect(r.unknown).toEqual([]);
    const ex = r.entries[0];
    expect(ex.signature).toContain('.extrude(depth: Num');
    expect(ex.parameters.find((p) => p.name === 'o')!.properties!.map((p) => p.name)).toEqual(['mid', 'flip', 'draft', 'thin']);
    expect(ex.example).toContain('extrude');
    expect(ex.related).toContain('part.cut');
    expect(ex.notes).toContain('consumes the sketch');
    expect(r.types.Num).toBeDefined();
  });
  it('accepts bare, case-insensitive and call-style names; suggests close ids for typos', () => {
    expect(docs(['extrude']).entries[0].id).toBe('part.extrude');
    expect(docs(['Extrude()']).entries[0].id).toBe('part.extrude');
    expect(docs(['s.rect']).entries[0].id).toBe('sketch.rect');
    expect(docs(['holes.polar']).entries[0].id).toBe('part.holes.polar');
    expect(docs(['points']).entries.map((e) => e.id).sort()).toEqual(['part.holes.points', 'sketch.points']);
    const r = docs(['fillt', 'loft']);
    expect(r.entries).toEqual([]);
    expect(r.unknown[0]).toEqual({ name: 'fillt', didYouMean: expect.arrayContaining(['part.fillet']) });
    expect(r.unknown[1].name).toBe('loft');
  });
});

describe('recipes', () => {
  it('has the ten buildable recipes and two guides, each with id, title, intent keywords and code', () => {
    const all = recipes();
    expect(all.length).toBe(12);
    expect(all.filter((r) => r.kind !== 'guide').length).toBe(10);
    expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
    for (const r of all) { expect(r.intent.length, r.id).toBeGreaterThan(3); expect(getRecipe(r.id)!.code.length, r.id).toBeGreaterThan(100); }
  });
  it('script recipes record without errors and only call registered functions', () => {
    for (const r of recipes().filter((x) => x.kind === 'script')) expect(evaluate(getRecipe(r.id)!.code).errors, r.id).toEqual([]);
  });
  it('recipes are searchable', () => {
    const cases: Array<[string, string]> = [
      ['bolt circle plate with holes', 'bolt-circle-plate'], ['boat hull loft through sections', 'boat-hull-loft'], ['how do I verify the part', 'verification'],
      ['booleanFailed error fix', 'common-errors'], ['pulley with groove', 'pulley'], ['hollow box with a lid', 'hollow-box-lid'], ['rib reinforced plate', 'rib-plate'],
      ['grid of pockets', 'pocket-grid'], ['L bracket with fillets', 'l-bracket'], ['bushing with a flange', 'flanged-bushing'], ['gear blank with keyway', 'spur-gear-blank'], ['tapered boss with chamfer', 'tapered-boss-chamfer'],
    ];
    for (const [q, id] of cases) expect(search(q).recipes[0]?.id, q).toBe(id);
  });
});
