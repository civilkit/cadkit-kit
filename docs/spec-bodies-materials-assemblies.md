# Bodies, materials and assemblies: spec

Status: discussion draft, 2026-10-17; checked against the code 2026-10-31. Mostly built, in a slightly different shape. A material library: built, for the whole document (material editor, catalogue with custom materials, `docs/materials.md`); a per-body material (`bodyMaterial`) is not built. B per-body mass: the kernel half is built (`massProps` takes `densities`, one per lump, and returns per-body mass); the kit still applies one density to the whole part. C first-class bodies: partly built (`op: newBody` with a `body` name on extrude, revolve, loft, sweep and sphere, a Target body control, Combine in the Bodies panel, `docs/bodies-appearance.md`); the kit still keys body names and looks by face name or feature id, and a warning when two bodies overlap was not found. D wires and layered parts: the bearing wizard builds rings and balls as separate bodies; a wire with core and sleeve is not done. E assemblies: built (insert part, mates, bill of materials, explode, interference; `docs/assemblies.md`). Remaining: per-body material and its picker, per-body density in the kit's mass read-out, stable body ids, overlap warning (not found), the wire sample.

## Why

Library parts such as motors, bearings, batteries, resistors and wires are made of several differently coloured
and differently dense parts that touch each other. Today a document has one material, and bodies are derived from
shared edges, so touching parts fuse into one body and lose their identity.

## What exists

- Per-body colour, opacity and finish (Bodies tab; doc fields `appearance`, `faceAppearance`, `bodyNames`,
  `view.hiddenBodies`; script `appearance()`, `bodyName()`).
- Bodies are derived kit-side from shared edges. They are not stored.
- Material is one string per document (`material` in the part header, `ck-model/src/lib.rs`). Mass properties use it
  for the whole part.
- Disjoint solids already show as separate bodies, because they share no edges.

## Decisions to take

1. Appearance and material stay separate. Appearance is colour, opacity and finish. Material is density, plus a default
   appearance.
2. Bodies become first-class: a stored id, not a derived grouping.
3. Multi-body parts first. Assemblies (instances with mates) are a later, separate project.

## Pieces

### A. Material library (small, kit side first)
- A table of named materials: name, density (kg/m3), default colour, default finish.
- The document keeps `material` as the default. A body may override it (`bodyMaterial[bodyId]`).
- Bodies tab: a material picker per body; changing it also resets the colour unless the colour was set by hand.
- Out of scope: thermal, strength and cost properties.
- Size: S (kit only), about a day with tests.

### B. Mass properties per body (kernel)
- `massProps` takes a density per body: mass is the sum of density x volume per body, the centre of gravity is mass
  weighted, and inertia is summed about the common origin.
- Reply lists per-body mass, volume and CG, plus totals.
- Addressing a single body at a time is deferred to piece C (real body ids); today `massProps` always covers every
  lump of the tag, and `densities` is a per-lump array (one entry per body in wire order).
- Size: S to M.

### C. First-class bodies and "New body" (the main change)
- Every solid-producing feature (extrude, revolve, loft, sweep, primitives, import) carries `body`: `"auto"` (default),
  `"new"`, or an existing body id.
- `auto` keeps today's behaviour: the result merges with bodies it touches, and becomes a new body if it touches
  nothing.
- `new` never merges, even when faces coincide. This is what keeps a wire's sleeve apart from its core, or a bearing
  ball apart from its race.
- A body id is allocated when the body is first created and survives edits, so appearance and material attach to it.
- Kernel: body-level `combine` and `bodyBoolean` already exist; the regeneration needs to keep bodies separate and
  return their ids.
- Risks: naming stability across edits, old documents (an unset field means `auto`, so they still open), and what
  happens when an edit makes two bodies overlap (report a warning, do not fuse silently).
- Size: M to L.

### D. Wires and similar layered parts
- Core and sleeve are two bodies with `body: "new"`: a cylinder (or sweep of a circle) and a tube around it.
- Each has its own material (copper, PVC) and colour.
- No new kernel feature is needed once C exists.
- Check: a sweep of a ring profile must produce a valid tube, and a path-following core must not fuse with it.

### E. Assemblies (later)
- A part is one feature tree with one or more bodies. An assembly holds instances of parts with a transform each.
- Needs: instance transforms, mates, a BOM, and propagation of part edits to instances.
- Do this only if you want to reuse library parts in many places; multi-body parts cover single models.
- Size: L.

## Order

1. C (first-class bodies) with B (per-body mass), since both need the same body ids.
2. A (material library) on top.
3. D as a sample and test of the above (a wire, a bearing with balls, a small motor).
4. E only after you decide you need reuse.

## Open questions

- Should `auto` merge on touching, or should an Add always keep the existing body unless the user chooses?
  (Recommendation: keep `auto`; it matches how people already work.)
- Should the Bodies tab let you merge two bodies afterwards (a Combine feature), and split one?
- Do you want the library parts (motors, bearings, batteries) as sample documents, or only the capability?

## Tests to write with it

- A wire, two bodies, correct per-body mass, `validate` ok, and no fusing after an edit.
- A bearing: two races and N balls as separate bodies; balls touch the race tangentially and stay separate.
- Old documents open unchanged.
- Colours and materials survive a rebuild that changes the feature order.
