// @kit/skill: the knowledge layer an LLM agent uses to write scripts for the script API (packages/script).
// registry.generated.json is produced from the JSDoc of that package by tools/generate.mjs (npm run skill:generate).
import data from './registry.generated.json';
import { Bm25f, editDistanceAtMostOne } from './search';
import { RECIPES } from './recipes';
import type { DocsResult, IndexEntry, MethodDoc, Recipe, Registry, SearchHit, SearchResult } from './types';

export * from './types';
export { RECIPES } from './recipes';
export { SYNONYM_GROUPS } from './synonyms';
export { stem, tokenize, synonymsOf } from './search';

/** The injectable object a host (the MCP server, the in-app agent) reads: `list_methods` and `docs` tools call these. */
export interface SkillRegistry {
  /** the raw generated registry */
  data: Registry;
  listMethods(opts?: { query?: string; domain?: string }): IndexEntry[];
  docs(names: string[]): DocsResult;
  search(query: string, opts?: { limit?: number }): SearchResult;
  recipes(): Array<Pick<Recipe, 'id' | 'title' | 'intent' | 'description' | 'kind'>>;
  getRecipe(id: string): Recipe | undefined;
  systemPromptFragment(): string;
}

const compactSig = (m: MethodDoc): string => {
  const names = m.parameters.map((p) => p.name + (p.optional ? '?' : ''));
  const call = m.signature.slice(0, m.signature.indexOf('('));
  return `${call}(${names.join(', ')})`;
};

export function createSkill(reg: Registry, recipeList: Recipe[]): SkillRegistry {
  const byId = new Map(reg.methods.map((m) => [m.id, m]));
  const mIndex = new Bm25f(
    reg.methods.map((m) => ({ id: m.id, fields: { name: m.id.replace(/^(part|sketch)\./, m.id.startsWith('sketch.') ? 'sketch ' : ''), summary: m.summary, description: m.description, params: m.parameters.map((p) => p.name).join(' ') } })),
    { weights: { name: 3, summary: 2, description: 1, params: 1 } },
  );
  const rIndex = new Bm25f(
    recipeList.map((r) => ({ id: r.id, fields: { title: r.title, intent: r.intent.join(' '), description: r.description, code: r.code } })),
    { weights: { title: 3, intent: 2, description: 1, code: 0.3 } },
  );

  const listMethods = (opts: { query?: string; domain?: string } = {}): IndexEntry[] => {
    let ms = reg.methods;
    if (opts.domain) ms = ms.filter((m) => m.domain === opts.domain);
    if (opts.query) {
      const rank = new Map(mIndex.search(opts.query, 200).map((h, i) => [h.id, i]));
      ms = ms.filter((m) => rank.has(m.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    }
    return ms.map((m) => ({ id: m.id, domain: m.domain, summary: m.summary }));
  };

  const resolve = (name: string): MethodDoc[] => {
    const n = name.trim().replace(/\(.*$/, '').replace(/^\.+/, '');
    if (byId.has(n)) return [byId.get(n)!];
    const lower = n.toLowerCase();
    const ci = reg.methods.filter((m) => m.id.toLowerCase() === lower);
    if (ci.length) return ci;
    const stripped = lower.replace(/^(s|sketch|part)\./, '');
    const last = stripped;
    const exact = reg.methods.filter((m) => m.id.toLowerCase() === last || m.id.toLowerCase().endsWith('.' + last) || m.id.toLowerCase().replace(/^(sketch|part)\./, '') === last);
    return exact;
  };

  const docs = (names: string[]): DocsResult => {
    const entries: MethodDoc[] = []; const unknown: DocsResult['unknown'] = [];
    for (const name of names) {
      const hit = resolve(name);
      if (hit.length) { for (const h of hit) if (!entries.includes(h)) entries.push(h); continue; }
      const q = name.toLowerCase().replace(/^(s|sketch|part)\./, '');
      const near = reg.methods.filter((m) => editDistanceAtMostOne(q, m.id.toLowerCase().split('.').pop()!) || editDistanceAtMostOne(q, m.id.toLowerCase())).map((m) => m.id);
      const hits = near.length ? near : mIndex.search(name, 3).map((h) => h.id);
      unknown.push({ name, didYouMean: hits.slice(0, 3) });
    }
    const used = new Set(entries.flatMap((e) => (e.signature + ' ' + e.parameters.map((p) => p.type).join(' ')).match(/\b[A-Z]\w+\b/g) ?? []));
    const types = Object.fromEntries(Object.entries(reg.types).filter(([k]) => used.has(k)));
    return { entries, unknown, types };
  };

  const hit = (id: string, score: number, summary: string, domain?: string): SearchHit => ({ id, score: +score.toFixed(4), summary, ...(domain ? { domain } : {}) });
  const search = (query: string, opts: { limit?: number } = {}): SearchResult => {
    const limit = opts.limit ?? 8;
    return {
      methods: mIndex.search(query, limit).map((h) => hit(h.id, h.score, byId.get(h.id)!.summary, byId.get(h.id)!.domain)),
      recipes: rIndex.search(query, Math.min(limit, 5)).map((h) => hit(h.id, h.score, recipeList.find((r) => r.id === h.id)!.title)),
    };
  };

  const systemPromptFragment = (): string => {
    const lines: string[] = [];
    lines.push('# Writing CAD scripts (kit script API)');
    lines.push('Conventions: millimetres and degrees. Y is up. Standard planes: front = XY (normal +Z), top = XZ (normal +Y), right = ZY (normal +X). A sketch on a plane extrudes along its normal; a cut runs AGAINST the sketch normal (from a face sketch that is into the body; from the front plane at z = 0 it needs flip: true). circle() takes a RADIUS, hole() a diameter. Hole centres are [x, y] in the face sketch plane, measured from the world origin projected on it. A script builds ONE part: part(name).sketch(...).extrude(...) chain; each extrude / cut / revolve consumes the sketch just before it.');
    lines.push("Selectors are resolved against the body just before the step: face('>Z') the planar face furthest along +Z (also '<Z', '>X', '<X', '>Y', '<Y'); edges('|Z') straight edges parallel to Z, edges('>Z') edges in the top plane, edges('all'), or a rule object { parallel, onFace, not, lengthLess, near, within, ... }.");
    lines.push('Verify every build: check the run returns no errors, then read volume, validity and feature count; probe points and sections where a number could hide a mistake; on booleanFailed move the tool by 0.01 mm or unite touching bodies first.');
    lines.push('RULE: before writing the script call docs([...]) ONCE with the methods you plan to use (names below); do not guess signatures. Call search(query) when you do not know the method name.');
    lines.push('');
    lines.push('Methods (call forms: `.m()` chains on the part, `s.m()` on the sketch builder `s`, others are plain functions):');
    for (const d of reg.domains) {
      lines.push(`[${d}]`);
      for (const m of reg.methods.filter((x) => x.domain === d)) lines.push(`${compactSig(m)} - ${m.summary}`);
    }
    return lines.join('\n');
  };

  return {
    data: reg, listMethods, docs, search, systemPromptFragment,
    recipes: () => recipeList.map(({ id, title, intent, description, kind }) => ({ id, title, intent, description, kind })),
    getRecipe: (id) => recipeList.find((r) => r.id === id),
  };
}

export const registry: SkillRegistry = createSkill(data as unknown as Registry, RECIPES);
export const { listMethods, docs, search, recipes, getRecipe, systemPromptFragment } = registry;
