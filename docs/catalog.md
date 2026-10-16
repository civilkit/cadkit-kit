# Catalog: shapes dragged onto the model

The **Catalog** tab of the left panel (also: command `Catalog`, key Shift+K) holds ready-made shapes. Pick one up and drop
it on the part: it lands on the face under the pointer, sits flat on that face, snaps to useful spots and is created as real
features in ONE undo step. Left column adds material, right column removes it.

| Adds material | Removes material |
|---|---|
| Block, Cylinder, Sphere, Cone, Boss, Slot | Pocket, Round pocket, Dimple, Cone cut, Slot cut, Hole, Counterbore, Countersink |

## Placing

* **Drag**: press on a shape, move over the model. A chip follows the pointer (shape, face, snap kind); the part turns
  translucent and shows the real result, rebuilt as you move (one kernel call at a time, the latest position wins).
  Release over the canvas to drop; release elsewhere or press Esc to cancel (nothing is written).
* **Click to place**: click a shape (it stays highlighted), move over a face, click. Shift is not needed; Esc or clicking the
  shape again disarms. Orbit with the mouse buttons as usual while armed.
* **Snapping** (flat faces): corner, circle centre (a hole rim), edge midpoint, face centre, within 14 screen pixels. **Alt**
  turns it off.
* **Face to plane**: a flat face carries the sketch directly. A curved face (cylinder, sphere) gets a tangent plane at the
  picked point, then the shape is sketched on that.
* **Empty part**: a shape dropped on empty space becomes the first body on the ground plane (Top for Y up, Front for Z up) at the spot, or on the reference plane under the pointer. Removing shapes are
  refused until there is a body (their tiles are dimmed).
* **Size**: 40% of the smaller side of the face (30 mm for the first body), rounded to a nice number. Adding shapes are as
  tall as wide; removing shapes cut half that deep, never more than half the part's thickness; holes are through the part,
  ISO size picked from the face size.

## Placing on a plane

The first body, and any shape dropped on a drawn reference plane or its tree row, goes on a plane: by default the ground plane of the up axis (nav setting), so it rises away from the ground. The Placement row (Place on / Direction / Rotate / Mirror) and the keys R (rotate 90) and F (flip) choose how it stands; the drop hint names the plane. The Shapes items (block, cylinder, ...) use the same targeting. Details and limits: `catalog-bosl.md`, section "Placing on a plane".

## What a drop makes

Every shape is a sketch on the face plus a feature the kernel already has, added in one `edit` (record reason
`Catalog: <name>`), with ids chosen up front (`F<seq>`...).

| Shape | Features |
|---|---|
| Block, Pocket | sketch (rectangle) + extrude add / cut |
| Cylinder, Boss, Round pocket | sketch (circle) + extrude |
| Cone, Cone cut | circle + extrude with a draft that tapers the radius to a fifth |
| Slot, Slot cut | stadium sketch (two arcs, two lines) + extrude |
| Sphere, Dimple | first body: half disc revolved 360 degrees (a whole sphere). On a part: a hemisphere, turned about the face normal (see below) |
| Hole, Counterbore, Countersink | sketch with a point + `hole` (through) |

A face-placed sphere uses a hidden helper sketch and a `perpendicular` plane (both hidden in the view, listed in the tree);
the ones for a curved face add the tangent plane first.

**Why a hemisphere:** the kernel does not mesh a sphere face once a boolean trims it with the face plane (the volume is
right but the surface is missing, whichever way the sphere is turned). A hemisphere lying on the face is not trimmed and
meshes. A whole sphere on a face needs that kernel fix.

## After the drop: `selectShapeFeature(id)`

`apps/cad/src/catalog/state.ts` exports the stable hook for what comes next (the size box):

* `selectShapeFeature(id)` - `id` is the shape's main feature (extrude, revolve or hole). The Catalog calls it after every
  drop. The app's selector (main.tsx) selects the tree row, closes any editor, and for an extrude selects its end face
  `<id>.C1` so the existing depth arrow shows.
* `onShapeSelected(fn)` - subscribe to the same event; `setShapeSelector(fn)` - replace how the selection is made.
* `BuiltShape` (shapes.ts) has `mainId`, `sketchId`, `size` and `helpers` for anyone who builds a shape directly.

## Code map

* `catalog/shapes.ts` - the item list and `buildShape(item, target, seq)`: pure, returns the ops.
* `catalog/geometry.ts` - face facts (flat?, centre, extent), ray cast, snap candidates. Works on the arrays of the
  committed body, so the preview on screen never changes where the next pointer position lands.
* `catalog/placer.ts` - hover / drop / end with the preview loop; caches the sketch frame of a face (found by previewing a
  probe sketch and reading it back) for the length of one drag.
* `catalog/useCatalog.ts`, `CatalogPanel.tsx` - pointer handling, ghost, armed state, Esc.
* Viewport additions: `rayAt`, `worldPerPixel`, `containsClient`, `setPlacementHook` (hover and click while armed),
  `setPreviewFade`, `setHoldView` (the camera no longer re-frames on every preview or drop on an existing part).

Tests: `catalog/catalog.test.ts` (geometry, shapes, placer with fake deps), `catalog/catalog.kernel.test.ts` (every item
on a flat face with volume checks, uv placement, bottom face, curved face, ground, domes on every face; needs `CK_WASM`).

## Not done

Rib; patterns of dropped shapes; resize handles (the size box); catalog items saved from the user's own parts; a sphere that
is whole and sits on a face (kernel meshing, above); placing on surface (sheet) bodies.

## Repositioning a placed shape

After the drop the shape is selected and shows its size box. Move it with the magenta pad at the centre of its footprint, by dragging the
shape itself, by typing an offset (Tab) or with the arrow keys; it snaps like the placement did (same code: corners, hole-rim centres, edge
midpoints, face centres, plus centres of other shapes and alignment guides; Alt switches snapping off). See "Moving a shape" in
`docs/size-box.md`.

External parts libraries (GitHub, web address or folder) have their own section in the Catalog tab: see `docs/library-browser.md`.
