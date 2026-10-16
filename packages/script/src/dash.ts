// Speedboat analog dash cluster as a script: a 380 x 150 curved-top plate with a rolled binnacle lip, four chrome-bezelled
// gauges (tach, knots, oil, water temperature), dial plates with tick ridges, red-zone inlays, tapered needles, centre caps,
// domed glass, countersunk screws, a nameplate with two rivets and two warning lamps. Every material is its own lump of ONE
// part (0.1 mm clearances stand for the adhesive / press fit), so a viewer can colour them. All dimensions are variables().
// Frame: X across, Y up, Z out of the panel (the panel's back is z = 0). dashScript(opts) keeps the listed groups for
// development (see DASH_GROUPS); no argument builds everything.
export const DASH_GROUPS = ['panel', 'gauges', 'details', 'bezel', 'profile'];   // 'bezel' alone: one bare bezel; 'profile': the bezel's rolled section as a thin extruded plate (for drawings)

const BODY = `
const V = variables({ W: 380, H: 150, T: 6, CROWN: 8, R_CORNER: 12, RIM_W: 6, RIM_H: 1.5, RIM_ROLL: 2,
  BIG: 85, SMALL: 52, GAP: 4, GY: 10, CLR: 0.1, TICK_H: 0.3, NEEDLE_T: 0.7, SWEEP: 270, START: 225,
  PLATE_W: 92, PLATE_H: 16, LAMP_D: 16, LAMP_X: 84, SCREW_D: 3.2 });
const { W, H, T, CROWN, R_CORNER, RIM_W, RIM_H, RIM_ROLL, BIG, SMALL, GAP, GY, CLR, TICK_H, NEEDLE_T, SWEEP, START, PLATE_W, PLATE_H, LAMP_D, LAMP_X, SCREW_D } = V;
const ONLY = null;
const LENS = true;
const P = part('Speedboat dash cluster');
const rad = (d) => d * Math.PI / 180;
const FIELD = T - RIM_H;                       // recessed instrument field (z)
const ZB = FIELD + CLR;                        // underside of every bezel flange
const hw = W / 2, hh = H / 2;
const RTOP = (hw * hw + CROWN * CROWN) / (2 * CROWN);   // radius of the curved top edge (crown at x = 0)
const CCY = hh - RTOP;                                   // its centre (y)
// the panel outline inset by d with corner radius r: bottom/sides straight, top a concentric arc
const outline = (s, d, r) => {
  const R = RTOP - d, x = hw - d, cxx = x - r, ccy = Math.sqrt((R - r) * (R - r) - cxx * cxx) + CCY;
  const ta = (sx) => { const k = R / (R - r); return [sx * cxx * k, CCY + (ccy - CCY) * k]; };   // tangent point on the top arc
  const by = -hh + d, tl = ta(-1), tr = ta(1), m = (c, a, b) => { const u = [a[0] + b[0] - 2 * c[0], a[1] + b[1] - 2 * c[1]], n = Math.hypot(u[0], u[1]); return [c[0] + u[0] / n * r, c[1] + u[1] / n * r]; };
  const cBR = [cxx, by + r], cBL = [-cxx, by + r], cTR = [cxx, ccy], cTL = [-cxx, ccy];
  s.line([-cxx, by], [cxx, by]);
  s.arc3([cxx, by], m(cBR, [cxx, by], [x, by + r]), [x, by + r]);
  s.line([x, by + r], [x, ccy]);
  s.arc3([x, ccy], m(cTR, [x, ccy], tr), tr);
  s.arc3(tr, [0, CCY + R], tl);
  s.arc3(tl, m(cTL, tl, [-x, ccy]), [-x, ccy]);
  s.line([-x, ccy], [-x, by + r]);
  s.arc3([-x, by + r], m(cBL, [-x, by + r], [-cxx, by]), [-cxx, by]);
};
const topY = (x) => CCY + Math.sqrt(RTOP * RTOP - x * x);   // top edge height at x
// instrument layout: the two big gauges side by side at the centre, the small ones outboard
const RB = BIG / 2 + 8, RS = SMALL / 2 + 8;
const XB = RB + GAP / 2, XS = XB + RB + GAP + RS;
const G = [
  { n: 'tach', x: -XB, y: GY, g: BIG, lo: 0, hi: 80, major: 10, minor: 2, red: 60, v: 32 },
  { n: 'knots', x: XB, y: GY, g: BIG, lo: 0, hi: 60, major: 10, minor: 2, red: 0, v: 28 },
  { n: 'oil', x: -XS, y: GY, g: SMALL, lo: 0, hi: 100, major: 20, minor: 5, red: 0, v: 55 },
  { n: 'temp', x: XS, y: GY, g: SMALL, lo: 100, hi: 250, major: 30, minor: 5, red: 210, v: 180 },
];
const PLATE_Y = -hh + 22, PLATE_RECESS = 1.2;
const LAMPS = [[-LAMP_X, PLATE_Y], [LAMP_X, PLATE_Y]];
const SCREWS = [[-hw + 11, hh - 20], [hw - 11, hh - 20], [-hw + 11, -hh + 17], [hw - 11, -hh + 17], [-120, -hh + 15], [120, -hh + 15]];
const TUBE = (g) => g / 2 + 3.5;
// ---- panel ----
const panel = () => P.group('Panel', () => {
  P.sketch('front', (s) => outline(s, 0, R_CORNER), 'Panel').extrude(T);
  P.sketch(at('front', T), (s) => outline(s, RIM_W, Math.max(R_CORNER - RIM_W, 2)), 'Rim recess').cut(RIM_H, { direction: 'into' });
  P.fillet(edges({ onFace: face({ normal: [0, 0, 1], at: [0, 0, T] }), outside: [[-hw + 2, -hh + 2, -1], [hw - 2, hh - 2, T + 1]] }), { radius: RIM_ROLL, name: 'Rim roll' });
});
// ---- revolve helpers: a gauge is revolved about the Z axis through (cx, cy); local z is measured up from the bezel flange underside ----
// path items: [r, z] = line to that point, ['a', [rm, zm], [r, z]] = arc through rm, zm; the path closes itself
const rev = (cx, cy, items, z0 = ZB, name) => {
  P.sketch(at('top', cy), (s) => {
    const f = (q) => [cx + q[0], -(z0 + q[1])];
    let cur = items[0];
    items.slice(1).concat([items[0]]).forEach((it) => {
      if (it[0] === 'a') { s.arc3(f(cur), f(it[1]), f(it[2])); cur = it[2]; } else { s.line(f(cur), f(it)); cur = it; }
    });
  }, name);
  P.revolve(360, { axis: { from: [cx, 0], to: [cx, -1] } });
};
// midpoint of the dome arc from (rb, z0) up to the apex (0, z0 + h)
const dome = (rb, z0, h) => {
  const Rs = (rb * rb + h * h) / (2 * h), zc = z0 + h - Rs, a0 = Math.atan2(z0 - zc, rb), a = (a0 + Math.PI / 2) / 2;
  return [Rs * Math.cos(a), zc + Rs * Math.sin(a)];
};
const rim45 = (cr, cz, r) => [cr + r * Math.SQRT1_2, cz + r * Math.SQRT1_2];
const rimLow = (cr, cz, r) => [cr + r * Math.SQRT1_2, cz - r * Math.SQRT1_2];   // lower right quarter (the foot's roll)
// chrome bezel profile: through-tube, 2 mm rolled foot, R3 rolled crown, glass rebate, ledge that holds the dial
const bezelPath = (g) => {
  const r = g / 2, Ro = r + 8, Rt = TUBE(g), Rb = r + 0.2, Rl = r + 1;
  return [[Rb, -8], [Rt, -8], [Rt, 0], [Ro - 2, 0], ['a', rimLow(Ro - 2, 2, 2), [Ro, 2]], [Ro, 6],
    ['a', rim45(Ro - 3, 6, 3), [Ro - 3, 9]], [Rl + 1.6, 9], [Rl + 0.1, 7.9], [Rl + 0.1, 7.5], [r - 1.5, 7.5], [r - 1.5, 4], [Rb, 4]];
};
// ---- one gauge ----
const gauge = (d) => P.group(d.n[0].toUpperCase() + d.n.slice(1) + ' gauge', () => {
  const GN = d.n[0].toUpperCase() + d.n.slice(1);
  const { x: cx, y: cy, g } = d, r = g / 2, Ro = r + 8, Rt = TUBE(g), Rb = r + 0.2, Rl = r + 1;
  const DZ0 = 2, DZ1 = 3.9;                                             // dial plate (local z)
  const ang = (v) => START - SWEEP * (v - d.lo) / (d.hi - d.lo);        // degrees, 0 = +X, counter-clockwise
  const pt = (rr, v) => [cx + rr * Math.cos(rad(ang(v))), cy + rr * Math.sin(rad(ang(v)))];
  rev(cx, cy, bezelPath(g), ZB, GN + ' bezel');
  P.sketch(at('front', ZB + DZ0), (s) => s.circle(r, [cx, cy]), GN + ' dial'); P.extrude(DZ1 - DZ0);
  // tick ridges: one sketch of thin rotated rectangles (major long, minor short)
  const quad = (v, r1, r2, hw2) => { const a = rad(ang(v)), c = Math.cos(a), sn = Math.sin(a), q = (rr, w) => [cx + rr * c - w * sn, cy + rr * sn + w * c]; return [q(r1, -hw2), q(r2, -hw2), q(r2, hw2), q(r1, hw2)]; };
  const ticks = [];
  for (let v = d.lo; v <= d.hi + 1e-6; v += d.minor) { const maj = Math.abs((v - d.lo) / d.major - Math.round((v - d.lo) / d.major)) < 1e-6; ticks.push(maj ? quad(v, r - 10.5, r - 5.5, 0.8) : quad(v, r - 8, r - 5.5, 0.4)); }
  P.sketch(at('front', ZB + DZ1), (s) => { ticks.forEach((q) => s.polygon(q)); }, GN + ' ticks'); P.extrude(TICK_H);
  // red zone: a groove in the dial and a separate inlay band in it
  if (d.red) {
    const sector = (a0, a1, ri, ro) => (s) => { const am = (a0 + a1) / 2, p = (rr, a) => [cx + rr * Math.cos(rad(a)), cy + rr * Math.sin(rad(a))];
      s.arc3(p(ro, a0), p(ro, am), p(ro, a1)); s.line(p(ro, a1), p(ri, a1)); s.arc3(p(ri, a1), p(ri, am), p(ri, a0)); s.line(p(ri, a0), p(ro, a0)); };
    const a0 = ang(d.red), a1 = ang(d.hi), ri = r - 4.5, ro = r - 2.5, da = (0.12 / ro) * 180 / Math.PI;
    P.sketch(at('front', ZB + DZ1), sector(a0, a1, ri, ro), GN + ' red zone groove'); P.cut(0.5, { direction: 'into' });
    P.sketch(at('front', ZB + DZ1 - 0.4), sector(a0 - da, a1 + da, ri + CLR, ro - CLR), GN + ' red zone inlay'); P.extrude(0.45);
  }
  // needle: tapered blade with a counterweight tail, hub boss on top
  const a = rad(ang(d.v)), c = Math.cos(a), sn = Math.sin(a), L = r - 7, nz = ZB + DZ1 + 0.5;
  const nd = [[L, -0.25], [L, 0.25], [0, 1.6], [-4, 1.2], [-7, 2.6], [-11, 2.6], [-12.5, 1.6], [-12.5, -1.6], [-11, -2.6], [-7, -2.6], [-4, -1.2], [0, -1.6]].map((q) => [cx + q[0] * c - q[1] * sn, cy + q[0] * sn + q[1] * c]);
  P.sketch(at('front', nz), (s) => s.polygon(nd), GN + ' needle'); P.extrude(NEEDLE_T);
  P.sketch(at('front', nz + NEEDLE_T), (s) => s.circle(3.2, [cx, cy]), GN + ' needle hub'); P.extrude(0.5);
  // domed centre cap
  const cz = DZ1 + 0.5 + NEEDLE_T + 0.5 + CLR;
  rev(cx, cy, [[0, cz], [5, cz], ['a', dome(5, cz, 2.2), [0, cz + 2.2]]], ZB, GN + ' cap');
  // thin domed glass: concentric inner / outer spheres, 1.5 mm thick, proud of the bezel
  const zi = 7.5 + CLR, hi = 1.2, Rsi = (Rl * Rl + hi * hi) / (2 * hi), zc = zi + hi - Rsi, Rso = Rsi + 1.5, za = zc + Math.sqrt(Rso * Rso - Rl * Rl);
  const mid = (Rs, zz) => { const a0 = Math.atan2(zz - zc, Rl), am = (a0 + Math.PI / 2) / 2; return [Rs * Math.cos(am), zc + Rs * Math.sin(am)]; };
  if (LENS) { rev(cx, cy, [[0, zi + hi], ['a', mid(Rsi, zi), [Rl, zi]], [Rl, za], ['a', mid(Rso, za), [0, zc + Rso]]], ZB, GN + ' lens'); }
});
const panelHoles = () => P.group('Panel', () => {
  P.sketch(at('front', T), (s) => { G.forEach((d) => s.circle(TUBE(d.g) + 0.2, [d.x, d.y])); LAMPS.forEach((l) => s.circle(LAMP_D / 2 - 1.8 + 0.2, l)); }, 'Gauge and lamp openings'); P.cut(through(), { direction: 'into' });
  P.sketch(at('front', FIELD), (s) => s.rrect(PLATE_W, PLATE_H, 2, [0, PLATE_Y]), 'Nameplate recess'); P.cut(PLATE_RECESS, { direction: 'into' });
  P.holes.points(face({ normal: [0, 0, 1], at: [0, 0, FIELD] }), SCREWS, { kind: 'csk', size: 'M3', name: 'Screw holes' });
});
// ---- details: countersunk screws, nameplate with two rivets, two warning lamps ----
const details = () => {
  P.group('Screws', () => { SCREWS.forEach((q, i) => { rev(q[0], q[1], [[0, FIELD + 0.2], [3, FIELD + 0.2], [1.5, FIELD - 1.3], [1.5, 0.6], [0, 0.6]], 0, 'Screw ' + (i + 1)); }); });
  const pz = FIELD - PLATE_RECESS + CLR;
  P.group('Nameplate', () => {
    P.sketch(at('front', pz), (s) => s.rrect(PLATE_W - 0.4, PLATE_H - 0.4, 1.8, [0, PLATE_Y]), 'Nameplate'); P.extrude(PLATE_RECESS - CLR + 0.2);
    [-1, 1].forEach((sg, i) => { rev(sg * (PLATE_W / 2 - 5), PLATE_Y, [[0, FIELD + 0.2 + CLR], [1.8, FIELD + 0.2 + CLR], ['a', dome(1.8, FIELD + 0.2 + CLR, 1), [0, FIELD + 1.2 + CLR]]], 0, 'Rivet ' + (i + 1)); });
  });
  P.group('Warning lamps', () => { LAMPS.forEach((l, i) => {
    const Ro = LAMP_D / 2, Ri = Ro - 4.2;
    rev(l[0], l[1], [[Ri, -6], [Ro - 1.8, -6], [Ro - 1.8, 0], [Ro - 1, 0], ['a', rimLow(Ro - 1, 1, 1), [Ro, 1]], [Ro, 2], ['a', rim45(Ro - 1.5, 2, 1.5), [Ro - 1.5, 3.5]], [Ri, 3.5]], ZB, 'Lamp ' + (i + 1) + ' bezel');
    rev(l[0], l[1], [[0, 0.5], [Ri - 0.2, 0.5], [Ri - 0.2, 1.8], ['a', dome(Ri - 0.2, 1.8, 1.8), [0, 3.6]]], ZB, 'Lamp ' + (i + 1) + ' lens');
  }); });
};
const ORDER = ['panel', 'gauges', 'details'];
const DO = { profile: () => { P.sketch('front', (s) => { let cur = null; bezelPath(BIG).concat([bezelPath(BIG)[0]]).forEach((it) => { const to = it[0] === 'a' ? it[2] : it; if (cur) { if (it[0] === 'a') { s.arc3(cur, it[1], it[2]); } else { s.line(cur, it); } } cur = to; }); }); P.extrude(0.5); },
  bezel: () => { rev(0, 0, bezelPath(BIG)); }, panel: () => { panel(); panelHoles(); }, gauges: () => { G.forEach(gauge); }, details: () => { details(); } };
ORDER.concat(['bezel', 'profile']).forEach((k) => { if (ONLY ? ONLY.indexOf(k) >= 0 : k !== 'bezel' && k !== 'profile') { DO[k](); } });
`;

/** The script text; `only` keeps just the listed groups (see DASH_GROUPS). */
export function dashScript(opts: { only?: string[]; lens?: boolean } = {}): string {
  const code = BODY.replace('const ONLY = null;', `const ONLY = ${opts.only ? JSON.stringify(opts.only) : 'null'};`).replace('const LENS = true;', `const LENS = ${opts.lens === false ? 'false' : 'true'};`);
  return `// Speedboat analog dash cluster: 4 gauges, curved plate, all dimensions are variables\n${code.trim()}\n`;
}
