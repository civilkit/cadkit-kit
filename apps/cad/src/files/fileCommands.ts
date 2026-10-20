import type { Command } from '@kit/ui';
import { t } from '../i18n';
import './strings';

export interface FileActions {
  saveAs(): void;
  importStep(): void;
  /** pick a SketchUp file and import it with its hidden geometry */
  importSkpHidden(): void;
  recover(): void;
  /** turn the shown SketchUp model to its next orientation (upright, as in the file, upside down) */
  rotateSkp(): void;
  /** a SketchUp model is on screen */
  hasSkp(): boolean;
}

/** Save as (Ctrl+Shift+S) and Import STEP. */
export function fileCommands(f: FileActions, hasDocument: () => boolean): Command[] {
  return [
    { id: 'save-as', label: t('cmd.save-as'), tab: 'Home', group: 'File', keys: 'Ctrl+Shift+S', enabled: hasDocument, run: f.saveAs },
    { id: 'recover-versions', label: t('cmd.recover-versions'), tab: 'Home', group: 'File', run: f.recover },
    { id: 'import-skp-hidden', label: t('cmd.import-skp-hidden'), tab: 'Home', group: 'File', run: f.importSkpHidden },
    { id: 'rotate-skp', label: t('cmd.rotate-skp'), tab: 'Home', group: 'File', enabled: f.hasSkp, run: f.rotateSkp },
    { id: 'import-step', label: t('cmd.import-step'), tab: 'Home', group: 'File', run: f.importStep },
  ];
}
