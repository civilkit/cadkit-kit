// Sends civilkit.io/docs/* to the Pages project that holds the documentation (the project's files sit under /docs/ next to the app's /cad/).
// A directory without its trailing slash makes Pages answer with a redirect to its own address: those redirects are rewritten back to this host.
const ORIGIN = 'civilkit-cad.pages.dev';
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/docs') {
      url.pathname = '/docs/';
      return Response.redirect(url.toString(), 301);
    }
    const target = new URL(request.url);
    target.protocol = 'https:';
    target.hostname = ORIGIN;
    target.port = '';
    const res = await fetch(new Request(target, request), { redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, target);
      if (next.hostname === ORIGIN) { next.protocol = url.protocol; next.hostname = url.hostname; next.port = ''; }
      const headers = new Headers(res.headers);
      headers.set('location', next.toString());
      return new Response(null, { status: res.status, headers });
    }
    return res;
  },
};
