// Own work: a parametric outrunner drone motor (12N14P), typical catalogue dimensions (2212 from photos and the maker drawing; 2306 and 5010 catalogue-typical, not from a drawing).
// See the SIZES table below: set SIZE to 2212, 2306 or 5010. EXPLODE > 0 gives the exploded view. The bundled samples motor-* are built from this script. In the Variables panel: EXPLODE=14 spreads the parts (exploded view; 20 for the 5010), SCREWS=1 adds the screws, LETTERS=0 turns the lettering off.
// 2212 outrunner drone motor, 12N14P, exploded-view ready. Axis = Z, base underside at z = 0, mm.
// EXPLODE = 0 is the assembled motor; EXPLODE > 0 spreads the bodies along Z by EXPLODE per step (wires follow their coils).
// Between every pair of parts there is a clearance CLR so each part stays its own body (touching parts would fuse).
// Parametric outrunner drone motor, 12N14P, exploded-view ready. Axis = Z, base underside at z = 0, mm.
// SIZE selects a row of the table below (2212 = A2212-class, from photos and the manufacturer drawing; 2306 and 5010 = catalogue-typical dimensions, NOT from a drawing).
// Optional row fields (stator.neck/tip, base.mount*, base.light*, base.win*, bell.win/prop/recessR, clipOpen, wire.r/gap/tip/sleeve/drop, screw) fall back to the 2212/2306 values when a row leaves them out.
// EXPLODE = 0 is the assembled motor; EXPLODE > 0 spreads the bodies along Z by EXPLODE per step (wires follow their coils).
// Between every pair of parts there is a clearance CLR so each part stays its own body (touching parts would fuse).
const V = variables({
  SIZE: 2212, EXPLODE: 0, CLR: 0.1, SCREWS: 0, EXTERIOR: 0, BLACK: 0, TEXT_ANGLE: 62, LETTERS: 1   // EXTERIOR: 1 leaves out the parts nobody can see (stator, windings, magnets...) so the drawing has no hidden-line clutter
            // SCREWS: 1 adds the four mounting screws (loose accessory; they hide the open mount holes)
});
// ---- size table: every dimension that differs between motors. Derived numbers are explicit too, so a size is one readable row. ----
const SIZES = {
  2212: {
    stator: { tipR: 10.9, yokeOut: 7.5, yokeIn: 5.6, stack: 12, zStart: 11.8, toothIn: 7.0, shoulderR: 9.9, teeth: 12 },
    coil: { r0: 7.6, r1: 9.8, t: 0.55 },
    mag: { n: 14, ri: 11.5, ro: 12.8, half: 10.5 },
    bell: { r: 13.9, inR: 12.9, z0: 4, top: 28, topIn: 25.2, hubR: 4.5, hubIn: 4, m2Depth: 2.6 },
    base: { r: 13.9, t: 3, mountX: 8, mountY: 9.5, tubeR: 5.5, boreR: 4.1, tubeTop: 24, lightR: 2.75, lightAt: 10, winIn: 6.9, winOut: 14.6 },
    shaft: { r: 1.585, top: 32.5, bot: -2.2 },
    brg: { ri: 1.65, a: 2.45, b: 3.3, ro: 4.05, h: 3, shield: 0.3, ch: 0.2, zLow: 0.2, zUp: 20.4 },
    clipR: 3,
    wire: { wr: 8.7, re: 14.5, ro: 25, rs: 15.4 },
    text: [{ h: 2.6, z: 17.6 }, { h: 2.0, z: 13.8 }],
  },
  // 2306: typical catalogue values (28 mm can, 23 mm stator, 6 mm stack, 4 mm shaft, 16 x 16 mm M3 mount, 4 x 9 x 4 bearings), not taken from a drawing
  2306: {
    stator: { tipR: 11.5, yokeOut: 8.2, yokeIn: 5.6, stack: 6, zStart: 5.0, toothIn: 7.7, shoulderR: 10.5, teeth: 12 },
    coil: { r0: 8.3, r1: 10.4, t: 0.55 },
    mag: { n: 14, ri: 12.0, ro: 13.2, half: 10.5 },
    bell: { r: 14.1, inR: 13.3, z0: 4, top: 15.2, topIn: 12.8, hubR: 4.5, hubIn: 4, m2Depth: 2.2 },
    base: { r: 14.1, t: 3, mountX: 8, mountY: 8, tubeR: 5.5, boreR: 4.55, tubeTop: 11.2, lightR: 2.75, lightAt: 10, winIn: 6.9, winOut: 14.8 },
    shaft: { r: 2.0, top: 19.7, bot: -2.2 },
    brg: { ri: 2.065, a: 2.865, b: 3.75, ro: 4.5, h: 4, shield: 0.3, ch: 0.2, zLow: 0.2, zUp: 6.8 },
    clipR: 3.4,
    wire: { wr: 9.35, re: 14.7, ro: 25.2, rs: 15.6 },
    text: [{ h: 2.6, z: 9.6 }, { h: 2.0, z: 6.2 }],
  },
  // 5010: typical catalogue values (50 mm stator, 10 mm stack, 12N14P, 6 mm shaft, 56 mm can, 25 x 25 mm M4 mount, 606-size 6 x 17 x 6 bearings, 1.5 mm magnets), not taken from a drawing
  5010: {
    stator: { tipR: 25.0, yokeOut: 17.0, yokeIn: 9.6, stack: 10, zStart: 6.0, toothIn: 16.4, shoulderR: 22.5, teeth: 12, neck: 2.0, tip: 4.2 },
    coil: { r0: 17.1, r1: 22.4, t: 1.0 },
    mag: { n: 14, ri: 25.5, ro: 27.0, half: 10.5 },
    bell: { r: 28.0, inR: 27.1, z0: 5, top: 21.2, topIn: 18.6, hubR: 7.5, hubIn: 5.5, m2Depth: 2.2, recessR: 4.5,
      win: { big: { r: 6.5, at: 19.5 }, small: { r: 4.5, at: 20.0 } }, prop: { size: 'M3', r: 10.5, within: 1.7 } },
    base: { r: 28.0, t: 4, mountX: 12.5, mountY: 12.5, tubeR: 9.5, boreR: 8.55, tubeTop: 17.5, lightR: 4.5, lightAt: 18.5, winIn: 19.5, winOut: 29.5,
      mountSize: 'M4', mountDepth: 3.5, mountCh: 0.5, mountChWithin: 2.2, lightAngles: [100, 180, 260, 340], winDepth: 3 },
    shaft: { r: 3.0, top: 33, bot: -2.2 },
    brg: { ri: 3.065, a: 4.4, b: 7.0, ro: 8.5, h: 6, shield: 0.4, ch: 0.3, zLow: 0.2, zUp: 11.3 },
    clipR: 5.2, clipOpen: { l: 3.4, w: 2.4, cx: 4.0 },
    wire: { wr: 21.0, re: 28.8, ro: 44.0, rs: 29.7, r: 1.2, gap: 2.8, tip: 4, sleeve: 12, drop: 1.5 },
    screw: { rMaj: 2, R: 3.8, k: 2.2, hex: 2.5, hd: 1.3, L: 3.5, p: 0.7, zSeat: -0.3 },
    text: [{ h: 4.6, z: 15.0 }, { h: 3.4, z: 9.4 }],
  },
};
const Z = SIZES[V.SIZE];
if (!Z) throw new Error('unknown SIZE ' + V.SIZE + ' (table has ' + Object.keys(SIZES).join(', ') + ')');
const q = (x) => Math.round(x * 1e6) / 1e6;   // keep derived numbers identical to the literals they replace
const { EXPLODE: E, TEXT_ANGLE, LETTERS, CLR } = V;
const { stator: ST, coil: CO, mag: MG, bell: BL, base: BS, shaft: SH, brg: BG } = Z;
const BASE_R = BS.r, BASE_T = BS.t, MOUNT_X = BS.mountX, MOUNT_Y = BS.mountY, TUBE_R = BS.tubeR, BORE_R = BS.boreR, TUBE_TOP = BS.tubeTop;
const STACK = ST.stack, Z_STATOR = ST.zStart, YOKE_IN = ST.yokeIn, YOKE_OUT = ST.yokeOut, TIP_R = ST.tipR, N_TEETH = ST.teeth;
const COIL_T = CO.t, COIL_R0 = CO.r0, COIL_R1 = CO.r1;
const BELL_Z0 = BL.z0, BELL_TOP_IN = BL.topIn, BELL_TOP = BL.top;
const SHAFT_R = SH.r, SHAFT_TOP = SH.top, SHAFT_BOT = SH.bot;
const MAG_RI = MG.ri, MAG_RO = MG.ro, MAG_N = MG.n, MAG_HALF = MG.half;
const WK = Z.wire, WIRE_R = WK.r ?? 0.8, WIRE_OUT = 10, WIRE_GAP = WK.gap ?? 1.8, TIP_LEN = WK.tip ?? 2.5;
const NECK = ST.neck ?? 1.0, TIPW = ST.tip ?? 2.0;
const P = part('Outrunner ' + V.SIZE);
const rad = (d) => d * Math.PI / 180;
const LOOK = { base: '#2d3139', steel: '#4a5058', copper: '#e0701c', chrome: '#c7ccd1', bell: V.BLACK ? '#1f2125' : '#c1272d', magN: '#4a4f57', magS: '#6b727b', clip: '#3a3d42', yellow: '#e5b800', blue: '#1f6fd0', red: '#d12c2c', bare: '#d98a4a', sleeve: '#16171a', screw: '#9aa1a8' };
const look = (h, name, colour, finish) => { P.bodyName(h, name); P.appearance({ feature: h, colour, finish }); };
// explode steps (z shift = step * EXPLODE): screws -2, clip -1, base 0, lower bearing 1, coils 2 (below the stator so their leads do not pass through it), stator 3, upper bearing 4, magnets 5, bell 6, shaft 7
const dz = (k) => k * E;
const HUB_TOP = q(BELL_TOP + 2);   // prop hub stands 2 mm proud of the cap (2212: arms 28, hub 30, manufacturer drawing)
// revolve a closed (r, z) polygon about the Z axis; points are [r, z]
const rev = (pts, z0, name) => {
  P.sketch(at('top', 0), (s) => s.polygon(pts.map(([r, z]) => [r, -(z + z0)])), name);
  P.revolve(360, { axis: { from: [0, 0], to: [0, -1] } });
  return P.handle();
};
const ring = (z, ro, ri, h, name) => { P.sketch(at('front', z), (s) => { s.circle(ro); s.circle(ri); }, name); P.extrude(h); return P.handle(); };

// ---- bell (built first: its cuts must not touch the other bodies) ----
P.group('Bell', () => {
  const k = dz(6);
  const h = rev([[SHAFT_R + CLR / 2, BELL_TOP_IN - 1], [BL.hubIn, BELL_TOP_IN - 1], [BL.hubIn, BELL_TOP_IN], [BL.inR, BELL_TOP_IN], [BL.inR, BELL_Z0], [BL.r, BELL_Z0], [BL.r, BELL_TOP], [SHAFT_R + CLR / 2, BELL_TOP]], k, 'Bell profile');
  look(h, 'Bell', LOOK.bell, 'plastic');
  // cap windows (SunnySky photos): three large round windows and, between them, three smaller ones, leaving six arms; all of them break through the rim as notches
  const WB = BL.win?.big ?? { r: 4.8, at: 10.6 }, WS = BL.win?.small ?? { r: 3.4, at: 10.9 };
  P.sketch(at('front', BELL_TOP + k + 1), (s) => {
    [30, 150, 270].forEach((a) => s.circle(WB.r, [WB.at * Math.cos(rad(a)), WB.at * Math.sin(rad(a))]));
    [90, 210, 330].forEach((a) => s.circle(WS.r, [WS.at * Math.cos(rad(a)), WS.at * Math.sin(rad(a))]));
  }, 'Cap windows');
  P.cut(BELL_TOP - BELL_TOP_IN + 2, { direction: 'into' });
  // flat cap: arms flush with the rim (photos), the prop hub (dia 9) stands 2 mm proud with a recess round the shaft; the six wide windows run out through the rim as notches
  P.sketch(at('front', BELL_TOP + k), (s) => { s.circle(BL.hubR); s.circle(SHAFT_R + CLR / 2); }, 'Prop hub'); P.extrude(HUB_TOP - BELL_TOP);
  look(P.handle(), 'Bell', LOOK.bell, 'plastic');
  P.sketch(at('front', HUB_TOP + k), (s) => { s.circle(BL.recessR ?? 3.0); s.circle(SHAFT_R + CLR / 2); }, 'Shaft recess'); P.cut(1.0, { direction: 'into' });
  const PR = BL.prop ?? { size: 'M2', r: 6, within: 1.2 };
  const m2 = [60, 180, 300].map((a) => [PR.r * Math.cos(rad(a)), PR.r * Math.sin(rad(a))]), f2 = face({ normal: [0, 0, 1], at: [m2[0][0], m2[0][1], BELL_TOP + k] });
  P.holes.points(f2, m2, { size: PR.size, kind: 'tapped', depth: BL.m2Depth, name: 'Prop adapter holes ' + PR.size }); const hM2 = P.handle();
  P.chamfer(edges({ union: m2.map(([x, y]) => edges({ near: [x, y, BELL_TOP + k], within: PR.within })) }), 0.35, { name: 'Entry chamfer ' + PR.size });   // entry chamfer so the hole reads in a render
});

// ---- base: plate with pockets and spokes, bearing tube, M3 holes, lead holes ----
let BASE;
P.group('Base', () => {
  P.sketch('front', (s) => s.circle(BASE_R), 'Base plate'); P.extrude(BASE_T);
  const h = P.handle();
  P.sketch(at('front', BASE_T), (s) => s.circle(TUBE_R), 'Bearing tube'); P.extrude(TUBE_TOP - BASE_T);
  P.sketch(at('front', TUBE_TOP), (s) => s.circle(BORE_R), 'Bore'); P.cut(TUBE_TOP, { direction: 'into' });   // depth-limited: a through cut would also cut every body built before the base
  const fR = face({ normal: [0, 0, -1], at: [MOUNT_X, MOUNT_Y, 0] });
  P.holes.points(fR, [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => [a * MOUNT_X, b * MOUNT_Y]), { size: BS.mountSize ?? 'M3', kind: 'tapped', depth: BS.mountDepth ?? 2.8, name: 'Mount holes ' + (BS.mountSize ?? 'M3') });   // real hole feature, so the drawing can call it out
  const hM3 = P.handle();
  P.chamfer(edges({ union: [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => edges({ near: [a * MOUNT_X, b * MOUNT_Y, 0], within: BS.mountChWithin ?? 1.6 })) }), BS.mountCh ?? 0.4, { name: 'Entry chamfer ' + (BS.mountSize ?? 'M3') });
  // four large round lightening holes between the four tapped mount holes (SunnySky photos: tapped M3 alternate with larger round holes)
  P.sketch(at('front', BASE_T), (s) => { (BS.lightAngles ?? [0, 90, 180, 270]).forEach((a) => s.circle(BS.lightR, [BS.lightAt * Math.cos(rad(a)), BS.lightAt * Math.sin(rad(a))])); }, 'Lightening holes'); P.cut(BASE_T, { direction: 'into' });
  // wire exit: a window in the base wall for the three leads (they run radially out of it, see Wires)
  P.sketch(at('front', BASE_T), (s) => {
    const a0 = rad(BS.winA0 ?? -8), a1 = rad(BS.winA1 ?? 68), am = rad(30), p = (r, a) => [r * Math.cos(a), r * Math.sin(a)];
    s.arc3(p(BS.winOut, a0), p(BS.winOut, am), p(BS.winOut, a1)); s.line(p(BS.winOut, a1), p(BS.winIn, a1)); s.arc3(p(BS.winIn, a1), p(BS.winIn, am), p(BS.winIn, a0)); s.line(p(BS.winIn, a0), p(BS.winOut, a0));
  }, 'Wire window'); P.cut(BS.winDepth ?? 2, { direction: 'into' });
  BASE = h;
});
look(BASE, 'Base', LOOK.base, 'matte');

// ---- e-clip under the base (with its opening) ----
P.group('Retaining clip', () => {
  const z = -1.4 + dz(-1);
  const h = ring(z, Z.clipR, SHAFT_R - 0.4 + 0.05, 0.5, 'E-clip');
  look(h, 'E-clip', LOOK.clip, 'matte');
  P.sketch(at('front', z + 0.5), (s) => s.rect(Z.clipOpen?.l ?? 2.4, Z.clipOpen?.w ?? 1.6, [Z.clipOpen?.cx ?? 2.6, 0]), 'Clip opening'); P.cut(0.5, { direction: 'into' });
});

// ---- bearings 693ZZ-class (3.2 bore, 8.1 OD, 4 wide), assumed ----
// shielded ball bearing, one revolved profile: outer race, inner race, recessed shield between them; OD 8.1, bore 3.3, width 3
const mkBearing = (z, name) => rev([[BG.ri, 0], [BG.a, 0], [BG.a, BG.shield], [BG.b, BG.shield], [BG.b, 0], [q(BG.ro - BG.ch), 0], [BG.ro, BG.ch], [BG.ro, q(BG.h - BG.ch)], [q(BG.ro - BG.ch), BG.h], [BG.b, BG.h], [BG.b, q(BG.h - BG.shield)], [BG.a, q(BG.h - BG.shield)], [BG.a, BG.h], [BG.ri, BG.h]], z, name + ' profile');
if (!V.EXTERIOR) P.group('Lower bearing', () => look(mkBearing(BG.zLow + dz(1), 'Lower bearing'), 'Lower bearing', LOOK.chrome, 'chrome'));   // flush with the rear face, as in the photos
if (!V.EXTERIOR) P.group('Upper bearing', () => look(mkBearing(BG.zUp + dz(4), 'Upper bearing'), 'Upper bearing', LOOK.chrome, 'chrome'));

// ---- stator: yoke ring and 12 teeth ----
if (!V.EXTERIOR) P.group('Stator', () => {
  const z = Z_STATOR + dz(3);
  const h = ring(z, YOKE_OUT, YOKE_IN, STACK, 'Stator yoke');
  P.sketch(at('front', z), (s) => s.polygon([[ST.toothIn, -NECK], [ST.shoulderR, -NECK], [TIP_R, -TIPW], [TIP_R, TIPW], [ST.shoulderR, NECK], [ST.toothIn, NECK]]), 'Tooth'); P.extrude(STACK);
  P.circularPattern({ count: N_TEETH, axis: 'z' });
  look(h, 'Stator', LOOK.steel, 'brushed');
});

// ---- windings: a rectangular winding around each tooth; phases A, B, C every third tooth ----
const PHASES = [{ n: 'A', a: 0 }, { n: 'B', a: 30 }, { n: 'C', a: 60 }];
const coilZ0 = Z_STATOR - 0.6 + dz(2), coilZ1 = Z_STATOR + STACK + 0.6 + dz(2);
if (!V.EXTERIOR) P.group('Windings', () => PHASES.forEach((ph) => {
  const t = rad(ph.a), c = Math.cos(t), sn = Math.sin(t);
  P.workplane({ origin: [COIL_R0 * c, COIL_R0 * sn, 0], normal: [c, sn, 0], xdir: [-sn, c, 0] }); const pl = P.handle();
  const hw = NECK + CLR + COIL_T;                      // outer half width
  P.sketch(at(pl), (s) => {
    s.polygon([[-hw, coilZ0], [hw, coilZ0], [hw, coilZ1], [-hw, coilZ1]]);
    s.polygon([[-(hw - COIL_T), coilZ0 + 0.5], [hw - COIL_T, coilZ0 + 0.5], [hw - COIL_T, coilZ1 - 0.5], [-(hw - COIL_T), coilZ1 - 0.5]]);
  }, 'Coil ' + ph.n);
  P.extrude(COIL_R1 - COIL_R0);
  const seed = P.handle();                      // the pattern's copies take their look from the seed AND the pattern feature
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

// ---- shaft with a groove for the clip ----
P.group('Shaft', () => {
  const k = dz(7);
  const h = rev([[0, SHAFT_BOT], [SHAFT_R - 0.3, SHAFT_BOT], [SHAFT_R, SHAFT_BOT + 0.3], [SHAFT_R, -1.55], [SHAFT_R - 0.4, -1.55], [SHAFT_R - 0.4, -0.85], [SHAFT_R, -0.85], [SHAFT_R, SHAFT_TOP - 0.3], [SHAFT_R - 0.3, SHAFT_TOP], [0, SHAFT_TOP]], k, 'Shaft profile');
  look(h, 'Shaft', LOOK.chrome, 'chrome');
});

// ---- three phase wires, one colour each: down from the coils, then radially out through the base-wall window, gathered into one black heat-shrink sleeve with bare tips ----
const WR = Z.wire.wr, GA = 30, RE = Z.wire.re, RO = Z.wire.ro, RS = Z.wire.rs, SLEEVE_L = WK.sleeve ?? 7.5;       // lead radius, exit angle, end of the fanned segment, end of the straight segment, sleeve start and length
const eV = [Math.cos(rad(GA)), Math.sin(rad(GA))], tV = [-Math.sin(rad(GA)), Math.cos(rad(GA))];
const zf = q(BASE_T - (WK.drop ?? 1.0)) + dz(2);                                                      // height of the radial run: mid-way in the window (follows the coils when exploded)
P.group('Wires', () => [{ n: 'Yellow', a: 0, k: -1, col: LOOK.yellow }, { n: 'Blue', a: 30, k: 0, col: LOOK.blue }, { n: 'Red', a: 60, k: 1, col: LOOK.red }].forEach((w) => {
  const S = [WR * Math.cos(rad(w.a)), WR * Math.sin(rad(w.a))], E1 = [RE * eV[0] + w.k * WIRE_GAP * tV[0], RE * eV[1] + w.k * WIRE_GAP * tV[1]];
  const dx = E1[0] - S[0], dy = E1[1] - S[1], L = Math.hypot(dx, dy), zs = coilZ0 - CLR, d = [dx / L, dy / L];
  P.workplane({ origin: [S[0], S[1], 0], normal: [-d[1], d[0], 0], xdir: [d[0], d[1], 0] }); const pl = P.handle();   // path plane: sketch x = along d, sketch y = -z
  P.sweep({ on: at('front', zs), draw: (s) => s.circle(WIRE_R, S) }, { on: at(pl), draw: (s) => s.polyline([[0, -zs], [0, -zf], [L, -zf]]) });
  look(P.handle(), 'Wire ' + w.n, w.col, 'plastic');
  // straight run along the exit direction (starts a little inside the first piece so the two fuse)
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
P.group('Sleeve', () => {
  const along = WIRE_GAP + WIRE_R, stadium = (a, b) => { const pts = []; for (let i = 0; i <= 10; i++) { const t = -Math.PI / 2 + Math.PI * i / 10; pts.push([a - b + b * Math.cos(t), b * Math.sin(t)]); } for (let i = 0; i <= 10; i++) { const t = Math.PI / 2 + Math.PI * i / 10; pts.push([-(a - b) + b * Math.cos(t), b * Math.sin(t)]); } return pts; };
  P.workplane({ origin: [RS * eV[0], RS * eV[1], zf], normal: [eV[0], eV[1], 0], xdir: [tV[0], tV[1], 0] }); const sp = P.handle();
  P.sketch(at(sp), (s) => { s.polygon(stadium(along + 0.6, WIRE_R + 0.6)); s.polygon(stadium(along + 0.15, WIRE_R + 0.15)); }, 'Heat-shrink sleeve'); P.extrude(SLEEVE_L);
  look(P.handle(), 'Heat-shrink sleeve', LOOK.sleeve, 'matte');
});
// ISO 7380 button-head hex-socket screw: domed head, hex socket, threaded shank (ring grooves, no helix), chamfered tip.
// zSeat = underside of the head, dir = +1 when the shank points up (+z), -1 when it points down; R head radius, k head height, hex across flats, hd socket depth, L shank length, p pitch
const SCW = Z.screw ?? { rMaj: 1.5, R: 2.85, k: 1.65, hex: 2.0, hd: 1.0, L: 3.2, p: 0.5, zSeat: -0.3 };
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
// ---- four M3 x 3.2 mounting screws, heads below the base (accessory) ----
if (V.SCREWS) P.group('Mount screws', () => [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b], i) => {
  const h = mkScrew({ x: a * MOUNT_X, y: b * MOUNT_Y, zSeat: SCW.zSeat + dz(-2), dir: 1, rMaj: SCW.rMaj, R: SCW.R, k: SCW.k, hex: SCW.hex, hd: SCW.hd, L: SCW.L, p: SCW.p, name: 'Screw ' + (i + 1) });
  look(h, 'Mount screw ' + (BS.mountSize ?? 'M3') + ' ' + (i + 1), LOOK.screw, 'plastic');
}));

// lettering that wraps the barrel: each letter is its own 0.2 mm raised white print on a plane tangent to the bell wall at that letter, so the line follows the curve (no wrap feature exists in the kernel, so a letter is flat but it sits on its own tangent). Lines read around the barrel, left to right when seen from outside.
if (LETTERS) await (async () => {
  const k = dz(6), R = q(BL.r + 0.05), TA = TEXT_ANGLE;
  for (const ln of [{ str: 'CIVILKIT', ...Z.text[0] }, { str: V.SIZE + ' BLDC', ...Z.text[1] }]) {
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
