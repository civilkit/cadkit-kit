# @kit/snapshot: deterministic renderer for verification

Phase 2 of `docs/plan-agent-layer.md`. A GPU-free CPU renderer that turns a kernel body into PNG images, so a vision
model and a person can check a part. It needs no canvas, no browser and no native module: it works on typed arrays and
returns RGBA plus an encoded PNG. The same input always gives byte-identical PNG bytes (fixed light, no `Math.random`,
stable ordering, filter-0 PNG rows).

## API

```ts
import { renderSnapshot, snapshotOf, diffImages } from '@kit/snapshot';

const r = await renderSnapshot(input, opts);   // { png, width, height, rgba, meta }
const r = await snapshotOf(session, opts);     // pulls the body (and a section) from a Session, then renders
const d = await diffImages(pngA, pngB, { threshold: 8 }); // { changedPct, changedPixels, diffPng, bbox }
```

`renderSnapshot` and `snapshotOf` are the stable entry points (the MCP daemon calls them); everything else exported is
helper surface.

### input

The `ViewBody` a Session returns from `bodyForView()`, so `{ mesh, edges, box }` can be passed straight through:

| field | meaning |
|---|---|
| `mesh` | `{ positions, normals?, triFace?, faceIds? }`: 3 vertices per triangle (no index buffer), as `meshFromBody` yields |
| `edges` | B-rep edge polylines `[{ key?, pts: [x,y,z][] }]` |
| `box` | `{ min, max }`; when present it is the bounding box used for framing and dimensions (exact, not tessellated) |
| `name`, `volume` | shown in the title block of drawing sheets (`snapshotOf` fills `volume` from `massProps`) |
| `section` | the kernel `section` reply: `{ loops: [{kind, pts}], frame: {o,x,y,z} }`, exact loops in the plane frame |

### opts

| opt | values | default |
|---|---|---|
| `view` | `'iso' 'top' 'front' 'right' 'back' 'left' 'bottom'`, `{ azimuth, elevation? }` (degrees, 0 = Front side, +90 = Right side), or `{ dir, up? }` | `'iso'` |
| `up` | `'y'` or `'z'` | `'y'` |
| `size` | number or `{ width, height }`: the size of one panel | 768 |
| `projection` | `'ortho'` or `'persp'` (about 32 degree vertical field of view) | `'ortho'` |
| `style` | `'shaded'`, `'edges'` (heavier edges), `'xray'`, `'hidden-line'` (white, dashed hidden edges), `'mono'` (grey, no edges) | `'shaded'` |
| `frame` | `{ center, radius }`: pin the framing (sphere fit about `center`) so before and after renders line up | tight fit to the bbox |
| `markers` | `[{ p: [x,y,z], label?, color? }]`: ring and crosshair, dashed when the point is hidden or inside material | none |
| `annotate` | `[{ from, to, label? }]`: dimension line between two 3D points, label defaults to the length in mm | none |
| `highlight` | face ids (as in `mesh.faceIds`) drawn orange | none |
| `background` | `'#rrggbb'` | light grey-blue (white for hidden-line) |
| `sheet` | `'single' 'orthos' 'drawing-first-angle' 'drawing-third-angle' 'ab' 'section'` | `'single'` |
| `ab` | `{ b?: SnapshotInput, bView?, labels? }` for the A\|B sheet | none |
| `supersample` | integer 1 to 3 | 2 |
| `title` | part name for the title block | `input.name` |

The standard view table is the viewport's (`docs/navigation.md`, `packages/viewport/src/camerarig.ts`): Y up has Front on
+Z, Top on +Y, Right on +X; Z up has Front on -Y, Top on +Z. A test pins the two tables together.

`snapshotOf(session, opts)` additionally takes `section: { axis: 'x'|'y'|'z', at } | { origin, normal }` (calls
`session.section`) and `name`.

### sheets

- **single**: one panel. With `input.section` the cut face is overlaid on the 3D view (45 degree hatch, outline).
- **orthos**: Front, Right, Top, Iso in a 2 x 2 grid (each panel 0.7 x `size`).
- **drawing-third-angle**: Top above Front, Right beside Front, Iso (or the section view when `input.section` is set) in the
  fourth cell. **drawing-first-angle**: Right left of Front, Top below Front. Hidden-line style with dashed hidden edges,
  one common scale for the three orthographic views, overall width and height dimensions on each, and a title block with
  bounding-box dimensions, volume (if given), projection name and px/mm scale.
- **ab**: panel A is `view`, panel B the same view with the azimuth negated (for an axis-aligned view both panels use
  +/-35 degrees), or `ab.b` for a second input. Both share one pinned frame. Labels are `ab.labels`, default `A` and `B`;
  the caller randomises which is the mirror for a blind comparison.
- **section**: left a true section view from the exact loops (hatch even-odd so holes stay open, outline, dimensioned
  bounding box, area), right the model with the cut overlaid. Needs `input.section`.

### meta

`{ view, up, projection, style, sheet, frame, scale (px per mm), triangles, bbox, ms, panels? }`. Feed `meta.frame` back
as `opts.frame` to render a later state of the same part in the same frame.

## Rendering

Triangle z-buffer rasteriser (barycentric, pixel centres), one fixed directional light from the viewer's upper left plus
ambient, Gouraud from the mesh normals, two-sided. 2x supersampling with a box filter. B-rep edge polylines are
depth-tested with a small bias; mesh silhouettes (edges between a front-facing and a back-facing triangle) are added so
smooth bodies read. Overlays (markers, dimensions, section hatch, labels) are drawn at final resolution with a built-in
5x7 bitmap font. PNG encode and decode use `CompressionStream` / `DecompressionStream` (Node 18+, browsers), with a
stored-block fallback for encoding.

## Command line

```
node tools/snapshot.mjs apps/cad/public/samples/mounting-plate.ckpart --view iso --out x.png --section y=5
node tools/snapshot.mjs part.ckpart --sheet drawing-third-angle --up z --out sheet.png
node tools/snapshot.mjs part.ckpart --view top --frame 0,0,5,30 --diff before.png --out after.png
```

`--help` lists every option. It opens the document through a kernel Session (wasm from `CK_WASM` or
`apps/cad/public/kernel/ck_wasm.wasm`).

## Tests

`npx vitest run packages/snapshot` (unit: camera table, projection, z-buffer on boxes and an L, hatch area, PNG round
trip, diff, font, determinism, 30k-triangle timing). With `CK_WASM` set, `snapshot.kernel.test.ts` builds a box and a ring
through a Session, checks the ring's hole in the top view and the hatched annulus, and writes PNGs to `SNAPSHOT_OUT`.

## Limits

- Flat colour only: no textures, materials or per-face colours (except `highlight`).
- Curves are the mesh and edge polylines the kernel sends, not analytic: a coarse tessellation shows facets.
- The section overlay on the 3D view is not clipped against the body: the hatch lies on top of whatever is in front of it.
- Hidden-line is depth-buffer based (hidden parts of B-rep edges are dashed, silhouettes are visible-only); it is not
  the kernel `drawing` request's exact projection. The kernel `drawing` reply is not consumed yet.
- Bitmap font: upper case, digits and `. , - + : / ( ) = * % _ ? ! ' # [ ] < > | x deg diameter 2 3`; other characters draw `?`.
- Text size is fixed (not scaled with the image); at very small `size` labels crowd.
- Perspective projection fits by bounding sphere, not tightly.
