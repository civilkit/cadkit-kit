# Corner holes: mounting holes on a plate in one step

Part of the hole workflow (see `hole-editor.md` for the hole parameters). Code: `apps/cad/src/cornerHoles.ts` (rules, no DOM),
`CornerHolesPanel.tsx` (the control), wiring in `main.tsx`; tests `cornerHoles.test.ts`, `CornerHolesPanel.test.tsx`,
`cornerHoles.kernel.test.ts`. Sample: `corner-holes-plate`.

## Using it

1. Pick the plate's top face and start Hole (Shift+H, or the Hole button). The Point tool is active as before, and a
   **Corner holes** card appears at the top right of the canvas.
2. Click **Place holes**. With the defaults this puts a hole in each of the four corners, 10 mm in from both edges.
   When the face has equal rounded corners the card offers **Match corner fillet (R x mm)**, switched on at the start: the inset
   is the fillet radius, so each hole is concentric with its fillet and the Inset field shows that radius.
3. Confirm the sketch (the tick) as for any hole. The Hole editor opens for size, kind, fit and depth.

That is four clicks (face, Hole, Place holes, tick) and no typing for a plate with rounded corners; a plain plate is the same,
plus typing the inset if 10 mm is not what you want.

| Field | Meaning |
|---|---|
| Inset | Distance from both edges to the hole centre, mm. Also the radius of an imagined corner fillet the hole is concentric with. |
| Match corner fillet | Shown only when the face outline has equal corner arcs. The inset follows the radius. |
| Holes along X / Y | Holes on each row / column, corners included. 2 and 2 is the four corners; 3 adds a hole in the middle of each side; the holes lie on the edge of the grid, never in the interior. X and Y are the sketch axes of the face. |

Typing an inset or count and pressing Enter in a count field places as well. Placing again replaces the earlier corner points of
this feature (points you added by hand with the Point tool stay).

## Editing afterwards

The sketch keeps the record as a custom field, like the gear editor does (`cornerHoles`, in the sketch feature; the kernel keeps unknown
fields):

```json
"cornerHoles": { "inset": 10, "matchFillet": true, "nx": 2, "ny": 2, "rect": {"minX":0,"minY":0,"maxX":80,"maxY":50}, "radius": 10 }
```

Reopen the hole (double-click it in the tree) and the same card sits above the Hole editor with the button **Update holes**. It
re-places the points against the face as it is now (so a plate that changed size is followed) and replaces the sketch in one edit
(one undo step); the hole's size, kind, fit and depth are untouched. If the face outline cannot be read any more, the stored `rect`
and `radius` are used and the card says so. The points are `ch1`, `ch2`, ... with point entities `che1`, ...

## What counts as a rectangle

`faceOutline` takes the body edges that border the picked face, flattens them into the sketch plane and recognises each as a
line, arc or circle (`classifyCurve`, the Project tool's recogniser). It accepts four axis-parallel lines (sharp), or four such lines
and four quarter arcs of one radius, one in each corner (rounded). Full circles (holes already in the face) are ignored.
Anything else (slanted edges, unequal corners, slots, splines) falls back to the **bounding box** of the outline with the note "not a
rectangle with equal corners: using its bounding box"; the holes are then placed against the box, not the true outline.

## Messages

Refused (nothing placed, the button is disabled): inset 0 or negative; inset of half the plate or more (the message names the limit);
counts below 2 or not whole numbers; a plate with no size. Warning (placed anyway): the hole is too close to the edge or the fillet, i.e.
less than 1 mm of material is left (hole radius larger than inset minus 1; with a fillet bigger than the inset the distance to the
arc is used). The hole size used for this is the one the next hole would get (the remembered size), and the real one when reopened.

## Limits

* Only planar faces whose outline reduces to a rectangle are placed exactly; other outlines use the bounding box.
* The inset is typed as a number (no expressions or variables yet); the placed points are plain sketch points and can be dragged or
  dimensioned like any others (after which Update holes puts them back on the grid).
* A hole sketch on a plane that is not a body face (a standard or datum plane) has no card: use the Point tool.
