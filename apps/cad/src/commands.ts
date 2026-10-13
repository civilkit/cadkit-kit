// The ribbon command table. A command is data (tab, group, label, enabled rule, handler); adding one adds a
// button without touching layout code. Handlers come in through `Actions` so this file has no DOM or kernel code.
import type { Command } from '@kit/ui';
import type { DisplayLayer, SelectionMode } from '@kit/store';

export interface Actions {
  open(): void;
  save(): void;
  samples(): void;
  undo(): void;
  hasDocument(): boolean;
  setView(v: 'iso' | 'front' | 'top' | 'right'): void;
  fit(): void;
  setMode(m: SelectionMode): void;
  mode(): SelectionMode;
  toggleLayer(l: DisplayLayer): void;
  layer(l: DisplayLayer): boolean;
}

const LAYERS: Array<[DisplayLayer, string]> = [
  ['edges', 'Edges'], ['sketches', 'Sketches'], ['curves', 'Curves'], ['planes', 'Planes'],
  ['axes', 'Axes'], ['relations', 'Relations'],
];

export function buildCommands(a: Actions): Command[] {
  const cmds: Command[] = [
    { id: 'open', label: 'Open', tab: 'Home', group: 'File', run: a.open },
    { id: 'save', label: 'Save', tab: 'Home', group: 'File', enabled: a.hasDocument, run: a.save },
    { id: 'samples', label: 'Samples', tab: 'Home', group: 'File', run: a.samples },
    { id: 'undo', label: 'Undo', tab: 'Home', group: 'Edit', enabled: a.hasDocument, run: a.undo },
    { id: 'view-iso', label: 'Iso', tab: 'View', group: 'Views', run: () => a.setView('iso') },
    { id: 'view-front', label: 'Front', tab: 'View', group: 'Views', run: () => a.setView('front') },
    { id: 'view-top', label: 'Top', tab: 'View', group: 'Views', run: () => a.setView('top') },
    { id: 'view-right', label: 'Right', tab: 'View', group: 'Views', run: () => a.setView('right') },
    { id: 'fit', label: 'Fit', tab: 'View', group: 'Views', run: a.fit },
    { id: 'sel-face', label: 'Face', tab: 'Select', group: 'Pick', run: () => a.setMode('face') },
    { id: 'sel-edge', label: 'Edge', tab: 'Select', group: 'Pick', run: () => a.setMode('edge') },
  ];
  for (const [layer, label] of LAYERS) {
    cmds.push({ id: `layer-${layer}`, label: `${a.layer(layer) ? '✓ ' : ''}${label}`, tab: 'View', group: 'Show', run: () => a.toggleLayer(layer) });
  }
  return cmds;
}
