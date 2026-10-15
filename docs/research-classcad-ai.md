# Research: how ClassCAD AI works, and how we build the equivalent

Subject: the public repository `awv-informatik/classcad-ai` (MIT, monorepo, version 0.4.x of the MCP at the time of
reading). We only studied it: nothing here is copied, quotes are a few words long, behaviour is paraphrased. File and
function names are theirs unless marked "ours".

Contents: 1 packages, 2 verification, 3 slicing and sections, 4 agent loop, 5 providers and keys, 6 MCP server,
7 skill package, 8 design for our system, 9 findings and surprises.

---

## 1. Packages and how they fit

The repo is an npm workspace. Five publishable packages plus a Claude Code plugin and git submodules (`vendor/buerligons`,
`vendor/react-cad`, `vendor/buerli`: the closed-ish CAD app and React bindings that the MCP embeds as a docked GUI).

| Package | npm name | Role | Runs where |
| --- | --- | --- | --- |
| `packages/skill` | `@classcad/skill` | Knowledge: `SKILL.md`, 264-method registry, per-method docs, recipes, BM25 `discovery.js`, shared prompt fragments `prompts.js` | anywhere (pure JS + JSON) |
| `packages/script` | `@classcad/script` | The "script medium": `runScript(code, session)` runs model-written JS against `api.v1.*`, `api.tree()`, `api.graphic()`, `api.inspect.*` | browser + Node |
| `packages/renderer` | `@classcad/renderer` | Deterministic images from session data: views, sections, sheets, drawings, markers, x-ray, `diffImages` | browser + Node, zero deps (sharp only for PNG in Node) |
| `packages/mcp` | `@classcad/mcp` | MCP server: owns an engine (WASM in a worker thread, or a WebSocket to a worker), exposes tools, serves a docked GUI, shares sessions | Node 20+ |
| `packages/buerli-ai` | `@buerli.io/ai` | The in-app assistant: agent loop, providers, context compaction, React chat panel | browser (React) |
| `packages/relay` | (private worker) | Cloudflare Worker + Durable Object that relays a session from a user's machine to a guest browser | Cloudflare |
| `plugins/classcad` | plugin `classcad` | Claude Code plugin: `.mcp.json`, a short `skills/classcad/SKILL.md`, `launch.mjs` | Claude Code |
| `.claude-plugin/marketplace.json` | | Marketplace manifest pointing at `./plugins/classcad` | |

How they fit (the important design fact: ONE shared brain, several hosts):

```
                      @classcad/skill  (docs, registry, recipes, discovery, prompt pointers)
                         |         \
        used by          |          \ used by
  @classcad/mcp (Node)   |           @buerli.io/ai (browser)
   tools: run_script,    |            tools: same names (run_script, snapshot, docs, ...)
   snapshot, docs ...    |            + delegate, ask_user, notes, fetch_url
         |               |                    |
         +---- @classcad/script (runScript) --+     the SAME script text runs in both
         +---- @classcad/renderer (renderSession / renderSessionData) --+
         |                                    |
   ClassCAD engine (WASM worker or ws)    ClassCAD engine (WASM in the page)
```

* The prompt text that must not drift is imported, not copied: `RECIPES_POINTER` and `REFERENCE_IMAGE_POINTER` in
  `packages/skill/prompts.js` are used by both `buerli-ai/src/systemPrompt.ts` and `mcp/src/tools/docs.ts`
  (`serverInstructions()`). The header comment says a drifted copy once caused a production failure.
* The same `createDiscovery()` (in `discovery.js`) backs the `list_methods`, `docs` and `describe_method` tools in both hosts.
* The plugin is thin. `plugins/classcad/.mcp.json` runs `node ${CLAUDE_PLUGIN_ROOT}/launch.mjs`; `launch.mjs` installs the
  pinned `@classcad/mcp@<version>` once into a per-version folder under the user's home (detached install, lock file,
  completion marker written last) and then starts it, passing stdio straight through. It exists because an `npx -y`
  on every start can exceed a host's startup timeout and concurrent npx installs corrupted the cache. The plugin's SKILL.md is
  about 40 lines: the seven-step workflow (read input, plan and fetch docs in ONE call, few big scripts, verify with numbers,
  show, work together, deliver) and a pointer to the MCP's own server instructions.
* `packages/mcp/server.json` is the MCP registry manifest (npm package, stdio transport).

---

## 2. How they verify a part (the most important section)

ClassCAD's doctrine is stated in `packages/skill/recipes/verification.md`: the engine reports success (`maxLevel` 31)
for operations that did nothing, and a render auto-scales so a wrong size can look identical, so "correctness has two
halves": **execution** (the model matches the plan: numeric checks) and **interpretation** (the plan matches the input:
perception discipline). Green numbers cannot rescue a mirrored reading, because every probe target is derived from the same
misread image. The doc reports six runs that built the same mirrored part with all probes passing.

### 2.1 The tools the model has for verification

| Tool / call | Where | What it returns |
| --- | --- | --- |
| `snapshot` | `mcp/src/tools/snapshot.ts`, `buerli-ai/src/tools/executor.ts` (`snapshot` handler) | PNG of the live drawing; options below |
| `api.v1.part.calculateMassProperties({id})` (inside `run_script`) | engine | `{cog:{x,y,z}, volume}` ONLY (no surface area, no inertia in the doc) |
| `api.inspect.capture / currentSolids / graphicBounds / edgeCandidates / uniqueEdge / solid` | `script/src/inspection.ts` | tessellated bounds (flagged `approximate: true`), edge lookup near a point, mass props of one solid |
| `structure.calculateProductBounds(id)` | buerli namespace (browser only) | `{center,min,max,radius}` |
| `api.v1.part.getGeometryIds / getGeometryPositions` | engine | exact brep probes: ids of cylinders/edges at a point, analytic positions |
| `tree / find / inspect` | MCP and agent | structure tree facts |
| `checkpoint / restore` | both | in-memory OFB save/rollback of the drawing |

Notable absences (read from the code, not assumed):

* **No validity check.** `inspectSolid` returns the literal string "not checked; mass and graphics are not a B-rep validity
  test". The model relies on volume sanity and the engine's own error levels.
* **No numeric section or slice extraction.** Sections exist only as images (and as the `part.slice` modeling feature).
* **`diffImages` is not wired into any tool.** `@classcad/renderer` exports it; `snapshot` accepts a `frame` to pin an
  earlier render's framing and returns the `frame` of each render, but the MCP and the agent never call `diffImages` and
  there is no "diff" tool. The pixel-diff is a library capability for custom harnesses and before/after of the SAME model.
* **No reference-vs-render pixel comparison.** A reference photo or drawing and a render are never pixel-compared.
  The comparison against the reference is done by a vision model (the perception sub-agent, section 4.5).

### 2.2 Numeric tiers (recipes/verification.md, "Part II")

| Tier | Check | Rules written in the doc |
| --- | --- | --- |
| 1 | `calculateMassProperties` | Compare volume with an independent expectation computed in the script from the design math. Regenerating a parameter must move volume in the right direction and magnitude; unchanged volume after a "successful" subtraction means the boolean left a sheet body; N patterned cuts show up as `+1/N` volume steps; null mass props on a body that existed a step earlier means it was destroyed. Tolerance: planar exact, curved about 0.05 % relative (cylinder -0.002 %, sphere +0.014 %, a 168-hole rail -0.096 %). Assemblies: measure templates and the root, never one instance (it materializes all instances). |
| 2 | Bounds | There is no v1 bounds method; use tessellated `graphicBounds` over CURRENT (unconsumed) solids only, or `calculateProductBounds`. Extent = max - min. |
| 3 | Brep probes | Prove a feature exists where the math says: ask for the cylinder at a point on its face, read analytic positions, assert distance about 0 (<= 1e-6 of model scale). A full circle is one closed edge; a rim interrupted by another cut is several. |

A "when to verify" table grades effort: a single simple feature needs none, a multi-feature build needs Tier 1 after the last
boolean plus Tier 3 on one or two features, every `updateExpression` regen needs Tier 1 + 3, boolean/pattern/slice needs
Tier 1 before AND after (delta check), position claims need Tier 2/3 "never from the rendered view alone".

Tessellation trap (documented): graphic-based probes see a mesh faceted at chord tolerance (default 0.1 model units), so a
small arc can read as "missing". Cures: probe the brep, or temporarily tighten `setFacetingParameters` and restore it.
`snapshot` handles this itself: `applyAdaptiveFaceting` in `renderer/src/core.ts` sets chord tolerance to about
bbox-diagonal/3000 (clamped to 1e-4..0.1), re-tessellates, renders, and restores the worker-global parameters
(`quality: 'fast'` opts out).

### 2.3 What `@classcad/renderer` produces (`renderSessionData`, `RenderOptions`)

Pure data in, pixels or SVG out, "same input gives same image: fixed CAD views, auto-fit framing, no camera state, no GPU".

| Feature | Option | Notes |
| --- | --- | --- |
| Orthographic named views | `view: 'iso' \| 'front' \| 'back' \| 'left' \| 'right' \| 'top' \| 'bottom'` | Z-up. `iso` = azimuth 45, elevation 35.264 (front-right-top). Never mirrored. |
| Arbitrary ortho camera | `{azimuth, elevation}` or `{direction, up?}` | A named view and an equivalent vector give the same image. |
| Framing | `zoom`, `lookAt`, `frame` | `frame = {scale, midX, midY}` is returned by every render; passing it back pins scale and centre. |
| Four-view sheet | `sheet: true \| [4 views] \| [2 views]` | Quadrants share one scale. Two views gives side-by-side panels labelled A and B (used for the mirror check). |
| Line style | `lines: true` | Visible edges and silhouettes solid, hidden dashed. Silhouettes of curved faces are derived from the mesh (edges between a front-facing and back-facing triangle). |
| Technical drawing | `drawing: true \| 'first-angle' \| 'third-angle' \| {projection, side, iso}` | Front, top and one side view in line style, aligned, one shared scale, plus a shaded iso in the free quadrant (which also names the method). First-angle: top below front, view from the LEFT placed right of front. Third-angle: top above front, view from the RIGHT. Takes precedence over `sheet`. |
| Section | `section: {origin, normal, cap?}` | See section 3. |
| Highlight | `highlight: ids[]`, `highlightAt: [[x,y,z]]` | Signal orange (faces/bodies) or red (edges). Ids are only stable inside one graphic payload, so `highlightAt` (closest face to a world point) is the robust form across calls. |
| Markers | `markers: [{position, label, color}]` | Crosshair plus label at world coordinates, drawn on top with no depth test. |
| Sketch overlay | `sketchOverlay: true` | All sketch curves drawn in 3D on their own plane over the solid; construction geometry violet. |
| Annotate | `annotate: true` | Bounding-box extents text `X x Y x Z`, an RGB axes triad oriented like the view, and a scale bar with a round model-unit length. This is the only built-in "measurement" aid. |
| X-ray | `xray`, `xrayAlpha` | Painter's blend far to near; edges stay opaque. |
| Colours | `colors: 'native' \| 'distinct'` | `distinct` = one palette colour per body (use for booleans, patterns, assemblies). |
| Layers | `layers: ['solid','sketch','curves','workgeo']` | Sketches, curves and work geometry render as SVG. |
| Supersample, size | `supersample` 1..4 (default 2), `width`, `height` up to 4096 | |
| STL source | `source: 'stl'` | Renders the exported STL through the same rasteriser: an independent check of what an export file contains. |
| Pixel diff | `diffImages(a, b, {tolerance})` | `{changed,total,fraction,bbox,pixels}`; changed pixels red on a faded grey of the after-image. Throws on size mismatch; meaningful only with a pinned `frame`. |

Implementation notes that matter for our port: the solid renderer is a hand-written CPU z-buffer rasteriser in
`renderer/src/core.ts` (about 3000 lines, `renderSolidZBuffer`); text uses a built-in 5x7 bitmap font so images are
byte-deterministic (or real text when `vectorText` is on, which the MCP enables); the golden test is `test/golden.mjs`.
The node adapter (`renderer/src/node.ts`, `renderSession`) refuses to give a silent empty render: with no graphic data it
throws and names the remedies (including `source: 'stl'`).

### 2.4 How results go back to the model

* MCP `snapshot` returns MCP content blocks: the PNG(s) as **inline image blocks** first, then one text block with `Saved:
  <path>`, a `capture: {...}` metadata object, the `frame` (so a later call can pin it), and a reminder that the USER often
  cannot see tool-result images, so the model should show the render at the end of a build (send the file or embed a
  Markdown image with the absolute path). PNGs are also written to disk (`outDir`, `CLASSCAD_SNAPSHOT_DIR`, or the OS temp
  dir).
* The in-app agent's `snapshot` handler returns `{image(base64), mimeType, width, height, label, frame, rendered, capture}`.
  `buildToolResultContent()` in `agentLoop.ts` then decides: if the selected model has vision
  (`config.sendSnapshotsToModel`, derived per model from `ModelOption.vision`) the result becomes an image block plus a text
  block of metadata; otherwise the model gets metadata only and the image is shown only in the panel (the code comment says
  some endpoints stall on images).
* Numbers return as JSON text from `run_script`: `{returned, logs, warnings}`, size-capped (`maxResultChars` 24000).
  Errors come back as `isError` text with the console tail, because `strict` mode makes any engine result with level >= 51 throw.
* The loop keeps the last two snapshots (`recentSnapshots`, `MAX_HANDOVER_SNAPSHOTS`) so a `delegate` can be handed the actual
  pictures, not a description.

### 2.5 The verification "gates" for reference-image turns (enforced in code)

Both are in `buerli-ai/src/agentLoop.ts` inside `runAgentLoop`, deliberately in code "where it cannot be argued away":

1. **Perception gate (before building).** If the user attached images (or `fetch_url` pulled an image, which is registered as a
   reference image and survives turn boundaries, up to the last 4), the FIRST `run_script` is rejected with a "BLOCKED"
   tool result unless a perception sub-agent has already read the image (`perceptionDelegated`). It fires at most once
   (`perceptionBlocks < 1`), so a stubborn model still proceeds. The text tells the model to fan out `delegate` calls with
   `agent: 'perception', withImages: true`, ONE question each, write the verdicts into `notes`, and ask the user about
   what a reader cannot answer.
2. **One question per reader.** A `delegate` to `perception` whose goal has more than one `?` or more than one list item is
   rejected with an explanation. Measured claim in the recipe: one question per reader 6/6 correct, seven in one reader wrong.
3. **Mirror gate (before ending).** When the turn would end (no tool calls) and a reference image exists, geometry was built
   (`geometryWasBuilt`) and no fresh reader has judged (`mirrorJudged`), the loop injects ONE synthetic user message (max once)
   instructing: snapshot with `sheet: [matched view, same view with negated azimuth]`, then `delegate` perception with
   `withImages: true, withSnapshots: true` asking only "which panel matches the reference, and which feature decides it?".
   `mirrorJudged` becomes true only when the delegate held BOTH reference images and snapshots, so a handover with no
   reference is a failed gate. The justification in the code comment: an earlier prompt made the check conditional
   ("when the record holds a handedness fact") and the agent exempted itself ("the part is symmetric").

### 2.6 The verification protocol the model is told to follow (recipes/verification.md, Part I)

The INPUT TYPE chooses the regime: plain-text spec (numeric only), dimensioned drawing (Part I then II; build by constrained
sketches), photo without dimensions (verify proportions, counts, topology; state the assumed scale), interactive steering
(re-run Part I whenever wording implies a side or handedness).

Phase 0, the **reference record**, written to `notes` BEFORE any modeling and then frozen: (1) inventory of views and image
resolution (below about 800 px, handedness is LOW CONFIDENCE) and the projection method; (2) callout anchors (what each
leader physically touches, whether it crosses material); (3) EVERY side/direction/handedness fact, not just uncertain ones
("confidence and accuracy are uncorrelated"); (4) resolve by coincidence (flush faces, tangencies, shared centrelines) before
mental rotation; (5) remaining facts by a two-hypothesis test with a pre-registered observable (prediction before
observation); (6) fresh readers via `delegate`; (7) freeze. Bounded inquiry: one observation plus the reader round per
fact, then ASK the user once, batched, with a default reading ("interactive host") or DECLARE the deciding channel
("headless"). "Never invent geometry to explain a reading" and "mechanical plausibility is a prior, not evidence".

Final gate, four steps in order: (1) matched-view renders (same view/azimuth as the reference; for a multi-view drawing use
`drawing: '<reference's method>'` so hidden lines are compared too); (2) mirror check, UNCONDITIONAL, judged against the IMAGE
with the model's answer written in image-space terms first; (3) record replay, row by row, each orientation fact proved by
a Tier 3 probe or extents asymmetry or material-presence test; (4) second reading from the reference image again, diffed
against the record; any difference between render and reference "is EXPLAINED BY A MEASUREMENT or it is a defect": "different
viewing angle" is never an explanation.

---

## 3. How they "slice" a part

The word covers four different things in the repo. Only the first is a verification technique.

| Use | Where | What it is |
| --- | --- | --- |
| A. Section view in the renderer | `renderer/src/core.ts`: `normalizeSection`, `clipPolyToSection`, the `capSegs` collection inside `renderSolidZBuffer`, `_fillSectionCap`; exposed as `snapshot({section})` | Image only. |
| B. `part.slice` / `part.sliceBySheet` / `solid.slice` / `solid.section` | engine methods listed in `SKILL.md`, docs `references/part/slice.md` | A modeling feature: cut the solid with a work plane (or a sheet body), keep one side, consume the target. Silent no-op when the plane misses (a documented gotcha). `solid.section` "sections the given solid at the given plane" (direct modeling). Not used by the verification doctrine. |
| C. Slice stack for reverse engineering | `recipes/clean-construction.md` | When tracing a vendor part by section slices, "read the faces first": a stack of slices misses cones, tilted planes, tori (one case: -0.64 % volume, then +0.0003 % once the faces were read). |
| D. Synonym table | `discovery.js` `OP_SYNONYMS` | "split", "cut", "section", "slice" are mutual synonyms so a search for any finds `part.slice`. |

### 3.1 The section view, step by step (technique A)

Input (`SectionPlane`): `origin [x,y,z]`, `normal [x,y,z]`, optional `cap` (default true). Everything on the POSITIVE side of
the normal (dot(p - origin, n) > 0) is removed. Framing stays that of the UNSECTIONED model, so sectioned and unsectioned
renders of the same state are directly comparable. Output: a normal raster (or a sheet panel, or a drawing view), in which:

1. **Clip.** Each triangle (world space, after instance transforms) is clipped with Sutherland-Hodgman against the plane
   (`clipPolyToSection`), producing 0..4 vertices, fan-triangulated.
2. **Back faces are kept** while a section is active (they are the interior walls seen through an open region), shaded darker.
3. **Cut segments.** Per body, every triangle that crosses the plane contributes one world-space segment. A vertex exactly on
   the plane counts as the kept side, "so every crossing is found exactly once and the segments close into loops"
   (`d[j] > 0 !== d[k] > 0`).
4. **Cap fill.** `_fillSectionCap` rasterises those segments with an **even-odd scanline fill** in screen space, so bores and
   pockets (inner loops) stay open. Depth is the plane's own depth, computed as a linear function of screen x,y from three plane
   points about 100 px apart; a plane seen edge-on yields only the outline.
5. **Hatch.** 45 degree screen-space hatching: `t = x + y` (or `x - y` for alternate bodies) modulo a spacing of 7 px
   (scaled) picks hatch vs fill colour. Adjacent bodies alternate the direction (`flip`), as a drawing does. In line style the cap is
   white with grey hatch.
6. **Outline.** The cut segments are also pushed as edge lines so the section outline is drawn.
7. `cap: false` leaves the cut open (interior walls shaded). In x-ray mode no caps are built.

Properties worth knowing: (a) the geometry is the **tessellated mesh**, so curved walls are polygonal at the chord tolerance;
(b) nothing is measured: wall thickness, bore diameters etc. are read **by eye** from the picture, aided only by the
`annotate` scale bar and extents text and by `markers` placed at world coordinates the model computed; (c) combined with
`drawing`, `lines`, `xray`, `markers`, `highlightAt` freely ("a sectioned x-ray sheet with markers is valid"); (d) the tool
description says "wall thicknesses, bores and pockets read directly" from the hatch.

Practical section recipe the model is steered to (verification.md): a section snapshot looks cut even when the boolean left a
sheet body, so after any subtraction assert the volume DROP numerically, then use the section only for the human-readable
confirmation of internals.

There is no "measure on a section" tool, no section outline returned as data, and no per-slice area/perimeter. If we want
numeric sections we have to design them (section 8.4); the technique they use makes a good image but a weak measurement.

---

## 4. The agent loop (`packages/buerli-ai/src`)

### 4.1 Entry points and events

`runAgentLoop(userMessage, history, config, images?)` in `agentLoop.ts` is an async generator. `AgentTurnEvent` is a union of
`text`, `thinking`, `tool_start`, `tool_end`, `subagent_start`, `subagent_end`, `usage`, `compaction` (phase start/done, reason,
`CompactionReport`), `error`, `done` (with the final messages: history is returned even on failure so a failed round never
costs the user the turn). Events arrive per completed block; token-level streaming goes through `config.onStreamDelta` into the
panel's live "thinking" ticker.

`AgentConfig`: `provider`, `drawingId`, `maxIterations` (40), `maxTokens` (8192), `contextLimit`, `model`, `reasoningEffort`,
`systemPrompt`, `extraContext`, `attachments`, `sendSnapshotsToModel`, `signal`, `depth`, injectable `executeTool` and
`readStructure` (so the loop runs headless in tests; see `test/loop.test.mjs` with fakes).

Loop shape per iteration: (1) maybe compact the context; (2) call `provider.chat` with up to 3 attempts for transient errors
(1.5 s backoff times attempt), plus one hard-compaction retry on context overflow; (3) emit thinking and text; (4) if no tool
calls: apply recovery nudges and gates, else end; (5) otherwise announce all tool calls, run them **concurrently**
(`Promise.all`, results fed back in original order), annotate each result for compaction, append, repeat.

### 4.2 Tools (`tools/schema.ts` `TOOL_SCHEMAS`, 16 tools)

| Tool | Purpose / schema essentials |
| --- | --- |
| `run_script` | `{script: string, timeoutMs?}`: the only way to execute API calls. Strict mode; the browser engine gets a longer timeout than a native worker. |
| `tree`, `find`, `inspect` | Structure tree, search by class/name, one node in full. |
| `get_selection`, `set_selection` | Read/set the user's 3D selection (this is how "this face" works). |
| `list_methods` | `{namespace?, filter?}`: ranked keyword search with CAD synonyms; also reflects live non-v1 buerli namespaces. |
| `docs` | `{keys: string[]}` bulk docs (up to a key cap, response budget about 160k chars, paged `key#2`). |
| `fetch_url` | One GET via the local proxy; text or image. A fetched image becomes a reference image. Sub-agents cannot use it. |
| `snapshot` | The renderer option set above plus `label`, `width`, `height`, `quality: 'fast' \| 'fine'`, `recalc`. |
| `load_file`, `download` | Import a user-attached CAD file by name; export STEP/STL/OFB as a download button (bytes never go to the model). |
| `checkpoint`, `restore` | `{label}`; in-memory OFB saves, max 5 per drawing, die with the page. |
| `notes` | `{action: get \| set \| append, text}` persistent scratchpad per drawing. |
| `delegate` | `{agent, goal, withImages?, withSnapshots?}` (below). |
| `ask_user` | `{questions: string}` ends the turn. |

`executeTool` (in `tools/executor.ts`) refuses everything except `list_methods`, `docs`, `notes`, `fetch_url` with
"Session busy" while a timed-out script is still running in the engine (the execution lease). Unknown tool names and thrown
errors are returned as `{error}` results; handlers never reject.

### 4.3 System prompt (`systemPrompt.ts`)

`DEFAULT_SYSTEM_PROMPT` (about 12 KB) sections: persona (CAD expert in a browser editor); "This editor's starting state" (an empty
root part already exists, never `part.create`); "How to work: scripts are the medium" (let the SOLVER lay out sketches,
compute in the script, not in your head, few substantial staged scripts, state persists, attach via `api.tree()`);
"Read before building" (plan first, fetch once: all method docs plus recipes in ONE `docs` call; `RECIPES_POINTER`;
`REFERENCE_IMAGE_POINTER`; `fetch_url` rules); "Ask, don't guess" (ask early, once, batched, with a default reading; a
sub-agent is NOT a substitute for the user); a 6-step workflow (understand, plan, checkpoint, execute, verify graded and
numeric, report); the buerli namespaces (`facade`, `structure`, `interaction`, `selection`, `geometry`); and important rules
(act in the same turn, look ids up, planeless sketches have a dead solver, prefer a native operation over delete-and-rebuild,
use `download` to export, read errors then check docs, `restore` instead of patching a broken state, parallel calls in one turn).

`buildSystemPrompt(config)` = `systemPrompt ?? DEFAULT` + `"## Additional Context"` + `extraContext` + `"## Method Index (v1)"`
(every method with a one-line summary, about 4.6k tokens, from `getMethodIndex()`) + `"## Document Index"` (every recipe and
guide, key and title, from `getDocIndex()`). So the model knows the whole surface from turn one and the cost is paid once per
conversation. `extraContext` is how an embedding app adds domain knowledge without losing the base expertise.

### 4.4 Context compaction and the ledger (`src/context/*`)

Premise: "the drawing is the memory". Because tree ids are stable and the engine can be re-read, they never ask the model to
summarise itself.

* **Annotate** (`annotate.ts`): every tool result gets `meta.ctx = {tool, kind, epoch, step, sig, digest, ops, failed, dead, stub}`
  with kind `reference` (docs, re-fetchable), `state-read` (tree, find, inspect, snapshot, read-only scripts: stale once geometry
  changes), `build` (changed the drawing) or `record` (reports, user answers, reference images, notes: never condensed).
  A drawing `epoch` advances with each batch that ran a mutating engine op (`ToolDiag.ops` from `onOperation`).
  `restore` / `load_file` mark everything built on the discarded timeline `dead` (`markDeadTimeline`) and append a host note
  to the result.
* **Decide** (`policy.ts`, `estimate.ts`): trigger from the provider's real `usage.inputTokens` plus a calibrated chars-to-token
  estimate (learned per model, `learnedTokensPerChar`), as ONE discrete event down to a target (so the sent prefix stays stable
  and provider prompt caches survive), preferring safe moments (a new user turn, or a round that only measured).
  Order, cheapest loss first: tier A zero-loss (rolled-back timelines, readings superseded by a newer one, readings from before the
  last change), tier B bulk (a build keeps its digest but loses logs and script source; old reports; docs replaced by a stub
  naming keys to refetch), tier C whole finished groups collapse. Never touched: user messages, reference images, each earlier
  turn's closing answer, questions to the user, latest sub-agent reports, last few groups.
* **Ledger** (`ledger.ts`, `digestTree.ts`): collapsed work is replaced by a **journal** (one line per step: digest, failures
  and rollbacks included, docs to refetch) and a **state block** generated from the LIVE drawing (features with ids,
  expressions, instances, constraints, from `readStructure`) plus the `notes` verbatim plus the last three measurements flagged
  "measured BEFORE later changes" when stale. No model call, so nothing drifts and it corrects what the model believes it built.
* **Render** (`render.ts`): stored history is never rewritten; providers receive a view with collapsed flags applied, and tool
  call / result pairing, thinking-block signatures and the first-message rule preserved.
* **Notice**: at a lower threshold a one-line host note is appended to the latest TOOL RESULT (not a user message, because a
  model may answer a user message in prose and end its turn): "context is about N% full, put your plan in notes".
* **Overflow** (`overflow.ts`): `isContextOverflow(err, fullness)` and `parseLimitFromError` learn the real window from the
  provider's error text; one hard compaction and one retry.
* The panel shows a divider "Context condensed" that expands to the exact ledger the model now sees.

### 4.5 Recovery nudges (bounded synthetic user messages, `meta.synthetic`)

| Situation | Response |
| --- | --- |
| Provider says `tool_use` but delivered no calls ("lost in transit", seen with a gateway) | Ask to re-issue; split a large script. Up to 8 times. |
| `stop_reason: max_tokens` before any call | Tell it to continue straight to the call. Up to 8 times (a separate, generous budget). |
| Text trails off mid-action (ends with ":" or last unterminated sentence states intent; end-anchored regexes) | "Proceed now, emit the tool calls". Up to 3. Deliberately end-anchored: an unanchored version impersonated user consent after the model asked a question. |
| Reference image build about to end without a judged mirror check | Mirror gate message (once). |
| Transient endpoint error | Retry 3 times with backoff. |
| Mid-batch crash | `closeOpenToolCalls` writes "interrupted, outcome unknown" results so history stays valid. |
| Iteration cap (40) | Returns history first, then an error event. |

### 4.6 Checkpoint, restore, notes

`checkpoint` = `v1.common.save({format:'OFB', encoding:'base64'})` stored app-side (never sent to the model), at most 5 labels per
drawing, oldest dropped. `restore` = clear plus reload; the result tells the model ALL later ids are stale. `notes` is a plain
string per drawing, rendered verbatim into the ledger state block. Together they let the model survive compaction and failed
multi-feature attempts ("a failed attempt then costs one restore").

### 4.7 Sub-agents (`delegate`, `runSubagent`)

* Personas in `SUBAGENT_PROMPTS`: `sketch`, `boolean`, `fillet_chamfer`, `assembly`, `analysis`, `perception`; any other name
  gets a generic specialist prompt. A sub-agent is a nested `runAgentLoop` with `depth + 1`, at most 20 iterations, the FULL base
  prompt plus the persona, the same tools minus `delegate`, `ask_user`, `fetch_url`, and the same drawing (so builders mutate
  the live model). Its final text is the report (capped at 12000 characters, a "record" in compaction terms). Open questions go
  in the report, since "no user is reachable at sub-agent depth".
* Same-response `delegate` calls run concurrently; the tool description tells the model to emit all goals in one response and
  not to delegate arithmetic ("a delegate per query pays LLM rounds for a for-loop").
* **`perception` is the exception**: NO base prompt, NO task context, it receives only images (`withImages` = the whole
  conversation's reference images, last 4; `withSnapshots` = last 2 renders) and ONE binary question. Its persona: answer
  strictly from pixels, name the evidence, say NOT ANSWERABLE FROM THE IMAGE for what a dimension means, what is hidden, how deep
  a bore goes. For the mirror check: forced choice of A or B, name the deciding feature, "never soften a mismatch". Images
  arrive in order: references first, then renders. The model is told never to route a user question to a delegate.
  It uses the same provider/model as the parent (no separate vision model is configured).

### 4.8 `ask_user`

Not a normal tool round trip: the loop writes a "delivered" tool result (to keep the tool-use protocol valid), emits the
question text as an assistant message, and ends the turn (`done`). The user's reply is the next user message. The prompt
requires batching with a best-reading default per question ("defaults ok" is a sufficient reply).

### 4.9 Reference images in the loop

`AgentPanel.tsx` `ingestFiles` reads image files with `FileReader` into base64 attachments (images go to the model as vision
blocks; text/code files up to 120000 characters are inlined into the message; other files are kept app-side and imported by
name with `load_file`). `runAgentLoop` builds a multimodal user message (text block plus `{type:'image', source:{type:'base64', media_type, data}}`
blocks), keeps `referenceImages` (history images from user messages and from tool messages tagged `referenceImage`, plus the new
ones, last 4), and arms the two gates. Images are never condensed. Comparison against the reference is performed only by the
perception sub-agent, using the A|B sheet; there is no automated image metric.

---

## 5. Providers, BYOK, keys and the panel

### 5.1 The provider contract (`types.ts`)

```ts
type LLMProvider = {
  chat(params: ChatParams): Promise<ChatResponse>            // system, messages, tools, max_tokens, model, reasoningEffort, signal, onDelta
  getCapabilities?(): Promise<{ models: ModelOption[]; defaultModel? }>   // id, label, contextLimit, maxOutputTokens, reasoningEfforts, vision, surface
}
```

The internal message format is Anthropic-shaped: `Message` = user (string or text/image blocks) | assistant (`text`,
`tool_use`, `thinking` with an opaque `signature`) | tool (`tool_use_id`, string or text/image blocks). `ChatResponse` has
`content`, `stop_reason` and normalised `usage {inputTokens, outputTokens}`. `McpToolSchema` is MCP-style (`inputSchema`),
so the same tool objects can be served over MCP or handed to a provider.

### 5.2 The five providers

| Factory | Wire format | Streaming | Notes |
| --- | --- | --- | --- |
| `createAnthropicProvider({apiKey, endpoint?, model?, headers?, thinking?})` (`provider.ts`) | Anthropic Messages | NO (single JSON response; `onDelta` unused) | Sends `x-api-key`, `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true`. Coalesces consecutive `tool` messages into ONE user message of `tool_result` blocks (Anthropic requires it). Thinking is opt-in at construction via a token budget (max_tokens is bumped above it); `reasoningEffort` is intentionally not mapped. Default model id is an old one, override it. No `cache_control` anywhere. `getCapabilities` calls `GET /v1/models`. |
| `createOpenAIProvider({endpoint, apiKey, model})` (`provider-openai.ts`) | Chat Completions | Always `stream: true` with `include_usage`, folded by `foldSse` into a non-streaming-shaped response | Tool results: images are NOT allowed in `tool` messages, so text goes in the tool message and the images are appended as a follow-up USER message with `image_url` data URLs. Tool schemas pass through `sanitizeJsonSchema`, which rewrites `type: [a,b]` unions to `anyOf` because Gemini rejects unions. Detects streams cut mid tool-call arguments and returns `max_tokens` so the loop auto-continues; a stream with no `finish_reason` is treated as a died upstream. Reads `reasoning_text` deltas as thinking. |
| `createResponsesProvider` (`provider-responses.ts`) | OpenAI Responses API | Streams only when `onDelta` is given; waits for `response.completed` | Used for GPT-5 family; reasoning summaries stream as `reasoning_summary_text` deltas; `reasoning.effort` mapped. |
| `createCopilotProvider({token})` (`provider-copilot.ts`) | Chat Completions via GitHub Copilot | stream | For Node contexts that already hold a Copilot session token. |
| `createAutoProvider({apiKey, endpoint, model?, headers?})` (`provider-auto.ts`) | OpenAI-compatible, routed | per sub-provider | Fetches `GET <base>/models` once (cached; cache cleared on failure so a later retry works), maps it with `mapModelsResponse` (`capabilities.ts`) into `ModelOption`s: `supported_endpoints` decides Responses vs Chat per model; if absent, a family guess (`/gpt-?5|codex/` goes to Responses) and Chat otherwise. Reasoning levels come from the endpoint's `supports.reasoning_effort` or a family heuristic (`reasoningEffortsFor`); `visionFor` guesses vision from the id (unknown = false, "never send images to a model that would choke"); non-chat model ids filtered by a regex. |

Format translation recap: the loop speaks Anthropic blocks; the OpenAI adapters convert `tool_use` blocks to
`tool_calls` (arguments JSON-stringified), `tool` messages to `role: tool`, images to a trailing user message; the Responses
adapter does the equivalent with `function_call` items; thinking blocks with signatures are preserved only for Anthropic.
Errors become `ProviderRequestError(status, body)` (`providerError.ts`) which the loop's overflow detector inspects.

### 5.3 Where the API key lives (the explicit answer)

**The library never stores a key.** A grep of `src` finds no `localStorage`, `sessionStorage` or IndexedDB use. The integrating
app passes `apiKey` into the provider factory (the README example reads it from a constant). The conversation itself is in
memory in a zustand store (`createAgentStore`, `store.ts`: `messages`, `rawHistory`, `usage`, `codeLog`, `compactions`,
`liveThinking`, `sendMessage`, `cancel`, `reset`), so reloading the page loses the chat, checkpoints and notes. There is no cost
or price handling at all: only token counts (`usage`, shown as a context-fullness ring), no per-call cost, no budget cap.

README stance on keys ("Production"): never ship API keys in the browser; point the provider at YOUR backend and authenticate
users there (a per-user session token as the provider's key and the endpoint set to the app's own gateway; the gateway verifies the
user, attaches the real key, forwards the body). Direct-from-browser calls to Anthropic work only because of the opt-in header.

### 5.4 The optional local proxy (`bin/copilot-proxy.mjs`, 37 KB, `npx copilot-proxy`)

* Purpose: a browser cannot call GitHub Copilot's API (no CORS headers, short-lived session tokens) and cannot fetch arbitrary
  web pages (CORS). The proxy listens on `127.0.0.1:8788`, runs a GitHub device-flow login (`copilot-proxy auth`), stores a
  `COPILOT_OAUTH_TOKEN` in `./.env.local`, refreshes the session token, rewrites bodies (e.g. `max_tokens` to
  `max_completion_tokens` for GPT-5 models), and forwards.
* `POST /v1/fetch {url}` (also `/fetch`): returns `{kind:'text', title, text, images[]}` or `{kind:'image', mediaType, base64}`.
  SSRF bounds: http/https, ports 80/443 only, GET only, 5 MB and 15 s caps, **every resolved address is checked at the socket DNS
  lookup** (private, loopback, link-local, CGNAT, multicast refused; defeats DNS rebinding), every redirect re-validated, no
  cookies or credentials, content-type allowlist. It cannot execute JavaScript, so client-rendered pages come back empty.
* CORS (`setCors`): reflects the request `Origin` back in `Access-Control-Allow-Origin` (or `*`), methods POST/GET/OPTIONS.
  There is no origin allow-list and no secret on the proxy. See section 9, surprise 6.

### 5.5 The panel and what the user sees (`AgentPanel.tsx`, 77 KB; `factory.tsx`)

`createCadAgent({provider, maxIterations?, maxTokens?, systemPrompt?, extraContext?, modelName?, contextLimit?,
reasoningEffort?, sendSnapshotsToModel?})` returns `{AgentPanel}`. `AgentPanel` props: `drawingId` (required), `open`,
`onClose`, `position` (`right | left | bottom`), `className`, `theme {bg, text, accent, userBubble, assistantBubble, width}`,
`extraContext` (per-mount override). The panel shows: a model picker (when `getCapabilities` returns 2 or more models) and a thinking-level
picker (only if the model has reasoning levels), a context ring (input tokens / context limit), a live reasoning ticker, tool
chips with status (`running | done | error`) and expandable details (script text with syntax highlighting, console, returned
value, tree views, snapshot thumbnails, download buttons), sub-agent cards (goal, number of images and snapshots handed over, summary),
compaction dividers, `ask_user` questions as assistant text, attachments via `+` (drag and drop), a Stop button, and a
`</>` "Source" panel that renders the session's `codeLog` as one runnable script with ids threaded into variables.
`UIMessage` = user | assistant | thinking | tool | subagent | compaction.

### 5.6 Trust and security model, stated plainly

| Topic | What they do | Consequence |
| --- | --- | --- |
| Key in the browser | Left to the host app; docs say don't ship keys, use a backend | A BYOK app that keeps the user's own key in `localStorage` is readable by any script on the origin (XSS, a malicious extension, a supply-chain compromise). |
| Model-written code | `runScript` compiles the model's JS with `new Function` and shadows `window`, `document`, `fetch`, `process`, `require` etc. README: "defense-in-depth against accidental use, not a security sandbox; the CAD API itself is the capability boundary" | A prompt-injected or malicious script can escape the shadowing (for example through constructor chains) and read storage. With a key in the same origin, that is key exfiltration. |
| Fetched web pages | `fetch_url` content enters the model context | Prompt injection vector; mitigated only by the bounds above and by a data-versus-instructions habit in the prompts. |
| Daemon (MCP) | Binds `127.0.0.1` only; refuses any request with an `Origin` header or a non-loopback `Host` (403, "no browser may drive it") | Good: a web page cannot drive the local daemon. |
| Share relay | Host proves identity with a signed ID token checked at the Worker; guests need a 122-bit random invite; relay stores nothing | Reasonable for sharing a session; roles (`edit`/`view`) are advisory, clients honour them. |

---

## 6. The MCP server (`packages/mcp`)

### 6.1 Tool list (registered in `src/tools/*.ts` and `src/mcp-server.ts`)

| Tool | Parameters (summary) | Notes |
| --- | --- | --- |
| `run_script` | `script`, `label?`, `timeoutMs` (1000..300000) | Async function body; `api.v1.*`, `api.tree()`, `api.graphic()`, `api.inspect.*`; strict mode; reports progress notifications per engine op; warns when a script "materialized" instances. |
| `snapshot` | `label, outDir, width, height, supersample, view, zoom, lookAt, layers, colors, section, sheet, lines, drawing, highlight, highlightAt, markers, sketchOverlay, annotate, xray, frame, recalc, source` | Zod schema in `snapshot.ts`; images inline. |
| `docs` | `keys[]` | bulk docs. |
| `list_methods` | `domain?, search? (string or array), withSummaries?, limit?` | Array form returns one ranked group per concept. |
| `describe_method` | one key, fuzzy | |
| `tree`, `find`, `inspect` | `refresh?`; `class?/name?`; `id` | cached structure tree. |
| `clear`, `save`, `load` | `save {format: STP, STL, GLB, OFB, ..., path}`; `load {path}` | export formats limited by the account's plan. |
| `checkpoint`, `restore` | `label` | |
| `view` | | opens/brings back the docked GUI (or a read-only 3D view). |
| `get_selection`, `set_selection` | | the human's selection and "agent pointing". |
| `share` | | mint/stop invites; relay links. |
| `login`, `account`, `session_info`, `use_session` | | sign-in, plan, which engine is in use. |

Open (no sign-in needed) tools: `login`, `session_info`, `list_methods`, `describe_method`, `docs` (`auth.ts` `OPEN_TOOLS`).
Everything else goes through `requireSignIn()`, which patches `registerTool`. Similar patches exist for `serializeTools`
(queue), `attachViewer`, `attachShare`.

The server `instructions` returned at MCP initialize contain: the sign-in note, the app/viewer note, `serverInstructions()` =
"run_script is the ONLY way to execute", plan-first-fetch-once, `RECIPES_POINTER`, "REFERENCE IMAGES: ...", engine policy
notes, own-app notes, the daemon note, then the FULL method index and document index. So any MCP host gets the entire surface
at turn one (about 5k tokens).

### 6.2 One daemon per machine (`src/daemon.ts`, `src/server.ts`)

* Each host starts `classcad-mcp` over **stdio**. That process is a **shim**: it probes `127.0.0.1:9097/health`, starts the
  daemon if absent, then forwards JSON-RPC to it over the MCP Streamable-HTTP transport (`POST/GET/DELETE /mcp`, session id in
  `mcp-session-id`).
* The daemon keeps ONE `McpServer` instance PER MCP SESSION (per Claude tab): own engine client, caches, tool queue, invites.
  It also owns the single listener (`127.0.0.1:9098`, `share/server.ts`) on which GUIs dock into sessions; "a listening port
  belongs to exactly one process", which is why a daemon exists. Idle timer exits it when no sessions and no page offer one.
* HTTP surface: `GET /health`, `POST /shutdown` (409 while sessions are active; `?drain=1` stops accepting and exits when
  drained). If 9097 is held by something that isn't a daemon, the shim serves in-process on a free port and says so on stderr.
* `src/queue.ts`: **tool calls are serialised** per drawing (the MCP SDK dispatches concurrently, hosts issue parallel calls,
  sub-agents share the process). Exempt: pure lookups (`list_methods`, `describe_method`, `docs`, `session_info`, `view`,
  `share`, `account`). Failed calls never block the queue; a busy-lease from `runScript` makes drawing tools refuse new work.

### 6.3 Engine launch and sessions

* Engine policy `auto | drogon | wasm` (`EnginePolicy`): `auto` uses a `classcad-cli worker` over WebSocket
  (`CLASSCAD_WS_URL`, default `ws://localhost:9094/`) when reachable, else the **local WASM engine**: `engine/wasm.ts` downloads
  the release assets once (about 16 MB compressed, 85 MB unpacked: glue JS, main `.wasm`, three side modules, class file, filter
  config) into a per-version folder under the user's home and runs them in a Node `worker_threads` Worker
  (`engine/wasm-worker.ts`). One engine = one drawing = one MCP session.
* Licensing: the engine will not start without a **key** that the vendor's backend issues for the signed-in account
  (`engine/key.ts`: cached on disk until shortly before expiry, renewed ahead, a still-valid cached key starts the engine offline;
  CI uses a secret access token env var; a bring-your-own key env var exists). Keys name the origin `localhost`. The plan gates
  commercial use and export formats. (We have no equivalent need: our kernel is ours.)
* Lazy start: nothing is opened until the first tool call, "so an idle session costs nothing".
* `run_script` suppresses graphic emission for the duration of ONE script (`GetEmissionConfig` then `SetEmissionConfig`
  suppress then restore), then does ONE `client.pull()` so a docked GUI and the caches catch up. That is how a 100-command script
  stays cheap.

### 6.4 GUI docking and sharing (`src/share/*`, `src/viewer/*`, `packages/relay`)

The vendor GUI app docks into the MCP's session: the user rotates, selects and edits the same model the agent builds. Protocol
frames are those of the vendor's server (`share/protocol.ts`) plus presence channels (`client`, `selection`, `select`, `config`,
`leave`; frames capped at 8 KB). `get_selection` / `set_selection` expose the human's selection and let the agent point.
For remote guests the MCP dials OUT to the Cloudflare relay (`wss`, host proves identity with a bearer ID token), the relay
(one Durable Object per invite, hibernating WebSockets) forwards frames and stores nothing; guest count capped by plan (17 max),
1 MiB limit before the host meets a guest. A read-only three.js `viewer/` exists as a fallback when no GUI app is bundled.

### 6.5 Connecting hosts

README gives configs for Claude Code (plugin: `claude plugin marketplace add awv-informatik/classcad-ai` then
`claude plugin install classcad@classcad`; or `claude mcp add classcad --scope user -- npx -y @classcad/mcp@latest`), Claude
desktop (own JSON config, no PATH so absolute npx), Codex (`config.toml`), VS Code Copilot (`servers` key and `"type":"stdio"`),
Cursor, OpenCode, Windows via `cmd /c npx`. Plugin manifests: `plugins/classcad/.claude-plugin/plugin.json` (name,
displayName, version, author, keywords, links) and `.claude-plugin/marketplace.json`.

---

## 7. The skill package (`packages/skill`)

### 7.1 Registry generation

`scripts/build-registry.mjs` walks the vendor's `@classcad/api-js` `.d.ts` files with the TypeScript compiler API and emits
`method-registry.json`: `{ "v1.<domain>.<method>": {domain, method, summary, params[{name,text}], deprecated?} }` from the JSDoc
of each method. The script's own header says "a purely mechanical extraction... no AI involved". 264 methods in 7 domains
(part 76, assembly 63, sketch 50, common 22, curve 21, solid 21, drawing2d 11). Consumers use it to (1) build the `api.v1`
object, where unknown names **throw immediately with edit-distance suggestions** (`"v1.part.bxo" Did you mean: box?`),
(2) list/search, (3) append parameter signatures to error messages. `scripts/build-bundle.mjs` flattens all markdown under
`references/` and `recipes/` into `bundle.json` (key = path without extension, about 1.8 MB) so a browser agent has the whole skill
without a filesystem. `scripts/copy-api-docs.mjs` copies source API docs; `build` = copy then registry then bundle, then a
snapshot test.

"Verified against a live engine" applies to the **per-method docs** (`references/<domain>/<method>.md`), written by running real
calls and recording failure modes ("silent no-ops", "doc discrepancies"), not to the registry itself. There is no automated
conformance run of the docs against an engine in the package; what is automated is the **snapshot suite**
(`test/snapshot.mjs`, baselines in `test/snapshots/`): registry, indexes, prompts, every document's size/hash/headings, `describeMethod`
for every method in several spellings (full key, no `v1.`, lowercase, bare, one-letter typo), `searchMethods` for every method
name/synonym/vocabulary word, `searchDocs`, and `bulkDocs` paging/budgets. Any diff fails the build; intended changes are
re-baselined with `npm run test:update`. `scripts/test-discovery.mjs` holds unit tests; the root has `scripts/release-check.mjs`.

### 7.2 Doc format

Per-method doc (e.g. `references/part/calculateMassProperties.md`): title `domain.method`; a one-sentence description;
**Key Parameters** (with accepted id types and what each does); **Return Value** (exact shape, including where the doc and
the engine disagree: "`cog` is an object, NOT an array"); accuracy numbers; **Gotchas** (the high-value part: failure modes the
engine reports as success); **Common Errors** (a table of message, code, cause, fix); **Working Example** (runnable). Domain
overview docs in `references/api/*.md` hold signatures. Topic docs `DATA`, `STRUCTURE`, `GRAPHICS` define what `api.tree()` and
`api.graphic()` return (stable vs payload-local ids, selection idioms).

### 7.3 Recipes (eight files, not six)

| Key | Subject |
| --- | --- |
| `recipes/verification` | Mandatory in every build fetch. Two regimes (numeric, perception), the final gate (section 2). |
| `recipes/constrained-sketching` | Default path for ANY dimensioned input: classify drawing, dimension checklist, constraints plus dimensions so the solver lays out the sketch, plane mappings (Front local y is world -Z), arc direction computed not intuited, trimming, evaluation. 45 KB. |
| `recipes/clean-construction` | Every assembly and multi-part model: one template per distinct shape, one feature per operation, design values not coordinates, no scaffolding mates, never measure an instance, audit script gates delivery. |
| `recipes/parametric-part` | Expressions plus regeneration across features. |
| `recipes/assembly-parameters` | Values shared by several parts (assemblies host no expressions; parameter part plus refresh). |
| `recipes/pattern-then-subtract` | N cutouts around an axis: one seed, one merged pattern, one subtraction. |
| `recipes/direct-modeling-eif` | One-shot solids WITHOUT a dimensioned reference (never for drawing reproduction). |
| `recipes/buerli-app` | Turn a model into the user's own web app. |

`RECIPES_POINTER` (in `prompts.js`) is the router: "Pick the build recipe by the INPUT, not the verb". Recipes "encode the composed
workflow WITH its pitfalls: imitating them is faster and safer than composing from method docs."

### 7.4 Search: BM25F with CAD synonyms (`discovery.js`)

* `OP_SYNONYMS` is a plain object of about 45 hand-written entries, each mapping a word to a short list of related words. It
  is not symmetric by construction; entries are written both ways where needed. Examples: `split -> slice, cut, divide, section,
  bisect, separate`; `hole -> bore, drill, cut, pocket, subtract, boolean, cylinder`; `round -> fillet, blend`; `extrude -> pad,
  protrusion, boss, extrusion`; `revolve -> lathe`; `hollow -> shell, thin`; `measure -> bounds, distance, length, volume, mass,
  inspect`; `tag/label/attribute/metadata -> userdata`; `step -> stp, save, export`; `bounds -> boundingbox, extent, size`.
  Exported as `SEARCH_SYNONYMS` and snapshot-tested.
* `buildMethodBM25`: BM25F over three fields: method name (weight 2), summary (weight 1), and keywords harvested from the
  method's skill notes (`notesKeywords`), with per-field length normalisation, k1 = 1.2, saturated once, IDF per word. Tokenisation:
  `splitWords` (camelCase split), `stem` (plurals folded), stopwords.
* Query handling: `expandSearchTerms` adds synonyms; direct words count fully, synonym hits count half (a query word counts as
  "covered" when it matched itself (1) or only through a synonym (0.5)); an array query yields one ranked group per entry so a broad
  concept cannot crowd out the rest; a group note flags entries that look like workflows rather than methods. On zero hits the
  message says "synonyms tried. Do NOT assume the operation doesn't exist".
* `searchDocs` ranks recipes/guides by title, headings and text with the same expansion; `list_methods` with a search returns
  matching documents too (so "shared parameters assembly" finds `recipes/assembly-parameters`).
* `describeMethod`/`resolveMethod`: fuzzy single-key lookup (bare names resolve, ambiguity lists candidates, typos get
  suggestions via `editDistanceAtMost`). `DOC_ALIASES` redirect historical keys.

### 7.5 How the model is steered to use the tools

1. The method index and document index are in context from turn one, so the model picks methods directly (the prompt says "do
   not default to list_methods").
2. `docs` is the primary doc tool: "PLAN FIRST, THEN FETCH ONCE", up to a key cap per call, recipes first, always
   `recipes/verification`, and "DATA" whenever a script reads `api.tree()`/`api.graphic()`. A response budget (about 160k
   characters in the agent) returns what fits and lists "NOT included yet" keys at the TOP to request next. Large docs page as
   `key#2`.
3. `list_methods` is for filtering and for concepts (array form), and for reflected non-v1 namespaces in the browser.
4. After context condensing, docs are replaced with a stub naming the keys to refetch, and the ledger repeats "REFETCH before
   building on any of them".
5. `run_script` error messages for typos carry suggestions; the engine error text carries parameter signatures from the registry.

---

## 8. Design for OUR system

### 8.1 What we already have (read from our repos)

| Need | Already exists | Where (ours) |
| --- | --- | --- |
| Script medium producing a normal feature tree | `@kit/script`: `evaluate(code)` records steps, `runScript(code, host)` applies `EditOp`s via a `ScriptHost {load, edit, geometry}`; fuel-limited loops, denied globals, 40000 char / 2000 step caps, line-numbered errors, `variables()`/`expr()`, selectors `face()/edges()` | `packages/script/src/run.ts`, `recorder.ts`, `selectors.ts`; doc `docs/scripting.md` |
| Kernel session API + MCP skeleton | `open`, `guide`, `schema`, `threadData`, `profiles`, `checkProfile`, `read`, `edit`, `query {validate, heal, massProps, step, describe}`, `resolve`, `check`, `verify`, `render`, `close` | kernel repo `packages/session/src/mcp-server.ts`, `packages/mcp.mjs` |
| Verify loop | `verify`: regen + validate + check expectations, errors pointed at the smallest responsible feature id and field | `packages/driver/src/verify.ts` |
| Numeric truth | `massProps` (exact on analytic geometry, per body, inertia), `validate`, `check {volume, bbox, counts, valid}`, `measure`, `interference`, `describe`, `resolve` with persistent face/edge names, design-rule `checkProfile` | kernel `ck-server`, `ck-ops` |
| Reference stability | `refDiff` ("a delete/reorder/edit silently re-pointed a reference") | `ck-wasm/src/refdiff.rs` |
| 2D projection with hidden lines, sections, hatch | `drawing {views:[{name or x,y,section:{point,hatch}}], hidden}` returns per view polylines of kinds edge `e`, outline `o`, tangent `t`, hatch `h`, with a visibility flag; the section is done by boolean-cutting with a half-space tool and reading the `SEC.*` faces | `ck-ops/src/drawing/*`, `docs/drawing-parity.md` |
| Headless raster | `renderMesh` PNG with highlighted face chips and a legend mapping chips to persistent face names; views iso/front/top/right only | `packages/render/src/render.ts` |
| GUI section view + cap | `Viewport.setSection({normal, offset, flip})`, stencil cap | `packages/viewport/src/section*.ts`, `docs/inspect.md` |
| Drawing sheet UI | SVG sheet, title block, dimensions (app data) | `apps/cad/src/drawing/`, `docs/drawings.md` |
| Inspect tools | mass props card, measure, section, interference | `apps/cad/src/inspect/` |
| Diagnostics for chat | `diagnose(errors, features)` groups regen errors by root cause | `apps/cad/src/errorSummary.ts` |
| Design checks | printable/CNC/moulding profiles | `docs/design-checks.md` |

So the gap is smaller than their stack: we have the kernel's numeric truth, the script compiler, and a verify tool. What we lack
is the model-facing shell: a snapshot/section/probe family, an agent loop with gates, a provider layer, a doc/search layer for the
script API, and the "attach to an edited document" script mode.

### 8.2 Mapping, piece by piece

| ClassCAD AI piece | Our equivalent | Status | Build |
| --- | --- | --- | --- |
| `@classcad/skill` registry + docs + recipes + BM25 | Generated registry of our script API (from the recorder's builder methods and the feature schema, same idea as their JSDoc extraction) + `guide` + recipes (bracket/revolve/shell/pattern/holes/thread/sketch-on-face, drawing reproduction, verification) + BM25 with a CAD synonym table (copy the idea, write our own table: hole/bore/drill, round/fillet, pad/extrude, ...) | `guide` and `schema` exist (single blobs); no search, no registry | New package `@kit/knowledge` |
| `@classcad/script` `runScript` | `@kit/script` `runScript` | Exists. Differences: theirs mutates a live session step by step and returns values, ours records a plan and applies it atomically | Add `attach` mode and `return` values (8.5) |
| `api.inspect.*` | kernel `query`/`resolve`/`describe` | Exists, stronger (persistent names) | Surface in script as `inspect.*` |
| `@classcad/renderer` | Kernel `drawing` request (vector) + `@kit/render` (shaded raster) + viewport (three.js) | Partial | New `@kit/snapshot` (8.4) |
| `snapshot` tool | `render` tool, extended | Partial | 8.4 |
| `mcp` daemon, engine, queue | `packages/mcp.mjs` over `Session` and a worker | Skeleton | Add tools; the single-daemon design only when the GUI docks (phase 5) |
| `buerli-ai` agent loop | Browser app agent in `apps/cad` | None | Port the loop design, simplified (8.3) |
| `perception` sub-agent and gates | Same, as host code | None | 8.3 |
| Providers | `LLMProvider` with the same shape | None | 8.6 |
| `AgentPanel` | Preact panel (TS, Preact) | None | 8.3 |
| Share relay, plan/key licensing, vendor GUI embedding | Not needed now | skip | skip |

### 8.3 The agent loop for our app: image plus chat to part, then GUI edits

Their loop is a good template; take these ideas and simplify where our substrate is stronger.

**Substrate difference that simplifies us.** Our source of truth is a JSON part document (feature list, variables, persistent
names), not an opaque engine session. Consequences:
* `checkpoint`/`restore` = keep the previous document (cheap, unlimited, and the undo stack already exists).
* The compaction "state block" = a digest of the document (feature list with ids, variables, bbox, volume, last errors), no
  engine round trip.
* A script is an atomic plan: `evaluate()` then one `edit` batch, so a failed script leaves the document unchanged (their
  scripts mutate step by step and need `restore`).

**How a chat turn with images maps to run_script plus a snapshot loop.**

```
user: images + text
  1. panel attaches images -> user message with image blocks (cap size: downscale to <= 1568 px long edge, JPEG/PNG)
  2. [gate P] perception: fresh vision calls, one question each, parallel, image only, no CAD context
        -> answers go into a "reference record" in notes (frozen)
  3. (optional) ask_user if undecidable, batched, with defaults
  4. docs/list_methods for the script API (index already in the system prompt)
  5. run_script(code)      -> {ok, features, errors:[{line,feature,message}], volume, bbox}   (as designed in scripting.md)
  6. verify({expect})      -> regen + validate + check (volume/bbox/counts/valid) with repair hints
  7. snapshot(...)         -> matched views vs the reference; drawing style; section when internals matter
  8. [gate M] mirror check: sheet [matched view, mirrored azimuth] + reference -> fresh vision call, forced A|B
  9. loop 5..8 on failure (bounded), else report numbers + show the render
```

The produced part is a normal document: the script goes in as `document.script` (the kit already records the source in the
document) and the features land in the feature tree, so the user can immediately drag handles, edit a sketch or change a
variable in the GUI. Variables from `variables({...})` appear in the Variables tab: this is the "parametric by default"
promise (their equivalent is the recipe "design values, not coordinates").

**Continuing after GUI edits (the real gap).** Today `runScript` always creates a NEW untitled part. A conversation needs three
modes and the model must be told which one it is in:
1. `build` (new part), as today;
2. `edit` (attach): the model first calls `read` (document JSON: features, variables, names) and then emits **edit ops**
   (`add/set/remove/move/replace` exist in the kernel `edit` tool) or a short script written against the CURRENT document
   (`part.current()`, `feature('Hole1').set({diameter: 9})`, `after('Hole1').fillet(...)`). Do not replay the old script, it no
   longer describes the document once the user edited it;
3. `rebuild` (regenerate the whole script, only if the document still equals the script's output: keep a content hash of the
   document produced by the script, and compare it).
Since their model also persists state between scripts ("follow-ups ATTACH via api.tree(); never part.create twice") the
analogue is attach mode with persistent names from `resolve` instead of tree ids.

**Gates in code** (copy the mechanism, not the text): `hadReferenceImages`, `perceptionDelegated`, `geometryWasBuilt`,
`mirrorJudged`, each firing once per turn; reference images tracked across turns (last 4); images never compacted. Add one gate
of ours: *no completion claim without a `verify` call after the last edit* (cheap, deterministic, they only have prose for it).

**Sub-agents.** Start with exactly one: `perception` (stateless vision call, no tools, one question). Skip `sketch/boolean/...`
personas: their value is context isolation, which we get cheaply from small scripts. Add `analysis` later if needed.

**Context.** Phase 1 needs none. Later: tier A/B of their policy (dead timelines, superseded readings, script source elision)
plus a ledger built from the document digest. Copy the idea "one discrete event, preserving a stable prefix" because it
protects prompt caching (they never use explicit `cache_control`, we should).

**`ask_user`.** Same semantics (ends turn, reply is next message), rendered as a card with the default answer pre-filled.

### 8.4 Verification toolkit and the kernel API for sections and slices

Our checks already beat theirs on exactness. Missing: images that are comparable to a reference, numeric sections, probes.

#### 8.4.1 Numeric checks (keep, expose, extend)

| Check | Request / tool | Gate use |
| --- | --- | --- |
| Regen errors, validity, expectations | `verify` | Must pass before `done` (our extra gate) |
| Mass properties | `query massProps` | Compare with volume computed in the script from design math; delta after each cut (their sheet-body trap is not ours, but a silent no-effect cut is) |
| Faces and edges facts | `describe`, `resolve` (persistent names) | Orientation facts of the reference record, proved by position and normal |
| Bounding box and extents | `check {bbox}` | |
| Design rules | `checkProfile` | Optional "manufacturability" pass |
| Reference stability after edits | `refDiff` | After any chat edit to an already-edited document: warn if a reference re-pointed |

#### 8.4.2 New kernel request: `section`

Purpose: the numeric counterpart of their image section, and the building block for the renderer, wall-thickness checks and
volume cross-checks.

```jsonc
// request
{ "type": "section",
  "plane":  { "origin": [x,y,z], "normal": [x,y,z], "xdir": [x,y,z]? },   // xdir fixes the in-plane u axis (default: from normal)
  "bodies": ["Body1"]?,           // default all
  "chordTol": 0.01,               // polyline sampling of curved edges, model units
  "arcs": true }                  // also return exact circle/arc primitives where the cut is analytic
// reply
{ "plane":  { "origin":[...], "u":[...], "v":[...], "normal":[...] },
  "regions": [                    // 2D, in (u,v) of the plane, mm
     { "body": "Body1",
       "area": 1234.5, "perimeter": 210.2, "centroid": [u,v],
       "outer": { "closed": true, "pts": [[u,v],...], "edges": [ {"kind":"line|arc|polyline","p0":[..],"p1":[..],"centre":[..],"r":..,"face":"F12"} ] },
       "holes": [ { same shape } ] } ],
  "bbox": { "min":[u,v], "max":[u,v] } }
```

Implementation hint (cheap given what exists): `ck-ops::drawing` already cuts a body with a half-space tool and finds the `SEC.*`
faces (`view_json`, `plane_tool`, `cutNoEffect` on a missed plane). `section` = same cut, then for each `SEC.*` face take its
loops as exact curves (the cut faces are bounded by plane-surface intersection curves, which are analytic for planes, cylinders,
cones, spheres, tori), sample at `chordTol`, project to the plane's (u,v), classify loops into outer/hole by containment and
orientation. This is EXACT (their image uses mesh crossings) and survives booleans. Return `ok:false, code:"planeMissesBody"`
instead of `cutNoEffect` so a missed plane is not silent (their `part.slice` gotcha). Estimated 2 to 3 days in the kernel.

Companion request, **`sections`** (a series): `{plane family: origin, normal, offsets: [o0..on] or {from,to,count}}` returns per-slice
`{offset, area, perimeter, centroid, regionCount}` without geometry (an option `geometry:true` adds loops). Uses:
* **independent volume check**: integrate area over the offset (Simpson) and compare with `massProps` volume (agreement to the
  sampling error); disagreement means a bad solid. It is a genuinely different computation path from the divergence-theorem volume.
* **wall thickness / minimum feature along an axis**: from the region widths.
* **constant-section detection** (extrusion vs revolve): constant area along z.

Companion request, **`probe`**: `{rays:[{origin, dir}], points:[...]}` returns for points inside/outside/on (with distance to the
nearest face and its persistent name) and for rays the ordered list of material intervals `[t_in, t_out, faceIn, faceOut]`.
This is the "material/void sequence along a line" observable that their recipe needs for pre-registered mirror hypotheses ("which
side is the slot on": intervals along a ray crossing the slot), but as data, not eyeballed pixels. `ck-ops/contain.rs` and `bvh.rs`
already exist for point containment and ray queries. 2 days.

#### 8.4.3 Renderer: `@kit/snapshot` (browser SVG/canvas and headless)

Principle: ONE pure function from `(kernel replies, options)` to either an SVG string or an RGBA buffer, runnable in the browser
and in Node, deterministic, no camera state. Two back ends:

* **Drawing style (vector, primary for verification).** From the kernel `drawing` reply (`e/o/t/h` polylines with visibility)
  build SVG: visible solid, hidden dashed, section hatch, tangent lines thin. This is exactly the "technical drawing" their
  renderer derives from the mesh, but we get it from the kernel (exact edges, silhouettes, hidden lines, hatch) and SVG gives
  free dimension text, markers and labels. Needed:
  * all six ortho views plus `{azimuth, elevation}` (`drawing` takes `x,y` frame vectors; we compute them);
  * **first-angle / third-angle layout**: place the front, top and side views of one shared scale per ISO 5456-2 (front at centre,
    first angle: top below front, left-side view right of front; third angle: top above, right-side view right), plus an iso in the
    free quadrant, plus the projection symbol. Pure layout code (about 150 lines) around `drawing` calls;
  * **section views**: `drawing` with `section:{point,hatch}` per view, cutting plane indicator "A-A" and view label;
  * **markers**: cross + label at a world point projected with the same frame; `annotate`: extents text, scale bar;
  * **A | B sheet** of two views for the mirror check (labelled panels, same scale);
  * stable `frame` (scale and centre) returned and acceptable as input.
* **Shaded style (raster).** Keep `@kit/render` for headless (extend `ViewName` to all six plus az/el, add `frame`, `section`
  clipping via per-triangle plane clip plus cap from the new `section` loops, `highlightAt`, markers, x-ray optional) and the
  three.js viewport in the GUI (`setSection`, highlight, markers already). In the browser use `canvas.toBlob` / `OffscreenCanvas`;
  headless use the existing PNG encoder. For SVG-to-PNG (needed to hand drawing-style images to a vision model) use the browser
  canvas (draw the SVG into an `<img>` then canvas) and `resvg-wasm` in Node.
* **Pixel diff.** `diffImages(a, b, {tolerance})` is 40 lines and is a direct port (RGBA compare with a pinned frame; result
  `{changed, fraction, bbox, visualisation}`). Wire it where they do not: a `diff` tool and use it for (1) before/after of a chat
  edit ("did the edit change only what I intended": bbox of changed pixels vs the feature's expected region), (2) regression
  across sample parts in CI (our golden images). Do NOT use it for reference-vs-render; for that, vision plus numbers.
  A better-than-pixels comparator for drawings: compare **vector** projections (the `drawing` polylines of two states) by
  Hausdorff distance, tolerance-aware, no antialiasing noise; the pixel diff stays as the visual explanation.

Option set for the model-facing `snapshot` (superset-compatible with theirs so skills transfer): `view | azimuth/elevation`,
`style: 'shaded' | 'lines'`, `drawing: 'first-angle' | 'third-angle'`, `sheet`, `section {origin, normal, cap?}`, `markers`,
`highlight`/`highlightAt`, `annotate`, `xray`, `frame`, `width/height`, plus `outDir`. Return: image block(s), `frame`, `saved path`,
and the `bbox` of the model in the view so the model can map pixels to mm (scale = mm per pixel is reported explicitly; their
model has to infer it from the scale bar).

How to measure dimensions on a section (the thing their stack leaves to the model's eyes): use `section` data, not pixels:
wall thickness = distance between two parallel loop edges along a chosen ray (`probe` intervals), bore diameter = the `arc`
primitive's `r`. Then place a **marker** or a dimension label at the measured points in the section image so the human and the
vision model see the same number.

#### 8.4.4 What the gate for reference images becomes in our stack

| Their gate step | Our version |
| --- | --- |
| Reference record in `notes` | Same; stored in the document's metadata (`document.notes`), shown in a side card the user can edit |
| Perception readers | N parallel stateless vision calls with images only, single question each (host-enforced) |
| Matched-view renders | `snapshot` with the reference's view; for multi-view drawings `drawing: <method>` in lines style |
| Mirror check A \| B | Same sheet, same forced choice, same host gate. Add a **numeric** twin: `probe` ray along the asymmetric axis through the feature, compare interval order with the record |
| Record replay | `resolve`/`describe` assertions generated from the record (face at position X has normal Y) |
| Second reading | Same, as a prompt step |
| Section for internals | `snapshot {section}` for humans plus `section`/`sections` numbers for the model |

### 8.5 The script layer, concretely

* Keep `evaluate()` + atomic apply. Make `runScript` return `{ok, features, errors, returned, logs, volume, bbox}`; add `console.log`
  capture and a `return value` (size-capped, explicit truncation marker, as theirs).
* Add `attach` mode: `part.current()`, `feature(name)`, `after(name)`, `set()`, `remove()`, `rename()`, `variables.set()`.
  Errors keep `Line N` and the feature id (already so).
* Sandbox: `new Function` with shadowed names is not a sandbox (theirs says so too). For an app that holds an API key, run model
  scripts inside a **sandboxed iframe or a dedicated Worker whose CSP has `connect-src 'none'`** and which has no access to the key
  store; only `evaluate()` (pure recording of steps) needs to run there, since the recorder builds data and the host applies it.
  That is cheap for us because evaluation does not touch the kernel (their scripts do, so their escape is worse).
* Generate the API doc/registry from the recorder (`makeApi`) so docs cannot drift, and keep a test that every documented example
  runs (the BenchCAD examples in `docs/scripting.md` already work this way).

### 8.6 Provider layer (BYOK) for a browser app

Interface: adopt theirs almost verbatim (it is small and proven): `chat({system, messages, tools, max_tokens, model, reasoningEffort,
signal, onDelta}) => {content, stop_reason, usage}`, optional `getCapabilities()`, internal Anthropic-shaped blocks, adapters for
Anthropic Messages and OpenAI-compatible Chat Completions/Responses. Improvements to make from day one:
* **Streaming for every adapter** (theirs: Anthropic non-streaming), with partial tool-call JSON assembly and a cut-stream
  detector (they have one for OpenAI).
* **Prompt caching** for Anthropic: `cache_control` on the system prompt, the tool list and the last stable user message
  (compaction as "one discrete event" preserves the prefix; they never mark it).
* **Cost and budget**: parse usage including cache read/write tokens, price table per model id in config, per-turn and per-session
  cost shown in the panel, hard budget stop. They have none.
* Capability discovery from `/models` (`getCapabilities`) as in `createAutoProvider`; conservative vision guess.
* Normalised errors with status and a context-overflow detector; bounded retries with backoff for 429/5xx.
* Image handling: downscale references to about 1568 px long side before sending (keeps tokens bounded); tool results with images
  only on models with `vision`.

Key storage options, evaluated:

| Option | Safety | Convenience | Verdict |
| --- | --- | --- | --- |
| `localStorage` plain | Readable by any script on the origin, extensions, XSS, any supply-chain compromise; persists | Best | Acceptable ONLY with: no third-party scripts, strict CSP, model scripts isolated (8.5), and a clear "stored in this browser" notice. Opt-in "remember". |
| In-memory only (session) | Gone on reload; same XSS exposure while open | Re-enter each visit | Safe default |
| `localStorage` encrypted with a passphrase (WebCrypto PBKDF2 + AES-GCM) | Protects against disk/profile theft, not against live XSS | Passphrase on each load | Good middle option |
| Local proxy on 127.0.0.1 holding the key (their copilot-proxy pattern) | Key never in the page; page talks to loopback | Extra process | Recommended for power users, but must be hardened (below) |
| MCP route (Claude Code / Codex drive our MCP server) | No key in our app at all; the user's agent subscription does the thinking | Needs the agent host | Recommended first path: ships with phase 2 |
| Our backend proxy | Key never in the browser | We run a service and pay/handle abuse | Only if we ever offer a hosted plan |

Recommendation: (1) first-class support for the **MCP route** (no key anywhere in our code); (2) browser BYOK with **session-only
default** and an opt-in "remember in this browser, encrypted with a passphrase"; (3) provider calls direct from the browser to
Anthropic (header `anthropic-dangerous-direct-browser-access`) and to OpenAI-compatible endpoints that allow CORS; (4) an optional
local proxy for endpoints without CORS, with an **origin allow-list and a random per-install bearer token** (their proxy reflects
any Origin and has no secret, so any website the user visits can use the user's Copilot session and the fetch endpoint from the
browser: do not copy that); (5) never send the key anywhere but the provider host; show the destination host before the first
call; (6) isolate model-written code from the key store (8.5); (7) a CSP with `connect-src` limited to the provider hosts and our
own origin when the app is deployed.

### 8.7 MCP tool list for our server

Existing: `open`, `guide`, `schema`, `threadData`, `profiles`, `checkProfile`, `read`, `edit`, `query`, `resolve`, `check`, `verify`,
`render`, `close`.

Proposed final set (names kept short, schemas in Zod, all drawing tools serialised through one queue like their `queue.ts`):

| Tool | Purpose | New? |
| --- | --- | --- |
| `docs`, `list_methods` | bulk docs and BM25 search of the script API, features, recipes (replaces the single `guide` blob; keep `guide` as the first doc) | new |
| `run_script` | `{code, mode: build \| edit, session?}`: evaluate plus atomic apply; returns `{ok, features, errors, returned, logs, volume, bbox}` | new (designed in `scripting.md`) |
| `edit`, `read`, `resolve`, `describe` | as today | exists |
| `verify` | regen + validate + check | exists |
| `snapshot` | image(s) per 8.4.3 incl. `section`, `drawing`, `sheet`, `markers`, `frame` | replaces `render` |
| `section` | numeric section regions (8.4.2) | new kernel + tool |
| `sections` | slice series: area/perimeter/centroid, volume cross-check | new |
| `probe` | points and rays: inside/outside, material intervals, face names | new |
| `diff` | pixel and vector diff of two snapshots or two documents | new |
| `query` | validate, heal, massProps, step, describe | exists |
| `checkpoint`, `restore` | document-level, unlimited | new, trivial |
| `notes` | reference record and plan, stored in the document | new, trivial |
| `export` | STEP/STL/GLB to a path (`query step` exists) | small |
| `get_selection`, `set_selection`, `view` | GUI docking later | phase 5 |
| `ask`-equivalent | not needed over MCP (the host agent talks to the user) | skip |

Server `instructions` at initialize should carry the API index and the recipe router pointer, as theirs does.

### 8.8 Phased build order and estimates

Estimates are focused-engineer days including tests; they assume the kernel team is us.

| Phase | Deliverable | Depends on | Days |
| --- | --- | --- | --- |
| 0 | Decisions: tool schemas, `section`/`probe` JSON schemas, option set of `snapshot`, document `notes` field | | 1 |
| 1 | **Kernel numeric tools**: `section` (exact), `sections` (series, volume cross-check test), `probe` (points, rays) | existing boolean cut + `SEC.*`, `contain.rs`, `bvh.rs` | 5 |
| 2 | **`@kit/snapshot`**: drawing-style SVG from `drawing` (all views, hidden lines, section view with hatch, first/third-angle layout, markers, annotate, A \| B sheet, `frame` pinning), PNG via canvas and resvg, `diffImages` port, golden tests | 1 helps | 6 |
| 3 | **MCP v2**: `run_script` (build + edit modes), `docs`/`list_methods` with registry generated from the recorder, BM25 + synonym table, `snapshot`, `section`, `sections`, `probe`, `diff`, `checkpoint`, `restore`, `notes`, queue, server instructions, `scripts` tests against fake and real kernel | 1, 2 | 8 |
| 4 | **Shaded raster upgrade** in `@kit/render` (six views, az/el, frame, section clip + cap from loops, highlightAt, markers) and parity with the viewport | 2 | 3 |
| 5 | **Recipes and verification doctrine** for our stack (verification, drawing reproduction with constrained sketches, parametric part, patterns), snapshot tests of docs and search like theirs | 3 | 4 |
| 6 | **Provider layer** (Anthropic, OpenAI-compatible, auto discovery, streaming, caching, cost) with fakes and a record/replay harness | | 5 |
| 7 | **Agent loop** (events, tools, concurrency, nudges, gates P/M/verify, perception sub-call, ask_user, notes, checkpoint) as a headless library with tests using fake providers; then the **Preact panel** (messages, tool chips, images, model picker, cost/ctx ring, Stop, ask cards, source view) | 3, 6 | 8 |
| 8 | **Context compaction** (annotate, tiers A/B, ledger from document digest, overflow retry) | 7 | 4 |
| 9 | **Script sandbox** (iframe/Worker with `connect-src 'none'`), key storage UI (session-only, passphrase-encrypted), optional hardened local proxy | 7 | 3 |
| 10 | **GUI docking of the MCP** (shared session, selection tools, `view`), single daemon | 3 | 6 to 8 |
| 11 | Evaluation harness: 20 reference-image tasks (drawings, photos), scored by volume/bbox/section area and the gates, run in CI against a fake or recorded model; track gate hits | 7 | 4 |

Critical path to a useful MCP route (Claude Code builds and verifies parts using our kernel): phases 0 to 3 and 5, about 24 days.
Critical path to in-app chat with images and verification: add 6 to 9, about 20 more. Total about 55 to 60 days for everything but
docking and evaluation; with the MCP route first, something demonstrable exists after about 3 weeks.

Risk register: (a) scripts that do not map onto an editable feature tree (loops over features, dynamic names): mitigate by having
the recorder reject non-recordable patterns with a clear error; (b) vision models' reading of handedness is unreliable: keep
the gates and numeric twins; (c) token cost of images and docs: downscale images, cache prefixes, doc paging; (d) section on
non-analytic surfaces (B-spline) needs a numeric intersection with tolerance: acceptable, return `approx:true`; (e) editing after
GUI changes diverging from the script: the three-mode rule above.

---

## 9. The ten most important findings, and surprises

### Ten findings

1. **The whole system is "scripts plus proof".** One tool (`run_script`) executes model-written JavaScript against the engine; all
   other tools exist to read, prove, show or document. No per-API-call tools.
2. **Verification is two halves: numbers for execution, a fresh reader for interpretation.** Numbers (mass properties, tessellated
   bounds, brep probes) cannot detect a mirrored reading; their solution is an isolated vision call with no build context.
3. **The gates are code, not prose.** Perception gate (block first build), one-question-per-reader rule, and mirror gate (once) are
   in `agentLoop.ts`, each firing at most once per turn so a stubborn model cannot loop forever.
4. **Mirror check = one image with two panels A | B** (`sheet: [view, view with negated azimuth]`) judged by a fresh vision
   call holding the reference image and the sheet, forced choice, naming the deciding feature. The model's own record is
   explicitly not the judge.
5. **The renderer is deterministic and pure** (data in, pixels or SVG out, own CPU z-buffer, bitmap font, no GPU), with
   named ortho views, first/third-angle drawings with hidden lines, sections with hatch caps, markers, annotate, x-ray, and pinned
   `frame` for comparable before/after. It is shared by the MCP (Node) and the in-app agent (browser).
6. **Sections are an image-only technique**: clip triangles at a plane, collect the crossing segments per body, even-odd
   scanline fill with 45 degree hatch. No section data is returned and nothing is measured on it.
7. **Context is managed by treating the drawing as memory**: tool results are classified (reference, state-read, build, record),
   stale ones are dropped first, and a "ledger" is generated from the live drawing plus notes with no model summary.
8. **Knowledge is delivered as an index in the prompt plus bulk fetch**: all 264 methods as one-liners (~5k tokens) from turn one,
   `docs([...])` in ONE call before the first script, BM25F search with a hand-written synonym table, doc paging, "NOT included yet".
9. **One daemon per machine** serves all MCP tabs over loopback HTTP with an Origin check; tool calls are serialised through a
   queue; the engine is lazy; script emission is suppressed during a script and pulled once after.
10. **BYOK is the host app's problem**: the provider layer is a small interface with five adapters; the library never stores keys and
   has no cost accounting; the README says to proxy through a backend in production.

### Surprises

1. **`diffImages` exists but nothing uses it**: no tool, no gate, no recipe step. Their "pixel diff" is a library function for
   before/after of one model, not part of the shipped verification loop.
2. **There is no validity check** in their numeric toolkit; the code literally reports that mass and graphics are "not a B-rep
   validity test". Our `validate`/`verify` is stronger.
3. **There are eight recipes, not six** (verification is one of them, 17 KB).
4. **The registry is mechanically generated, the "verified against a live engine" claim is about hand-tested per-method notes.**
   Automated protection is a snapshot suite of every lookup/search result, not a live-engine conformance run.
5. **The Anthropic adapter does not stream and does not use prompt caching**, while the OpenAI adapters stream by default.
   No cost accounting anywhere.
6. **The optional local proxy reflects any request Origin in CORS and requires no secret**: any website a user visits could call
   the proxy at loopback (using the stored Copilot session, and the bounded fetch endpoint). Acceptable as a dev tool, unsafe as a
   pattern. Their MCP daemon, by contrast, rejects any request carrying an Origin header.
7. **`new Function` plus shadowed globals is their entire script isolation**, openly described as not a sandbox. Safe-ish for them because keys are
   outside the page's storage by convention; unsafe for a BYOK app that keeps a key in `localStorage`.
8. **Snapshots only reach the model when the selected model reports vision**; otherwise it gets metadata and the human sees the image.
   They note a gateway stalled about 60 s on image input, so vision is gated per model.
9. **The mirror check never sees the model's record**: by design the judge is a reader with the reference image and the A | B
   sheet and nothing else; a handover missing the reference counts as a failed gate.
10. **The MCP shim/daemon split exists only because the MCP also listens** (for the docked GUI and apps that host a session of their
    own). Without GUI docking the daemon would be unnecessary; we can defer it.
11. **The plugin installs the MCP itself** (`launch.mjs`, detached install with a lock and completion marker) rather than relying on
    `npx` at start, because host start timeouts and concurrent npx caches broke first runs.
12. **The engine needs a vendor-issued, account-bound key** (cached, auto-renewed) even locally; plan decides export formats and
    where an app may run. None of that applies to us, which makes our MCP simpler and fully offline.
