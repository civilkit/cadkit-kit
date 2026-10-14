// Ribbon and palette commands for surface analysis (Evaluate tab). Pure: the store comes in as `AnalysisActions`.
import type { Command } from '@kit/ui';
import type { AnalysisMode } from '@kit/viewport';
import { t } from './i18n';

export interface AnalysisActions {
  mode(): AnalysisMode;
  toggleMode(m: Exclude<AnalysisMode, 'off'>): void;
  comb(): boolean;
  toggleComb(): void;
  /** Whether there is anything to analyse (a body on screen). */
  hasBody(): boolean;
}

export const ANALYSIS_COMMANDS: Array<{ id: string; mode: Exclude<AnalysisMode, 'off'>; keys?: string }> = [
  { id: 'analysis-zebra', mode: 'zebra', keys: 'Alt+Z' },
  { id: 'analysis-gaussian', mode: 'gaussian' },
  { id: 'analysis-mean', mode: 'mean' },
  { id: 'analysis-draft', mode: 'draft', keys: 'Alt+D' },
];

export function analysisCommands(a: AnalysisActions): Command[] {
  const cmds: Command[] = ANALYSIS_COMMANDS.map((c): Command => ({
    id: c.id, label: t('cmd.' + c.id), tab: 'Evaluate', group: 'Surface analysis', ...(c.keys ? { keys: c.keys } : {}), tip: t('tip.' + c.id),
    enabled: a.hasBody, pressed: () => a.mode() === c.mode, run: () => a.toggleMode(c.mode),
  }));
  cmds.push({ id: 'analysis-comb', label: t('cmd.analysis-comb'), tab: 'Evaluate', group: 'Surface analysis', keys: 'Alt+C', tip: t('tip.analysis-comb'), enabled: a.hasBody, pressed: a.comb, run: a.toggleComb });
  return cmds;
}
