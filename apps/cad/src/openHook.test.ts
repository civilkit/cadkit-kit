import { describe, it, expect, vi } from 'vitest';
import { installOpenHook, isLoopbackHost, nameOfUrl, openParams, withoutOpen, type OpenHookEnv } from './openHook';

const env = (over: Partial<OpenHookEnv> & { search?: string; hostname?: string } = {}): OpenHookEnv & { opened: File[][]; urls: string[] } => {
  const opened: File[][] = []; const urls: string[] = [];
  return {
    loc: { hostname: over.hostname ?? 'localhost', search: over.search ?? '', pathname: '/', hash: '', href: 'http://localhost:5173/' },
    open: (f) => { opened.push(f); },
    fetch: over.fetch ?? (async () => new Response('solid', { status: 200 })),
    replaceUrl: (u) => { urls.push(u); },
    target: over.target ?? {},
    opened, urls,
  };
};

describe('open hook', () => {
  it('loopback hosts only', () => {
    expect(['localhost', '127.0.0.1', '[::1]', 'a.localhost'].every(isLoopbackHost)).toBe(true);
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('localhost.example.com')).toBe(false);
  });
  it('parses and strips ?open', () => {
    expect(openParams('?open=a.stl&x=1&open=b.step')).toEqual(['a.stl', 'b.step']);
    expect(withoutOpen('?open=a.stl&x=1')).toBe('?x=1');
    expect(withoutOpen('?open=a.stl')).toBe('');
    expect(nameOfUrl('/files/van%20scan.stl?v=2', 'http://localhost/')).toBe('van scan.stl');
    expect(nameOfUrl('http://localhost/', 'http://localhost/')).toBe('file');
  });
  it('does nothing off loopback', () => {
    const e = env({ hostname: 'example.com', search: '?open=a.stl' });
    expect(installOpenHook(e)).toBe(false);
    expect(e.target?.ckOpenFile).toBeUndefined();
    expect(e.urls).toEqual([]);
  });
  it('installs ckOpenFile, which opens a blob under the given name', async () => {
    const e = env();
    expect(installOpenHook(e)).toBe(true);
    await e.target!.ckOpenFile!(new Blob(['x']), 'van.stl');
    expect(e.opened[0][0].name).toBe('van.stl');
  });
  it('fetches ?open urls, opens them in order and removes the parameter', async () => {
    const fetched: string[] = [];
    const e = env({ search: '?open=http://localhost:9/van.stl&k=1', fetch: async (u) => { fetched.push(u); return new Response('d'); } });
    installOpenHook(e);
    await vi.waitFor(() => expect(e.opened.length).toBe(1));
    expect(fetched).toEqual(['http://localhost:9/van.stl']);
    expect(e.opened[0].map((f) => f.name)).toEqual(['van.stl']);
    expect(e.urls).toEqual(['/?k=1']);
  });
  it('reports a failed fetch and still opens the rest', async () => {
    const msgs: string[] = [];
    const e = env({ search: '?open=/bad.stl&open=/ok.stl', fetch: async (u) => (u === '/bad.stl' ? new Response('no', { status: 404 }) : new Response('d')) });
    e.onError = (m) => msgs.push(m);
    installOpenHook(e);
    await vi.waitFor(() => expect(e.opened.length).toBe(1));
    expect(msgs).toEqual(['/bad.stl: 404']);
    expect(e.opened[0].map((f) => f.name)).toEqual(['ok.stl']);
  });
});
