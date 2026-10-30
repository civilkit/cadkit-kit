// A moved body leaves its sketches behind: the kernel's `moveBody` moves bodies, not the sketches of the features that built them (a plate moved
// 100 mm along x keeps its sketch frame at the origin). The extrude that built the body must keep reading its sketch where it was drawn, so the
// sketch itself stays; what an imported part adds is a hidden copy of each sketch on a frame plane at the pose of its body (shown from the tree).
type Rec = Record<string, any>;
type V3 = [number, number, number];
/** A rigid motion or a reflection: p -> r p + t (r in rows). */
export interface Affine { r: [V3, V3, V3]; t: V3 }

/** Our standard sketch planes: in-plane axes and normal. */
export const STD_PLANES: Record<string, { x: V3; y: V3; z: V3 }> = {
  front: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  top: { x: [1, 0, 0], y: [0, 0, -1], z: [0, 1, 0] },
  right: { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] },
};

const IDENT: Affine = { r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dir = (m: Affine, d: V3): V3 => [dot(m.r[0], d), dot(m.r[1], d), dot(m.r[2], d)];
const point = (m: Affine, p: V3): V3 => { const q = dir(m, p); return [q[0] + m.t[0], q[1] + m.t[1], q[2] + m.t[2]]; };
/** `a` applied after `b`. */
const then = (a: Affine, b: Affine): Affine => {
  const col = (j: number): V3 => dir(a, [b.r[0][j], b.r[1][j], b.r[2][j]]);
  const c = [col(0), col(1), col(2)];
  return { r: [[c[0][0], c[1][0], c[2][0]], [c[0][1], c[1][1], c[2][1]], [c[0][2], c[1][2], c[2][2]]], t: point(a, b.t) };
};
const isIdentity = (m: Affine): boolean => m.r.every((row, i) => row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-9)) && m.t.every((v) => Math.abs(v) < 1e-9);
const clean = (v: number): number => { const x = Math.round(v * 1e9) / 1e9; return x === 0 ? 0 : x; };

const v3 = (a: unknown): V3 | null => (Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === 'number' && isFinite(x)) ? (a as V3) : null);

/** The rotation about an axis through `origin` (angle in degrees, right-handed), as the kernel's `moveBody` reads it. */
function rotation(axis: V3, origin: V3, deg: number): Affine | null {
  const l = Math.hypot(...axis);
  if (!(l > 1e-12)) return null;
  const [x, y, z] = axis.map((c) => c / l), a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = 1 - c;
  const r: [V3, V3, V3] = [[c + x * x * k, x * y * k - z * s, x * z * k + y * s], [y * x * k + z * s, c + y * y * k, y * z * k - x * s], [z * x * k - y * s, z * y * k + x * s, c + z * z * k]];
  const o = dir({ r, t: [0, 0, 0] }, origin);
  return { r, t: [origin[0] - o[0], origin[1] - o[1], origin[2] - o[2]] };
}
const namedAxis = (a: unknown): V3 | null => {
  if (typeof a === 'string') return a === 'x' ? [1, 0, 0] : a === 'y' ? [0, 1, 0] : a === 'z' ? [0, 0, 1] : null;
  return v3(a);
};

/** The plane reference as a frame (origin, in-plane axes, normal) in the world; null for a plane this does not resolve (a face, a curve normal ...). */
export function planeFrame(ref: unknown, features: readonly Rec[], depth = 0): { o: V3; x: V3; y: V3; z: V3 } | null {
  const p = ref as Rec | undefined;
  if (!p || depth > 8) return null;
  if (p.kind === 'std') { const s = STD_PLANES[p.id]; return s ? { o: [0, 0, 0], ...s } : null; }
  if (p.kind !== 'feature') return null;
  const f = features.find((q) => q.type === 'plane' && q.id === p.id);
  if (!f) return null;
  if (f.mode === 'frame') {
    const o = v3(f.origin), x = v3(f.xDir), y = v3(f.yDir);
    if (!o || !x || !y) return null;
    const n: V3 = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], l = Math.hypot(...n);
    return l > 1e-12 ? { o, x, y, z: [n[0] / l, n[1] / l, n[2] / l] } : null;
  }
  if (f.mode === 'offset' && typeof f.offset === 'number') {
    const b = planeFrame(f.base, features, depth + 1);
    return b ? { ...b, o: [b.o[0] + f.offset * b.z[0], b.o[1] + f.offset * b.z[1], b.o[2] + f.offset * b.z[2]] } : null;
  }
  return null;
}

/** What one `moveBody` does to a body (or to its copy): the mirror about a plane, or the rotation and then the translation. Null when it cannot be read. */
export function moveTransform(m: Rec, features: readonly Rec[]): Affine | null {
  if (m.mirror !== undefined) {
    const pl = planeFrame(m.mirror, features);
    if (!pl) return null;
    const n = pl.z, k = dot(pl.o, n);
    return { r: [[1 - 2 * n[0] * n[0], -2 * n[0] * n[1], -2 * n[0] * n[2]], [-2 * n[1] * n[0], 1 - 2 * n[1] * n[1], -2 * n[1] * n[2]], [-2 * n[2] * n[0], -2 * n[2] * n[1], 1 - 2 * n[2] * n[2]]], t: [2 * k * n[0], 2 * k * n[1], 2 * k * n[2]] };
  }
  let out = IDENT;
  const rot = m.rotate as Rec | undefined;
  if (rot) {
    const axis = namedAxis(rot.axis?.axis ?? rot.axis), origin = rot.origin === undefined ? ([0, 0, 0] as V3) : v3(rot.origin), ang = typeof rot.angle === 'number' ? rot.angle : null;
    if (!axis || !origin || ang === null) return null;
    const r = rotation(axis, origin, ang);
    if (!r) return null;
    out = r;
  }
  if (m.translate !== undefined) {
    const t = v3(m.translate);
    if (!t) return null;
    out = then({ r: IDENT.r, t }, out);
  }
  return out;
}

const sketchRefs = (f: Rec): string[] => [f.sketch, ...(Array.isArray(f.sketches) ? f.sketches : [])].filter((s): s is string => typeof s === 'string');

type Owned = Map<string, Array<{ sketch: string; pose: Affine }>>;
/** Feature types that carry a sketch and make or change a body by an `add`/`cut` (a join or cut). */
const SKETCH_BODY_FEATURES = new Set(['extrude', 'revolve', 'sweep', 'loft']);
/** Feature types that bring bodies the follower does not track (it cannot tell which body a join without a name touches once one exists). */
const FOREIGN_BODIES = new Set(['insertPart', 'importStep']);

/**
 * For every body alive at the end, the sketches that built it and the motion each has had since it was drawn (the pose the body's copy of the sketch
 * belongs at). Bodies are followed by the features that name them (`newBody` extrudes, revolves, sweeps and lofts; `combine` hands a tool's sketches to
 * its target; a copy keeps its source's sketches). A join or cut that names no body belongs to the body it changes only when that is certain: exactly one
 * body is alive and none came from an inserted part or an imported solid. With two or more bodies the kernel unites it with whichever lump it meets,
 * which is not known here, so it belongs to none. A move this cannot read (a face selector, a plane it cannot resolve) is left out.
 */
export function sketchOwners(features: readonly Rec[]): Owned {
  const owned: Owned = new Map();
  let foreign = false;
  const moveAll = (list: Array<{ sketch: string; pose: Affine }>, m: Affine) => list.map((e) => ({ sketch: e.sketch, pose: then(m, e.pose) }));
  for (const f of features) {
    if (f.suppressed) continue;
    if (FOREIGN_BODIES.has(f.type)) foreign = true;
    if (typeof f.body === 'string' && f.op === 'newBody' && f.type !== 'moveBody') {
      owned.set(f.body, sketchRefs(f).map((sketch) => ({ sketch, pose: IDENT })));
    } else if ((f.op === 'add' || f.op === 'cut') && typeof f.body !== 'string' && SKETCH_BODY_FEATURES.has(f.type)) {
      if (!foreign && owned.size === 1) owned.get([...owned.keys()][0])!.push(...sketchRefs(f).map((sketch) => ({ sketch, pose: IDENT })));
    } else if (f.type === 'combine' && typeof f.target?.body === 'string') {
      const mine = owned.get(f.target.body);
      if (mine) for (const t of f.tools ?? []) { const got = owned.get(t?.body); if (got) mine.push(...got); }
      if (!f.keepTools) for (const t of f.tools ?? []) owned.delete(t?.body);
    } else if (f.type === 'deleteBody') {
      for (const b of f.bodies ?? []) if (typeof b?.body === 'string') owned.delete(b.body);
    } else if (f.type === 'moveBody') {
      const m = moveTransform(f, features);
      const sel = Array.isArray(f.bodies) ? f.bodies : null;
      if (!m || (sel && !sel.every((b: Rec) => typeof b?.body === 'string'))) continue;
      const names = sel ? sel.map((b: Rec) => b.body as string) : [...owned.keys()];
      if (f.copy === true) {
        if (typeof f.body === 'string' && names.length === 1 && owned.has(names[0])) owned.set(f.body, moveAll(owned.get(names[0])!, m));
      } else for (const nm of names) if (owned.has(nm)) owned.set(nm, moveAll(owned.get(nm)!, m));
    }
  }
  return owned;
}

/** Up to this many copies are shown by default; a larger model keeps them hidden like its other sketches (thousands of orange lines hid the model). */
export const SHOW_COPIES_UP_TO = 40;

/** The ids of the sketches every body of which was moved after they were drawn: where they were drawn is a place no body is at, so they are not shown. */
export function strandedSketches(features: readonly Rec[]): Set<string> {
  const poses = new Map<string, boolean[]>();
  for (const list of sketchOwners(features).values()) for (const { sketch, pose } of list) (poses.get(sketch) ?? poses.set(sketch, []).get(sketch)!).push(!isIdentity(pose));
  return new Set([...poses].filter(([, moved]) => moved.every(Boolean)).map(([id]) => id));
}

/**
 * The display copies of the sketches whose body was moved later: for every body alive at the end whose pose differs from where its sketches were
 * drawn, a frame plane at that pose and a copy of each sketch on it (see `sketchOwners` for which sketch belongs to which body). `nid` makes the
 * feature ids. The copies are shown when there are at most `SHOW_COPIES_UP_TO` of them, hidden otherwise (shown from the tree).
 */
export function followSketches(features: readonly Rec[], nid: () => string): Rec[] {
  const owned = sketchOwners(features);
  const jobs: Array<{ body: string; sk: Rec; fr: NonNullable<ReturnType<typeof planeFrame>>; pose: Affine }> = [];
  for (const [body, list] of owned) {
    for (const { sketch, pose } of list) {
      if (isIdentity(pose)) continue;
      const sk = features.find((q) => q.type === 'sketch' && q.id === sketch);
      const fr = sk && planeFrame(sk.plane, features);
      if (sk && fr) jobs.push({ body, sk, fr, pose });
    }
  }
  const visible = jobs.length <= SHOW_COPIES_UP_TO;
  const out: Rec[] = [];
  for (const { body, sk, fr, pose } of jobs) {
    const pid = nid(), sid = nid();
    out.push({ type: 'plane', id: pid, name: `${sk.name ?? sk.id} (${body}) frame`, mode: 'frame', origin: point(pose, fr.o).map(clean), xDir: dir(pose, fr.x).map(clean), yDir: dir(pose, fr.y).map(clean), visible: false });
    out.push({ type: 'sketch', id: sid, name: `${sk.name ?? sk.id} (${body})`, plane: { kind: 'feature', id: pid }, points: JSON.parse(JSON.stringify(sk.points)), entities: JSON.parse(JSON.stringify(sk.entities)), constraints: [], visible });
  }
  return out;
}
