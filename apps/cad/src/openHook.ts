// A way for automation to open a file in a running app without the agent link: a page on a loopback host only.
//   window.ckOpenFile(fileOrBlob, name?)   opens it as if it had been dropped on the window
//   ?open=<url>  (repeatable)             fetches each URL and opens it the same way, then removes the parameter
// A browser page cannot read a file path, so the URL must be one the page can fetch (same origin, or a server that allows it).
// Not on a published or non-loopback page: there nothing but the user's own drop, picker or launch opens a file.

export const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');

/** The URLs of `?open=` (a repeated parameter opens each, in order), as written. */
export const openParams = (search: string): string[] => new URLSearchParams(search).getAll('open').filter((u) => u.trim() !== '');

/** The file name of a URL: the last path segment, decoded; `file` when there is none. */
export function nameOfUrl(url: string, base: string): string {
  try {
    const seg = new URL(url, base).pathname.split('/').filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : 'file';
  } catch { return 'file'; }
}

/** The search string without any `open` parameter (the rest is kept). */
export function withoutOpen(search: string): string {
  const p = new URLSearchParams(search);
  p.delete('open');
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function toFile(x: Blob | File, name?: string): File {
  const n = name ?? (x as File).name ?? 'file';
  return x instanceof File && x.name === n ? x : new File([x], n, { type: x.type });
}

export interface OpenHookEnv {
  loc: { hostname: string; search: string; pathname: string; hash: string; href: string };
  open(files: File[]): void | Promise<void>;
  fetch(url: string): Promise<Response>;
  /** replace the address without reloading */
  replaceUrl(url: string): void;
  /** where the hook puts `ckOpenFile`; undefined when there is nothing to install on */
  target?: { ckOpenFile?: (x: Blob | File, name?: string) => Promise<void> };
  onError?(message: string): void;
}

/** Installs the hook on a loopback page and opens the `?open=` files. Returns false (and does nothing) elsewhere. */
export function installOpenHook(env: OpenHookEnv): boolean {
  if (!isLoopbackHost(env.loc.hostname)) return false;
  if (env.target) env.target.ckOpenFile = async (x, name) => { await env.open([toFile(x, name)]); };
  const urls = openParams(env.loc.search);
  if (urls.length) {
    env.replaceUrl(env.loc.pathname + withoutOpen(env.loc.search) + env.loc.hash);
    void (async () => {
      const files: File[] = [];
      for (const u of urls) {
        try {
          const r = await env.fetch(u);
          if (!r.ok) { env.onError?.(`${u}: ${r.status}`); continue; }
          files.push(toFile(await r.blob(), nameOfUrl(u, env.loc.href)));
        } catch (e) { env.onError?.(`${u}: ${(e as Error).message}`); }
      }
      if (files.length) await env.open(files);
    })();
  }
  return true;
}
