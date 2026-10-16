# Research: reading SolidWorks .SLDPRT parts

Status: research note, 2026-10-16. No code was written or copied. All third-party facts below come from the
public READMEs, docs and file listings of the named repositories as of this date and are paraphrased. Where a
claim is the repository author's own and we did not reproduce it, it is marked "claimed". Nothing here is legal
advice.

## 1. Summary and recommendation

Question: should we write a Rust reader for SolidWorks `.SLDPRT` parts (container, Parasolid B-rep, display
mesh) as a crate next to our kernel (ck-io, ck-topo, ck-geom), or contribute to cadkit?

Five key findings:

1. **A SLDPRT is not encrypted.** It is a container of compressed streams (raw DEFLATE with CRC-32 in the
   2015+ layout, OLE2/CFB with zlib frames in the older layout). The exact B-rep is a standard Parasolid XT
   neutral-binary "transmit" stream (base schema 13006) inside it, plus a cached display mesh. Three projects
   independently confirm this.
2. **The hard, exact-geometry path has already been done in permissively licensed code, including in Rust.**
   `cadmpeg` (Apache-2.0 code, CC-BY-4.0 docs, Rust, created July 2026) has a `cadmpeg-codec-sldprt` crate and a
   `cadmpeg-parasolid`-adjacent stack that decode Parasolid partition and deltas streams into a 3D B-rep IR
   (analytic and NURBS carriers, swept/spun/offset, rolling-ball blends, intersection curves, configurations,
   display mesh, some feature history). It also publishes a ~1,800-line format spec and an open-items list.
   `blussyya/sldprt-format-research` (MIT, JS) is the best independent prose description and reports an exact
   match to SolidWorks' own STEP export on 49 of 49 controlled parts.
3. **cadkit is the wrong home.** cadkit's neutral model is 2D drawings (DWG/DXF/DGN, plus CityGML). A 3D B-rep
   reader does not fit without its maintainers agreeing to a new model. cadmpeg is already a 3D multi-format
   transcoder with a Rust IR and a STEP codec, so it is the natural upstream for this work if we contribute
   anywhere.
4. **Nobody has decoded the feature tree as a replayable history.** Feature names and some sketch entities are
   read by cadmpeg (Keywords XML, ResolvedFeatures records, SW Objects), but cadmpeg itself rates `.sldprt` at
   ladder level L1 overall and lists open items (superseded faces in deltas, variable-radius blends, offset
   carrier grammar). Our product value is the B-rep, not the history: scope accordingly.
5. **Legal footing is reasonable but has two sharp edges.** Reading a file format for interoperability from
   files you may lawfully possess is the normal posture of all these projects. The two edges are: (a) Siemens'
   "Parasolid XT Format Reference" is copyrighted with a no-redistribution notice, so we may read it to
   implement a reader but must not copy or host it, and the only copies found are third-party mirrors; and
   (b) one competing project (`dsandall/sld2step`) is AGPL-3.0 and must not be read or ported.

**Recommendation** (in order):

1. Do a 3-5 day evaluation spike of `cadmpeg-codec-sldprt` as a dependency or vendored-with-attribution source
   (Apache-2.0), run against a public test corpus (section 5), and score its B-rep against STEP exports.
2. Whatever the spike shows, build our own thin adapter: Parasolid-derived neutral B-rep to `ck-topo::Body`
   (the same shape as our existing `ck-io/src/step/read.rs`, without a STEP hop). This adapter and its
   validity/volume gates are the part only we can write.
3. Only if cadmpeg is unsuitable (weight: ~20 workspace crates, young, LLM-assisted-looking process files) write
   a small own crate: phase A container + metadata, phase B XT reader, using the independent MIT/Apache sources
   and the public XT reference as specs, not as code to translate line by line.
4. Do not open a cadkit PR for geometry. If we want to talk to cadkit at all, an issue asking whether a
   3D B-rep crate family is in scope is cheap, but expect "no".
5. Open an issue upstream in cadmpeg before sending anything; its LEGAL.md requires a provenance declaration
   on every decoder PR.

## 2. What is in a .SLDPRT

Two outer envelopes exist. Both hold named streams.

| Envelope | SolidWorks versions | Detection | Compression | Source |
|---|---|---|---|---|
| Modern block container | 2015 and later (openswx: "SW 2015 and later"; blussyya DisplayLists versions 13000-17000; Wintaru: SW 2018 and 2026 files) | 8-byte header; bytes 4-7 big-endian `00 00 00 04`; blocks begin with marker `14 00 06 00 08 00` | raw DEFLATE per block, CRC-32 of the inflated bytes in the header; stream names stored with a nibble swap (cadmpeg) or per-byte bit rotation by an amount taken from the file header (blussyya); both describe a trivial name masking | blussyya container.md; cadmpeg sldprt.md section 1 |
| OLE2 / Compound File Binary (CFB v3/v4) | 2014 and earlier; blussyya tested SolidWorks 2011 and a few older parts | magic `D0 CF 11 E0 A1 B1 1A E1` | zlib inside a framed wrapper (fixed 16-byte GUID, inflated length, compressed length, 8 zero trailer bytes) | openswx README; blussyya; cadmpeg |

Version coverage in practice:

| Era | Status |
|---|---|
| 2015+ (modern) | Best covered. blussyya: 45 modern files; Wintaru: SW 2018 (public NIST set) and 2026 (private, decode "without error"); cadmpeg: dialect `sw-version-12000-plus` |
| 2011 to 2014 (OLE2) | Container and Parasolid body read (blussyya: 25 SW2011 models, exact B-rep match to STEP; sldprt2step handles OLE2 containers) |
| Before 2011 | Not read. blussyya refuses 3 old parts (`DisplayLists__Zip`, no partition, different layouts); cadmpeg lists a "pre-12000" dialect as detected only |
| Unknown future versions | Parasolid schema keeps base 13006 with embedded edits, so likely fine; container changes are the risk |

Streams (names from blussyya container.md, cadmpeg sldprt.md and Wintaru findings; contents as stated by those
sources):

| Stream | Content | Decoded by | Notes |
|---|---|---|---|
| `Contents/DisplayLists` (legacy: `DisplayLists__ZLB`) | Cached tessellation per B-rep face: triangle strips, normals, per-edge boundary ids, bounding record, per-face surface record with face id and surface type tag | blussyya (documented fully), Wintaru (own decoder), cadmpeg | Floats are float32 metres. Face and edge ids equal Parasolid node ids: blussyya claims 1,414 of 1,414 faces joined |
| `Contents/Config-0-Partition` | Parasolid XT neutral binary, framed zlib sections: `(partition)` then `(deltas)` | blussyya, sldprt2step, cadmpeg, parasolid-kit | The exact B-rep. Deltas semantics are only partly known (section 4.5) |
| `Contents/Config-0-GhostPartition` | A second Parasolid partition | read, role unknown (blussyya open question) | cadmpeg excludes it from the active body |
| `Config-0-FeatureBodies/LocalBodies` | Imported body in a part whose primary partition is empty | blussyya (1 file) | Needed for imported-geometry parts |
| `Contents/Config-0-ResolvedFeatures` | Small one-face Parasolid bodies (plane) and feature-input sketch profiles | cadmpeg (sketch entities); blussyya notes role unestablished | |
| `Contents/Config-N`, `Config-0-LWDATA`, `CnfgObjs`, `CMgr`, `CMgrHdr2`, `Definition`, `OleItems`, `Header2`, `ModelStamps` | Feature/config object graph, MFC `CArchive`-style records, class names such as `moPart_c`, `moFaceRef_c`, `moFilletSurfIdRep_c` | partly (cadmpeg history modules; openswx reads `CMgrHdr2` for configurations) | Not encrypted. Serialisation follows the standard MFC pattern per Wintaru. Full semantics not public |
| `Contents/CusProps`, `docProps/custom.xml`, `docProps/ISolidWorksInformation.xml` | Custom properties, configuration properties, mass properties | openswx (complete), cadmpeg, swformat (read and write) | Mass properties: mass, volume, surface area, centre of gravity, inertia, per configuration |
| `Preview`, `PreviewPNG` | Thumbnails (BMP/PNG) | openswx, cadmpeg | |
| `swXmlContents/Features`, `KeyWords` | XML feature and keyword data | cadmpeg (feature history from "Keywords XML") | |
| `ThirdPtyStore/VisualStates`, appearances | Colours and visual states | cadmpeg | |
| `Contents/PMISemanticDataDB`, `moSwift*` records | GD&T and dimensions (PMI) | cadmpeg (section 2.1 "SWIFT semantic PMI", spec) | Out of our scope |
| `[Content_Types].xml`, `_rels/.rels`, `docProps/*` | OPC package index | all | The modern container mimics an OPC package; the tail of the file holds a section directory |
| cache-cell grid between blocks | Fixed-size index cells reusing the block marker | cadmpeg (spec section 1.2) | Source of false marker hits when scanning (blussyya: 1,475 spurious hits in its corpus) |

Is anything obfuscated? Names are nibble-swapped/rotated (trivial masking). Content is compressed, not encrypted
(blussyya history, Wintaru findings: both initially suspected encryption from a `strings` scan and corrected
themselves). The feature-tree streams are binary object graphs, undocumented, not encrypted. cadmpeg's LEGAL.md
explicitly excludes decoding anything protected by DRM/encryption; none was found in the streams above.

## 3. Existing implementations compared

| Project | Language | Licence | What it reads | Maturity / tests | Usable as porting source |
|---|---|---|---|---|---|
| schwitters/openswx | C++20 (libopenswx, libopenbom, asmbox server) | MIT | Both containers; doc type, version, global and per-configuration custom properties, mass properties, preview PNGs, cut-list items, assembly component references, drawing sheet names. **No geometry** | 29 stars; unit tests for OLE2, modern parser, decompressor, XML readers; regression harness; CI; pushed 2026-10-09 | Yes (MIT), for phase A only |
| BlinkingSun/sldprt2step | Python 3.9 stdlib only | Apache-2.0 (a "faithful port" of the Node/TS `Jozo132/open-sld-to-step`, also Apache-2.0; NOTICE file says clean-room from [MS-CFB], ISO 10303, and public NIST sample files) | OLE2 and "sw3d" (2015+) containers; Parasolid XT binary, base schema 13006 with edit scripts; full topology to STEP AP214 solids | 4 stars; **no sample parts shipped**; `gate.py` (packaging and "solid or typed error") and `fuzz.py` (malformed input, truncations, bit flips); typed error codes; deterministic output; pushed 2026-09-02 | Yes (Apache-2.0). Good reference for XT-to-STEP mapping choices |
| blussyya/sldprt-format-research | JavaScript (Node 18+, no deps) | MIT | Modern and 2011 containers (CRC checked); DisplayLists mesh and surface records; Parasolid body (planes, cylinders, cones, spheres, tori, B-splines; swept and blend nodes read but not evaluated); STL export; STEP export is **faceted for curved faces** (exact writer "next") | 13 stars; 73-file corpus (49 purpose-built in SW2011 and SW2022 with SolidWorks STEP/STL/X_T/X_B exports); claims 0 failures over 28,428 graph checks; corpus lives in a separate "dump" repo (MIT); 4 sample SLDPRTs in repo; golden-file tests; pushed 2026-10-03 | Yes (MIT). Best prose spec of any project |
| Wintaru/model_viewer | TypeScript (browser) | MIT | Cached display mesh only (stream with `uoTempFaceTessData_c`), including assemblies and (2026) files; no Parasolid B-rep. STEP/IGES via OCCT WASM | 1 star; NIST bounding-box check: 7 of 11 parts within 2 percent or 0.5 mm of the STEP twin; drawings not supported; 2026-file result is claimed, not reproducible | Yes (MIT), only for the mesh fallback; blussyya's format doc is better |
| cadmpeg/cadmpeg (`cadmpeg-codec-sldprt`) | **Rust** (workspace of ~20 crates incl. `cadmpeg-ir`, `cadmpeg-asm`, `cadmpeg-parasolid`-related, `cadmpeg-codec-step`) | Apache-2.0 code, CC-BY-4.0 docs | Both containers, CRC blocks, cache cells, tail directory; Parasolid partition+deltas grouped by site, active configuration selection; topology; analytic and NURBS carriers; swept/spun to NURBS; offset; constant-radius rolling-ball blends; variable-radius blend result faces via solved NURBS; validated intersection curves; display mesh; colours and appearances; configurations; Keywords XML feature history; ResolvedFeatures sketches; PMI; limited write-back | 143 stars; created 2026-07-10, pushed daily; 550 files under the sldprt crate; fuzz entry points; CC0 contributor corpus with manifest; official rating for `.sldprt` is **L1 (opened)** on its own ladder, though the README and spec describe far more (geometry "Partial") | Yes (Apache-2.0) and, being Rust, the closest to a drop-in |
| monozukuri-ai/parasolid-kit (and `sldkit` from the same owner) | Rust core with Python bindings (parasolid-core) | MIT AND Apache-2.0 (kit); `sldkit` shows licence "other" | Parasolid X_T/X_B, 30+ exact schema profiles including one SolidWorks key (SCH_3701229_37102_13006); byte-exact X_B reconstruction; optional OCCT/STEP/GLB | 8 stars; honest docs: delta streams stop at first unknown record type; private fixtures | Yes for XT (MIT/Apache); `sldkit` unknown, check before use |
| khoanguyen-3fc/ps-parser | Python | MIT | XT binary, schema-aware | 2 stars | Yes, small |
| akiselev/xt-parser | Rust | none stated (default: all rights reserved) | XT, "WIP alpha" | 0 stars | No (no licence) |
| KenM76/swformat | Python | Apache-2.0 | Container, properties; **writes** property edits by span preservation; no geometry | small | Yes for container/property ideas |
| dsandall/sld2step | not read | **AGPL-3.0** | SLDPRT/SLDASM to STEP and glTF | exists | **No. Not read. AGPL code must not be copied or ported into our code** |

Cross-checks between sources:

* openswx, sldprt2step, blussyya and cadmpeg agree on the block marker `14 00 06 00 08 00` and the CRC-32 of the
  inflated stream; they disagree only in field naming and in how names are masked (nibble swap vs rotation).
* blussyya, cadmpeg and parasolid-kit all note that `(deltas)` sections exist but that complete update semantics
  are not established. This is the single most important unknown for exact geometry of edited parts.
* Quality signals worth discounting: several of these repos contain agent instruction files (for example
  CLAUDE.md or AGENTS.md), so reported pass counts should be reproduced, not trusted.

## 4. Parasolid XT format

### 4.1 Where the specification is and its terms

| Item | Finding |
|---|---|
| Document | "Parasolid XT Format Reference", October 2006 (123 pages), UGS Corp. (now Siemens Digital Industries Software). A later edition, April 2008, is cited by parasolid-kit. |
| Where | Not found on a Siemens download page. Third-party mirrors: a documentation site mirror (cited by Wikipedia, archived 2023) and a CAD forum upload (cited by parasolid-kit). Wikipedia cites Siemens' "Data Access and Translation" page for the claim that the format is documented and open. We could not verify what Siemens' page offers today. |
| Terms | Copyright notice: all information is UGS property; no part may be reproduced, stored in a retrieval system or transmitted in any form without prior written permission; provided "as is"; export-control clause. There is **no open licence**. |
| Intent | The introduction says the format is published so applications can access Parasolid models without using the kernel, and that the main audience is people writing translators from or to it. It advises that reading is simple and writing should only be attempted with a copy of Parasolid available to check validity. |
| Implication | Implementing a reader from it is its stated purpose. Copying text or tables into our repo or redistributing the PDF is not permitted. Cite and paraphrase only; keep our own field tables derived from the document and from observed files. Ask Siemens (or confirm with counsel) before publishing any derived table that closely tracks theirs. |
| Other public sources | The reference's schema material is also what cadmpeg and parasolid-kit encode (parasolid-kit stores reviewed base definitions with SHA-256 hashes). Wintaru claims the format is also published within the ISO 14306 (JT) specification; we did not verify that. |

### 4.2 Schema versions seen in SolidWorks files

* Every SolidWorks file in blussyya's corpus uses base schema 13006 under modeller versions between 31 and 35
  (for example `SCH_3301247_33103_13006`); Wintaru's SW2018 sample is `SCH_3000269_30000_13006` (Parasolid v30);
  parasolid-kit documents a SolidWorks 2026 key `SCH_3701229_37102_13006`.
* The file does not repeat each node's full layout; the first occurrence of a type carries an edit script
  (copy, delete, insert, append over the base schema). A reader must implement that. This is how one reader
  handles 2011 and 2022 files (the 2022 BODY has extra pointer fields).
* Binary is big-endian; header is `PS 00 00`, description string, schema name, max node types, user field size
  (must be 0). Pointers are signed 16-bit with a long form; null sentinels are -32764 (integer) and -3.14158e13
  (double). Pointer words must never go through null conversion (blussyya).
* Corrections to the 2006 reference observed on real files: BODY includes `nom_geom_state`, EDGE has one
  attributes pointer, ELLIPSE has a `sense` field (blussyya, EXP-071, claimed).
* Coordinates are metres; surface orientation is `surface.sense` times `face.sense`.

### 4.3 Node types and mapping to our B-rep

Our `ck-topo::Body` hierarchy (per `ck-io/src/step/read.rs`): lumps, shells, faces, loops with coedges and
pcurves, edges bounded by `[t0, t1]` on a carrier curve, vertices. Faces on periodic surfaces get explicit seam
and pole structure. Units are millimetres internally.

Topology:

| Parasolid node (type id) | Meaning | Ours | Gap |
|---|---|---|---|
| WORLD (101) | partition root | none | trivial |
| BODY (12) | solid, sheet or wire body; resolution fields 1e-8 linear | `Body` | multi-body handling: STEP importer returns one `Body` with many lumps; map each solid region to a lump |
| REGION (19) | one solid region plus void region | lump / void shell | void region tagging needed |
| SHELL (13) | face, edge, vertex lists | `ShellId` | acorn and wire shells have no analogue |
| FACE (14) | surface, sense, loop list, tolerance, `node_id` | `FaceId`, `FaceName` | keep `node_id` for joining with the mesh and for stable names |
| LOOP (15) | ring of fins | loop | |
| FIN (17) | half-edge, forward/backward/other, sense | coedge | |
| EDGE (16) | curve, two fins, tolerance, `node_id` | `EdgeId` | tolerant edges (curve only on fins) need a rebuild from fin SP-curves |
| VERTEX (18) + POINT (29) | | `VertexId` | |

Surfaces:

| Parasolid | Type id | Ours (`ck-geom::surface::Surface`) | Fidelity | Gap |
|---|---|---|---|---|
| PLANE | 50 | `Plane` | exact | none |
| CYLINDER | 51 | `Cylinder` | exact | none |
| CONE | 52 | `Cone` (radius at v=0, semi angle) | exact | convert sin/cos half angle; apex handling |
| SPHERE | 53 | `Sphere` | exact | none |
| TORUS | 54 | `Torus` | exact | lemon/apple (self-intersecting) tori have no analogue; sldprt2step maps to a degenerate toroidal STEP surface |
| B_SURFACE / NURBS_SURF | 124 / 126 | `BSpline(BSplineSurface)` | exact | none; periodic and rational flags to verify |
| SWEPT_SURF | 67 | `Extrusion { profile, dir }` | exact when the section curve is representable | only the linear-sweep case; cadmpeg converts to NURBS when profile is NURBS/circle/ellipse |
| SPUN_SURF | 68 | `Revolution { profile, axis_o, axis }` | exact | none |
| OFFSET_SURF | 60 | `Offset { base, dist }` | exact (recursive offsets supported by cadmpeg) | sign convention vs base normal |
| BLENDED_EDGE (rolling ball) | 56 | none | sldprt2step: **approximated** by interpolated NURBS and reported; cadmpeg: exact for constant radius via NURBS, variable-radius through solved NURBS | need a NURBS sampler of the rolling-ball construction; our `BSpline` can hold the result |
| BLEND_BOUND | 59 | none | support data for blend boundaries | needed to place trims on blends |
| (Screw) | n/a | `Screw` | our own extra | no XT counterpart |

Curves:

| Parasolid | Type id | Ours (`Curve`) | Fidelity | Gap |
|---|---|---|---|---|
| LINE | 30 | `Line` | exact | none |
| CIRCLE | 31 | `Circle` | exact | none |
| ELLIPSE | 32 | `Ellipse` | exact | none |
| B_CURVE / NURBS_CURVE | 134 / 136 | `BSpline` | exact | none |
| TRIMMED_CURVE | 133 | edge bounds `[t0, t1]` | exact | map end parameters |
| INTERSECTION (with CHART, LIMIT) | 38 / 40 / 41 | none as a procedural; `BSpline` | **approximate**: sldprt2step interpolates cubic splines through chart points (reported); cadmpeg "validated" intersection curves | choose tolerance and refinement against both surfaces (we have `ck-geom` fit and pcurve modules) |
| SP_CURVE | 137 | `pcurve` module | exact in 2D, approximate in 3D | store pcurve directly (better than STEP: our loops carry pcurves) and evaluate the 3D curve from the host surface |
| Polyline, foreign (PE) curves | | none | unsupported (sldprt2step errors) | accept as unsupported with typed error |

Honest limits recorded by the sources: blussyya reads but has not evaluated B-spline, swept and blend surfaces,
and the production-only types (intersection curves, fin-curve edges, swept surfaces, blends) have no STEP twin
in its corpus. cadmpeg lists open items for duplicate-identity precedence, missing intersection witnesses,
surface-owned edge-curve attributes, offset carrier grammar and variable-radius blend carriers.

### 4.4 Evidence on exactness

* blussyya: the embedded body matches SolidWorks' own STEP export face by face, edge by edge, vertex by vertex
  on all 49 controlled models (worst deviation about 9e-18 m, with 20 of 20 injected mutations detected). B-spline
  loft control points and knots are identical. STEP splits closed periodic faces at seams (287 native faces
  became 331 STEP faces), so face counts must be compared after seam accounting. Two lofts differ between the
  embedded body and the X_T export in a geometry-state flag and curve references (which is authoritative is open).
* sldprt2step: says the result is dimensionally faithful within spline tolerance, not a bit-exact round trip,
  and warns of long run times on fillet-heavy parts (pure Python rolling-ball reconstruction).

### 4.5 Deltas, ghosts and configurations

SolidWorks stores a partition plus a "deltas" transmit. parasolid-kit stops at the first delta record type it
cannot resolve and refuses to claim deltas were applied. cadmpeg groups partition and deltas by "site", lets a
complete deltas record supersede a partition face in some cases, and lists the exact replacement rule as open
item BC-03. blussyya reads the first section of the partition only. So: **for freshly saved simple parts the
partition alone is the body; for parts with edits or configurations the correct body may depend on undecoded
delta rules.** Our validity and volume gates (phase C) are the safety net.

## 5. Phased plan for a Rust crate

Working name: `ck-sldprt` (new crate, depends on `ck-geom`, `ck-topo`; no dependency on `ck-io`'s STEP code).
Effort is in focused engineering days for one developer familiar with the kernel. Numbers assume reuse of
permissively licensed sources as specs and, where Apache/MIT, as ported code with attribution; they roughly double
if starting from the PDF alone.

| Phase | Scope | Days | Deliverable / exit gate |
|---|---|---|---|
| 0 Spike | Run cadmpeg-codec-sldprt and blussyya CLI on the public corpus; compare their face counts and volumes to STEP; decide depend vs own | 3-5 | go/no-go memo; table of pass/fail per file |
| A Container and metadata | CFB v3/v4 reader; modern block scanner with false-marker rejection (accept only plausible sizes, printable decoded names, first occurrence wins); CRC-32; name unmasking; framed zlib sections; version detection; custom properties, configuration names, mass properties, thumbnails, cut-list (openswx parity) | 6-9 | openswx's own test inputs parse to identical property values; every CRC verified; corrupt-input corpus rejected with typed errors |
| B Parasolid XT reader | Header and embedded schema edit scripts; node stream with variable-length fields; pointer encoding; typed node structs for the node set in section 4.3; graph checks (loop closure, paired fins with opposite senses, knot monotonicity); standalone `.x_b` and `.x_t` reading for tests | 10-15 | parses 100 percent of corpus partitions to the terminator; zero graph-check failures; round trip of `.x_b` byte coverage (parasolid-kit style) |
| C Map to `ck-topo::Body` | Direct construction (no STEP): units metres to millimetres; surface and curve mapping per tables above; seams and poles via the same helper the STEP reader uses for periodic faces; pcurves from SP_CURVE; intersection curves and blends as fitted B-splines with recorded max error; tolerant edges; void shells; multi-body | 12-20 | for each corpus part: `ck-topo` check passes (closed, oriented); volume, area, bbox, face and edge counts match the SolidWorks STEP export of the same part within 1e-6 relative (bbox 1e-4 mm); typed list of approximated carriers |
| D Mesh fallback | DisplayLists parse (typed arrays, strip triangles with per-strip winding reset, boundary edge ids), build a triangle `Body` or a render-only mesh with face ids so the GUI can still show and pick faces when B-rep mapping fails | 5-8 | closed mesh on controlled cubes; bbox equal to B-rep; used automatically on phase C failure with a visible warning |
| E Feature tree (research only) | Catalogue class names in `CArchive` streams; study cadmpeg's `history` modules and Keywords XML; decide whether names, parameters and sketches are worth importing as a read-only "history outline" | 5-10 (research) | note; no committed implementation |
| F Hardening | fuzzing, limits, documentation, attribution ledger | 4-6 | CI fuzz job; limits table; licence rows |

Total if built ourselves: roughly 45-70 days for A-D plus hardening. Total if cadmpeg proves usable as a
dependency and we write only the adapter plus gates: roughly 15-25 days.

### 5.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Deltas change the body for edited parts | Medium | wrong geometry, silently | compare with STEP volume; refuse or warn when a deltas section exists and cannot be applied (as parasolid-kit does) |
| Blends and intersection curves approximated | High on real parts | trimming gaps, volume error | report max deviation; re-use our heal and fit modules; compare gaps in `ck-heal` |
| Schema edits for newer Parasolid versions | Medium | parse stops | strict reader with typed error carrying position; never scan forward for markers (blussyya rule) |
| Container variants not in any corpus (assemblies, multi-config, sheet metal, weldments) | Medium | unsupported files | detect and refuse; scope parts only |
| Provenance of upstream reverse-engineering | Low-Medium | legal | section 7; record where each fact came from |
| cadmpeg too heavy or unstable | Medium | rework | spike first; vendor only the sldprt and parasolid crates behind our trait |
| Unsupported surface types in kernel (variable blends, lemon torus) | Medium | partial import | import as B-spline where possible; otherwise face-level failure with id |

### 5.2 Test corpus and verification

Public sample files (check each licence before committing a file; most should not be committed, only fetched):

| Source | What | Licence / terms | Use |
|---|---|---|---|
| NIST MBE PMI validation and conformance test cases (CTC/FTC/STC series) | Native SolidWorks parts (the SW 2018 versions, e.g. `nist_ctc_01_asme1_rd_sw1802.SLDPRT`) with STEP/PDF twins | US Government works, public domain (sldprt2step's NOTICE and Wintaru rely on this; confirm on the NIST page) | The best public ground truth: native part plus STEP twin |
| NASA JPL Open Source Rover | SLDPRT parts (Wintaru demo uses the wheel tire) | Apache-2.0 per Wintaru | Real production geometry with fillets |
| blussyya/sldprt-research-dump | 73 parts (49 purpose-built, SW2011 and SW2022) each with SolidWorks STEP, STL, X_T, X_B exports and recorded surface types | repository licence MIT (check per-file terms of the 24 "production" parts, which are not the author's) | Controlled geometry for each surface type; also lets us test XT reader on `.x_t`/`.x_b` exports |
| blussyya/sldprt-format-research `samples/` | 4 small parts (3 from SW2022, 1 from SW2011) | MIT repository | CI fixtures (small) |
| cadmpeg `corpus/` | Contributor-authored fixtures donated CC0 under a manifest with SHA-256 | CC0-1.0 | Public-domain fixtures; follows LEGAL.md donation rules |
| Our own parts | Author in SolidWorks (if licensed for sharing outputs) or have colleagues export | ours | Add one file per surface family: plane, cylinder, cone, sphere, torus, loft, sweep, fillet, variable fillet, shell, imported body |

Verification protocol per part (the same used by the format-research repo, reproduced independently):

1. Export STEP from SolidWorks of the same part; import with `ck-io` STEP (our existing path).
2. Import SLDPRT with `ck-sldprt`.
3. Compare: bbox, volume, surface area, centre of mass, inertia (use `ck-topo::mass`); face count after
   accounting for seam splits; edge and vertex counts; per-face surface type and area; Hausdorff sample of
   points from each body to the other (tolerance 1e-3 mm for approximated carriers, 1e-6 for exact).
4. Join with the display mesh by `node_id`: the format-research repo claims face ids match on 1,414 of 1,414
   faces and edge ids on 1,408 (6 empty edge tables in a re-saved file). We should reproduce the ratio on the
   public set; any lower value means we mis-read ids.
5. Record per part: ok, ok with approximations (list), failed with typed error.

Gate to call phase C "done": all controlled models pass volume and area within 1e-6 relative, no `ck-topo`
check failure, and zero silent fallbacks.

### 5.3 Fuzzing and safety (untrusted files)

* Memory-safe Rust, `#![forbid(unsafe_code)]` in the crate; no panics on input (return typed errors; parser
  functions never index without bounds checks).
* Hard limits, all configurable: input size (blussyya uses 128 MiB), decompressed bytes per stream and total
  (sldprt2step's one admitted weakness is an uncapped zlib output, a decompression-bomb risk), compression ratio
  cap, number of blocks, nodes, faces (blussyya: 50,000), vertices (2 million), NURBS control points, recursion
  depth for references (our STEP reader already has a nesting guard), time budget for fitting.
* Decompress with a bounded writer and compare against the declared inflated length and CRC.
* Reject cyclic CFB FAT/directory chains, bad sector shifts and out-of-range sectors (blussyya lists these
  controls).
* Strict XT reader: require terminator, reject duplicate node indices and trailing bytes.
* Fuzz targets with `cargo-fuzz`: container scanner, CFB, framed zlib, XT header/schema, XT node stream, mesh
  parser, then end-to-end. Seed with the corpus; cadmpeg and cadkit both ship fuzz entry points to copy as a
  pattern (cadkit has a `fuzz` directory).
* Treat metadata strings as hostile (file paths, user names, part numbers appear in plain text per Wintaru):
  do not log or echo them to remote services; strip in telemetry.
* Never execute or follow OLE items (`OleItems`, embedded objects).

## 6. Packaging options

| Option | Pros | Cons |
|---|---|---|
| A. Crate inside our kernel repo (`ck-sldprt`) | Same CI, same validity gates; can share seam and pcurve helpers with `ck-io` STEP reader; one release | Couples third-party licence rows into the kernel repo; larger repo; legal review applies to the kernel; if we later publish the kernel, SLDPRT code ships with it |
| B. Separate crate/repo next to the kernel (`ck-sldprt` or `sldprt-rs`) with a neutral output struct and an adapter feature | Clear licence boundary; reusable by others; can be dual MIT/Apache; kernel stays clean; independent release cadence | Duplicated data model unless it targets cadmpeg's IR or a small neutral B-rep; extra CI |
| C. Contribute to cadmpeg | Already Rust, already 3D, already has container, XT, NURBS, blends, mesh, history and a CC0 corpus and fuzzing; community maintenance; our adapter could be an `fw` exporter from its IR | Their ladder and IR may not match our validity needs; project is three months old and moving fast; provenance declaration and DCO sign-off on every PR; they decide scope |
| D. Contribute to cadkit | Pure Rust, clean-room, small and tidy, same dual licence and maintainers who like `Unknown` fallbacks | Neutral model is 2D drawings (DWG/DXF/DGN and CityGML); a 3D B-rep family is a new architecture decision; open an issue first; likely out of scope |
| E. Depend on cadmpeg crates from our repo | Fastest start | Pulls a ~20-crate workspace; API instability; their IR is not our `Body` so we still need the adapter |

Recommendation inside this table: **E during the spike, then B or C**. Choose B (own thin crate, adapter-only)
if cadmpeg's decoder quality holds up but we do not want its whole workspace; choose C if we want to improve the
shared decoder and are willing to follow its provenance rules.

### 6.1 Licence ledger and attribution rows

| Source | Licence | What we would take | Attribution row needed | Condition |
|---|---|---|---|---|
| cadmpeg code | Apache-2.0 | code (if vendored or ported) | yes: NOTICE entry, keep licence text, state changes | Apache-2.0 section 4: licence copy, change notice, retain notices |
| cadmpeg docs (format spec) | CC-BY-4.0 | facts and structure descriptions we reuse in our docs | yes: attribute to cadmpeg project | attribution; no endorsement |
| sldprt2step and open-sld-to-step | Apache-2.0 | mapping decisions, error taxonomy, test-harness ideas; code if ported | yes: both repos (the Python is a port of the Node/TS original) | NOTICE propagation |
| blussyya format research | MIT | format notes (stream layouts, tag tables); code if ported | yes | MIT notice kept; its corpus is separate |
| openswx | MIT | container and XML property parsing ideas/code | yes | MIT notice |
| Wintaru model_viewer | MIT | mesh-decoding notes only | yes if used | MIT notice; its demo directory bundles OCCT WASM and licence files, do not take those |
| parasolid-kit / parasolid-core | MIT AND Apache-2.0 (mixed; "adopted partial readers" are Apache-2.0) | schema catalogue ideas; code only after reading its PARTIAL_READERS provenance file | yes, both notices if any code is taken | check provenance file |
| ps-parser | MIT | schema-edit-script parsing idea | optional | MIT notice |
| xt-parser (akiselev) | no licence | nothing | no | do not copy |
| sld2step | AGPL-3.0 | nothing | no | **do not read, copy or port; copyleft would apply to the whole combined work** |
| Siemens XT Format Reference | proprietary, copyright, no redistribution | facts about the format, read for implementation | citation only | do not copy text/tables; do not redistribute PDF |
| NIST test files | public domain (US Government work) | test inputs | credit NIST | confirm per file |
| NASA JPL Open Source Rover files | Apache-2.0 (per Wintaru) | test inputs | yes | fetch rather than vendor |
| cadmpeg corpus | CC0 | test inputs | optional | |

Legal background (non-lawyer):

* Reading a file format for interoperability is widely treated as permissible in many jurisdictions, including
  statutory interoperability exceptions to reverse-engineering restrictions (for example in the EU software
  directive and in US case law on interoperability). Details vary by country, by whether you accepted a licence
  agreement that forbids reverse engineering, and by whether any technical protection measure is circumvented.
  We are in Australia; get a short review before shipping publicly.
* "Clean room" means the implementers derive format knowledge from (a) files they are entitled to possess and
  observe, (b) public documentation and (c) code under compatible open licences, and not from the vendor's SDK,
  source, leaked material or decompiled binaries. The projects above state this posture (cadmpeg's LEGAL.md is
  the most explicit: forbidden sources include vendor SDKs, decompiled binaries, NDA material, files you are not
  entitled to share, and protection-measure bypass; PRs carry a provenance sentence and a DCO sign-off).
* Do not decompile or disassemble SolidWorks or Parasolid binaries; do not use the SolidWorks API or SDK to
  learn the format; do not use leaked documents. Prefer test files you authored or that carry a public licence.
* Do not circumvent encryption or licence checks. None is needed for the streams above, but if a future file
  version adds one, stop and re-review.
* Trademarks: use "SolidWorks" and "Parasolid" only nominatively to say which files the code reads, with the
  usual notice that they are marks of their owners (all the projects above do). Do not use them in a crate or
  product name (cadmpeg avoids it; two of the repos here do name themselves after the format, which is
  riskier than their licence suggests).
* Patents and copyrights in the XT document: implementing a reader from a published format spec is its stated
  purpose; copying the document is not allowed. We found no statement about patents; none was investigated.
* Copyleft contamination: AGPL-3.0 applies network-use copyleft; copying or even closely porting AGPL code into
  our crates would force AGPL on the combined work. Avoid reading it to eliminate the claim of derivation.
* Test files: files in someone else's SolidWorks account may be restricted by educational or trial licences;
  prefer NIST, Apache-licensed rover files, CC0 donations, and our own.

## 7. Open questions

1. Is `cadmpeg-codec-sldprt` as good as its spec suggests? Its own ladder rates it L1 while the docs describe
   far more; we need the spike to measure face counts, volumes and failures on the public set.
2. Do deltas ever change the body for ordinary edited parts, and what is the replacement rule (cadmpeg BC-03,
   parasolid-kit delta boundary, blussyya "role not established")?
3. Which body is "the part" in multi-body, multi-configuration and imported-body parts (LocalBodies,
   GhostPartition)? Only one imported-body example exists in the format-research corpus.
4. How should we represent blends and intersection curves: approximate B-splines with a recorded tolerance, or
   a procedural surface kind in `ck-geom`? Does our kernel need a rolling-ball blend representation to keep
   fillet edits editable after import?
5. Does the display mesh matter beyond fallback? It gives face ids and triangle strips for fast preview; the
   GUI may prefer to tessellate our own B-rep once imported.
6. Siemens permission: is it acceptable to cite the XT reference table-by-table in our docs, and is there an
   official current URL for the reference and its terms?
7. Version coverage: SolidWorks 2019 to 2025 files are only indirectly evidenced (production parts with
   unrecorded versions, a private 2026 set). We need a tiered sample of actual versions from users.
8. Do we want assemblies (`.SLDASM`, referenced external parts by path), drawings or PMI? None of the B-rep
   decoders support them; openswx reads assembly structure and BOM metadata only.
9. Which legal review do we want (Australia, plus the country of any distribution) and should we contact the
   cadmpeg maintainers first, given their DCO and provenance requirements?
10. Should an issue be opened with the cadkit maintainers anyway, to ask whether a 3D B-rep crate family is in
    scope? Expected answer: no, since the model is 2D; asking costs little.

## Appendix: sources consulted

Public repositories (read through the GitHub API; no code cloned or copied): schwitters/openswx,
BlinkingSun/sldprt2step (and its upstream Jozo132/open-sld-to-step, noted only), blussyya/sldprt-format-research
(README, docs/format/*, validation, open-questions, history), Wintaru/model_viewer (README, research findings,
engine source header), cadmpeg/cadmpeg (README, LEGAL, docs/formats/sldprt.md, open items, format support,
corpus README, crate listing), monozukuri-ai/parasolid-kit, khoanguyen-3fc/ps-parser, akiselev/xt-parser (listing
only), KenM76/swformat, TNYCL/cadkit (README, repository listing). dsandall/sld2step: existence and licence only;
source deliberately not read. Siemens/UGS "Parasolid XT Format Reference", October 2006: front matter and
introduction read to establish terms and intent; Wikipedia article on Parasolid for the reference's published
locations.

Local code reviewed: the STEP reader (`ck-io/src/step/read.rs`) and the surface and curve enums in `ck-geom`.
