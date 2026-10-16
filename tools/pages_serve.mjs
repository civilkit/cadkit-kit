#!/usr/bin/env node
// Tiny static server for checking a pages build the way GitHub Pages serves it: the folder is mounted under a URL prefix.
//   node tools/pages_serve.mjs <dir> [--port 8080] [--prefix /my-repo/]      (prefix '/' = domain root)
// Logs every request with its status, so a 404 is easy to spot. No dependencies; application/wasm for .wasm.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ckpart': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };

/** @returns {Promise<import('node:http').Server>} listening server; `log` receives {url,status} per request */
export function serve(dir, { port = 0, prefix = '/', log = () => {} } = {}) {
  const root = resolve(dir);
  const pre = ('/' + prefix.replace(/^\/+|\/+$/g, '') + '/').replace(/^\/\/$/, '/');
  const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const send = (status, body, type = 'text/plain') => { log({ url, status }); res.writeHead(status, { 'content-type': type }); res.end(body); };
    if (!url.startsWith(pre)) return send(404, 'not under the prefix');
    let rel = normalize(url.slice(pre.length));
    if (rel.startsWith('..')) return send(403, 'no');
    let file = join(root, rel);
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { return send(404, 'not found'); }
    try { send(200, await readFile(file), TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'); } catch { send(404, 'not found'); }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
  const dir = a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--')) ?? 'dist-pages';
  const s = await serve(dir, { port: +opt('--port', 8080), prefix: opt('--prefix', '/'), log: ({ url, status }) => console.log(status, url) });
  console.log(`serving ${resolve(dir)} at http://127.0.0.1:${s.address().port}${opt('--prefix', '/')}`);
}
