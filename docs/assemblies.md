# Assemblies

The Outliner tab of the left panel is the assembly panel. Ribbon tab "Assembly" (and the command search) open it on a section:
`insert-part` (Parts), `mate` (Mates), `asm-interference`, `bom`, `explode`. Code: `apps/cad/src/assembly/`.

## Parts

Insert part: pick a sample from the list or open a `.ckpart` file, set the placement (X, Y, Z; a turn about X / Y / Z with an angle) and
press Insert. This adds one `insertPart` feature that keeps the whole part document (`source` is only a label). A component is its own body
in the model, also where it touches another.

Each component is a row: the name, the part name and the remaining degrees of freedom (`components[]` of the kernel's regen reply:
"1 DOF remaining", "fully defined", "fixed"). Row buttons: show / hide (display only, not saved), suppress (`suppressed`), Fix / Float
(`fixed`: a fixed component is never moved by a mate), rename (double click too), delete. Delete also removes the mates and component
patterns whose faces belong to it (one undo step). A click on a row selects its faces; the placement fields under a selected row edit
`dx dy dz axis angle` (the mates move the component afterwards).

Which component owns a face or edge name: the name carries the insert id (`F2.S.e12@F6.1` is a face of the part inserted by F6); pattern
copies add `@<pattern>.<k>` after it, and patterns nested in the part keep their suffix in front. `model.ts` (`componentOfName`,
`instanceOfName`) reads the last suffix that names an `insertPart`.

## Mates

New mate: kind, two (or three) reference pickers, Flip, a value for kinds with one, a name. A picker takes the next face selected in the
model. Preview solves the mate without committing it; Apply adds the feature. Edit on a mate row changes only the fields that differ (a
different kind replaces the feature); the trash button removes it. A mate the kernel rejects (`mateGeometry`, `mateSameBody`,
`mateFixed`, `mateConflict`) shows the code on its row and the edit fails with the usual toast. The DOF tip above the list names the
components that can still move.

Kinds (all solved by the kernel unless marked): references are FACES; angles are degrees.

| Kind | References | Fields | Flip means |
|---|---|---|---|
| coincident, parallel, perpendicular, lock | `a`, `b` | | aligned / opposed (not perpendicular, lock) |
| concentric | `a`, `b` round faces (axis) | | aligned / opposed |
| distance | `a`, `b` | `distance` | |
| angle | `a`, `b` | `angle` | supplementary angle |
| tangent | `a`, `b` (plane / cylinder / sphere) | | other side of a plane; internal contact of two round faces |
| symmetric | `a`, `b`, `c` (mirror plane) | | |
| width | `a`, `a2` (tab), `b`, `b2` (slot) | | |
| limits | `a`, `b` | `of` (`distance` or `angle`), `min`, `max` | |
| hinge | `a`, `b` round faces; optional stop faces `a2`, `b2` | `distance` (stop offset, optional) | |
| slot | `a` pin, `b` wall, optional `b2` second wall | | |
| screw | `a`, `b` round faces | `pitch`, Drive `angle` (may exceed 360) | left-hand thread |
| gear | `a` driver, `b` follower round faces | `ratio` (turns of `a` per turn of `b`), Drive `angle` | same direction |
| rackPinion | `a` pinion, `b` rack (round or flat) | `radius`, Drive `angle`, `dir` (3 numbers, for a flat rack) | reverse |
| profileCenter, path, linearCoupler, cam, universalJoint | | | disabled: "kernel pending" with the reason as its tooltip |

The kind menu is grouped (Standard, Advanced, Mechanical), every kind has an icon, a tooltip and (where it applies) its own Flip wording.
Optional references and numbers (hinge stops, second slot wall, Drive, `dir`) are left out of the feature when empty; clearing one on an
existing mate replaces the feature (a `set` cannot remove a field). The draft is checked before it is sent: every required face, different
faces, numbers present, `ratio` and `pitch` not zero, `radius` above zero, `min` not above `max`, `dir` all three numbers or none.

### Drive and the test slider

Gear, screw and rackPinion have a Drive field (degrees, empty = the coupling is free). Under it a "Test drive" slider (-360..360, screw
-1080..1080) previews the motion: every change runs the mate as a preview (`host.preview`, the same path as Preview), Cancel drops it and
Apply keeps the value in `angle`. With a Drive set the coupling takes the freedom it had (`dof.total` goes down by one).

### Degrees-of-freedom report

The session transport wrapper (`kernel.ts` `watchComponents`) adds `opts.dofReport: true` to every regen of the document itself and keeps
the `assembly` object and the structured errors of the reply (`controller.assemblyExtra()`). The top of the Mates section shows:

- the total (`N DOF remaining`, translational and rotational) and one line per component (`N DOF (t T, r R)`, or `fixed`);
- when `overConstrained`, a banner listing the `redundant` mates (they add no constraint) and the `conflicts` (`<mate> conflicts with <earlier
  mates>`); a click on either row selects that mate in the list and its faces in the model;
- one "rolled back" note per mate the kernel rejected (`mateConflict` names the neighbouring mates, `mateGeometry` shows `params.detail`,
  `mateFixed`, `mateSameBody`, `missingReference`); the mate row says "rolled back" too. A rolled-back mate leaves the components where the
  earlier mates put them.

An edit that would make the kernel reject a mate fails as a whole (the session keeps the document), so these notes mostly show for files
opened with such a mate in them. Past 30 floating components the kernel skips the rotation split (`truncated`); the panel says so.

### Adding a kind

One table: `assembly/mateKinds.ts` `MATE_KINDS`. A row is `{id, group, icon, refs, params, choice?, flip, flipLabel?, pending}`:

- `refs`: the reference slots (`a`, `b`, `a2`, `b2`, `c`; `optional` ones may stay empty), each with a label and the accepted entity types;
- `params`: numeric fields stored on the feature under `key` (length, angle or plain number) with a default; `optional` ones are left out
  while empty (NaN default), `drive` adds the test slider, `vec` makes a component of a vector field (`dir`);
- `choice`: a text field (limits `of`);
- `flip`: whether the kind has the aligned / opposed switch (`flipLabel`: it has its own wording `asm.mate.flip.<id>`);
- `pending`: true while the kernel does not solve it (listed, disabled, tooltip `asm.mate.pending.<id>`).

Strings: `asm.mate.kind.<id>`, `asm.mate.tip.<id>`, `asm.mate.ref.<label>`, `asm.mate.param.<key>`, `asm.mate.ptip.<key>` in `locales/assembly.ts`.
The editor, the list, the feature builder (`mateFeature`) and the validation (`draftProblem`) read the row.

## Samples

`assembly-block-bolt` (insert part, coincident + concentric), `assembly-gear-train` (a 20-tooth and a 40-tooth gear from the Gear editor's
generator on two fixed shafts: a hinge each with a stop face on the plate, and a gear mate with `ratio` 2 = 40/20; 1 DOF left, set a Drive
on the gear mate to turn them), `assembly-hinge-door` (a door leaf on a pin: hinge with stop, plus a `limits` mate of `of: angle` 0..110).

## Interference

Runs the kernel `interference` query and lists the pairs by component name with the shared volume. A pair the kernel could not compute
shows its error code (`booleanFailed`). A click selects every face of both bodies and frames them. (The Inspect drawer keeps its own
interference card.)

## Bill of materials

One item per distinct part document (same inserted part = one item, Qty counts the instances, copies made by a component pattern count
too; suppressed components are left out). Mass each = volume of the part measured alone (kernel `massProps` under a separate tag, cached)
times the density of the PART's material (`inspect/mass.ts` table and material catalogue); no density known: the mass is blank. Total row.
A row click selects the bodies of its components. Save CSV writes `bom.csv` through `platform.saveFile`
(`No.,Part,Qty,Material,Mass each (g),Mass total (g)` and a Total row). Geometry of the root part itself is not an item.

## Exploded view

Display only: `display.ts` draws the kernel's body with hidden components left out and the others moved; picking keeps the kernel names;
measure, section, mass and export use the assembled positions. Spread is the factor on each component's distance from the middle of all
components (box centres); direction is away from the middle or along X, Y or Z only; "Move a component along an axis" adds a drag offset
to one component (all its pattern copies); Reset clears both.

The arrangement is saved in the document as a top-level field, `explode: {spread, dir, manual: {<insert id>: [x, y, z]}}`. The session
keeps unknown document fields; the field is held in the controller (`setDocExtra`), is part of `document()` for Save and autosave, is not
an undo step and never triggers a rebuild. Hidden components are not saved.

## Not done

Edit part in context, new component in place, replace part, insert another instance from a component's menu, a real in-viewport drag
of a component in the exploded view (the offset slider does it), profileCenter / path / linearCoupler / cam / universalJoint mates (kernel),
edge references (the kernel takes faces only), a Drive for hinge.
