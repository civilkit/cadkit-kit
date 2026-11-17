// Geometry interface queries (`interfaces`): the few things an assembly agent needs to place and mate parts, without reading every face: the unique
// hole axes and their patterns, the unique planes, the contact faces between bodies and the coordinate frames. Built on the kernel's own face
// descriptions (`describe`) and mass properties, nothing re-measured here, and deduplicated.
//
// Numbers: every numeric field is the kernel's value, never rounded here. Positions and areas arrive with 9 decimals; an axis-aligned direction is
// exact (the kernel names it +X, -Y, ...); an oblique direction arrives from the kernel with 4 decimals, so it is good to about 1e-4 and the result
// says so (`precision.obliqueDirectionDecimals`). `label` is a rounded line for reading (`precision.display` decimals): never compute from it.
import { ReadbackError } from './errors';
import { resolveEntity, type BodyRef } from './entities';
import type { ReadbackHost, ReadbackTool } from './tools';
import type { Schema } from './schema';

export const INTERFACE_KINDS = ['holes', 'planes', 'contacts', 'frames'] as const;
type Kind = typeof INTERFACE_KINDS[number];
type V3 = [number, number, number];
const DESCRIBE_BATCH = 150;
const MAX_CONTACT_QUERIES = 200;
const KERNEL_POSITION_DECIMALS = 9;
const KERNEL_OBLIQUE_DECIMALS = 4;

interface Face { name: string; surface: string; area: number; centroid: V3; normal: V3 | null; axis: V3 | null; radius: number | null; hole: boolean; oblique: boolean; body: BodyRef }

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => { const l = norm(a); return l > 1e-12 ? mul(a, 1 / l) : [0, 0, 0]; };
const near = (a: V3, b: V3, tol: number): boolean => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;

/** A direction as the kernel writes it: a label ("+Z", exact) or "(x, y, z)" (4 decimals). */
export function parseDirection(s: unknown): { v: V3; oblique: boolean } | null {
  if (Array.isArray(s) && s.length === 3 && s.every((x) => typeof x === 'number')) return { v: s as V3, oblique: true };
  if (typeof s !== 'string') return null;
  const lab = /^([+-])([xyz])$/i.exec(s.trim());
  if (lab) { const v: V3 = [0, 0, 0]; v['xyz'.indexOf(lab[2].toLowerCase())] = lab[1] === '-' ? -1 : 1; return { v, oblique: false }; }
  const m = /^\(\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\)$/.exec(s.trim());
  return m ? { v: unit([Number(m[1]), Number(m[2]), Number(m[3])]), oblique: true } : null;
}

/** A frame at `origin` with z along `z`; x is the world axis least aligned with z, made perpendicular (deterministic, so the same part gives the same frame). */
export function frameAt(origin: readonly number[], z: readonly number[]): { origin: V3; x: V3; y: V3; z: V3 } {
  const zz = unit(z as V3);
  const helper: V3 = Math.abs(zz[0]) <= Math.abs(zz[1]) && Math.abs(zz[0]) <= Math.abs(zz[2]) ? [1, 0, 0] : Math.abs(zz[1]) <= Math.abs(zz[2]) ? [0, 1, 0] : [0, 0, 1];
  const x = unit(sub(helper, mul(zz, dot(helper, zz))));
  return { origin: origin as V3, x, y: cross(zz, x), z: zz };
}

const fmt = (n: number, p: number): string => (Math.round(n * 10 ** p) / 10 ** p).toString();
const fv = (v: readonly number[], p: number): string => `(${v.map((x) => fmt(x, p)).join(', ')})`;

async function describeAll(h: ReadbackHost, names: string[]): Promise<Array<Record<string, unknown>>> {
  if (!h.kernel.describe) throw new ReadbackError('unsupported', 'this kernel session cannot describe faces', 'use a newer kernel build');
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < names.length; i += DESCRIBE_BATCH) out.push(...(await h.kernel.describe(names.slice(i, i + DESCRIBE_BATCH))) as Array<Record<string, unknown>>);
  return out;
}

const vec3 = (v: unknown): V3 | null => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as V3) : null);

async function facesOf(h: ReadbackHost, bodies: BodyRef[]): Promise<Face[]> {
  const owner = new Map<string, BodyRef>();
  for (const b of bodies) for (const f of b.faces) owner.set(f, b);
  const names = [...owner.keys()];
  const items = await describeAll(h, names);
  const faces: Face[] = [];
  items.forEach((it, i) => {
    if (!it || it.found === false) return;
    const centroid = vec3(it.centroid);
    if (!centroid) return;
    const n = parseDirection(it.normal), a = parseDirection(it.axis);
    faces.push({
      name: names[i], surface: String(it.surface ?? ''), area: Number(it.area ?? 0), centroid, normal: n ? n.v : null, axis: a ? a.v : null,
      radius: typeof it.radius === 'number' ? it.radius : null, hole: it.hole === true, oblique: !!(n?.oblique || a?.oblique), body: owner.get(names[i])!,
    });
  });
  return faces;
}

// ---------------------------------------------------------------- holes

interface Hole { id: string; radius: number; axis: V3; point: V3; faces: string[]; bodies: string[]; length: number; oblique: boolean }

/** The line of a hole: a direction with a fixed sign, and the point of the axis nearest the world origin (so two holes on one line compare equal). */
const lineKey = (axis: V3, p: V3): { dir: V3; foot: V3 } => {
  const s = axis[0] !== 0 ? Math.sign(axis[0]) : axis[1] !== 0 ? Math.sign(axis[1]) : Math.sign(axis[2]);
  const dir = mul(axis, s || 1);
  return { dir, foot: sub(p, mul(dir, dot(p, dir))) };
};

function holesOf(faces: Face[], tol: number): Hole[] {
  const holes: Hole[] = [];
  for (const f of faces) {
    if (f.surface !== 'cylinder' || !f.hole || !f.axis || f.radius === null) continue;
    const { dir, foot } = lineKey(f.axis, f.centroid);
    const same = holes.find((h) => Math.abs(h.radius - f.radius!) <= tol && near(h.axis, dir, tol) && near(lineKey(h.axis, h.point).foot, foot, tol) && h.bodies.includes(f.body.name));
    const len = f.area / (2 * Math.PI * f.radius);
    if (same) { same.faces.push(f.name); same.length += len; continue; }     // one hole whose barrel is in several faces
    holes.push({ id: '', radius: f.radius, axis: dir, point: f.centroid, faces: [f.name], bodies: [f.body.name], length: len, oblique: f.oblique });
  }
  holes.sort((a, b) => a.bodies[0].localeCompare(b.bodies[0]) || a.radius - b.radius || a.point[0] - b.point[0] || a.point[1] - b.point[1] || a.point[2] - b.point[2]);
  holes.forEach((h, i) => { h.id = `H${i + 1}`; });
  return holes;
}

interface Pattern { type: 'linear' | 'circular'; holes: string[]; count: number; radius: number; axis: V3; pitch?: number; direction?: V3; center?: V3; pcd?: number; angularPitch?: number | null }

/** Holes of one radius and direction in a line with equal spacing, or on one circle: found among holes that share a body, radius and axis direction. */
function patternsOf(holes: Hole[], tol: number): Pattern[] {
  const out: Pattern[] = [];
  const groups = new Map<string, Hole[]>();
  for (const h of holes) {
    const k = `${h.bodies[0]}|${fmt(h.radius, 4)}|${h.axis.map((x) => fmt(x, 3)).join(',')}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(h);
  }
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    const ax = g[0].axis;
    // the holes projected into the plane across their axis
    const pts = g.map((h) => sub(h.point, mul(ax, dot(h.point, ax))));
    // linear: sorted along the line through the two farthest apart, equal gaps
    let a = 0, b = 1, far = -1;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const d = norm(sub(pts[i], pts[j])); if (d > far) { far = d; a = i; b = j; } }
    const dir = unit(sub(pts[b], pts[a]));
    const along = pts.map((p) => dot(sub(p, pts[a]), dir));
    const onLine = pts.every((p, i) => norm(sub(sub(p, pts[a]), mul(dir, along[i]))) <= tol * 10);
    if (onLine) {
      const order = along.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
      const gaps = order.slice(1).map((o, i) => o[0] - order[i][0]);
      if (gaps.every((d) => Math.abs(d - gaps[0]) <= tol * 10) && gaps[0] > tol) { out.push({ type: 'linear', holes: order.map((o) => g[o[1]].id), count: g.length, radius: g[0].radius, axis: ax, pitch: gaps[0], direction: dir }); continue; }
    }
    // circular: the circumcentre of three of them, every hole at the same distance
    const c = circumcentre(pts[0], pts[1], pts[2]);
    if (!c) continue;
    const rr = norm(sub(pts[0], c));
    if (pts.every((p) => Math.abs(norm(sub(p, c)) - rr) <= tol * 10) && rr > tol) {
      const e1 = unit(sub(pts[0], c)), e2 = cross(ax, e1);
      const ang = pts.map((p) => Math.atan2(dot(sub(p, c), e2), dot(sub(p, c), e1))).map((x) => (x < 0 ? x + 2 * Math.PI : x)).sort((p, q) => p - q);
      const gaps = ang.map((x, i) => (i + 1 < ang.length ? ang[i + 1] - x : ang[0] + 2 * Math.PI - x));
      const even = gaps.every((x) => Math.abs(x - gaps[0]) <= 1e-3);
      const order = pts.map((p, i) => [Math.atan2(dot(sub(p, c), e2), dot(sub(p, c), e1)), i] as const).map(([x, i]) => [x < 0 ? x + 2 * Math.PI : x, i] as const).sort((p, q) => p[0] - q[0]);
      out.push({ type: 'circular', holes: order.map((o) => g[o[1]].id), count: g.length, radius: g[0].radius, axis: ax, center: add(c, mul(ax, dot(g[0].point, ax))), pcd: 2 * rr, angularPitch: even ? (gaps[0] * 180) / Math.PI : null });
    }
  }
  return out;
}

function circumcentre(a: V3, b: V3, c: V3): V3 | null {
  const ab = sub(b, a), ac = sub(c, a), n = cross(ab, ac), nn = dot(n, n);
  if (nn < 1e-12) return null;                                           // in a line
  const t = add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab)));
  return add(a, mul(t, 1 / (2 * nn)));
}

// ---------------------------------------------------------------- planes and contacts

interface PlaneGroup { id: string; normal: V3; offset: number; area: number; faces: string[]; bodies: string[]; anchor: V3; oblique: boolean; largest: number }

function planesOf(faces: Face[], tol: number): PlaneGroup[] {
  const groups: PlaneGroup[] = [];
  for (const f of faces) {
    if (f.surface !== 'plane' || !f.normal) continue;
    const offset = dot(f.normal, f.centroid);
    const t = f.oblique ? Math.max(tol, 5e-3) : tol;      // an oblique normal is only good to 1e-4, which moves a far-off plane by more than 1e-6
    const g = groups.find((x) => near(x.normal, f.normal!, f.oblique || x.oblique ? Math.max(tol, 2e-4) : tol) && Math.abs(x.offset - offset) <= t);
    if (g) { g.area += f.area; g.faces.push(f.name); if (!g.bodies.includes(f.body.name)) g.bodies.push(f.body.name); if (f.area > g.largest) { g.largest = f.area; g.anchor = f.centroid; } continue; }
    groups.push({ id: '', normal: f.normal, offset, area: f.area, faces: [f.name], bodies: [f.body.name], anchor: f.centroid, oblique: f.oblique, largest: f.area });
  }
  groups.sort((a, b) => b.area - a.area);
  groups.forEach((g, i) => { g.id = `P${i + 1}`; });
  return groups;
}

// ---------------------------------------------------------------- the tool

const obj = (properties: Record<string, Schema>, required: string[] = []): Schema & { type: 'object' } => ({ type: 'object', properties, required, additionalProperties: false });

export const interfaces: ReadbackTool = {
  name: 'interfaces',
  description: 'Compact geometry for mating parts, deduplicated: holes (unique axes with radius and where they are, and the linear / bolt-circle patterns they form), planes (unique planes with normal, offset and area), contacts (opposite-facing coplanar faces of two bodies, touching) and frames (world, and each body\'s centre of mass). `component` limits it to one body (name or number from `bodies`). Numbers are exact kernel values in mm (`precision` says how good); `label` is rounded for reading only: never place from it.',
  inputSchema: obj({
    kinds: { type: 'array', items: { type: 'string', enum: [...INTERFACE_KINDS] }, maxItems: 4, description: 'default: all four' },
    component: { description: 'a body name or its number from `bodies`', oneOf: [{ type: 'string', maxLength: 200 }, { type: 'integer', minimum: 1 }] },
    precision: { type: 'integer', minimum: 0, maximum: 6, description: 'decimals of `label` (default 3); the numeric fields are never rounded' },
    tolerance: { type: 'number', minimum: 1e-9, maximum: 1, description: 'mm: how close two holes or planes must be to count as one (default 0.001)' },
    limit: { type: 'integer', minimum: 1, maximum: 500, description: 'most entries per kind (default 50); totals say how many there are' },
  }),
  async run(i, h) {
    const kinds = new Set<Kind>((Array.isArray(i.kinds) && i.kinds.length ? i.kinds : INTERFACE_KINDS) as Kind[]);
    const p = typeof i.precision === 'number' ? i.precision : 3;
    const tol = typeof i.tolerance === 'number' ? i.tolerance : 1e-3;
    const limit = typeof i.limit === 'number' ? i.limit : 50;
    const all = await h.bodies();
    if (!all.length) throw new ReadbackError('no_body', 'the document has no solid body', 'build something first');
    let scope = all;
    if (i.component !== undefined) {
      const r = resolveEntity(i.component, all);
      if (!r.body) throw new ReadbackError('no_such_body', `${String(i.component)} is not a body`, 'name a body (see bodies)');
      scope = [r.body];
    }
    const faces = await facesOf(h, kinds.has('contacts') ? all : scope);
    const inScope = (f: Face) => scope.includes(f.body);
    const out: Record<string, unknown> = {
      ok: true, units: 'mm', tolerance: tol,
      precision: { positionDecimals: KERNEL_POSITION_DECIMALS, obliqueDirectionDecimals: KERNEL_OBLIQUE_DECIMALS, axisAlignedDirections: 'exact', display: p, note: 'numeric fields are the kernel\'s values; label is rounded for reading only' },
      scope: scope.length === all.length ? 'all bodies' : scope[0].name,
    };
    const cut = <T>(rows: T[], key: string): T[] => { out[`${key}Total`] = rows.length; return rows.slice(0, limit); };

    if (kinds.has('holes')) {
      const holes = holesOf(faces.filter(inScope), tol);
      const patterns = patternsOf(holes, tol);
      out.holes = cut(holes.map((h2) => ({
        id: h2.id, body: h2.bodies[0], radius: h2.radius, diameter: 2 * h2.radius, axis: h2.axis, point: h2.point, length: h2.length, faces: h2.faces, frame: frameAt(h2.point, h2.axis),
        label: `${h2.id} dia ${fmt(2 * h2.radius, p)} at ${fv(h2.point, p)} axis ${fv(h2.axis, p)} in ${h2.bodies[0]}`,
      })), 'holes');
      out.holePatterns = patterns.map((q) => ({ ...q, label: q.type === 'linear' ? `${q.count} holes dia ${fmt(2 * q.radius, p)} in a line, pitch ${fmt(q.pitch!, p)}` : `${q.count} holes dia ${fmt(2 * q.radius, p)} on a circle dia ${fmt(q.pcd!, p)} at ${fv(q.center!, p)}` }));
      out.holeNote = 'point is the centre of the barrel face, on the axis for a full barrel; length is barrel area / (2 pi r), true for a full barrel';
    }
    if (kinds.has('planes')) {
      const planes = planesOf(faces.filter(inScope), tol);
      out.planes = cut(planes.map((g) => ({
        id: g.id, normal: g.normal, offset: g.offset, area: g.area, faceCount: g.faces.length, faces: g.faces.slice(0, 8), bodies: g.bodies, anchor: g.anchor, frame: frameAt(g.anchor, g.normal), ...(g.oblique ? { oblique: true } : {}),
        label: `${g.id} normal ${fv(g.normal, p)} offset ${fmt(g.offset, p)} area ${fmt(g.area, p)} (${g.faces.length} face${g.faces.length === 1 ? '' : 's'})`,
      })), 'planes');
    }
    if (kinds.has('contacts')) {
      // opposite-facing planar faces of two bodies on the same plane, then the kernel's own distance between the two faces decides touching
      const planar = faces.filter((f) => f.surface === 'plane' && f.normal);
      const cands: Array<[Face, Face]> = [];
      for (let a = 0; a < planar.length; a++) for (let b = a + 1; b < planar.length; b++) {
        const A = planar[a], B = planar[b];
        if (A.body === B.body || (!scope.includes(A.body) && !scope.includes(B.body))) continue;
        const t = A.oblique || B.oblique ? Math.max(tol, 5e-3) : tol;
        if (near(A.normal!, mul(B.normal!, -1), A.oblique || B.oblique ? Math.max(tol, 2e-4) : tol) && Math.abs(dot(A.normal!, A.centroid) + dot(B.normal!, B.centroid)) <= t) cands.push([A, B]);
      }
      const rows: Array<Record<string, unknown>> = [];
      let asked = 0;
      for (const [A, B] of cands) {
        if (asked++ >= MAX_CONTACT_QUERIES) break;
        const d = await h.kernel.distance(A.name, B.name).catch(() => null);
        if (!d || d.distance > tol) continue;
        rows.push({
          bodies: [A.body.name, B.body.name], faces: [A.name, B.name], normal: A.normal, offset: dot(A.normal!, A.centroid), distance: d.distance, areaUpperBound: Math.min(A.area, B.area),
          label: `${A.body.name} ${A.name} on ${B.body.name} ${B.name}, normal ${fv(A.normal!, p)}, area at most ${fmt(Math.min(A.area, B.area), p)}`,
        });
      }
      out.contacts = cut(rows, 'contacts');
      out.contactNote = 'a candidate is two coplanar faces facing each other that the kernel measures as touching; areaUpperBound is the smaller face (the overlap itself is not computed), and faces that touch only along an edge are included';
      if (cands.length > MAX_CONTACT_QUERIES) out.contactsChecked = MAX_CONTACT_QUERIES;
    }
    if (kinds.has('frames')) {
      const frames: Array<Record<string, unknown>> = [{ id: 'world', origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], label: 'world frame' }];
      const mass = h.kernel.massProps ? await h.kernel.massProps({ bodies: true }).catch(() => null) : null;
      const per = mass?.bodies ?? [];
      // the kernel lists bodies in its own order: each is matched to the body of the same volume
      const free = [...per];
      for (const b of scope) {
        const k = b.volume != null ? free.findIndex((x) => Math.abs(x.volume - b.volume!) <= Math.max(1e-6, 1e-3 * Math.abs(b.volume!))) : -1;
        const m = k >= 0 ? free.splice(k, 1)[0] : scope.length === 1 && per.length === 1 ? per[0] : null;
        if (m) frames.push({ id: `com:${b.name}`, body: b.name, origin: m.com, x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], volume: m.volume, label: `${b.name} centre of mass ${fv(m.com, p)}, world axes` });
      }
      if (scope.length === all.length && mass?.com && mass.axes) frames.push({ id: 'principal', origin: mass.com, x: mass.axes[0], y: mass.axes[1], z: mass.axes[2], label: `principal axes of the whole part at ${fv(mass.com, p)}` });
      out.frames = frames;
    }
    return { data: out, summary: `${[...kinds].map((k) => `${k}: ${Array.isArray(out[k]) ? (out[`${k}Total`] ?? (out[k] as unknown[]).length) : '-'}`).join(', ')}` };
  },
};
