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

Kernel today (`ck-model` `MateKind`): coincident, concentric, distance, parallel solve; `angle` parses but the solver answers
`mateGeometry`; all references are FACES (planes for coincident / distance / parallel, cylinders and cones, by their axis, for
concentric). Edges are not accepted by the kernel; the table below can say `accept: ['face','edge']` when it does.

### Adding a kind

One table: `assembly/mateKinds.ts` `MATE_KINDS`. A row is `{id, group, refs, params, flip, pending}`:

- `refs`: the reference slots (`a`, `b`, optionally `c`), each with a label and the accepted entity types;
- `params`: numeric fields stored on the feature under `key` (length, angle or plain number) with a default;
- `flip`: whether the kind has the aligned / opposed switch;
- `pending`: true while the kernel does not solve it (the kind is listed, disabled, with "kernel pending").

Rows exist for perpendicular, tangent, lock, symmetric, width, limits, hinge, slot, screw, gear, rackPinion and angle. When the kernel
solves one: set `pending: false`, check its field names against the kernel (`a`, `b`, `flip`, `distance` today) and adjust `refs` / `params`,
and add the label strings `asm.mate.kind.<id>` (already there) in `locales/assembly.ts`. The editor, the list, the feature builder
(`mateFeature`) and the validation (`draftProblem`) read the row; no other code changes.

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
of a component in the exploded view (the offset slider does it), angle mates (kernel).
