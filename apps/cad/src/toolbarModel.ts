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
  'new-sketch': ['sketch-here', 'sketch-pick-plane', 'sketch-on-face', 'sketch-new-front', 'sketch-new-top', 'sketch-new-right', 'sketch-from-dxf', 'sketch-from-svg'],
  extrude: ['add-extrude', 'add-cut'],
  thin: ['add-thin-extrude', 'add-thin-cut', 'add-thin-revolve'],
  primitives: ['add-block', 'add-cylinder', 'add-sphere', 'add-cone', 'add-torus', 'add-boss', 'add-slot'],
  solids: ['add-pipe', 'add-coil', 'add-bounding-solid', 'add-wrap'],
  hole: ['add-hole', 'add-thread', 'teardrop-hole', 'heat-set-seat'],
  catalog: ['open-catalog', 'open-variables', 'open-script'],
  'edge-round': ['add-fillet', 'add-chamfer'],
  draft: ['add-draft', 'add-rib', 'add-lip', 'add-dome'],
  pattern: ['add-lpattern', 'add-cpattern', 'add-pathpattern'],
  'loft-sweep': ['add-loft', 'add-sweep'],
  gear: ['add-gear', 'add-gear-pair', 'add-propeller', 'add-impeller', 'add-knurl', 'add-screw', 'add-washer', 'fasten-hole', 'add-spring', 'add-nut', 'add-standoff', 'add-insert', 'add-case', 'add-tray', 'add-bearing'],
  curves: ['add-project-curve', 'add-edit-curve', 'add-offset-curve', 'add-composite-curve'],
  plugins: ['add-plugin', 'community-hub'],
  reference: ['add-plane', 'add-axis', 'add-connector', 'add-helix', 'add-project-curve', 'add-edit-curve', 'add-offset-curve', 'add-composite-curve'],
  'delete-geom': ['add-delete-body', 'add-delete-face'],
  'surface-new': ['add-surface-planar', 'add-surface-extrude', 'add-surface-revolve', 'add-surface-loft', 'add-sweep-surface', 'add-blend-surface'],
  'surface-reshape': ['add-fill', 'add-extend', 'add-offset-surface'],
  'surface-edit': ['add-trim-surface', 'add-knit', 'add-thicken', 'add-freeform'],
  history: ['rebuild', 'rename', 'suppress-selected', 'delete-feature', 'roll-forward'],
  export: ['export', 'export-step', 'export-stl', 'export-stl-ascii', 'export-stl-bodies', 'export-obj', 'export-3mf', 'print-plate', 'export-glb', 'export-usdz', 'export-html', 'export-urdf', 'export-dxf-sketch', 'export-dxf-views'],
  views: ['view-iso', 'view-top', 'view-front', 'view-right', 'view-back', 'view-left', 'view-bottom'],
  style: ['style-shaded', 'style-shadedEdges', 'style-wireframe', 'style-hiddenLines', 'style-ghost'],
  light: ['light-studio', 'light-flat', 'light-contrast', 'light-technical'],
  background: ['bg-theme', 'bg-light', 'bg-dark', 'bg-gradient'],
  layers: ['layer-edges', 'layer-sketches', 'layer-curves', 'layer-planes', 'layer-axes', 'layer-grid', 'layer-relations', 'layer-dimensions', 'layer-threads', 'layer-tangent'],
  'pick-mode': ['sel-face', 'sel-edge', 'sel-vertex', 'sel-body'],
  'pick-grow': ['select-tangent', 'select-parallel', 'select-similar', 'select-loop', 'select-connected', 'select-same-size', 'select-junction'],
  'pick-set': ['select-all', 'select-invert', 'select-none', 'select-box', 'select-body', 'show-in-tree'],
  measure: ['measure', 'mass-props', 'interference', 'check-intersection', 'section-view'],
  'surface-check': ['analysis-zebra', 'analysis-gaussian', 'analysis-mean', 'analysis-draft', 'analysis-comb'],
  'asm-parts': ['insert-part', 'mate'],
  'asm-review': ['bom', 'explode', 'asm-interference'],
};

const slot = (id: string, extra: Partial<Extract<RibbonEntry, object>> = {}): RibbonEntry => ({ slot: id, ids: SLOTS[id], ...extra });

/** The ribbon: tabs of titled groups. Group titles are `group.<id>` in the catalogue. */
export const RIBBON_LAYOUT: Record<string, Array<{ id: string; entries: RibbonEntry[] }>> = {
  Home: [
    { id: 'Sketch', entries: [slot('new-sketch', { fixed: true }), 'add-sketch3d'] },
    { id: 'Create', entries: [slot('extrude', { fixed: true }), slot('thin'), 'add-revolve', slot('loft-sweep'), slot('primitives'), slot('solids'), slot('hole'), slot('catalog')] },
    { id: 'Modify', entries: [slot('edge-round'), 'add-shell', 'add-press-pull'] },
    { id: 'Pattern', entries: [slot('pattern')] },
    { id: 'Edit', entries: ['undo', 'redo', 'repeat-last', slot('history'), 'group-selected'] },
  ],
  Features: [
    // Plain buttons where there is room: the tab is wide and short. The long parts family, the four curve tools and the plugin tools are dropdowns: a tab that outgrows one row loses its button names (Ribbon drops them to fit), so keep it narrow enough to show them.
    { id: 'Reference', entries: ['add-plane', 'add-axis', 'add-connector', 'add-helix', slot('curves')] },
    { id: 'Create', entries: [slot('gear'), slot('plugins')] },
    { id: 'Modify', entries: ['add-draft', 'add-rib', 'add-lip', 'add-dome', 'add-mirror', 'add-scale', 'add-split', 'add-split-face', 'add-combine', 'add-lip-joint', 'add-pipe-cut'] },
    { id: 'Bodies', entries: ['add-delete-body', 'add-delete-face'] },
  ],
  // Frame is its own tab (a phone's tool sheet shows the same tabs): plain buttons, no dropdown. Add the bracket and connector tools to this group.
  Frame: [
    { id: 'Frame', entries: ['add-frame', 'frame-cutlist'] },
  ],
  // Sheet metal: plain buttons in four groups. A command a layout does not place is appended to its own tab and group (resolveLayout), so a new sheet tool needs only its registry entry (sheet/sheetCommands.ts).
  Sheet: [
    { id: 'Rules', entries: ['sheet-rules'] },
    { id: 'Create', entries: ['add-base-flange', 'add-edge-flange', 'add-contour-flange', 'add-sheet-convert', 'add-hem', 'add-fold', 'add-sheet-cut', 'add-sheet-corner'] },
    { id: 'Flatten', entries: ['sheet-unfold', 'sheet-refold', 'sheet-flat'] },
    { id: 'FlatExport', entries: ['sheet-dxf', 'sheet-bends-csv', 'sheet-bends-json'] },
  ],
  // Surfaces: plain buttons, no dropdown (like Frame and Sheet metal), so every surface command is on show. The tool palette still groups them (RAIL_SECTIONS).
  Surfaces: [
    { id: 'Create', entries: ['add-surface-planar', 'add-surface-extrude', 'add-surface-revolve', 'add-surface-loft', 'add-sweep-surface', 'add-blend-surface', 'add-fill'] },
    { id: 'Edit', entries: ['add-offset-surface', 'add-extend', 'add-trim-surface', 'add-knit', 'add-thicken', 'add-freeform'] },
  ],
  View: [
    { id: 'Views', entries: [slot('views'), 'fit', 'toggle-projection', 'toggle-up-axis'] },
    { id: 'Style', entries: [slot('style', { radio: true }), 'hide-selection', 'show-all'] },
    { id: 'Appearance', entries: [slot('light', { radio: true }), slot('background', { radio: true }), slot('layers', { menu: true, keepOpen: true, icon: 'display', title: 'group.Show' })] },
    { id: 'Workspace', entries: ['palette', 'toggle-left-panel', 'drawer', 'reset-layout', 'settings', 'keyboard-shortcuts'] },
  ],
  Select: [
    { id: 'Pick', entries: [slot('pick-mode'), slot('pick-set')] },
    { id: 'Expand', entries: [slot('pick-grow')] },
    { id: 'Position', entries: ['triball'] },
  ],
  Evaluate: [
    // plain buttons: Mass properties, Overlap and Section are one click each, not hidden in a dropdown (the palette keeps the one slot)
    { id: 'Measure', entries: [...SLOTS.measure] },
    { id: 'Surface analysis', entries: [slot('surface-check')] },
  ],
  Assembly: [
    { id: 'Components', entries: [slot('asm-parts')] },
    { id: 'Review', entries: [slot('asm-review')] },
  ],
  // Motion: drive a mechanism, key it over time, play it, export a clip (the timeline docks along the bottom of the view while this tab is open)
  Motion: [
    { id: 'Drive', entries: ['motion-drive', 'motion-find'] },
    { id: 'Study', entries: ['motion-new-study', 'motion-key', 'motion-autokey'] },
    { id: 'Playback', entries: ['motion-play'] },
    { id: 'Clip', entries: ['motion-export'] },
  ],
};

/** The tool palette on the left edge: sections of slots (a bare id is a single-command cell). A section with no
 *  command in this build is skipped. Above these the palette adds a "For selection" slot when something is selected. */
export const RAIL_SECTIONS: { id: string; entries: RibbonEntry[] }[] = [
  { id: 'history', entries: ['undo', 'redo', 'repeat-last', slot('history')] },
  { id: 'sketch', entries: [slot('new-sketch', { fixed: true }), 'add-sketch3d'] },
  { id: 'create', entries: [slot('extrude', { fixed: true }), slot('thin'), 'add-revolve', slot('loft-sweep'), slot('primitives'), slot('solids'), slot('hole'), slot('gear'), 'add-plugin', 'community-hub', slot('reference'), slot('catalog')] },
  { id: 'modify', entries: [slot('edge-round'), 'add-shell', 'add-press-pull', slot('draft'), 'add-mirror', 'add-scale', 'add-split', 'add-split-face', 'add-combine', 'add-lip-joint', 'triball', 'add-pipe-cut', slot('delete-geom')] },
  { id: 'frame', entries: ['add-frame', 'frame-cutlist'] },
  { id: 'sheet', entries: ['sheet-rules', 'add-base-flange', 'add-edge-flange', 'add-contour-flange', 'add-sheet-convert', 'add-hem', 'add-fold', 'add-sheet-cut', 'add-sheet-corner', 'sheet-unfold', 'sheet-refold', 'sheet-flat'] },
  { id: 'surfaces', entries: [slot('surface-new'), slot('surface-reshape'), slot('surface-edit')] },
  { id: 'pattern', entries: [slot('pattern')] },
  { id: 'inspect', entries: [slot('measure'), slot('surface-check')] },
  { id: 'assembly', entries: [slot('asm-parts'), slot('asm-review')] },
  { id: 'select', entries: [slot('pick-mode'), slot('pick-grow'), slot('pick-set')] },
];

/** Commands that have no cell on the palette on purpose: files (the sketch DXF/SVG imports live in the sketch ribbon), export, camera and display settings live in the ribbon
 *  and the command search only. Everything else (every modelling, surface, inspect, assembly and selection command) must be on it. */
export const notOnRail = (id: string): boolean =>
  /^(layer-|export|view-|style-|light-|bg-|motion-|sheet-(dxf|bends))/.test(id) ||
  ['new-part', 'open', 'save', 'save-as', 'embed-geometry', 'recover-versions', 'samples', 'import-step', 'mesh-to-solid', 'print-plate', 'sketch-import-dxf', 'sketch-import-svg', 'import-skp-hidden', 'rotate-skp', 'recognise-features', 'palette', 'keyboard-shortcuts', 'drawer', 'settings', 'toggle-left-panel', 'reset-layout', 'toggle-projection', 'toggle-up-axis', 'fit', 'hide-selection', 'show-all', 'group-selected'].includes(id);

// ---- contextual ribbon: which tab shows, which commands are idle -----------------------------------------------------------

/** File commands live in the top bar (New, Open, Save, Export, Samples and its file menu), never on a ribbon tab. The ribbon leaves them out. */
export const isFileCommand = (id: string): boolean =>
  /^export/.test(id) || ['new-part', 'open', 'save', 'save-as', 'embed-geometry', 'recover-versions', 'samples', 'import-step', 'mesh-to-solid', 'print-plate', 'sketch-import-dxf', 'sketch-import-svg', 'import-skp-hidden', 'rotate-skp', 'recognise-features'].includes(id);

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
  Object.entries(RIBBON_LAYOUT).filter(([tab]) => ['Home', 'Features', 'Frame', 'Sheet', 'Surfaces', 'Assembly'].includes(tab))
    .flatMap(([tab, gs]) => gs.filter((g) => !(tab === 'Home' && g.id === 'Edit') && g.id !== 'Review' && !(tab === 'Sheet' && g.id === 'FlatExport')).flatMap((g) => g.entries.flatMap((e) => (typeof e === 'string' ? [e] : 'ids' in e ? e.ids : []))))
    .filter((id) => id !== 'sheet-flat'),   // the flat pattern view and the exports only read the sheet
);

/** While a feature editor is open the model commands are greyed out (Undo, Redo, view, selection and inspection stay). */
export const idleDuringEdit = (id: string): boolean => MODEL_COMMANDS.has(id);

// ---- the sketch-mode UI: who owns what ------------------------------------------------------------------------------------

/** What the chrome shows while a sketch is open, from the workspace settings. With the ribbon on, the Sketch tab carries everything (Select, Finish, Make,
 *  the tool groups, Construction, Status) and nothing floats over the canvas; the floating sketch bar (`bar`) is the fallback for ribbon off. The sketch tools have exactly one home:
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
    bar: !ribbon,
  };
}

/** Command id of an installed plugin's generator (a Gear menu entry), and back. */
export const pluginCommandId = (pluginId: string, generatorId: string): string => `plugin:${pluginId}:${generatorId}`;

/** The layout with `ids` added to the end of the Gear menu: installed plugins' generators appear beside the built-in wizards. */
export function withGearIds<T extends Record<string, Array<{ id: string; entries: unknown[] }>>>(layout: T, ids: string[]): T {
  if (!ids.length) return layout;
  const out: Record<string, unknown> = {};
  for (const [tab, groups] of Object.entries(layout)) {
    out[tab] = groups.map((g) => ({ ...g, entries: g.entries.map((e) => (e && typeof e === 'object' && (e as { slot?: string }).slot === 'gear' ? { ...(e as object), ids: [...(e as { ids: string[] }).ids, ...ids] } : e)) }));
  }
  return out as T;
}

/** SolidCraft's Design tab names and the tab of ours each one is: a plugin entry that names `{kind: "ribbon", name: "Inspect"}` lands on our Evaluate tab. A name in neither list gets the Plugins tab. */
export const SLOT_TAB_ALIASES: Record<string, string> = { model: 'Home', manage: 'Home', insert: 'Features', surface: 'Surfaces', assemble: 'Assembly', inspect: 'Evaluate', 'sheet metal': 'Sheet metal', weldments: 'Frame' };
export const PLUGINS_TAB = 'Plugins';

export interface PluginSlotItem { /** the plugin's name: the group the entry goes in */ plugin: string; /** the entry's command id */ id: string; slots: ReadonlyArray<{ kind: 'menu' | 'ribbon'; name: string }> }

/** The layout with each plugin entry that declares a ribbon slot placed: in a group named for the plugin on the tab it names (ours or SolidCraft's name for it), or on one
 *  Plugins tab (a group per plugin) when it names no tab we have. Entries without a ribbon slot are untouched (they stay in the Gear menu and the Plugins list). */
export function withPluginSlots<T extends Record<string, Array<{ id: string; entries: unknown[] }>>>(layout: T, items: readonly PluginSlotItem[]): T {
  const tabs = new Map(Object.keys(layout).map((k) => [k.toLowerCase(), k]));
  const place = new Map<string, Map<string, string[]>>();
  for (const it of items) {
    for (const s of it.slots) {
      if (s.kind !== 'ribbon') continue;
      const n = s.name.trim().toLowerCase();
      const tab = tabs.get(n) ?? tabs.get((SLOT_TAB_ALIASES[n] ?? '').toLowerCase()) ?? PLUGINS_TAB;
      if (tab === SKETCH_TAB) continue;
      const byPlugin = place.get(tab) ?? place.set(tab, new Map()).get(tab)!;
      const ids = byPlugin.get(it.plugin) ?? byPlugin.set(it.plugin, []).get(it.plugin)!;
      if (!ids.includes(it.id)) ids.push(it.id);
    }
  }
  if (!place.size) return layout;
  const out: Record<string, Array<{ id: string; entries: unknown[] }>> = { ...layout };
  for (const [tab, byPlugin] of place) out[tab] = [...(layout[tab] ?? []), ...[...byPlugin].map(([plugin, ids]) => ({ id: plugin, entries: ids }))];
  return out as T;
}

/** The palette group of a plugin entry: File or Help when it asks for a menu of that name, else where installed entries have always been (Create). */
export const slotGroup = (slots: ReadonlyArray<{ kind: 'menu' | 'ribbon'; name: string }> | undefined): 'File' | 'Help' | 'Create' => {
  const m = (slots ?? []).find((s) => s.kind === 'menu' && /^(file|help)$/i.test(s.name.trim()));
  return m ? (m.name.trim().toLowerCase() === 'help' ? 'Help' : 'File') : 'Create';
};
