# Propellers

The airfoil-loft propeller generator (`apps/cad/src/propData.ts`) makes a hub with 2 to 8 lofted blades from a parameter record. It is the first of the two families in
`plan-propellers.md` (fans, drones, aircraft). The marine helicoid family is not built yet. Geometry only, no aerodynamic or hydrodynamic performance.

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

## Checks (see the tests)

* `propData.test.ts`: distributions, airfoils, validation, features, ops (no kernel).
* `propData.kernel.test.ts` (needs `CK_WASM`): built section angle against atan(P / 2 pi r), CoG on the axis for N = 2..6, volume against the integral of the section areas, validity, STEP round trip,
  a seeded random sweep, the root chord at radii inside the hub.

Known: the kernel's default validation tolerance flags a 2.6e-4 mm pcurve deviation on the blade / hub intersection edges (the solid is valid at 1e-3 mm).
