// Tells a long-open tab (or an installed web app) that a newer build was deployed. The built index.html names its bundle with a content
// hash (assets/index-<hash>.js), so a different name in a freshly fetched index.html means the running page is an older build: this
// compares against the bundle the page was really loaded with (its own script tag), even when a stale service worker cache served it.
// version.json ({version, kit, kernel}, next to the page) is read only to show the number of the new version. Nothing is sent but plain
// GETs of index.html and version.json: no user data, no identifiers.

export type BuildVersion = { version: string; kit?: string; kernel?: string };
export type FetchFn = (url: string, init?: { cache?: 'no-store' }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** Reads version.json under `base` (the page's base URL). null for anything but a valid answer: offline, 404 (dev server), bad JSON. */
export async function fetchVersion(fetchFn: FetchFn, base: string): Promise<BuildVersion | null> {
  try {
    const r = await fetchFn(new URL('version.json', base).href, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || typeof j !== 'object') return null;
    const o = j as Record<string, unknown>;
    if (typeof o.version !== 'string' || !o.version) return null;
    return { version: o.version, kit: typeof o.kit === 'string' && o.kit ? o.kit : undefined, kernel: typeof o.kernel === 'string' && o.kernel ? o.kernel : undefined };
  } catch { return null; }
}

/** Updates are the installer's job in the desktop app, and there is nothing published on localhost or an `http` dev server. */
export function shouldWatch(loc: { protocol: string; hostname: string }, g: object = globalThis): boolean {
  if (loc.protocol === 'tauri:' || '__TAURI__' in g || '__TAURI_INTERNALS__' in g) return false;
  if (loc.protocol !== 'https:' && loc.protocol !== 'http:') return false;
  return !(loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' || loc.hostname === '[::1]' || loc.hostname.endsWith('.localhost'));
}

/** The module bundle an index.html loads, or null when it names none (dev server, unexpected page). */
export function bundleOf(html: string): string | null {
  const m = /<script[^>]*\bsrc="([^"]*assets\/[^"]*\.js)"/i.exec(html);
  return m ? m[1]!.split('/').pop()! : null;
}

/** The bundle this tab loaded, read from its own script tag. */
export function runningBundle(doc: Document = document): string | null {
  for (const s of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = s.getAttribute('src') ?? '';
    if (/assets\/[^/]*\.js$/.test(src)) return src.split('/').pop()!;
  }
  return null;
}

/** `newer`: a newer build is deployed (`version` is its number when version.json could be read); `latest`: this is the deployed build;
 *  `unknown`: the check could not be made (offline, a dev build). */
export type UpdateResult = { state: 'newer'; version?: string } | { state: 'latest' } | { state: 'unknown' };
export type UpdateWatch = {
  /** Compares the running bundle with the deployed one now. A manual check ignores the 5-minute limit. */
  check(manual?: boolean): Promise<UpdateResult>;
  stop(): void;
};
type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { visibilityState?: string };

export const MIN_GAP_MS = 5 * 60_000;
/** Hidden for longer than this: on return the next check ignores the 5-minute gap (an installed app is mostly suspended, not closed). */
export const RESUME_MS = 60_000;

/** True when the app has been in the background long enough that the next check should not wait for the gap. */
export const bypassGap = (hiddenMs: number | null): boolean => hiddenMs !== null && hiddenMs > RESUME_MS;

/** What to do about a newer build. `hiddenMs` is how long the app was in the background when it came back to the foreground (Infinity on launch),
 *  null when this is not such a moment (found while the app was in use). A reload is automatic only at that moment, with nothing modified, no
 *  edit open and automatic updates on; in every other case with a newer build the notice is shown, so a reload never lands in the middle of
 *  the user's work. */
export function decideUpdate(o: { stale: boolean; dirty: boolean; editing: boolean; hiddenMs: number | null; autoOn: boolean }): 'reload' | 'notice' | 'none' {
  if (!o.stale) return 'none';
  return o.autoOn && !o.dirty && !o.editing && o.hiddenMs !== null ? 'reload' : 'notice';
}

const TOAST_KEY = 'cad.updatedTo';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const session = (): Store | null => { try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; } };

/** Remembers, across the coming reload, that the app updated to `version` (empty when its number is unknown) so the new page can say so. */
export function rememberUpdated(version: string | undefined, storage: Store | null = session()): void {
  try { storage?.setItem(TOAST_KEY, JSON.stringify({ version: version ?? '' })); } catch { /* storage blocked: no toast */ }
}
/** The pending "Updated to" note, read once: null when there is none. `version` is '' when the number was not known. */
export function takeUpdated(storage: Store | null = session()): { version: string } | null {
  try {
    const raw = storage?.getItem(TOAST_KEY);
    if (raw == null) return null;
    storage!.removeItem(TOAST_KEY);
    const j = JSON.parse(raw) as { version?: unknown };
    return { version: typeof j?.version === 'string' ? j.version : '' };
  } catch { return null; }
}

/** Asks the browser to look for a new service worker now, so it and the page agree after a resume. Failures are ignored. */
export function updateServiceWorker(nav: { serviceWorker?: { getRegistration(): Promise<{ update(): Promise<unknown> } | undefined> } } | undefined = typeof navigator === 'undefined' ? undefined : navigator): void {
  try { void nav?.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => { /* offline */ }); } catch { /* no service worker support */ }
}

/** Compares the running bundle with the deployed one every `intervalMs` (default and minimum 5 minutes) and when the tab becomes visible
 *  or gains focus, never more often than every 5 minutes. `onStale` runs once, with the new version's number when `getVersion` finds it.
 *  A failed fetch (offline, deploy in progress) is ignored until the next try. */
export function watchForUpdate(o: {
  current: string | null;
  fetchHtml: () => Promise<string>;
  /** The deployed version.json, only for the number shown in the notice; may fail. */
  getVersion?: () => Promise<BuildVersion | null>;
  onStale: (u: { version?: string }) => void;
  /** The app is in the foreground after a launch (hiddenMs Infinity) or a return from the background, and its check has finished. */
  onForeground?: (f: { hiddenMs: number; result: UpdateResult }) => void;
  /** The app returned after more than RESUME_MS in the background (before its check). */
  onResume?: () => void;
  intervalMs?: number;
  now?: () => number;
  target?: Target;        // document: visibilitychange
  focusTarget?: Target;   // window: focus
}): UpdateWatch {
  const now = o.now ?? Date.now;
  let last = -Infinity, stopped = false, stale: UpdateResult | null = null;
  let inflight: Promise<UpdateResult> | null = null;
  const run = async (): Promise<UpdateResult> => {
    last = now();
    if (o.current === null) return { state: 'unknown' };   // a dev build has no hashed bundle: nothing to compare
    try {
      const latest = bundleOf(await o.fetchHtml());
      if (stopped || !latest) return { state: 'unknown' };
      if (latest === o.current) return { state: 'latest' };
    } catch { return { state: 'unknown' }; }
    let version: string | undefined;
    try { version = (await o.getVersion?.())?.version; } catch { /* the generic text is shown */ }
    stale = version ? { state: 'newer', version } : { state: 'newer' };
    o.onStale(version ? { version } : {});
    return stale;
  };
  const check = (manual = false): Promise<UpdateResult> => {
    if (stopped) return Promise.resolve({ state: 'unknown' });
    if (stale) return Promise.resolve(stale);   // once found, it stays found
    if (inflight) return inflight;
    if (!manual && now() - last < MIN_GAP_MS) return Promise.resolve({ state: 'unknown' });
    inflight = run().finally(() => { inflight = null; });
    return inflight;
  };
  const target = o.target ?? (typeof document !== 'undefined' ? document : undefined);
  const focusTarget = o.focusTarget ?? (typeof window !== 'undefined' ? window : undefined);
  let hiddenAt: number | null = null;
  const foreground = (hiddenMs: number) => {
    if (bypassGap(hiddenMs)) { o.onResume?.(); last = -Infinity; }
    void check().then((result) => { if (!stopped) o.onForeground?.({ hiddenMs, result }); });
  };
  const onVisible = () => {
    if (target?.visibilityState === 'hidden') { hiddenAt = now(); return; }
    if (target?.visibilityState !== 'visible') return;
    const hiddenMs = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    foreground(hiddenMs);
  };
  const onFocus = () => void check();
  target?.addEventListener('visibilitychange', onVisible);
  focusTarget?.addEventListener('focus', onFocus);
  if (o.onForeground && target?.visibilityState !== 'hidden') foreground(Infinity);   // launch: no gap, and the page may still be untouched
  const timer = setInterval(() => void check(), Math.max(o.intervalMs ?? MIN_GAP_MS, MIN_GAP_MS));
  return { check, stop: () => { stopped = true; clearInterval(timer); target?.removeEventListener('visibilitychange', onVisible); focusTarget?.removeEventListener('focus', onFocus); } };
}

/** Reload, but through the app's unsaved-changes guard when something is modified (the guard asks to save or discard, then runs `reload`). */
export function reloadGuarded(o: { anyDirty(): boolean; guard(go: () => void): void; reload(): void }): void {
  if (o.anyDirty()) o.guard(o.reload); else o.reload();
}
