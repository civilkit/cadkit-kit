// Own work: a tapered spinning disc, lying flat (Y up, mm). It slopes gently up from a thin edge to a low cone at the centre that points up; 12 smooth ridges run straight from the centre out to the rim, and the rim itself is a plain circle in plan that rises and falls once per ridge, so a ball rolling off the edge drops into a tube.
// Variables: N (number of ridges = waves round the edge, 12), K (ridge depth as a fraction of the radius, 0.28: the grooves between the ridges are cut that far in towards the centre), R (disc radius at the edge, 60: the cone is fitted for 60 and up, tested to 80; smaller discs build but with a flatter cone and no room for POCKET, and a few values such as 49 and 50 are flagged by the kernel's validity check because a seam edge of the trimmed side wall does not tessellate closed, so try 51), T0 (minimum edge thickness, at the groove floors, 3). POCKET = 1 hollows the underside with a round recess (a lighter print: about half the material) whose roof follows the groove floors SKIN mm (2) below the top surface and which stops RIM mm (8) short of the edge; 0 leaves it solid. The crest of each ridge is a little higher at the edge (about 5.5 mm with the defaults); the cone tip is 18 mm above the base.
// How it is built: ONE lofted body through spline sections stacked from the flat base to the cone tip, each a wave (radius r * (1 - K * (1 - cos(N a)) / 2)) whose mean radius follows a gentle slope of about 6 degrees and then closes to a point, so the ridges are part of the surface: no seams, nothing added on top.
// The loft is then trimmed by a cylinder of radius R (combine, intersect). The edge is where the ridged surface meets that cylinder, which gives the plain circular edge whose height follows the wave. The flat underside lies on y = 0.
const V = variables({ N: 12, K: 0.28, R: 60, T0: 3, POCKET: 0, SKIN: 2, RIM: 8 });
const P = part('Tapered disc');
const S = 0.1087, RV = V.R / (1 - V.K);
const rcOf = (y) => y <= 10.5 ? RV - (y - V.T0) / S : 14 - 14 * (y - 10.5) / 7.5;
const wave = (r) => (s) => s.polar((a) => r * (1 - V.K * (1 - Math.cos(V.N * a)) / 2), { count: 96 });
const ys = [0, 3, 4.5, 6, 8, 10.5, 14];
P.loft([...ys.map((y) => ({ on: at('top', y), draw: wave(rcOf(y)) })), { on: at('top', 18), point: [0, 0] }], { ends: { last: 'point' }, newBody: 'Disc' });
P.sketch(at('top', -2), (s) => s.circle(V.R), 'Edge cylinder');
P.extrude(40, { newBody: 'Edge' });
P.combine('intersect', 'Disc', 'Edge');
if (V.POCKET) {
  // the recess is one revolve (so it is the same all round, hence 12-fold): its roof runs along the lowest line of the top surface (the groove floors), SKIN below it, out to R - RIM
  const RP = V.R - V.RIM, line = [[0, 18 - V.SKIN], ...ys.slice().reverse().map((y) => [rcOf(y) * (1 - V.K), y - V.SKIN])], roof = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]];
    if (a[0] >= RP) break;
    roof.push(a);
    if (b[0] >= RP) { roof.push([RP, a[1] + (b[1] - a[1]) * (RP - a[0]) / (b[0] - a[0])]); break; }
  }
  P.sketch('front', (s) => { s.polyline([[0, -1], [RP, -1], ...roof.slice().reverse()]); s.line(roof[0], [0, -1]); }, 'Recess profile');
  P.revolve(360, { axis: { from: [0, 0], to: [0, 1] }, newBody: 'Recess' });
  P.combine('cut', 'Disc', 'Recess');
}
// Checks that run with the script (a failed one is listed as an error): the edge cylinder fixes the box, no face is a sliver, and the default disc keeps its volume (about 78 970 mm3).
P.expectBBox({ min: [-V.R, 0, -V.R], max: [V.R, 18, V.R] }, { tolerance: 0.05 }).expectMinFaceArea(100);
if (V.N === 12 && V.K === 0.28 && V.R === 60 && V.T0 === 3 && !V.POCKET) P.expectVolume(78968, { tolerance: 0.005 });
