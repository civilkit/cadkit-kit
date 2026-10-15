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
- **Hole editor**: the **Threaded** toggle at the top of the Size block creates the thread together with the hole (one undo step), drills the hole
  to the tap drill and keeps both in step when the hole is edited; see `docs/hole-editor.md` (Threaded). A hole with several
  positions gets one thread per wall (`<holeId>.S.h1~k`).
- **Several faces at once**: Shift+T (and the Add thread button) take every selected cylindrical face, ctrl/shift-click to add faces,
  or the **Select same size** command (Home, Features): from the selected cylinder faces it selects every cylinder of the body with
  the same diameter (to 0.001 mm) and the same kind (hole wall or not), so all the holes of one diameter are one click. One
  `thread` feature is created per face, in **one edit** (one undo step), all with the same settings (the size nearest to the first
  face's diameter), then the Thread editor opens on the group.

## The Thread editor (dialog fields to wire format)

Two sections, **Thread** (face chip, Standard, one-row size chips, Size search, Class, fit line, readout card) and **Thread options**
(Length *Full | Custom* with the number inline to the right for Custom, Hand, Start when it matters, *Model the thread* with the cost as a
muted second line). The controls are shared with the Hole editor's Threaded block (`ThreadControls.tsx`), so the two look the same, and
the sections follow the shared grid / collapse rules in `docs/hole-editor.md` (Layout). Works from 280 to 460 px wide. Top to bottom:

- **Group**: threads created together (or any run of neighbouring thread features with exactly the same settings, `threadGroup` in
  `threadData.ts`; there is no stored group, the settings are the link) are edited together: opening one in the tree opens the
  editor on the run, every change goes to each feature (one `set` / `replace` per feature in one batch), and the length handle
  edits all of them. The face chip then reads "4 holes, Ø 5 mm" ("3 shafts", or "2 faces, Ø 4 - 6 mm" when mixed; the persistent
  name is "first +3"), and the fit line checks every face: green "Fits: all 4 holes match M6 tap drill", or amber "2 of 4 faces do
  not fit M10: <names>" from the kernel's `threadDiameterMismatch` of each feature, with the one-click **Use M6**. To edit one
  thread alone, change its settings first or make it with its own Shift+T.
- **Face** is a chip, "Shaft, Ø 10 mm" / "Hole, Ø 8.5 mm" (kind from the kernel's `internal`, or the hole-wall name before it answers;
  "Cylindrical face, Ø ..." when unknown). The persistent name (`F4.S.c1`) is muted beside it and in the tooltip.
- **Standard** dropdown; changing it picks the nearest size of the new one.
- **Quick sizes**: chips above the size field (metric M3 M4 M5 M6 M8 M10 M12; fine M8x1 ... M20x1.5; UNC #6-32 ... 1/2-13; UNF; BSP
  G1/8 G1/4 G3/8 G1/2; NPT; Tr; Acme; `QUICK_SIZES` in `threadData.ts`), only sizes the table has; the size last picked in that standard
  comes first (localStorage `ck.thread.prefs`).
- **Size** is a combobox (`role="combobox"` + `role="listbox"`, `aria-activedescendant`): click or focus opens the list, typing filters
  (`m1`, `10`, `10x1.25`, `1/4`, `g1/2`; names starting with it, then containing it, then diameters starting with it), Up / Down move,
  Enter picks (it does not confirm the editor), Esc closes the list first (the next Esc cancels the editor). Each entry shows its pitch
  ("M10 × 1.5 coarse", "M10 × 1.25 fine", "1/4-20 · 1.27 mm"). With no query the three sizes nearest the face diameter come first
  (headed "Nearest to Ø ..."), the rest follow under "Coarse pitch" / "Fine pitch" / "All sizes".
- **Fit line** under Size: green "Fits: shaft Ø 10 matches M10 major diameter" / "Fits: hole Ø 8.5 matches M10 tap drill", or amber with the
  kernel's `threadDiameterMismatch` hint and the one-click **Use M8**. Hidden while the face diameter or the kind is unknown.
- **Read-out by kind**: a shaft shows major diameter, root (d3) and pitch; a hole tap drill, minor (D1) and pitch (a tap drill means
  nothing for a shaft); unknown kind shows all four.
- **Class** is a dropdown of the size's classes (6H / 6g, 2B / 2A, ...) with the note that it is recorded and does not change geometry.
- **Length**: segmented *Full | Custom*. Full = `"full"`, the number (mm) is disabled and shows the face length. Custom enables it, with
  `max` = the face length (read from the view, `faceExtent`); a typed value is held between one pitch and the face length.
  Switching to Custom starts at 8 pitches (or the last custom value).
- **Hand**: *Right | Left* segmented with helix icons (`helix-right`, `helix-left`).
- **Start**: *Open end | Top | Bottom* with `end-open` / `arrow-up` / `arrow-down` icons, shown **only when it matters**: the kernel uses the
  open end by default, so with exactly one open end the choice is moot (`startMatters`). Both ends open or neither (or not known yet),
  or an explicit `top` / `bottom` already on the feature, keeps it visible. Open ends are decided like the kernel does (thread.rs):
  a plane across the end circle whose outward normal points toward the face (a blind bottom, a shoulder) closes that end.
- **Model the thread**: remembered as the default for new threads (`modeled` in `ck.thread.prefs`; Add thread and the Hole editor's
  *Add thread* read it). Under it a cost note, "About N s to rebuild, many more triangles." (N = the last time the controller timed a
  regeneration of a document with a modeled thread, remembered as `modeledMs`; "Slower to rebuild ..." until one was measured), and,
  when the committed feature asks for `modeled` but the kernel's entry says `modeled: false`, an amber "Not built: <threadModelFallback
  hint>" (or "the kernel kept it cosmetic" without a hint).

| Field | Wire | Notes |
| --- | --- | --- |
| Standard | `standard` | ISO metric coarse `metric`, ISO metric fine `metric-fine`, UNC, UNF, BSP parallel (G) `BSP`, NPT (tapered), Trapezoidal (Tr) `Tr`, Acme; ids and counts come from `threadData`. |
| Size | `size` | the standard's sizes; picking one also sets the class of the reading (internal or external default). |
| Class | `class` | one of the table's classes or empty (empty removes the field). Recorded, does not change geometry. |
| Length | `length` | `"full"` or a number in mm (the kernel clamps to the face; the form already does). |
| Hand | `hand` | `right` / `left` |
| Start | `start` | Open end (field removed, the kernel picks the open end), `top`, `bottom` |
| Model the thread | `modeled` | real helical groove (slower). |

Every change goes through the generic draft / preview flow: `onDraft` with the whole draft, a `null` value removes the field (replace
edit), Enter or the tick confirms, Escape or the cross cancels. Enter on a button, a segmented control or a dropdown does not confirm
(it works the control); the editor takes keyboard focus when it opens so Enter / Esc work without a click. Section headers, chips and
segmented controls are keyboard reachable (arrows move inside a segmented control) with a visible focus ring.

### On the part while the editor is open

- The threaded face is lit with the selection highlight, and `Viewport.setThreadFocus(id)` draws an orange bracket beside it for the
  thread's length range (a line from `start` along `dir` for `length`, ticks at both ends), from the regen entry, modeled or cosmetic.
- **Length handle** (the contextual-handles framework, `handles/threadHandle.ts`, kind `thread-length`): a dot on the axis at
  `start + dir * length`. Dragging it sets `length` live: each step previews the editor's whole draft with that length (so size or hand
  edits made so far are kept), the value is held between one pitch and the face length and reaching the face length means `"full"`.
  Ctrl snaps to whole mm, Shift is fine, digits type the value (as for the other handles). Releasing does **not** edit the document: the
  value goes into the open editor's draft (`HandleCommit.draft` -> `ThreadEditor` `inject`), and the tick commits as usual. Esc during
  the drag puts the editor's own preview back. While a drag runs the handle is not rebuilt, although the preview changes the entry.
  It is the only handle shown while an editor is open (the others stay hidden there, see contextual-handles.md).

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
- Not done: the optional profile diagram (pitch, major, root) beside the read-out. The bracket in the view is plain lines, not a band.
- The group is a heuristic (neighbouring features with equal settings): two unrelated threads that happen to be adjacent and equal
  are edited together too; change one to separate them.
- Nothing here was checked in a browser; the behavior is covered by component tests and tests against the real wasm kernel
  (`threadData.test.ts`, `ThreadEditor.test.tsx`, `threadData.kernel.test.ts`, `handles/threadHandle.test.ts`,
  `handles/threadHandle.kernel.test.ts`, and for the hole link and several faces `holeThread.test.ts`, `holeThread.kernel.test.ts`, `HoleEditor.test.tsx`). The viewport bracket (`setThreadFocus`) and the handle's pointer behavior have no WebGL test.
