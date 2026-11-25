// solidcraft #293 / solidcore #960 (fixture 293-fin-round-past-its-thickness): 40 x 30 x 20 block, 2 x 30 x 10 fin on it (x 19..21), top edge of the fin at x = 21 rounded r 4 (more than the 2 mm fin).
// Upstream: SolidCraft refuses and reduces; solidcore builds it only with an opt-in "cliff overflow" (removes 92.5956361669492 mm3 as if the fin's far face were absent); the pinned SMLib refuses.
// Ours now builds it (valid solid, volume 24507.404363833, the same as solidcore's opt-in cliff overflow); before it refused with blendOverflow.
// EXPECT {"volume":24507.404363833,"valid":true}
const p = part('Fin').sketch('front', (s) => { s.rect(40, 30, [20, 15]); }).extrude(20)
  .sketch(at('front', 20), (s) => { s.rect(2, 30, [20, 15]); }).extrude(10)
  .fillet(edges({ near: [21, 15, 30], within: 0.5 }), 4);
