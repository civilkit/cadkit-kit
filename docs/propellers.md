# Propellers

The airfoil-loft propeller generator (`apps/cad/src/propData.ts`) makes a hub with 2 to 8 lofted blades from a parameter record. It is the first of the two families in
`plan-propellers.md` (fans, drones, aircraft). The marine helicoid family is in the same wizard (the Family control on the Size step; generator `marineData.ts`, panel `MarineWizard.tsx`, see "Marine family" below). Geometry only, no aerodynamic or hydrodynamic performance.

## What is built

| Role | Feature |
|---|---|
| hubSketch, hub | circle sketch on the front plane (diameter driven by `prop_hub_d`), mid-plane extrude of `prop_hub_len` (centred on z = 0) |
| plane0.., sec0.. | for each blade section: an offset plane on the right plane at x = r, and a sketch of two splines (suction side, pressure side) sharing the leading and trailing edge points |
| blade | loft (add) through the section sketches, fused to the hub |
| pattern | circular pattern about Z, count `prop_blades`, 360 degrees equal |
| boreSketch, bore | circle sketch (`prop_bore_d`) and a through cut |

The shaft axis is Z, the thrust is toward +Z, blade 0 lies along +X. The hub sketch carries the parameter record as `prop`, so the wizard can reopen it.

**No root fillet.** The kernel cannot blend a lofted blade into the hub cylinder yet (`blendFailed`, see `rebuild/docs/prop-probe.md` capability 8), so the blades are fused
to the hub with a sharp junction. A blend can be added by hand later when the kernel supports it.

## Named variables

`prop_hub_d`, `prop_hub_len`, `prop_bore_d`, `prop_blades` (prefix `prop`, `prop2`... for a second propeller in the same document). Editing one in the Variables panel rebuilds only
the hub, the pattern and the bore: the blade sketches stay in the regeneration cache. The blade shape itself (chord, pitch, airfoil) is baked into the section points, so it
changes through the wizard. A variable change that moves the hub radius past the blade roots (root radius = root embed x hub radius) leaves the roots poking out: change the hub
in the wizard, which moves the roots with it.

## Parameters

* Size: diameter, hub diameter and length, bore, blade count 2..8, sections 5..12, rotation direction (ccw or cw seen from +Z).
* Twist: `pitch` (mm per revolution, section angle atan(P / 2 pi r)), `angle` (the same law set by the angle at a reference radius), or `linear` (root and tip angle). Angles are held at 80 degrees near the axis.
* Chord: root, mid and tip chord (a parabola through them) with a shape exponent. Thickness / chord likewise. The root value holds inside the hub: no extrapolation, so no NaN, whatever the radius.
* Airfoil: NACA 4-digit (camber, camber position, thickness from the distribution; sharp trailing edge), circular-arc camber with a biconvex lens, or a flat plate with a rounded nose.
* Pivot (chord fraction the sections turn about), rake (backward sweep, degrees), skew (tangential tip offset, mm, quadratic in span), root embed (where the blade starts inside the hub).

`validateProp` returns errors (the build is refused with a `PropError`) and warnings (root deeper than the hub, blades overlapping at the hub, a razor tip, clamped root angle).

## The wizard

Features tab, Create group, Propeller (shares the Gear button's flyout), or Catalog, Primitives, Generators. A panel opens in the left column with three steps:

1. **Size**: family (Airfoil loft; Marine helicoid is shown but disabled, "coming soon"), presets (Drone 5 inch, Desk fan, RC plane), diameter, hub, bore, blade count, rotation.
2. **Blade**: twist mode and pitch, chord and thickness curves (three draggable points each, arrow keys when focused, plus numbers and a shape exponent), airfoil with a section outline, camber, pivot, rake, skew, root embed, sections.
3. **Review**: readout (pitch, angles, blade area ratio), the checks (errors block Create, warnings do not), the notes (no root fillet, the variables, geometry only).

Every change previews live in the viewport (the controller debounces and cancels stale previews); Create adds everything as ONE document patch (variables and features, one undo step). The preview uses plain numbers,
the committed features use the variables. Double-click any propeller feature (or select it and edit) to reopen the wizard on its record. Apply regenerates the features in place (ids kept, one step); a changed section
count or a bore added or removed removes the old features first and appends the new ones (two undo steps).

## Checks (see the tests)

* `propData.test.ts`: distributions, airfoils, validation, features, ops, hostile random parameters (no kernel).
* `PropellerWizard.test.tsx`: the panel (steps, drafts, curve handles, validation, keys); `propWizard.kernel.test.ts`: the commit path through the Controller.
* `propData.kernel.test.ts` (needs `CK_WASM`): built section angle against atan(P / 2 pi r), CoG on the axis for N = 2..6, volume against the integral of the section areas, validity, STEP round trip,
  a seeded random sweep, the root chord at radii inside the hub.

Known: the kernel's default validation tolerance flags a 2.6e-4 mm pcurve deviation on the blade / hub intersection edges (the solid is valid at 1e-3 mm).

## Marine family (helicoid blades): generator and kernel probe

`apps/cad/src/marineData.ts` makes a hub with 2 to 6 blades whose pressure face lies on a true constant-pitch helicoid. Pure functions like `propData.ts`: parameters, validation,
readout, feature list, `marineDocument`, and the edit path (`marineOps` for the live preview, `marinePlan` for the commit, `readMarine` / `marineOwner` to reopen).

### How the blade is built

For each of N angles phi_k (at most `raySpacing` degrees apart, default 5) one plane through the shaft axis (`plane` mode `angle` about Z, angle phi_k + 90 degrees), and on it a closed
section: the **face line** from radius rA to rB at height z = P phi_k / 2 pi (the helicoid), the **tip end**, a **back spline** an axial thickness above the face, the **root end**. rA and rB are where
that ray enters and leaves the expanded blade outline, so the loft's side edges are the leading and trailing edge. One `loft` (add) through the sections is the blade; it is fused to the hub,
`cpattern`-ed and bored like the airfoil family.

* Axial thickness is the normal thickness over cos(pitch angle). It is **not linear in radius** (it grows toward the root), so the back is a spline through 7 points; a straight back line
  made the blade 1.4 to 1.6 times too thick in the middle (found by sectioning the built blade in a ray plane).
* Outline: the widest chord comes from the expanded area ratio (EAR) and the chord shape (root ratio, peak position, tip ratio, cosine blends); the angular width at radius r is c cos(theta) / r;
  skew moves the mid-chord line by `skew` degrees at the tip, quadratic in span.
* The pressure face is the helicoid, all the thickness is on the +Z side. A left-hand propeller is the mirror image (volume and axial centre of gravity equal to 1e-6).

Parameters: diameter, hub diameter and length, bore, blades 2..6, pitch / diameter, EAR 0.25..1.2, chord peak / root ratio / tip ratio, skew, thickness at root and tip as fractions of D,
root embed, section spacing, direction. Constant pitch only; rake and progressive pitch are not built (they move the face off constant-z section lines).
`validateMarine` refuses what cannot be built (including a hub too short for the root, with the length needed) and warns on a razor tip and on blades overlapping at the hub.

### The marine wizard

Features tab, Create group, Propeller (or Catalog, Generators), then **Family: Marine helicoid** on the Size step (a new propeller only; an edit opens the family that made it). Same three steps as the
airfoil family: Size (presets outboard 3-blade, inboard 4-blade, quiet 5-blade skewed; diameter, hub, bore, blades 2..6, right / left hand), Blade (pitch / diameter, expanded area ratio, chord shape,
skew, thickness at root and tip, root embed, section spacing) and Review (readout, checks, notes). The record lives on the hub sketch as `prop` with `family: "marine"`; the airfoil reader
(`readProp`) leaves such a record alone and `readMarine` leaves an airfoil one alone, so double-clicking any feature of a marine propeller opens the marine panel.

* Marine hub, bore and blade count are plain numbers, not document variables (the section count changes with almost every edit of the blade, so a variable cannot drive the pattern alone).
* The section count changes with the blade shape, so most edits change the structure: the live preview and the commit remove all the old features (reverse document order, cascade) and append the new
  ones (two undo steps for an Apply; one patch for a Create). An edit that keeps the section count (a thickness change, say) replaces the features in place (one step, ids kept).
* **Spacing retry.** If the preview fails (typically `booleanFailed` where a blade edge meets the hub, see below), the panel retries the same propeller with a section spacing of 7, 6 and 4 degrees; the first
  that builds is kept and the panel says so. The commit does the same before it touches the document, so a Create never leaves a half-built propeller.

### Measured (kernel, default 250 mm, 3 blades; `marineData.kernel.test.ts`)

| check | result |
|---|---|
| build | no errors, one solid, about 3 s (2 to 5 s for 2..6 blades); valid at 1e-3 mm (the usual 2.6e-4 to 7e-4 mm pcurve deviation on the blade / hub edges at the default tolerance) |
| face on the helicoid | worst of 12 sampled points 9e-3 mm from the solid |
| thickness normal to the face | 7.53 / 5.00 / 2.37 mm at r = 40 / 75 / 110 against 7.63 / 5.00 / 2.38 asked |
| volume against hub + N x integral of thickness x chord | +0.3 to +0.6 % for N = 2, 3, 4 |
| N = 2..6 centre of gravity off axis | at most 2e-4 mm |
| STEP round trip | volume 1.5e-4 relative, one body |

### Kernel probe: what did not work (so the next person does not repeat it)

| route | result |
|---|---|
| helicoid sheet (loft of radial lines), trim with an outline prism (`surfaceExtrude` + `trimSurface`) | builds, but `thicken` of the trimmed sheet fails: `thickenFailed` "the thickened body is not closed", also on a plain rectangle outline, and on the kernel's own `cap6` case (empty result). Thicken of the untrimmed sheet works |
| thicken the whole sheet, then cut it to the outline (extrude `intersect`, or a cut of everything outside the outline) | `booleanFailed` `openEdge` at the root corner of the outline |
| sheet with the outline as its boundary (rays end on the outline), then `thicken` | builds with `side: "back"`, but the rim walls cannot be fused with the hub cylinder (`booleanFailed openEdge`, every hub size and root ratio tried); `side: "front"` is `offsetTooLarge` (curvature) |
| thicken with `thicknessAt` ramp on the whole sheet | works (needs stops covering the whole sheet along the direction) but the same hub fuse fails |
| **closed sections in planes through the axis, one loft solid** | **works** (this is what is built) |

Open kernel items from this probe: thicken of a trimmed free-form sheet; the hub fuse of a thickened sheet's rim walls; the sensitivity below.

### Known sensitivity: section spacing

The hub boolean sometimes leaves an open edge where a blade edge meets the hub cylinder, depending on where the section planes fall: pitch / diameter 0.8 fails at 4 and 5 degrees and builds at 6 and 7;
0.7 fails at 4, 5 and 6 and builds at 7; 0.75 fails at 5. The refusal is a structured `booleanFailed` with a hint (`marineData.kernel.test.ts` pins this). Ray ends within 0.6 mm of the hub surface
are moved off it (a tangent contact), which removed some failures but not these. The wizard retries with another spacing (7, 6, 4) before telling the user (see "The marine wizard").
