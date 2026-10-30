// Own work: a parametric 2804 gimbal motor (12N14P, 28 mm, hollow shaft), typical catalogue dimensions, not from a drawing. The bundled sample motor-gimbal-2804 is built from this script.
// In the Variables panel: EXPLODE=10 spreads the parts (exploded view), SCREWS=1 adds the three screws, LETTERS=0 turns the lettering off.
// 2804 gimbal motor, 12N14P, exploded-view ready. Axis = Z, base underside at z = 0, mm. Own model with catalogue-typical dimensions, NOT taken from a drawing.
// Construction: fixed base plate with a bearing tube, stator and coils on the tube, rotating bell (flat cap, no prop hub) clamped on a hollow through-shaft (4 mm bore, wires or a flex can pass), two thin bearings, three thin leads out of the base.
// EXPLODE = 0 is the assembled motor; EXPLODE > 0 spreads the bodies along Z by EXPLODE per step (leads follow their coils).
// Between every pair of parts there is a clearance CLR so each part stays its own body (touching parts would fuse).
const V = variables({
  EXPLODE: 0, CLR: 0.1, SCREWS: 0, EXTERIOR: 0, BLACK: 0, TEXT_ANGLE: 62, LETTERS: 1   // EXTERIOR: 1 leaves out the parts nobody can see (stator, windings, magnets...) so the drawing has no hidden-line clutter
            // SCREWS: 1 adds the three M2 mounting screws (loose accessory)
});
const { EXPLODE: E, TEXT_ANGLE, LETTERS, CLR } = V;
// ---- dimensions (typical catalogue values, est) ----
const BASE_R = 14.0, BASE_T = 2.0, TUBE_R = 6.2, BORE_R = 5.05, TUBE_TOP = 8.2;                       // base plate (OD 28), bearing tube (bore fits the 6 x 10 x 3 bearings)
const MOUNT_R = 11.0, MOUNT_ANGLES = [90, 210, 330], MOUNT_DEPTH = 1.5;                                // 3 x M2 tapped from the rear, clear of the lead window
const STACK = 4, Z_STATOR = 2.9, YOKE_IN = 6.3, YOKE_OUT = 8.6, TIP_R = 10.9, N_TEETH = 12, TOOTH_IN = 8.3, SHOULDER_R = 9.9, NECK = 0.9, TIPW = 1.8;
const COIL_R0 = 8.7, COIL_R1 = 9.8, COIL_T = 0.35;
const MAG_N = 14, MAG_RI = 11.4, MAG_RO = 12.9, MAG_HALF = 10.5;                                       // 1.5 mm magnets, 0.5 mm air gap
const BELL_R = 14.0, BELL_IN = 13.0, BELL_Z0 = 2.6, BELL_TOP_IN = 8.8, BELL_TOP = 10.2, COLLAR_R = 4.6, COLLAR_H = 0.5;
const SHAFT_RO = 3.0, SHAFT_RI = 2.0, SHAFT_BOT = -1.0, SHAFT_TOP = 11.2;                               // hollow shaft OD 6, bore 4
const BG = { ri: 3.065, a: 3.75, b: 4.3, ro: 5.0, h: 3, shield: 0.2, ch: 0.15, zLow: 0.3, zUp: 5.0 };    // 6 x 10 x 3 shielded bearings
const WIRE_R = 0.4, WIRE_GAP = 1.1, TIP_LEN = 2.0, WR = 9.25, RE = 14.4, RO = 24, GA = 30, WIN_IN = 7.0, WIN_OUT = 15, WIN_DEPTH = 1.2, WIRE_DROP = 0.6;
const q = (x) => Math.round(x * 1e6) / 1e6;
const P = part('Gimbal 2804');
const rad = (d) => d * Math.PI / 180;
const LOOK = { base: '#2d3139', steel: '#4a5058', copper: '#e0701c', chrome: '#c7ccd1', bell: V.BLACK ? '#1f2125' : '#c1272d', magN: '#4a4f57', magS: '#6b727b', yellow: '#e5b800', blue: '#1f6fd0', red: '#d12c2c', bare: '#d98a4a', screw: '#9aa1a8' };
const look = (h, name, colour, finish) => { P.bodyName(h, name); P.appearance({ feature: h, colour, finish }); };
// explode steps (z shift = step * EXPLODE): screws -2, base 0, lower bearing 1, coils 2, stator 3, upper bearing 4, magnets 5, bell 6, shaft 7
const dz = (k) => k * E;
// revolve a closed (r, z) polygon about the Z axis; points are [r, z]
const rev = (pts, z0, name) => {
  P.sketch(at('top', 0), (s) => s.polygon(pts.map(([r, z]) => [r, -(z + z0)])), name);
  P.revolve(360, { axis: { from: [0, 0], to: [0, -1] } });
  return P.handle();
};
const ring = (z, ro, ri, h, name) => { P.sketch(at('front', z), (s) => { s.circle(ro); s.circle(ri); }, name); P.extrude(h); return P.handle(); };

// ---- bell (built first: its cuts must not touch the other bodies): flat closed cap with a small centre collar, no prop hub ----
P.group('Bell', () => {
  const k = dz(6), hole = SHAFT_RO + CLR / 2;
  const h = rev([[hole, BELL_TOP_IN], [BELL_IN, BELL_TOP_IN], [BELL_IN, BELL_Z0], [BELL_R, BELL_Z0], [BELL_R, BELL_TOP], [COLLAR_R, BELL_TOP], [COLLAR_R, BELL_TOP + COLLAR_H], [hole, BELL_TOP + COLLAR_H]], k, 'Bell profile');
  look(h, 'Bell', LOOK.bell, 'plastic');
});

// ---- base: plate with bearing tube, three M2 mount holes, lead window ----
let BASE;
P.group('Base', () => {
  P.sketch('front', (s) => s.circle(BASE_R), 'Base plate'); P.extrude(BASE_T);
  const h = P.handle();
  P.sketch(at('front', BASE_T), (s) => s.circle(TUBE_R), 'Bearing tube'); P.extrude(TUBE_TOP - BASE_T);
  P.sketch(at('front', TUBE_TOP), (s) => s.circle(BORE_R), 'Bore'); P.cut(TUBE_TOP, { direction: 'into' });   // depth-limited: a through cut would also cut every body built before the base
  const mp = MOUNT_ANGLES.map((a) => [MOUNT_R * Math.cos(rad(a)), MOUNT_R * Math.sin(rad(a))]);
  const fR = face({ normal: [0, 0, -1], at: [mp[0][0], mp[0][1], 0] });
  P.holes.points(fR, mp, { size: 'M2', kind: 'tapped', depth: MOUNT_DEPTH, name: 'Mount holes M2' });
  P.chamfer(edges({ union: mp.map(([x, y]) => edges({ near: [x, y, 0], within: 1.2 })) }), 0.25, { name: 'Entry chamfer M2' });
  // lead window: a sector slot in the top of the plate; the three leads run radially out of it
  P.sketch(at('front', BASE_T), (s) => {
    const a0 = rad(-8), a1 = rad(68), am = rad(30), p = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    s.arc3(p(WIN_OUT, a0), p(WIN_OUT, am), p(WIN_OUT, a1)); s.line(p(WIN_OUT, a1), p(WIN_IN, a1)); s.arc3(p(WIN_IN, a1), p(WIN_IN, am), p(WIN_IN, a0)); s.line(p(WIN_IN, a0), p(WIN_OUT, a0));
  }, 'Lead window'); P.cut(WIN_DEPTH, { direction: 'into' });
  BASE = h;
});
look(BASE, 'Base', LOOK.base, 'matte');

// ---- bearings 6700ZZ-class (6 x 10 x 3), assumed ----
const mkBearing = (z, name) => rev([[BG.ri, 0], [BG.a, 0], [BG.a, BG.shield], [BG.b, BG.shield], [BG.b, 0], [q(BG.ro - BG.ch), 0], [BG.ro, BG.ch], [BG.ro, q(BG.h - BG.ch)], [q(BG.ro - BG.ch), BG.h], [BG.b, BG.h], [BG.b, q(BG.h - BG.shield)], [BG.a, q(BG.h - BG.shield)], [BG.a, BG.h], [BG.ri, BG.h]], z, name + ' profile');
if (!V.EXTERIOR) P.group('Lower bearing', () => look(mkBearing(BG.zLow + dz(1), 'Lower bearing'), 'Lower bearing', LOOK.chrome, 'chrome'));
if (!V.EXTERIOR) P.group('Upper bearing', () => look(mkBearing(BG.zUp + dz(4), 'Upper bearing'), 'Upper bearing', LOOK.chrome, 'chrome'));

// ---- stator: yoke ring and 12 teeth ----
if (!V.EXTERIOR) P.group('Stator', () => {
  const z = Z_STATOR + dz(3);
  const h = ring(z, YOKE_OUT, YOKE_IN, STACK, 'Stator yoke');
  P.sketch(at('front', z), (s) => s.polygon([[TOOTH_IN, -NECK], [SHOULDER_R, -NECK], [TIP_R, -TIPW], [TIP_R, TIPW], [SHOULDER_R, NECK], [TOOTH_IN, NECK]]), 'Tooth'); P.extrude(STACK);
  P.circularPattern({ count: N_TEETH, axis: 'z' });
  look(h, 'Stator', LOOK.steel, 'brushed');
});

// ---- windings: a rectangular winding around each tooth; phases A, B, C every third tooth ----
const PHASES = [{ n: 'A', a: 0 }, { n: 'B', a: 30 }, { n: 'C', a: 60 }];
const coilZ0 = Z_STATOR - 0.6 + dz(2), coilZ1 = Z_STATOR + STACK + 0.6 + dz(2);
if (!V.EXTERIOR) P.group('Windings', () => PHASES.forEach((ph) => {
  const t = rad(ph.a), c = Math.cos(t), sn = Math.sin(t);
  P.workplane({ origin: [COIL_R0 * c, COIL_R0 * sn, 0], normal: [c, sn, 0], xdir: [-sn, c, 0] }); const pl = P.handle();
  const hw = NECK + CLR + COIL_T;
  P.sketch(at(pl), (s) => {
    s.polygon([[-hw, coilZ0], [hw, coilZ0], [hw, coilZ1], [-hw, coilZ1]]);
    s.polygon([[-(hw - COIL_T), coilZ0 + 0.5], [hw - COIL_T, coilZ0 + 0.5], [hw - COIL_T, coilZ1 - 0.5], [-(hw - COIL_T), coilZ1 - 0.5]]);
  }, 'Coil ' + ph.n);
  P.extrude(COIL_R1 - COIL_R0);
  const seed = P.handle();
  P.circularPattern({ count: N_TEETH / 3, axis: 'z' });
  look(seed, 'Winding ' + ph.n, LOOK.copper, 'plastic'); look(P.handle(), 'Winding ' + ph.n, LOOK.copper, 'plastic');
}));

// ---- magnets: 14 arc segments, alternating poles in two bodies ----
if (!V.EXTERIOR) P.group('Magnets', () => {
  const z = Z_STATOR + dz(5), pitch = 360 / MAG_N;
  [['N', 0, LOOK.magN], ['S', pitch, LOOK.magS]].forEach(([n, off, col]) => {
    P.sketch(at('front', z), (s) => {
      const a0 = rad(off - MAG_HALF), a1 = rad(off + MAG_HALF), am = rad(off), p = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
      s.arc3(p(MAG_RO, a0), p(MAG_RO, am), p(MAG_RO, a1)); s.line(p(MAG_RO, a1), p(MAG_RI, a1)); s.arc3(p(MAG_RI, a1), p(MAG_RI, am), p(MAG_RI, a0)); s.line(p(MAG_RI, a0), p(MAG_RO, a0));
    }, 'Magnet ' + n);
    P.extrude(STACK);
    const seed = P.handle();
    P.circularPattern({ count: MAG_N / 2, axis: 'z' });
    look(seed, 'Magnets ' + n, col, 'matte'); look(P.handle(), 'Magnets ' + n, col, 'matte');
  });
});

// ---- hollow through-shaft (OD 6, bore 4) ----
P.group('Shaft', () => {
  const k = dz(7), c = 0.3;
  const h = rev([[SHAFT_RI, SHAFT_BOT], [SHAFT_RO - c, SHAFT_BOT], [SHAFT_RO, SHAFT_BOT + c], [SHAFT_RO, SHAFT_TOP - c], [SHAFT_RO - c, SHAFT_TOP], [SHAFT_RI, SHAFT_TOP]], k, 'Shaft profile');
  look(h, 'Hollow shaft', LOOK.chrome, 'chrome');
});

// ---- three thin leads, one colour each: down from the coils, then radially out through the base-plate window, bare tips ----
const eV = [Math.cos(rad(GA)), Math.sin(rad(GA))], tV = [-Math.sin(rad(GA)), Math.cos(rad(GA))];
const zf = q(BASE_T - WIRE_DROP) + dz(2);
P.group('Wires', () => [{ n: 'Yellow', a: 0, k: -1, col: LOOK.yellow }, { n: 'Blue', a: 30, k: 0, col: LOOK.blue }, { n: 'Red', a: 60, k: 1, col: LOOK.red }].forEach((w) => {
  const S = [WR * Math.cos(rad(w.a)), WR * Math.sin(rad(w.a))], E1 = [RE * eV[0] + w.k * WIRE_GAP * tV[0], RE * eV[1] + w.k * WIRE_GAP * tV[1]];
  const dx = E1[0] - S[0], dy = E1[1] - S[1], L = Math.hypot(dx, dy), zs = coilZ0 - CLR, d = [dx / L, dy / L];
  P.workplane({ origin: [S[0], S[1], 0], normal: [-d[1], d[0], 0], xdir: [d[0], d[1], 0] }); const pl = P.handle();
  P.sweep({ on: at('front', zs), draw: (s) => s.circle(WIRE_R, S) }, { on: at(pl), draw: (s) => s.polyline([[0, -zs], [0, -zf], [L, -zf]]) });
  look(P.handle(), 'Wire ' + w.n, w.col, 'plastic');
  const P0 = [E1[0] - 0.4 * eV[0], E1[1] - 0.4 * eV[1]], len = RO - RE + 0.4;
  P.workplane({ origin: [P0[0], P0[1], zf], normal: [eV[0], eV[1], 0], xdir: [tV[0], tV[1], 0] }); const prof = P.handle();
  P.workplane({ origin: [P0[0], P0[1], 0], normal: [-eV[1], eV[0], 0], xdir: [eV[0], eV[1], 0] }); const pl2 = P.handle();
  P.sweep({ on: at(prof), draw: (s) => s.circle(WIRE_R, [0, 0]) }, { on: at(pl2), draw: (s) => s.polyline([[0, -zf], [len, -zf]]) });
  look(P.handle(), 'Wire ' + w.n, w.col, 'plastic');
  const E2 = [E1[0] + (RO - RE + CLR) * eV[0], E1[1] + (RO - RE + CLR) * eV[1]];
  P.workplane({ origin: [E2[0], E2[1], zf], normal: [eV[0], eV[1], 0], xdir: [tV[0], tV[1], 0] }); const tip = P.handle();
  P.sketch(at(tip), (s) => s.circle(WIRE_R * 0.55, [0, 0]), 'Bare end ' + w.n); P.extrude(TIP_LEN);
  look(P.handle(), 'Bare end ' + w.n, LOOK.bare, 'brushed');
}));
// ISO 7380 button-head hex-socket screw: domed head, hex socket, threaded shank (ring grooves, no helix), chamfered tip.
// zSeat = underside of the head, dir = +1 when the shank points up (+z), -1 when it points down; R head radius, k head height, hex across flats, hd socket depth, L shank length, p pitch
const mkScrew = ({ x, y, zSeat, dir, rMaj, R, k, hex, hd, L, p, name }) => {
  const rRoot = rMaj - 0.61 * p, n = Math.floor((L - 0.4) / p);
  const prof = [[0, -k], [R - 0.6, -k], [R - 0.1, -k * 0.6], [R, -k * 0.3], [R, 0], [rRoot, 0]];
  for (let j = 0; j < n; j++) { prof.push([rMaj, (j + 0.5) * p]); prof.push([rRoot, (j + 1) * p]); }
  prof.push([rRoot - 0.15, L], [0, L]);
  P.sketch(at('top', y), (s) => s.polygon(prof.map(([r, t]) => [x + r, -(zSeat + dir * t)])), name);
  P.revolve(360, { axis: { from: [x, 0], to: [x, -1] } });
  const h = P.handle(), rc = hex / Math.sqrt(3);
  const zPlane = dir > 0 ? zSeat - k + hd : zSeat + k;
  P.sketch(at('front', zPlane), (s) => s.polygon([0, 1, 2, 3, 4, 5].map((i) => [x + rc * Math.cos(i * Math.PI / 3), y + rc * Math.sin(i * Math.PI / 3)])), name + ' socket');
  P.cut(dir > 0 ? hd + 0.3 : hd, { direction: 'into' });
  return h;
};
// ---- three M2 x 1.8 mounting screws, heads below the base (accessory) ----
if (V.SCREWS) P.group('Mount screws', () => MOUNT_ANGLES.forEach((a, i) => {
  const h = mkScrew({ x: MOUNT_R * Math.cos(rad(a)), y: MOUNT_R * Math.sin(rad(a)), zSeat: -0.3 + dz(-2), dir: 1, rMaj: 1.0, R: 1.9, k: 1.1, hex: 1.5, hd: 0.7, L: 1.8, p: 0.4, name: 'Screw ' + (i + 1) });
  look(h, 'Mount screw M2 ' + (i + 1), LOOK.screw, 'plastic');
}));

// lettering that wraps the barrel: each letter is its own 0.2 mm raised white print on a plane tangent to the bell wall at that letter, so the line follows the curve. Text goes last (newBody).
if (LETTERS) await (async () => {
  const k = dz(6), R = q(BELL_R + 0.05), TA = TEXT_ANGLE;
  for (const ln of [{ str: 'CIVILKIT 2804', h: 2.4, z: 6.4 }]) {
    const m = await P.textMetrics(ln.str, { height: ln.h });
    const total = m.advances.reduce((a, b) => a + b, 0);
    let pen = 0;
    for (let i = 0; i < ln.str.length; i++) {
      const adv = m.advances[i], ch = ln.str[i];
      if (ch !== ' ') {
        const th = rad(TA) + (pen + adv / 2 - total / 2) / R, c = Math.cos(th), sn = Math.sin(th);
        P.workplane({ origin: [R * c, R * sn, ln.z + k], normal: [c, sn, 0], xdir: [-sn, c, 0] }); const tp = P.handle();
        P.sketch(at(tp), (sk) => sk.text(ch, [-adv / 2, 0], { height: ln.h, anchor: ['left', 'middle'] }), 'Letter ' + ln.str.slice(0, i + 1));
        const ln_ = 'Letter ' + ln.str.replace(' ', '_') + ' ' + i; P.extrude(0.2, { newBody: ln_ }); look(P.handle(), ln_, '#f2f2f2', 'matte');
      }
      pen += adv;
    }
  }
})();
