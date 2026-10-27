// Sends civilkit.io/cad/* to the Pages project that holds the app (the project's files sit under /cad/). Same shape as the /calcs/ router.
const ORIGIN = 'civilkit-cad.pages.dev';
export default {
  async fetch(request) {
    const url = new URL(request.url);
    // the documentation moved to /docs/cad/: keep the old addresses working
    if (url.pathname === '/cad/docs' || url.pathname.startsWith('/cad/docs/')) {
      url.pathname = '/docs/cad' + url.pathname.slice('/cad/docs'.length);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === '/cad') {
      url.pathname = '/cad/';
      return Response.redirect(url.toString(), 301);
    }
    url.hostname = ORIGIN;
    url.port = '';
    return fetch(new Request(url, request));
  },
};
