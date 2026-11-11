// solidcraft #5747, the report's six edges: the four outer top edges and the boss circle rounded r 2 together. Expected V0 - O + C = 18515.717289756052 (tol 0.1 % of the rounds).
// EXPECT {"volume":18515.717289756052,"tolRel":0.0001,"valid":true}
let p = part('Slab').sketch('front', (s) => { s.rect(26.8, 48, [0, 0]); }).extrude(14)
  .sketch(at('front', 14), (s) => { s.circle(5.635601121442153, [0, 0]); }).extrude(6);   // block 14 tall + boss 6 above its top

p = p.fillet(edges({ union: [edges({ near: [0, -24, 14], within: 0.3 }), edges({ near: [13.4, 0, 14], within: 0.3 }), edges({ near: [0, 24, 14], within: 0.3 }), edges({ near: [-13.4, 0, 14], within: 0.3 }), edges({ onFace: faces({ kind: 'cylinder', radius: 5.635601121442153 }), inside: [[-7, -7, 13.9], [7, 7, 14.1]] })] }), 2);
