// solidcraft #11005 (fixture 11005-tee-of-tubes-branch-bore-cut, case branch_bore_cut_10): main tube (r 7 / bore 5) on X, x -25..25; branch tube on -Y, y 0..-20; joined; then the branch's bore (r 5, y -10..0) cut through the main wall.
// Upstream: the old kernel failed ("no result"). Expected 4875.22210303 (slice quadrature), 1 lump.
// EXPECT {"volume":4875.22210303,"tolRel":0.000001,"valid":true,"solids":1}
const cylZ = (p, n, [x, y, z], r, h) => p.sketch(at('front', z), (s) => { s.circle(r, [x, y]); }).extrude(h, { newBody: n });
const cylX = (p, n, [x, y, z], r, h) => p.sketch(at('right', x), (s) => { s.circle(r, [-z, y]); }).extrude(h, { newBody: n });
const cylY = (p, n, [x, y, z], r, h) => p.sketch(at('top', y), (s) => { s.circle(r, [x, -z]); }).extrude(h, { newBody: n });
const box = (p, n, [x, y, z], [w, d, h]) => p.sketch(at('front', z), (s) => { s.rect(w, d, [x + w / 2, y + d / 2]); }).extrude(h, { newBody: n });
const combine = (p, op, a, b, keep) => p.feature({ type: 'combine', op, target: { body: a }, tools: [{ body: b }], ...(keep ? { keepTools: true } : {}) });

let p = part('Tee');
p = cylX(p, 'MainOut', [-25, 0, 0], 7, 50); p = cylX(p, 'MainIn', [-25, 0, 0], 5, 50); p = combine(p, 'cut', 'MainOut', 'MainIn');
p = cylY(p, 'BrOut', [0, -20, 0], 7, 20); p = cylY(p, 'BrIn', [0, -20, 0], 5, 20); p = combine(p, 'cut', 'BrOut', 'BrIn');
p = combine(p, 'union', 'MainOut', 'BrOut');
p = cylY(p, 'Bore', [0, -10, 0], 5, 10);
p = combine(p, 'cut', 'MainOut', 'Bore');
