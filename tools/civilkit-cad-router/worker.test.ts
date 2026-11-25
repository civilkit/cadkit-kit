// @vitest-environment node
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS worker module
import { hubRelay, releaseZipUrl } from './worker.js';

const ok = 'https://github.com/o/r/releases/download/v1.0/p-1.0.zip';
const req = (path: string, init: RequestInit = {}) => new Request(`https://civilkit.io${path}`, init);
const zipReq = (u: string) => req(`/cad/hub-zip?url=${encodeURIComponent(u)}`);
const bytes = (n: number) => new Uint8Array(n).fill(7);

describe('Hub relay address check', () => {
  it('takes only a GitHub release zip', () => {
    expect(releaseZipUrl(ok)).toBe(ok);
    for (const bad of [
      'http://github.com/o/r/releases/download/v1/p.zip', 'https://evil.example/o/r/releases/download/v1/p.zip', 'https://github.com.evil.example/o/r/releases/download/v1/p.zip',
      'https://user@github.com/o/r/releases/download/v1/p.zip', 'https://github.com:444/o/r/releases/download/v1/p.zip', 'https://github.com/o/r/releases/download/v1/p.zip?x=1',
      'https://github.com/o/r/archive/refs/tags/v1.zip', 'https://github.com/o/r/releases/download/v1/p.tar.gz', 'https://github.com/o/r/releases/download/v1/a/p.zip', 'https://github.com/o/r/releases/download/v1/%2e%2e%2fp.zip',
      'https://raw.githubusercontent.com/o/r/main/p.zip', 'not a url', '',
    ]) expect(releaseZipUrl(bad), bad).toBeNull();
  });
});

describe('Hub relay', () => {
  it('is not for other paths', async () => { expect(await hubRelay(req('/cad/'), async () => new Response('x'))).toBeNull(); });
  it('refuses an address of the wrong shape and any method but GET', async () => {
    let called = false;
    const f = async () => { called = true; return new Response('x'); };
    expect((await hubRelay(zipReq('https://evil.example/a.zip'), f)).status).toBe(400);
    expect((await hubRelay(req('/cad/hub-zip'), f)).status).toBe(400);
    expect((await hubRelay(req('/cad/hub-zip', { method: 'POST' }), f)).status).toBe(405);
    expect(called).toBe(false);
    const pre = await hubRelay(req('/cad/hub-zip', { method: 'OPTIONS' }), f);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('follows GitHub\'s redirect to its download host, forwards no cookies, and answers with CORS and a zip type', async () => {
    const seen: Array<{ url: string; cookie: string | null; redirect: string | undefined }> = [];
    const f = async (url: string, init: RequestInit) => {
      seen.push({ url, cookie: new Headers(init.headers).get('cookie'), redirect: init.redirect });
      if (url.startsWith('https://github.com/')) return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/x/y?sig=1' } });
      return new Response(bytes(1000), { status: 200, headers: { 'content-length': '1000' } });
    };
    const r = await hubRelay(zipReq(ok), f as never);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('content-type')).toBe('application/zip');
    expect((await r.arrayBuffer()).byteLength).toBe(1000);
    expect(seen.map((s) => s.url)).toEqual([ok, 'https://release-assets.githubusercontent.com/x/y?sig=1']);
    expect(seen.every((s) => s.cookie === null && s.redirect === 'manual')).toBe(true);
  });
  it('does not follow a redirect to any other host', async () => {
    const f = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
    expect((await hubRelay(zipReq(ok), f as never)).status).toBe(502);
    const g = async () => new Response(null, { status: 302, headers: { location: 'http://github.com/downgrade' } });
    expect((await hubRelay(zipReq(ok), g as never)).status).toBe(502);
  });
  it('stops a download over 8 MB, by its declared size and by what actually arrives', async () => {
    const declared = async () => new Response(bytes(10), { status: 200, headers: { 'content-length': String(9 * 1024 * 1024) } });
    expect((await hubRelay(zipReq(ok), declared as never)).status).toBe(413);
    const liar = async () => new Response(new Blob([bytes(9 * 1024 * 1024)]).stream(), { status: 200 });
    const r = await hubRelay(zipReq(ok), liar as never);
    await expect(r.arrayBuffer()).rejects.toThrow();
  });
  it('passes a missing file on as 404 and a server error as 502', async () => {
    expect((await hubRelay(zipReq(ok), (async () => new Response('no', { status: 404 })) as never)).status).toBe(404);
    expect((await hubRelay(zipReq(ok), (async () => new Response('no', { status: 500 })) as never)).status).toBe(502);
  });
  it('relays the catalog from its one fixed address', async () => {
    let asked = '';
    const f = async (url: string) => { asked = url; return new Response('{"plugins":[]}', { status: 200 }); };
    const r = await hubRelay(req('/cad/hub-catalog?url=https://evil.example/x'), f as never);
    expect(asked).toBe('https://tharje.github.io/solidcraft-plugins/data/plugins.json');
    expect(r.headers.get('content-type')).toMatch(/json/);
    expect(await r.text()).toBe('{"plugins":[]}');
  });
});
