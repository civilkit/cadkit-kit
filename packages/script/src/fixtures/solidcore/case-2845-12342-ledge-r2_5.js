// solidcore #2845 / solidcraft #12342 (kernel_cases/fillets/12342-round-wall-and-ledge-edges-r2-5): L body, wall x 16..20 (y -20..20, z -40..2) on a base x 16..23 (z -50..-40), so a 3 mm ledge; the wall's edge (x 20, y 20) and the ledge's edge (x 23, y 20) both rounded R2.5 together.
// Upstream: status 1001 (known failing; each edge alone builds). Expected 9450.25440310417, 1 lump.
// EXPECT {"volume":9450.25440310417,"tolRel":1e-9,"valid":true,"solids":1}
const p = part('L').sketch(at('front', -50), (s) => { s.rect(7, 40, [19.5, 0]); }).extrude(10)
  .sketch(at('front', -40), (s) => { s.rect(4, 40, [18, 0]); }).extrude(42)
  .fillet(edges({ union: [edges({ near: [20, 20, -19], within: 0.3 }), edges({ near: [23, 20, -45], within: 0.3 })] }), 2.5);
