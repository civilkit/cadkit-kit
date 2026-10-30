// Own work: a 2430 inrunner motor, typical catalogue dimensions (24 mm can, 30 mm long, 12 slots, 4 poles, 2 mm shaft).
// Everything you would change is in the variables block (mm); EXPLODE > 0 gives the exploded view. The bundled samples motor-* are built from this script. In the Variables panel: EXPLODE=11 spreads the parts (exploded view), SCREWS=1 adds the screws, LETTERS=0 turns the lettering off.
// 2430 inrunner (24 mm can, 30 mm long, 12 slots, 4 poles, 2 mm shaft), exploded-view ready. Axis = Z, rear cap underside at z = 0, shaft out of the front (+Z), mm.
// EXPLODE = 0 is assembled; EXPLODE > 0 spreads the bodies along Z by EXPLODE per step (wires follow their coils).
// Between every pair of parts there is a clearance CLR so each part stays its own body (touching parts would fuse).
const V = variables({
  EXPLODE: 0, CLR: 0.1, SCREWS: 0, EXTERIOR: 0, TEXT_ANGLE: 20, LETTERS: 1,   // EXTERIOR: 1 leaves out the parts nobody can see (stator, windings, magnets...) so the drawing has no hidden-line clutter
   KINGVAL: 1,   // KINGVAL 1: smooth red can, 6 front holes, flush rear shaft, no clip. 0: X-Team style, finned can, 4 holes, rear clip          // SCREWS: 1 adds four loose M2.5 mounting screws (they plug the open mount holes)
  CAN_R: 12, CAN_IN_R: 11, CAN_Z0: 3.1, CAN_Z1: 26.4, FINS: 0,
  CAP_T: 3, SPIGOT_R: 10.9, SPIGOT_IN: 9.4, FRONT_Z0: 26.5, FRONT_Z1: 30, BOSS_R: 4.5, BOSS_Z1: 31,
  PCD_R: 8, SCREW_D: 2.5,
  STACK: 18, Z_STATOR: 6, YOKE_IN: 8.6, YOKE_OUT: 10.9, TIP_R: 5.6, N_TEETH: 12,
  COIL_T: 0.4, COIL_R0: 6.9, COIL_R1: 8.4,
  MAG_RI: 1.1, MAG_RO: 4.8, MAG_HALF: 43,
  SHAFT_R: 1, SHAFT_TOP: 42, SHAFT_BOT: 0.3, BRG_OR: 3, BRG_H: 2.5,
  WIRE_R: 0.9, WIRE_OUT: 7.5, WIRE_GAP: 2.0, TIP_LEN: 2.5
});
const { EXPLODE: E, TEXT_ANGLE, LETTERS, CLR, CAN_R, CAN_IN_R, CAN_Z0, CAN_Z1, FINS, CAP_T, SPIGOT_R, SPIGOT_IN, FRONT_Z0, FRONT_Z1, BOSS_R, BOSS_Z1, PCD_R, SCREW_D,
  STACK, Z_STATOR, YOKE_IN, YOKE_OUT, TIP_R, N_TEETH, COIL_T, COIL_R0, COIL_R1, MAG_RI, MAG_RO, MAG_HALF,
  SHAFT_R, SHAFT_TOP, SHAFT_BOT, BRG_OR, BRG_H, WIRE_R, WIRE_OUT, WIRE_GAP, TIP_LEN } = V;
const WR = 7.5, GA = 30;                                                   // lead radius (under the coils) and the angle of the middle wire
// KingVal drawing: 2 x M3 and 4 x M2.5 on the front face (positions measured from the drawing, +-0.3 mm); the X-Team motor has 4 x M2.5 on a 16 mm circle
const M3 = V.KINGVAL ? [[0, 8.5], [0, -8.5]] : [];
const M25 = V.KINGVAL ? [[-6.7, 4.0], [5.8, 3.5], [-5.9, -3.4], [7.0, -4.0]] : [45, 135, 225, 315].map((a) => [PCD_R * Math.cos(a * Math.PI / 180), PCD_R * Math.sin(a * Math.PI / 180)]);
const P = part('Inrunner 2430');
const rad = (d) => d * Math.PI / 180;
const LOOK = { can: '#e0262f', plate: '#2a2c30', cap: '#2a2c30', sleeveRotor: '#8a9098', steel: '#7d858f', copper: '#d0702a', chrome: '#c7ccd1', dark: '#555b63', magN: '#3f444c', magS: '#6b727b', clip: '#3a3d42',
  yellow: '#e5b800', black: '#2b2d31', red: '#d12c2c', bare: '#d98a4a', sleeve: '#16171a', screw: '#9aa1a8' };
const look = (h, name, colour, finish) => { P.bodyName(h, name); P.appearance({ feature: h, colour, finish }); };
// explode steps (z shift = step * EXPLODE): clip -1, rear cap 0, rear bearing 1, can 2, coils 3 (below the stator so their leads do not pass through it), stator 5 (the coil is 19 mm tall: a step of 2 x 14 keeps it clear), rotor magnets and shaft 7 (they move together), front plate 8, front bearing 9, screws 10
const dz = (k) => k * E;
const rev = (pts, z0, name) => {      // closed (r, z) polygon revolved about Z
  P.sketch(at('top', 0), (s) => s.polygon(pts.map(([r, z]) => [r, -(z + z0)])), name);
  P.revolve(360, { axis: { from: [0, 0], to: [0, -1] } });
  return P.handle();
};
// shielded ball bearing, one revolved profile: outer race, inner race and a recessed shield between them
const mkBearing = (z, ro, ri, h, name) => { const w = (ro - ri) * 0.25, a = ri + w * 1.0, b = ro - w * 1.3, g = Math.min(0.25, h * 0.12), c = 0.15;
  return rev([[ri, 0], [a, 0], [a, g], [b, g], [b, 0], [ro - c, 0], [ro, c], [ro, h - c], [ro - c, h], [b, h], [b, h - g], [a, h - g], [a, h], [ri, h]], z, name + ' profile'); };
const ring = (z, ro, ri, h, name) => { P.sketch(at('front', z), (s) => { s.circle(ro); s.circle(ri); }, name); P.extrude(h); return P.handle(); };

// ---- can: anodised tube with cooling fins (revolve profile with grooves) ----
P.group('Can', () => {
  const k = dz(2), fz = (CAN_Z1 - CAN_Z0) / FINS;
  const pts = [[CAN_IN_R, CAN_Z0], [CAN_R, CAN_Z0]];
  for (let i = 0; i < FINS; i++) { const zc = CAN_Z0 + fz * (i + 0.5); pts.push([CAN_R, zc - 0.5], [CAN_R - 0.6, zc - 0.35], [CAN_R - 0.6, zc + 0.35], [CAN_R, zc + 0.5]); }
  pts.push([CAN_R, CAN_Z1], [CAN_IN_R, CAN_Z1]);
  look(rev(pts, k, 'Can profile'), 'Can', LOOK.can, 'plastic');
});

// ---- rear cap: disc, spigot ring, shaft bearing bore, wire holes ----
P.group('Rear cap', () => {
  const k = dz(0);
  P.sketch(at('front', k), (s) => s.circle(CAN_R), 'Rear cap'); P.extrude(CAP_T);
  const h = P.handle();
  ring(CAP_T + k, SPIGOT_R, SPIGOT_IN, 2, 'Rear spigot');
  P.sketch(at('front', CAP_T + k), (s) => s.circle(BRG_OR + 0.05), 'Bearing bore'); P.cut(CAP_T - 0.4, { direction: 'into' });
  P.sketch(at('front', CAP_T + k), (s) => s.circle(SHAFT_R + 0.3), 'Shaft hole'); P.cut(CAP_T, { direction: 'into' });
  P.sketch(at('front', CAP_T + k), (s) => { [0, 30, 60].forEach((a) => s.circle(1.2, [WR * Math.cos(rad(a)), WR * Math.sin(rad(a))])); }, 'Lead holes'); P.cut(CAP_T, { direction: 'into' });
  look(h, 'Rear cap', LOOK.cap, 'plastic');
});

// ---- retaining clip at the rear end of the shaft ----
if (!V.KINGVAL) P.group('Rear clip', () => {
  const z = -1.25 + dz(-1);
  look(ring(z, 2.2, SHAFT_R - 0.3 + 0.05, 0.5, 'Rear clip'), 'Rear clip', LOOK.clip, 'matte');
  P.sketch(at('front', z + 0.5), (s) => s.rect(1.4, 1.0, [1.6, 0]), 'Clip opening'); P.cut(0.5, { direction: 'into' });
});

// ---- rear bearing (2 x 6 x 2.5) sits in the rear cap ----
P.group('Rear bearing', () => look(mkBearing(0.5 + dz(1), BRG_OR, SHAFT_R + 0.1, BRG_H, 'Rear bearing'), 'Rear bearing 682ZZ', LOOK.chrome, 'chrome'));

// ---- stator: yoke ring and 12 inward teeth ----
if (!V.EXTERIOR) P.group('Stator', () => {
  const z = Z_STATOR + dz(5);
  const h = ring(z, YOKE_OUT, YOKE_IN, STACK, 'Stator yoke');
  P.sketch(at('front', z), (s) => s.polygon([[TIP_R, -1.8], [6.4, -1.8], [6.7, -0.9], [YOKE_IN + 0.2, -0.9], [YOKE_IN + 0.2, 0.9], [6.7, 0.9], [6.4, 1.8], [TIP_R, 1.8]]), 'Tooth'); P.extrude(STACK);
  P.circularPattern({ count: N_TEETH, axis: 'z' });
  look(h, 'Stator', LOOK.steel, 'brushed');
});

// ---- windings around each tooth, phases A B C ----
const PHASES = [{ n: 'A', a: 0 }, { n: 'B', a: 30 }, { n: 'C', a: 60 }];
const coilZ0 = Z_STATOR - 0.6 + dz(3), coilZ1 = Z_STATOR + STACK + 0.6 + dz(3);
if (!V.EXTERIOR) P.group('Windings', () => PHASES.forEach((ph) => {
  const t = rad(ph.a), c = Math.cos(t), sn = Math.sin(t);
  P.workplane({ origin: [COIL_R0 * c, COIL_R0 * sn, 0], normal: [c, sn, 0], xdir: [-sn, c, 0] }); const pl = P.handle();
  const hw = 0.9 + CLR + COIL_T;
  P.sketch(at(pl), (s) => {
    s.polygon([[-hw, coilZ0], [hw, coilZ0], [hw, coilZ1], [-hw, coilZ1]]);
    s.polygon([[-(hw - COIL_T), coilZ0 + 0.5], [hw - COIL_T, coilZ0 + 0.5], [hw - COIL_T, coilZ1 - 0.5], [-(hw - COIL_T), coilZ1 - 0.5]]);
  }, 'Coil ' + ph.n);
  P.extrude(COIL_R1 - COIL_R0);
  const seed = P.handle();
  P.circularPattern({ count: N_TEETH / 3, axis: 'z' });
  look(seed, 'Winding ' + ph.n, LOOK.copper, 'plastic'); look(P.handle(), 'Winding ' + ph.n, LOOK.copper, 'plastic');
}));

// ---- rotor magnet: four quarter-rings, alternating poles in two bodies ----
if (!V.EXTERIOR) P.group('Rotor magnet', () => {
  const z = Z_STATOR + dz(7);
  ring(z, MAG_RO + 0.3, MAG_RO + 0.1, STACK, 'Rotor sleeve'); look(P.handle(), 'Rotor sleeve', LOOK.sleeveRotor, 'brushed');
  [['N', 45, LOOK.magN], ['S', 135, LOOK.magS]].forEach(([n, off, col]) => {
    P.sketch(at('front', z), (s) => {
      const a0 = rad(off - MAG_HALF), a1 = rad(off + MAG_HALF), am = rad(off), p = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
      s.arc3(p(MAG_RO, a0), p(MAG_RO, am), p(MAG_RO, a1)); s.line(p(MAG_RO, a1), p(MAG_RI, a1)); s.arc3(p(MAG_RI, a1), p(MAG_RI, am), p(MAG_RI, a0)); s.line(p(MAG_RI, a0), p(MAG_RO, a0));
    }, 'Magnet ' + n);
    P.extrude(STACK);
    const seed = P.handle();
    P.circularPattern({ count: 2, axis: 'z' });
    look(seed, 'Magnet ' + n, col, 'matte'); look(P.handle(), 'Magnet ' + n, col, 'matte');
  });
});

// ---- front plate: one revolve profile (spigot ring, tapered outer edge, bearing boss with its bearing pocket), then 4 open M2.5 mounting holes ----
P.group('Front plate', () => {
  const k = dz(9), z0 = FRONT_Z0, z1 = FRONT_Z1, zb = BOSS_Z1, tap = 0.9;
  const h = rev([[SPIGOT_IN, z0 - 2], [SPIGOT_R, z0 - 2], [SPIGOT_R, z0], [CAN_R, z0], [CAN_R, z1 - tap], [CAN_R - tap, z1], [BOSS_R, z1], [BOSS_R, zb], [BRG_OR + 0.05, zb], [BRG_OR + 0.05, z0 + 0.4], [SHAFT_R + 0.3, z0 + 0.4], [SHAFT_R + 0.3, z0], [SPIGOT_IN, z0]], k, 'Front plate profile');
  const fp = face({ normal: [0, 0, 1], at: [M25[0][0], M25[0][1], z1 + k] });   // the real hole features let the drawing call them out
  P.holes.points(fp, M25, { size: 'M2.5', kind: 'tapped', depth: 2, name: 'Mount holes M2.5' });
  if (M3.length) P.holes.points(fp, M3, { size: 'M3', kind: 'tapped', depth: 2, name: 'Mount holes M3' });                   // blind 2 mm holes, as listed for the X-Team motor
  const rims = [...M25, ...M3].map(([x, y]) => edges({ near: [x, y, z1 + k], within: 1.6 }));
  P.chamfer(edges({ union: rims }), 0.3, { name: 'Entry chamfer' });   // so the holes read in a render
  look(h, 'Front plate', LOOK.plate, 'plastic');
});

// ---- front bearing ----
P.group('Front bearing', () => look(mkBearing(FRONT_Z1 - BRG_H - 0.2 + dz(10), BRG_OR, SHAFT_R + 0.1, BRG_H, 'Front bearing'), 'Front bearing 682ZZ', LOOK.chrome, 'chrome'));

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
// ---- four M2.5 x 5 mounting screws (accessory) ----
if (V.SCREWS) P.group('Mount screws', () => M25.forEach(([x, y], i) => {
  const h = mkScrew({ x, y, zSeat: FRONT_Z1 + 0.4 + dz(11), dir: -1, rMaj: 1.25, R: 2.35, k: 1.5, hex: 1.5, hd: 0.9, L: 5, p: 0.45, name: 'Screw ' + (i + 1) });
  look(h, 'Mount screw M2.5 ' + (i + 1), LOOK.screw, 'plastic');
}));

// ---- shaft: 2 mm, groove for the rear clip ----
P.group('Shaft', () => look(rev([[0, SHAFT_BOT], [SHAFT_R - 0.2, SHAFT_BOT], [SHAFT_R, SHAFT_BOT + 0.2], [SHAFT_R, SHAFT_TOP - 0.2], [SHAFT_R - 0.2, SHAFT_TOP], [0, SHAFT_TOP]], dz(7), 'Shaft profile'), 'Shaft', LOOK.chrome, 'chrome'));

// ---- three phase wires, one colour each, leaving the coils straight down through the base and gathered into a neat bundle ~1 cm long, with a heat-shrink sleeve and bare tips ----
const bundleT = [-Math.sin(rad(GA)), Math.cos(rad(GA))], bundleN = [Math.cos(rad(GA)), Math.sin(rad(GA))];
const G = [WR * bundleN[0], WR * bundleN[1]];
P.group('Wires', () => [{ n: 'Yellow', a: 0, k: -1, col: LOOK.yellow }, { n: 'Black', a: 30, k: 0, col: LOOK.black }, { n: 'Red', a: 60, k: 1, col: LOOK.red }].forEach((w) => {
  const S = [WR * Math.cos(rad(w.a)), WR * Math.sin(rad(w.a))], Ee = [G[0] + w.k * WIRE_GAP * bundleT[0], G[1] + w.k * WIRE_GAP * bundleT[1]];
  const dx = Ee[0] - S[0], dy = Ee[1] - S[1], L = Math.hypot(dx, dy), zs = coilZ0 - CLR;
  const d = L > 1e-6 ? [dx / L, dy / L] : [Math.cos(rad(w.a)), Math.sin(rad(w.a))];
  P.workplane({ origin: [S[0], S[1], 0], normal: [-d[1], d[0], 0], xdir: [d[0], d[1], 0] }); const pl = P.handle();   // path plane: sketch x = along d, sketch y = -z
  const path = L > 1e-6 ? [[0, -zs], [0, 0.5], [L, 4.5], [L, WIRE_OUT]] : [[0, -zs], [0, WIRE_OUT]];
  P.sweep({ on: at('front', zs), draw: (s) => s.circle(WIRE_R, S) }, { on: at(pl), draw: (s) => s.polyline(path) });
  look(P.handle(), 'Wire ' + w.n, w.col, 'plastic');
  P.workplane({ origin: [Ee[0], Ee[1], -(WIRE_OUT + CLR)], normal: [0, 0, -1], xdir: [1, 0, 0] }); const tip = P.handle();
  P.sketch(at(tip), (s) => s.circle(WIRE_R * 0.55, [0, 0]), 'Bare end ' + w.n); P.extrude(TIP_LEN);
  look(P.handle(), 'Bare end ' + w.n, LOOK.bare, 'brushed');
}));
P.group('Sleeve', () => {
  const along = WIRE_GAP + WIRE_R, rot = (u, v) => [G[0] + u * bundleT[0] + v * bundleN[0], G[1] + u * bundleT[1] + v * bundleN[1]];
  const stadium = (a, b) => { const pts = []; for (let i = 0; i <= 10; i++) { const t = -Math.PI / 2 + Math.PI * i / 10; pts.push(rot(a - b + b * Math.cos(t), b * Math.sin(t))); } for (let i = 0; i <= 10; i++) { const t = Math.PI / 2 + Math.PI * i / 10; pts.push(rot(-(a - b) + b * Math.cos(t), b * Math.sin(t))); } return pts; };
  P.sketch(at('front', -(WIRE_OUT - 0.4)), (s) => { s.polygon(stadium(along + 0.6, WIRE_R + 0.6)); s.polygon(stadium(along + 0.15, WIRE_R + 0.15)); }, 'Heat-shrink sleeve'); P.extrude(2.4);
  look(P.handle(), 'Heat-shrink sleeve', LOOK.sleeve, 'matte');
});

// lettering that wraps the can: each letter is its own 0.2 mm raised white print on a plane tangent to the can wall at that letter (same technique as the 2212; the kernel has no wrap feature, so a letter is flat but sits on its own tangent). Placed LAST: newBody prints are the slowest booleans. Lines read around the can, tops towards the front plate.
if (LETTERS && !FINS) await (async () => {
  const k = dz(2), R = CAN_R + 0.05, TA = TEXT_ANGLE;
  for (const ln of [{ str: 'CIVILKIT', h: 2.6, z: 17.4 }, { str: '2430 BLDC', h: 2.0, z: 13.0 }]) {
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
