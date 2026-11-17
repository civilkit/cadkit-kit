# CadKit MCP: token-efficient changes

Status: implemented in six commits on branch `mcp-token-efficiency`, one per item, in the order below. Tool names, schemas and numbers here are the ones the code and tests use; if they disagree, the code wins and this page is wrong.

## What the live bridge exposes today (checked, not assumed)

- Bridge ops (`packages/agent-link/src/wire.ts`): `state`, `screenshot`, the measuring ops (`bodies`, `measure`, `clearance`, `interference`, `thickness`, `draft`, `dfm`), `section`, `plugin_list`, `plugin_run`, `run_script`, `undo`, `redo`. Only `plugin_run`, `run_script`, `undo`, `redo` are in `EDIT_OPS`.
- The measuring ops ARE registered as MCP tools: `packages/mcp/src/bridgeTools.ts` spreads `APP_READBACK_TOOLS` (`@kit/readback`) into `BRIDGE_TOOLS` as `app_bodies`, `app_measure`, `app_clearance`, `app_interference`, `app_thickness`, `app_draft`, `app_dfm`. The same definitions back the headless tools of the same names. The app answers them from `controller.measureSession()` and its body list.
- Output cap: `capJson` (`packages/agent-tools/src/output.ts`) builds the full pretty JSON and then shrinks arrays to 200/80/30/10/4 items; it is a character cap after the fact with no cursor and no way to get the cut part back.
- A document revision already exists in the app: `Controller.revision` is a counter that goes up in `refresh()`, i.e. after every successful edit, undo, redo, patch and load. It is not exposed over the bridge yet.

## Baseline (item 0)

Harness: `packages/mcp/bench/mcpBench.ts`, run by `packages/mcp/src/tokenBench.kernel.test.ts`. A fixed task through the MCP tool layer (real daemon, real MCP tools, the real `makeAppHandler` over a real kernel session): read the state, find a body, check the clearance of two bodies, make one edit, read the state again. Characters, not tokens (request arguments plus the text of the results). Command:

```
CK_WASM=<ck_wasm.wasm> CK_BENCH_OUT=<dir>/bench.json npx vitest run packages/mcp/src/tokenBench.kernel.test.ts
```

Baseline (commit of item 0, tools unchanged):

| document | calls | request chars | response chars | total chars |
| --- | --- | --- | --- | --- |
| 26 features | 5 | 159 | 7958 | 8117 |
| 200 features | 5 | 159 | 43240 | 43399 |

The "open a document" step has no baseline: the bridge cannot open a file, and a document can only be rebuilt by sending a script through `app_run_script` (40,000 characters at most, append only).

## 1. `app_open_asset`: open by handle

Bridge op `open_asset` (an edit op, needs the edit permission). MCP tool:

```
app_open_asset { path: string (max 1024), unit?: 'mm'|'cm'|'m'|'in' (mesh files only), maxChars? }
  -> { ok, documentId, revision, name, kind, bytes, sha256, counts: { features, faces, solids? }, errorCount, previewRef: { tool: 'app_screenshot', args } }
```

The model sends a path, never bytes. The local MCP service reads the file after checking it against the policy below, stages the bytes under a one-time handle and asks the app to open that handle; the app fetches the bytes from the loopback daemon (`GET /bridge/asset/<handle>`, session token, single use, 2 minute life) and opens them in a NEW document tab so the user's current part is untouched. Nothing but the handle, name, kind, size and SHA-256 crosses the model's context.

Policy (`packages/mcp/src/assetPolicy.ts`):

- Roots: `CK_MCP_ASSET_ROOTS` (a path-delimiter separated list) or `<state dir>/assets.json` `{ "roots": [...], "maxMb": 256 }`. No roots configured means every call is refused with `asset_roots_not_configured` and the way to set it. Default: nothing allowed.
- A relative path is resolved against the first root; an absolute path must lie inside a root.
- A `..` segment is refused outright (`path_traversal`); containment is then checked on the lexical path BEFORE the file system is touched (an outside path never reveals whether it exists), and again on the realpath (a symlink that leaves the root is refused: `path_outside_workspace`).
- The target must be a regular file (`asset_not_file`), its name AND its real name must end in an allowed extension (`.ckpart`, `.solidcraft`, `.step`, `.stp`, `.stl`, `.obj`, `.glb`, `.3mf`: `asset_extension_not_allowed`), and it must be at most `maxMb` (default 256; `asset_too_large`). The size is checked on the open descriptor and the read is capped, so a file that grows is still refused.
- Edit permission is checked first (`edit_not_allowed`), before the file is read.

## 2. Filtered, paged state and revision deltas

`app_state` gains (defaults in brackets):

```
app_state { detail?: 'compact' (default) | 'summary' | 'full',
            ids?: string[] (<=200), query?: string, types?: string[],
            fields?: ('type'|'name'|'status'|'suppressed'|'error'|'params')[],   // id is always there; default type,name,status
            limit?: int 1..500 [50], cursor?: string, sinceRevision?: int,
            includeBlobs?: boolean [false], maxChars? }
  -> { ok, open, documentId, revision, name, units: 'mm', hasSolid, bounds?: [minx,miny,minz,maxx,maxy,maxz],
       totalCount, returnedCount, nextCursor?, features: [...], variables: <count>, selection,
       delta?: { sinceRevision, revision, available, added[], changed[], removed[] } }
```

`detail: 'summary'` and `'full'` keep the previous shapes exactly (the old default was `summary`). A cursor encodes the revision it was made at; a cursor from another revision is refused with `stale_cursor` instead of paging over a changed list. Blobs (long strings, large arrays and objects in `params`) are replaced by `{ blob: <chars> }` unless `includeBlobs` is true. `sinceRevision` is answered from the last 32 observed revisions (per-feature hashes of the JSON and the status); an older revision answers `delta.available: false` with the whole list.

Where the revision goes up: `Controller.revision`, in `refresh()`: every successful `edit`, `applyDocPatch`, `undo`, `redo` and every document load. Material and viewer-only fields do not move it.

## 3. Output budget

Every `app_*` tool takes `maxChars` (500..48000, default 4000). When the JSON result is larger the tool returns a valid JSON summary (arrays cut to what fits, long strings cut, with counts) that carries

```
_budget: { exceeded: true, maxChars, totalChars, handle, fetch: { tool: 'fetch_result', args: { handle } } }
```

and the full result is kept by the daemon (LRU: 24 results, 64 MB, 30 minutes). New tool:

```
fetch_result { handle: string, path?: string (dot path, e.g. "features.12"), offset?: int, limit?: int, maxChars? }
  -> { handle, totalChars, offset, returnedChars, nextOffset?, text }   // or the value at `path`, budgeted again
```

The result is also readable as the resource `ck://result/<handle>`. Headless tools keep their 48000 default but a larger result now also goes behind a handle instead of being cut (`CK_MCP_OUTPUT_BUDGET` changes that default). Bridge tool metadata is built once.

## 4. `app_edit`: atomic edit transaction

Bridge op `edit` (an edit op). 

```
app_edit { expectedRevision: int (required), reason?: string,
           ops: (1..50) of
             { op: 'add', feature: object, index?: int }
           | { op: 'replace', id, feature: object }          // the id is kept
           | { op: 'remove', id, cascade?: boolean }
           | { op: 'transform', id, translate?: [x,y,z], rotate?: [rx,ry,rz] }   // degrees, on the feature's placement fields
           | { op: 'setParam', id, path, value },
           dryRun?: boolean }
  -> { ok, revision, changedIds[], addedIds[], removedIds[], validation: { errors: [{ feature, code }], warnings: n } }
```

Refused with `stale_revision` (the hint says to read `app_state` with `sinceRevision`) when `expectedRevision` is not the app's revision; the check runs inside the controller's serial queue so a user edit cannot slip in between. Every op is validated against a local copy first (unknown id, missing type, duplicate id); one failing op refuses the whole transaction with its index. The kernel rebuilds the candidate before anything is committed, so a build failure changes nothing. One transaction is one history record: one undo step. Ids are never renumbered: `replace`, `setParam` and `transform` keep the id; an `add` without an id gets the next free `F<n>`.

## 5. Geometry interface queries

```
app_interfaces { kinds?: ('holes'|'planes'|'contacts'|'frames')[], component?: string (body name or number), precision?: int 0..6 [3], limit?, maxChars? }
  -> { ok, units: 'mm', precision, tolerance, holes: [...], planes: [...], contacts: [...], frames: [...] }
```

Every number is given twice: `exact` (full double, the value to compute with) and `display` (rounded to `precision`, for reading). Placement must use `exact`. Built from the kernel's face description (`describe`) and mass properties, deduplicated: holes by axis line and radius (with regular patterns recognised), planes by normal and offset, contact faces as opposite-facing coplanar faces of two bodies, frames as the centre of mass and principal axes of each body.

## 6. Bounded jobs and recipes

```
app_job_start  { kind: 'open_asset' | 'recipe', args: object }  -> { ok, jobId, state: 'running' }
app_job_status { jobId, maxChars? }  -> { jobId, state: 'running'|'done'|'failed'|'cancelled', elapsedMs, result? | error? }
app_job_cancel { jobId }  -> { jobId, state, cancelled, note }
  done result: { ok, revision, changedCount, errorCount, warningCount, reportUri, previewUri? }
```

`ok` is false whenever `errorCount > 0` or the underlying call failed: a failed validation is never reported as success. The bridge client serves long ops (`open_asset`) without blocking its poll loop, and the daemon waits for them with a long timeout, so a multi-minute import no longer stalls the link or hits the 60 s reply timeout. Cancelling stops the daemon waiting and marks the job; the app may still finish the load, which is then reported as `lateResult` and discarded.

Recipes are declarative JSON files (`*.ckrecipe.json`) in `<first asset root>/recipes/`; they hold parameter definitions, a list of `app_edit` ops with `"$param"` placeholders, optional checks (the read-only measuring tools) and the source files they depend on. They are never executed as code or commands. Minimal in this branch: `recipe_list`, run through `app_job_start { kind: 'recipe', args: { id, params } }`, a report, and a cache of the last run keyed by the hash of the parameters and of the sources (an identical run on an unchanged document answers `cached: true`). Not done: partial rebuild of only the affected features, recipe composition, recipe authoring tools.

## As built (differences from the text above, and measured results)

- Result JSON from the budgeted path is compact (no indentation): the budget buys data, not whitespace. Compact `app_state` rows omit `status` when a feature is ok (absent means ok); `selection`, `variableCount` and `documentFeatureCount` appear only when non-empty or different.
- Jobs: kinds are `open_asset`, `recipe` and `checks` (a batch of read-only measuring calls); a `regenerate` job does not exist because the bridge has no regenerate op (`app_edit` already rebuilds). `app_recipe_list` lists recipes. `previewRef` of `app_open_asset` is a ready-made `app_screenshot` call, not a stored image.
- `app_open_asset` does not take a content-addressed handle; only a path.
- Measured (characters, `packages/mcp/bench`, same fixed task, real kernel): baseline 26 features 5 calls 8117 chars (159 sent, 7958 received); now 5 calls 4805. Baseline 200 features 5 calls 43399; now 5 calls 6747. Open by path: 23 chars sent, 294 received, for a 7668-character part file.
