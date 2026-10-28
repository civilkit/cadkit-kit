// The method registry for the script API: what list_methods / docs and the MCP resources read. It is a view of @kit/skill, whose
// registry.generated.json is generated from the JSDoc of packages/script/src/recorder.ts (the same source as the app's Script tab),
// so every method run_script accepts is documented (a test walks the recorder to prove it). Pass your own object with the same
// shape to AgentSession.open({ registry }) to replace it.
import { EXAMPLES } from '@kit/script';
import { RECIPES, registry as skill, type MethodDoc as SkillMethod } from '@kit/skill';

export interface MethodDoc {
  /** How a script names it: `extrude`, `holes.polar`, `s.rect` (sketch builder), `face` (global function). */
  name: string;
  /** The API domain: sketch, features, selectors, holes, patterns, surfaces, assembly, utilities. */
  group: string;
  signature: string;
  summary: string;
  description?: string;
  parameters?: SkillMethod['parameters'];
  returns?: string;
  notes?: string;
  example?: string;
  related?: string[];
}
export interface Recipe { id: string; title: string; code: string }
export interface Registry {
  methods(): MethodDoc[];
  recipes(): Recipe[];
  /** Ranked search by name, summary and notes. */
  search(query: string, limit?: number): MethodDoc[];
  get(name: string): MethodDoc | undefined;
  /** Close names for an unknown one. */
  suggest?(name: string): string[];
  guide(): string;
  /** docs/llms.txt: the guide plus the one-line index of every method and recipe. */
  llmsTxt?(): string;
}

const nameOf = (id: string): string => (id.startsWith('part.') ? id.slice(5) : id.startsWith('sketch.') ? `s.${id.slice(7)}` : id);
const toDoc = (m: SkillMethod): MethodDoc => ({
  name: nameOf(m.id), group: m.domain, signature: m.signature, summary: m.summary, description: m.description, parameters: m.parameters,
  ...(m.returns ? { returns: m.returns } : {}), ...(m.notes ? { notes: m.notes } : {}), example: m.example, related: m.related.map(nameOf),
});

export function defaultRegistry(): Registry {
  const docs = skill.data.methods.map(toDoc);
  const byId = new Map(skill.data.methods.map((m, i) => [m.id, docs[i]]));
  const recipes: Recipe[] = EXAMPLES.filter((e) => !e.id.startsWith('matx')).map((e) => ({ id: e.id, title: e.title, code: e.code }));
  for (const r of RECIPES) if (!recipes.some((x) => x.id === r.id)) recipes.push({ id: r.id, title: r.title, code: r.code });
  return {
    methods: () => docs,
    recipes: () => recipes,
    get: (name) => { const e = skill.docs([name]).entries[0]; return e ? byId.get(e.id) : undefined; },
    suggest: (name) => skill.docs([name]).unknown[0]?.didYouMean.map(nameOf) ?? [],
    search: (query, limit = 10) => {
      if (!query.trim()) return docs.slice(0, limit);
      return skill.search(query, { limit }).methods.map((h) => byId.get(h.id)!).filter(Boolean);
    },
    guide: () => skill.guide(),
    llmsTxt: () => skill.llmsTxt(),
  };
}
