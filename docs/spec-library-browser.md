# Library browser: spec

Status: draft, 2026-10-17. Phase 1 is being built; later phases are todo.

## Why

Parts libraries (motors, bearings, batteries, fasteners) should not be bundled in our repos or releases, especially
when their licence is GPL-like. The user browses a library hosted elsewhere, picks a part and includes or downloads it.
Our own samples and any user-added library work the same way.

## Library sources

A library is a base URL with a manifest. Forms accepted when adding one:

- `github:owner/repo[@ref]` (default ref: the default branch, pinned to a commit sha once resolved),
- any HTTPS URL to a `library.json`,
- a local file or folder (for testing and for offline libraries).

GitHub files are read from `raw.githubusercontent.com` (or the jsDelivr mirror); **no GitHub API calls** (rate limit 60/h
unauthenticated). A manifest therefore lists every part, so the browser never has to list a directory.

### Manifest (`library.json`)

```json
{
  "format": "fwlib", "version": 1,
  "name": "Example parts", "description": "...", "homepage": "https://...",
  "licence": "CC0-1.0",
  "parts": [
    { "id": "motor-2212", "title": "BLDC motor 2212", "category": "motors", "tags": ["bldc", "28mm"],
      "file": "parts/motor-2212.ckpart", "thumb": "thumbs/motor-2212.png",
      "licence": "CC0-1.0", "source": "https://...", "bytes": 15000, "sha256": "..." }
  ]
}
```

- `licence` is an SPDX id, per library and optionally per part. Missing means "unknown" and is shown as such.
- `sha256` is checked after download; a mismatch refuses the part.
- Unknown fields are ignored, so the format can grow.

## Part files: data only

A part is a `.ckpart` document (JSON), with its parameters as document variables. **No downloaded script is ever executed**:
running remote code needs a sandbox we do not have yet. A script-based library part is a later phase (isolated Worker).

All remote content is untrusted: manifests and parts go through the same validation as opening any file, size limits apply
(manifest 1 MB, part 16 MB), and nothing from a manifest is interpreted as markup.

## What the user can do with a part

- **Insert** into the open document as new feature(s) (attach mode: one undo step, variables prefixed so they do not clash,
  placed on a chosen plane or face like a catalog shape).
- **Open as new document.**
- **Download** the `.ckpart` file.
- A part inserted from a library records where it came from in the document (`sources`: library name, part id, ref, sha,
  licence, url), and the UI shows it; it also goes into any export report.

## Licence handling

- The browser shows each library's licence before the first fetch.
- Licences outside a permissive allow-list (MIT, BSD, Apache-2.0, ISC, CC0, CC-BY, OFL, Unlicense) need one explicit
  confirmation per library ("GPL-3.0: parts taken from this library may carry its terms"). The choice is remembered
  per library, never shared inside documents.
- This is a notice, not legal advice.

## Storage and offline

- The list of libraries and the confirmations live in the app settings (local to the device).
- Fetched manifests and parts are cached in IndexedDB keyed by url + sha; the cache shows an "offline" badge and works
  without network; "Refresh" re-fetches the manifest.
- Removing a library removes its cache.

## UI

- A **Libraries** section in the Catalog tab: a source picker (list of libraries, "Add library..."), category filter,
  search over title and tags, a card grid with thumbnails, and a detail panel with licence, source link, parameters and the
  three actions above.
- Adding a library: paste a URL, the app fetches and validates the manifest and shows name, licence and part count before
  it is added.

## Default libraries

The default list is a data file (`libraries.default.json`), so it can change without code. It starts with the app's own
bundled samples. A GitHub-hosted default (our own public parts repository) needs a repository URL: **decision pending**.

## Foreign libraries (later phases)

- **Adapters** for libraries that are not in `fwlib` format, for example NopSCADlib (GPL-3.0): an adapter reads a data
  table from the downloaded source and builds parts with our own generator, so no copy of the upstream data lives in our
  repos. Needs the OpenSCAD decision (see the spike notes).
- **Script parts** in a sandboxed Worker.
- **Token support** for private GitHub repositories (stored encrypted, like the planned chat key).
- Publishing: "Export as library part" with a generated manifest entry.

## Phase 1 (build now)

1. Manifest types and validation, source parsing (`github:`, HTTPS, local), fetch with size limits and sha check.
2. IndexedDB cache and offline mode.
3. Registry: add, remove, refresh, defaults data file, licence confirmation state.
4. UI: Libraries section in the Catalog tab with search, cards, detail panel.
5. Actions: Open as new document, Download, Insert (attach-mode patch).
6. Provenance in the document and in the UI.
7. Tests against a local fixture library (no network in tests).

## Tests

- Manifest validation: missing fields, oversized, wrong sha, non-HTTPS, unknown licence.
- Add, remove and refresh a library from a local fixture; cache works offline.
- Insert twice: variables do not clash, one undo step each, provenance recorded.
- A GPL library asks for confirmation once and the choice sticks.
