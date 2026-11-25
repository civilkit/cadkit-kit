// solidcore #2845 / solidcraft #12342 (12342-round-wall-and-ledge-edges-r5): same L body, both edges R5: past the 3 mm ledge and the 4 mm wall.
// The right result is a valid body (a blendRanOffFace warning), volume 9242.43 = 9520 - 53.65 slab round - 223.92 wall round, hand-derived; refusing it was the earlier expectation.
// EXPECT {"volume":9242.43,"valid":true}
const p = part('L').sketch(at('front', -50), (s) => { s.rect(7, 40, [19.5, 0]); }).extrude(10)
  .sketch(at('front', -40), (s) => { s.rect(4, 40, [18, 0]); }).extrude(42)
  .fillet(edges({ union: [edges({ near: [20, 20, -19], within: 0.3 }), edges({ near: [23, 20, -45], within: 0.3 })] }), 5);
