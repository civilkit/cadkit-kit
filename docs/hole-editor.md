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
* `csink` is cut as a plain hole; no cone, `cskDiameter` / `cskAngle` are parsed but not used.

The editor writes the fields anyway and says so under the type. When the kernel starts using them, set
`KERNEL_CUTS_CUSTOM_DIMS` to true in `holeData.ts` (a kernel test fails to remind you) and the note disappears.

## Defaults and memory

Shift+H on a point sketch, or on a face (which first asks for the points), opens the editor on a new hole: Simple, M6, Normal,
Through. Confirming a hole remembers its type, size and fit in `localStorage` (`kit.hole.prefs`) as the next default; a Custom
diameter is not remembered.

## Thread extension point

`HoleEditor` takes `threadSection?: JSX.Element | ((hole) => JSX.Element)`. When given, a collapsible "Thread" section is
drawn after Options with that content (the function form receives the hole with the draft applied, so it can read `size`).
Without it there is no section. The thread feature's controls are not part of this editor; main.tsx passes nothing yet.

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
