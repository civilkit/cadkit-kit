// Ribbon and command-search entries of the assembly tools (tab Assembly). Each opens the Outliner tab on its section.
import type { Command } from '@kit/ui';
import { t } from '../i18n';
import type { Section } from './AssemblyPanel';

export interface AssemblyActions {
  open(section: Section): void; hasDocument(): boolean; isExploded(): boolean; hasComponents(): boolean;
  /** the exploded view: its spread now, and a change to it (the Explode button turns it on and off, the panel slider sets the amount) */
  explodeSpread?(): number; setExplode?(patch: { spread: number }): void;
}
/** The spread the Explode button turns the view on with. */
export const EXPLODE_ON = 1;

export function assemblyCommands(a: AssemblyActions): Command[] {
  return [
    { id: 'insert-part', label: t('cmd.insert-part'), tab: 'Assembly', group: 'Components', enabled: a.hasDocument, run: () => a.open('parts') },
    { id: 'mate', label: t('cmd.mate'), tab: 'Assembly', group: 'Components', enabled: a.hasComponents, run: () => a.open('mates') },
    { id: 'asm-interference', label: t('cmd.asm-interference'), tab: 'Assembly', group: 'Review', enabled: a.hasComponents, run: () => a.open('interference') },
    { id: 'bom', label: t('cmd.bom'), tab: 'Assembly', group: 'Review', enabled: a.hasComponents, run: () => a.open('bom') },
    { id: 'explode', label: t('cmd.explode'), tab: 'Assembly', group: 'Review', enabled: a.hasComponents, pressed: () => (a.explodeSpread ? a.explodeSpread() > 0 : a.isExploded()),
      // a toggle: it opens the panel's Explode section and turns the view on, or off when it is on (the slider there sets the amount)
      run: () => { a.open('explode'); if (a.explodeSpread && a.setExplode) a.setExplode({ spread: a.explodeSpread() > 0 ? 0 : EXPLODE_ON }); } },
  ];
}
