/** How the 3D view navigates: which axis is up on screen, how a drag orbits and what it orbits around. These change the
 *  camera only; the model, its sketches, planes and files are the same on either setting. Remembered in the browser. */
import { ORBIT_MODES, ORBIT_PIVOTS, UP_AXES, type OrbitMode, type OrbitPivot, type UpAxis } from '@kit/viewport';

export interface NavPrefs { upAxis: UpAxis; orbitMode: OrbitMode; orbitPivot: OrbitPivot; /** how far one wheel turn zooms, relative to the default (1) */ zoomSpeed: number }
export const ZOOM_SPEEDS: readonly number[] = [0.5, 0.75, 1, 1.5, 2, 3];
export const DEFAULT_NAV_PREFS: NavPrefs = { upAxis: 'y', orbitMode: 'turntable', orbitPivot: 'centre', zoomSpeed: 1 };

const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => ((ok as readonly unknown[]).includes(v) ? (v as T) : d);

export function sanitizeNavPrefs(raw: unknown): NavPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    upAxis: pick(r.upAxis, UP_AXES, DEFAULT_NAV_PREFS.upAxis),
    orbitMode: pick(r.orbitMode, ORBIT_MODES, DEFAULT_NAV_PREFS.orbitMode),
    orbitPivot: pick(r.orbitPivot, ORBIT_PIVOTS, DEFAULT_NAV_PREFS.orbitPivot),
    zoomSpeed: typeof r.zoomSpeed === 'number' && ZOOM_SPEEDS.includes(r.zoomSpeed) ? r.zoomSpeed : DEFAULT_NAV_PREFS.zoomSpeed,
  };
}

const KEY = 'cad.navPrefs';
export function loadNavPrefs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): NavPrefs {
  try { return sanitizeNavPrefs(JSON.parse(storage?.getItem(KEY) ?? 'null')); } catch { return DEFAULT_NAV_PREFS; }
}
export function saveNavPrefs(p: NavPrefs, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* private window: keep the setting for this session only */ }
}

/** The up axis a document asks for (its `upAxis` field, written by a script's part().upAxis()), or null. It is a view hint: the camera only, never saved as the user's setting. */
export function docUpAxis(doc: unknown): UpAxis | null {
  const v = doc && typeof doc === 'object' ? (doc as { upAxis?: unknown }).upAxis : undefined;
  return (UP_AXES as readonly unknown[]).includes(v) ? (v as UpAxis) : null;
}
