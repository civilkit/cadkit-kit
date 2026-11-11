// solidcraft #8038 (fixture 8038-groove-revolved-into-a-stepped-cup, case groove_cut): cup section (r,z) polygon (75,54.6) (75,128.8) (50.15,128.8) (50.15,105.1) (47,105.1) (47,101.1) (56,101.1) (57,100.1) (57,54.6) revolved 360 about the axis (here Y, r = x, z = y);
// a round groove (square corner + r 1.5 arc, centre (51.15,106.4)) revolved and cut, straddling the bore wall r 50.15 just above the step at 105.1. Upstream: needed a "tool displacement" retry. Expected 619658.082479751, 1 lump.
// EXPECT {"volume":619658.082479751,"tolRel":0.000001,"valid":true,"solids":1}
const cylZ = (p, n, [x, y, z], r, h) => p.sketch(at('front', z), (s) => { s.circle(r, [x, y]); }).extrude(h, { newBody: n });
const cylX = (p, n, [x, y, z], r, h) => p.sketch(at('right', x), (s) => { s.circle(r, [-z, y]); }).extrude(h, { newBody: n });
const cylY = (p, n, [x, y, z], r, h) => p.sketch(at('top', y), (s) => { s.circle(r, [x, -z]); }).extrude(h, { newBody: n });
const box = (p, n, [x, y, z], [w, d, h]) => p.sketch(at('front', z), (s) => { s.rect(w, d, [x + w / 2, y + d / 2]); }).extrude(h, { newBody: n });
const combine = (p, op, a, b, keep) => p.feature({ type: 'combine', op, target: { body: a }, tools: [{ body: b }], ...(keep ? { keepTools: true } : {}) });

let p = part('Cup');
p = p.sketch('front', (s) => { s.polygon([[75, 54.6], [75, 128.8], [50.15, 128.8], [50.15, 105.1], [47, 105.1], [47, 101.1], [56, 101.1], [57, 100.1], [57, 54.6]]); }).revolve(360, { newBody: 'Cup' });
const k = Math.SQRT1_2 * 1.5;
p = p.sketch('front', (s) => { s.line([49.65, 106.4], [49.65, 104.9]); s.line([49.65, 104.9], [51.15, 104.9]); s.arc3([51.15, 104.9], [51.15 + k, 106.4 + k], [49.65, 106.4]); }).revolve(360, { newBody: 'Groove' });
p = combine(p, 'cut', 'Cup', 'Groove');
