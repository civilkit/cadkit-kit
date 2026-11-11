// solidcore #2843 / solidcraft #11991 (kernel_cases/fillets/11991-round-cylinder-edge-ending-on-a-round-tangent-line): box 30 x 20 x 20, vertical edge at x = y = 0 rounded R5, a half cylinder r 2 along x (axis y = 0, z = 15, x 5..11)
// standing out of the front face y = 0, its end x = 5 exactly on the line where the front face runs tangent into the R5 round. The concave edge where the cylinder meets the face (z = 13) rounded 0.5.
// Upstream: status 1001 (known failing; builds at x = 5.001 or 6). Expected 11930.62905430199 (closed form), 1 lump.
// EXPECT {"volume":11930.62905430199,"tolRel":1e-7,"valid":true,"solids":1}
const p = part('Tangent').sketch('front', (s) => { s.rect(30, 20, [15, 10]); }).extrude(20)
  .fillet(edges({ near: [0, 0, 10], within: 0.3 }), 5)
  .sketch(at('right', 5), (s) => { s.line([-17, 0], [-13, 0]); s.arc3([-13, 0], [-15, -2], [-17, 0]); }).extrude(6)
  .fillet(edges({ near: [8, 0, 13], within: 0.3 }), 0.5);
