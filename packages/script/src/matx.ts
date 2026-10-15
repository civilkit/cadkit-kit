// The mATX tower case as a script: the parameters of the design become variables(), each component a function of the
// part builder. matxScript(only) keeps the listed component groups (used by the per-component volume check); no argument
// builds the whole case as ONE part (the lumps stay separate bodies of that part). Written from the design's description,
// re-expressed on our API. Frame: the script works in the design's frame (X depth, Y width, Z height) and bx/cyl map it to
// the app's planes (front sketch = YZ of the design, extrusions run along its X).
export const MATX_ORDER = ['rear', 'base', 'top', 'front', 'blocks', 'strips', 'hoops', 'refs', 'rivets', 'slats', 'tray', 'straps'];

const BODY = `
const V = variables({ WIDTH: 178, HEIGHT: 400, DEPTH: 310, FAN: 140, FAN_PITCH: 124.5, FAN_T: 25, TOP_T: 4, TOP_SHELF: 14,
  SLAT_W: 12, SLAT_T: 12, SLAT_N: 8, SLAT_GAP: 8, STRIP_W: 20, STRIP_T: 1.6, TUN_CLR: 0.3, TRAY_T: 4, BOSS_D: 8, BOSS_HOLE: 4,
  STANDOFF: 6.35, COMB_H: 6, COMB_RECESS: 3, FRONT_HEX_AF: 8, FRONT_HEX_WALL: 1.6, BAR_W: 20, BAR_T: 1.6, R_OUT: 20,
  PSU_W: 150, PSU_H: 86, PSU_D: 140, BOARD: 243.84, BOARD_T: 1.57, PANEL_T: 2, BASE_T: 4, CLR: 0.2, ARM: 36,
  W_OUT: 3, W_IN: 6, BLK_FLOOR: 5, RIV_D: 6, RIV_HEAD: 10, RIV_BARB: 7.2, RIV_SLOT: 1.4, HEX_AF: 14, HEX_WALL: 2.4, RIM: 10 });
const { WIDTH, HEIGHT, DEPTH, FAN, FAN_PITCH, FAN_T, TOP_T, TOP_SHELF, SLAT_W, SLAT_T, SLAT_N, SLAT_GAP, STRIP_W, STRIP_T, TUN_CLR,
  TRAY_T, BOSS_D, BOSS_HOLE, STANDOFF, COMB_H, COMB_RECESS, FRONT_HEX_AF, FRONT_HEX_WALL, BAR_W, BAR_T, R_OUT, PSU_W, PSU_H, PSU_D,
  BOARD, BOARD_T, PANEL_T, BASE_T, CLR, ARM, W_OUT, W_IN, BLK_FLOOR, RIV_D, RIV_HEAD, RIV_BARB, RIV_SLOT, HEX_AF, HEX_WALL, RIM } = V;
const hx = DEPTH / 2, hy = WIDTH / 2, hz = HEIGHT / 2;
const REAR_X = -hx, FRONT_X = hx - BAR_W, FLOOR_Z = -hz + R_OUT, PLATE_HY = PSU_W / 2 + 0.5;
const PLATE_X0 = REAR_X - BLK_FLOOR + 2, PLATE_X1 = FRONT_X + BAR_W + BLK_FLOOR - 2;
const STRIP_X0 = REAR_X - BLK_FLOOR, STRIP_X1 = FRONT_X + BAR_W + BLK_FLOOR;
const REAR_PANEL_X = REAR_X + BAR_W / 2, PSU_X0 = REAR_PANEL_X + PANEL_T, PSU_TOP = FLOOR_Z + BASE_T + PSU_H;
const BOARD_Y = -hy + BAR_T + 34, BOARD_Z0 = PSU_TOP + 10, TOP_Z = hz + W_OUT - TOP_T;
const FP_X = FRONT_X + BAR_W - PANEL_T - 0.5, SLAT_X = hx + 1.5, FAN_Z = -30;
const COMB_Y = hy - BAR_T - CLR - W_IN - 1.2, COMB_Z = hz - R_OUT - ARM - 8 - COMB_H, SLAT_TOP = hz - R_OUT - W_OUT - 3;
const pitch = SLAT_W + SLAT_GAP, slatYs = [];
for (let i = 0; i < SLAT_N; i++) { slatYs.push((i - (SLAT_N - 1) / 2) * pitch); }
const P = part('mATX case');
// a cut runs against the sketch normal unless flipped; the script always means 'along the extrusion axis'
const CUT = (d) => P.cut(d, { flip: true });
const run = (op, d) => (op === 'cut' ? CUT(d) : P.extrude(d));
// box with its minimum corner at (x, y, z), sizes l (X), w (Y), h (Z)
const bx = (x, y, z, l, w, h, op) => { P.sketch(at('front', x), (s) => s.rect(w, h, [y + w / 2, z + h / 2])); run(op, l); };
// cylinder along X from x, along Z (height) from z
const cylX = (x, y, z, r, l, op) => { P.sketch(at('front', x), (s) => s.circle(r, [y, z])); run(op, l); };
const cylZ = (list, z, r, l, op) => { P.sketch(at('top', z), (s) => { list.forEach((c) => s.circle(r, [c[1], -c[0]])); }); run(op, l); };
// the hoop's rounded-rectangle outline, offset d outside the bar's outer face
const rr = (s, d) => s.rrect(WIDTH + 2 * d, HEIGHT + 2 * d, Math.max(R_OUT + d, 0.05));
// hexagon (circumradius rc, pointy along the first axis) at c; f maps local (x, y) to the sketch
const hexAt = (s, c, rc, f) => { const pts = []; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; pts.push(f(c[0] + rc * Math.cos(a), c[1] + rc * Math.sin(a))); } s.polygon(pts); };
// honeycomb cell centres filling x0..x1, y0..y1 (cells fully inside), skipping cells that touch a keep box [x0, y0, x1, y1]
const cells = (af, wall, x0, y0, x1, y1, keep) => {
  const pt = af + wall, rc = af / Math.sqrt(3), out = [];
  let col = 0;
  for (let x = x0 + rc; x + rc <= x1 + 1e-9; x += 1.5 * rc) {
    for (let y = y0 + af / 2 + (col % 2 ? pt / 2 : 0); y + af / 2 <= y1 + 1e-9; y += pt) {
      let ok = true;
      keep.forEach((k) => { if (!(x + rc < k[0] || x - rc > k[2] || y + af / 2 < k[1] || y - af / 2 > k[3])) ok = false; });
      if (ok) out.push([x, y]);
    }
    col++;
  }
  return out;
};
// the profile of a corner block (quarter band plus the two arms) in the plane of the hoop: a, b are the outward directions
const blockProfile = (s, sy, sz) => {
  const cy = sy * (hy - R_OUT), cz = sz * (hz - R_OUT), Ro = R_OUT + W_OUT, Ri = R_OUT - BAR_T - CLR - W_IN, k = Math.SQRT1_2;
  const f = (a, b) => [cy + sy * a, cz + sz * b];
  s.line(f(Ro, -ARM), f(Ro, 0)); s.arc3(f(Ro, 0), f(Ro * k, Ro * k), f(0, Ro)); s.line(f(0, Ro), f(-ARM, Ro)); s.line(f(-ARM, Ro), f(-ARM, Ri));
  s.line(f(-ARM, Ri), f(0, Ri)); s.arc3(f(0, Ri), f(Ri * k, Ri * k), f(Ri, 0)); s.line(f(Ri, 0), f(Ri, -ARM)); s.line(f(Ri, -ARM), f(Ro, -ARM));
};
const grooveProfile = (s, sy, sz) => {
  const cy = sy * (hy - R_OUT), cz = sz * (hz - R_OUT), Ro = R_OUT + CLR, Ri = R_OUT - BAR_T - CLR, k = Math.SQRT1_2;
  const f = (a, b) => [cy + sy * a, cz + sz * b];
  s.line(f(Ro, -ARM - 3), f(Ro, 0)); s.arc3(f(Ro, 0), f(Ro * k, Ro * k), f(0, Ro)); s.line(f(0, Ro), f(-ARM - 3, Ro)); s.line(f(-ARM - 3, Ro), f(-ARM - 3, Ri));
  s.line(f(-ARM - 3, Ri), f(0, Ri)); s.arc3(f(0, Ri), f(Ri * k, Ri * k), f(Ri, 0)); s.line(f(Ri, 0), f(Ri, -ARM - 3)); s.line(f(Ri, -ARM - 3), f(Ro, -ARM - 3));
};
const blockX = (x0) => (x0 === REAR_X ? [x0 - BLK_FLOOR, x0 + BAR_W + CLR] : [x0 - CLR, x0 + BAR_W + BLK_FLOOR]);
// the solid parts of a block (op add) or the same shape as a cutter (op cut)
const blockBody = (x0, sy, sz, op) => {
  const [xa, xb] = blockX(x0), cy = sy * (hy - R_OUT);
  P.sketch(at('front', xa), (s) => blockProfile(s, sy, sz)); run(op, xb - xa);
  if (sz < 0) {
    if (op === 'add') bx(xa, sy > 0 ? cy - 30 : cy, -hz - W_OUT - 4, xb - xa, 30, 4, op);   // (as a cutter only the parts that reach the panel)
    const yin = sy * (hy - BAR_T - CLR - W_IN), ylen = ARM + (R_OUT - BAR_T - CLR - W_IN), ys = Math.min(yin, yin - sy * ylen);
    bx(xa, sy < 0 ? ys : ys - 0.5, FLOOR_Z - 3, xb - xa, ylen + 0.5, 3, op);
    const rz0 = -hz + BAR_T + CLR + W_IN - 0.5, ry = sy < 0 ? ys + ylen - 3 : ys;
    bx(xa, ry, rz0, xb - xa, 3, FLOOR_Z - rz0, op);
  } else if (op === 'add') {
    const face = x0 === REAR_X ? xb : xa, sx0 = x0 === REAR_X ? face : face - TOP_SHELF, sy0 = sy < 0 ? cy : cy - ARM;
    bx(sx0, sy0, TOP_Z - 3, TOP_SHELF, ARM, 3, op);
    const ax0 = x0 === REAR_X ? face - 1 : face - 2;
    bx(ax0, sy0, hz - BAR_T - CLR - 4.5, 3, ARM, 4, op);
  }
};
const pegs = [], topPegs = [];
[REAR_X, FRONT_X].forEach((x0) => { [-1, 1].forEach((sy) => {
  const [xa] = blockX(x0), cy = sy * (hy - R_OUT);
  pegs.push([xa + RIV_HEAD / 2 + 1, cy - sy * ARM / 2]);
  const face = x0 === REAR_X ? blockX(x0)[1] : blockX(x0)[0];
  topPegs.push([x0 === REAR_X ? face + TOP_SHELF / 2 : face - TOP_SHELF / 2, cy - sy * (STRIP_W + 6)]);
}); });
const stripBoxes = [];
[-1, 1].forEach((sy) => { [-1, 1].forEach((sz) => {
  const cy = sy * (hy - R_OUT), tz = sz * (hz - BAR_T - CLR - 2 - TUN_CLR);
  stripBoxes.push([Math.min(cy, cy - sy * STRIP_W), Math.min(tz, tz - sz * STRIP_T)]);
}); });
const notches = (x0, x1, withBlocks, blocksX) => {
  if (withBlocks) { blocksX.forEach((bxx) => { [-1, 1].forEach((sy) => { [-1, 1].forEach((sz) => { blockBody(bxx, sy, sz, 'cut'); }); }); }); }
  // (the strips' notches lie inside the blocks' arms already: a cut that removes nothing would stop the regeneration)
  bx(PLATE_X0 - 1, -PLATE_HY - 0.3, FLOOR_Z - 0.15, PLATE_X1 - PLATE_X0 + 2, 2 * PLATE_HY + 0.6, BASE_T + 0.3, 'cut');
};
const C = {};
C.rear = () => {
  P.sketch(at('front', REAR_PANEL_X), (s) => s.rrect(WIDTH - 2 * (BAR_T + CLR + 0.5), HEIGHT - 2 * (BAR_T + CLR + 0.5), R_OUT - BAR_T - CLR - 0.5)).extrude(PANEL_T);
  bx(REAR_PANEL_X, -PSU_W / 2 + 2, FLOOR_Z + BASE_T + 2, PANEL_T, PSU_W - 4, PSU_H - 4, 'cut');
  bx(REAR_PANEL_X, BOARD_Y + BOARD_T, BOARD_Z0 + 243.84 - 23.62 - 158.75, PANEL_T, 44.45, 158.75, 'cut');
  notches(0, 0, true, [REAR_X]);
};
C.base = () => {
  bx(PLATE_X0, -PLATE_HY, FLOOR_Z, PLATE_X1 - PLATE_X0, 2 * PLATE_HY, BASE_T);
  const PAD = 22, X0 = PSU_X0, keep = [[X0, -PSU_W / 2, X0 + PAD, -PSU_W / 2 + PAD], [X0, PSU_W / 2 - PAD, X0 + PAD, PSU_W / 2],
    [X0 + PSU_D - PAD, -PSU_W / 2, X0 + PSU_D, -PSU_W / 2 + PAD], [X0 + PSU_D - PAD, PSU_W / 2 - PAD, X0 + PSU_D, PSU_W / 2]];
  const cs = cells(HEX_AF, HEX_WALL, PLATE_X0 + RIM, -PLATE_HY + RIM, PLATE_X1 - RIM, PLATE_HY - RIM, keep), rc = HEX_AF / Math.sqrt(3);
  P.sketch(at('top', FLOOR_Z - 1), (s) => { cs.forEach((c) => hexAt(s, c, rc, (x, y) => [y, -x])); }); CUT(BASE_T + 2);
  cylZ(pegs, FLOOR_Z - 1, RIV_D / 2 + 0.15, BASE_T + 2, 'cut');
};
C.top = () => {
  const TP_X0 = REAR_X + BAR_W + BLK_FLOOR + 0.3, TP_X1 = FRONT_X - CLR - 0.3, cy = hy - R_OUT, cz = hz - R_OUT, k = Math.SQRT1_2;
  const Ro = R_OUT + W_OUT, Ri = R_OUT + W_OUT - TOP_T;
  P.sketch(at('front', TP_X0), (s) => {
    s.arc3([cy + Ro, cz], [cy + Ro * k, cz + Ro * k], [cy, cz + Ro]); s.line([cy, cz + Ro], [-cy, cz + Ro]);
    s.arc3([-cy, cz + Ro], [-cy - Ro * k, cz + Ro * k], [-cy - Ro, cz]); s.line([-cy - Ro, cz], [-cy - Ri, cz]);
    s.arc3([-cy - Ri, cz], [-cy - Ri * k, cz + Ri * k], [-cy, cz + Ri]); s.line([-cy, cz + Ri], [cy, cz + Ri]);
    s.arc3([cy, cz + Ri], [cy + Ri * k, cz + Ri * k], [cy + Ri, cz]); s.line([cy + Ri, cz], [cy + Ro, cz]);
  }).extrude(TP_X1 - TP_X0);
  cylZ(topPegs, TOP_Z - 1, RIV_D / 2 + 0.15, TOP_T + 2, 'cut');
  const keep = topPegs.map((p) => [p[0] - 8, p[1] - 8, p[0] + 8, p[1] + 8]);
  const cs = cells(FRONT_HEX_AF, FRONT_HEX_WALL, TP_X0 + RIM, -cy + 4, TP_X1 - RIM, cy - 4, keep), rc = FRONT_HEX_AF / Math.sqrt(3);
  P.sketch(at('top', TOP_Z - 1), (s) => { cs.forEach((c) => hexAt(s, c, rc, (x, y) => [y, -x])); }); CUT(TOP_T + 2);
};
C.front = () => {
  const ioItems = [['rect', 13.6, 6.2], ['rect', 13.6, 6.2], ['rect', 9.6, 4.2], ['round', 16.2, 16.2]], IO_GAP = 10;
  const total = ioItems.reduce((a, it) => a + it[1], 0) + IO_GAP * 3, IO_Z = hz - BAR_T - CLR - W_IN - 8.5, keep = [];
  P.sketch(at('front', FP_X), (s) => s.rrect(WIDTH - 2 * (BAR_T + CLR + 0.5), HEIGHT - 2 * (BAR_T + CLR + 0.5), R_OUT - BAR_T - CLR - 0.5)).extrude(PANEL_T);
  notches(0, 0, true, [FRONT_X]);
  let yy = -total / 2;
  ioItems.forEach((it) => {
    const y = yy + it[1] / 2; yy += it[1] + IO_GAP;
    if (it[0] === 'round') { cylX(FP_X, y, IO_Z, it[1] / 2, PANEL_T, 'cut'); } else { bx(FP_X, y - it[1] / 2, IO_Z - it[2] / 2, PANEL_T, it[1], it[2], 'cut'); }
    keep.push([y - it[1] / 2 - 4, IO_Z - it[2] / 2 - 4, y + it[1] / 2 + 4, IO_Z + it[2] / 2 + 4]);
  });
  P.sketch(at('front', FP_X), (s) => { [-1, 1].forEach((a) => { [-1, 1].forEach((b) => { s.circle(2.2, [a * FAN_PITCH / 2, FAN_Z + b * FAN_PITCH / 2]); }); }); }); CUT(PANEL_T);
  [-1, 1].forEach((a) => { [-1, 1].forEach((b) => { keep.push([a * FAN_PITCH / 2 - 6, FAN_Z + b * FAN_PITCH / 2 - 6, a * FAN_PITCH / 2 + 6, FAN_Z + b * FAN_PITCH / 2 + 6]); }); });
  keep.push([-COMB_Y - 1, COMB_Z - 3, COMB_Y + 1, COMB_Z + COMB_H + 3], [-COMB_Y - 1, -COMB_Z - COMB_H - 3, COMB_Y + 1, -COMB_Z + 3]);
  const e = hy - BAR_T - CLR - W_IN - RIM, f = hz - R_OUT - ARM - RIM, rc = FRONT_HEX_AF / Math.sqrt(3);
  const cs = cells(FRONT_HEX_AF, FRONT_HEX_WALL, -e, -f, e, f, keep);
  P.sketch(at('front', FP_X), (s) => { cs.forEach((c) => hexAt(s, c, rc, (x, y) => [x, y])); }); CUT(PANEL_T);
  [COMB_Z, -COMB_Z - COMB_H].forEach((z0) => {
    bx(FP_X, -COMB_Y, z0, SLAT_X + SLAT_T - COMB_RECESS - FP_X, 2 * COMB_Y, COMB_H);
    P.sketch(at('front', SLAT_X - 0.1), (s) => { slatYs.forEach((y) => s.rect(SLAT_W + 0.02, COMB_H + 2, [y, z0 + COMB_H / 2])); }); CUT(SLAT_T + 1);
  });
};
C.blocks = () => {
  [REAR_X, FRONT_X].forEach((x0) => { [-1, 1].forEach((sy) => { [-1, 1].forEach((sz) => {
    blockBody(x0, sy, sz, 'add');
    const [xa, xb] = blockX(x0), gx = x0 === REAR_X ? [x0 - CLR, xb + 1] : [xa - 1, x0 + BAR_W + CLR];
    P.sketch(at('front', gx[0]), (s) => grooveProfile(s, sy, sz)); CUT(gx[1] - gx[0]);
    const cy = sy * (hy - R_OUT), tz = sz * (hz - BAR_T - CLR - 2), tz0 = Math.min(tz, tz - sz * (STRIP_T + 2 * TUN_CLR)), ty0 = Math.min(cy, cy - sy * (STRIP_W + 2 * TUN_CLR));
    bx(xa - 1, ty0, tz0, xb - xa + 2, STRIP_W + 2 * TUN_CLR, STRIP_T + 2 * TUN_CLR, 'cut');
  }); }); });
  cylZ(pegs, FLOOR_Z - 6, RIV_D / 2 + 0.15, 10, 'cut');
  cylZ(topPegs, TOP_Z - 6, RIV_D / 2 + 0.15, 10, 'cut');
};
C.strips = () => { stripBoxes.forEach((q) => bx(STRIP_X0, q[0], q[1], STRIP_X1 - STRIP_X0, STRIP_W, STRIP_T)); };
C.hoops = () => { [REAR_X, FRONT_X].forEach((x0) => { P.sketch(at('front', x0), (s) => { rr(s, 0); rr(s, -BAR_T); }).extrude(BAR_W); }); };
C.refs = () => {
  bx(PSU_X0, -PSU_W / 2, FLOOR_Z + BASE_T, PSU_D, PSU_W, PSU_H);
  bx(PSU_X0, BOARD_Y, BOARD_Z0, BOARD, BOARD_T, BOARD);
  bx(FP_X - FAN_T - 0.5, -FAN / 2, FAN_Z - FAN / 2, FAN_T, FAN, FAN);
  cylX(FP_X - FAN_T - 1.5, 0, FAN_Z, FAN / 2 - 2, FAN_T + 2, 'cut');
};
C.rivets = () => {
  const one = (px, py, zt, grip) => {
    cylZ([[px, py]], zt, RIV_HEAD / 2, 2);
    cylZ([[px, py]], zt - grip - 3, RIV_D / 2, grip + 3);
    bx(px - RIV_HEAD / 2 - 1, py - RIV_SLOT / 2, zt - grip - 3.5, RIV_HEAD + 2, RIV_SLOT, grip + 2, 'cut');
  };
  pegs.forEach((p) => one(p[0], p[1], FLOOR_Z + BASE_T, BASE_T + 3));
  topPegs.forEach((p) => one(p[0], p[1], TOP_Z + TOP_T, BASE_T + 3));
};
C.slats = () => { slatYs.forEach((y) => bx(SLAT_X, y - SLAT_W / 2, -SLAT_TOP, SLAT_T, SLAT_W, 2 * SLAT_TOP)); };
C.tray = () => {};
C.straps = () => {};
const ONLY = null;
const ORDER = ${JSON.stringify(MATX_ORDER)};
ORDER.forEach((k) => { if (!ONLY || ONLY.indexOf(k) >= 0) { C[k](); } });
`;

/** The script text; `only` keeps just the listed component groups (see MATX_ORDER). */
export function matxScript(only?: string[]): string {
  const code = BODY.replace('const ONLY = null;', `const ONLY = ${only ? JSON.stringify(only) : 'null'};`);
  return `// mATX tower case (FreeCAD design re-expressed): X depth, Y width, Z height; all dimensions are variables\n${code.trim()}\n`;
}
