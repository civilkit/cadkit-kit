// Ribbon and command-search entries of the Inspect tools (tab Evaluate).
import type { Command } from '@kit/ui';
import { t } from '../i18n';

export interface InspectActions {
  /** Turn the Measure tool on or off (key M). */
  toggleMeasure(): void;
  isMeasuring(): boolean;
  /** Open the Inspect tab and compute the mass properties. */
  massProps(): void;
  /** Open the Inspect tab and run the interference check. */
  interference(): void;
  /** Cut the part open on the last plane, or put it back. */
  toggleSection(): void;
  isSectioned(): boolean;
  hasSolid(): boolean;
}

export function inspectCommands(a: InspectActions): Command[] {
  return [
    { id: 'measure', label: t('cmd.measure'), tab: 'Evaluate', group: 'Measure', keys: 'M', enabled: a.hasSolid, pressed: a.isMeasuring, run: a.toggleMeasure },
    { id: 'mass-props', label: t('cmd.mass-props'), tab: 'Evaluate', group: 'Measure', enabled: a.hasSolid, run: a.massProps },
    { id: 'interference', label: t('cmd.interference'), tab: 'Evaluate', group: 'Analyse', enabled: a.hasSolid, run: a.interference },
    { id: 'section-view', label: t('cmd.section-view'), tab: 'Evaluate', group: 'Section', enabled: a.hasSolid, pressed: a.isSectioned, run: a.toggleSection },
  ];
}
