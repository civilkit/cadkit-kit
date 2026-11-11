// solidcraft #5747 (fixture 5747-cove-round-a-boss-in-a-joined-slab): 26.8 x 48 x 14 block with an r 5.635601121442153 boss 6 above its top; ONLY the concave circle edge at z = 14 rounded r 2.
// Upstream: the old kernel cut a groove (V0 - 32.9) instead of adding a cove, no error. Expected V0 + C = 18641.06717790312 (cove by Pappus), tol 0.1 % of the round.
// EXPECT {"volume":18641.06717790312,"tolRel":0.00002,"valid":true}
let p = part('Slab').sketch('front', (s) => { s.rect(26.8, 48, [0, 0]); }).extrude(14)
  .sketch(at('front', 14), (s) => { s.circle(5.635601121442153, [0, 0]); }).extrude(6);   // block 14 tall + boss 6 above its top

p = p.fillet(edges({ onFace: faces({ kind: 'cylinder', radius: 5.635601121442153 }), inside: [[-7, -7, 13.9], [7, 7, 14.1]] }), 2);
