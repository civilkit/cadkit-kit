import { signal, type Signal } from '@preact/signals-core';

export type SelectionMode = 'face' | 'edge' | 'vertex';
export interface Notice { id: number; text: string; level: 'info' | 'warn' | 'error'; /** when it was raised (ms since the epoch) */ at?: number }
export type DisplayLayer = 'sketches' | 'curves' | 'planes' | 'axes' | 'relations' | 'edges' | 'hidden' | 'grid';
export type Display = Record<DisplayLayer, boolean>;
export const DEFAULT_DISPLAY: Display = { sketches: true, curves: true, planes: true, axes: true, relations: true, edges: true, hidden: false, grid: true };
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
  opacity: number;                         // 0.15..1, floating panels
  blur: number;                            // px
}
export type WorkspacePreset = 'plasticity' | 'classic' | 'minimal';
export const WORKSPACE_PRESETS: Record<WorkspacePreset, Workspace> = {
  plasticity: { ribbon: 'off', leftPanel: 'docked', leftTabs: true, leftCollapsed: false, rightPanel: 'off', toolRail: true, toolLabels: 'icons-and-text', selectionBar: true, commandBar: true, drawerOpen: true, opacity: 0.62, blur: 14 },
  classic: { ribbon: 'full', leftPanel: 'docked', leftTabs: false, leftCollapsed: false, rightPanel: 'docked', toolRail: false, toolLabels: 'icons-and-text', selectionBar: false, commandBar: false, drawerOpen: false, opacity: 1, blur: 0 },
  minimal: { ribbon: 'off', leftPanel: 'floating', leftTabs: false, leftCollapsed: false, rightPanel: 'off', toolRail: false, toolLabels: 'icons-and-text', selectionBar: false, commandBar: false, drawerOpen: false, opacity: 0.5, blur: 14 },
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
  for (const k of ['leftTabs', 'leftCollapsed', 'toolRail', 'selectionBar', 'commandBar', 'drawerOpen'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (typeof r.opacity === 'number' && Number.isFinite(r.opacity)) out.opacity = Math.min(1, Math.max(0.15, r.opacity));
  if (typeof r.blur === 'number' && Number.isFinite(r.blur)) out.blur = Math.min(30, Math.max(0, r.blur));
  return out;
}
export interface FeatureStatus { id: string; ok: boolean; code?: string; hint?: string; }

export function createStore(initialDisplay: Partial<Display> = {}, initialWorkspace?: unknown) {
  let noticeSeq = 1;
  const selection = signal<string[]>([]);
  const mode = signal<SelectionMode>('face');
  const hover = signal<string | null>(null);
  const tool = signal<string | null>(null);
  const busy = signal(false);
  const notices = signal<Notice[]>([]);
  const featureStatus = signal<FeatureStatus[]>([]);
  const display = signal<Display>({ ...DEFAULT_DISPLAY, ...initialDisplay });
  const workspace = signal<Workspace>(sanitizeWorkspace(initialWorkspace));
  const facts = signal<{ faces: number; triangles: number; rebuildMs: number | null }>({ faces: 0, triangles: 0, rebuildMs: null });

  const notify = (text: string, level: Notice['level'] = 'info') => {
    notices.value = [...notices.value, { id: noticeSeq++, text, level, at: Date.now() }].slice(-20);
  };
  return {
    selection, mode, hover, tool, busy, notices, featureStatus, display, workspace, facts, notify,
    setWorkspace(patch: Partial<Workspace>) { workspace.value = sanitizeWorkspace({ ...workspace.value, ...patch }, workspace.value); },
    applyPreset(name: WorkspacePreset) { workspace.value = { ...WORKSPACE_PRESETS[name] }; },
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
