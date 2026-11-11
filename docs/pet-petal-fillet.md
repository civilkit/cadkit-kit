# Filleting the PET bottle petal grooves (kernel status)

Cup stage = the solid base cup with the five drafted lens grooves cut in (docs/examples/pet-bottle.script.ts), before the cavity is cut out. Radii tried: 0.3, 0.5, 1, 2, 3 mm (cup) and 0.1, 0.3, 1, 3 mm (finished bottle). The result of a failed fillet is the unfilleted solid (valid, same volume); nothing was produced with a bad shape.

| Edges (5 grooves x ...) | Surfaces | Cup, every radius | Finished bottle |
|---|---|---|---|
| groove ceiling x groove wall (concave) | plane x cone | blendOverflow | same edges, fails |
| groove ceiling x outer wall | plane x cylinder, 90 degrees | **ok** (0.5 to 3, valid) | not tried alone |
| groove wall x outer wall | cone x cylinder | blendFailed | same |
| groove wall x corner round | cone x torus | blendFailed | same |
| groove wall x standing ring | cone x plane | blendOverflow | same |
| groove wall x push-up cone | cone x cone | blendFailed | same |
| wall x wall at the sharp lens tip | cone x cone, concave | blendUnsupported | same |
| all edges of the grooves, or any chain of several classes | | blendUnsupported / blendFailed | blendUnsupported at 0.1, 0.3, 1, 3 |

The same results come out of the kernel wasm deployed on 5 Nov and of kernel main (7 Nov). For kernel main after 8 Nov see "Kernel update (8 Nov)" below. On the finished bottle the wall is 0.35 mm, so an outer fillet over 0.35 mm would also meet the inner surface unless the cavity is rounded by wall + radius; round the cup and the cavity body separately, never the finished shell.

## Diagnosis

1. A fillet that ends on a face which the groove wall meets at an angle other than 90 degrees fails with blendOverflow at any radius (0.3 too). Minimal repro (plate 80 x 80 x 30, round pocket diameter 20, depth 10, centre 6 mm inside the plate edge so it breaks out through the side wall; fillet the pocket rim arc on the top face, radius 1): blendOverflow. The same pocket centred exactly on the edge (90 degree break-out) fillets fine, as does a pocket that does not break out.
2. A cone against a cylinder, torus or another cone (a drafted wall crossing the base's corner round or push-up cone) gives blendFailed even for one edge: the intersection is a free-form curve and the free-form strip fallback fails. Repro: a disc diameter 66 with a 9 mm round on the bottom edge, a drafted (10 degrees) circular pocket from the bottom crossing the round and the side wall, fillet its rim: blendFailed.
3. The sharp tip where the two arcs of a lens meet leaves a concave cone x cone edge: blendUnsupported alone, and with it unrounded the rim fillets of the two arcs overflow at the tip (blendOverflow even in a plain drafted lens pocket). A lens with rounded tips (tangent arcs) fillets fine as a closed rim on a plain plate.
4. A concave fillet at the floor of a drafted rounded outline fails when the outline's tip radius shrinks (draft over the depth) to less than the fillet radius; that is a real overflow.

## Kernel update (8 Nov)

Kernel main from 8 Nov builds rounds that end on a face they meet at an oblique angle (diagnosis 1): the plate repro (pocket 6 mm inside the edge, rim arc r 1) now fillets, valid, with the exact volume, at the other crossing angles too, and so do the ceiling and foot arcs of a pocket (drafted or not) cut up through the side of a plate or through the wall of a disc. On the cup:

| Edges (5 grooves x ...) | Cup | Note |
|---|---|---|
| groove ceiling x groove wall (concave), all 10 arcs | **ok** at 0.5 and 1 (valid), blendFailed at 2 | the ends at the sharp tip run on into the material behind the other wall, the ends at the outer wall are trimmed by it |
| groove wall x standing ring | blendFailed | the ring runs on tangentially into the corner round; the round's tool stops flush there and touches the corner round tangentially, which the boolean does not assemble (a synthetic cup with one groove builds) |
| groove wall x outer wall, x corner round, x push-up cone | blendFailed | unchanged: free-form edges whose strip tool does not assemble at its ends |
| wall x wall at the sharp tip | blendUnsupported | now with a hint: a concave free-form round ends only on a plane, and this one ends on the push-up cone; round the tips (TIP) instead |

The groove ceiling can be rounded on the cup directly, but not yet on the finished bottle: the cavity's matching edge (radius + wall, at the rib tops) still fails (blendFailed: where its tool is trimmed by the cavity's outer wall, the union does not fuse the two faces on that cylinder), so PETAL_FILLET with rounded tool bodies stays the way to round the groove floor.

## What works, and is in the sample

Round the groove's cutting tool instead of the base: PETAL_FILLET > 0 cuts each groove with its own body (the lens drafted up from below the standing plane) whose top edge is rounded first; a tool is a plain closed prism, which the kernel fillets without trouble (alone: a tool filleted while the cup exists, or several tools in one fillet, fails). It needs TIP > 0 (rounded lens tips, tip radius under the lens half width of 7.5 and over the draft shrinkage, 12 x tan 10 = 2.1): TIP 5 with PETAL_FILLET 0.5 to 3 builds valid bottles for 3 to 7 feet and for a 0.5 mm wall; TIP 3 up to PETAL_FILLET 1; TIP 2 fails (draftTooLarge), PETAL_FILLET 4 fails (blendOverflow), sharp tips fail. The cavity's ribs use the same tool one wall wider with radius PETAL_FILLET + WALL, so the wall stays even. This rounds the groove floor and the tips; the convex edges where the groove walls meet the base surface stay sharp (no kernel route yet, see above).
