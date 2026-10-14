# Threads

A `thread` feature marks a cylindrical face (the wall of a hole, a shaft) as threaded: standard, size, class, length, hand,
start. The tables and all checks live in the kernel (`threadData` request, `thread` feature, see
`docs/spec-agent-interface.md` in the kernel repo); the GUI reads the tables and writes the feature.

## Making one

- **Add thread** (Shift+T; ribbon Home, Features): enabled when one face is selected in Face mode, the document has a body and the
  face is cylindrical. "Cylindrical" is decided from the data the view already has (`cylinderOfFace(face, bodyEdges())` in
  `threadData.ts`): a cylinder wall has two circular edges of the same radius on one axis, apart along it; a flat face with a round
  hole has only one circle and is rejected. A lone circle counts only for faces named like a cylinder (`.S.c1`, a hole wall
  `.S.h1`). The kernel still has the last word (`threadFaceNotCylinder` is a normal red row error).
- The new feature is `metric`, the size nearest to the face diameter, `length: "full"`, `hand: "right"`, `modeled: false`. Nearest means
  the closest tap drill for a hole wall (`.S.h1`), the closest major diameter for a shaft, and the closer of the two when that is not
  known yet (the editor re-sorts as soon as the kernel reports `internal`). Then the Thread editor opens on it.
- **Hole editor**: a hole with a `fit: "tap"` and an ISO size shows a Thread section with *Add thread to this hole*. It confirms the
  hole as it is, then adds a `thread` on `<holeId>.S.h1` (the wall face, hole.rs) with the hole's `size`. A hole that already has one says so.

## The Thread editor (dialog fields to wire format)

| Field | Wire | Notes |
| --- | --- | --- |
| Standard | `standard` | ISO metric coarse `metric`, ISO metric fine `metric-fine`, UNC, UNF, BSP parallel (G) `BSP`, NPT (tapered), Trapezoidal (Tr) `Tr`, Acme; ids and counts come from `threadData`. Changing it picks the nearest size of the new standard. |
| Size | `size` | the standard's sizes; the three nearest to the face diameter come first, marked. Read-out: pitch, major, minor (D1 internal, d3 external), tap drill. |
| Class | `class` | free text with the table's internal / external defaults as suggestions (6H / 6g, 2B / 2A ...). Recorded, does not change geometry. Empty removes the field. |
| Length | `length` | "Full thread" = `"full"`, otherwise a number in mm (clamped to the face by the kernel). |
| Hand | `hand` | `right` / `left` |
| Start | `start` | Open end (field removed, the kernel picks the open end), `top`, `bottom` |
| Model the thread | `modeled` | real helical groove (slower). |

Every change goes through the generic draft / preview flow: `onDraft` with the whole draft, a `null` value removes the field (replace
edit), Enter or the tick confirms, Escape or the cross cancels.

## Warnings

Regen warnings (`warnings: [[featureId, {code, params}]]`) are kept in `store.featureWarnings` (id to `{code, hint, params, all?}`;
several warnings on one feature are joined in `hint` and listed in `all`). They show

- in the tree as an amber hint line under the row (the row is not red: the feature works), and
- in the editor, under the sections, in amber. `threadDiameterMismatch` carries the kernel's actionable hint
  (`hole is 6.5, M6 tap drill is 5: drill the hole to 5, or choose M8 (tap drill 6.8)`) and a one-click **Use M8** button built from
  `params.nearest`. `threadModelFallback` shows why the helix was not built.

The warnings follow previews: while a thread is being edited the controller regens the candidate and shows its warnings and markers;
cancel restores the committed ones.

NOTE (Session gap): `Session.verify()` and `preview()` only pass `errors` through from the regen reply, so `threads` and `warnings` are
missing from `report.regen`. Until the Session passes them (then `Controller.regenExtras` makes no request), the controller asks the
kernel for the regen reply itself, and only when the document has a thread feature (one extra regen per refresh / thread preview).
Before this, the cosmetic markers received nothing.

## Display

Cosmetic threads (not `modeled`) are drawn by `Viewport.setThreads` from `regen.threads`: two dashed rings and four generators at
`start` and `start + length * dir` (`start` = point on the axis where the thread starts, `dir` = unit vector into the face), radius
major / 2 for an internal thread (thin line of a drawing), minor / 2 for an external one, with the size (and LH) as a label. Checked
against the kernel's entries for the sample. The Threads layer in the Display menu hides them.

## Sample

`apps/cad/public/samples/threaded-bolt.ckpart` (Samples dialog, "Threaded bolt and tapped block"): a hex head, a 10 mm shaft 40 mm
long with a 1 mm tip chamfer and an M10 thread (6g, 30 mm) on the shaft, and a 40 x 30 x 20 block with an M8 tapped hole (14 deep) and its
M8 thread. Regenerates with no errors. Set the hole fit to Normal and the kernel warns that the 9 mm hole does not match an M8 thread.

## Limits and status

- Modeled threads: the kernel builds the helical groove for straight threads and falls back (cosmetic + `threadModelFallback`) for tapered
  NPT, more than 60 turns, a bore too small to reach, overlapping profile, or a failed boolean. The GUI only shows the warning.
- Internal / external is the kernel's reading (concave / convex); the GUI knows it only from the hole-wall name before the kernel answers.
- Only English strings; no thread table editing; no per-face thread-length measurement beyond the kernel's `length` clamp.
- Nothing here was checked in a browser; the behavior is covered by component tests and tests against the real wasm kernel
  (`threadData.test.ts`, `ThreadEditor.test.tsx`, `threadData.kernel.test.ts`).
