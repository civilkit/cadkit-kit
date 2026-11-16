// Spike: turn the feature records quiddity recognises in a STEP file (https://github.com/pzfreo/quiddity, Apache-2.0) into a kit script.
// It is a pure function of quiddity's JSON (`quiddity part.step`): no quiddity code is linked or vendored.
//
//   convert(quiddityJson) -> { script, handled: [ids], skipped: [{id, why, code, family}], base: {min, max, volume} | null }
//
// What it rebuilds: the stock box (from the body_key some records carry), vertical-edge fillets at the stock's corners, holes (through and blind;
// counterbore / countersink are cut as a plain hole and noted), and rectangular pockets. Everything else is listed in `skipped`, never guessed.
// Coordinates are the STEP file's own: the stock is built on the 'front' plane, the other features on planes given by origin + normal + xdir.

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const AX_INDEX = { x: 0, y: 1, z: 2 };
const r = (n) => Math.round(n * 1e6) / 1e6;
const vec = (v) => `[${v.map(r).join(', ')}]`;
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
const neg = (a) => a.map((x) => -x);

/** Some unit vector perpendicular to n (the sketch's x direction). */
function perp(n) {
  const k = Math.abs(n[0]) <= Math.abs(n[1]) && Math.abs(n[0]) <= Math.abs(n[2]) ? 0 : Math.abs(n[1]) <= Math.abs(n[2]) ? 1 : 2;
  const a = [0, 0, 0]; a[k] = 1;
  return norm(sub(a, n.map((x) => x * dot(a, n))));
}
const planeOf = (origin, normal, xdir) => `at({ origin: ${vec(origin)}, normal: ${vec(normal)}, xdir: ${vec(xdir)} })`;

/** Douglas-Peucker on a polyline of [r, h] points (distance in the plane). */
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - a[0]) * (b[1] - a[1]) - (pts[i][1] - a[1]) * (b[0] - a[0])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    if (d > worst) { worst = d; at = i; }
  }
  return worst <= tol ? [a, b] : [...dp(pts.slice(0, at + 1), tol).slice(0, -1), ...dp(pts.slice(at), tol)];
}
const lineAt = (a, b, h) => [a[0] + ((h - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), h];

/** The (r, y) profile to revolve about the Y axis from circular slices above `hLo`: a solid (one loop per level) or a shell (two, outer and inner). null when the slices are not that. */
export function turnedProfile(t, hLo, hHi) {
  const lv = t.filter((l) => l.h > hLo && l.h < hHi);
  if (lv.length < 4 || lv.some((l) => !l.loops.length || l.loops.length > 2 || !l.loops.every((x) => x.round && Math.hypot(...x.c) < 0.5))) return null;
  const n = lv[0].loops.length;
  if (lv.some((l) => l.loops.length !== n)) return null;
  const chain = (k) => {
    let pts = dp(lv.map((l) => [l.loops[k].r, l.h]), 0.05);
    const first = lineAt(pts[0], pts[1], hLo), last = lineAt(pts[pts.length - 2], pts[pts.length - 1], hHi);
    pts = [first, ...pts.slice(1, -1), last];
    return pts;
  };
  const outer = chain(0);
  if (n === 1) return [[0, hLo], ...outer, [0, hHi]];
  const inner = chain(1);
  // where the two chains meet at an end (a knife edge, or a crossing from extrapolating), they share one point: a sliver or a crossed profile would not revolve to a valid solid
  const meets = (a, b) => b[0] > a[0] - 0.05;   // the inner radius reaches the outer one
  if (meets(outer[outer.length - 1], inner[inner.length - 1])) inner.pop();
  if (meets(outer[0], inner[0])) inner.shift();
  return [...outer, ...inner.reverse()];
}

export function convert(q, opts = {}) {
  const records = (q.document?.records ?? q.records ?? []);
  const byFamily = (f) => records.filter((x) => x.family === f);
  const skipped = [], handled = [], lines = [], lineIds = [];
  const emit = (id, code) => { lines.push(code); lineIds.push(id); };

  // the stock: the body_key [minx, miny, minz, maxx, maxy, maxz, volume, area] a recogniser record carries
  // `opts.stock` ({min, max}) is the body box from our own STEP import and is preferred: a recogniser's body_key can describe only one of several bodies.
  // The file's volume (body_key[6]) is kept only when that box is the same box, so the check never compares against the wrong body.
  const keyed = records.find((x) => Array.isArray(x.parameters?.body_key));
  const bk = keyed?.parameters.body_key;
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
  const box = opts.stock ? { min: opts.stock.min, max: opts.stock.max } : bk ? { min: bk.slice(0, 3), max: bk.slice(3, 6) } : null;
  const base = box ? { ...box, volume: bk && near(bk.slice(0, 6), [...box.min, ...box.max]) ? bk[6] : null } : null;
  if (!base) return { script: null, handled, skipped: [{ id: '*', why: 'no record carries the body box, so the stock cannot be built', code: 'stock' }], base: null };
  const size = sub(base.max, base.min), mid = base.min.map((v, i) => (v + base.max[i]) / 2);

  emit('stock', "const p = part('From STEP');");
  // a turned body on a plate (a plate record, axis y, and circular slices above it): the plate, then one revolved profile for the rest
  const plate = byFamily('plates').find((x) => x.parameters.axis === 'y' && x.parameters.lo === 0 && x.parameters.hi < size[1] - 1e-6);
  const turned = plate && opts.turned ? turnedProfile(opts.turned, plate.parameters.hi, base.max[1]) : null;
  if (turned) {
    emit('stock', `p.sketch(at('front', ${r(base.min[2])}), (s) => s.rect(${r(size[0])}, ${r(plate.parameters.hi - base.min[1])}, [${r(mid[0])}, ${r(base.min[1] + (plate.parameters.hi - base.min[1]) / 2)}])).extrude(${r(size[2])});`);
    base.turned = true;
  }
  const pr = turned ? null : opts.prism;
  if (pr && pr.area < 0.995 * size.filter((_, i) => i !== pr.axis).reduce((a, b) => a * b, 1)) {
    // the body fits a prism much tighter than its box: build that outline instead (points are in the two other axes, low axis first)
    const nrm = [0, 0, 0]; nrm[pr.axis] = 1;
    const xdir = pr.axis === 0 ? [0, 1, 0] : [1, 0, 0];
    const pts = pr.points.map(([u, v]) => (pr.axis === 1 ? [u, -v] : [u, v]));   // the plane with normal +Y has its sketch y along -Z
    const o = [0, 0, 0]; o[pr.axis] = pr.lo;
    emit('stock', `p.sketch(${planeOf(o, nrm, xdir)}, (s) => s.polygon(${JSON.stringify(pts.map((q) => q.map(r)))})).extrude(${r(pr.hi - pr.lo)});`);
    base.prism = true;
  } else if (!turned)
  emit('stock', `p.sketch(at('front', ${r(base.min[2])}), (s) => s.rect(${r(size[0])}, ${r(size[1])}, [${r(mid[0])}, ${r(mid[1])}])).extrude(${r(size[2])});`);

  // fillets on the stock's own corner edges (an edge parallel to the fillet axis, at a corner of the box)
  for (const f of byFamily('fillets')) {
    const P = f.parameters, ax = AX_INDEX[P.axis];
    if (ax === undefined || P.side !== 'convex' || P.turned) { skipped.push({ id: f.id, why: 'only convex, untuned corner fillets are rebuilt', code: 'fillet-kind', family: 'fillets' }); continue; }
    const others = [0, 1, 2].filter((i) => i !== ax);
    const corner = P.at.slice();
    for (const i of others) corner[i] = Math.abs(P.at[i] - base.min[i]) < Math.abs(P.at[i] - base.max[i]) ? base.min[i] : base.max[i];
    const off = Math.hypot(...others.map((i) => corner[i] - P.at[i]));
    if (off > P.radius * 0.6) { skipped.push({ id: f.id, why: 'the fillet is not at a corner of the stock box', code: 'fillet-corner', family: 'fillets' }); continue; }
    emit(f.id, `p.fillet(edges({ parallel: '${P.axis.toUpperCase()}', near: ${vec(corner)}, within: 1 }), ${r(P.radius)});`);
    handled.push(f.id);
  }

  if (turned) {
    emit('turned', `p.sketch('front', (s) => s.polygon(${JSON.stringify(turned.map((q) => q.map((v) => Math.round(v * 1e3) / 1e3)))})).revolve(360, { axis: { from: [0, 0], to: [0, 10] } });`);
    for (const x of records) if (x.family === 'risers' || x.family === 'interior_voids' || x.family === 'plates') handled.push(x.id);
  }

  // holes: a circle on a plane at the hole's mouth, normal into the material
  for (const h of byFamily('holes')) {
    const P = h.parameters;
    const n = norm(P.axis);
    const note = P.cbore || P.csink || P.spotface ? ' // counterbore / countersink / spotface not rebuilt: plain hole' : '';
    const thru = P.bottom === 'through';
    emit(h.id, `p.sketch(${planeOf(P.location, n, perp(n))}, (s) => s.circle(${r(P.diameter / 2)})).cut(${thru ? 'through()' : r(P.depth)});${note}`);
    handled.push(h.id);
  }

  // rectangular pockets: a rectangle on the open face, centred, cut by the depth
  for (const k of byFamily('pockets')) {
    const P = k.parameters;
    if (!P.rectangular_boundary || P.corner_radius != null || P.end_radius != null) { skipped.push({ id: k.id, why: 'only plain rectangular pockets are rebuilt', code: 'pocket-shape', family: 'pockets' }); continue; }
    const la = AX_INDEX[P.long_axis], wa = AX_INDEX[P.width_axis];
    const na = [0, 1, 2].find((i) => i !== la && i !== wa);
    const centre = [0, 0, 0];
    centre[la] = (P.lo + P.hi) / 2; centre[wa] = P.w_center; centre[na] = P.open_sign > 0 ? P.d_hi : P.d_lo;
    const nrm = [0, 0, 0]; nrm[na] = -P.open_sign;
    const xdir = AXES[P.long_axis];
    // sketch y is normal x xdir; the width runs along width_axis, so only the size matters, not the sign
    emit(k.id, `p.sketch(${planeOf(centre, nrm, xdir)}, (s) => s.rect(${r(P.length)}, ${r(P.width)})).cut(${r(P.depth)});`);
    handled.push(k.id);
  }

  // everything else quiddity reported that this slice does not rebuild. A pattern groups holes already rebuilt; a step level or recess can be
  // another description of a pocket (it is on the plate fixture) or a real feature, so it is listed, never silently dropped
  const FOLDED = new Set(['hole_patterns']);
  const done = new Set(handled);
  for (const x of records) {
    if (done.has(x.id) || skipped.some((s) => s.id === x.id)) continue;
    skipped.push({ id: x.id, why: FOLDED.has(x.family) ? 'groups holes that are already rebuilt' : `family '${x.family}' is not rebuilt yet`, code: FOLDED.has(x.family) ? 'folded' : 'family', family: x.family });
  }
  return { script: lines.join('\n') + '\n', lineIds, handled, skipped, base };
}
