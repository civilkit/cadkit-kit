/** How the sketch editor takes input: user settings, remembered in the browser. They feed the tools' `ToolSettings`
 *  (auto constraints, tangent-arc switching, on-view value entry) plus the grid snap. */
import type { ToolSettings } from '@kit/sketch';

export interface SketchPrefs {
  /** Infer horizontal, vertical, coincident and tangent while drawing (Shift at a click suppresses it). */
  autoConstraints: boolean;
  /** How a line becomes a tangent arc: rest the pointer on the end (`hover`), keys and drag only (`keys`), or never (`off`). */
  arcSwitch: 'hover' | 'keys' | 'off';
  /** Typed values beside the pointer: for dimensions and positions, dimensions only, or none. */
  onViewValues: 'both' | 'dimensions' | 'off';
  /** The pointer lands on grid points when nothing else is near. */
  gridSnap: boolean;
}

export const DEFAULT_SKETCH_PREFS: SketchPrefs = { autoConstraints: true, arcSwitch: 'hover', onViewValues: 'dimensions', gridSnap: true };

const pick = <T extends string>(v: unknown, ok: readonly T[], fallback: T): T => ((ok as readonly unknown[]).includes(v) ? (v as T) : fallback);

/** Merge stored values over the defaults, dropping anything unknown or invalid. */
export function sanitizeSketchPrefs(raw: unknown): SketchPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    autoConstraints: typeof r.autoConstraints === 'boolean' ? r.autoConstraints : DEFAULT_SKETCH_PREFS.autoConstraints,
    arcSwitch: pick(r.arcSwitch, ['hover', 'keys', 'off'] as const, DEFAULT_SKETCH_PREFS.arcSwitch),
    onViewValues: pick(r.onViewValues, ['both', 'dimensions', 'off'] as const, DEFAULT_SKETCH_PREFS.onViewValues),
    gridSnap: typeof r.gridSnap === 'boolean' ? r.gridSnap : DEFAULT_SKETCH_PREFS.gridSnap,
  };
}

export const toToolSettings = (p: SketchPrefs): ToolSettings => ({ autoConstraints: p.autoConstraints, arcSwitch: p.arcSwitch, onViewValues: p.onViewValues });

const KEY = 'cad.sketchPrefs';
export function loadSketchPrefs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): SketchPrefs {
  try { return sanitizeSketchPrefs(JSON.parse(storage?.getItem(KEY) ?? 'null')); } catch { return DEFAULT_SKETCH_PREFS; }
}
export function saveSketchPrefs(p: SketchPrefs, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* private window: keep the setting for this session only */ }
}
