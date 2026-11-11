// solidcraft #9522 / solidcore #2546 (case chamfer_4_9999_within_the_resolution_is_refused): same, chamfer 4.9999 (corner arcs of radius 0.0001, ends 1.4e-4 apart, within the part resolution).
// Upstream: REFUSED with the largest size that builds (4.99977). Any valid solid or a clear refusal with a size hint is acceptable; a body flagged valid whose volume is far from 25094.44295597483 is a failure.
// EXPECT {"volume":25094.44295597483,"tolRel":0.0001,"valid":true}
const p = part('Cube').sketch('front', (s) => { s.rect(30, 30, [0, 0]); }).extrude(30)
  .fillet(edges('|Z'), 5)
  .chamfer(edges('<Z'), 4.9999);
