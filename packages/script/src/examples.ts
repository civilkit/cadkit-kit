export interface Example { id: string; title: string; code: string }
export const EXAMPLES: Example[] = [
  {
    id: 'bracket',
    title: 'Bracket with holes and fillet',
    code: `// 60 x 40 x 12 plate, two 8 mm holes, rounded vertical edges
const { w, h } = variables({ w: 60, h: 40, t: 12 });
part('Bracket')
  .sketch('front', (s) => s.rect(w, h))
  .extrude(expr('t'))
  .hole(face('>Z'), [-15, 0], { diameter: 8 })
  .hole(face('>Z'), [15, 0], { diameter: 8 })
  .fillet(edges('|Z'), 4);
`,
  },
  {
    id: 'flange',
    title: 'Flanged cylinder',
    code: `// revolved flange: 20 mm bore, 30 mm body, 50 mm flange
part('Flanged cylinder')
  .sketch('front', (s) => s.polygon([[10, 0], [25, 0], [25, 6], [15, 6], [15, 30], [10, 30]]))
  .revolve(360);
`,
  },
  {
    id: 'box',
    title: 'Thin-walled box',
    code: `// 50 x 30 x 20 box hollowed to 2 mm walls, open at the top
part('Thin box')
  .sketch('front', (s) => s.rect(50, 30))
  .extrude(20)
  .shell(face('>Z'), 2);
`,
  },
  {
    id: 'bc-pulley',
    title: 'BenchCAD pulley (revolve)',
    code: `// BenchCAD pulley_000030 (revolved polyline profile); CC-BY-4.0, BenchCAD arXiv 2605.10865
const { bore, rim, flange, w, gw } = variables({ bore: 17.5, rim: 62.4, flange: 70, w: 12.6, gw: 5 });
part('Pulley')
  .sketch('right', (s) => s.polygon([
    [bore, -w], [rim, -w], [rim, -gw], [flange, -gw],
    [flange, gw], [rim, gw], [rim, w], [bore, w],
  ]))
  .revolve(360);
`,
  },
  {
    id: 'bc-washer',
    title: 'BenchCAD washer (hole, chamfer)',
    code: `// BenchCAD washer_000001 (ISO 7089 style): disc, bore, 0.4 chamfer on both rims of one face
const { od, id, t, c } = variables({ od: 64.8, id: 37, t: 5, c: 0.4 });
part('Washer')
  .sketch('front', (s) => s.circle(od / 2))
  .extrude(expr('t'))
  .hole(face('>Z'), [0, 0], { diameter: id })
  .chamfer(edges('>Z'), c);
`,
  },
  {
    id: 'bc-hex-nut',
    title: 'BenchCAD hex nut (polygon, cut)',
    code: `// BenchCAD hex_nut_000006: hexagon (circumradius 3.175), 1.5 radius bore through
const { r, h, bore } = variables({ r: 3.175, h: 2.4, bore: 1.5 });
const hex = [0, 1, 2, 3, 4, 5].map((i) => [r * Math.cos(i * Math.PI / 3), r * Math.sin(i * Math.PI / 3)]);
part('Hex nut')
  .sketch('top', (s) => s.polygon(hex))
  .extrude(expr('h'))
  .sketch(face('>Y'), (s) => s.circle(bore))
  .cut(through());
`,
  },
  {
    id: 'bc-enclosure',
    title: 'BenchCAD enclosure (shell, fillet)',
    code: `// BenchCAD enclosure_000042: box, shelled to 1.8 mm with the top open, 0.68 fillet on the bottom rim
const { w, d, h, t, r } = variables({ w: 192.87, d: 155.27, h: 39.64, t: 1.8, r: 0.68 });
part('Enclosure')
  .sketch('front', (s) => s.rect(w, d))
  .extrude(expr('h'), { mid: true })
  .shell(face('>Z'), expr('t'))
  .fillet(edges('<Z'), expr('r'));
`,
  },
  {
    id: 'bc-motor-end-cap',
    title: 'BenchCAD motor end cap (circular pattern)',
    code: `// BenchCAD motor_end_cap_000242: disc, bore, boss on the front face, chamfer, two bolt circles of 8 holes
const { R, th, bore, bossR, bossH } = variables({ R: 69.86, th: 16.17, bore: 20.62, bossR: 36.58, bossH: 5.28 });
part('Motor end cap')
  .sketch('right', (s) => s.circle(R))
  .extrude(expr('th'), { mid: true })
  .sketch(face('>X'), (s) => s.circle(bore))
  .cut(through())
  .sketch(face('>X'), (s) => s.circle(bossR))
  .extrude(expr('bossH'))
  .chamfer(edges('>X'), 1.4)
  .fillet(edges('<X'), 0.91)
  .sketch(face('>X'), (s) => s.circle(1.65, [44.32, 0]))
  .cut(through())
  .circularPattern({ count: 8, axis: 'x' })
  .sketch(face('>X'), (s) => s.circle(1.73, [64.75, 0]))
  .cut(through())
  .circularPattern({ count: 8, axis: 'x' });
`,
  },
];
