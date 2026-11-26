// "What's new in CadKit x.y": shown once after the app was updated, rising from the version link in the status bar. Closing it (X, Escape or Done) remembers the version.
import { useEffect, useState } from 'preact/hooks';
import { Callout, Icon } from '@kit/ui';
import { t } from './i18n';
import { appVersion, versionLink } from './appVersion';

const KEY = 'cad.seenVersion';
const read = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string): void => { try { localStorage.setItem(KEY, v); } catch { /* private window: it shows again next time */ } };

/** Whether to show it: the version is known, someone used the app before (a first visit has nothing new to point at), and it is not the version they last saw. A first visit records the version silently. */
export function shouldShowWhatsNew(version: string | null, seen: string | null): boolean {
  return !!version && !!seen && seen !== version;
}

export function WhatsNewCallout() {
  // version.json loads after the first render, and a signals-core signal does not re-render a component on its own: follow it explicitly
  const [v, setV] = useState<string | null>(appVersion.peek());
  useEffect(() => appVersion.subscribe(setV), []);
  const [closed, setClosed] = useState(false);
  const seen = read();
  if (v && !seen) write(v);
  if (closed || !shouldShowWhatsNew(v, seen)) return null;
  const href = versionLink(v)[0]?.href ?? '';
  const done = () => { if (v) write(v); setClosed(true); };
  return (
    <Callout id="whats-new" anchor=".status a[href*='whats-new']" icon={<Icon name="sparkle" size={20} />} title={t('whatsnew.title', { version: v ?? '' })} closeLabel={t('whatsnew.close')} onClose={done} primary={{ label: t('whatsnew.done'), run: done }}>
      {t('whatsnew.body')} <a href={href} target="_blank" rel="noopener" onClick={done}>{t('whatsnew.learn')}</a>
    </Callout>
  );
}
