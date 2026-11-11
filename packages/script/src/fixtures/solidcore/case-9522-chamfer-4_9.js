// solidcraft #9522 (fixture 9522-chamfer-round-the-rounds-of-a-cube, case chamfer_4_9): 30 cube, four vertical edges rounded R5, then the 8-edge bottom loop (lines + R5 arcs) chamfered 4.9 (just inside the rounds' R5).
// Expected 25141.84803682962 (coarea formula; their tol 1.86), 1 lump, upstream builds with four cone faces.
// EXPECT {"volume":25141.84803682962,"tolRel":0.0001,"valid":true}
const p = part('Cube').sketch('front', (s) => { s.rect(30, 30, [0, 0]); }).extrude(30)
  .fillet(edges('|Z'), 5)
  .chamfer(edges('<Z'), 4.9);
