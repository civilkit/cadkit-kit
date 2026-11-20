import type { SketchSolverStatus } from '@ck/part-model';
import { t } from './i18n';

/** Below this width the sketch ribbon's Status group folds into the badge plus one "..." menu. */
export const STATUS_MENU_BELOW = 900;
/** From this width the Fully define button also shows its name beside its icon. */
export const STATUS_LABEL_FROM = 1300;

export type StatusMode = 'menu' | 'icons' | 'labelled';

/** How the Status group is drawn at a ribbon width: 'menu' (badge + "..."), 'icons' (badge + square icon buttons) or 'labelled' (icons, Fully define with its name). */
export const statusMode = (width: number): StatusMode => (width < STATUS_MENU_BELOW ? 'menu' : width >= STATUS_LABEL_FROM ? 'labelled' : 'icons');

/** One button of the Status group. The same list feeds the icon row and the "..." menu, so they cannot drift apart. */
export interface StatusItem {
  id: string;
  /** data-action of the button. */
  action: string;
  icon: string;
  /** The name (also what the "..." menu shows). */
  label: string;
  /** One line describing what it does; the tooltip text. */
  tip: string;
  keys?: string;
  /** Set for a toggle: whether it is on. */
  pressed?: boolean;
  disabled?: boolean;
  /** Text shown beside the icon when the group has room (only Fully define). */
  text?: string;
  /** Extra class (accent while the view is angled to the plane, done once fully defined). */
  cls?: string;
  run(): void;
}

export interface StatusItemInput {
  status: SketchSolverStatus | null;
  level: 'under' | 'full' | 'over' | 'none';
  busy: boolean;
  onFullyDefine(): void;
  showFree?: boolean;
  onShowFree?: () => void;
  showConstraints?: boolean;
  onShowConstraints?: () => void;
  onReport?: () => void;
  reportOpen?: boolean;
  onLookNormal(): void;
  lookChip?: boolean;
}

/** The accessible name of a status button: its name and its one-line description; the shortcut is added when the description does not already carry it. */
export const statusAria = (it: Pick<StatusItem, 'label' | 'tip' | 'keys'>): string =>
  `${it.label}: ${it.tip}` + (it.keys && !it.tip.includes(it.keys) && !it.tip.includes(`(${it.keys})`) ? ` (${it.keys})` : '');

/** The buttons the Status group holds, in order (Snaps is a popover and is added by the component). Show freedom only while the sketch is under-defined. */
export function statusItems(p: StatusItemInput): StatusItem[] {
  const out: StatusItem[] = [{
    id: 'fully-define', action: 'fully-define', icon: 'fully-define', label: t('app.sketch.fullyDefine'), tip: t('app.sketch.fullyDefine.tip'),
    text: p.busy ? t('app.sketch.defining') : t('app.sketch.fullyDefine'), disabled: p.busy || p.level === 'full', cls: p.level === 'full' && !p.busy ? 'done' : undefined, run: p.onFullyDefine,
  }];
  if (p.onShowFree && p.level === 'under') out.push({ id: 'show-freedom', action: 'show-freedom', icon: 'show-freedom', label: t('app.sketch.free.button'), tip: t('app.sketch.free.button.tip'), pressed: !!p.showFree, run: p.onShowFree });
  if (p.onShowConstraints) out.push({ id: 'show-constraints', action: 'show-constraints', icon: 'show-constraints', label: p.showConstraints ? t('app.sketch.hideConstraints') : t('app.sketch.showConstraints'), tip: p.showConstraints ? t('app.sketch.hideConstraints.tip') : t('app.sketch.showConstraints.tip'), keys: 'Shift+C', pressed: !!p.showConstraints, run: p.onShowConstraints });
  if (p.onReport) out.push({ id: 'sketch-report', action: 'sketch-report', icon: 'sketch-report', label: t('app.sketch.report'), tip: t('app.sketch.report.tip'), pressed: !!p.reportOpen, run: p.onReport });
  out.push({ id: 'look-normal', action: 'look-normal', icon: 'look-normal', label: t('app.sketch.lookNormal'), tip: p.lookChip ? t('app.sketch.lookNormalChip.tip') : t('app.sketch.lookNormal.tip'), keys: 'N', cls: p.lookChip ? 'look-hint' : undefined, run: p.onLookNormal });
  return out;
}
