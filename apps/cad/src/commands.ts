// The ribbon command table. A command is data (tab, group, label, enabled rule, handler); adding one adds a
// button without touching layout code. Handlers come in through `Actions` so this file has no DOM or kernel code.
import type { Command } from '@kit/ui';
import { t } from './i18n';
import type { DisplayLayer, SelectionMode } from '@kit/store';
import { featureCommands, type FeatureActions } from './featureCommands';
import { lookCommands, type LookActions } from './lookCommands';

/** Import and export of files other than the part itself (see ioCommands in this file). */
export interface IoActions {
  /** Add the geometry of a DXF file to the sketch being edited. */
  importDxf(): void;
  /** Open a DXF file as a new sketch on the selected plane or face (front when none). */
  sketchFromDxf(): void;
  isSketching(): boolean;
  /** Write the current part or sketch to a file in this format. */
  exportAs(kind: ExportKind): void;
  /** Open the top bar's Export menu. */
  openExportMenu(): void;
  /** Whether there is a solid to export / a sketch (open or selected) to export. */
  canExport(kind: ExportKind): boolean;
}

export type ExportKind = 'step' | 'stl' | 'stl-ascii' | 'obj' | 'dxf-sketch' | 'dxf-views';
/** The export commands in menu order; each is the command `export-<kind>`. */
export const EXPORT_KINDS: ExportKind[] = ['stl', 'stl-ascii', 'obj', 'step', 'dxf-sketch', 'dxf-views'];

export interface Actions {
  io?: IoActions;
  /** Fillet, chamfer, shell, hole, revolve and pattern commands (see featureCommands.ts). */
  features?: FeatureActions;
  /** Display styles, lighting, background, hide / show all (see lookCommands.ts). */
  look?: LookActions;
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
  addExtrude(op: 'add' | 'cut'): void;
  newSketch(plane: 'front' | 'top' | 'right'): void;
  palette(): void;
  toggleDrawer(): void;
  /** Sketch on the selected face or plane (S). */
  sketchHere(): void;
  toggleProjection(): void;
  toggleLeftPanel(): void;
  settings(): void;
  setView(v: 'iso' | 'front' | 'top' | 'right' | 'back' | 'left' | 'bottom'): void;
  fit(): void;
  setMode(m: SelectionMode): void;
  mode(): SelectionMode;
  toggleLayer(l: DisplayLayer): void;
  layer(l: DisplayLayer): boolean;
}

/** Keys for the common commands, shown in tooltips and in the command search. Feature commands use Shift because the
 *  plain letters are taken (F search, Q/E pick, Z fit, and the sketch tools' own letters while sketching). */
export const SHORTCUTS: Record<string, string> = {
  'sketch-here': 'S',
  'add-extrude': 'Shift+E', 'add-cut': 'Shift+C', 'add-revolve': 'Shift+R', 'add-hole': 'Shift+H',
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

const LAYERS: DisplayLayer[] = ['edges', 'sketches', 'curves', 'planes', 'axes', 'grid', 'relations', 'dimensions', 'threads'];

export function buildCommands(a: Actions): Command[] {
  const cmds: Command[] = [
    { id: 'open', label: t('cmd.open'), tab: 'Home', group: 'File', run: a.open },
    { id: 'save', label: t('cmd.save'), tab: 'Home', group: 'File', enabled: a.hasDocument, run: a.save },
    { id: 'samples', label: t('cmd.samples'), tab: 'Home', group: 'File', run: a.samples },
    { id: 'palette', label: t('cmd.palette'), tab: 'Home', group: 'Workspace', keys: 'F', run: a.palette },
    { id: 'toggle-projection', label: t('cmd.toggle-projection'), tab: 'Home', group: 'View', run: a.toggleProjection },
    { id: 'toggle-left-panel', label: t('cmd.toggle-left-panel'), tab: 'Home', group: 'Workspace', keys: '[', run: a.toggleLeftPanel },
    { id: 'drawer', label: t('cmd.drawer'), tab: 'Home', group: 'Workspace', keys: '\\', run: a.toggleDrawer },
    { id: 'settings', label: t('cmd.settings'), tab: 'Home', group: 'Workspace', run: a.settings },
    { id: 'new-part', label: t('cmd.new-part'), tab: 'Home', group: 'File', run: a.newPart },
    { id: 'add-extrude', label: t('cmd.add-extrude'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: () => a.addExtrude('add') },
    { id: 'add-cut', label: t('cmd.add-cut'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: () => a.addExtrude('cut') },
    { id: 'sketch-here', label: t('cmd.sketch-here'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: a.sketchHere },
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
  if (a.features) cmds.push(...featureCommands(a.features));
  if (a.look) cmds.push(...lookCommands(a.look));
  if (a.io) cmds.push(...ioCommands(a.io, a.hasDocument));
  for (const c of cmds) if (SHORTCUTS[c.id] && !c.keys) c.keys = SHORTCUTS[c.id];
  for (const layer of LAYERS) {
    cmds.push({ id: `layer-${layer}`, label: `${a.layer(layer) ? '✓ ' : ''}${t('layer.' + layer)}`, tab: 'View', group: 'Show', pressed: () => a.layer(layer), run: () => a.toggleLayer(layer) });
  }
  return cmds;
}

function ioCommands(io: IoActions, hasDocument: () => boolean): Command[] {
  return [
    { id: 'sketch-import-dxf', label: t('cmd.sketch-import-dxf'), tab: 'Home', group: 'Sketch', enabled: io.isSketching, run: io.importDxf },
    { id: 'export', label: t('cmd.export'), tab: 'Home', group: 'File', enabled: hasDocument, run: io.openExportMenu },
    ...EXPORT_KINDS.map((k): Command => ({ id: `export-${k}`, label: t(`cmd.export-${k}`), tab: 'Home', group: 'Export', enabled: () => io.canExport(k), run: () => io.exportAs(k) })),
    { id: 'sketch-from-dxf', label: t('cmd.sketch-from-dxf'), tab: 'Home', group: 'Sketch', enabled: hasDocument, run: io.sketchFromDxf },
  ];
}
