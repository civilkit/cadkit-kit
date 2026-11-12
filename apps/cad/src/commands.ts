// The ribbon command table. A command is data (tab, group, label, enabled rule, handler); adding one adds a
// button without touching layout code. Handlers come in through `Actions` so this file has no DOM or kernel code.
import type { Command } from '@kit/ui';
import { selectCommands, type SelectActions } from './select/selectCommands';
import { t } from './i18n';
import type { DisplayLayer, SelectionMode } from '@kit/store';
import { featureCommands, type FeatureActions } from './featureCommands';
import { lookCommands, type LookActions } from './lookCommands';
import { fileCommands, type FileActions } from './files/fileCommands';
import { creatorCommands } from './featureCreators';
import { inspectCommands, type InspectActions } from './inspect/inspectCommands';
import { treeCommands, type TreeActions } from './treeCommands';
import { assemblyCommands, type AssemblyActions } from './assembly/assemblyCommands';
import { analysisCommands, type AnalysisActions } from './analysisCommands';
import { sheetCommands, type SheetActions } from './sheet/sheetCommands';

/** Import and export of files other than the part itself (see ioCommands in this file). */
export interface IoActions {
  /** Add the geometry of a DXF file to the sketch being edited. */
  importDxf(): void;
  /** Open a DXF file as a new sketch on the selected plane or face (front when none). */
  sketchFromDxf(): void;
  /** Add the geometry of an SVG file to the sketch being edited. */
  importSvg(): void;
  /** Open an SVG file as a new sketch on the selected plane or face (front when none). */
  sketchFromSvg(): void;
  isSketching(): boolean;
  /** Write the current part or sketch to a file in this format. */
  exportAs(kind: ExportKind): void;
  /** Open the top bar's Export menu. */
  openExportMenu(): void;
  /** Whether there is a solid to export / a sketch (open or selected) to export. */
  canExport(kind: ExportKind): boolean;
}

export type ExportKind = 'step' | 'stl' | 'stl-ascii' | 'obj' | '3mf' | 'glb' | 'dxf-sketch' | 'dxf-views';
/** The export commands in menu order; each is the command `export-<kind>`. */
export const EXPORT_KINDS: ExportKind[] = ['stl', 'stl-ascii', 'obj', '3mf', 'glb', 'step', 'dxf-sketch', 'dxf-views'];

export interface Actions {
  io?: IoActions;
  /** Save as and Import STEP (see files/). */
  files?: FileActions;
  /** Rename, delete, suppress, rebuild, select all, roll forward (see treeCommands.ts). */
  tree?: TreeActions;
  /** Fillet, chamfer, shell, hole, revolve and pattern commands (see featureCommands.ts). */
  features?: FeatureActions;
  /** Show the Catalog panel (shapes to drag onto the model). */
  catalog?(): void;
  variables?(): void;
  script?(): void;
  /** Open the Propeller wizard (see PropellerWizard.tsx). */
  propeller?(): void;
  /** Open the turbo-impeller wizard (see ImpellerWizard.tsx). */
  impeller?(): void;
  /** Open the Knurl wizard on the selected cylindrical face (see KnurlWizard.tsx). */
  knurl?(): void;
  /** Open the Screw wizard (see ScrewWizard.tsx). */
  screw?(): void;
  /** Open the Washer wizard (see WasherWizard.tsx). */
  washer?(): void;
  /** Open the Spring wizard (see SpringWizard.tsx). */
  spring?(): void;
  /** Open the 3D Sketch tool (sketch3d/Sketch3dPanel.tsx). */
  sketch3d?(): void;
  /** Open the Frame panel (frame/FramePanel.tsx) and the drawing of the part's frames with the cut list and bill of materials (frame/frameDrawing.ts). */
  frame?(): void;
  cutList?(): void;
  /** Open the Bearing wizard (see BearingWizard.tsx). */
  bearing?(): void;
  /** Display styles, lighting, background, hide / show all (see lookCommands.ts). */
  look?: LookActions;
  /** Measure, mass properties, interference and section view (see inspect/inspectCommands.ts). */
  inspect?: InspectActions;
  /** The Sheet metal tab: rules, flanges, hem, fold, unfold / refold, flat pattern and its exports (see sheet/sheetCommands.ts). */
  sheet?: SheetActions;
  /** Zebra, curvature maps, draft analysis and the curvature comb (see analysisCommands.ts). */
  analysis?: AnalysisActions;
  /** Insert part, mate, interference, bill of materials and exploded view (see assembly/). */
  assembly?: AssemblyActions;
  /** Body pick mode, box select, select tangent / parallel / similar / loop / connected, invert, none (see select/selectCommands.ts). */
  select?: SelectActions;
  open(): void;
  save(): void;
  samples(): void;
  undo(): void;
  redo(): void;
  hasDocument(): boolean;
  newPart(): void;
  /** Start a sketch on the one face that is selected. */
  sketchOnFace(): void;
  hasFaceSelection(): boolean;
  addExtrude(op: 'add' | 'cut', thin?: boolean): void;
  newSketch(plane: 'front' | 'top' | 'right'): void;
  palette(): void;
  toggleDrawer(): void;
  resetLayout?(): void;
  /** Sketch on the selected face or plane (S). */
  sketchHere(): void;
  /** Start a sketch by picking one of the origin planes (or a flat face) in the 3D view. */
  sketchPickPlane?(): void;
  toggleProjection(): void;
  /** Swap the camera's up axis between Y (default) and Z. */
  toggleUpAxis?(): void;
  toggleLeftPanel(): void;
  settings(): void;
  setView(v: 'iso' | 'front' | 'top' | 'right' | 'back' | 'left' | 'bottom'): void;
  fit(): void;
  setMode(m: SelectionMode): void;
  /** Select the whole body (the target of the placement gizmo). Alt+click does the same in the viewport. */
  selectBody?(): void;
  /** The move / rotate ball for the current selection (F10). */
  triball?: { toggle(): void; isOn(): boolean; canToggle(): boolean };
  mode(): SelectionMode;
  toggleLayer(l: DisplayLayer): void;
  layer(l: DisplayLayer): boolean;
}

/** Keys for the common commands, shown in tooltips and in the command search. Feature commands use Shift because the
 *  plain letters are taken (F search, Q/E pick, Z fit, and the sketch tools' own letters while sketching). */
export const SHORTCUTS: Record<string, string> = {
  'sketch-here': 'S',
  'add-extrude': 'Shift+E', 'add-cut': 'Shift+C', 'add-revolve': 'Shift+R', 'add-hole': 'Shift+H', 'add-thread': 'Shift+T',
  'add-fillet': 'Shift+F', 'add-chamfer': 'Shift+B', 'add-shell': 'Shift+S', 'add-lpattern': 'Shift+L', 'add-cpattern': 'Shift+P',
  'toggle-projection': 'P', export: 'Ctrl+E', 'layer-dimensions': 'Shift+D', 'new-part': 'Ctrl+N', open: 'Ctrl+O', save: 'Ctrl+S', undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z',
};

/** The command a key press runs, or undefined. A spec is `Key`, `Shift+Key`, `Ctrl+Key` or `Ctrl+Shift+Key` (Ctrl means Ctrl or Cmd). */
export function matchShortcut(cmds: Command[], e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; code?: string }): Command | undefined {
  const ctrl = e.ctrlKey || e.metaKey;
  // with Alt the key is often another character (macOS: Alt+H is a dead key), so read the physical key
  const code = e.code?.match(/^(?:Key|Digit)(.)$/);
  const key = e.altKey && code ? code[1].toLowerCase() : e.key.toLowerCase();
  return cmds.find((c) => {
    if (!c.keys) return false;
    const parts = c.keys.toLowerCase().split('+');
    const k = parts[parts.length - 1];
    return k === key && parts.includes('shift') === e.shiftKey && parts.includes('ctrl') === ctrl && parts.includes('alt') === e.altKey;
  });
}

/** The id of the command most recently run (Repeat last command runs it again). Module-level because the table is rebuilt on render. */
let lastCommandId: string | null = null;
/** Forget the remembered command (tests). */
export function resetLastCommand(): void { lastCommandId = null; }
const NOT_REPEATABLE = new Set(['palette', 'repeat-last']);

const LAYERS: DisplayLayer[] = ['edges', 'sketches', 'curves', 'planes', 'axes', 'grid', 'relations', 'dimensions', 'threads'];

export function buildCommands(a: Actions): Command[] {
  const cmds: Command[] = [
    { id: 'open', label: t('cmd.open'), tab: 'Home', group: 'File', run: a.open },
    { id: 'save', label: t('cmd.save'), tab: 'Home', group: 'File', enabled: a.hasDocument, run: a.save },
    { id: 'samples', label: t('cmd.samples'), tab: 'Home', group: 'File', run: a.samples },
    { id: 'palette', label: t('cmd.palette'), tab: 'Home', group: 'Workspace', keys: 'F', run: a.palette },
    ...(a.toggleUpAxis ? [{ id: 'toggle-up-axis', label: t('cmd.toggle-up-axis'), tab: 'Home' as const, group: 'View', run: a.toggleUpAxis }] : []),
    { id: 'toggle-projection', label: t('cmd.toggle-projection'), tab: 'Home', group: 'View', run: a.toggleProjection },
    { id: 'toggle-left-panel', label: t('cmd.toggle-left-panel'), tab: 'Home', group: 'Workspace', keys: '[', run: a.toggleLeftPanel },
    { id: 'drawer', label: t('cmd.drawer'), tab: 'Home', group: 'Workspace', keys: '\\', run: a.toggleDrawer },
    { id: 'reset-layout', label: t('cmd.reset-layout'), tab: 'Home', group: 'Workspace', run: () => a.resetLayout?.() },
    { id: 'settings', label: t('cmd.settings'), tab: 'Home', group: 'Workspace', run: a.settings },
    { id: 'new-part', label: t('cmd.new-part'), tab: 'Home', group: 'File', run: a.newPart },
    { id: 'add-extrude', label: t('cmd.add-extrude'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: () => a.addExtrude('add') },
    { id: 'add-cut', label: t('cmd.add-cut'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: () => a.addExtrude('cut') },
    { id: 'add-thin-extrude', label: t('cmd.add-thin-extrude'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: () => a.addExtrude('add', true) },
    { id: 'add-thin-cut', label: t('cmd.add-thin-cut'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: () => a.addExtrude('cut', true) },
    { id: 'sketch-here', label: t('cmd.sketch-here'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: a.sketchHere },
    { id: 'sketch-pick-plane', label: t('cmd.sketch-pick-plane'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: () => a.sketchPickPlane?.() },
    { id: 'sketch-on-face', label: t('cmd.sketch-on-face'), tab: 'Home', group: 'Sketch', enabled: a.hasFaceSelection, run: a.sketchOnFace },
    { id: 'sketch-new-front', label: t('cmd.sketch-new-front'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: () => a.newSketch('front') },
    { id: 'sketch-new-top', label: t('cmd.sketch-new-top'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: () => a.newSketch('top') },
    { id: 'sketch-new-right', label: t('cmd.sketch-new-right'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: () => a.newSketch('right') },
    { id: 'undo', label: t('cmd.undo'), tab: 'Home', group: 'Edit', enabled: a.hasDocument, run: a.undo },
    { id: 'redo', label: t('cmd.redo'), tab: 'Home', group: 'Edit', enabled: a.hasDocument, run: a.redo },
    // number keys are the standard views, in the order Onshape uses
    { id: 'view-top', label: t('cmd.view-top'), tab: 'View', group: 'Views', keys: '1', run: () => a.setView('top') },
    { id: 'view-front', label: t('cmd.view-front'), tab: 'View', group: 'Views', keys: '2', run: () => a.setView('front') },
    { id: 'view-right', label: t('cmd.view-right'), tab: 'View', group: 'Views', keys: '3', run: () => a.setView('right') },
    { id: 'view-back', label: t('cmd.view-back'), tab: 'View', group: 'Views', keys: '4', run: () => a.setView('back') },
    { id: 'view-left', label: t('cmd.view-left'), tab: 'View', group: 'Views', keys: '5', run: () => a.setView('left') },
    { id: 'view-bottom', label: t('cmd.view-bottom'), tab: 'View', group: 'Views', keys: '6', run: () => a.setView('bottom') },
    { id: 'view-iso', label: t('cmd.view-iso'), tab: 'View', group: 'Views', keys: '7', run: () => a.setView('iso') },
    { id: 'fit', label: t('cmd.fit'), tab: 'View', group: 'Views', keys: 'Z', run: a.fit },
    { id: 'sel-face', label: t('cmd.sel-face'), tab: 'Select', group: 'Pick', keys: 'Q', pressed: () => a.mode() === 'face', run: () => a.setMode('face') },
    { id: 'sel-edge', label: t('cmd.sel-edge'), tab: 'Select', group: 'Pick', keys: 'E', pressed: () => a.mode() === 'edge', run: () => a.setMode('edge') },
    { id: 'sel-vertex', label: t('cmd.sel-vertex'), tab: 'Select', group: 'Pick', keys: 'V', pressed: () => a.mode() === 'vertex', run: () => a.setMode('vertex') },
  ];
  if (a.selectBody) cmds.push({ id: 'select-body', label: t('cmd.select-body'), tab: 'Select', group: 'Pick', enabled: a.hasDocument, run: a.selectBody });
  if (a.catalog) cmds.push({ id: 'open-catalog', label: t('cmd.open-catalog'), tab: 'Home', group: 'Features', enabled: a.hasDocument, keys: 'Shift+K', run: a.catalog });
  if (a.propeller) cmds.push({ id: 'add-propeller', label: t('cmd.add-propeller'), tab: 'Features', group: 'Create', enabled: a.hasDocument, run: a.propeller });
  if (a.knurl) cmds.push({ id: 'add-knurl', label: t('cmd.add-knurl'), tab: 'Features', group: 'Create', enabled: a.hasDocument, run: a.knurl });
  if (a.sketch3d) cmds.push({ id: 'add-sketch3d', label: t('cmd.add-sketch3d'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: a.sketch3d });
  if (a.frame) cmds.push({ id: 'add-frame', label: t('cmd.add-frame'), tab: 'Frame', group: 'Frame', enabled: a.hasDocument, run: a.frame });
  if (a.cutList) cmds.push({ id: 'frame-cutlist', label: t('cmd.frame-cutlist'), tab: 'Frame', group: 'Frame', enabled: a.hasDocument, run: a.cutList });
  if (a.screw) cmds.push({ id: 'add-screw', label: t('cmd.add-screw'), tab: 'Features', group: 'Create', enabled: a.hasDocument, run: a.screw });
  if (a.washer) cmds.push({ id: 'add-washer', label: t('cmd.add-washer'), tab: 'Features', group: 'Create', enabled: a.hasDocument, run: a.washer });
  if (a.spring) cmds.push({ id: 'add-spring', label: t('cmd.add-spring'), tab: 'Features', group: 'Create', enabled: a.hasDocument, run: a.spring });
  if (a.bearing) cmds.push({ id: 'add-bearing', label: t('cmd.add-bearing'), tab: 'Features', group: 'Create', enabled: a.hasDocument, run: a.bearing });
  if (a.impeller) cmds.push({ id: 'add-impeller', label: t('cmd.add-impeller'), tab: 'Features', group: 'Create', enabled: a.hasDocument, run: a.impeller });
  if (a.script) cmds.push({ id: 'open-script', label: t('cmd.open-script'), tab: 'Home', group: 'Features', run: a.script });
  if (a.variables) cmds.push({ id: 'open-variables', label: t('cmd.open-variables'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: a.variables });
  if (a.triball) { const tb = a.triball; cmds.push({ id: 'triball', label: t('cmd.triball'), tab: 'Select', group: 'Position', keys: 'F10', enabled: tb.canToggle, pressed: tb.isOn, run: tb.toggle }); }
  if (a.features) cmds.push(...featureCommands(a.features), ...creatorCommands(a.features));
  if (a.sheet) cmds.push(...sheetCommands(a.sheet));
  if (a.look) cmds.push(...lookCommands(a.look));
  if (a.inspect) cmds.push(...inspectCommands(a.inspect));
  if (a.assembly) cmds.push(...assemblyCommands(a.assembly));
  if (a.analysis) cmds.push(...analysisCommands(a.analysis));
  if (a.select) cmds.push(...selectCommands(a.select));
  if (a.io) cmds.push(...ioCommands(a.io, a.hasDocument));
  if (a.files) cmds.push(...fileCommands(a.files, a.hasDocument));
  if (a.tree) cmds.push(...treeCommands(a.tree));
  for (const c of cmds) if (SHORTCUTS[c.id] && !c.keys) c.keys = SHORTCUTS[c.id];
  for (const layer of LAYERS) {
    cmds.push({ id: `layer-${layer}`, label: `${a.layer(layer) ? '✓ ' : ''}${t('layer.' + layer)}`, tab: 'View', group: 'Show', pressed: () => a.layer(layer), run: () => a.toggleLayer(layer) });
  }
  for (const c of cmds) {
    if (NOT_REPEATABLE.has(c.id)) continue;
    const run = c.run;
    c.run = () => { lastCommandId = c.id; run(); };
  }
  const target = (): Command | undefined => (lastCommandId ? cmds.find((c) => c.id === lastCommandId) : undefined);
  cmds.push({
    id: 'repeat-last', label: t('cmd.repeat-last'), tab: 'Home', group: 'Edit',
    enabled: () => { const c = target(); return !!c && (c.enabled?.() ?? true); },
    why: () => (target() ? undefined : t('cmd.repeat-last.why')),
    run: () => target()?.run(),
  });
  return cmds;
}

function ioCommands(io: IoActions, hasDocument: () => boolean): Command[] {
  return [
    { id: 'sketch-import-dxf', label: t('cmd.sketch-import-dxf'), tab: 'Home', group: 'Sketch', enabled: io.isSketching, run: io.importDxf },
    { id: 'sketch-import-svg', label: t('cmd.sketch-import-svg'), tab: 'Home', group: 'Sketch', enabled: io.isSketching, run: io.importSvg },
    { id: 'export', label: t('cmd.export'), tab: 'Home', group: 'File', enabled: hasDocument, run: io.openExportMenu },
    ...EXPORT_KINDS.map((k): Command => ({ id: `export-${k}`, label: t(`cmd.export-${k}`), tab: 'Home', group: 'Export', enabled: () => io.canExport(k), run: () => io.exportAs(k) })),
    { id: 'sketch-from-dxf', label: t('cmd.sketch-from-dxf'), tab: 'Home', group: 'Sketch', enabled: hasDocument, run: io.sketchFromDxf },
    { id: 'sketch-from-svg', label: t('cmd.sketch-from-svg'), tab: 'Home', group: 'Sketch', enabled: hasDocument, run: io.sketchFromSvg },
  ];
}
