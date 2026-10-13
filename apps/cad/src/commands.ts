// The ribbon command table. A command is data (tab, group, label, enabled rule, handler); adding one adds a
// button without touching layout code. Handlers come in through `Actions` so this file has no DOM or kernel code.
import type { Command } from '@kit/ui';
import { t } from './i18n';
import type { DisplayLayer, SelectionMode } from '@kit/store';

export interface Actions {
  open(): void;
  save(): void;
  samples(): void;
  undo(): void;
  redo(): void;
  hasDocument(): boolean;
  newPart(): void;
  addExtrude(op: 'add' | 'cut'): void;
  newSketch(plane: 'front' | 'top' | 'right'): void;
  palette(): void;
  toggleDrawer(): void;
  settings(): void;
  setView(v: 'iso' | 'front' | 'top' | 'right'): void;
  fit(): void;
  setMode(m: SelectionMode): void;
  mode(): SelectionMode;
  toggleLayer(l: DisplayLayer): void;
  layer(l: DisplayLayer): boolean;
}

const LAYERS: DisplayLayer[] = ['edges', 'sketches', 'curves', 'planes', 'axes', 'relations'];

export function buildCommands(a: Actions): Command[] {
  const cmds: Command[] = [
    { id: 'open', label: t('cmd.open'), tab: 'Home', group: 'File', run: a.open },
    { id: 'save', label: t('cmd.save'), tab: 'Home', group: 'File', enabled: a.hasDocument, run: a.save },
    { id: 'samples', label: t('cmd.samples'), tab: 'Home', group: 'File', run: a.samples },
    { id: 'palette', label: t('cmd.palette'), tab: 'Home', group: 'Workspace', keys: 'F', run: a.palette },
    { id: 'drawer', label: t('cmd.drawer'), tab: 'Home', group: 'Workspace', keys: '\\', run: a.toggleDrawer },
    { id: 'settings', label: t('cmd.settings'), tab: 'Home', group: 'Workspace', run: a.settings },
    { id: 'new-part', label: t('cmd.new-part'), tab: 'Home', group: 'File', run: a.newPart },
    { id: 'add-extrude', label: t('cmd.add-extrude'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: () => a.addExtrude('add') },
    { id: 'add-cut', label: t('cmd.add-cut'), tab: 'Home', group: 'Features', enabled: a.hasDocument, run: () => a.addExtrude('cut') },
    { id: 'sketch-new-front', label: t('cmd.sketch-new-front'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: () => a.newSketch('front') },
    { id: 'sketch-new-top', label: t('cmd.sketch-new-top'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: () => a.newSketch('top') },
    { id: 'sketch-new-right', label: t('cmd.sketch-new-right'), tab: 'Home', group: 'Sketch', enabled: a.hasDocument, run: () => a.newSketch('right') },
    { id: 'undo', label: t('cmd.undo'), tab: 'Home', group: 'Edit', enabled: a.hasDocument, run: a.undo },
    { id: 'redo', label: t('cmd.redo'), tab: 'Home', group: 'Edit', enabled: a.hasDocument, run: a.redo },
    { id: 'view-iso', label: t('cmd.view-iso'), tab: 'View', group: 'Views', run: () => a.setView('iso') },
    { id: 'view-front', label: t('cmd.view-front'), tab: 'View', group: 'Views', run: () => a.setView('front') },
    { id: 'view-top', label: t('cmd.view-top'), tab: 'View', group: 'Views', run: () => a.setView('top') },
    { id: 'view-right', label: t('cmd.view-right'), tab: 'View', group: 'Views', run: () => a.setView('right') },
    { id: 'fit', label: t('cmd.fit'), tab: 'View', group: 'Views', keys: 'Z', run: a.fit },
    { id: 'sel-face', label: t('cmd.sel-face'), tab: 'Select', group: 'Pick', keys: '1', run: () => a.setMode('face') },
    { id: 'sel-edge', label: t('cmd.sel-edge'), tab: 'Select', group: 'Pick', keys: '2', run: () => a.setMode('edge') },
  ];
  for (const layer of LAYERS) {
    cmds.push({ id: `layer-${layer}`, label: `${a.layer(layer) ? '✓ ' : ''}${t('layer.' + layer)}`, tab: 'View', group: 'Show', run: () => a.toggleLayer(layer) });
  }
  return cmds;
}
