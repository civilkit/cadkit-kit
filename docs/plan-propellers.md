# Propeller creator: foundations plan

Status: plan, 2026-10-19. Nothing here is built except what is marked "exists".
Goal: a parametric prop creator for two families, built on kernel features that are useful on their own.

## The two families

1. **Airfoil-loft prop (fans, drones, aircraft).** N blade sections (spline airfoils, e.g. NACA 4-digit) at radii r_i, each scaled by the chord c(r), turned by the pitch angle atan(P / (2 pi r)), shifted by rake and skew, lofted into one blade, fused to a hub with a root fillet, circular-patterned.
2. **Helicoid prop (marine).** A true constant- or variable-pitch helical surface, trimmed to the blade outline (expanded outline projected onto the helicoid), thickened with a thickness distribution (thick at the root, thin at the tip, back and face), fused to a hub, root fillet, patterned.

## Kernel capabilities needed (probe each; ours vs the original)

| # | Capability | Why | Status |
|---|---|---|---|
| 1 | Loft through 5 to 12 spline sections (closed, same kind, airfoil with a sharp trailing edge) | family 1 | polygon sections exist and work; spline sections untested; root section inside the hub failed (`noClosedProfile` at r=8) |
| 2 | Sections on planes along a radius, rotated about the radial axis; also sections on cylinders (wrapped airfoil) | family 1 | planes work; cylinder-wrapped sections not available |
| 3 | Loft with guide curves (leading and trailing edge) | blade outline control | exists for some cases (loft guides) |
| 4 | Helix curve and sweep of a profile along a helix (constant and variable pitch) | family 2 and threads | helix in threads exists; free helix curve + sweep untested |
| 5 | Ruled helicoid surface (line swept along a helix) as a sheet | family 2 | not known |
| 6 | Project a curve (blade outline) onto a free-form or helicoid sheet and trim | family 2 | `projcurve` exists; onto helicoid untested |
| 7 | Thicken a free-form sheet, constant AND variable thickness | family 2 | constant thicken fails on open loft sheets (`offsetUnsupported`, original `thickenReach`); variable thickness missing |
| 8 | Root fillet between blade and hub (free-form to cylinder) | both | fails on free-form pairs |
| 9 | Pattern of a lofted blade about the hub axis | both | works |
| 10 | Measure: blade area, pitch check (sampled), mass and balance (CG on the axis for N blades) | verification | mass props and CG exist |

## Order of work

1. **Probe** (DeepSeek, differential ours vs original, see `docs/original-gaps.md` once it exists): capabilities 1 to 8 as minimal cases, report works / refused / wrong.
2. **Fix the gaps** the probes show, cheapest first: 1 and 2 (loft robustness), 8 (blade-hub fillet), then 7 (thicken of free-form sheets, the same family as the boat hull shell gap), then 4 to 6.
3. **Prop wizard (GUI)**: a guided dialog in the catalog (same route as the gear generator): step 1 family (airfoil loft or marine helicoid), step 2 size (diameter, hub, bore, blade count), step 3 blade (pitch, chord and thickness curves as small editable graphs, airfoil, rake, skew), step 4 hub (keyway, set screw, root fillet), live preview and mass readout, result is an ordinary editable feature tree (not a locked part) so every step stays editable afterwards. Presets: drone 5 inch, RC plane, desk fan, boat 3-blade.
4. **Parametric generator** (the engine behind the wizard) in the library layer (the same route as the BOSL gear catalog): a `propeller` part with parameters (diameter, hub diameter, blade count, pitch, chord and thickness distributions, airfoil, rake, skew, bore and keyway). Family 1 first, family 2 when 4 to 7 work.
5. **Tests**: pitch accuracy (section angle vs atan(P / 2 pi r) at sampled radii), blade count symmetry (CG on the axis, within 1e-3 mm), volume against numerical integration of the section areas, valid solid, STEP round trip.

## Not in scope
Aerodynamic or hydrodynamic performance. Only geometry.
