# CadKit Headless CLI & Docker Runner

The `cadkit` CLI runs the CadKit B-rep kernel headlessly from a terminal, CI pipeline, or Docker container without a browser or desktop GUI.

## Subcommands

All subcommands support `--json`, `--wasm <path>` (or the `CK_WASM` environment variable), and `--help`.

| Command | Purpose | Exit codes |
|---|---|---|
| `cadkit regen <file.ckpart>` | Regenerate part against the kernel; report features, solids, faces, edges, volume, bbox, warnings, and errors | `0` clean, `1` regen/load error, `2` usage error |
| `cadkit check <file.ckpart> [--profile <id>]` | Run B-rep geometry validation, mass properties, document `expect` checks, and optional manufacturing design-check profile (`fdm-print`, `cnc-3axis`, `injection`) | `0` all pass, `1` any check fails, `2` usage error |
| `cadkit export <file.ckpart> --format <fmt> [--out <path>]` | Export to `step`, `stl`, `obj`, `3mf`, `glb`, `urdf`, `usdz`, or `html` | `0` exported, `1` regen/export error, `2` usage error |
| `cadkit mcp` | Launch the CadKit MCP server over stdio (direct single-process mode by default) | `0` clean shutdown |

### Examples

```sh
# Regenerate a part and inspect JSON summary
cadkit regen parts/bracket.ckpart --json

# Validate geometry, compute mass properties, and run FDM printability checks
cadkit check parts/bracket.ckpart --profile fdm-print

# List available design-check profiles
cadkit check --list-profiles

# Export exact STEP, binary STL, 3MF, GLB, USDZ, URDF robotics bundle, or standalone HTML viewer
cadkit export parts/bracket.ckpart --format step --out dist/bracket.step
cadkit export parts/bracket.ckpart --format stl  --out dist/bracket.stl --quality fine
cadkit export parts/bracket.ckpart --format usdz --out dist/bracket.usdz
cadkit export parts/bracket.ckpart --format html --out dist/bracket.html
cadkit export parts/arm.ckpart     --format urdf --out dist/arm-urdf.zip

# Run the MCP server over stdio
cadkit mcp
```

## Running from a Source Checkout

```sh
# Run directly via the workspace bin (uses vite-node against TypeScript sources)
./packages/cli/bin/cadkit.mjs --help

# Or build a standalone single-file bundle (+ worker-host.js + ck_wasm.wasm) into dist-cli/
npm run build:cli
./dist-cli/cadkit.mjs --version
```

By default `cadkit` resolves `ck_wasm.wasm` in this order:
1. `--wasm <path>`
2. `CK_WASM` environment variable
3. `ck_wasm.wasm` beside the bundled `cadkit.mjs`
4. `apps/cad/public/kernel/ck_wasm.wasm` or `../rebuild/target/wasm32-unknown-unknown/release/ck_wasm.wasm`

If `CK_KERNEL_URL` (+ `CK_KERNEL_TOKEN`) is set, `@ck/session` connects to that native kernel service instead of loading WASM.

## Docker Runner

The multi-stage `Dockerfile` builds a minimal Node 22 slim image running as a non-root `cadkit` user with `ENTRYPOINT ["cadkit"]`.

### Build the Image

From the parent directory containing both `kit/` and the kernel checkout (`rebuild/` or `kernel/`):

```sh
docker build -f kit/Dockerfile -t cadkit-cli:latest .

# If your kernel checkout is named `kernel` instead of `rebuild`:
docker build -f kit/Dockerfile --build-arg KERNEL_DIR=kernel -t cadkit-cli:latest .
```

### Run in Docker

Mount your working directory into `/work`:

```sh
# Regenerate and check a part
docker run --rm -v "$PWD:/work" cadkit-cli:latest regen bracket.ckpart
docker run --rm -v "$PWD:/work" cadkit-cli:latest check bracket.ckpart --profile fdm-print --json

# Export STEP and STL artifacts
docker run --rm -v "$PWD:/work" cadkit-cli:latest export bracket.ckpart --format step --out out/bracket.step
docker run --rm -v "$PWD:/work" cadkit-cli:latest export bracket.ckpart --format stl  --out out/bracket.stl

# Run the MCP server over stdio inside Docker
docker run --rm -i cadkit-cli:latest mcp
```

### CI Pipeline Example (GitHub Actions)

```yaml
- name: Check and export CAD parts
  run: |
    docker run --rm -v "${{ github.workspace }}:/work" cadkit-cli:latest \
      check parts/enclosure.ckpart --profile fdm-print --json
    docker run --rm -v "${{ github.workspace }}:/work" cadkit-cli:latest \
      export parts/enclosure.ckpart --format step --out artifacts/enclosure.step
```
