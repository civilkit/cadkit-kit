// "Install as an app": browsers that can install the site fire `beforeinstallprompt` once it meets the install criteria (manifest, service
// worker, https). The event is kept so a button can open the browser's own install dialog later.

export type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const DISMISSED_KEY = 'cadkit.installDismissed';

export function installDismissed(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try { return storage?.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}

export function rememberInstallDismissed(storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { storage?.setItem(DISMISSED_KEY, '1'); } catch { /* private window: asked again next time */ }
}

function safeStorage(): Storage | null { try { return localStorage; } catch { return null; } }

/** Calls `onAvailable` with the install event (the browser's default mini-bar is suppressed) and `onInstalled` once the app was installed.
 *  Returns the cleanup. */
export function watchInstall(o: {
  onAvailable: (ev: InstallEvent) => void;
  onInstalled: () => void;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}): () => void {
  const target = o.target ?? window;
  const avail = (e: Event) => { e.preventDefault(); o.onAvailable(e as InstallEvent); };
  const done = () => o.onInstalled();
  target.addEventListener('beforeinstallprompt', avail);
  target.addEventListener('appinstalled', done);
  return () => { target.removeEventListener('beforeinstallprompt', avail); target.removeEventListener('appinstalled', done); };
}

/** True when the page runs as an installed app (own window), where no install offer makes sense. */
export function runsInstalled(): boolean {
  try { return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true; } catch { return false; }
}

/** Registers the service worker of the published build. Does nothing on the dev server (no sw.js there) or without https / localhost. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* no worker: the app still runs, just not installable */ }); });
}
