// Where every command sits on the three toolbars. Pure data: the ribbon (top), the tool palette (left edge) and the
// right-click flyouts all read the same SLOTS, so a slot shows the tool you used last wherever it appears, and
// adding a command to a slot adds it everywhere. Command ids and keys are defined in commands.ts and are not touched here.
import type { RibbonLayout, RibbonEntry } from '@kit/ui';

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
  catalog: ['open-catalog', 'open-variables'],
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
  light: ['light-studio', 'light-flat', 'light-contrast'],
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
export const RIBBON_LAYOUT: RibbonLayout = {
  Home: [
    { id: 'File', entries: ['new-part', 'open', 'save', 'save-as', 'samples'] },
    { id: 'Export', entries: [slot('export'), 'import-step'] },
    { id: 'Sketch', entries: [slot('new-sketch'), 'sketch-import-dxf'] },
    { id: 'Create', entries: [slot('extrude'), slot('thin'), 'add-revolve', slot('hole'), slot('catalog')] },
    { id: 'Modify', entries: [slot('edge-round'), 'add-shell'] },
    { id: 'Pattern', entries: [slot('pattern')] },
    { id: 'Edit', entries: ['undo', 'redo', slot('history')] },
  ],
  Features: [
    { id: 'Reference', entries: [slot('reference')] },
    { id: 'Create', entries: [slot('loft-sweep'), slot('gear')] },
    { id: 'Modify', entries: [slot('draft'), 'add-mirror', 'add-pipe-cut'] },
    { id: 'Bodies', entries: [slot('delete-geom')] },
  ],
  Surfaces: [
    { id: 'Create', entries: [slot('surface-new'), slot('surface-reshape')] },
    { id: 'Edit', entries: [slot('surface-edit')] },
  ],
  View: [
    { id: 'Views', entries: [slot('views'), 'fit', 'toggle-projection'] },
    { id: 'Style', entries: [slot('style', { radio: true }), 'hide-selection', 'show-all'] },
    { id: 'Appearance', entries: [slot('light', { radio: true }), slot('background', { radio: true }), slot('layers', { menu: true, keepOpen: true, icon: 'display', title: 'group.Show' })] },
    { id: 'Workspace', entries: ['palette', 'toggle-left-panel', 'drawer', 'settings'] },
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
  ['new-part', 'open', 'save', 'save-as', 'samples', 'import-step', 'palette', 'drawer', 'settings', 'toggle-left-panel', 'toggle-projection', 'fit', 'hide-selection', 'show-all'].includes(id);
