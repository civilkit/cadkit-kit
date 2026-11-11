// solidcraft #4859 (fixture 4859-chamfer-inside-corner-of-a-thin-ring, wall 2): 25 x 15 x 10 ring, hole inset 2, chamfer 2 on the vertical edge of the hole's corner at (2,2).
// Upstream: refused on the old kernel ("changes N mm3, at most M mm3") although the chamfer only fills the hole's corner. Expected 1460 = ring + 0.5 2^2 10, 1 lump.
// EXPECT {"volume":1460,"tolRel":0.000001,"valid":true}
const p = part('Ring').sketch('front', (s) => { s.rect(25, 15, [12.5, 7.5]); }).extrude(10)
  .sketch(at('front', 10), (s) => { s.rect(21, 11, [12.5, 7.5]); }).cut(through())
  .chamfer(edges({ near: [2, 2, 5], within: 0.5 }), 2);
