// solidcraft #10971 (fixture 10971-round-cut-touching-an-opening, case round_11_touching): D-shaped block (cylinder r 31.1225 h 60 + box behind), opening cut z 3..25 from the front, then a round (axis X, r 11, centre z 14)
// whose circle touches the opening's top and bottom faces. Upstream: the old kernel failed ("no result"). Expected 162219.10396602 (closed form, Monte-Carlo checked), 1 lump.
// EXPECT {"volume":162219.10396602,"tolRel":0.000001,"valid":true,"solids":1}
const cylZ = (p, n, [x, y, z], r, h) => p.sketch(at('front', z), (s) => { s.circle(r, [x, y]); }).extrude(h, { newBody: n });
const cylX = (p, n, [x, y, z], r, h) => p.sketch(at('right', x), (s) => { s.circle(r, [-z, y]); }).extrude(h, { newBody: n });
const cylY = (p, n, [x, y, z], r, h) => p.sketch(at('top', y), (s) => { s.circle(r, [x, -z]); }).extrude(h, { newBody: n });
const box = (p, n, [x, y, z], [w, d, h]) => p.sketch(at('front', z), (s) => { s.rect(w, d, [x + w / 2, y + d / 2]); }).extrude(h, { newBody: n });
const combine = (p, op, a, b, keep) => p.feature({ type: 'combine', op, target: { body: a }, tools: [{ body: b }], ...(keep ? { keepTools: true } : {}) });

let p = part('D');
p = cylZ(p, 'Disc', [0, 0, 0], 31.1225, 60);
p = box(p, 'Back', [-31.1225, 0, 0], [62.245, 31.1225, 60]);
p = combine(p, 'union', 'Disc', 'Back');
p = box(p, 'Opening', [-36.1225, -36.1225, 3], [72.245, 36.1225, 22]);
p = combine(p, 'cut', 'Disc', 'Opening');
p = cylX(p, 'Round', [-40, 0, 14], 11, 80);
p = combine(p, 'cut', 'Disc', 'Round');
