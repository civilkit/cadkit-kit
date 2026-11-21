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
  /** Open the Inspect tab and run the intersection check. */
  intersection(): void;
  /** Cut the part open on the last plane, or put it back. */
  toggleSection(): void;
  isSectioned(): boolean;
  hasSolid(): boolean;
  /** The part shows at least one reference mesh: Measure works on its points even with no solid (the other tools need a solid). */
  hasRefMesh?(): boolean;
}

/** Measure can run with a solid on screen or a shown reference mesh to pick points on. */
export const canMeasure = (a: Pick<InspectActions, 'hasSolid' | 'hasRefMesh'>): boolean => a.hasSolid() || !!a.hasRefMesh?.();

export function inspectCommands(a: InspectActions): Command[] {
  return [
    { id: 'measure', label: t('cmd.measure'), tab: 'Evaluate', group: 'Measure', keys: 'M', enabled: () => canMeasure(a), pressed: a.isMeasuring, run: a.toggleMeasure },
    { id: 'mass-props', label: t('cmd.mass-props'), tab: 'Evaluate', group: 'Measure', enabled: a.hasSolid, run: a.massProps },
    { id: 'interference', label: t('cmd.interference'), tab: 'Evaluate', group: 'Analyse', enabled: a.hasSolid, run: a.interference },
    { id: 'check-intersection', label: t('cmd.check-intersection'), tab: 'Evaluate', group: 'Analyse', enabled: a.hasSolid, run: a.intersection },
    { id: 'section-view', label: t('cmd.section-view'), tab: 'Evaluate', group: 'Section', keys: 'Alt+S', enabled: a.hasSolid, pressed: a.isSectioned, run: a.toggleSection },
  ];
}
