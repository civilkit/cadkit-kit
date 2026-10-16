# Agent layer: build or fork? Decision and implementation notes

Status: plan, written 2026-10-16 after `docs/research-classcad-ai.md`. Nothing here is built yet.

## Decision: build our own, borrow selectively

**We do not fork the ClassCAD AI repo.** Reasons:

| Question | Finding | Consequence |
|---|---|---|
| Does the agent layer stand without their engine? | `@buerli.io/ai` has the engine as a peer dependency (`@buerli.io/classcad`, `@buerli.io/core`); the 264-method registry, the recipes and the script runner are written against the engine's API. | Forking means rewriting the parts that matter, and carrying a proprietary dependency. |
| Same UI stack? | They use React, react-three-fiber and zustand. We use Preact and our own viewport. | The panel cannot be reused as is. |
| What is the valuable part? | The loop design: code-enforced gates, a fresh vision reader, the A|B mirror check, a ledger built from live state, one-line method summaries in the prompt. All of it is a few hundred lines of ideas. | Re-implement against our kernel; cheaper than adapting. |
| What do we already have that they lack? | Real validity checks (`validate`, `verify`), exact mass properties, a fast Rust kernel, a feature-tree GUI, `packages/script`. | Our numeric truth is stronger; only the model-facing shell is missing. |

**Borrow, with attribution in `THIRD_PARTY.md`, only where the licence is MIT and the code is engine-agnostic** (check each package's own LICENSE before copying; `buerli-ai` is MIT, the others are unconfirmed):

- `@classcad/renderer`: a CPU z-buffer, bitmap font, hidden-line and hatch code works on a triangle mesh, so it may be reusable. Decide after reading its input format. Otherwise write ours on top of the kernel `drawing` reply.
- BM25 search with a CAD synonym table (`@classcad/skill`): small, generic. Take the idea at least; the synonym list is a good seed for ours.
- Never copy their prompts or method docs; ours describe our API.

## Decisions (user, 2026-10-16)

1. **MCP route first.** The in-app chat comes after the MCP route works (phases 0 to 4 first, then 5 and 6).
2. **BYOK for the in-app chat:** session-only key by default, opt-in passphrase-encrypted storage, optional own-proxy URL. Model-written scripts run in an isolated Worker.
3. **Hand edits are kept.** A chat turn adds to or changes only the features the script made (`origin: script#N`), leaves hand-made features alone, and lists them to the agent so it does not undo them.

## Principles

1. **One executor.** `run_script` is the only tool that changes anything. All other tools read, prove, show or document.
2. **The script makes a normal feature tree.** Chat, MCP and the Script tab all produce the same history, so the user can edit in the GUI afterwards and the agent can continue from the edited state.
3. **Gates are code, not prompt text.** Each fires at most once per turn.
4. **Numbers and eyes both.** Numeric probes check the model against the plan; a fresh vision reader with no build context checks the plan against the input image.
5. **Keys never enter our app by default.** The first route is MCP, where the host (Claude Code and others) owns the key.

## Packages (all under the kit, TypeScript)

| Package | Job |
|---|---|
| `@kit/script` (exists) | run a script into a feature tree; add an **attach mode** (edit the open part, not a new one) |
| `@kit/agent-tools` | tool definitions shared by MCP and the in-app agent: `run_script`, `tree`, `find`, `inspect`, `probe`, `section`, `snapshot`, `checkpoint`, `restore`, `notes`, `list_methods`, `docs`, `ask_user` |
| `@kit/snapshot` | deterministic renderer: named ortho views, first/third-angle sheets, section views, markers, A|B mirror sheet, diff. Browser (canvas) and headless (Node) from one core |
| `@kit/skill` | generated method registry from our script API types, recipes, BM25 + synonym search |
| `@kit/agent` | the loop: gates, perception reader, ledger and compaction, providers |
| `@kit/mcp` | stdio MCP server in front of a loopback daemon that owns a kernel session |

## Kernel additions

- `section {plane, tag?}` returns exact loops (outer and inner, closed polylines plus the underlying curve type per edge) where the plane cuts the body. Reuse the cut and `SEC.*` face path that `drawing` already has.
- `sections {axis, n | positions}` returns the loops for a stack, plus the integrated volume, which gives an independent volume cross-check.
- `probe {point | ray | line}` returns inside/outside, nearest face id and distance, or hit list with face ids. Useful for "is there material at x,y,z" checks.
- No kernel change is needed for views: the existing `drawing` reply feeds the renderer.

## Verification toolkit

1. Numeric: `massProps` (volume, CG, inertia), `check`/`validate` (valid solid, manifold), bounding box, face/edge counts, `probe` targets taken from the plan, `sections` volume cross-check.
2. Visual: `snapshot` of named views plus the mirror sheet (view, same view with negated azimuth). A fresh vision call receives the reference image and the sheet, must choose A or B and name the deciding feature.
3. Gates in the loop:
   - the first `run_script` is blocked until a perception reader has read the reference image;
   - a perception goal with more than one question is rejected;
   - the turn cannot end until a fresh reader has judged a render pair against the reference.
4. Where their pixel `diffImages` is unused, ours is used for before/after of the same pinned frame, to show the user what a script change did.

## Chat with images, then GUI edit

1. User opens the chat panel, attaches reference images, writes a request.
2. Perception reader (fresh vision call, one question at a time) extracts dimensions, features and layout into notes.
3. Agent writes a script and calls `run_script`. The result lands in the open document as a feature tree.
4. Snapshot and probes run; the agent compares and fixes by editing the script. Each attempt is a checkpoint so `restore` is cheap.
5. The user takes over in the GUI. The next chat turn starts from the current document: the agent reads `tree`, then edits by **script-in-attach-mode**: operations are added to the existing history instead of replacing it.
6. If the user changed features by hand, the ledger lists them so the agent does not undo them.

Open question: how to keep a script and hand edits in step. Recommendation: scripts produce features marked `origin: script#N`; a later script run replaces only features it owns and leaves hand-made ones.

## Providers and keys (browser app)

- Provider interface: `chat({messages, tools, system, images, signal}) -> stream of events`, plus `capabilities()` (vision, tools, context size, streaming). Adapters: Anthropic (streaming and prompt caching ON, which theirs lacks), OpenAI chat, OpenAI Responses, OpenAI-compatible base URL (local models, gateways), model discovery via `/models` where available.
- Key storage: session memory by default; opt-in passphrase-encrypted storage in IndexedDB. Never plain `localStorage`. Never logged, never in URLs.
- Production recommendation: users who care use the MCP route, or point the app at their own proxy.
- Model-written scripts run in an isolated Worker or sandboxed iframe with a message-only API. Their `new Function` with shadowed globals is not a sandbox and would expose a stored key.
- Show cost per turn from provider usage fields (they have none).
- If the chosen model has no vision, say so and skip image-dependent gates with a visible note.

## MCP server

- Stdio shim to one loopback daemon per machine; the daemon owns a kernel instance (native build when available, otherwise wasm in Node), rejects any request that has an Origin header, and queues tool calls.
- Tool list: as in `@kit/agent-tools`. Resources: `docs`, recipes.
- Optional: the daemon also accepts a GUI connection, so the user sees the agent's work live in the app (their "docked GUI").
- Ship a Claude Code plugin manifest and a `docs` skill file so hosts discover it.

## Build order (days are of focused work)

| Phase | Content | Days |
|---|---|---|
| 0 | Script runner: batch the build (one regen for the whole feature list, not one per step), cancel, progress; fixes the 600-feature case (see below) | 3 |
| 1 | Kernel `section`, `sections`, `probe` + tests | 3 |
| 2 | `@kit/snapshot` (views, sections, mirror sheet, diff) | 5 |
| 3 | `@kit/agent-tools` + `@kit/mcp` + attach mode in `@kit/script` | 6 |
| 4 | `@kit/skill`: registry from API types, recipes, search | 3 |
| 5 | `@kit/agent`: loop, gates, perception, ledger, providers, BYOK store, sandbox | 10 |
| 6 | Chat panel with image attach, history of attempts, cost | 6 |
| 7 | Evaluation harness: 30 reference parts with images, scored by numbers | 5 |

Phases 0 to 4 give a useful MCP route (about 20 days); 5 to 7 add the in-app agent.

## The 600-feature script run (user report, 2026-10-16)

The mATX case showed "Busy" at 432 features, the renderer tab at 1.6 GB and unresponsive. Likely causes, to be confirmed in phase 0: (a) the runner applies features one by one and the app regenerates and re-tessellates after each, which is quadratic; (b) per-feature caches hold a snapshot per step; (c) the main thread is blocked handling very large replies. The fix is to build the whole list off-screen in one regeneration and show a progress count, with the tree filling in at the end.
