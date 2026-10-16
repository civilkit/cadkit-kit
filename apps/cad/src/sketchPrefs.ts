/** How the sketch editor takes input: user settings, remembered in the browser. They feed the tools' `ToolSettings`
 *  (auto constraints, tangent-arc switching, on-view value entry) plus the grid snap. */
import { ALL_SNAPS, SNAP_KINDS, type SnapToggles, type ToolSettings } from '@kit/sketch';

export interface SketchPrefs {
  /** Infer horizontal, vertical, coincident and tangent while drawing (Shift at a click suppresses it). */
  autoConstraints: boolean;
  /** A click on a snap or alignment guide also adds its constraint (midpoint, on-curve, aligned ...). Off by default: a guide only places the point. */
  guideConstraints: boolean;
  /** Entering a sketch leaves the camera exactly where it is (Look normal turns it square to the plane). Off: the view squares up to the sketch plane on entry. */
  keepView: boolean;
  /** How a line becomes a tangent arc: rest the pointer on the end (`hover`), keys and drag only (`keys`), or never (`off`). */
  arcSwitch: 'hover' | 'keys' | 'off';
  /** Typed values beside the pointer: for dimensions and positions, dimensions only, or none. */
  onViewValues: 'both' | 'dimensions' | 'off';
  /** The pointer lands on grid points when nothing else is near. */
  gridSnap: boolean;
  /** Which snaps are on (the snaps popover); `grid` here is `gridSnap` and is kept in step with it. */
  snaps: SnapToggles;
  /** What the sketch shows (the display popover). */
  show: SketchShow;
}

export interface SketchShow {
  /** Driving dimension labels. */
  dimensions: boolean;
  /** Relation glyphs (H, V, =, tangent ...). */
  relations: boolean;
  /** Reference (driven) dimensions, in brackets. */
  reference: boolean;
  /** Colour geometry by how defined it is (blue under, dark fully, red over). */
  colours: boolean;
  /** The constraints panel. */
  panel: boolean;
}
export const DEFAULT_SHOW: SketchShow = { dimensions: true, relations: true, reference: true, colours: true, panel: true };

export const DEFAULT_SKETCH_PREFS: SketchPrefs = { autoConstraints: true, guideConstraints: false, keepView: true, arcSwitch: 'hover', onViewValues: 'dimensions', gridSnap: true, snaps: ALL_SNAPS, show: DEFAULT_SHOW };

const pick = <T extends string>(v: unknown, ok: readonly T[], fallback: T): T => ((ok as readonly unknown[]).includes(v) ? (v as T) : fallback);

const flags = <T extends object>(raw: unknown, defaults: T, keys: readonly (keyof T)[]): T => {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...defaults } as Record<string, boolean>;
  for (const k of keys) if (typeof r[k as string] === 'boolean') out[k as string] = r[k as string] as boolean;
  return out as T;
};

/** Merge stored values over the defaults, dropping anything unknown or invalid. */
export function sanitizeSketchPrefs(raw: unknown): SketchPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    autoConstraints: typeof r.autoConstraints === 'boolean' ? r.autoConstraints : DEFAULT_SKETCH_PREFS.autoConstraints,
    guideConstraints: typeof r.guideConstraints === 'boolean' ? r.guideConstraints : DEFAULT_SKETCH_PREFS.guideConstraints,
    keepView: typeof r.keepView === 'boolean' ? r.keepView : DEFAULT_SKETCH_PREFS.keepView,
    arcSwitch: pick(r.arcSwitch, ['hover', 'keys', 'off'] as const, DEFAULT_SKETCH_PREFS.arcSwitch),
    onViewValues: pick(r.onViewValues, ['both', 'dimensions', 'off'] as const, DEFAULT_SKETCH_PREFS.onViewValues),
    gridSnap: typeof r.gridSnap === 'boolean' ? r.gridSnap : DEFAULT_SKETCH_PREFS.gridSnap,
    snaps: flags(r.snaps, ALL_SNAPS, SNAP_KINDS),
    show: flags(r.show, DEFAULT_SHOW, Object.keys(DEFAULT_SHOW) as Array<keyof SketchShow>),
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
