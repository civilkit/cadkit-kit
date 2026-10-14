# Selection

Everything here is client-side: it reads the mesh and the edge list the viewer already has (`Controller.selModel()`), with no kernel request. Code lives in `apps/cad/src/select/` (model, actions, commands, list, filters) and `packages/viewport/src/boxselect.ts` (box picking).

## Pick modes

The selection bar (top centre) has Face (Q), Edge (E), Corner (V) and Body (B). Body mode picks a whole body: hover lights the body, a click selects it, Shift / Ctrl adds.

**What a body is.** The kernel hands the viewer one mesh for the solid and one per surface body (feature id), merged for picking. A body here is a connected set of faces (two faces are joined when an edge lists both): two solids that do not touch are two bodies even though the kernel reports one solid, and a surface body is its own body (labelled "Surface body n"). A body is named `@body:<smallest face name>`, which survives rebuilds that keep the face names; `@body` alone (Alt+click, the Select body command) still means the whole part. Entering Body mode turns a face or edge selection into the bodies that hold it.

## Select more

Commands on the Select tab, in the command palette and in the right-click menu (the entries sit under the item commands):

| Command | Faces | Edges |
| --- | --- | --- |
| Select tangent | faces reached across an edge where the normals agree within 3 degrees (a fillet chain) | edges joined end to end with a smooth turn (2 degrees for lines and circles, 6 when the tangent is read off a polyline) |
| Select parallel | planes with parallel normals (either way) and cylinders with parallel axes | straight edges with a parallel direction, circles with a parallel axis (0.5 degrees) |
| Select similar | same type and area (cylinders also the same radius, planes and other faces by area, 0.1 %) | same type and length (circles and arcs also the same radius, 0.2 %) |
| Select loop | switches to Edge mode and selects every edge bounding the face(s) | the edges that join it end to end around its smaller neighbouring face |
| Select connected | every face of the body it belongs to | every edge reachable through shared corners |
| Invert selection (Ctrl+I) | the rest of the faces / edges / corners / bodies of the current mode | |
| Deselect all (Ctrl+Shift+A) | | |
| Select all (Ctrl+A) | all of the current mode, including bodies | |

The result is added to the selection (the toast says how many were added). A command that cannot run says why in the menu tooltip: "Select something first" or "Works on faces and edges" (Corner and Body modes). Edge types are fitted from the polyline: a line is a chord within 1e-4, a circle or arc a three-point circle all points sit on within 0.2 %. A face is a plane when every triangle normal is within 0.5 degrees of the mean, a cylinder when its boundary circles share one radius and axis.

## Box select

- Press X (or the dashed-box button) for Box select mode; a left drag then draws a box instead of orbiting. Shift+drag from empty space does the same without the mode and adds to the selection. A plain click in the mode is an ordinary pick.
- Drag right: window (blue, solid): items fully inside. Drag left: crossing (green, dashed): items the box touches.
- By mode: faces by their triangles (a triangle behind the camera is never "inside"); edges by their polyline; corners by their position; bodies by their faces (window: every face inside; crossing: any face touched).
- Box select goes through the model: hidden faces behind others are picked too.

## Filters

The funnel button opens Faces / Edges / Corners / Bodies / Sketches / Planes switches. A kind that is off cannot be entered as a pick mode (its button is disabled; if it was the current mode the next enabled one is used), a box ignores it, and Planes off stops reference planes being picked in the view. A badge counts the kinds that are off. Sketches is listed but nothing in the 3D view picks sketches (they are chosen from the history tree), so that switch has no effect yet.

## Selection list and status summary

A panel at the bottom right of the view lists the selection: a count, one chip per item (Face name, Edge n, Corner x,y,z, Body n) with a remove button, Clear, and a fold arrow. Hovering a chip lights that item amber in the view even though it is selected. The status bar shows a summary: `3 faces, 12.4 cm²`, `2 edges, 14 mm`, `1 body, 24 mm²` (face and body areas from the mesh triangles, exact for planes and close for curved faces; lengths from the edge polylines). Areas switch from mm² to cm² at 100 mm²; lengths from mm to m at 1000 mm.

## Kernel queries that would help

None were needed. Two things a kernel answer would improve: exact face areas and edge lengths for curved geometry (the summary uses the tessellation, like Measure's local path; the `measure` request is exact), and a body id on every face in the mesh reply (bodies are recovered from face adjacency, which cannot tell two touching bodies sharing no edge from one).

## Tests

`apps/cad/src/select/*.test.ts(x)` (model on hand-built boxes, a rounded block and cylinders; actions; commands; list and filters), `packages/viewport/src/boxselect.test.ts`, `apps/cad/src/menuModel.test.ts`, `packages/store/src/index.test.ts`.
