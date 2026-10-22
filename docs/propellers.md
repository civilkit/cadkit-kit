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

`apps/cad/src/marineData.ts` makes a hub with 2 to 6 blades whose pressure face lies on a helicoid (a true constant-pitch one by default; with rake and progressive pitch, see below). Pure functions like `propData.ts`: parameters, validation,
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

Parameters: diameter, hub diameter and length, bore, blades 2..6, pitch / diameter (at the tip), progressive pitch, rake, EAR 0.25..1.2, chord peak / root ratio / tip ratio, skew, thickness at root and
tip as fractions of D, root embed, section spacing, direction.
`validateMarine` refuses what cannot be built (a hub too short for the root, with the length needed; rake or progressive pitch out of range) and warns on a razor tip, on blades overlapping at the hub and on a low pitch at the hub.

### Rake and progressive pitch

Two parameters, both 0 by default; with both 0 the feature list is identical to the earlier constant-pitch propeller (checked against the previous generator for five parameter sets), so old records and models are unchanged.
Old records that lack the fields read with the defaults filled in (`readMarine`).

* **Progressive pitch** `pitchProgress` (-0.15 to 0.5): the local pitch is linear in the span fraction x (0 at the hub surface, 1 at the tip): `P(r) = P_tip (1 + pitchProgress (1 - x))`, with `P_tip = pitchRatio x diameter`.
  So `pitchRatio` is the pitch at the TIP, and **positive = more pitch at the root** (0.2 gives 20 % more pitch at the hub surface than at the tip), as on a typical progressive-pitch propeller; negative lowers the root pitch. The law holds on
  the stretch inside the hub too (x < 0).
* **Rake** `rake` (-20 to 30 degrees): the blade leans aft (+Z): the face height gains `tan(rake) (r - hubR)`, so it is unchanged at the hub surface. Negative leans forward.
* **The face** is `z(phi, r) = P(r) phi / 2 pi + tan(rake) (r - hubR)`. In a section plane (phi fixed) that is LINEAR in r (P is linear in r), so the face line stays a straight line, now sloped: dz/dr = P'(r) phi / 2 pi + tan(rake). The generator
  samples the face at nine points and writes a line when they are collinear and a spline through them when they are not (never, for this law, but a nonlinear law would work without changes); a straight line is also what the kernel fuses best.
* **The back** is the face plus an axial offset `a(phi, r)`. The thickness t is asked NORMAL to the face, and the face now slopes in two directions, so the first-order offset is `t / n_z = t sqrt(1 + (dz/dr)^2 + (dz / r dphi)^2)`.
  That is exact only where the back is parallel to the face. The offset changes with r and the normal leaves the face sideways by several mm near the root (tan(pitch angle) is about 1.4 at r = 35 mm), so one Newton correction follows: march along the exact normal
  to the first-order back (bisection) and add (t - distance found) / n_z. Residual against an independent numeric march along the normal to the final back, at four radii and three angles, for eight parameter sets:
  under 1 % (the largest, 0.6 %, at the root with rake 30 and progress 0.5); the first-order offset alone is 2.4 % too thick at rake 20, progress 0.3 and 4.8 % at rake 30, progress 0.5 (it is 0.7 % thin at the root without rake). With
  rake and progress both 0 the original first-order offset is kept so that existing models do not change by 0.7 %.
* **The outline**: the angular width at radius r is `chord cos(theta) / r` with theta = atan(P(r) / 2 pi r), the LOCAL pitch angle. Rake does not change theta: the helix on the face runs at constant r, and the radius-only rake term tilts the face
  along r instead (it changes the normal and so the axial offset, not the helix angle). Progressive pitch makes the root steeper and narrower in angle.
* **Hub length**: `hubLengthNeeded` takes the largest |face height| over the part of every section inside the hub radius (both ends; the height is linear) plus the axial thickness at the embed radius and 2 mm. A positive rake lowers the root (it is
  zero at the hub surface and negative inside), progressive pitch raises it; the rule follows both, and a hub of exactly that length builds (tested).
* Ends of sections stay 0.6 mm off the hub surface as before.

Validation: `rake` and `pitchProgress` are errors outside their ranges; `rootPitch` is a warning when the pitch at the hub surface is 0.8 D or lower (see the sensitivity below: a pitch falling toward the root is where the hub fuse fails). The lower limit of progressive pitch is -0.15, not the -0.3 first tried: deeper negative values are refused by the kernel for many rake values (table below).

### The marine wizard

Features tab, Create group, Propeller (or Catalog, Generators), then **Family: Marine helicoid** on the Size step (a new propeller only; an edit opens the family that made it). Same three steps as the
airfoil family: Size (presets outboard 3-blade, inboard 4-blade, quiet 5-blade skewed; diameter, hub, bore, blades 2..6, right / left hand), Blade (pitch / diameter at the tip, progressive pitch, rake, expanded area ratio, chord shape,
skew, thickness at root and tip, where the foil is thickest, edge thickness, tip rounding, root embed, section spacing) and Review (readout, checks, notes). The record lives on the hub sketch as `prop` with `family: "marine"`; the airfoil reader
(`readProp`) leaves such a record alone and `readMarine` leaves an airfoil one alone, so double-clicking any feature of a marine propeller opens the marine panel.

* Marine hub, bore and blade count are plain numbers, not document variables (the section count changes with almost every edit of the blade, so a variable cannot drive the pattern alone).
* The section count changes with the blade shape, so most edits change the structure: the live preview and the commit remove all the old features (reverse document order, cascade) and append the new
  ones (two undo steps for an Apply; one patch for a Create). An edit that keeps the section count (a thickness change, say) replaces the features in place (one step, ids kept).
* **Spacing retry.** If the preview fails (typically `booleanFailed` where a blade edge meets the hub, see below), the panel retries the same propeller with a section spacing of 7, 6, 4 and 3 degrees (3 is the last resort: it builds the lowest root pitches, in about 15 s); the first
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

#### Measured with rake and progressive pitch (kernel, 250 mm, 3 blades unless noted; `marineData.kernel.test.ts`, second describe)

| check | result |
|---|---|
| build (mild 12 deg / 0.2, strong 20 deg / 0.3, forward -15 deg / -0.15 (the limit), rake 25 only, progress 0.5 only) | no errors, one solid, valid at 1e-3 mm, 2.9 to 4.4 s each (hub 110 to 114 mm, grown by `hubLengthNeeded`) |
| face on the intended surface | worst of 12 sampled points 2.3e-2 mm (strong), 9e-3 mm (forward) from the solid |
| thickness normal to the face at r = 40 / 75 / 110 (asked 7.63 / 5.00 / 2.38) | mild 7.54 / 4.99 / 2.37, strong 7.52 / 4.98 / 2.37, forward 7.58 / 5.00 / 2.37 mm: at most 1.4 % off |
| volume against hub + N x integral of thickness x developed area | mild -0.6 %, strong -0.8 %, forward +1.5 %, 4 blades strong -1.3 %. The plain thickness x chord integral (which ignores that the face also slopes along r) is -0.1, +0.7, +2.5 and +0.3 % |
| centre of gravity off axis | 2e-4 mm (3 blades), 5e-6 mm (5 blades, forward) |
| left-hand mirror | volume equal to 1e-6 relative, axial centre of gravity equal to 1e-6 mm |
| STEP round trip | volume 9.5e-6 relative, one body |

Sweep, as pinned by the test (22 combinations: rake -20, 0, 15, 30 degrees x progress -0.15, 0, 0.25, 0.5 on the default propeller, and the inboard4 and quiet5 presets with three combinations each): all 22 build at the first
spacing (5 degrees), 2.3 to 5.4 s each; no refusal occurred inside the allowed range (the test still checks that a refusal would be a structured `booleanFailed` with a hint, trying the spacings 5, 7, 6, 4, 3 in the order the wizard uses).

Probe beyond the limit (default propeller, hub 110 mm, same spacing order; what is built is one solid; a failure is `booleanFailed`, hint "the intersection of these faces could not be closed into a valid solid (touching tangentially,
a rim lying on the other surface, or a sliver thinner than ~1e-3); move the tool by a small amount (0.01), unite the bodies that touch each other first, ..."):

| progress | root pitch | rake -20 | rake -10 | rake 0 | rake 15 / 20 | rake 30 |
|---|---|---|---|---|---|---|
| -0.1 | 0.9 D | 5 deg | 5 deg | | | |
| -0.15 | 0.85 D | 5 deg | | 5 deg | 5 deg | 5 deg |
| -0.2 | 0.8 D | refused at 5, 7, 6, 4, 3 | refused at all five | 7 deg | 7 deg (rake 20) | |
| -0.25 | 0.75 D | refused at all five | | 7 deg (6 in another run) | 7 deg | 7 deg |
| -0.3 | 0.7 D | 3 deg only (about 70 s with the failed attempts) | | refused at all five | 3 deg only (54 s) | 3 deg only (57 s) |

(A number is the section spacing that built; the table merges runs made while the generator was being finished, and which spacing builds changes with small geometry changes, so treat the cells as the shape of the problem, not as a guarantee.)
The failure is the open-edge sensitivity of the hub fuse for a low root pitch, as for a constant pitch of 0.8 D or lower (see "Known sensitivity" below); rake alone (-20 to 30) never failed, and a forward lean makes the low-pitch case worse. The
allowed range stops where every rake value in it built at the first spacing (-0.15); `validateMarine` warns for a root pitch of 0.8 D or lower. The failure rate of the allowed range is 0 of 22; beyond it (progress -0.2 to -0.3, 12 probe cells) 12 of 12 failed at the first spacing
and 4 of 12 were refused at every spacing. These are kernel limits to hand to the open fuse brief (fixtures in the kernel repo, `tools/cases/marine_fuse`), not something the generator can fix with the 0.6 mm end offset.

#### Known limits of rake and progressive pitch

* Pitch is linear in span and rake is a straight lean (linear in the distance from the hub): no cup, no blade-section camber, no skew-induced rake, no root fillet.
* The back is an axial offset of the face, so the rim walls (leading and trailing edge) are axial, not normal to the face; the thickness is normal to the face only along the face.
* A progressive pitch below -0.15 is refused by validation because the hub fuse fails for many layouts (table above); rake alone has no limit inside -20 to 30 that failed.
* Build time grows slightly with rake (the section offset needs a bisection per back point) but is dominated by the kernel: 3 to 5 s for 3 blades.

#### Sample

`marine-propeller` (3 blades, 250 mm, rake 10 degrees, progressive pitch 0.15) is generated by `npx vite-node apps/cad/scripts/genPropSamples.ts -- --marine apps/cad/public/samples` and is listed in the samples index and the pages allow-list.

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
are moved off it (a tangent contact), which removed some failures but not these. The wizard retries with another spacing (7, 6, 4, 3) before telling the user (see "The marine wizard").

Two causes of that sensitivity were found and removed (marine v3), which is why pitch 0.8 now builds at 4, 5, 6 and 7 degrees and the presets build at 5:

* A section plane through the hub cylinder's seam (angle 0): an odd number of rays puts one at the blade's middle, which is about 0. The ray grid is shifted (up to 0.4 step) until every ray is at least 1.2 degrees off the seam, and no extra ray is inserted there.
* A sliver section: the first or last ray of a blade sometimes clears the hub by under a millimetre. Rays that end less than 4 mm outside the hub surface are dropped.

Extra rays are also refused where an end falls within 6 mm of the hub surface (except in the middle of the embedded stretch): refining the root-side corner there makes the fuse fail again.

### Blade foil and outline (marine v3)

* Normal thickness is t(r) x f(s), f = e + (1 - e) g(s): g is an ellipse from the nose to the maximum (`maxThickAt`, default 0.45) and a parabola behind it; `edgeThick` is e (default 0.06); the absolute edge is never below 0.3 mm (e is raised where the blade is thin, near the tip). `tipRounding` (default 0.15 of the span) closes the chord along an ellipse with a 5 % floor, so the tip is round.
* Outline: the section lines are radial, so the rim is a polyline through their ends. Extra rays are inserted where the tip-side end jumps by more than 5 % of the tip radius (corners), and on the outer blade (ends beyond 0.6 R) where the rim turns by more than a kink measure (turn x shorter piece, 0.8 mm at a 150 mm tip radius), down to 1 degree between rays. A 5-blade 300 mm propeller goes from 25 rays to about 43 at the default 5 degree spacing; the build takes roughly twice as long (about 10 to 25 s for 3 blades, up to about 55 s for 5 blades). The root-side corners (where the outline leaves the hub) are not smoothed and stay as straight pieces.
* Known limits: near the root at s 0.7 to 0.85 the measured thickness is 19 to 38 % above the foil value (the first-order axial offset ignores the chordwise slope of the back on the steep face; not corrected); the round tip reads 3 to 5 % thick above r = 108 mm (about 0.1 mm); a faint dash or line can show on a blade face where two sections meet (display only). `rake 12 / progress 0.2` is refused at 5 and 6 degrees and builds at 7 (the wizard retries).

