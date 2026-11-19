import { isPlaneId, type PlaneId } from './planeNames';

/** What the Sketch button (and S) starts a sketch on. */
export type SketchTarget =
  | { kind: 'face'; id: string }
  | { kind: 'plane'; id: PlaneId }
  | { kind: 'feature'; id: string }
  /** nothing suitable is selected: the plane the last sketch was started on */
  | { kind: 'last'; id: PlaneId };

/** Picks the target: the selected face, else the selected origin plane, else the selected plane feature, else the last-used plane; null when none of them applies. */
export function sketchTarget(s: { face: string | null; plane: string | null; feature: string | null; last: string | null }): SketchTarget | null {
  if (s.face) return { kind: 'face', id: s.face };
  if (isPlaneId(s.plane)) return { kind: 'plane', id: s.plane };
  if (s.feature) return { kind: 'feature', id: s.feature };
  if (isPlaneId(s.last)) return { kind: 'last', id: s.last };
  return null;
}

const KEY = 'cad.lastSketchPlane';
/** The origin plane the last sketch was started on (kept per device). */
export const lastSketchPlane = {
  get(): PlaneId | null { try { const v = localStorage.getItem(KEY); return isPlaneId(v) ? v : null; } catch { return null; } },
  set(id: PlaneId): void { try { localStorage.setItem(KEY, id); } catch { /* private window */ } },
};
