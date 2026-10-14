/** The ball's snap increments (Ctrl while dragging): remembered in the browser. */
export interface TriPrefs { distance: number; angle: number }
export const DEFAULT_TRI_PREFS: TriPrefs = { distance: 10, angle: 15 };
const KEY = 'cad.triball';
const pos = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
export function sanitizeTriPrefs(raw: unknown): TriPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { distance: pos(r.distance, DEFAULT_TRI_PREFS.distance), angle: Math.min(180, pos(r.angle, DEFAULT_TRI_PREFS.angle)) };
}
export function loadTriPrefs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): TriPrefs {
  try { return sanitizeTriPrefs(JSON.parse(storage?.getItem(KEY) ?? 'null')); } catch { return DEFAULT_TRI_PREFS; }
}
export function saveTriPrefs(p: TriPrefs, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* private window */ }
}
