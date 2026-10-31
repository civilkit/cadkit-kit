// Own work: the same 500 ml PET bottle as pet-bottle.script.ts, built the short way: revolve the closed outline, cut the petal grooves with draft, shell the top: 7 features, 10 with the cap.
// Needs a kernel whose shell handles a spline shoulder, the torus base corner and drafted grooves (shell-bottle fixes); pet-bottle.script.ts is the version for older kernels.
// Axis = Z, the bottle stands on z = 0, mm. Variables: WALL (wall thickness), FEET (number of feet), GROOVE_UP (how high the petal grooves reach), DRAFT (groove wall angle), CAP = 1 adds the screw cap.
const V = variables({ WALL: 0.35, FEET: 5, GROOVE_UP: 11, DRAFT: 10, CAP: 1 });
const P = part('PET bottle 500 ml (shell)');
P.upAxis('z');   // the part is built along Z: the app opens it Z-up
const pr = (r, z) => [r, -z];                                          // top sketch: x = radius, y = -z
P.sketch(at('top', 0), (s) => {
  s.polyline([pr(0, 205), pr(13.8, 205), pr(13.8, 192), pr(17.5, 192), pr(17.5, 190), pr(14.6, 190), pr(14.6, 184)]);   // mouth, finish, support ring, neck
  s.spline([pr(14.6, 184), pr(19, 177), pr(27, 165), pr(32.2, 150), pr(33, 135)]);                                      // shoulder: one smooth curve
  s.polyline([pr(33, 135), pr(33, 9)]);                                                                                  // straight body
  s.arc3(pr(33, 9), pr(30.364, 2.636), pr(24, 0));                                                                       // base corner radius 9
  s.polyline([pr(24, 0), pr(15, 0), pr(4, 9), pr(0, 9), pr(0, 205)]);                                                    // standing ring, push-up cone, flat centre, axis
}, 'Profile');
P.revolve(360, { axis: { from: [0, 0], to: [0, -1] } });
const BODY = P.handle();
P.sketch(at('front', -1), (s) => s.polar(V.FEET, (c) => { c.arc3([9, 0], [22, 7.5], [38, 0]); c.arc3([38, 0], [22, -7.5], [9, 0]); }), 'Petals');   // one lens per foot gap, 1 mm below the standing plane
P.cut(V.GROOVE_UP + 1, { direction: 'away', draft: V.DRAFT });
P.shell(face('>Z'), V.WALL);
P.appearance({ feature: BODY, colour: '#5b9bd5', opacity: 0.55, finish: 'glass' });
if (V.CAP) {                                                                                                             // screw cap (separate body)
  P.sketch(at('top', 0), (s) => s.polygon([pr(14.0, 192.4), pr(15.4, 192.4), pr(15.4, 207.4), pr(0, 207.4), pr(0, 206.0), pr(14.0, 206.0)]), 'Cap profile');
  P.revolve(360, { newBody: 'Cap', axis: { from: [0, 0], to: [0, -1] } });
  P.appearance({ feature: P.handle(), colour: '#f2f2f2', finish: 'plastic' });
}
