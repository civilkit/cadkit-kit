// Control for case-10415-cone-cut30 (the refusal hint says "move the tool by a small amount (0.01)"): the tool starts 0.01 outside the tangent plane, 30.01 long, so the cut should be the same body.
// Expected 1909.355312428 (the same cut volume, the extra 0.01 lies outside the cone), tol 1e-5 relative.
// EXPECT {"volume":1909.355312428,"tolRel":0.00001,"valid":true,"solids":1}
const cylZ = (p, n, [x, y, z], r, h) => p.sketch(at('front', z), (s) => { s.circle(r, [x, y]); }).extrude(h, { newBody: n });
const cylX = (p, n, [x, y, z], r, h) => p.sketch(at('right', x), (s) => { s.circle(r, [-z, y]); }).extrude(h, { newBody: n });
const cylY = (p, n, [x, y, z], r, h) => p.sketch(at('top', y), (s) => { s.circle(r, [x, -z]); }).extrude(h, { newBody: n });
const box = (p, n, [x, y, z], [w, d, h]) => p.sketch(at('front', z), (s) => { s.rect(w, d, [x + w / 2, y + d / 2]); }).extrude(h, { newBody: n });
const combine = (p, op, a, b, keep) => p.feature({ type: 'combine', op, target: { body: a }, tools: [{ body: b }], ...(keep ? { keepTools: true } : {}) });

let p = part('ConeCut');
p = p.sketch('front', (s) => { s.polygon([[0, 0], [10, 0], [0, 20]]); }).revolve(360, { newBody: 'Cone' });
const u = [0.8944271909999159, 0.4472135954999579];   // outward normal of the tangent plane in this frame
p = cylY(p, 'Tool', [5 + 0.01 * u[0], 10 + 0.01 * u[1], 0], 2, 30.01);
p = p.feature({ type: 'moveBody', bodies: [{ body: 'Tool' }], rotate: { axis: [0, 0, 1], origin: [5 + 0.01 * u[0], 10 + 0.01 * u[1], 0], angle: 116.56505117707799 } });
p = combine(p, 'cut', 'Cone', 'Tool');
