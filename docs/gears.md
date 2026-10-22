# Gears

The Gear command (Features tab, Create group, Shift+Y, or search "gear") makes a parametric gear from a true involute tooth profile.
"Gear pair" makes two meshing gears in one go. Both are ONE edit, so one undo step, and the Editor opens on the result with a live preview and OK / Cancel.

## What is built

| Role | Feature |
|---|---|
| profile | sketch on the chosen plane (top plane, a picked planar face, or a selected reference plane): the closed tooth outline |
| body | extrude (add) by the face width; helical gears use the extrude `twist` (a real twisted extrude, not slices). A herringbone makes two: `body` goes up half the face width with half the twist, `bodyDown` goes down (flipped) with the opposite twist, both from the same profile sketch on the mid plane |
| hubSketch, hub | circle sketch and extrude (add) of the hub, when a hub length and diameter are set (a herringbone hub is centred on the mid plane) |
| grooveSketch, groove | herringbone only, when the groove width is above 0: two circles (root circle less half a module, tip circle plus one module) and a mid-plane cut of the groove width, leaving the core web that joins the two chevrons |
| boreSketch, bore | circle sketch and through cut |
| keySketch, key | keyway rectangle (DIN 6885 width and depth by bore size, or custom) and through cut |

A pair repeats the roles for the second gear with the prefix `m.`.

### The profile

Per tooth: one circular arc for the tip land and one spline running down the flank, through the root fillet and the root circle, and up the next flank.
The spline passes through points computed on the involute (6 to 8 per flank, fewer for large tooth counts); the fillet is a circle tangent to the
flank and the root circle (or to the radial line when the base circle is above the root circle). Volume against the polygon through the same points
converges to 0.004 % between 8 and 12 points per flank, so 8 is far finer than any tolerance in use. One spline per gap (not one line per segment)
keeps the sketch small: a 36 tooth gear is 72 entities. When there is no fillet, or it cannot be built, a corner at the root splits the spline in two with a root arc between.

Kernel notes found while building this: arcs run counter-clockwise from p1 to p2; sketch coordinates must keep full precision (rounding to 1e-5
made arcs fail the closed-profile test); a short straight line meeting an involute spline tangentially produced zero-length edges, so the radial
piece is a span of the spline instead.

## Parameters

Type (spur, ring = internal, helical, herringbone, rack), module (mm) or diametral pitch (module = 25.4 / DP), teeth, pressure angle (20), face width, bore, keyway,
hub diameter and length, addendum and dedendum (multiples of the module, 1 and 1.25), root fillet (multiple of the module, 0.3), backlash, profile shift x,
helix angle and hand, ring rim thickness, and an optional mating gear (teeth, bore, hub).

* Backlash is the tooth thickness removed at the pitch circle by this gear (half of it from each flank). A pair created by the command uses 0.06 module on the first gear and the same on the mate, so the flanks do not touch and the two bodies stay separate solids.
* Profile shift x thickens the tooth by 2 x m tan(alpha) and raises the addendum by x m. For a ring, x makes the ring teeth thinner.
* Helical gears: the module and pressure angle are normal; the profile is the transverse one (module m / cos beta, alpha_t = atan(tan alpha / cos beta)); the twist over the face width is w tan(beta) / r_pitch. The mate of a helical gear has the opposite hand.
* Ring gear: the sketch is the rim circle plus the outline of the tooth spaces (a ring's space is shaped like a spur tooth). Root fillet is not applied to rings.
* Rack: a polygon of straight flanks (pressure angle), `teeth` teeth long.
* Herringbone (double helical): the helix angle (default 30, warned outside 15 to 45), hand and face width are those of a helical gear, face width is the total. `hand` means the chevron orientation (apex leading or trailing). The centre groove (`grooveWidth`, default about 3 x module in the editor, 0 = none) is cut through the tooth zone and leaves a web at the root circle less half a module (the root circle itself grazes the root fillet faces and the boolean fails). A mate is the same gear with the chevron reversed, placed like a helical mate.
* Bevel gears are not built (the bench sample `bench-bevel_gear` shows the loft approach).

## Readout

Pitch, outside, root and base diameter; the transverse contact ratio against the mating gear (the same tooth count when there is none; a pinion of half the
teeth for a ring; a pinion of the same tooth count for a rack), plus the overlap ratio w sin(beta) / (pi m) for helical gears; the minimum tooth count
without undercut, 2 ha cos(beta) / sin^2(alpha_t), rounded up (18 at 20 degrees). Below it the editor warns and offers the profile shift that avoids undercut.
Other warnings: pointed teeth (tip clamped to keep a land), teeth touching at the root, ring tip circle below the base circle.
Herringbone: the readout adds the total face width, the groove and the overlap ratio of one half, (w/2 - g/2) sin(beta) / (pi m); the total contact ratio adds the overlap of the face width less the groove (the chevron halves cancel axial thrust, the overlap is not simply doubled). Warnings: helix angle outside 15 to 45, half the face width twisting more than a quarter turn round the gear, groove at least the face width.

## Where the parameters live

On the profile sketch, as a `gear` field: the whole parameter record plus `roles` (role to feature id). The kernel keeps unknown fields, so the record
survives regeneration, undo and saving. Opening any feature of a gear (double click in the tree, or the command's own result) opens the Gear editor
on that record; the editor regenerates the features from it with the same ids (roles that appear are inserted after their predecessor, roles that go away
are removed). Consequences: editing the profile sketch by hand is not offered for a gear (delete the `gear` field, or edit the part file, to take it over);
features of other gears or later features that reference a gear's faces keep working as long as the role stays.

## Timings

Measured edit time (sketch regions, extrude, bore cut) in the kernel on a machine with a load average of 30 to 60 (other jobs running), so read these as upper bounds:
8 teeth 1.3 s, 20 teeth 3.3 s, 40 teeth 12 s, helical 20 teeth 6.7 s, the 20 / 40 pair 37 s. A herringbone costs about twice a helical gear (two extrudes and a cut): in the kernel test run, 20 teeth about 14 s, 40 teeth 26 s and the 20 / 40 pair 26 s of regeneration, on a machine under similar load. Cost grows about linearly with the tooth count (one spline and one arc per tooth).
The first version, with a line, arc and spline per flank piece, took 51 s for 60 teeth and produced invalid solids at some tooth counts; one spline per gap fixed both.
The live preview debounces, so typing in a field regenerates once it settles.

## Tests

`gearData.test.ts` (readout, profile on the involute, feature roles and ops, samples match the generator), `GearEditor.test.tsx`, and
`gearData.kernel.test.ts` (run with `CK_WASM=apps/cad/public/kernel/ck_wasm.wasm`): validity, tooth count, volume against the profile area, one undo step, id
stability across edits, helical twist volume, ring and rack volumes, a 20 / 40 tooth pair at 60 mm with two separate bodies and the phase. Herringbone: 20 and 40 teeth valid as one body, mirror-even about the mid plane, the groove cut, one undo step, ids stable across edits; a 20 / 40 pair with two bodies, no interference, opposite hand and both chevrons centred; helix 0, helix 60 and a zero groove still valid.

Samples: `spur-gear` (24 teeth, bore with keyway, hub), `gear-pair` (20 / 40 teeth, module 2) and `herringbone-pair` (20 / 40 teeth, 30 degree helix, 6 mm groove), generated by `npx vite-node apps/cad/scripts/genGearSamples.ts`.
