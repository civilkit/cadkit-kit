# Library browser

The **Libraries** tab of the Catalog (switch at the top: **Primitives | Libraries**) is ONE list of parts. The parametric BOSL2 entries and
the app's bundled samples are marked **Included**; libraries you add (a GitHub repository, a web address or a folder on disk) are marked
**Add-on**. Every card looks the same: a picture, the name and the mark. The design is in `docs/spec-library-browser.md`.

Parts are **data only**: a `.ckpart` document (BOSL2 entries are scripts of the app itself). Nothing downloaded from a library is ever run
(no script, no code).

## Using it

1. Open the Catalog tab and choose **Libraries**. One search box covers every library (title, id, category, tags; BOSL2 matches come
   first). The chips **All / Included / Add-ons** and the **category** menu narrow the list.
2. **Drag a card onto the model**, or click it and then click a face (Alt: no snapping, Esc: cancel). The ghost follows the pointer and the
   part is previewed in place, translucent. Works for every card, whether or not the part is on this device: a part that is not is
   fetched and verified first, with a spinner, and an error message if that fails. Place on / Direction (the Placement row) apply.
3. Clicking a card selects it: a BOSL2 entry shows its parameter form; a library part shows its detail panel (library, licence,
   category, size, links, and the actions **Insert**, **Open as new document**, **Download**, **Install**). **Insert** adds the part
   at its own origin, as one undo step; dragging chooses where it goes (below).
4. **Install** (a button on hover for parts that come from the network, also in the detail panel) downloads, verifies and keeps the part on
   this device (IndexedDB) so it works offline. The card's badge shows a cloud until then and **Installed** after. Dropping or inserting
   a part installs it too (it is cached when fetched).
5. **+ Add library** (in the header): type `github:owner/repo` (optionally `@branch-or-tag`), the `https` address of a `library.json`, or
   pick a folder that holds a `library.json` and its files. The app fetches and checks the list and shows the name, the part count, the
   licence and **how many parts have no image** before the library is added.
6. **Manage libraries** (under the list): one row per library with its mark, part count, licence, a link to its page, and for add-ons
   **Refresh** and **Remove library** (removes it and its cached files). Without a network the cached list and the parts you installed
   keep working, and an **offline** badge shows.

### Every part has an image

| Where the part comes from | Its image |
| --- | --- |
| BOSL2 entries | `catalog/bosl/thumbs.generated.ts` (rendered from the kernel body of each entry) |
| Bundled samples | `public/samples/thumbs/<id>.webp`, made with the sample thumbnail renderer (480x360, grey-blue solid with dark edges) |
| Add-on parts | the manifest's `thumb` |
| A part without one | when it is installed, rendered on this device from its kernel geometry (`@kit/snapshot`), saved with the part (keyed by its sha256) and reused; this runs in the background, one part at a time, when the browser is idle and never during a drag. Until then (and for parts not installed) a placeholder with the category's icon. |

A manifest without `thumb` on a part is only a **warning**. Publishers can make the images with `node tools/library_thumbs.mjs <library
folder>` (see "Publishing a library").

### Where a dropped part goes

The part's origin goes to the drop point and its up (the normal of the plane its first sketch is drawn on, usually +Z) points along the
face normal, standing ON the face (geometry of the part below its own origin plane sinks into the face). Dropped on a datum plane, a
reference plane row of the tree or the empty ground, it goes onto that plane at the pointer (the first body on the ground plane, like a
primitive); Direction "down" hangs it below the plane. It is ONE undo step, with the variables prefixed and the ids renumbered.

How: the part's root sketches are re-seated, not its geometry moved. A sketch on the part's own standard plane gets the target face or plane
as its plane and its points are shifted by the drop point; offset planes made from that plane and the sketches on them follow; edge
references (`faces` + `at`) have their `at` point carried along. Everything else hangs off those sketches by id.

A part is moved only when that is certain to be right. These stay at their **own origin** (and a notice says why): a curved target face; a
part drawn on several standard planes (top and front...) or with sketches on planes derived by other modes than offset; world axes
(`{kind:'axis'}`), world coordinates or directions in its features (patterns by a vector, `dir`...); assemblies (`insertPart`, `mate`),
`moveBody`, 3D sketches; and edge references when the target is a datum plane feature. Rotate and Mirror of the Placement row do not apply
to library parts (Direction does, on planes).

### Licences

Each library (and optionally each part) states an SPDX licence id. MIT, BSD, Apache-2.0, ISC, CC0, CC-BY, OFL and Unlicense (and
combinations of only these) are taken as permissive. Anything else, including a missing licence, asks for **one** explicit confirmation
per library and licence ("GPL-3.0: parts taken from this library may carry its terms"). When you add such a library the confirmation
is the "I understand" box in the add dialog; for a part under a different licence than the library it is asked at first use. The choice
is remembered on this device only and is never written into documents. This is a notice, not legal advice. The bundled samples are
never asked about.

### Where a part came from

Inserting a part, or opening one as a new document, records it in the document's `sources` list: library name and id, part title and id,
the ref the library was read at (`HEAD`, a branch or a tag; empty for web and folder libraries), the sha256 of the part file, its licence
and its page. The Libraries tab lists the sources that are still in the open document (an undone insert drops out of the list). The
field is saved with the document like the other viewer fields (`appearance`, `bodyNames`) and is not an undo step of its own.

## Adding a GitHub library

The app ships with no GitHub library in its default list (there is no public repository for it yet). To use one, publish a repository
as described below and add `github:owner/repo` in the dialog. To make a library part of the defaults for a build, add an entry to
`apps/cad/src/library/libraries.default.json`; a default whose source is `bundled:<folder>` reads `<folder>/index.json` from the app
itself (the samples), other default sources are not supported yet.

Files are read from `raw.githubusercontent.com` (with the jsDelivr mirror as a fallback when the first server fails with a 5xx or 429).
The GitHub API is never called, so there is no rate limit to hit, and private repositories are not supported (token support is a later
phase). Because a branch can move, give a tag or a commit sha as the ref (`github:owner/repo@v1.0`) when you want a fixed version; each
part's `sha256` is checked either way.

## Publishing a library

A library is a folder (a repository root, or any web directory) with a `library.json` and the part files it lists. Run
`node tools/library_thumbs.mjs <folder>` to render `thumbs/<id>.webp` for every `.ckpart` (png without the `cwebp` tool) and fill `thumb`
in `library.json`; it skips parts that already have an image unless `--force` (`--size WxH`, `--png`). Compute the checksums after.

```
my-parts/
  library.json
  parts/motor-2212.ckpart
  parts/bearing-608.ckpart
  thumbs/motor-2212.png       (optional, png / webp / jpeg, at most 1 MB)
```

`library.json`:

```json
{
  "format": "fwlib",
  "version": 1,
  "name": "Example parts",
  "description": "Motors and bearings.",
  "homepage": "https://example.com/my-parts",
  "licence": "CC0-1.0",
  "parts": [
    {
      "id": "motor-2212",
      "title": "BLDC motor 2212",
      "category": "motors",
      "tags": ["bldc", "28mm"],
      "file": "parts/motor-2212.ckpart",
      "thumb": "thumbs/motor-2212.png",
      "licence": "CC0-1.0",
      "source": "https://example.com/my-parts/motor-2212",
      "bytes": 15000,
      "sha256": "<64 hex digits of the sha256 of the part file>"
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `format`, `version` | exactly `"fwlib"` and `1` |
| `name` | 1 to 100 characters |
| `description`, `homepage` | optional; `homepage` must be an `https` address |
| `licence` | an SPDX id (`MIT`, `GPL-3.0-or-later`, `CC-BY-4.0`, ...), per library; leave it out and it shows as unknown |
| `parts` | at most 5000, every one listed (the browser never lists a directory) |
| `parts[].id` | letters, digits, `.`, `_`, `-`, up to 64, unique in the library |
| `parts[].title` | 1 to 120 characters |
| `parts[].category`, `tags` | free text (lower-cased); up to 20 tags |
| `parts[].file` | path relative to `library.json`, ending `.ckpart` or `.json`; no `..`, no absolute path, no other server |
| `parts[].thumb` | optional (a warning when missing) image path, same rules, `.png`, `.webp` or `.jpg` |
| `parts[].licence` | optional; overrides the library's licence for this part |
| `parts[].source` | optional `https` link to the part's page |
| `parts[].bytes` | optional; if present the downloaded file must have exactly this size |
| `parts[].sha256` | required for web and GitHub libraries; the downloaded file must match or it is refused |

Unknown fields are ignored, so the format can grow. Compute the checksum with `sha256sum parts/motor-2212.ckpart` and update the
manifest whenever a part file changes.

A part file is a normal `.ckpart` (save it from the app): `format: "ck-part"`, a `features` list and optionally `variables` for its
parameters. Keep it small; the limits are **1 MB for the manifest and 16 MB for a part**. Expect other people's documents to receive the
part's variables under a prefix, so name them for what they are (`length`, `bore`).

## Safety

Everything that arrives from a library is untrusted. The manifest is validated against the schema above, sizes are capped while
reading, text is stripped of control and direction-override characters and shown as plain text (never as markup), links are only made
for `https` addresses (`http://localhost` is allowed in development builds only), a redirect to a non-HTTPS address is refused, and a
file path in a manifest cannot leave the library's folder or name another server. A thumbnail is only shown if its first bytes are a
real png, webp or jpeg. A downloaded part goes through the same checks as opening a file (valid JSON, a feature list with unique ids,
valid variable names), and the kernel then validates its features: on Insert the document is rebuilt first and left untouched if any
feature fails. Nothing in a part, including a stored `script`, is executed.

## Code map

| File | What |
| --- | --- |
| `apps/cad/src/library/manifest.ts` | types, schema validation, licence classes, limits |
| `apps/cad/src/library/source.ts` | source parsing (`github:`, https, local, bundled), the single injectable `fetch`, size-capped reads |
| `apps/cad/src/library/cache.ts` | IndexedDB cache (and an in-memory one for tests) |
| `apps/cad/src/library/registry.ts` | list, add, remove, refresh, licence confirmations, cache-first manifest and part reads |
| `apps/cad/src/library/insert.ts` | the Insert patch (variable prefix, feature renumbering) and the `sources` helpers |
| `apps/cad/src/library/actions.ts` | provenance entries, Open as new, Insert on a controller |
| `apps/cad/src/library/entries.ts` | the unified list: entries of BOSL2 and of every library, filter and search, categories |
| `apps/cad/src/library/LibraryBrowser.tsx`, `AddLibrary.tsx`, `CategoryIcon.tsx` | the UI: cards, filters, detail panel, manage list, add flow, placeholder icons |
| `apps/cad/src/library/place.ts`, `buildPlaced.ts` | moving a part onto a drop target; the edit a drop commits (and its live preview) |
| `apps/cad/src/library/thumbs.ts`, `renderThumb.ts` | background thumbnails for parts without an image |
| `tools/library_thumbs.mjs` | the publisher's thumbnail tool |
| `apps/cad/src/library/libraries.default.json` | the default list (data file) |
| `apps/cad/src/library/fixtures/` | the small library the tests use |

## Not done

- Rotate and Mirror of the Placement row for library parts, and moving parts drawn on several planes (see "Where a dropped part goes").
- Appearance (`appearance`, `bodyNames`, `view`) of an inserted part is not carried over; opening it as a new document keeps it.
- The `sources` list is not yet written into export reports (there is no export report to add it to).
- Resolving a branch to a commit sha when a GitHub library is added (needs a non-API source for it); the per-part sha256 is the pin for now.
- Adapters for foreign formats, script parts in a sandboxed Worker, tokens for private repositories, "Export as library part".
- A folder library is not remembered across reloads except through the cache made when it was added; to refresh it, add the folder again.
- A download progress bar (the drop and Install show a spinner only).
