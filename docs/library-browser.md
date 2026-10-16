# Library browser

The **Libraries** section at the bottom of the Catalog tab lists parts from parts libraries that are hosted somewhere else (a
GitHub repository, a web address or a folder on disk). Pick a part and insert it into the open document, open it as a new document
or download its file. The design is in `docs/spec-library-browser.md`; this page describes what phase 1 does.

Parts are **data only**: a `.ckpart` document. Nothing downloaded from a library is ever run (no script, no code).

## Using it

1. Open the Catalog tab and scroll to **Libraries**. The list starts with **Bundled samples**, the example parts that ship with the app.
2. The category tabs and the search box filter the cards (search looks at title, id and tags). Click a card for its detail panel:
   licence, category, size, a link to the part's page and to the library, and three actions.
   - **Insert** adds the part's features to the open document at the part's own origin, as one undo step. Its variables are renamed
     with a prefix (`<part>_1_`, `<part>_2_`, ...), so inserting the same part twice, or a part whose variables are named like yours,
     never clashes; its feature ids are renumbered after the document's. The part's configurations are not carried over.
   - **Open as new document** opens the part on its own (a stored script, if the file has one, is dropped).
   - **Download** saves the original `.ckpart` file unchanged.
3. **Add library...** (first entry of the library picker): type `github:owner/repo` (optionally `@branch-or-tag`), the `https` address
   of a `library.json`, or pick a folder that holds a `library.json` and its files. The app fetches and checks the list and shows the
   name, the part count and the licence before the library is added. **Refresh** fetches the list again; **Remove library** removes it
   and its cached files from this device.
4. Libraries and their parts are cached on this device (IndexedDB). Without a network the cached list and the parts you already
   fetched keep working, and an **offline** badge shows.

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
and its page. The Libraries section lists the sources that are still in the open document (an undone insert drops out of the list). The
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

A library is a folder (a repository root, or any web directory) with a `library.json` and the part files it lists:

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
| `parts[].thumb` | optional image path, same rules, `.png`, `.webp` or `.jpg` |
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
| `apps/cad/src/library/LibrarySection.tsx` | the UI |
| `apps/cad/src/library/libraries.default.json` | the default list (data file) |
| `apps/cad/src/library/fixtures/` | the small library the tests use |

## Not in phase 1

- **Placement** on a chosen plane or face like a catalog shape. `buildInsert(doc, part, meta, place?)` already takes a `place`
  function from the renumbered features to the same features moved onto a target; a phase-2 UI only has to build one (the BOSL2 path does
  this with `applyPlacement` in `catalog/placement.ts`). Inserted parts stay at their own origin for now.
- Appearance (`appearance`, `bodyNames`, `view`) of an inserted part is not carried over; opening it as a new document keeps it.
- The `sources` list is not yet written into export reports (there is no export report to add it to).
- Resolving a branch to a commit sha when a GitHub library is added (needs a non-API source for it); the per-part sha256 is the pin for now.
- Adapters for foreign formats, script parts in a sandboxed Worker, tokens for private repositories, "Export as library part".
- A folder library is not remembered across reloads except through the cache made when it was added; to refresh it, add the folder again.
