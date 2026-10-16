import type { Command } from '@kit/ui';
import { t } from '../i18n';
import './strings';

export interface FileActions {
  saveAs(): void;
  importStep(): void;
  recover(): void;
}

/** Save as (Ctrl+Shift+S) and Import STEP. */
export function fileCommands(f: FileActions, hasDocument: () => boolean): Command[] {
  return [
    { id: 'save-as', label: t('cmd.save-as'), tab: 'Home', group: 'File', keys: 'Ctrl+Shift+S', enabled: hasDocument, run: f.saveAs },
    { id: 'recover-versions', label: t('cmd.recover-versions'), tab: 'Home', group: 'File', run: f.recover },
    { id: 'import-step', label: t('cmd.import-step'), tab: 'Home', group: 'File', run: f.importStep },
  ];
}
