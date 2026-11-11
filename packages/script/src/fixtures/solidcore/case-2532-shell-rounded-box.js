// solidcore #2532 (issue #2484): a box with all edges rounded, then shelled; the inner corners must stay sphere patches. 40 cube, every edge R5, shell 2 open at the top face.
// Closed form: the 40 cube rounded R5 minus (the 36 box rounded R3, top at 38, plus the 30 x 30 x 2 opening prism).
// EXPECT {"volume":13934.394861238368,"tolRel":0.0001,"valid":true}
const p = part('Rounded').sketch('front', (s) => { s.rect(40, 40, [0, 0]); }).extrude(40)
  .fillet(edges('all'), 5)
  .shell(face('>Z'), 2);
