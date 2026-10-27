# CadKit

A parametric CAD application that runs in the browser (and installs as a PWA). Parts are feature
trees (`.ckpart`) rebuilt by the CadKit kernel, a Rust/WebAssembly B-rep kernel kept in a separate
repository.

- Sketch, extrude, revolve, sweep, loft, shell, draft, hole, fillet and chamfer, patterns, mirror,
  scale, coils and threads, text, surfacing, assemblies with mates.
- Editable history tree, rollback, undo and redo, equations and variables, multiple documents in tabs.
- Imports STEP, SolidWorks (`.sldprt`), SketchUp (`.skp`), FreeCAD (`.FCStd`), DXF and SolidCraft files.
- Exports STEP, STL, GLB, DXF, drawings (PDF, SVG).
- A script API and an MCP server so an agent can build and inspect parts.
- Wizards for gears, propellers and impellers.

## Layout

| path | what |
|---|---|
| `apps/cad` | the application (Preact, Vite): editor, panels, file handling, library browser |
| `packages/viewport` | the 3D viewport |
| `packages/sketch` | the 2D sketch editor |
| `packages/script`, `packages/skill`, `packages/agent-tools`, `packages/mcp` | scripting and agent access |
| `packages/io`, `packages/fcstd`, `packages/solidcraft`, `packages/snapshot` | importers and renders |
| `packages/platform`, `packages/store`, `packages/ui`, `packages/i18n` | platform layer, state, components, strings |
| `docs/` | design notes per feature |

The kit expects the kernel checkout as a sibling folder named `kernel`:

```
parent/
  kernel/    the CadKit kernel repository
  kit/       this repository
```

Set `CK_REBUILD` to use another location.

## Build and run

```
npm install
npm run typecheck
npm test                       # unit tests
CK_WASM=<ck_wasm.wasm> npm run test:kernel   # tests that run the real kernel
npm run dev                    # development server
npm run build:pages            # static site into dist-pages
```

The kernel wasm is built in the kernel repository (`cargo build -p ck-wasm --target
wasm32-unknown-unknown --profile fast`) and copied to `apps/cad/public/kernel/ck_wasm.wasm`, or
passed with `WASM_SRC` to `build:pages`. Environment switches are named `CK_*`.

## Files

Parts are saved as `.ckpart` (JSON, format name `ck-part`), optionally gzip-compressed. Files saved
by earlier versions still open.

## Licence

MIT OR Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`). Third-party material and its licences are in
`THIRD_PARTY.md`.
