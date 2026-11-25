// The Community Hub reads GitHub release zips and the plugin catalog through a small relay on civilkit.io (tools/civilkit-cad-router/worker.js), because
// GitHub's release downloads send no CORS headers (a page cannot read them) and the desktop app's content policy lists only civilkit.io among these hosts.
const SITE = 'https://civilkit.io/cad';
const RELEASE_ZIP = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[A-Za-z0-9_.+-]+\/[A-Za-z0-9_.+-]+\.zip$/;

/** Where the relay lives: next to the page when the page is on civilkit.io, else the public site (the desktop app, a local build). */
function relayBase(): string {
  const loc = (globalThis as { location?: { hostname?: string; origin?: string } }).location;
  return loc?.hostname === 'civilkit.io' && loc.origin ? `${loc.origin}/cad` : SITE;
}

/** The address a GitHub release zip is read from: through the relay. Other addresses are returned as they are. */
export function viaRelay(url: string): string {
  return RELEASE_ZIP.test(url) ? `${relayBase()}/hub-zip?url=${encodeURIComponent(url)}` : url;
}

/** The plugin catalog's address: the relay on the desktop (whose content policy does not list the catalog's own host), the catalog itself elsewhere. */
export function catalogAddress(direct: string): string {
  const g = globalThis as Record<string, unknown> & { location?: { protocol?: string } };
  const desktop = g.location?.protocol === 'tauri:' || '__TAURI__' in g || '__TAURI_INTERNALS__' in g;
  return desktop ? `${SITE}/hub-catalog` : direct;
}
