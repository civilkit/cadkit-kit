// Own work: the 500 ml PET bottle with CURVED petal grooves instead of straight lens-shaped ones. Each foot gap is a round groove swept along a 3D spline: it starts in the push-up cone, runs out under the standing ring, curves round the base corner and up the side wall, and fades out in the wall.
// Axis = Z, the bottle stands on z = 0, mm. Variables: WALL (wall thickness), FEET (number of feet), GROOVE_R (groove radius), SWIRL (degrees the grooves twist round the bottle on the way up, 0 = straight up in a radial plane), CAP = 1 adds the screw cap.
// How it is built: as the grooved bottle (pet-bottle.script.ts): the upper part is ONE thin-walled revolve, the base a solid cup and a cavity body (the cup's outside offset by the wall) that is cut out of it, then united. Here each groove is a tube
// (a circle swept along a sketch3d spline, kept as its own body): the cup is cut by tubes of radius GROOVE_R, the cavity by tubes GROOVE_R + WALL wide along the same paths, so the wall stays WALL thick all round.
const V = variables({ WALL: 0.35, FEET: 5, GROOVE_R: 4.2, SWIRL: 15, CAP: 1 });
const P = part('PET bottle 500 ml, curved petals');
P.upAxis('z');   // the part is built along Z: the app opens it Z-up
const t = V.WALL, JOIN = 45, pr = (r, z) => [r, -z];                    // top sketch: x = radius, y = -z
const REV = { axis: { from: [0, 0], to: [0, -1] } };
// ---- upper part: the profile runs from the finish down and is the OUTSIDE surface: side inside = left of travel = towards the axis ----
P.sketch(at('top', 0), (s) => {
  s.polyline([pr(13.8, 205), pr(13.8, 192), pr(17.5, 192), pr(17.5, 190), pr(14.6, 190), pr(14.6, 184)]);   // finish, support ring, neck
  s.spline([pr(14.6, 184), pr(19, 177), pr(27, 165), pr(32.2, 150), pr(33, 135)]);                          // shoulder: one smooth curve
  s.polyline([pr(33, 135), pr(33, JOIN - 0.5)]);                                                            // straight body, overlaps the cup a little
}, 'Upper profile');
P.revolve(360, { thin: { thickness: t, side: 'inside' }, newBody: 'Upper', ...REV });
const UPPER = P.handle();
// ---- base cup and cavity: solid revolves; the cavity profile is the cup's outline offset by the wall ----
const outer = (s, top) => {
  s.polyline([pr(0, 9), pr(4, 9), pr(15, 0), pr(24, 0)]);                                                   // flat centre, push-up cone, standing ring
  s.arc3(pr(24, 0), pr(30.364, 2.636), pr(33, 9));                                                          // corner radius 9
  s.polyline([pr(33, 9), pr(33, top)]);
};
P.sketch(at('top', 0), (s) => { outer(s, JOIN); s.polyline([pr(33, JOIN), pr(0, JOIN), pr(0, 9)]); }, 'Cup profile');
P.revolve(360, { newBody: 'Cup', ...REV });
P.sketch(at('top', 0), (s) => { outer(s, JOIN + 1); s.offset(-t, { keep: false }); s.polyline([pr(33 - t, JOIN + 1), pr(0, JOIN + 1), pr(0, 9 + t)]); }, 'Cavity profile');
P.revolve(360, { newBody: 'Cavity', ...REV });
// ---- the groove path: [radius, height, share of SWIRL]; it starts horizontal in the push-up cone (the profile plane stands upright there) and ends outside the wall, so the groove fades out ----
const PATH = [[9, 0.8, 0], [17, 0.8, 0.07], [25, 1.6, 0.2], [31.5, 6, 0.4], [34.6, 15, 0.6], [36.5, 28, 0.8], [38.4, 44, 1]];
const groove = (k, rad, name) => {
  const a0 = 360 * k / V.FEET, id = name.toLowerCase() + (k + 1);
  const pts = PATH.map(([r, z, f], i) => { const a = (a0 + f * V.SWIRL) * Math.PI / 180; return { id: 'p' + i, x: +(r * Math.cos(a)).toFixed(4), y: +(r * Math.sin(a)).toFixed(4), z }; });
  P.feature({ type: 'sketch3d', id: id + 'path', name: name + ' path ' + (k + 1), points: pts, entities: [{ id: 'e1', type: 'spline', pts: pts.map((p) => p.id) }], constraints: [] });
  P.feature({ type: 'plane', id: id + 'plane', mode: 'normal', path: id + 'path' });                         // the plane normal to the start of the path carries the round profile
  const plane = P.handle();
  P.sketch(at(plane), (s) => s.circle(rad), name + ' profile ' + (k + 1));
  P.feature({ type: 'sweep', op: 'newBody', body: name + ' ' + (k + 1), sketch: '$sketch', path: { kind: 'sketch', id: id + 'path' } });
};
for (let k = 0; k < V.FEET; k++) groove(k, V.GROOVE_R, 'Groove');
for (let k = 0; k < V.FEET; k++) groove(k, V.GROOVE_R + t, 'Rib');
for (let k = 1; k <= V.FEET; k++) { P.combine('cut', 'Cup', 'Groove ' + k); P.combine('cut', 'Cavity', 'Rib ' + k); }
P.combine('cut', 'Cup', 'Cavity');
P.combine('union', 'Upper', 'Cup');
P.appearance({ feature: UPPER, colour: '#5b9bd5', opacity: 0.55, finish: 'glass' });
// ---- screw cap (separate body) ----
if (V.CAP) {
  P.sketch(at('top', 0), (s) => s.polygon([pr(14.0, 192.4), pr(15.4, 192.4), pr(15.4, 207.4), pr(0, 207.4), pr(0, 206.0), pr(14.0, 206.0)]), 'Cap profile');
  P.revolve(360, { newBody: 'Cap', ...REV });
  P.appearance({ feature: P.handle(), colour: '#f2f2f2', finish: 'plastic' });
}
// Check that runs with the script (a failed one is listed as an error): the bottle fills its 66 mm round from the base to the top of the finish.
P.expectBBox({ min: [-33, -33, 0], max: [33, 33, 205] }, { body: 'Upper', tolerance: 0.01 });
