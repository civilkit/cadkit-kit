import { signal, type Signal } from '@preact/signals-core';

export type SelectionMode = 'face' | 'edge' | 'vertex' | 'body';
/** What the selection filters let the pointer pick. */
export type PickFilterKind = 'faces' | 'edges' | 'vertices' | 'bodies' | 'sketches' | 'planes';
export type PickFilters = Record<PickFilterKind, boolean>;
export const PICK_FILTER_KINDS: PickFilterKind[] = ['faces', 'edges', 'vertices', 'bodies', 'sketches', 'planes'];
export const ALL_PICKABLE: PickFilters = { faces: true, edges: true, vertices: true, bodies: true, sketches: true, planes: true };
/** The filter that governs each pick mode. */
export const MODE_FILTER: Record<SelectionMode, PickFilterKind> = { face: 'faces', edge: 'edges', vertex: 'vertices', body: 'bodies' };

/** Name of a corner pick: its position, rounded so the same corner always gets the same name (faces and edges have kernel names). */
export const vertexName = (p: number[]): string => `v:${p.map((x) => (Math.round(x * 1e4) / 1e4).toString()).join(',')}`;
export const parseVertexName = (n: string): number[] | null => (n.startsWith('v:') ? n.slice(2).split(',').map(Number) : null);
/** Selection name of the whole body (Alt+click in the viewport, the Select body command). */
export const BODY = '@body';
export interface Notice { id: number; text: string; level: 'info' | 'warn' | 'error'; /** when it was raised (ms since the epoch) */ at?: number; /** a button on the toast, e.g. Undo */ action?: { label: string; run(): void } }
export type DisplayLayer = 'sketches' | 'curves' | 'planes' | 'axes' | 'relations' | 'edges' | 'hidden' | 'grid' | 'dimensions' | 'threads' | 'issues';
export type Display = Record<DisplayLayer, boolean>;
export const DEFAULT_DISPLAY: Display = { sketches: true, curves: true, planes: true, axes: true, relations: true, edges: true, hidden: false, grid: true, dimensions: false, threads: true, issues: false };
export interface Workspace {
  ribbon: 'full' | 'compact' | 'off';
  leftPanel: 'docked' | 'floating' | 'hidden';
  leftCollapsed: boolean;                  // the left panel (outliner, features, editor, assets) is folded away
  leftTabs: boolean;                       // Outliner / Features / Assets tabs instead of one list
  rightPanel: 'off' | 'docked' | 'floating';
  toolRail: boolean;
  toolLabels: 'icons' | 'icons-and-text';   // buttons show an icon only (label on hover) or icon and text
  selectionBar: boolean;
  commandBar: boolean;
  drawerOpen: boolean;
  handles: boolean;                        // direct-manipulation handles on the canvas (arrows and dots to drag)
  opacity: number;                         // 0.15..1, floating panels
  blur: number;                            // px
  lineWidth: number;                       // px, thickness of the hover and selection highlight lines (1..8)
  leftWidth: number;                       // px, docked left panel
  rightWidth: number;                      // px, docked right panel
  drawerHeight: number;                    // px, bottom drawer
  floatWidth: number;                      // px, floating left panel
  floatHeight: number;                     // px, floating left panel; 0 = fill the viewport height
}
/** Default panel sizes; "Reset layout" restores these. */
export const DEFAULT_SIZES = { leftWidth: 280, rightWidth: 280, drawerHeight: 210, floatWidth: 264, floatHeight: 0 } as const;
export const SIZE_KEYS = ['leftWidth', 'rightWidth', 'drawerHeight', 'floatWidth', 'floatHeight'] as const;
export type WorkspacePreset = 'plasticity' | 'classic' | 'minimal';
export const WORKSPACE_PRESETS: Record<WorkspacePreset, Workspace> = {
  plasticity: { ribbon: 'off', leftPanel: 'docked', leftTabs: true, leftCollapsed: false, rightPanel: 'off', toolRail: true, toolLabels: 'icons-and-text', selectionBar: true, commandBar: true, drawerOpen: true, handles: true, opacity: 0.62, blur: 14, lineWidth: 3, ...DEFAULT_SIZES },
  classic: { ribbon: 'full', leftPanel: 'docked', leftTabs: false, leftCollapsed: false, rightPanel: 'docked', toolRail: false, toolLabels: 'icons-and-text', selectionBar: false, commandBar: false, drawerOpen: false, handles: true, opacity: 1, blur: 0, lineWidth: 3, ...DEFAULT_SIZES },
  minimal: { ribbon: 'off', leftPanel: 'floating', leftTabs: false, leftCollapsed: false, rightPanel: 'off', toolRail: false, toolLabels: 'icons-and-text', selectionBar: false, commandBar: false, drawerOpen: false, handles: true, opacity: 0.5, blur: 14, lineWidth: 3, ...DEFAULT_SIZES },
};
/** Merge stored workspace settings over the default preset, dropping unknown keys and bad values. */
export function sanitizeWorkspace(raw: unknown, base: Workspace = WORKSPACE_PRESETS.plasticity): Workspace {
  const out: Workspace = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const pick = <T extends string>(k: keyof Workspace, ok: readonly T[]) => { if (typeof r[k] === 'string' && (ok as readonly string[]).includes(r[k] as string)) (out as unknown as Record<string, unknown>)[k] = r[k]; };
  pick('ribbon', ['full', 'compact', 'off'] as const);
  pick('leftPanel', ['docked', 'floating', 'hidden'] as const);
  pick('rightPanel', ['off', 'docked', 'floating'] as const);
  pick('toolLabels', ['icons', 'icons-and-text'] as const);
  for (const k of ['leftTabs', 'leftCollapsed', 'toolRail', 'selectionBar', 'commandBar', 'drawerOpen', 'handles'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (typeof r.opacity === 'number' && Number.isFinite(r.opacity)) out.opacity = Math.min(1, Math.max(0.15, r.opacity));
  if (typeof r.blur === 'number' && Number.isFinite(r.blur)) out.blur = Math.min(30, Math.max(0, r.blur));
  if (typeof r.lineWidth === 'number' && Number.isFinite(r.lineWidth)) out.lineWidth = Math.min(8, Math.max(1, r.lineWidth));
  for (const k of SIZE_KEYS) if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = Math.round(Math.min(4000, Math.max(0, r[k] as number)));
  return out;
}
export interface FeatureStatus { id: string; ok: boolean; code?: string; hint?: string; }
/** A regen warning on a feature (the feature still works): the first one's code, the hints of all joined; `params` is the kernel's, `all` lists every warning when there are several. */
export interface FeatureWarning { code: string; hint: string; params?: Record<string, unknown>; all?: Array<{ code: string; hint: string; params?: Record<string, unknown> }> }

export function createStore(initialDisplay: Partial<Display> = {}, initialWorkspace?: unknown) {
  let noticeSeq = 1;
  const selection = signal<string[]>([]);
  const mode = signal<SelectionMode>('face');
  const hover = signal<string | null>(null);
  const filters = signal<PickFilters>({ ...ALL_PICKABLE });
  const tool = signal<string | null>(null);
  const busy = signal(false);
  const notices = signal<Notice[]>([]);
  const featureStatus = signal<FeatureStatus[]>([]);
  const featureWarnings = signal<Record<string, FeatureWarning>>({});
  const display = signal<Display>({ ...DEFAULT_DISPLAY, ...initialDisplay });
  const workspace = signal<Workspace>(sanitizeWorkspace(initialWorkspace));
  const facts = signal<{ faces: number; triangles: number; rebuildMs: number | null }>({ faces: 0, triangles: 0, rebuildMs: null });

  const notify = (text: string, level: Notice['level'] = 'info', action?: Notice['action']) => {
    notices.value = [...notices.value, { id: noticeSeq++, text, level, at: Date.now(), ...(action ? { action } : {}) }].slice(-20);
  };
  return {
    selection, mode, hover, filters, tool, busy, notices, featureStatus, featureWarnings, display, workspace, facts, notify,
    setWorkspace(patch: Partial<Workspace>) { workspace.value = sanitizeWorkspace({ ...workspace.value, ...patch }, workspace.value); },
    resetLayout() { workspace.value = sanitizeWorkspace({ ...workspace.value, ...DEFAULT_SIZES, leftCollapsed: false }, workspace.value); },
    applyPreset(name: WorkspacePreset) { const w = workspace.value; workspace.value = { ...WORKSPACE_PRESETS[name], leftWidth: w.leftWidth, rightWidth: w.rightWidth, drawerHeight: w.drawerHeight, floatWidth: w.floatWidth, floatHeight: w.floatHeight }; },
    setFilter(kind: PickFilterKind, on: boolean) { filters.value = { ...filters.value, [kind]: on }; },
    setDisplay(layer: DisplayLayer, on: boolean) { display.value = { ...display.value, [layer]: on }; },
    select(names: string[], additive = false) {
      selection.value = additive ? [...new Set([...selection.value, ...names])] : [...names];
    },
    toggle(name: string) {
      selection.value = selection.value.includes(name)
        ? selection.value.filter((n) => n !== name)
        : [...selection.value, name];
    },
    dropMissing(existing: Set<string>): string[] {
      const dropped = selection.value.filter((n) => !existing.has(n));
      if (dropped.length) {
        selection.value = selection.value.filter((n) => existing.has(n));
        notify(`Selection lost: ${dropped.join(', ')} no longer exists`, 'warn');
      }
      return dropped;
    },
  };
}
export type Store = ReturnType<typeof createStore>;
/** Which preset the workspace currently is, comparing the layout choices (not opacity, blur, labels or the collapsed state),
 *  or null when it is a mix. The Settings dialog shows this instead of a blank "Choose...". */
export function matchPreset(w: Workspace): WorkspacePreset | null {
  const keys = ['ribbon', 'leftPanel', 'leftTabs', 'rightPanel', 'toolRail', 'selectionBar', 'commandBar', 'drawerOpen'] as const;
  for (const name of Object.keys(WORKSPACE_PRESETS) as WorkspacePreset[]) {
    const p = WORKSPACE_PRESETS[name];
    if (keys.every((k) => w[k] === p[k])) return name;
  }
  return null;
}
