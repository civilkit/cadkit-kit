# Skill package (`@kit/skill`)

Phase 4 of `docs/plan-agent-layer.md`: the knowledge layer an LLM agent uses to write scripts for our script API (`packages/script`, `docs/scripting.md`). It holds no kernel code; it tells the model what exists, how to call it, and gives worked examples that are proven on the kernel.

## Parts

| Part | File | Job |
| --- | --- | --- |
| Method registry | `packages/skill/src/registry.generated.json` | 76 methods, generated from the JSDoc of `packages/script/src/recorder.ts` by `packages/skill/tools/generate.mjs` (`npm run skill:generate`). Names, signatures, parameter names and types, option properties, summary, description, example, related methods, hand-written pitfalls from `packages/skill/notes/<id>.md`. |
| JSDoc | `packages/script/src/recorder.ts` | Source of truth. Tags: first paragraph = one-line summary, second = description, `@domain`, `@param name text` (`o.mid text` for option properties), `@example`, `@see id, id`. The generator fails when a public method lacks any of them. |
| Search | `src/search.ts`, `src/synonyms.ts` | BM25F (name x3, summary x2, description x1, parameter names x1), a 60-group CAD synonym table (synonym hits count half), suffix-stripping stemmer, edit distance 1 typo tolerance for words longer than 4 letters. Recipes are indexed too (title x3, intent keywords x2, description x1, code x0.3). |
| Recipes | `src/recipes.ts` | 10 buildable recipes (executed against the kernel by `src/recipes.kernel.test.ts`: volume, validity, feature count) and 2 guides (`verification`, `common-errors`). |
| Prompt | `systemPromptFragment()` | Conventions, the compact method index and the rule "call `docs([...])` once for the methods you plan to use before writing the script". About 1.0k tokens. |

Why `@babel/parser`: the repo pins TypeScript 7 (the native compiler), which ships no JavaScript compiler API. `@babel/parser` with the `typescript` plugin keeps comments and positions and is already installed (transitive dependency of the Preact preset).

## The injectable shape (for `list_methods` and `docs` tools in `@kit/mcp`)

```ts
import { registry } from '@kit/skill';          // a SkillRegistry; or createSkill(data, recipes) for your own data

interface SkillRegistry {
  data: Registry;                                                     // the raw generated registry
  listMethods(opts?: { query?: string; domain?: string }): IndexEntry[];   // [{ id, domain, summary }]; with query: ranked by search, only matches
  docs(names: string[]): DocsResult;                                  // { entries: MethodDoc[], unknown: [{ name, didYouMean[] }], types: { Num: 'number | Expr', ... } }
  search(query: string, opts?: { limit?: number }): SearchResult;     // { methods: SearchHit[], recipes: SearchHit[] }, SearchHit = { id, score, summary, domain? }
  recipes(): Array<{ id, title, intent, description, kind }>;         // metadata only
  getRecipe(id: string): Recipe | undefined;                          // { id, title, intent[], description, kind: 'script' | 'features' | 'guide', code, expected?, gap? }
  systemPromptFragment(): string;
}
interface MethodDoc {
  id: string;            // 'part.extrude' | 'sketch.rect' | 'part.holes.polar' | 'face' | 'variables' ...
  kind: 'method' | 'function';
  domain: 'sketch' | 'features' | 'selectors' | 'holes' | 'patterns' | 'utilities';   // 'surfaces' and 'assembly' are reserved, empty today
  signature: string;     // as written in a script: '.extrude(depth: Num, o: ExtrudeOpts = {}): this', 's.rect(w: Num, h: Num, at: Pt = [0, 0]): this', 'face(sel: string): FaceSel'
  summary: string;       // one line
  description: string;
  parameters: Array<{ name, type, optional, default?, description, properties?: Array<{ name, type, optional, description }> }>;
  returns?: string;
  example: string;       // a runnable script or a fragment
  related: string[];     // ids
  notes?: string;        // pitfalls, markdown
}
```

`docs` accepts full ids (`part.extrude`), bare names (`extrude`, `polar`-style suffixes such as `holes.polar`), call syntax (`s.rect`, `extrude()`), any case. A bare name that matches several methods (`points`) returns all of them. Unknown names come back in `unknown` with close ids.

MCP wiring: `list_methods({ query?, domain? })` -> `registry.listMethods(...)`; `docs({ names })` -> `registry.docs(names)`; an optional `search_recipes({ query })` -> `registry.search(query).recipes` and `get_recipe({ id })` -> `registry.getRecipe(id)`; the host puts `registry.systemPromptFragment()` in the system prompt. Everything is plain JSON, no DOM or Node dependency (the JSON is imported as a module), so it runs in the browser agent, the daemon and the CLI alike.

## Regenerating

Edit JSDoc in `packages/script/src/recorder.ts` (comments only), add pitfalls in `packages/skill/notes/<id>.md`, then `npm run skill:generate` and commit the JSON. `src/registry.test.ts` regenerates in memory and fails when the committed file differs. Adding a public method to `SketchBuilder` or `PartBuilder` without JSDoc makes the generator throw.

## Numbers (2026-10-16)

* 35 methods in 6 domains; full compact index (id + summary) about 600 tokens; system prompt fragment about 1.0k tokens (4 characters per token). The 5k budget has room for about 250 methods at this density.
* 34 natural-language search queries, each with its expected method in the top 3 (`src/search.test.ts`); 12 recipe queries put the right recipe first.
* Recipes executed on the kernel, all valid: flanged bushing 19320.79 mm3, bolt-circle plate 36341.94, L-bracket 14892.41, closed hollow box 18432.00, pulley with holes 311353.36, gear blank 29403.28, ribbed plate 34200.00, tapered boss with chamfer 41262.08, pocket grid 44160.00, boat hull loft 35529.29 (cross-checked with the integrated `sections` volume to 6e-5). Every analytic volume matches to 1e-4.

## Gaps in the script API found while writing this

1. No loft, sweep, mirror, spline sketch entity, draft (as a feature), rib, thread, gear, surface or assembly helper. The hull recipe is a raw feature list and bypasses `runScript`: the script API has no escape hatch such as `feature({ type: 'loft', ... })`. This is the biggest gap for an agent: whatever the GUI can do but the script cannot is unreachable.
2. Hole kinds: only `simple`. Counterbore, countersink and tapped holes exist in the kernel (`holeCboreInvalid`, threads) but `hole()` cannot ask for them.
3. Patterns repeat only the LAST feature along one world axis (or about a world axis through the origin); no pattern of a pattern, no pattern about an axis elsewhere, no body patterns. The pocket-grid recipe draws all pockets in one sketch with a loop instead.
4. Selectors pick planar faces by direction only and edges by direction, plane, box, length or proximity; there is no selection by feature, by index, by name or by "the face a feature created". After a boss, `face('>Z')` silently means the boss top.
5. A cut sketched on a standard plane runs against the plane normal, so on 'front' at z = 0 with the body above it removes nothing (`cutNoEffect`). The fix is `flip: true` or a face sketch. A trap for models that think of cut as "into the part".
6. Sketch coordinate mapping on 'top' and 'right' (which world axis is sketch x and y, and the sign) is not documented anywhere; recipes avoid depending on it by centring, or by using faces.
7. The script cannot read results back (volume, bounding box, face count); verification lives in other tools.
8. Fillet radius is one constant per call; no variable radius, asymmetric chamfer or setback.
9. `at()` offsets only the three standard planes, not a face or a rotated plane.
