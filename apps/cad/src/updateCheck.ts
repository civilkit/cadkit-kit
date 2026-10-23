// Tells a long-open tab that a newer build was deployed. The built index.html names its bundle with a content hash
// (assets/index-<hash>.js), so a different name in a freshly fetched index.html means this tab runs an older build.

/** The module bundle an index.html loads, or null when it names none (dev server, unexpected page). */
export function bundleOf(html: string): string | null {
  const m = /<script[^>]*\bsrc="([^"]*assets\/[^"]*\.js)"/i.exec(html);
  return m ? m[1]!.split('/').pop()! : null;
}

export type UpdateWatch = { check(): Promise<boolean>; stop(): void };

/** Compares the running bundle with the deployed one on every `intervalMs` and when the tab becomes visible again.
 *  `onStale` runs once. A failed fetch (offline, deploy in progress) is ignored until the next try. */
export function watchForUpdate(o: {
  current: string | null;
  fetchHtml: () => Promise<string>;
  onStale: () => void;
  intervalMs?: number;
  target?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
}): UpdateWatch {
  let done = o.current === null;   // a dev build has no hashed bundle: nothing to compare
  const check = async (): Promise<boolean> => {
    if (done) return false;
    try {
      const latest = bundleOf(await o.fetchHtml());
      if (latest && latest !== o.current) { done = true; o.onStale(); return true; }
    } catch { /* try again later */ }
    return false;
  };
  const target = o.target ?? document;
  const onVisible = () => { if (target.visibilityState === 'visible') void check(); };
  target.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => void check(), o.intervalMs ?? 5 * 60_000);
  return { check, stop: () => { clearInterval(timer); target.removeEventListener('visibilitychange', onVisible); } };
}

/** The bundle this tab loaded, read from its own script tag. */
export function runningBundle(doc: Document = document): string | null {
  for (const s of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = s.getAttribute('src') ?? '';
    if (/assets\/[^/]*\.js$/.test(src)) return src.split('/').pop()!;
  }
  return null;
}
