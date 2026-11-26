// What the open editor's problems are, for every panel that has a header: the app provides them once, each panel (feature editor, wizard, gear, hole, ...)
// drops <ProblemSlot /> into its header and gets the same alert icon and flyout beside the panel. A panel used without a provider (a test, a plugin) keeps its own hint text.
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { t } from './i18n';
import { ProblemBadge, type Problem } from './ProblemBadge';

export interface ProblemsValue {
  problems: readonly Problem[];
  checking?: boolean;
  /** raised when a refused confirm should open the flyout */
  openSignal?: number;
  /** a hint that is guidance, not an error (kept as a plain note under the fields) */
  isNeutralHint(hint: string): boolean;
}
export const ProblemsContext = createContext<ProblemsValue | null>(null);

/** The labels of the badge, from the UI catalogue. */
export const problemLabels = () => ({
  problems: (n: number) => t('ui.editor.problems', { count: n }),
  checking: t('ui.editor.checking', undefined, 'Checking...'),
  close: t('ui.editor.problemClose', undefined, 'Close'),
  details: t('ui.editor.problemDetails', undefined, 'Details'),
  announce: (n: number) => t('ui.editor.problemAnnounce', { count: n }),
});

/** In a panel header, beside the title: the alert icon when the app says the edit has a problem. Nothing without a provider. */
export function ProblemSlot() {
  const c = useContext(ProblemsContext);
  if (!c) return null;
  return <ProblemBadge problems={c.problems} checking={c.checking} openSignal={c.openSignal} label={problemLabels()} />;
}

/** The old red hint under a panel's fields, kept only where there is no provider, or when the hint is guidance rather than an error. */
export function PanelHint(p: { hint?: string | null; cls?: string; testid?: string }) {
  const c = useContext(ProblemsContext);
  if (!p.hint) return null;
  if (c && !c.isNeutralHint(p.hint)) return null;   // the icon beside the title says it
  const neutral = !!c;
  return <div class={(p.cls ?? 'fedit-hint') + (neutral ? ' neutral' : '')} role={neutral ? 'status' : 'alert'} data-testid={p.testid}>{p.hint}</div>;
}
