// Where every command sits on the three toolbars. Pure data: the ribbon (top), the tool palette (left edge) and the
// right-click flyouts all read the same SLOTS, so a slot shows the tool you used last wherever it appears, and
// adding a command to a slot adds it everywhere. Command ids and keys are defined in commands.ts and are not touched here.
import type { RibbonEntry } from '@kit/ui';

/** Commands whose ids are reserved here before the command exists (their icons exist already). Slots may list them; the tests do not
 *  require them to be registered, and the toolbars skip ids that are not. */
export const PLANNED: string[] = [];

/** THE table: slot id -> its commands in order (first is the default). The ribbon (`RIBBON_LAYOUT`) and the tool palette
 *  (`RAIL_SECTIONS`) only say where each slot goes, so adding a command is one id in one slot below (plus its icon). Families of commands that share one button. The first id is the default; the button then shows the one used last. */
export const SLOTS: Record<string, string[]> = {
  'new-sketch': ['sketch-here', 'sketch-on-face', 'sketch-new-front', 'sketch-new-top', 'sketch-new-right', 'sketch-from-dxf'],
  extrude: ['add-extrude', 'add-cut'],
  thin: ['add-thin-extrude', 'add-thin-cut', 'add-thin-revolve'],
  hole: ['add-hole', 'add-thread'],
  catalog: ['open-catalog', 'open-variables', 'open-script'],
  'edge-round': ['add-fillet', 'add-chamfer'],
  draft: ['add-draft', 'add-rib', 'add-lip'],
  pattern: ['add-lpattern', 'add-cpattern'],
  'loft-sweep': ['add-loft', 'add-sweep'],
  gear: ['add-gear', 'add-gear-pair'],
  reference: ['add-plane', 'add-axis', 'add-helix'],
  'delete-geom': ['add-delete-body', 'add-delete-face'],
  'surface-new': ['add-surface-planar', 'add-surface-extrude', 'add-surface-revolve', 'add-surface-loft'],
  'surface-reshape': ['add-fill', 'add-extend'],
  'surface-edit': ['add-trim-surface', 'add-knit', 'add-thicken'],
  history: ['rebuild', 'rename', 'suppress-selected', 'delete-feature', 'roll-forward'],
  export: ['export', 'export-step', 'export-stl', 'export-stl-ascii', 'export-obj', 'export-dxf-sketch', 'export-dxf-views'],
  views: ['view-iso', 'view-top', 'view-front', 'view-right', 'view-back', 'view-left', 'view-bottom'],
  style: ['style-shaded', 'style-shadedEdges', 'style-wireframe', 'style-hiddenLines', 'style-ghost'],
  light: ['light-studio', 'light-flat', 'light-contrast', 'light-technical'],
  background: ['bg-theme', 'bg-light', 'bg-dark', 'bg-gradient'],
  layers: ['layer-edges', 'layer-sketches', 'layer-curves', 'layer-planes', 'layer-axes', 'layer-grid', 'layer-relations', 'layer-dimensions', 'layer-threads'],
  'pick-mode': ['sel-face', 'sel-edge', 'sel-vertex', 'sel-body'],
  'pick-grow': ['select-tangent', 'select-parallel', 'select-similar', 'select-loop', 'select-connected', 'select-same-size'],
  'pick-set': ['select-all', 'select-invert', 'select-none', 'select-box', 'select-body'],
  measure: ['measure', 'mass-props', 'interference', 'section-view'],
  'surface-check': ['analysis-zebra', 'analysis-gaussian', 'analysis-mean', 'analysis-draft', 'analysis-comb'],
  'asm-parts': ['insert-part', 'mate'],
  'asm-review': ['bom', 'explode', 'asm-interference'],
};

const slot = (id: string, extra: Partial<Extract<RibbonEntry, object>> = {}): RibbonEntry => ({ slot: id, ids: SLOTS[id], ...extra });

/** The ribbon: tabs of titled groups. Group titles are `group.<id>` in the catalogue. */
export const RIBBON_LAYOUT: Record<string, Array<{ id: string; entries: RibbonEntry[] }>> = {
  Home: [
    { id: 'Sketch', entries: [slot('new-sketch'), 'sketch-import-dxf'] },
    { id: 'Create', entries: [slot('extrude'), slot('thin'), 'add-revolve', slot('loft-sweep'), slot('hole'), slot('catalog')] },
    { id: 'Modify', entries: [slot('edge-round'), 'add-shell'] },
    { id: 'Pattern', entries: [slot('pattern')] },
    { id: 'Edit', entries: ['undo', 'redo', slot('history')] },
  ],
  Features: [
    { id: 'Reference', entries: [slot('reference')] },
    { id: 'Create', entries: [slot('gear')] },
    { id: 'Modify', entries: [slot('draft'), 'add-mirror', 'add-pipe-cut'] },
    { id: 'Bodies', entries: [slot('delete-geom')] },
  ],
  Surfaces: [
    { id: 'Create', entries: [slot('surface-new'), slot('surface-reshape')] },
    { id: 'Edit', entries: [slot('surface-edit')] },
  ],
  View: [
    { id: 'Views', entries: [slot('views'), 'fit', 'toggle-projection', 'toggle-up-axis'] },
    { id: 'Style', entries: [slot('style', { radio: true }), 'hide-selection', 'show-all'] },
    { id: 'Appearance', entries: [slot('light', { radio: true }), slot('background', { radio: true }), slot('layers', { menu: true, keepOpen: true, icon: 'display', title: 'group.Show' })] },
    { id: 'Workspace', entries: ['palette', 'toggle-left-panel', 'drawer', 'reset-layout', 'settings'] },
  ],
  Select: [
    { id: 'Pick', entries: [slot('pick-mode'), slot('pick-set')] },
    { id: 'Expand', entries: [slot('pick-grow')] },
    { id: 'Position', entries: ['triball'] },
  ],
  Evaluate: [
    { id: 'Measure', entries: [slot('measure')] },
    { id: 'Surface analysis', entries: [slot('surface-check')] },
  ],
  Assembly: [
    { id: 'Components', entries: [slot('asm-parts')] },
    { id: 'Review', entries: [slot('asm-review')] },
  ],
};

/** The tool palette on the left edge: sections of slots (a bare id is a single-command cell). A section with no
 *  command in this build is skipped. Above these the palette adds a "For selection" slot when something is selected. */
export const RAIL_SECTIONS: { id: string; entries: RibbonEntry[] }[] = [
  { id: 'history', entries: ['undo', 'redo', slot('history')] },
  { id: 'sketch', entries: [slot('new-sketch'), 'sketch-import-dxf'] },
  { id: 'create', entries: [slot('extrude'), slot('thin'), 'add-revolve', slot('loft-sweep'), slot('hole'), slot('gear'), slot('reference'), slot('catalog')] },
  { id: 'modify', entries: [slot('edge-round'), 'add-shell', slot('draft'), 'add-mirror', 'triball', 'add-pipe-cut', slot('delete-geom')] },
  { id: 'surfaces', entries: [slot('surface-new'), slot('surface-reshape'), slot('surface-edit')] },
  { id: 'pattern', entries: [slot('pattern')] },
  { id: 'inspect', entries: [slot('measure'), slot('surface-check')] },
  { id: 'assembly', entries: [slot('asm-parts'), slot('asm-review')] },
  { id: 'select', entries: [slot('pick-mode'), slot('pick-grow'), slot('pick-set')] },
];

/** Commands that have no cell on the palette on purpose: files, export, camera and display settings live in the ribbon
 *  and the command search only. Everything else (every modelling, surface, inspect, assembly and selection command) must be on it. */
export const notOnRail = (id: string): boolean =>
  /^(layer-|export|view-|style-|light-|bg-)/.test(id) ||
  ['new-part', 'open', 'save', 'save-as', 'samples', 'import-step', 'palette', 'drawer', 'settings', 'toggle-left-panel', 'reset-layout', 'toggle-projection', 'toggle-up-axis', 'fit', 'hide-selection', 'show-all'].includes(id);

// ---- contextual ribbon: which tab shows, which commands are idle -----------------------------------------------------------

/** File commands live in the top bar (New, Open, Save, Export, Samples and its file menu), never on a ribbon tab. The ribbon leaves them out. */
export const isFileCommand = (id: string): boolean =>
  /^export/.test(id) || ['new-part', 'open', 'save', 'save-as', 'samples', 'import-step'].includes(id);

/** The contextual tab that replaces the others while a sketch is open. */
export const SKETCH_TAB = 'Sketch';

export type DocKind = 'part' | 'assembly';
/** A document that holds inserted components is an assembly. */
export const docKindOf = (doc: { features: Array<{ type?: string }> } | null | undefined): DocKind =>
  doc && doc.features.some((f) => f.type === 'insertPart') ? 'assembly' : 'part';

/** The tab the ribbon draws: the Sketch tab while a sketch is open, else the tab the user picked (which is kept, so leaving the sketch restores it). */
export const activeRibbonTab = (userTab: string, sketching: boolean): string => (sketching ? SKETCH_TAB : userTab);

/** The tab to select when the document kind changes: an assembly opens on the Assembly tab; leaving one drops that tab back to Home. Else unchanged. */
export function tabForKindChange(prev: DocKind | null, next: DocKind, userTab: string): string {
  if (prev === next) return userTab;
  if (next === 'assembly') return 'Assembly';
  return userTab === 'Assembly' ? 'Home' : userTab;
}

/** Ids of the commands that make or change geometry (the Sketch, Create, Modify, Pattern, Reference, Bodies and Components groups of the model tabs). */
export const MODEL_COMMANDS: ReadonlySet<string> = new Set(
  Object.entries(RIBBON_LAYOUT).filter(([tab]) => ['Home', 'Features', 'Surfaces', 'Assembly'].includes(tab))
    .flatMap(([tab, gs]) => gs.filter((g) => !(tab === 'Home' && g.id === 'Edit') && g.id !== 'Review').flatMap((g) => g.entries.flatMap((e) => (typeof e === 'string' ? [e] : 'ids' in e ? e.ids : [])))),
);

/** While a feature editor is open the model commands are greyed out (Undo, Redo, view, selection and inspection stay). */
export const idleDuringEdit = (id: string): boolean => MODEL_COMMANDS.has(id);

// ---- the sketch-mode UI: who owns what ------------------------------------------------------------------------------------

/** What the chrome shows while a sketch is open, from the workspace settings. Always: ONE sketch bar at the top centre (name, OK /
 *  Cancel, modes, definition badge, Fully define, Snaps, Display). The sketch tools have exactly one home:
 *  - ribbon on: the contextual Sketch tab; the right-hand palette only if the Tool palette (`sketchPalette`) setting is on; a left
 *    tool column, if enabled, shrinks to undo / redo / rebuild (the tools are on the tab, the model groups are hidden);
 *  - ribbon off with the left column on (Plasticity): the left column swaps to the sketch tool groups (undo / redo / rebuild stay
 *    at its top, the model groups are hidden), no right-hand palette;
 *  - ribbon off and no left column (Minimal): the floating right-hand palette, as nothing else would carry the tools. */
export interface SketchChrome { ribbonTab: boolean; leftColumn: 'model' | 'sketch' | 'history' | 'none'; rightPalette: boolean; bar: boolean }
export function sketchChrome(ws: { ribbon: string; toolRail: boolean; sketchPalette: boolean }, sketching: boolean): SketchChrome {
  if (!sketching) return { ribbonTab: false, leftColumn: ws.toolRail ? 'model' : 'none', rightPalette: false, bar: false };
  const ribbon = ws.ribbon !== 'off';
  const column = !ribbon && ws.toolRail;
  return {
    ribbonTab: ribbon,
    leftColumn: ws.toolRail ? (ribbon ? 'history' : 'sketch') : 'none',
    rightPalette: ribbon ? ws.sketchPalette : !column,
    bar: true,
  };
}
