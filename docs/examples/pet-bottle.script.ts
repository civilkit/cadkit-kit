// Own work: a 500 ml PET water bottle with a petaloid (five-foot) base, as drawn in a FreeCAD tutorial video, rebuilt with the script tools.
// Axis = Z, the bottle stands on z = 0, mm. In the Variables panel: WALL (wall thickness), FEET (number of feet), GROOVE_UP (how high the petal grooves reach), DRAFT (groove wall angle), CAP = 1 adds the screw cap. TIP (mm, 0 = sharp) rounds the two tips of each groove; PETAL_FILLET (mm, 0 = off, needs TIP of about 3 to 7) rounds the groove floor (see docs/pet-petal-fillet.md for why only that edge).
// How it is built: the upper part (finish, support ring, neck, a spline shoulder, the straight body) is ONE thin-walled revolve. The base cannot be a thin revolve (the grooves must push the wall in), so it is
// a solid cup with five drafted petal grooves, and the inside is a second body (the cavity: the cup's outside offset by the wall) with the same grooves widened by the wall. Cut the cavity out of the cup, then unite the cup with the upper part.
const V = variables({ WALL: 0.35, FEET: 5, GROOVE_UP: 11, DRAFT: 10, TIP: 0, PETAL_FILLET: 0, CAP: 1 });
const P = part('PET bottle 500 ml');
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
// ---- base cup: solid, with the petal grooves cut into it (from: 'Cup' leaves the other bodies alone) ----
// the outside of the cup is one chain from the axis up the wall; the cup profile closes it, the cavity profile is its offset
const outer = (s, top) => {
  s.polyline([pr(0, 9), pr(4, 9), pr(15, 0), pr(24, 0)]);                                                   // flat centre, push-up cone, standing ring
  s.arc3(pr(24, 0), pr(30.364, 2.636), pr(33, 9));                                                          // corner radius 9
  s.polyline([pr(33, 9), pr(33, top)]);
};
P.sketch(at('top', 0), (s) => { outer(s, JOIN); s.polyline([pr(33, JOIN), pr(0, JOIN), pr(0, 9)]); }, 'Cup profile');
P.revolve(360, { newBody: 'Cup', ...REV });
// one petal groove outline: two arcs through the lens ends, widened by wd (the cavity's ribs); TIP > 0 rounds the two tips with arcs of that radius (tangent to the long arcs, symmetric about the middle of the lens), turned by ang degrees
const lens = (c, wd, ang) => {
  const E = 14.5, W = 7.5, M = 23.5, ca = Math.cos(ang * Math.PI / 180), sa = Math.sin(ang * Math.PI / 180), rp = ([x, y]) => [x * ca - y * sa, x * sa + y * ca];
  const arc3 = (p, m, q) => c.arc3(rp(p), rp(m), rp(q));
  if (!(V.TIP > 0)) { arc3([9 - wd, 0], [22, 7.5 + wd], [38 + wd, 0]); arc3([38 + wd, 0], [22, -(7.5 + wd)], [9 - wd, 0]); return; }
  const T = V.TIP, Rb = ((E - T) ** 2 + W * W - T * T) / (2 * (W - T)), cc = Rb - W, xt = E - T, k = (Rb + wd) / (Rb - T), px = k * xt, py = -cc + k * cc, r = T + wd;
  arc3([M - px, py], [M, W + wd], [M + px, py]); arc3([M + px, py], [M + xt + r, 0], [M + px, -py]);
  arc3([M + px, -py], [M, -(W + wd)], [M - px, -py]); arc3([M - px, -py], [M - xt - r, 0], [M - px, py]);
};
const petals = (w, name) => P.sketch(at('front', -1), (s) => s.polar(V.FEET, (c) => lens(c, w, 0)), name);
// PETAL_FILLET > 0: each groove is cut by its own tool body (the lens drafted up from 1 mm below the standing plane) whose top edge is rounded first: the groove floor gets a fillet; a tool must be filleted alone
const tools = (w, fillet, name) => { for (let k = 0; k < V.FEET; k++) {
  P.sketch(at('front', -1), (s) => lens(s, w, 360 * k / V.FEET), name + ' ' + (k + 1));
  P.extrude(V.GROOVE_UP + 1 + w, { newBody: name + ' ' + (k + 1), draft: V.DRAFT });
  const h = P.handle();
  P.fillet(edges({ onFace: face('>Z', { of: h }) }), fillet);
} };
if (V.PETAL_FILLET > 0) tools(0, V.PETAL_FILLET, 'Groove');
else { petals(0, 'Petals'); P.cut(V.GROOVE_UP + 1, { direction: 'away', draft: V.DRAFT, from: 'Cup' }); }
// ---- cavity: the inside, the cup's outside offset by the wall (to the right of the walk = up and inwards); the same grooves widened by the wall are left standing as ribs ----
P.sketch(at('top', 0), (s) => { outer(s, JOIN + 1); s.offset(-t, { keep: false }); s.polyline([pr(33 - t, JOIN + 1), pr(0, JOIN + 1), pr(0, 9 + t)]); }, 'Cavity profile');
P.revolve(360, { newBody: 'Cavity', ...REV });
if (V.PETAL_FILLET > 0) tools(t, V.PETAL_FILLET + t, 'Rib');
else { petals(t, 'Ribs'); P.cut(V.GROOVE_UP + 1 + t, { direction: 'away', draft: V.DRAFT, from: 'Cavity' }); }
if (V.PETAL_FILLET > 0) for (let k = 1; k <= V.FEET; k++) { P.combine('cut', 'Cup', 'Groove ' + k); P.combine('cut', 'Cavity', 'Rib ' + k); }
P.combine('cut', 'Cup', 'Cavity');
P.combine('union', 'Upper', 'Cup');
P.appearance({ feature: UPPER, colour: '#5b9bd5', opacity: 0.55, finish: 'glass' });
// ---- screw cap (separate body) ----
if (V.CAP) {
  P.sketch(at('top', 0), (s) => s.polygon([pr(14.0, 192.4), pr(15.4, 192.4), pr(15.4, 207.4), pr(0, 207.4), pr(0, 206.0), pr(14.0, 206.0)]), 'Cap profile');
  P.revolve(360, { newBody: 'Cap', ...REV });
  P.appearance({ feature: P.handle(), colour: '#f2f2f2', finish: 'plastic' });
}
