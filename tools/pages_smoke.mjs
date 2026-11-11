#!/usr/bin/env node
// Loads a pages build in ONE headless Chrome (own debug port and profile) served under a URL prefix, opens a sample, waits for the kernel to
// regenerate it and fails on any 4xx/5xx response, failed request, console error or exception.
//   node tools/pages_smoke.mjs <dir> --prefix /repo/ --port 8123 --chrome-port 9333 --profile <scratch dir> [--sample bench-bolt] [--shot out.png]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from './pages_serve.mjs';
import { launchChrome, Page } from './ux/cdp.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const dir = a.find((x, i) => !x.startsWith('--') && !a[i - 1]?.startsWith('--')) ?? 'dist-pages';
const prefix = opt('--prefix', '/');
const sample = opt('--sample', 'bench-bolt');
const profile = opt('--profile');
if (!profile) { console.error('--profile <dir> (a scratch folder for the Chrome profile) is required'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const requests = [];
const server = await serve(dir, { port: +opt('--port', 0), prefix, log: (r) => requests.push(r) });
const base = `http://127.0.0.1:${server.address().port}${prefix}`;
const chrome = await launchChrome({ port: +opt('--chrome-port', 9333), profileDir: resolve(profile) });
const problems = [];
let page;
try {
  page = await Page.open(chrome.port);
  await page.send('Network.enable');
  page.ws.on('message', (m) => {
    const d = JSON.parse(m);
    if (d.method === 'Network.responseReceived' && d.params.response.status >= 400) problems.push(`HTTP ${d.params.response.status} ${d.params.response.url}`);
    if (d.method === 'Network.loadingFailed' && !d.params.canceled) problems.push(`request failed ${d.params.errorText} ${d.params.requestId}`);
  });
  await page.goto(base);
  const waitFor = async (expr, what, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.eval(expr).catch(() => false)) return; await sleep(200); } throw new Error(`timed out waiting for ${what}`); };
  await waitFor(`!!document.querySelector('button[aria-label="Library"]')`, 'the app to render');
  console.log('app rendered at', base);
  await page.eval(`document.querySelector('button[aria-label="Library"]').click()`);
  await waitFor(`document.querySelectorAll('.dlg-item').length > 0`, 'the samples dialog');
  const listed = await page.eval(`document.querySelectorAll('.dlg-item').length`);
  console.log('samples listed:', listed);
  const imgOk = await page.eval(`new Promise((r) => setTimeout(() => r([...document.querySelectorAll('.dlg-item img')].filter((i) => i.complete && i.naturalWidth > 0).length), 1500))`);
  console.log('thumbnails loaded:', imgOk);
  const title = await page.eval(`(() => { const b = [...document.querySelectorAll('.dlg-item')].find((e) => e.querySelector('img')?.src.endsWith('/${sample}.webp')); if (!b) return null; b.click(); return b.textContent; })()`);
  if (!title) throw new Error(`sample ${sample} is not listed`);
  console.log('opened sample:', title);
  // the kernel regenerates the part in the worker; a feature tree row and a non-empty status prove it ran
  await waitFor(`(() => { const s = document.querySelector('.status'); return !!s && /ready|\\d/i.test(s.textContent || '') && document.querySelectorAll('canvas').length > 0; })()`, 'the part to load');
  await sleep(4000);
  const state = await page.eval(`JSON.stringify({ status: document.querySelector('.status')?.textContent?.slice(0, 160), title: document.title, errors: document.querySelectorAll('[class*=error],[role=alert]').length })`);
  console.log('page state:', state);
  const lic = await page.eval(`fetch(document.getElementById('licences-link').href).then((r) => r.text().then((t) => r.status + ' ' + /BOSL2/.test(t) + ' ' + /BSD 2-Clause/.test(t)))`);
  console.log('licences page (status, mentions BOSL2, has BSD text):', lic);
  if (!/^200 true true$/.test(lic)) throw new Error('licences page is missing or incomplete: ' + lic);
  const shot = opt('--shot');
  if (shot) writeFileSync(shot, await page.screenshot());
  for (const l of page.logs) problems.push('console: ' + l);
} catch (e) {
  problems.push(String(e.message ?? e));
} finally {
  page?.close(); chrome.close(); server.close();
}
const bad = requests.filter((r) => r.status >= 400);
for (const r of bad) problems.push(`server saw ${r.status} ${r.url}`);
console.log(`${requests.length} requests, ${bad.length} not-found`);
console.log([...new Set(requests.filter((r) => /wasm|index\.json/.test(r.url)).map((r) => `${r.status} ${r.url}`))].join('\n'));
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('smoke test passed');
