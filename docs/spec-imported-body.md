# Spec: imported body as the base feature of a document

Status: design, 2026-10-20. Nothing here is built. "Measured" means run today on the built kernel wasm (`target/wasm32-unknown-unknown/release/ck_wasm.wasm`);
"derived" means worked out by hand from measured numbers; "to pin" means the value is fixed when the gate case is added.
Paths: `K:` = kernel repo (`rebuild-main`), `C:` = this kit repo. Related: K:`docs/persisted-cache.md` (branch `cache-persist`), K:`docs/regen-cache.md`,
K:`docs/robustness.md`, K:`docs/sldprt.md`, K:`docs/skp.md`, K:`docs/recognition.md`, K:`docs/heal-tolerance.md`, `C:docs/files.md`.

## 1. Problem and what exists

`importStep` / `importSat` / `importSldprt` / `importSkp` (K:`crates/ck-server/src/geometry.rs`, hooks in K:`crates/ck-wasm/src/engine.rs`) parse a file into a `Body` and
store it as the `Snapshot` of a session **tag**. `regen` never sees it: `regen_hook` starts every run from `Brep::new()` (engine.rs:150) and replays only the feature list, so
any feature that names an imported face fails. Reproduced (measured): `importSldprt` of the 43-face test part, then `regen` of a document whose first feature is
`{"type":"sketch","id":"F1","plane":{"kind":"face","id":"sldprt.F1"}, ...}` answers `errors: [["F1",{"code":"missingReference","params":{}}]]` and `body: null`.
The kit mirrors this: `Controller.importStep/importSldprt/importSkp` (C:`apps/cad/src/controller.ts` ~1041-1075) put the mesh on screen with `importedOnScreen = true`; the next `refresh()` clears it
(controller.ts ~1346), the body is not saved, not editable, `viewData()` refuses to snapshot it. `C:docs/files.md` already names the fix ("an `importBody` feature ... the natural next step").

Facts about the kernel this spec builds on (all read in code):

* The executor is a trait, `FeatureExec` (K:`crates/ck-model/src/regen.rs:470`): `exec(&mut self, state, f)`, `save`/`load` of a `BrepSnap`, `face_frame`, `face_surf`, `edge_line` ... The only
  implementation is `Brep` (K:`crates/ck-model/src/features/mod.rs:640`: `body: Option<Body>`, `tools`, `asm`, `helices`, `surfs`). Nothing prevents `exec` from **seeding `self.body` from data**: the
  `(None, Add)` arm of `Brep::combine_at` already does `self.body = Some(tool.clone())`, and `Brep::load` replaces the whole state from a snapshot. A new `FeatureKind::ImportedBody` plus one arm in `exec_feature` is enough.
* Unknown types are `unknownFeature` (`KNOWN_TYPES`, regen.rs:~118, pinned to the original kernel). The original has no import at all: no `import*` string exists in its string table (`kernel.strings`, 9697 lines;
  the only embedding mechanism is `insertPart` with a nested `part`, codes `insertPartMissing/Empty/Errors`). So there is no original behaviour to match; the oracles are OCP/OCCT, SolidWorks' stored mass properties, and our own import reply.
* Sharing: `BrepSnap.body` is `Rc<Option<Body>>`, new snapshots reuse the previous `Rc` when equal (`Brep::save`), `Brep::load` deep-clones once (`(*s.body).clone()`), `Body` is plain `Vec`s (no `Rc` inside).
  Cost per body-changing feature is therefore one clone, which every feature already pays (regen-cache.md, "Sharing and the cap").
* The regen cache key hashes the feature JSON as received (`chain_keys`, K:`crates/ck-wasm/src/regen_cache.rs`), plus extra fingerprints for loaded fonts (`text_fonts`: `name=<sha256|missing>`).
  That is the precedent for content that lives outside the document.
* A binary body codec exists as a spike on branch `cache-persist`: K:`crates/ck-topo/src/bincodec.rs` (LEB128, raw f64 bits, bit-exact, `decode(encode(b)) == b`; 1.5 to 2.4 MB zstd for the fan shroud / large sample, decode 1-2 ms,
  persisted-cache.md). Gap found while reading it: the reader bounds **counts** by the bytes left but does not validate **ids** (an `EdgeId`, `VertexId`, loop or shell index past the arena would panic later = a wasm trap, robustness.md). It needs a validation pass before it may read untrusted data (section 8).

## 2. Decisions in one table

| # | Question | Recommendation |
|---|---|---|
| 1 | Embedding | A **content-addressed blob** (`data.sha256`) of the compact body codec, held in a kernel blob registry (`putBlob`) and carried by the kit in a document-level `blobs` table (same pattern as `fonts`), later a zip entry. The original file is an optional second blob (`source`), the fallback when the codec version is not readable. Recipe-only `.ckpart` stays valid: `importedBodyMissing` with a hint. |
| 2 | Regen | `importedBody` is an ordinary feature. Key = feature JSON (contains the sha) plus a present/missing fingerprint. Exec = registry lookup + one `Body` clone (about 1-4 ms for 3 MB). Several imports: separate bodies by default (`op:"add"`, `body:"new"`), optional union/cut/intersect. |
| 3 | Naming | Keep importer names (`sldprt.F301`, `skp.F12`, `I1.F5`) with a per-feature **unique prefix**; stable for identical bytes, **not** across re-saves; make refDiff / kit name parsers prefix-aware; add geometric candidates to `referenceLost`. |
| 4 | Coverage | Features work on whatever surface kinds the existing ops support; imports get the same refusals (table in 5). Heal at import time, store the healed body, record the report. |
| 5 | Open shells | Sketch, move/delete face, measure, export work. Anything needing a solid raises `bodyNotClosed {openEdges, hint}`. Healing option `closeGaps`. "Convert to CAD" is a kernel query that returns an ordinary feature list which **replaces** the imported feature. |
| 6 | Kit | Import creates a document whose first feature is the import; tree row, Sketch on this face, Replace source, Convert to CAD, one undo step each. |
| 7 | Limits | 50 000 faces, 64 MiB blob, decode under the feature budget, validation pass, mutation fuzz. |
| 8 | Gate | `import.feature` (HARD) plus naming and fuzz cases. |

## 3. Schema (question 1)

```json
{ "type": "importedBody", "id": "F1", "name": "joint__L_90",
  "source": { "format": "sldprt", "name": "joint__L_90.SLDPRT", "bytes": 351744,
              "sha256": "00bf600a6d0b3de1c409ddffaf0349a45b75dfd24caa697f758733134c4d76d0" },
  "data":   { "sha256": "<64 hex: SHA-256 of the fwbody1 bytes, written by the importer>", "codec": "fwbody1", "bytes": 24000, "faces": 43 },
  "options": { "hidden": false, "maxFaces": 50000 },
  "units":  { "from": "m", "scale": 1000 },
  "healing": { "mode": "auto", "tol": 1e-4, "report": { "fixed": 0, "remaining": 0, "toleranceUsed": 0 } },
  "health": { "valid": true, "openEdges": 0, "nonManifoldEdges": 0 },
  "naming": { "scheme": "importer", "prefix": "sldprt" },
  "op": "add", "body": "new", "place": null }
```

| Field | Meaning |
|---|---|
| `source` | Provenance only: what was imported. `sha256` is computed by the kernel from the bytes it parsed (the kit does not have to be trusted). `name` is a label. |
| `data` | The geometry of record. Regen reads only `data.sha256` (and `codec`, to choose the reader). `bytes`/`faces` are display facts. |
| `options` | Importer options that change the body and its names (SketchUp `hidden`, `maxFaces`; STEP solid selection). Pinned in the document because `skp.F<n>` numbering shifts when `hidden` changes (measured by reading `ck-skp/src/body.rs:232`: `n` is the position in baked order). |
| `units` | Metadata (`from` m/mm/in, `scale` to the kernel mm). The codec body is already in mm. A wrong unit is fixed with the existing `scale` feature, not with a field here. |
| `healing` | What was done **at import time**; not re-run by regen (deterministic, cheap, the healed body is what is stored). `mode`: `auto` (default tol 1e-4, `heal_with` defaults), `off`, or the `HealOpts` object (`tol,sew,fixSmall,fixOrientation,tolerant,cap`). |
| `health` | `validate` summary at import (`valid`, issue codes, open and non-manifold edge counts); drives badges and refusal hints. |
| `naming` | `scheme` (`importer` now, `entity` later, section 6) and the unique `prefix` the faces carry. |
| `op`, `body`, `place` | How the body joins an existing one (section 4). First feature of a document: ignored. `place` is the `insertPart` placement object (`{o,x,y,z}` or `dx,dy,dz,axis,angle`, `placement()` in `ck-model/src/features/mate.rs`). |

### Embedding options compared

| Option | Size / bloat | Regen cost | Diff-ability | Verdict |
|---|---|---|---|---|
| A. inline base64 of the codec in the feature | 1.33x of raw: a 3.3 MB body is 4.5 MB of JSON **inside the feature**. The kit sends the whole document with every `regen`, hashes it (`chain_keys` hashes the feature JSON) and keeps copies for undo and autosave (`AUTOSAVE_MAX` is 3 MB, C:`files/autosave.ts`). | per edit: transfer + parse + SHA of MBs | none (one 4 MB line) | Rejected for the default; allowed only as the *file* form (below). |
| B. content-addressed blob beside the recipe | feature carries 64 hex chars; blob stored once per hash | one registry lookup; SHA only at `putBlob` | recipe diffs cleanly; blob is opaque but immutable | **Recommended.** |
| C. keep the original file, re-import on every regen | smallest sidecar for STEP (text), but SLDPRT 352 KB vs about 15-30 KB of codec (estimate, to measure at M1) | parse every regen: SLDPRT 100-560 ms (measured 106 to 557 ms for the 43-face part, includes tessellation), 0.3-1.4 s for NIST parts (sldprt.md); `importer` code becomes part of every document's meaning | none | Rejected as the primary; kept as the **fallback** blob. |

Recommendation: B with layered recovery, resolved in this order when `regen` meets the feature:

1. `data.sha256` in the kernel registry: decode once, share the `Rc` (fast path).
2. else the kit supplies it: the kit's `BlobPool` (like `DocFontPool`, C:`apps/cad/src/docFonts.ts`) calls `putBlob` for every entry of the document's `blobs` **before the first regen** (fonts are loaded after `kernel.open` today; blobs must go before, or the first build shows `importedBodyMissing`). It repeats the puts after any kernel restart (a trap re-instantiates the wasm; the registry is empty again, `tools/kernel.mjs` `boot()`).
3. else if the document has the `source` blob (a `blobs` entry whose sha equals `source.sha256`): the kit re-imports it with `options`, which yields a new codec blob; if its sha differs from `data.sha256` the kit shows "re-imported, N references changed" (`refDiff`, section 6). This also covers a `fwbody` version the running kernel cannot read (`importedBodyStale`).
4. else the feature fails with `importedBodyMissing {sha256, format, name, hint:"attach the original file named <name> (sha256 <first 12>...) or open a file that contains the geometry"}` and every later feature fails with its own code; the kit's root-cause grouping (C:`apps/cad/src/errorSummary.ts`, `Diagnosis.roots`) shows only the first.

Document form (kit, extends the existing `fonts` pattern, `recipeOf()` in C:`files/viewCache.ts` must also drop it):

```json
{ "format": "ck-part", "version": 1, "name": "joint__L_90", "features": [ ... ],
  "blobs": [ { "sha256": "...", "codec": "fwbody1", "role": "data", "bytes": 24000, "enc": "gzip+base64", "data": "..." },
             { "sha256": "00bf...", "role": "source", "bytes": 351744, "enc": "gzip+base64", "data": "..." } ] }
```

The kernel never sees `blobs` (the kit strips it, as it strips `fonts`). Compression is the kit's (`CompressionStream`); the kernel receives raw `fwbody1` bytes and the workspace needs no compression crate. "Save" writes `blobs` (data always, source by a checkbox, default on up to 8 MB);
"Export recipe only" omits them. Only blobs referenced by a feature are written (garbage collection at save), so undo never needs to delete a blob. The future zip container (persisted-cache.md, option 2) carries the same table as entries `blobs/<sha256>`; nothing in the feature changes.
A plain readable `.ckpart` without `blobs` still opens: the tree and every recipe field show, regen reports `importedBodyMissing`, and the banner offers "Attach file".

### Kernel requests (additive; spec-agent-interface.md and `lint-protocol` get entries)

* `putBlob {sha256, codec:"fwbody1", data:<base64>}` -> `{sha256, bytes, faces, edges, lumps, box, alreadyLoaded}`. Verifies the SHA-256 of the decoded bytes, decodes **and validates** (section 8) now, so a bad blob is rejected here (`blobBadHash`, `blobCorrupt {detail}`, `blobTooLarge`, `blobTooMany`) not at regen. Registry limits: 32 blobs, 256 MiB of encoded bytes, process-wide like the font table.
* `dropBlob {sha256}`, `listBlobs {}`; `getBlob {sha256}` (kit export of an embedded body).
* `import*` gain `opts.asFeature: true`: the reply additionally carries `feature` (the object above, `source.sha256` filled in) and `blob {sha256, bytes}`; the kernel has already registered the blob. The tag state is still set (the reply keeps today's shape; nothing changes without the option).
* `regen` replies for documents containing `importedBody` get one extra key `imports: [{feature, faces, blob, health, source}]` appended at the end, like `cacheStats`; documents without the feature are byte-identical to today (wire gate).

## 4. Regen semantics (question 2)

`exec` for `ImportedBody` (new file K:`crates/ck-model/src/features/imported.rs`, one arm in `exec_feature`):

1. `ck_core::budget` scope is already open (feature budget, robustness.md). Look up `data.sha256` in the blob registry (a `thread_local` in `ck-topo` or `ck-model`, like the geometry memos); miss -> `importedBodyMissing`.
2. The registry holds `Rc<Option<Body>>` (decoded once at `putBlob`). `body: "new"` / first feature: `self.body = Some((*rc).clone())`, then `place` via the same transform `insertPart` uses (`x.body(&mut b)`).
3. Name check: if any live face already starts with `<prefix>.` (or `<prefix><digits>.` for STEP) -> `importedBodyNameClash {prefix, hint:"set naming.prefix to an unused value"}`. The kit picks `sldprt`, `sldprt2`, ... at insert time so users never see it.
4. Join with an existing body (`op`): `add` + `body:"new"` (default) appends the lumps with `Body::append` (K:`crates/ck-topo/src/body.rs:673`) without a boolean (like `append_body` for components but no `Component`, no mates); `add` + `body:"auto"` unions through `combine_at`; `cut`/`intersect` use the import as the tool. This is exactly the `body: auto|new` field proposed in `C:docs/spec-bodies-materials-assemblies.md` piece C; it should land once for extrude and import together.
5. Record `imports` info in the result; push warnings (`importedBodyInvalid` when `health.valid` was false, `importedBodyFacets` above 5 000 planar faces with a cylinder-like normal fan, see 5).

**Cache key.** `chain_keys` already hashes the whole feature JSON, which contains `data.sha256`, `options`, `place`, `op`. Add one fingerprint, like fonts: `blob=<sha256>:<present|missing>`
(`regen_cache.rs`, next to `text_fonts`), so a regen that failed with `importedBodyMissing` is not replayed after the blob arrives, and `putBlob` of the same bytes after a restart keeps every key. Cosmetic keys (`name`, `group`, `visible`) stay out of the hash as for every feature. Nothing else changes: the importedBody state is cached after feature 1 like any other (`BrepSnap` shares the registry `Rc` for free when the cache is told to adopt it: store the registry value as `Rc<Option<Body>>` and let `Brep::save` take it when the body is pointer-equal; saves one clone, optional).

**Cost.** Decode happens once per `putBlob` (1-2 ms for 2.5-3.3 MB, persisted-cache.md), validation about the same; regen pays one clone (about 1-4 ms for the large sample-sized body; the joint part is tens of KB). The first regen after import also tessellates (SLDPRT 40-400 faces: 0.1-1 s, sldprt.md), exactly what `importSldprt` already did; with `asFeature` the kit can use `noView` on the import call and take the first view from the regen, so the file is tessellated once.
**Memory.** Registry bytes count against `cacheCap` accounting as encoded bytes plus the decoded `Body::est_bytes`; the decoded copy is shared with cache snapshots. A 3 MB body is about 3-5 MB decoded; the 256 MiB regen-cache cap is unaffected.

**Several imported bodies.** One document may hold N `importedBody` features (a library part, a fixture, a mating part) as separate lumps; `combine` / `bodyBoolean` operate on lumps (spec-agent-interface.md, `combine`) and the per-body material/appearance work (bodies spec, piece C). A multi-solid STEP file stays **one** feature holding all solids (`I1.*`, `I2.*`), with `options.solids` to select a subset; "split into bodies" is a kit action creating one feature per solid. Real assemblies (instances with mates) stay `insertPart`: its nested `part` may itself start with an `importedBody` (blobs are process-wide, so `regen_nested` resolves them; `part_key` already hashes the nested JSON, so the sha is in the key).
**Insert mid-timeline** ("Insert imported body"): the same feature added at any position; with `op:"add"/"new"` it is independent of earlier features; features after it that referenced "the body" by position are unaffected because references are by face name. Moving it later than features that use its faces is a normal reorder (`refDiff` warns).
**Forward compatibility.** A kernel without the feature answers `unknownFeature` on F1; the kit gates the commands behind a capability flag next to `KERNEL_END_REFERENCES` (C:`apps/cad`), and writes documents with a `version` bump only when an importedBody is present.

## 5. Surface coverage, refusals, healing (question 4)

What reaches downstream features is the imported `Body`, so coverage is whatever the importer produces times whatever the op accepts. Importer output (K:`docs/sldprt.md`, `docs/skp.md`, ck-io):
SLDPRT: plane, cylinder, cone, sphere, torus exact; B-surface exact; swept/spun/offset exact; rolling-ball blends, intersection curves, SP-curves become B-splines with a reported deviation (refused above 0.05 mm). SKP: planar faces with holes only. STEP/SAT: the full analytic set plus B-splines.
The 43-face test part (measured): 15 planes, 17 cylinders, 10 tori, 1 cone, `validate` ok, no tolerant edges; `validate.meshNotes` lists 5 faces "boundary graph has an unclosed loop" (torus tessellation, display only).

| Op on an imported body | Planar / cylinder / cone / sphere / torus | B-spline / extrusion / revolution | Faceted (SketchUp, planar only) | Refusals to expect (code) |
|---|---|---|---|---|
| sketch on face | planar face: yes; curved: tangent `plane` feature (kit already does it) | planar spline-free only | yes | `missingReference` (non-planar, unknown name) |
| extrude / revolve / hole cut or add | yes (booleans) | yes, booleans on splines are the weak spot (`spline_boolean_check`) | needs a closed solid | `booleanFailed` (+`nearCoincident` hint), `bodyNotClosed` (new) |
| fillet / chamfer | analytic and free-form paths (`blend/freeform.rs`); 575/640 of the fillet sweep ok | free-form path | planar-planar edges ok; chains of many thin facets (mesh cylinders) are slow | `blendTolerantEdge` (healed edges carry `tol`; build.rs:781), `blendOverflow`, `blendFailed` |
| shell | opened face must be planar (`shellUnsupported`) | wall via fitted offset surfaces | closed solid only | `shellTooThick`, `offsetUnsupported "fit tolerance"`, `shellFailed` |
| draft, moveFace, deleteFace, thicken, patterns, mirror, `combine` | yes where the ops accept the surface | same | planar | their usual codes |
| measure, massProps, section, step export | yes | yes | open shell: area yes, volume no | none |

The kit should read `health` and the feature type before offering a command and show the refusal's hint text, as it does for other features (the spec's "perfect can/can't-do feedback" aim).
New hint on `blendTolerantEdge` for imports: "edge carries a tolerance from import healing; re-import with healing.tolerant=false or run `heal` with a smaller cap".

**Healing.** Today `importStep` heals by default (`heal_opts`, engine.rs ~262; `import.heal {fixed, remaining, toleranceUsed}`), `importSldprt` and `importSkp` do not. For `importedBody` all importers run the same pass at import time (default tol 1e-4, `HealOpts` defaults; healing a valid body is a no-op, gate metric `import.heal.noop`), then `validate`, then encode the **healed** body. The report goes into `healing.report` and `health`.
A body that stays invalid still imports (SLDPRT: 6 of 41 sample parts fail the strict `EDGE_OFF_SURFACE` check, sldprt.md); the badge says so and the first failing op names it. Re-healing with other options is "Re-import with options" (needs the source blob), not a regen-time step, so a document never changes meaning with a heal-code update.

## 6. Naming (question 3)

Face names come from the importers (`FaceName::other(prefix, role)`): SLDPRT `sldprt.F<xt node id>` (K:`ck-sldprt/src/build.rs:956`), SKP `skp.F<position in baked order>` (`ck-skp/src/body.rs:232`), STEP `I<solid>.F<traversal counter>` (`ck-io/src/step/read.rs:802,820`, not the STEP entity id), SAT `sat.F<record idx>`. Edges have no names of their own: references are `{faces:[a,b], at:[x,y,z]}` (`EdgeRef`), the `#seq` of the wire key `a|b#seq` is output only and must not be stored.

Stability, measured today with the built wasm:

| Case | Result |
|---|---|
| same SLDPRT bytes imported twice (43-face part) | identical ids (and identical `massProps`) |
| SolidWorks 2011 (OLE2) vs 2022 (modern) save of the same 10 mm cube | `F85 F83 F81 F79 F1 F43` vs `F90 F88 F86 F84 F1 F48`: only `F1` agrees. Names are Parasolid node ids: **not stable across re-saves in different versions** |
| 2022 cube vs 2022 cube plus a 5 mm hole | the six planar ids are unchanged, the hole's cylinder is `F180`: stable when a feature is *added* in this one pair (n = 1, treat as a hint, not a guarantee) |
| SKP | stable for identical bytes; shifts when `hidden` changes or any earlier face is added/removed |
| STEP | stable for identical bytes (traversal order) |

Recommendation:

* **Keep the importer names** (they are what `importSldprt` replies with, what the repro document uses, and what users read) and make the prefix a per-feature, unique field (`naming.prefix`, default the format; STEP keeps `I<k>` as `<prefix><k>` with default prefix `I`). The four readers take the prefix as a parameter (today hard-coded). With the feature present, the repro document (`plane:{kind:"face",id:"sldprt.F1"}`) regenerates without error.
* Three consumers assume `F<digits>.` and must learn the prefixes of the document's `importedBody` features: `is_face_name` in K:`crates/ck-wasm/src/refdiff.rs` (**today refDiff silently ignores every `sldprt.*` / `skp.*` reference**), `FACE_RE` in K:`tools/naming_stability.mjs:142`, and `faceOwner` / `originOf` in C:`apps/cad/src/bodies.ts` (an imported face has no owner feature today, so the Bodies panel has no origin row and appearances keyed by feature id miss it). `FaceName::parse` already handles any `<feature>.<role>`.
* Reference forms for later features are unchanged: faces by name (`"sldprt.F1"`, `{kind:"face",id}`), edges by `{faces:[...], at:[...]}`. `at` is what keeps an edge unique when two faces share several edges.
* **Re-import / Replace source** with a changed file: the kit runs `refDiff {base, part}` (base = document before, part = after, K:`docs/agent-queries.md`) before committing; `referenceLost` / `referenceChanged` warnings list each reference. Add to each lost-reference warning a `candidates: [{name, score}]` field (additive): faces of the new body ranked by the same signature `refDiff` already computes for "what the reference resolved to" (`ck_ops::agent::Sig`: surface kind, direction, neighbour kinds, size ratio 0.25..4, position). The kit offers "Remap N references" when each lost name has exactly one candidate above 0.9 and writes the new names as one undo step.
* `naming.scheme:"entity"` (later, opt-in): STEP entity ids (`I1.E1234`) and SketchUp persistent ids (v17+ files carry a `pid`, `legacy_ar.rs has_pid`) instead of orders. SolidWorks/Parasolid face `attributes_features` chains (decoded as a pointer in `ck-sldprt/src/xt.rs`, contents not read) may hold persistent ids; **unverified**, a one-day spike on the three SW fixtures decides. Until fixtures show stability across re-saves, `importer` stays default and the docs say "names are stable for the same file".

## 7. Open shells and "Convert to CAD" (question 5)

A SketchUp import is a surface model: one planar face per SketchUp face, shared edges, one lump per connected piece, closed only where the model is (`import.openEdges`, `nonManifoldEdges`, K:`docs/skp.md`). A document with an open-shell base can:

* sketch on any face, move/delete faces, measure, section, export STEP/GLB, colour by material (`import.faceMaterials` -> `skp.F<n>` looks, C:`files/skpImport.ts` moves to the feature's `health`/`materials`);
* not run solid ops. Today a boolean against an open operand runs and the post-boolean check gives no verdict (`boolean/sanity.rs:161` returns "not checkable" when an operand is not closed), so the result is `booleanFailed` or an unverified body. New precheck in `combine_at`, `shell`, `fillet`/`chamfer` of a non-manifold edge, `thicken`: `bodyNotClosed {openEdges, nonManifoldEdges, feature:"F1", hint:"close the gaps (re-import with healing.closeGaps) or Convert to CAD"}`. `massProps` keeps answering area and omits volume.
* **`healing.closeGaps`** (SKP and STEP): `ck_heal` sew at a larger tolerance (`sew.rs`, up to a configurable `cap`, default 0.1 mm) plus capping planar holes whose boundary is coplanar; reports `{closedEdges, remainingOpen}`. Never silent: the badge reads "closed" only if `validate` agrees.

**Convert to CAD ladder** (the idea from the conversation; it is not in any doc yet). Levels, with what exists:

| Level | Step | Exists |
|---|---|---|
| 0 | polyhedral solid (closed SKP / STEP mesh-like) | this spec |
| 1 | merge coplanar faces | `ck_topo::edit::merge_coplanar` (K:`crates/ck-topo/src/edit.rs:214`) |
| 2 | recognise cylinders/cones in facet fans (equal-step planar strips around an axis) and refit as analytic faces | not built (`fitQuadrics`, M) |
| 3 | recover features (prism/revolve base, holes, fillets, chamfers, patterns) | `recognize` (K:`crates/ck-recog`, `docs/recognition.md`: exact on 27 of 66 prismatic corpus parts, SolidWorks cube/hole/fillet/cone/cylinder exact; sphere, torus, crossed cylinders not) |

Plug-in point: a read-only kernel query `convertImported {feature|tag, level:1..3, opts}` (successor of `recognize {apply}`, which stores `<tag>.rebuilt`) answering `{features:[...ordinary feature JSON...], faceMap:{"sldprt.F1":"F3.C1",...}, report, verify:{relativeError, exact, close}, unexplained}`. It is not part of regen. The kit's **Convert to CAD** replaces the `importedBody` by `features` when `verify.close` (or exact), rewriting later references through `faceMap`, in one undo step; the removed feature and its blobs stay in the undo history. When only part of the body is explained (`unexplained` faces) the kit offers "keep the imported body as a hidden second body next to the recovered features" (`body:"new"`, hidden) rather than pretending. So conversion **replaces** the importedBody feature; it never runs inside regen, and nothing downstream of it needs to know imports exist.

## 8. Limits, security, licences (question 7)

* Limits: 50 000 faces (the SLDPRT/SKP importer limits), blob 64 MiB encoded, 32 blobs, 256 MiB registry; `putBlob` and `exec` poll `ck_core::budget` per 256 faces so a decode cannot exceed `featureTimeMs` (120 s default); the whole document keeps `regenTimeMs`.
* Untrusted data: `putBlob` is the only door (`exec` never decodes bytes, it uses the registry). The codec reader (promoted from the spike) gets a `validate_body` pass after `read_body` and **before** the `Rc` is shared: every `VertexId/EdgeId/CoedgeId/LoopId/FaceId/ShellId/LumpId` below its arena length; back-references consistent (loop.face lists the loop, coedge.lp, shell.lump); every f64 finite; B-spline knot vectors non-decreasing, `ctrl.len() == nu*nv`, degree below control count (check the `new` constructors reject it, no `unwrap`); `Role` tag known; strings valid UTF-8 and at most 256 bytes; then `ck_topo::check::check_topology` for open/mispaired edges (it already exists, regen-cache.md). Failure -> `blobCorrupt {detail}`; no path may index with a file-derived value (robustness.md rule). Counts stay bounded by remaining bytes as in the spike.
* The codec is versioned for **documents**, which is stricter than the cache (a cache entry is disposable, a document is not): magic `FWB1`, version byte, readers kept for every released version, committed golden blobs per version that must decode to the committed `massProps` forever. A `Body` field added later means `fwbody2` and a reader for both.
* Fuzz: extend the mutation fuzzer pattern of `ck-sldprt` (`tests/import.rs::fuzz_no_panic`, 130 mutants per fixture) and `ck-skp` (`tests/robustness.rs`, seeded) to blobs: truncation, bit flips, count fields set huge, id fields set out of range, in release 100 000 mutants per run in CI-long; requirement = error or a body that passes `validate_body`, never a trap or hang. Add `putBlob`/`getBlob`/`dropBlob`/`listBlobs` to `tools/lint_protocol.mjs` (REQUEST_TYPES is parsed automatically).
* Licences: the codec and registry are our code. A blob is user geometry: embedding a third-party vendor model in a saved document redistributes that model, so `source.name` and the sha are kept as provenance and the Save dialog says what is embedded (and offers recipe-only). Readers keep their NOTICEs (Apache-2.0 sldprt2step lineage, MIT OpenSKP, MIT/Apache brepkit-derived STEP reader; K:`THIRD_PARTY.md`); nothing new is vendored. SolidWorks, Parasolid and SketchUp are trademarks used to name formats only. Fixtures that may be committed: the four MIT SLDPRT fixtures, the 17 MIT `.skp` fixtures, `nist_ftc_11.step`, the SAT fixtures. The 43-face example part and the Fusion 360 sample (non-commercial, `docs/mimo-brief-import.md`) are local-only gate inputs and are never committed.

## 9. Kit UX (question 6)

* **Import** (Open/drop/"Import ..." for `.step .stp .sat .sldprt .skp`): `Controller.importAsDocument(kind, bytes, name, opts)` calls `import*` with `asFeature` and `noView`, builds `{features:[importedBody]}`, `BlobPool.add` the data blob (and the source blob), `kernel.open`. The view-only path (`importedOnScreen`, `importedLookNow`) is removed once this lands; SKP materials move to the feature (`materials`, `faceMaterials` live in `health`/`look` of the feature and `skpLook()` reads them from the tree).
* **Tree row** (icon in `C:docs/icons.md` style, new `import` glyph): "Imported SLDPRT - joint__L_90 - 43 faces - 24 KB", badges `valid | N open edges | tolerant`, tooltip with source name, sha prefix, healing report. Source blob size shown; context menu: Sketch on this face (face pick), Replace source file..., Re-import with options..., Convert to CAD..., Insert another imported body, Export original, Remove embedded source.
* **Direct edits** need nothing new: `moveFace`, `moveBody`, `deleteFace`, `draft`, `thicken`, patterns already take face names; the work is the prefix-aware selection model (section 6). Sketch on a face of an import uses the existing path (`{kind:"face"}`; curved faces use the tangent `plane` feature).
* **Replace source file**: import with the current `options`, new blobs, `refDiff`, dialog "3 references lost, 2 remappable", apply = one `replace` op on F1 plus the remap `set` ops; cancel leaves the document untouched.
* **Undo/redo**: add/replace/remove are normal edit ops (history.ts). Blobs are append-only and content-addressed, so undo needs no blob bookkeeping.
* **Save/open**: `Save` writes `blobs`; `Export recipe only` omits them; Open reads them with `readDocBlobs` (drops malformed entries, like `readDocFonts`), puts them, then opens. Autosave: the recipe (without `blobs`) goes to localStorage as now, the blobs to IndexedDB keyed by sha (`cad.blobs.v1`, same helper as the view cache), otherwise any import over 3 MB (`AUTOSAVE_MAX`) loses autosave. `docThumb` / snapshots exclude `blobs` from the recipe key.
* **Persisted view cache** (C:`files/viewCache.ts`): key = SHA-256 of `recipeOf(doc)`; `recipeOf` must drop `blobs` (small change), and because the feature contains `data.sha256` a changed body gives a new key. A cached open shows the stored mesh at once; the real build needs the blobs first (they are in the same file). The planned kernel-side persisted regen cache should skip the importedBody entry itself (decoding is cheaper than restoring) and dedupe face blobs against the data blob (content-addressed faces, persisted-cache.md).

## 10. Verification plan (question 8)

Differential: there is no original behaviour (section 1). References instead: OCP `STEPControl_Reader` volume/area of the same part (existing `step_roundtrip_ref.py`, `import_sample_check.mjs`), SolidWorks' stored `import.swMassProps` when present, and the closed forms in `tools/oracles`.

| Gate metric | Case | Pass |
|---|---|---|
| `import.feature` (HARD, new in `tools/gate.mjs`) | for each fixture: `import* asFeature` -> `putBlob` -> `regen` of `[importedBody]` -> `massProps`, `validate`, face names | volume/area/com bit-identical to the import reply, same face id list in the same order, `validate` equal, `errors:[]` |
| `import.feature.edit` | importedBody + sketch on a planar face + cut + fillet (worked example) | no errors; volume equals the closed form within 1e-9 |
| `import.cache` | cold vs warm regen, `cacheStats` | second run `fullHit`, `ranFeatures:0`; replies byte-identical; blob replaced -> keys change; missing -> present flips the key |
| `import.missing` | regen without `putBlob` | `importedBodyMissing` with sha and hint on F1; later features fail with their own codes; no trap |
| `naming.import` (SOFT, extends `naming.stable`) | `tools/naming_stability.mjs` with prefix-aware `FACE_RE`: edit a dimension after the import; refDiff on Replace source with the SW2011 vs SW2022 cube pair | no warnings on parameter edits; `referenceLost` + candidates for the re-saved pair |
| `import.codec.fuzz` (HARD, CI-long) | mutated blobs (section 8) | zero traps/hangs |
| `import.openshell` | SKP fixtures (`multi_face_shared_edge`, `holes`, `circle`): cut / shell / fillet | `bodyNotClosed` where the body is open; sketch-on-face works |
| wire | existing 280/280 wire cases, `valid.*`, `vol.*`, `step`, `iface.*` | unchanged: no key appears for documents without the feature |

Fixtures: `K:crates/ck-sldprt/tests/fixtures` (4), `ck-skp/tests/fixtures` (17), `ck-io/tests/fixtures` (`nist_ftc_11.step`, `occ_cylinder_and_box.step`, `nurbs_quarter_disc.step`, SAT set), and the local-only 43-face part via an environment path.
Kit: `*.kernel.test.ts` import -> save -> open round trip for STEP, SLDPRT, SKP (recipe-only fails with the banner; with `blobs` reproduces the mass properties), controller test that the view-only flag is gone, `recipeOf` drops `blobs`, autosave stores blobs in IndexedDB.

## 11. Milestones and risks (question 9)

Sizes as in roadmap-kernel-gaps.md: S = days, M = about a week, L = several weeks.

| M | Content | Size | Depends on |
|---|---|---|---|
| M1 | Kernel: promote `bincodec` to `fwbody1` (header, versioning, `validate_body`, fuzz), blob registry + `putBlob/dropBlob/listBlobs/getBlob`, `FeatureKind::ImportedBody` + exec + cache fingerprint + `imports`, `asFeature` on the four importers (prefix parameter, `source.sha256`, healing parity for SLDPRT/SKP), gate `import.feature*`, `import.missing`, `import.cache`. | M-L | merge of the codec file from `cache-persist` only (container/cacheExport stay separate) |
| M2 | Kit wiring: `importAsDocument`, `BlobPool`, document `blobs`, Save/Open/Recipe-only, autosave to IndexedDB, tree row, Sketch on this face, remove view-only path; capability flag. | M | M1 |
| M3 | Naming: prefix-aware `is_face_name`, `FACE_RE`, `faceOwner`; `candidates` in `refDiff`; Replace source + remap dialog; `naming.import`. | S-M | M1 |
| M4 | Healing options UI, `health`, `bodyNotClosed`, `closeGaps`, refusal hints on tolerant edges. | S-M | M1 |
| M5 | Convert to CAD: `convertImported` level 1 + 3 on top of `merge_coplanar` and `recognize`, `faceMap`, kit action with undo; level 2 `fitQuadrics` later. | M (L with level 2) | M1, M3 |
| M6 | `naming.scheme:"entity"` spike (STEP ids, SketchUp pid, Parasolid attributes). | S spike | M1 |

Risks: (a) codec drift: a `Body` field added without a codec version bump silently loses data in saved documents; mitigate with the round-trip equality test over every gate body and the golden blobs. (b) Names unstable across re-saves (section 6): users who edit the source in SolidWorks and re-import lose references; mitigate with candidates/remap and honest docs. (c) Kernel restarts empty the registry: the kit must re-put before regen; a missed path shows `importedBodyMissing` (test it). (d) Large imports in a 4 GB wasm: registry plus caches; `cacheCap` scaling already exists. (e) Boolean/blend failure rates on imported B-splines are what they are today (6 of 41 sample parts fail strict validate); the feature makes them visible earlier, it does not fix them. (f) Two documents' worth of API surface (blob requests, `asFeature`, `imports`, `bodyNotClosed`) must be in spec-agent-interface.md and pass `lint-protocol`.

## 12. Alternatives considered (question 10)

* **Datum-plane-only sketches on imports** (derive a `plane` feature from the tag body, sketch on that): needs no feature, but the plane's reference is still a face of a body regen cannot rebuild, so it fails the same way after reload; extrude/cut/fillet/shell/patterns/booleans still have nothing to act on. Rejected: it fixes one symptom.
* **A separate "imported" document kind** (`kind:"imported"`, read-only tree): keeps regen untouched, but forks every panel, save format and undo path, and the user's goal (cut a pocket in a SolidWorks body) is exactly mixing the two. Rejected.
* **Store only the original file and re-import on every regen** (option C): smaller for text formats, but parse cost on every regen (100 ms to seconds), importer changes silently change old documents, and a file the user no longer has makes the document unusable. Kept only as the fallback blob.
* **Seed a regen from the session tag** (`regen {base:<tag>}`, no feature): the body would not be in the document and not in the cache key unless a hash is invented for it, i.e. the blob design again with worse naming of the dependency. Rejected.
* **Convert on import** (always run recognition and store a feature tree): lossy for the many bodies recognition cannot explain (it explains 41 percent of the prismatic corpus fully). Rejected as a default; offered as the explicit Convert to CAD action.

## 13. Worked example: joint__L_90.SLDPRT

Part (measured): 351 744 bytes, SHA-256 `00bf600a...4d76d0`, OLE2, 43 faces (15 planes, 17 cylinders, 10 tori, 1 cone), box x -14.5..39.5, y -39.5..14.5, z 0..20, volume 22622.88261918416 mm3, area 8609.129709418583 mm2, `validate` ok, `importSldprt` 106-557 ms. `sldprt.F1` is the planar top face at z = 20 (normal +z); its frame as a sketch plane is o = (0,0,20), x = (1,0,0), y = (0,1,0), z = (0,0,1), so sketch coordinates equal world x,y (frame confirmed on an extruded block of the same orientation).
The straight edge between `sldprt.F1` and `sldprt.F279` (x = 14.5, y from -9.5 to 9.5, key `sldprt.F1|sldprt.F279#17`, mid (14.5, 0, 20)) is convex, 19 mm long, and ends flush against two perpendicular walls. The pocket rectangle x 10.5..12.5, y -32..-27 lies inside material for z 16..20 (checked with `section` at z 16.01, 17, 19.99: all corners inside the outer loop, outside the 4 mm hole). Feature ids: the first feature is `F1` and the face is `sldprt.F1`; they are unrelated.

Document (`importedBody.data.sha256` is the one value that exists only after M1, because it is the digest of the encoded body):

```json
{ "format": "ck-part", "version": 1, "name": "joint__L_90",
  "features": [
    { "type": "importedBody", "id": "F1", "name": "joint__L_90",
      "source": { "format": "sldprt", "name": "joint__L_90.SLDPRT", "bytes": 351744, "sha256": "00bf600a6d0b3de1c409ddffaf0349a45b75dfd24caa697f758733134c4d76d0" },
      "data": { "sha256": "<digest of the fwbody1 bytes>", "codec": "fwbody1", "faces": 43 },
      "options": {}, "units": { "from": "m", "scale": 1000 },
      "healing": { "mode": "auto", "tol": 1e-4, "report": { "fixed": 0, "remaining": 0, "toleranceUsed": 0 } },
      "health": { "valid": true, "openEdges": 0, "nonManifoldEdges": 0 },
      "naming": { "scheme": "importer", "prefix": "sldprt" }, "op": "add", "body": "new" },
    { "type": "sketch", "id": "F2", "plane": { "kind": "face", "id": "sldprt.F1" },
      "points": [ {"id":"a","x":10.5,"y":-32}, {"id":"b","x":12.5,"y":-32}, {"id":"c","x":12.5,"y":-27}, {"id":"d","x":10.5,"y":-27} ],
      "entities": [ {"id":"e1","type":"line","p1":"a","p2":"b"}, {"id":"e2","type":"line","p1":"b","p2":"c"},
                    {"id":"e3","type":"line","p1":"c","p2":"d"}, {"id":"e4","type":"line","p1":"d","p2":"a"} ], "constraints": [] },
    { "type": "extrude", "id": "F3", "op": "cut", "sketch": "F2", "end": "blind", "depth": 4 },
    { "type": "fillet", "id": "F4", "radius": 1, "edges": [ { "faces": ["sldprt.F1", "sldprt.F279"], "at": [14.5, 0, 20] } ] }
  ],
  "blobs": [ { "sha256": "<same digest>", "codec": "fwbody1", "role": "data", "enc": "gzip+base64", "data": "..." } ] }
```

(`blobs[].data` is the payload, not shown; the kit strips `blobs` before sending the document, after `putBlob`.) The cut has no `flip`: a cut runs against the sketch normal by default (kernel convention), i.e. down into the part. Naming of the new faces follows the same rules as for a native block (checked on a 50x40x20 stand-in: walls `F3.S.<entity id>`, floor `F3.C0`, fillet face `F4.B0`, top face keeps its name).

Expected reply of `regen` on this document (derived unless marked):

```json
{ "errors": [], "warnings": [],
  "body": { "faces": "49 faces: the 43 sldprt.* (sldprt.F1 now with a second inner loop), F3.S.e1 F3.S.e2 F3.S.e3 F3.S.e4, F3.C0, F4.B0" },
  "imports": [ { "feature": "F1", "faces": 43, "blob": "<digest>", "health": { "valid": true }, "source": { "format": "sldprt", "sha256": "00bf600a..." } } ] }
```

and for the same tag, in order of the features:

| After | Faces | Volume mm3 |
|---|---|---|
| F1 importedBody | 43 | 22622.88261918416 (bit-identical to the `importSldprt` reply; gate `import.feature`) |
| F3 cut, 2 x 5 x 4 | 48 (+4 walls, +1 floor) | 22582.88261918416 (22622.88261918416 - 40) |
| F4 fillet r = 1 on F1/F279 | 49 (+1 blend) | 22578.80518428871 = 22582.88261918416 - (1 - pi/4) x 1 x 19 (4.077434895448483), to pin to 1e-9 against OCP |

The stand-in block reproduces the same arithmetic exactly: 50 x 40 x 20 block, same cut 2 x 5 x 4, same fillet on a 40 mm convex edge gives 39951.41592653589 against the closed form 39951.4159265359 (measured). Before the feature exists, the same document without F1 gives `missingReference` on F2 (measured), which is the bug this spec removes.
With the blob absent the reply is `errors: [["F1", {"code":"importedBodyMissing","params":{"sha256":"<digest>","format":"sldprt","name":"joint__L_90.SLDPRT","hint":"attach the original file ..."}}], ["F2", missingReference], ...]` and `body: null`.

## 14. Open questions for you

1. Names: keep importer names with a unique prefix (recommended), or switch to feature-scoped names (`F1.F301`) so every existing name parser works unchanged but `sldprt.F1` in existing scripts/notes stops matching?
2. Source file in the document: embed the original by default up to 8 MB (recommended, makes re-import and codec upgrades possible) or opt-in only (smaller files, vendor-model redistribution is a conscious choice)?
3. Is `body:"new"` as default for a second import right, or should a second import union with the first (the SolidWorks "combine" default)? The bodies spec (piece C) needs the same decision for extrude.
4. May M1 take the codec out of `cache-persist` ahead of the persisted-cache work (it freezes the byte format for documents earlier than the cache needs it)?
5. Is a one-day spike on Parasolid face attributes / SketchUp persistent ids worth doing before M3, since it decides whether names can survive re-saves at all?
6. Keep a view-only "peek" import (no document, no blobs) for files over the face limit, or drop the old path entirely?
7. Convert to CAD: replace the imported feature when `verify.close` (recommended), or always keep the import as a hidden reference body after conversion?

## Decisions (2026-10-20, from the user's answers; items 3 to 7 were delegated)

1. **Naming:** keep the importer's names with the unique prefix (`sldprt.F301`, `skp.F12`, `step.F7`), made prefix-aware in refDiff, `naming_stability` and `faceOwner` (section on the blind spot). Re-save instability is reported by `referenceLost` with `candidates`, not hidden.
2. **Embedding the original source:** a choice, not a blanket default. The compact body blob is always embedded (it is the document's geometry). The original file is embedded as a second, optional blob: default ON when the file is under 5 MB, OFF above that; the import dialog and the tree row show the size and a toggle; "Save without source" strips it; the fallback behaviour (re-import from source when the body blob is missing) only applies when it is present. This keeps a shared `.ckpart` from ballooning by accident.
3. **Second import into an open document:** ask. A small prompt offers "Add as a new body" (default), "Combine with the current body (union)" and "Replace the imported body"; the choice can be remembered per session. Scripts and agents pass `mode` explicitly (`newBody` default).
4. **Codec:** extract the body codec out of `cache-persist` now (with the validation pass, the versioned `FWB1` format, golden blobs and the mutation fuzzer) and merge it to `main` ahead of the rest of the persisted-cache work; both features depend on it.
5. **Persistent ids from Parasolid and SketchUp:** deferred. Not needed for the first milestones; revisit only if re-save instability hurts in real use (the `referenceLost` warnings with `candidates` cover it meanwhile). The user was unsure; this is the low-risk default.
6. **View-only import path:** kept for now (fast route for very large or open-shell models, and the fallback if decoding ever fails). It costs little, and removing it later is easy once the editable path proves itself. The user was unsure; this is the low-risk default.
7. **After Convert to CAD:** ask. The Convert dialog offers "Replace the imported body with the converted features (keep the source hidden so you can re-run)" as the default and "Keep both" (converted features added beside the import) as the alternative; the answer can be remembered. Scripts and agents pass `keep: 'source' | 'none' | 'both'` explicitly (default `source`).
