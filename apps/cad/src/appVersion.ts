// The product version for the status bar. The published build writes `version.json` next to the page (tools/build_pages.mjs); a dev build and the desktop
// build have none, so nothing is shown there. The status bar shows it as a link to the What's new page of the same site.
import { signal } from '@preact/signals-core';

/** The version string once known, e.g. "0.7.3"; null until the file has been read or when there is none. */
export const appVersion = signal<string | null>(null);

/** Reads version.json once. Never throws: a missing or odd file leaves the version unknown. */
export function loadAppVersion(fetchFn: typeof fetch = fetch, base: string = document.baseURI): Promise<void> {
  return fetchFn(new URL('version.json', base), { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: unknown) => {
      const v = j && typeof j === 'object' ? (j as { version?: unknown }).version : undefined;
      if (typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v)) appVersion.value = v;
    })
    .catch(() => { /* a dev build has none */ });
}

/** The status-bar link for a version: "v0.7.3" to the What's new page next to the app; none while the version is unknown. */
export function versionLink(v: string | null, base: string = document.baseURI): { label: string; href: string }[] {
  return v ? [{ label: `v${v}`, href: new URL('whats-new/', base).href }] : [];
}
