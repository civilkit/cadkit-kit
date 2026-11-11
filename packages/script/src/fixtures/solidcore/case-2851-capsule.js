// solidcraft #2851 (fixture 2851-sphere-joined-tangent-to-a-cylinder-end): rod r 5 h 20 on the z axis, sphere r 5 centred on its base cap, so the sphere touches the wall tangentially along the cap's rim.
// Upstream: the old kernel failed ("no result"). Expected pi 25 20 + 2/3 pi 125 = 1832.595714594, 1 lump (capsule).
// EXPECT {"volume":1832.595714594046,"tolRel":0.000001,"valid":true,"solids":1}
const cylZ = (p, n, [x, y, z], r, h) => p.sketch(at('front', z), (s) => { s.circle(r, [x, y]); }).extrude(h, { newBody: n });
const cylX = (p, n, [x, y, z], r, h) => p.sketch(at('right', x), (s) => { s.circle(r, [-z, y]); }).extrude(h, { newBody: n });
const cylY = (p, n, [x, y, z], r, h) => p.sketch(at('top', y), (s) => { s.circle(r, [x, -z]); }).extrude(h, { newBody: n });
const box = (p, n, [x, y, z], [w, d, h]) => p.sketch(at('front', z), (s) => { s.rect(w, d, [x + w / 2, y + d / 2]); }).extrude(h, { newBody: n });
const combine = (p, op, a, b, keep) => p.feature({ type: 'combine', op, target: { body: a }, tools: [{ body: b }], ...(keep ? { keepTools: true } : {}) });

let p = part('Capsule');
p = cylZ(p, 'Rod', [0, 0, 0], 5, 20);
p = p.sketch('front', (s) => { s.arc3([0, -5], [5, 0], [0, 5]); s.line([0, 5], [0, -5]); }).revolve(360, { newBody: 'Ball' });
p = combine(p, 'union', 'Rod', 'Ball');
