// Leaf helpers: what a sketch holds (open chain, closed profile, point, curves) and which features leave a surface.
// Pure functions of a feature record; shared by the command and option-rule modules so they need not import each other.
import { SURFACE_TYPES } from '@kit/viewdata';
import { isSplinePath } from './sketch3d/model';

export type Feat = { id: string; type: string; [k: string]: unknown };
export type Ent = { id: string; type: string; p1?: string; p2?: string; pts?: string[]; construction?: boolean; closed?: boolean };

export const entitiesOf = (s: Feat): Ent[] => ((s.entities as Ent[] | undefined) ?? []).filter((e) => !e.construction);
/** Endpoints of the open-able entities (line, arc, spline), counted per point. */
export function degrees(ents: Ent[]): Map<string, number> {
  const d = new Map<string, number>();
  const bump = (p?: string) => { if (p) d.set(p, (d.get(p) ?? 0) + 1); };
  for (const e of ents) {
    if (e.type === 'line' || e.type === 'arc') { bump(e.p1); bump(e.p2); }
    else if ((e.type === 'spline' || e.type === 'cvspline') && e.pts && e.pts.length > 1) {
      // a closed spline is a loop: both ends are one point, so it counts twice and never reads as an open chain
      const k = e.closed === true ? 2 : 1;
      for (let i = 0; i < k; i++) { bump(e.pts[0]); bump(e.pts[e.pts.length - 1]); }
    }
  }
  return d;
}
export const chainEntities = (ents: Ent[]) => ents.filter((e) => e.type === 'line' || e.type === 'arc' || e.type === 'spline' || e.type === 'cvspline');
export const hasCircle = (s: Feat): boolean => entitiesOf(s).some((e) => e.type === 'circle' || e.type === 'ellipse' || e.type === 'text');   // lettering is closed loops too
/** A chain of lines / arcs with two loose ends (what a rib is drawn from). */
export const isOpenSketch = (s: Feat): boolean => {
  if (s.type === 'sketch3d') return isSplinePath(s);   // a 3D sketch is a path when it holds one open spline (the only 3D path the kernel sweeps)
  const ents = entitiesOf(s);
  const chain = chainEntities(ents);
  return chain.length > 0 && !hasCircle(s) && [...degrees(ents).values()].some((n) => n === 1);
};
/** Something that bounds a region: a circle / ellipse, or lines and arcs that all meet in pairs. */
export const isClosedSketch = (s: Feat): boolean => {
  if (s.type === 'sketch3d') return false;
  const ents = entitiesOf(s);
  if (hasCircle(s)) return true;
  const d = degrees(ents);
  return chainEntities(ents).length > 0 && d.size > 0 && [...d.values()].every((n) => n >= 2);
};
/** A sketch whose only (non-construction) entity is one point: a loft can end in it (the apex). */
export const isPointSketch = (s: Feat): boolean => {
  if (s.type === 'sketch3d') return false;
  const ents = entitiesOf(s);
  return ents.length === 1 && ents[0].type === 'point';
};
export const hasCurves = (s: Feat): boolean => s.type !== 'sketch3d' && (hasCircle(s) || chainEntities(entitiesOf(s)).length > 0);

/** Whether this feature leaves a surface body: the types above, a Knit that is not a solid, a Sweep or Loft asked for a surface. */
export const isSurfaceFeature = (f: Feat): boolean =>
  SURFACE_TYPES.includes(f.type) || (f.type === 'knit' && f.solid !== true) || ((f.type === 'loft' || f.type === 'sweep') && f.surface === true);
