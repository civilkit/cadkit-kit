// Own work: a 500 ml PET water bottle with a rounded petaloid base, built the short way: the revolved outline shelled to a tube, the base as two lofts (outer solid, cavity) through round sections, a rounded push-up centre, then the cap and thread.
// Needs a kernel whose loft takes many sections, whose shell handles a spline shoulder and whose booleans cope with the lofted base; every edge of the base is a tangent blend (no fillet is used: the kernel cannot fillet the petal edges).
// Axis = Z, the bottle stands on z = 0, mm. Variables: WALL (wall thickness), FEET (number of feet, 3 to 7 tested), CAP = 1 adds the cap.
// THREAD = 1 gives the neck a real helical thread (PCO 28 style: root dia 25.5, crest dia 27.6, pitch PITCH, TURNS turns) and the cap the matching internal thread (CLR = flank clearance); GRIP = number of ribs round the cap (0 = smooth). THREAD = 0 keeps the light plain neck and cap.
const V = variables({ WALL: 0.35, FEET: 5, CAP: 1, THREAD: 1, PITCH: 2.7, TURNS: 2, CLR: 0.15, GRIP: 30 });
const P = part('PET bottle 500 ml (shell)');
P.upAxis('z');   // the part is built along Z: the app opens it Z-up
const pr = (r, z) => [r, -z];                                          // top sketch: x = radius, y = -z
const ROOT = 12.75, CREST = 13.8, TOPLIP = 203.8, ZB = 36;                                                                       // thread root / crest radius, plain lip under the mouth, height of the petaloid base
P.sketch(at('top', 0), (s) => {
  s.polyline(V.THREAD
    ? [pr(0, 205), pr(CREST, 205), pr(CREST, TOPLIP), pr(ROOT, TOPLIP), pr(ROOT, 192), pr(17.5, 192), pr(17.5, 190), pr(14.6, 190), pr(14.6, 184)]   // mouth, lip, thread root, support ring, neck
    : [pr(0, 205), pr(13.8, 205), pr(13.8, 192), pr(17.5, 192), pr(17.5, 190), pr(14.6, 190), pr(14.6, 184)]);        // mouth, finish, support ring, neck
  s.spline([pr(14.6, 184), pr(19, 177), pr(27, 165), pr(32.2, 150), pr(33, 135)]);                                      // shoulder: one smooth curve
  s.polyline([pr(33, 135), pr(33, ZB), pr(0, ZB), pr(0, 205)]);                                                      // straight body down to the petaloid base, flat floor, axis
}, 'Profile');
P.revolve(360, { newBody: 'Bottle', axis: { from: [0, 0], to: [0, -1] } });
const BODY = P.handle();
P.shell(faces({ union: [face('>Z'), face('<Z')] }), V.WALL);                                                              // the upper bottle as a tube: open at the mouth and at the floor of the body (z = ZB)
// Petaloid base, built as two lofts because a lofted surface cannot be shelled: an outer solid and an inner solid (the cavity), each a loft through round sections from the body circle
// (z = ZB) down to the standing plane. Every section is a closed loop of 2 x FEET tangent arcs: FEET fat convex lobes (the feet) joined by FEET small concave arcs (the valley ribs),
// so there is no sharp edge. Going down, the valleys cut deeper (VR, the valley radius) and the feet round under like the base corner radius 9 (RT, the foot tip radius).
const N = V.FEET, A = Math.PI / N, RB = 33, RC = 9, R0 = 24, RIN = 15, T = V.WALL, VALLEY = 4;                                // body radius, base corner radius, standing circle radius, push-up cone start, wall, valley rib radius
const RT = (z, t) => (z >= RC ? RB - t : R0 + Math.sqrt(Math.max(0, (RC - t) * (RC - t) - (RC - z) * (RC - z))));      // foot tip radius; t = wall offset (0 outside, WALL for the cavity)
const RV0 = 19, KV = 1.6;                                                                                              // valley rib radius at the standing plane, and how round its profile is
const VR = (z) => RV0 + (RB - RV0) * Math.pow(1 - Math.pow(1 - z / ZB, KV), 1 / KV);                                       // valley rib radius: leaves the standing plane flat (so it meets the push-up without an edge), runs out vertical into the body at ZB
const dVR = (z) => (z <= 0 ? 1e9 : (RB - RV0) * Math.pow(1 - z / ZB, KV - 1) * Math.pow(1 - Math.pow(1 - z / ZB, KV), 1 / KV - 1) / ZB);   // dr/dz of the valley rib (steep at the standing plane)
const lobes = (rt, rv, q) => {                                                                                           // tangent-arc section: lobe circle (centre dl, radius rl) and valley circle (centre dv, radius q)
  const dv = rv + q, c = Math.cos(A);
  const rl = (rt * rt + dv * dv - 2 * c * dv * rt - q * q) / (2 * (rt - c * dv + q)), dl = rt - rl;
  const k = rl / (rl + q), tx = dl + k * (dv * c - dl), ty = k * dv * Math.sin(A);                                       // tangent point lobe / valley
  return { tx, ty, rt, rv, ang: Math.atan2(ty, tx) };
};
const rot = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
const geo = (z, t) => {                                                                                                   // the section for the outer surface point at height z; for the cavity (t > 0) it is moved one wall along the surface normal
  const m = dVR(z), k = Math.sqrt(1 + m * m), zs = z + t * m / k;
  return { zs, ...lobes(RT(zs, t), VR(z) - t / k, VALLEY + t) };
};
const section = (z, t, circ) => (s) => {
  const g = geo(z, t);
  for (let i = 0; i < N; i++) {
    const a0 = 2 * A * i;
    let a, m1, b, m2, d;
    if (circ) {                                                                                                          // the body circle, split at the same angles as the section below it
      const f = (u) => rot([RB - t, 0], a0 + u);
      a = f(-g.ang); m1 = f(0); b = f(g.ang); m2 = f(A); d = f(2 * A - g.ang);
    } else {
      a = rot([g.tx, -g.ty], a0); m1 = rot([g.rt, 0], a0); b = rot([g.tx, g.ty], a0); m2 = rot([g.rv * Math.cos(A), g.rv * Math.sin(A)], a0); d = rot(rot([g.tx, -g.ty], 2 * A), a0);
    }
    s.arc3(a, m1, b);
    s.arc3(b, m2, d);
  }
};
const ZS = [0, 0.6, 1.6, 3, 5, 7.5, 10.5, 14, 18, 22, 26, 29.5, 32.5];                                                    // section heights, closest together where the foot curls under
const baseSections = (t) => [{ on: at('front', ZB), draw: section(ZS[ZS.length - 1], t, true) }, ...ZS.slice().reverse().map((z) => ({ on: at('front', geo(z, t).zs), draw: section(z, t, false) }))];
P.loft(baseSections(0));                                                                                                 // outer solid, fused with the tube above it
// Push-up centre: the region under a dome, cut away from below. The dome is a cone (11 across, 9 up from the standing ring) with both ends rounded by tangent arcs (radius PU1 into the feet, PU2 at the crown),
// so the dome meets the feet without an edge. t moves the dome surface up along its normal by the wall thickness for the cavity.
const AL = Math.atan2(9, 11), SA = Math.sin(AL), CA = Math.cos(AL), PU1 = 12, PU2 = 6;
const EPS = 0.03;                                                                                                         // the first arc dips this far below the standing plane (a tangent contact would stall the boolean): a 4 degree step, not visible
const C1 = [RIN + PU1 * Math.tan(AL / 2), PU1 - EPS], C2 = [4 - PU2 * Math.tan(AL / 2), 9 - PU2];
const dome = (t) => (s) => {
  const r1 = PU1 - t, r2 = PU2 + t;
  const F1 = [C1[0], t - EPS], M1 = [C1[0] - r1 * Math.sin(AL / 2), C1[1] - r1 * Math.cos(AL / 2)], G1 = [C1[0] - r1 * SA, C1[1] - r1 * CA];
  const G2 = [C2[0] + r2 * SA, C2[1] + r2 * CA], M2 = [C2[0] + r2 * Math.sin(AL / 2), C2[1] + r2 * Math.cos(AL / 2)], F2 = [C2[0], 9 + t];
  s.polyline([pr(0, -1), pr(F1[0], -1), pr(...F1)]);
  s.arc3(pr(...F1), pr(...M1), pr(...G1));
  s.polyline([pr(...G1), pr(...G2)]);
  s.arc3(pr(...G2), pr(...M2), pr(...F2));
  s.polyline([pr(...F2), pr(0, 9 + t), pr(0, -1)]);
};
P.sketch(at('top', 0), dome(0), 'Push-up');
P.revolve(360, { op: 'cut' });
P.loft(baseSections(T), { newBody: 'Cavity' });                                                                           // inner solid, the cavity one wall inside the outer one
P.sketch(at('top', 0), dome(T), 'Push-up cavity');
P.revolve(360, { op: 'cut', from: 'Cavity' });
P.combine('cut', 'Bottle', 'Cavity');
P.appearance({ feature: BODY, colour: '#5b9bd5', opacity: 0.55, finish: 'glass' });
// A thread ridge: a trapezoid in the axial plane (x = radius, y = -z) swept along a helix of TURNS turns that starts at height z0 on the x axis.
// halfAt(r) is the ridge half width at radius r; the ridge runs from r0 to r1 (the part inside the wall overlaps it so the union is solid).
const ridge = (name, helixR, z0, r0, r1, halfAt) => {
  P.sketch(at('front', z0), (s) => s.circle(helixR), name + ' helix circle');
  P.feature({ type: 'helix', name: name + ' path', sketch: '$sketch', definedBy: 'pitchRevs', pitch: V.PITCH, revolutions: V.TURNS, height: V.PITCH * V.TURNS, startAngle: 0, leftHand: false });
  const HX = P.handle();                                                                                                   // the helix: the sweep reads its id when the script runs
  P.sketch(at('top', 0), (s) => s.polygon([pr(r0, z0 - halfAt(r0)), pr(r1, z0 - halfAt(r1)), pr(r1, z0 + halfAt(r1)), pr(r0, z0 + halfAt(r0))]), name + ' profile');
  P.feature({ type: 'sweep', name, op: 'add', sketch: '$sketch', get path() { return { kind: 'curve', id: String(HX) }; } });
};
const ZN = 195.8;                                                                                                           // neck thread starts here
if (V.THREAD) {                                                                                                          // neck ridge: base 1.5 wide at the root, 0.5 at the crest
  const hn = (r) => 0.75 - 0.5 * (r - ROOT) / (CREST - ROOT);
  ridge('Neck thread', 13.2, ZN, ROOT - 0.15, CREST, hn);
}
if (V.CAP) {                                                                                                             // screw cap (separate body)
  P.sketch(at('top', 0), (s) => s.polygon([pr(14.0, 192.4), pr(15.4, 192.4), pr(15.4, 207.4), pr(0, 207.4), pr(0, 206.0), pr(14.0, 206.0)]), 'Cap profile');
  P.revolve(360, { newBody: 'Cap', axis: { from: [0, 0], to: [0, -1] } });
  P.appearance({ feature: P.handle(), colour: '#f2f2f2', finish: 'plastic' });
  if (V.THREAD) {                                                                                                        // cap ridge: the shape of the gap between the neck ridges, less CLR each side, sitting half a pitch above the neck start
    const hn = (r) => 0.75 - 0.5 * (r - ROOT) / (CREST - ROOT);
    ridge('Cap thread', 13.5, ZN + V.PITCH / 2, 12.95, 14.2, (r) => V.PITCH / 2 - hn(r) - V.CLR);
  }  if (V.GRIP) {                                                                                                          // grip: GRIP shallow V ribs' grooves down the cap side (real cuts, only on the cap)
    P.sketch(at('front', 207.4), (s) => s.polar(V.GRIP, (c) => c.polygon([[15.6, -0.45], [15.6, 0.45], [14.95, 0]])), 'Grip grooves');
    P.cut(15, { direction: 'into', from: 'Cap' });
  }
}
