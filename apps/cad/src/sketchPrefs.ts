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
  /** Squares the view up to the sketch plane when a NEW sketch starts, even with keepView on. Off by default (the sketch bar offers a one-click `Look normal (N)` instead). */
  autoLookNormal: boolean;
  /** How a line becomes a tangent arc: rest the pointer on the end (`hover`), keys and drag only (`keys`), or never (`off`). */
  arcSwitch: 'hover' | 'keys' | 'off';
  /** Typed values beside the pointer: for dimensions and positions, dimensions only, or none. */
  onViewValues: 'both' | 'dimensions' | 'off';
  /** The pointer lands on grid points when nothing else is near. */
  gridSnap: boolean;
  /** Master switch for point snapping (the status bar's Snap box); the grid has its own (`gridSnap`). */
  snapOn: boolean;
  /** Grid spacing in millimetres; 0 = automatic (adaptive, 1-2-5 steps). The grid still subdivides and merges with the zoom. */
  gridSpacing: number;
  /** Which snaps are on (the snaps popover); `grid` here is `gridSnap` and is kept in step with it. */
  snaps: SnapToggles;
  /** What the sketch shows (the display popover). */
  show: SketchShow;
}

/** The four show toggles the viewport Display menu offers while sketching. */
export const SKETCH_SHOW_KEYS = ['dimensions', 'relations', 'reference', 'colours'] as const;

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

export const DEFAULT_SKETCH_PREFS: SketchPrefs = { autoConstraints: true, guideConstraints: false, keepView: true, autoLookNormal: false, arcSwitch: 'hover', onViewValues: 'dimensions', gridSnap: true, snapOn: true, gridSpacing: 0, snaps: ALL_SNAPS, show: DEFAULT_SHOW };

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
    autoLookNormal: typeof r.autoLookNormal === 'boolean' ? r.autoLookNormal : DEFAULT_SKETCH_PREFS.autoLookNormal,
    arcSwitch: pick(r.arcSwitch, ['hover', 'keys', 'off'] as const, DEFAULT_SKETCH_PREFS.arcSwitch),
    onViewValues: pick(r.onViewValues, ['both', 'dimensions', 'off'] as const, DEFAULT_SKETCH_PREFS.onViewValues),
    gridSnap: typeof r.gridSnap === 'boolean' ? r.gridSnap : DEFAULT_SKETCH_PREFS.gridSnap,
    snapOn: typeof r.snapOn === 'boolean' ? r.snapOn : DEFAULT_SKETCH_PREFS.snapOn,
    gridSpacing: typeof r.gridSpacing === 'number' && r.gridSpacing >= 0 && Number.isFinite(r.gridSpacing) ? r.gridSpacing : 0,
    snaps: flags(r.snaps, ALL_SNAPS, SNAP_KINDS),
    show: flags(r.show, DEFAULT_SHOW, Object.keys(DEFAULT_SHOW) as Array<keyof SketchShow>),
  };
}

/** Does a click that snapped to a guide (midpoint, alignment, on-curve ...) also add that constraint? Only with Auto constraints AND Auto-constrain from guides on (default off), and not while Shift is held. The guides themselves are drawn either way. */
export const constrainsFromGuides = (p: Pick<SketchPrefs, 'autoConstraints' | 'guideConstraints'>, shift: boolean): boolean => p.autoConstraints && p.guideConstraints && !shift;

/** Offer the Look normal chip when the camera is more than this many degrees off the sketch plane's normal. */
export const LOOK_CHIP_DEG = 5;
export const lookChipNeeded = (angleDeg: number | null): boolean => angleDeg !== null && angleDeg > LOOK_CHIP_DEG;

export const toToolSettings = (p: SketchPrefs): ToolSettings => ({ autoConstraints: p.autoConstraints, arcSwitch: p.arcSwitch, onViewValues: p.onViewValues });

const KEY = 'cad.sketchPrefs';
export function loadSketchPrefs(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): SketchPrefs {
  try { return sanitizeSketchPrefs(JSON.parse(storage?.getItem(KEY) ?? 'null')); } catch { return DEFAULT_SKETCH_PREFS; }
}
export function saveSketchPrefs(p: SketchPrefs, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(KEY, JSON.stringify(p)); } catch { /* private window: keep the setting for this session only */ }
}
