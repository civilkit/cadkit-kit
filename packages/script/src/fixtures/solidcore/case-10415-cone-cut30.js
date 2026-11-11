// solidcraft #10415 (fixture 10415-cut-from-a-plane-tangent-to-a-cone, case cut_30_through): cone r 10 h 20 (axis Y here), an r 2 cylinder starting on a plane tangent to the cone's side at half height
// (centre (5,10,0) in this frame), axis normal to that plane, 30 long: passes through the far side, does not reach the base. Upstream: the old kernel failed ("no result").
// Expected 1909.355312428 (their quadrature, tol 0.01); cone alone = 2094.3951023931954.
// EXPECT {"volume":1909.355312428,"tolRel":0.00001,"valid":true,"solids":1}
const cylZ = (p, n, [x, y, z], r, h) => p.sketch(at('front', z), (s) => { s.circle(r, [x, y]); }).extrude(h, { newBody: n });
const cylX = (p, n, [x, y, z], r, h) => p.sketch(at('right', x), (s) => { s.circle(r, [-z, y]); }).extrude(h, { newBody: n });
const cylY = (p, n, [x, y, z], r, h) => p.sketch(at('top', y), (s) => { s.circle(r, [x, -z]); }).extrude(h, { newBody: n });
const box = (p, n, [x, y, z], [w, d, h]) => p.sketch(at('front', z), (s) => { s.rect(w, d, [x + w / 2, y + d / 2]); }).extrude(h, { newBody: n });
const combine = (p, op, a, b, keep) => p.feature({ type: 'combine', op, target: { body: a }, tools: [{ body: b }], ...(keep ? { keepTools: true } : {}) });

let p = part('ConeCut');
p = p.sketch('front', (s) => { s.polygon([[0, 0], [10, 0], [0, 20]]); }).revolve(360, { newBody: 'Cone' });
p = cylY(p, 'Tool', [5, 10, 0], 2, 30);
p = p.feature({ type: 'moveBody', bodies: [{ body: 'Tool' }], rotate: { axis: [0, 0, 1], origin: [5, 10, 0], angle: 116.56505117707799 } });
p = combine(p, 'cut', 'Cone', 'Tool');
