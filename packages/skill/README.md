# @kit/skill

Knowledge layer for LLM agents that write scripts for the kit script API (`packages/script`).

```ts
import { listMethods, docs, search, recipes, getRecipe, systemPromptFragment, registry } from '@kit/skill';

listMethods({ domain: 'holes' });          // [{ id: 'part.hole', domain, summary }, ...]
docs(['part.extrude', 'face']);            // { entries: MethodDoc[], unknown: [], types: { Num: ... } }
search('round the sharp edges');           // { methods: [{ id: 'part.fillet', score, summary }], recipes: [...] }
getRecipe('bolt-circle-plate').code;       // a script proven on the kernel
systemPromptFragment();                    // ~1k tokens: conventions + method index + "call docs([...]) first"
```

* `registry` is the injectable object (`SkillRegistry`) for the MCP server's `list_methods` and `docs` tools; `createSkill(data, recipes)` builds one from other data. Exact shapes: `docs/skill.md`.
* `src/registry.generated.json` is generated from the JSDoc of `packages/script/src/recorder.ts` plus `notes/<id>.md`. Regenerate with `npm run skill:generate` (a test fails when it is stale).
* Tests: `npx vitest run packages/skill` (the recipe test needs the kernel: `CK_WASM=<path to ck_wasm.wasm>`).
