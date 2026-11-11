// solidcore #2845 / solidcraft #12342 (12342-round-wall-and-ledge-edges-r5-refused): same L body, both edges R5: past the 3 mm ledge and the 4 mm wall, must be REFUSED naming the largest radius that fits (3).
// Upstream gets status 1001 without the size. Pass = refusal with hint naming ~3; a built body is a failure.
// EXPECT {"refused":true}
const p = part('L').sketch(at('front', -50), (s) => { s.rect(7, 40, [19.5, 0]); }).extrude(10)
  .sketch(at('front', -40), (s) => { s.rect(4, 40, [18, 0]); }).extrude(42)
  .fillet(edges({ union: [edges({ near: [20, 20, -19], within: 0.3 }), edges({ near: [23, 20, -45], within: 0.3 })] }), 5);
