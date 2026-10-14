// Ribbon and command-search entries of the assembly tools (tab Assembly). Each opens the Outliner tab on its section.
import type { Command } from '@kit/ui';
import { t } from '../i18n';
import type { Section } from './AssemblyPanel';

export interface AssemblyActions { open(section: Section): void; hasDocument(): boolean; isExploded(): boolean; hasComponents(): boolean }

export function assemblyCommands(a: AssemblyActions): Command[] {
  return [
    { id: 'insert-part', label: t('cmd.insert-part'), tab: 'Assembly', group: 'Components', enabled: a.hasDocument, run: () => a.open('parts') },
    { id: 'mate', label: t('cmd.mate'), tab: 'Assembly', group: 'Components', enabled: a.hasComponents, run: () => a.open('mates') },
    { id: 'asm-interference', label: t('cmd.asm-interference'), tab: 'Assembly', group: 'Review', enabled: a.hasComponents, run: () => a.open('interference') },
    { id: 'bom', label: t('cmd.bom'), tab: 'Assembly', group: 'Review', enabled: a.hasComponents, run: () => a.open('bom') },
    { id: 'explode', label: t('cmd.explode'), tab: 'Assembly', group: 'Review', enabled: a.hasComponents, pressed: a.isExploded, run: () => a.open('explode') },
  ];
}
