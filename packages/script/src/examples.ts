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
];
