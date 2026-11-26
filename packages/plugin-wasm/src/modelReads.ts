// What the plugin reads `model.faces` and `model.edges` answer with, worked out from the display tessellation (faces) and the edge polylines (edges) of the open document.
// Everything is in the plugin's frame and millimetres: the caller turns the points before they get here. No kernel call: the same data `model.mesh` answers from.

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = len(a); return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4 + 0;
const round3 = (a: number[]): number[] => a.map(r4);

/** A circle fitted to 2D points (algebraic least squares): centre and radius, or null for fewer than three distinct points or points on a line. */
function fitCircle(pts: Array<[number, number]>): { c: [number, number]; r: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const b1 = 0.5 * (suuu + suvv), b2 = 0.5 * (svvv + svuu);
  const uc = (b1 * svv - b2 * suv) / det, vc = (b2 * suu - b1 * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  return Number.isFinite(r) ? { c: [uc + mx, vc + my], r } : null;
}

/** Two unit vectors that span the plane perpendicular to `axis`. */
function basisOf(axis: V3): [V3, V3] {
  const h: V3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(axis, h));
  return [u, cross(axis, u)];
}

export interface FaceInfo { area: number; /** the same under the name SolidCraft's plugins read */ area_mm2: number; centroid: number[]; plane_normal?: number[]; point: number[]; exact: boolean; cylinder?: { origin: number[]; axis: number[]; radius: number } }

/** One face from its triangles (nine numbers each, outward winding): area, area-weighted centre (not always on the face), the normal when it is a plane, a point that lies on it
 *  (the middle of its largest triangle) and the cylinder it is part of, when it is one. A plane and a cylinder are recognised from the tessellation (exact: true); any other face
 *  is answered with `exact: false`. */
export function faceInfo(tris: ArrayLike<number>, count: number): FaceInfo | null {
  let area = 0, big = 0;
  const cen: V3 = [0, 0, 0];
  let bigPoint: V3 = [0, 0, 0];
  const normals: V3[] = [];
  const verts: V3[] = [];
  for (let t = 0; t < count; t++) {
    const o = t * 9;
    const a: V3 = [tris[o], tris[o + 1], tris[o + 2]], b: V3 = [tris[o + 3], tris[o + 4], tris[o + 5]], c: V3 = [tris[o + 6], tris[o + 7], tris[o + 8]];
    const n = cross(sub(b, a), sub(c, a)), ar = len(n) / 2;
    if (!(ar > 0)) continue;
    const m: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    area += ar;
    for (let k = 0; k < 3; k++) cen[k] += m[k] * ar;
    if (ar > big) { big = ar; bigPoint = m; }
    normals.push(unit(n));
    verts.push(a, b, c);
  }
  if (!(area > 0)) return null;
  const centroid = round3([cen[0] / area, cen[1] / area, cen[2] / area]);
  const out: FaceInfo = { area: r4(area), area_mm2: r4(area), centroid, point: round3(bigPoint), exact: false };
  const n0 = normals[0];
  if (normals.every((n) => dot(n, n0) > 1 - 1e-6)) { out.plane_normal = round3(n0); out.exact = true; return out; }
  // a cylinder: every facet normal is square to one axis (the facets are strips along it)
  let best: V3 = [0, 0, 0], bl = 0;
  for (const n of normals) { const c = cross(n0, n), l = len(c); if (l > bl) { bl = l; best = c; } }
  if (bl > 1e-3) {
    // the facets of a real tessellation tilt a little (a tenth of a degree is normal), so the axis is the direction the normals are most nearly square to:
    // the weakest direction of their spread, found by power iteration on (trace - M), started from the cross product
    let axis = unit(best);
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (const n of normals) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += n[i] * n[j];
    const tr = M[0][0] + M[1][1] + M[2][2];
    for (let it = 0; it < 80; it++) {
      const w: V3 = [0, 1, 2].map((i) => tr * axis[i] - (M[i][0] * axis[0] + M[i][1] * axis[1] + M[i][2] * axis[2])) as V3;
      const l = len(w);
      if (!(l > 0)) break;
      axis = [w[0] / l, w[1] / l, w[2] / l];
    }
    if (normals.every((n) => Math.abs(dot(n, axis)) < 1e-2)) {
      const [u, v] = basisOf(axis);
      const fit = fitCircle(verts.map((p): [number, number] => [dot(p, u), dot(p, v)]));
      if (fit && fit.r > 0) {
        const spread = Math.max(...verts.map((p) => Math.abs(Math.hypot(dot(p, u) - fit.c[0], dot(p, v) - fit.c[1]) - fit.r)));
        if (spread < Math.min(1e-3 * Math.max(1, fit.r), 0.005)) {   // vertices lie on the true surface: a cone of even half a degree shows as a radius that changes along the axis (0.035 mm over 8 mm), so no relative slack on big radii
          const along = dot(centroid as V3, axis);   // the origin sits level with the face's centre along the axis
          const origin: V3 = [u[0] * fit.c[0] + v[0] * fit.c[1] + axis[0] * along, u[1] * fit.c[0] + v[1] * fit.c[1] + axis[1] * along, u[2] * fit.c[0] + v[2] * fit.c[1] + axis[2] * along];
          out.cylinder = { origin: round3(origin), axis: round3(axis), radius: r4(fit.r) };
          out.exact = true;
          // the tessellation's area is the polygon's (a fraction of a percent short): a plugin that works out where the wall ends from it needs the true cylinder area, radius x angle x height
          const along2 = verts.map((p) => dot(p, axis)), h = Math.max(...along2) - Math.min(...along2);
          const ang = verts.map((p) => Math.atan2(dot(p, v) - fit.c[1], dot(p, u) - fit.c[0])).sort((x, y) => x - y);
          let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
          for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
          const sweep = gap > Math.PI * 0.75 ? 2 * Math.PI - gap : 2 * Math.PI;
          out.area = r4(fit.r * sweep * h); out.area_mm2 = out.area;
        }
      }
    }
  }
  return out;
}

export interface EdgeInfo { point: number[]; /** the same point under the name SolidInserts reads ("Invalid edges list: missing field `mid`") */ mid: number[]; length: number; curve: 'line' | 'circle' | 'curve'; centre?: number[]; axis?: number[]; radius?: number; /** the circle under the names SolidCraft's plugins read */ circle?: { center: number[]; diameter: number } }

/** One edge from its polyline: the point in the middle of it (on the edge), its length, and a line or circle when the points are one (a circle comes with its centre, axis and radius). */
export function edgeInfo(pts: number[][]): EdgeInfo | null {
  const P = pts.filter((p) => p.length >= 3).map((p): V3 => [p[0], p[1], p[2]]);
  if (P.length < 2) return null;
  let length = 0;
  for (let i = 1; i < P.length; i++) length += len(sub(P[i], P[i - 1]));
  const middle = round3(P[Math.floor(P.length / 2)]);
  const out: EdgeInfo = { point: middle, mid: middle, length: r4(length), curve: 'curve' };
  const chord = sub(P[P.length - 1], P[0]), cl = len(chord);
  const first = P[0];
  if (cl > 0 && P.every((p) => len(cross(sub(p, first), unit(chord))) < 1e-4 * Math.max(1, length))) { out.curve = 'line'; return out; }
  if (P.length >= 4) {
    let nrm: V3 = [0, 0, 0], nl = 0;
    for (let i = 1; i + 1 < P.length; i++) { const c = cross(sub(P[i], first), sub(P[i + 1], first)), l = len(c); if (l > nl) { nl = l; nrm = c; } }
    if (nl > 0) {
      const axis = unit(nrm), [u, v] = basisOf(axis);
      const fit = fitCircle(P.map((p): [number, number] => [dot(p, u), dot(p, v)]));
      if (fit) {
        const planeAt = dot(first, axis);
        const ok = P.every((p) => Math.abs(dot(p, axis) - planeAt) < 1e-3 * Math.max(1, fit.r) && Math.abs(Math.hypot(dot(p, u) - fit.c[0], dot(p, v) - fit.c[1]) - fit.r) < 1e-3 * Math.max(1, fit.r));
        if (ok) {
          const centre: V3 = [u[0] * fit.c[0] + v[0] * fit.c[1] + axis[0] * planeAt, u[1] * fit.c[0] + v[1] * fit.c[1] + axis[1] * planeAt, u[2] * fit.c[0] + v[2] * fit.c[1] + axis[2] * planeAt];
          out.curve = 'circle'; out.centre = round3(centre); out.axis = round3(axis); out.radius = r4(fit.r);
          out.circle = { center: out.centre, diameter: r4(2 * fit.r) };   // SolidInserts reads the rim as { circle: { center, diameter } }
        }
      }
    }
  }
  return out;
}
