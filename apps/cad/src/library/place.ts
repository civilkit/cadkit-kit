// Placing a library part where the user dropped it. A part is a list of features authored around its own origin; to put it on a
// face, a datum plane or the ground we do not move geometry, we re-seat the part's ROOT SKETCHES: a sketch on the part's own
// plane (the plane its first feature is drawn on: its "up" is that plane's normal) is put on the target plane instead and its
// points are shifted so the part's origin lands on the drop point. Everything else in the part hangs off those sketches by
// feature id and face name, so it follows. A part is only moved this way when that is certain to be right; otherwise it stays at
// its own origin and the caller shows a notice (see `PlaceFallback`).
import type { PlaceTarget } from '../catalog/shapes';
import { STD_FRAMES, applyPlacement, isStd, type StdPlane } from '../catalog/placement';
import type { V3 } from '../catalog/geometry';

type Obj = Record<string, unknown>;

/** Why a part could not be moved: shown as `library.place.fallback.<reason>`. */
export type PlaceFallback = 'curved' | 'noFrame' | 'noStdRoot' | 'otherPlanes' | 'global' | 'edges' | 'assembly';
export type Placed = { features: Obj[]; moved: true; rotated?: boolean; rotIgnored?: boolean } | { features: Obj[]; moved: false; why: PlaceFallback };
const ADD_SHAPES = new Set(['extrude', 'revolve', 'loft', 'sweep']);

const FIXED_TYPES = new Set(['insertPart', 'mate', 'moveBody', 'sketch3d', 'freeform', 'editCurve']);
const isNum3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');
const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The std plane a sketch (or plane feature base) names, whether as `{kind:'std', id}` or as the bare name. */
function stdOf(p: unknown): StdPlane | null {
  if (typeof p === 'string') return isStd(p) ? p : null;
  const o = p as Obj | null;
  return o && o.kind === 'std' && isStd(o.id) ? o.id : null;
}

interface Analysis { p0: StdPlane; derived: Set<string>; hasEdgeAt: boolean }

/** Whether the part can be re-seated by its root sketches, and on which of its planes. A string is the reason when it cannot. */
export function analyse(features: Obj[]): Analysis | PlaceFallback {
  let p0: StdPlane | null = null;
  let hasEdgeAt = false;
  const take = (p: StdPlane): boolean => { if (p0 && p0 !== p) return false; p0 = p; return true; };
  // 1. every std plane in the part is the same one, and appears only as a sketch's plane or an offset plane's base
  for (const f of features) {
    if (FIXED_TYPES.has(String(f.type))) return f.type === 'insertPart' || f.type === 'mate' ? 'assembly' : 'global';
    if (f.type === 'sketch') { const s = stdOf(f.plane); if (s && !take(s)) return 'otherPlanes'; }
    else if (f.type === 'plane') {
      const s = stdOf(f.base);
      if (s) { if (f.mode !== 'offset' || !take(s)) return 'otherPlanes'; }
    }
  }
  if (!p0) return 'noStdRoot';
  // 2. nothing else refers to the world: no std planes elsewhere, no world axes, no coordinates (an edge's `at` is moved with the part)
  let bad: PlaceFallback | null = null;
  const walk = (n: unknown, key: string, owner: Obj | null): void => {
    if (bad) return;
    if (Array.isArray(n)) {
      if (isNum3(n)) { if (key === 'at' && owner && Array.isArray(owner.faces)) hasEdgeAt = true; else bad = 'global'; return; }
      n.forEach((x) => walk(x, key, owner));
      return;
    }
    if (n && typeof n === 'object') {
      const o = n as Obj;
      if (o.kind === 'std') { bad = 'otherPlanes'; return; }
      if (o.kind === 'axis' && typeof o.axis === 'string') { bad = 'global'; return; }
      for (const [k, v] of Object.entries(o)) walk(v, k, o);
      return;
    }
    if (key === 'axis' && (n === 'x' || n === 'y' || n === 'z')) bad = 'global';
    else if ((key === 'plane' || key === 'base' || key === 'base2') && isStd(n)) bad = 'otherPlanes';
  };
  // the two places a std plane may be named (checked above, and re-seated by placeFeatures): a sketch's plane and an offset plane's base
  for (const f of features) for (const [k, v] of Object.entries(f)) if (!((f.type === 'sketch' && k === 'plane') || (f.type === 'plane' && k === 'base'))) walk(v, k, f);
  if (bad) return bad;
  // 3. plane features reached from the part's own plane by offsets only (their sketches shift with it); any other plane derived
  //    from it (perpendicular, angled...) would need its own frame worked out
  const derived = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const f of features) {
      if (f.type !== 'plane' || derived.has(String(f.id))) continue;
      const b = f.base as Obj | string | null | undefined;
      const fromStd = stdOf(b) !== null;
      const fromDerived = !!b && typeof b === 'object' && b.kind === 'feature' && derived.has(String(b.id));
      if (fromStd || fromDerived) {
        if (f.mode !== 'offset') return 'otherPlanes';
        derived.add(String(f.id)); grew = true;
      }
    }
  }
  return { p0, derived, hasEdgeAt };
}

/** The frame of the target plane in the world, when it is known (a datum plane feature's is not worked out here). */
function frameOf(target: PlaceTarget): { o: V3; x: V3; y: V3; n: V3 } | null {
  if (target.kind === 'face') { const f = target.frame; return f ? { o: f.o as V3, x: f.x as V3, y: f.y as V3, n: f.z as V3 } : null; }
  if (target.plane?.kind === 'feature') return null;
  const s = STD_FRAMES[target.plane?.id ?? 'front'];
  return { o: [0, 0, 0], x: s.x, y: s.y, n: s.n };
}

const r6 = (x: number): number => +x.toFixed(6);

/**
 * `features`: the part's features (already renumbered, fresh clones: they are changed in place). Returns them moved so that the
 * part's origin is at the drop point of `target`, its up along the target's normal, standing ON the target plane.
 * `flip` stands it on the other side of a plane (the Direction choice); only a ground target honours it, like the BOSL entries.
 */
export function placeFeatures(features: Obj[], target: PlaceTarget, flip = false, rot: 0 | 1 | 2 | 3 = 0): Placed {
  const keep = (why: PlaceFallback): Placed => ({ features, moved: false, why });
  if (target.kind === 'face' && !target.planar) return keep('curved');
  if (target.kind === 'face' && !target.frame) return keep('noFrame');
  const a = analyse(features);
  if (typeof a === 'string') return keep(a);
  const T = frameOf(target);
  if (a.hasEdgeAt && !T) return keep('edges');

  const plane: Obj = target.kind === 'face' ? { kind: 'face', id: target.face } : { ...(target.plane ?? { kind: 'std', id: 'front' }) };
  let u: number, v: number;
  if (target.kind === 'face') {
    const f = target.frame!, d = [target.point[0] - f.o[0], target.point[1] - f.o[1], target.point[2] - f.o[2]];
    u = dot(d, f.x); v = dot(d, f.y);
  } else [u, v] = target.uv ?? [target.point[0], target.point[1]];
  u = r6(u); v = r6(v);

  const s0 = STD_FRAMES[a.p0];
  const flipped = flip && target.kind === 'ground';
  const shift = (sk: Obj): void => {
    for (const p of (sk.points as Array<{ x: unknown; y: unknown }> | undefined) ?? []) {
      if (typeof p.x === 'number') p.x = r6(p.x + u);
      if (typeof p.y === 'number') p.y = r6(p.y + v);
    }
  };
  for (const f of features) {
    if (f.type === 'sketch') {
      if (stdOf(f.plane)) { f.plane = { ...plane }; shift(f); }
      else { const pl = f.plane as Obj | undefined; if (pl && pl.kind === 'feature' && a.derived.has(String(pl.id))) shift(f); }
    } else if (f.type === 'plane' && stdOf(f.base)) f.base = { ...plane };
    if (T) moveEdgeAts(f, (p) => {
      const x = dot(p, s0.x) + u, y = dot(p, s0.y) + v, z = dot(p, s0.n) * (flipped ? -1 : 1);
      return [0, 1, 2].map((i) => r6(T.o[i] + x * T.x[i] + y * T.y[i] + z * T.n[i])) as V3;
    });
  }
  if (flipped) applyPlacement(features, { flip: true, rot: 0, mirror: false }, [u, v], target.plane ?? { kind: 'std', id: 'front' });
  // Rotate: one `moveBody` after the part turns everything it made about the plane normal through the drop point. It selects the part's own
  // lumps by feature id, so other solids in the document stay where they are. On a face the part fuses into the body it stands on: a
  // rotation would turn that body too, so it is not applied there (the caller says so).
  if (rot && target.kind === 'ground' && T) {
    const shapes = features.filter((f) => ADD_SHAPES.has(String(f.type)) && f.op !== 'cut').map((f) => ({ feature: String(f.id) }));
    if (shapes.length) {
      const last = features.reduce((m, f) => Math.max(m, /^F(\d+)$/.test(String(f.id)) ? Number(String(f.id).slice(1)) : 0), 0);
      const origin = [0, 1, 2].map((i) => r6(T.o[i] + u * T.x[i] + v * T.y[i]));
      features.push({ type: 'moveBody', id: `F${last + 1}`, name: 'Rotate', bodies: shapes, rotate: { axis: [...T.n], origin, angle: rot * 90 } });
      return { features, moved: true, rotated: true };
    }
  }
  return { features, moved: true, ...(rot ? { rotIgnored: true } : {}) };
}

function moveEdgeAts(n: unknown, f: (p: V3) => V3): void {
  if (Array.isArray(n)) { n.forEach((x) => moveEdgeAts(x, f)); return; }
  if (!n || typeof n !== 'object') return;
  const o = n as Obj;
  if (Array.isArray(o.faces) && isNum3(o.at)) o.at = f(o.at);
  else for (const v of Object.values(o)) moveEdgeAts(v, f);
}
