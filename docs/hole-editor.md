# Hole editor

The Hole editor (`apps/cad/src/HoleEditor.tsx`) replaces the generic field list for `hole` features. The rules live in
`apps/cad/src/holeData.ts` (no DOM). The kernel side is `crates/ck-model/src/features/hole.rs`.

## Controls and the wire format

| Control | Field | Notes |
|---|---|---|
| Hole type: Simple / Counterbore / Countersink | `kind`: `simple`, `cbore`, `csink` | the kernel spells it `csink` |
| Size: M2 ... M24, Custom diameter | `size` (`"M6"`), or `diameter` when Custom | Custom exists for Simple only: the kernel has no plain-diameter form for cbore / csink |
| Fit: Tap drill, Close, Normal, Loose | `fit`: `tap`, `close`, `normal`, `loose` | `tap` is a Simple fit; for cbore / csink it counts as `normal` (the editor does not offer it) |
| Hole diameter (read-only text) | none | computed from the size table and the fit |
| Counterbore diameter / depth | `cboreDiameter`, `cboreDepth` | only for `cbore`; defaults ISO 4762 for the size |
| Countersink diameter / angle | `cskDiameter`, `cskAngle` | only for `csink`; defaults ISO 10642 diameter for the size, 90 degrees |
| End condition: Blind / Through / Up to next | `end`: `blind`, `through`, `upToNext` | Blind adds `depth` (default: twice the hole diameter, at least 10 mm) |
| Drill point tip | `tip: true` | only shown for Blind; the point is 118 degrees included, fixed in the kernel |
| Flip direction | `flip: true` | |

A plain `diameter` beats `size` in the kernel, so choosing an ISO size removes `diameter` from the feature: the editor puts
`null` in its draft and the app turns a draft containing `null` into a `replace` edit (a `set` would leave the old value).

The size table is mirrored from `hole.rs` in `holeData.ts` (`ISO_TABLE`). `holeData.test.ts` parses `hole.rs` and fails when a
number differs; `holeData.kernel.test.ts` regenerates a hole of every size and fit (simple and counterbore) in the kernel and
compares the removed volume with the diameter the editor shows.

### Kernel status (checked against hole.rs and the pinned wasm)

* A counterbore is cut with the table's counterbore diameter and depth for the size; `cboreDiameter` / `cboreDepth` are parsed but
  not used.
* The kernel now honours `cboreDiameter` / `cboreDepth` for `cbore`, and cuts the cone for `csink` when `cskDiameter` is given (the editor always writes it; `cskAngle` is the included angle, default 90). A bare `csink` without `cskDiameter` stays a plain hole, and the kernel also knows `kind: "countersink"` (always a cone, table head diameter by default). Impossible values come back as `holeCboreInvalid` / `holeCskDiameter` with a hint.

The editor writes the fields anyway and says so under the type. When the kernel starts using them, set
`KERNEL_CUTS_CUSTOM_DIMS` to true in `holeData.ts` (a kernel test fails to remind you) and the note disappears.

## Defaults and memory

Shift+H on a point sketch, or on a face (which first asks for the points), opens the editor on a new hole: Simple, M6, Normal,
Through. Confirming a hole remembers its type, size and fit in `localStorage` (`kit.hole.prefs`) as the next default; a Custom
diameter is not remembered.

## Threaded (tapped hole)

The editor ends with a **Thread** section (drawn when the host passes `threads`, the kernel tables and the part's view of the
thread; `HoleThreadSection.tsx`, rules in `holeThread.ts`). It has a **Threaded** checkbox. Ticking it:

- starts a thread with the hole's own metric size (a Custom diameter, or a size the table lacks, takes the size whose tap drill is
  nearest to the diameter), `length: "full"`, right hand, class from the table, `modeled` as remembered (cosmetic by default);
- drills the hole to the tap drill: a metric size the hole table knows with the same tap drill keeps `size` and becomes `fit: "tap"`;
  anything else (inch, BSP, fine pitch) becomes a plain `diameter` equal to the size's `tapDrill`. The Size section then shows
  "the size comes from the thread", hides the hole's Size and Fit selects, and the Ø read-out shows the tap drill with
  "M8 tap drill" beside it;
- shows the Thread editor's controls: Standard (metric, metric fine, UNC, UNF, BSP, NPT, Tr, Acme), quick-size chips and the
  searchable Size list (nearest to the hole first), the read-out (tap drill, minor D1, pitch), Class, Length *Full | Custom*,
  Hand *Right | Left*, and *Model the thread* with the same cost note and amber "Not built: ..." note as the Thread editor
  (the components `Select`, `Seg`, `SizePicker` are the Thread editor's, exported from `ThreadEditor.tsx`).

Length: *Full* is the hole wall. A **blind** hole caps a custom length at its depth ("Capped at the hole depth, N mm") and shrinks the
length when the depth does; a through hole is held to the wall length when the view knows it.

Only a **simple** hole can be threaded (counterbore / countersink walls are not one cylinder): the box is disabled with a note, and
changing the type to one of them drops the thread. Clearing Threaded puts the hole's own size, fit and diameter back (when the box
was ticked in this editor) and removes the thread(s).

### One edit, linked threads

The editor's draft carries the hole and the thread: `onDraft(hole, thread)` / `onConfirm(hole, thread)` (`thread` is the settings
object or `null` for none, `undefined` without thread support). The app (main.tsx `opsFromDraft`) turns that into the hole's own ops
plus `holeThreadEditOps`: an `add` of a `thread` feature on the wall face when there is none, a `replace` when its settings
differ, a `remove` when Threaded is cleared. They go in **one batch**, so applying is one undo step, and the same ops are the
preview, so the cosmetic markers (or the modeled helix) show on the part while the editor is open. Editing the hole later changes
the linked threads in the same edit (size, hand, length cap, ...). A hole that already has a thread opens with Threaded checked and
its settings. The link is the face name: a thread whose `face` is `<holeId>.S.h1` (or `<holeId>.S.h1~k`).

### A hole with several positions

A `hole` feature with several sketch points has one set of settings for all positions (editing it already edits them all) and one wall
per position: `F4.S.h1~0`, `F4.S.h1~1`, ... (a single position has no `~k`). The wall faces are read from the faces the view has
(`holeWallFaces`). Threaded puts **one thread feature per wall**, all with the same settings, in the one batch; editing the hole
edits all of them together; clearing removes all of them. A thread whose position no longer exists is left alone.

## Examples

Default hole (Shift+H):

```json
{ "type": "hole", "sketch": "F3", "kind": "simple", "size": "M6", "fit": "normal", "end": "through" }
```

Counterbored M8 clearance hole, 20 mm deep with a drill point:

```json
{ "type": "hole", "sketch": "F3", "kind": "cbore", "size": "M8", "fit": "close", "end": "blind", "depth": 20, "tip": true,
  "cboreDiameter": 15, "cboreDepth": 8.6 }
```

Countersunk M5 hole and a Custom-diameter hole on the other side of the part:

```json
{ "type": "hole", "sketch": "F3", "kind": "csink", "size": "M5", "fit": "normal", "end": "through",
  "cskDiameter": 10.4, "cskAngle": 90 }
{ "type": "hole", "sketch": "F5", "kind": "simple", "diameter": 3.25, "end": "upToNext", "flip": true }
```
