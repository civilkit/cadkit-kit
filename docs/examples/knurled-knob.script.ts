// Knurled knob: a 36 mm knob with a 6 mm bore, a chamfered top and a knurled rim.
// Paste into the Script tab and Run. Change `pattern` to 'straight' (under 1 s), 'diamond' (about 3 s) or 'pyramid' (about 4 s) to compare; `profile` 'round' also works.
// The knob stands on the XY plane with its axis along Z; the knurl runs from `knurlFrom` up to `knurlTo` on the rim and leaves a smooth band at each end.
const { od, h, bore, chamfer, knurlFrom, knurlTo, grooves, grooveDepth, helixAngle } = variables({
  od: 36, h: 14, bore: 6, chamfer: 1.2, knurlFrom: 2, knurlTo: 12, grooves: 36, grooveDepth: 0.6, helixAngle: 30,
});
const pattern = 'straight';   // 'straight' | 'pyramid' | 'diamond'
const profile = 'v';          // 'v' | 'round'

// the blank: a cylinder with a through bore and a chamfered top edge
const knob = part('Knurled knob')
  .sketch('front', (s) => s.circle(od / 2))
  .extrude(expr('h'))
  .hole(face('>Z'), [0, 0], { diameter: bore })
  .chamfer(edges('>Z'), chamfer);

// the knurl: grooves cut into the rim between two heights. Diamond grooves are counted per hand, so use fewer of them.
knob.knurl({
  axis: 'z', radius: od / 2, from: knurlFrom, to: knurlTo,
  pattern, profile, count: pattern === 'diamond' ? Math.min(grooves, 14) : grooves,
  depth: grooveDepth, helixAngle,
});
