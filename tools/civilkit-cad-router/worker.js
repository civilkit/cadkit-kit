// Sends civilkit.io/cad/* to the Pages project that holds the app (the project's files sit under /cad/). Same shape as the /calcs/ router.
// Two small read-only relays for the Community Hub live here too, because GitHub's release downloads and the SolidCraft plugin catalog cannot be read
// from a page on another site (no CORS headers) nor from the desktop app (its content policy lists only a few hosts):
//   GET /cad/hub-zip?url=<https://github.com/OWNER/REPO/releases/download/TAG/NAME.zip>   a plugin release zip, 8 MB at most
//   GET /cad/hub-catalog                                                                    the plugin catalog (one fixed address), 2 MB at most
// Neither is an open proxy: the address must have exactly the shape above (GitHub release asset, https, no port, no credentials, no query), redirects
// are followed by hand and only to GitHub's own download hosts, nothing from the request (cookies, headers) is forwarded, and the size and time are capped.
const ORIGIN = 'civilkit-cad.pages.dev';
const ZIP_CAP = 8 * 1024 * 1024;
const CATALOG_CAP = 2 * 1024 * 1024;
const CATALOG_URL = 'https://tharje.github.io/solidcraft-plugins/data/plugins.json';
const TIMEOUT_MS = 20000;
const REDIRECT_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const NAME = '[A-Za-z0-9_.-]{1,100}';
const PART = '[A-Za-z0-9_.+-]';   // a tag or file name: no percent-encoding, no slash
const ZIP_PATH = new RegExp(`^/(${NAME})/(${NAME})/releases/download/(${PART}{1,100})/(${PART}{1,160}\\.zip)$`);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400', 'X-Content-Type-Options': 'nosniff' };
const fail = (status, message) => new Response(message, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/** The address when it is a GitHub release zip (https://github.com/OWNER/REPO/releases/download/TAG/NAME.zip), else null. */
export function releaseZipUrl(text) {
  let u;
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.port || u.username || u.password || u.search || u.hash) return null;
  // the path as sent must match the shape itself: no percent-encoding tricks (a name has only letters, digits and . _ -)
  return ZIP_PATH.test(u.pathname) ? u.href : null;
}

/** GET with redirects followed by hand: every hop must be https on one of GitHub's own hosts. No credentials, no forwarded headers. */
async function getFollowing(url, fetchImpl, signal) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const r = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal, headers: { Accept: '*/*', 'User-Agent': 'civilkit-hub-relay' } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      let next;
      try { next = loc ? new URL(loc, current) : null; } catch { next = null; }
      if (!next || next.protocol !== 'https:' || !REDIRECT_HOSTS.has(next.hostname) || next.username || next.password) return { error: fail(502, 'the download redirected somewhere this relay does not follow') };
      current = next.href;
      continue;
    }
    return { response: r };
  }
  return { error: fail(502, 'too many redirects') };
}

/** The body of `r` as a stream that stops with an error once more than `cap` bytes have passed. */
function capped(r, cap) {
  let seen = 0;
  return r.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > cap) controller.error(new Error('over the size limit'));
      else controller.enqueue(chunk);
    },
  }));
}

async function relay(url, cap, type, cache, fetchImpl) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let got;
  try { got = await getFollowing(url, fetchImpl, signal); } catch { return fail(504, 'the download timed out or could not be reached'); }
  if (got.error) return got.error;
  const r = got.response;
  if (!r.ok || !r.body) return fail(r.status === 404 ? 404 : 502, `the source answered HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length') || '0');
  if (len > cap) return fail(413, `larger than the ${Math.round(cap / 1048576)} MB limit`);
  return new Response(capped(r, cap), { status: 200, headers: { ...CORS, 'Content-Type': type, 'Cache-Control': cache } });
}

/** The two Hub relays; null when the request is for neither. `fetchImpl` is injectable for tests. */
export async function hubRelay(request, fetchImpl = fetch) {
  const url = new URL(request.url);
  const zip = url.pathname === '/cad/hub-zip', cat = url.pathname === '/cad/hub-catalog';
  if (!zip && !cat) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'GET only');
  if (cat) return relay(CATALOG_URL, CATALOG_CAP, 'application/json; charset=utf-8', 'public, max-age=300', fetchImpl);
  const target = releaseZipUrl(url.searchParams.get('url') || '');
  if (!target) return fail(400, 'only https://github.com/OWNER/REPO/releases/download/TAG/NAME.zip addresses are relayed');
  return relay(target, ZIP_CAP, 'application/zip', 'public, max-age=600', fetchImpl);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const relayed = await hubRelay(request);
    if (relayed) return relayed;
    // the documentation moved to /docs/cad/: keep the old addresses working
    if (url.pathname === '/cad/docs' || url.pathname.startsWith('/cad/docs/')) {
      url.pathname = '/docs/cad' + url.pathname.slice('/cad/docs'.length);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/cad' || url.pathname === '/cad-beta') {
      url.pathname += '/';
      return Response.redirect(url.toString(), 301);
    }
    url.hostname = ORIGIN;
    url.port = '';
    return fetch(new Request(url, request));
  },
};
