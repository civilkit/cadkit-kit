// solidcraft #4859 (fixture 4859-chamfer-inside-corner-of-a-thin-ring, wall 1): 25 x 15 x 10 ring, hole inset 1, chamfer 1 on the vertical edge of the hole's corner at (1,1).
// Upstream: refused on the old kernel ("changes N mm3, at most M mm3") although the chamfer only fills the hole's corner. Expected 765 = ring + 0.5 1^2 10, 1 lump.
// EXPECT {"volume":765,"tolRel":0.000001,"valid":true}
const p = part('Ring').sketch('front', (s) => { s.rect(25, 15, [12.5, 7.5]); }).extrude(10)
  .sketch(at('front', 10), (s) => { s.rect(23, 13, [12.5, 7.5]); }).cut(through())
  .chamfer(edges({ near: [1, 1, 5], within: 0.5 }), 1);
