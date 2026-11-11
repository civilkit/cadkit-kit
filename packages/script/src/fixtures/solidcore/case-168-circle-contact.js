// solidcraft #168 (fixture 168-bodies-touching-only-along-a-line): coin r 10 h 3 and a ring r 10..15 on top (z 3..6) touch only along a circle; union must stay two solids, volume pi 100 3 + pi 125 3 = 2120.5750411731105.
// Upstream: the old kernel fused them into one. (Our line-contact box/cylinder case 1398 passed on 2026-10-29.)
// EXPECT {"volume":2120.5750411731105,"tolRel":1e-9,"valid":true,"solids":2}
const cylZ = (p, n, [x, y, z], r, h) => p.sketch(at('front', z), (s) => { s.circle(r, [x, y]); }).extrude(h, { newBody: n });
const cylX = (p, n, [x, y, z], r, h) => p.sketch(at('right', x), (s) => { s.circle(r, [-z, y]); }).extrude(h, { newBody: n });
const cylY = (p, n, [x, y, z], r, h) => p.sketch(at('top', y), (s) => { s.circle(r, [x, -z]); }).extrude(h, { newBody: n });
const box = (p, n, [x, y, z], [w, d, h]) => p.sketch(at('front', z), (s) => { s.rect(w, d, [x + w / 2, y + d / 2]); }).extrude(h, { newBody: n });
const combine = (p, op, a, b, keep) => p.feature({ type: 'combine', op, target: { body: a }, tools: [{ body: b }], ...(keep ? { keepTools: true } : {}) });

let p = part('Touch');
p = cylZ(p, 'Coin', [0, 0, 0], 10, 3);
p = p.sketch(at('front', 3), (s) => { s.circle(15, [0, 0]); s.circle(10, [0, 0]); }).extrude(3, { newBody: 'Ring' });
p = combine(p, 'union', 'Coin', 'Ring');
