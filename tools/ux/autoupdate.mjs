#!/usr/bin/env node
// Real-browser check of the automatic update, on a production pages build (no Vite, no dev hook).
//   node tools/ux/autoupdate.mjs --dir <pages build> --work <scratch dir> [--out <screenshot dir>]
// Serves build A, opens it, then swaps the served folder for build B (a copy of A whose main bundle has another name and whose version.json says
// 9.9.9) on the same port and emulates the app going to the background and coming back (document.visibilityState overridden, Date.now skewed so
// the 60 s away time does not have to be waited for). The page is opened through 0.0.0.0, which is not localhost (the update watch is off there):
// 0.0.0.0 reaches the loopback server and Chrome treats the origin as secure so the service worker registers too.
// Cases: clean part -> reloads by itself and says "Updated to 9.9.9"; unsaved part -> the notice, no reload; a dialog open -> the notice;
// setting off -> the notice; a touch after coming back -> the notice. A failed case exits 1.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launchChrome, Page } from './cdp.mjs';
import { serve } from '../pages_serve.mjs';

const a = process.argv.slice(2), arg = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
const A = resolve(arg('dir') ?? ''), WORK = resolve(arg('work') ?? ''), OUT = resolve(arg('out') ?? join(WORK, 'shots'));
if (!existsSync(join(A, 'index.html')) || !arg('work')) { console.error('usage: autoupdate.mjs --dir <pages build> --work <scratch dir> [--out <dir>]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 8700 + Math.floor(Math.random() * 90), CHROME = 9700 + Math.floor(Math.random() * 90), HOST = '0.0.0.0';
const URL_ = `http://${HOST}:${PORT}/`;

// build B: another bundle name for the main script, a newer version.json, a new worker id
const B = join(WORK, 'build-b');
if (!existsSync(B)) {
  cpSync(A, B, { recursive: true });
  const html = readFileSync(join(B, 'index.html'), 'utf8');
  const m = /assets\/(index-[^"]+\.js)/.exec(html);
  if (!m) throw new Error('no main bundle in index.html');
  renameSync(join(B, 'assets', m[1]), join(B, 'assets', 'index-ZZZZZZZZ.js'));
  writeFileSync(join(B, 'index.html'), html.replace(m[1], 'index-ZZZZZZZZ.js'));
  const v = JSON.parse(readFileSync(join(B, 'version.json'), 'utf8'));
  writeFileSync(join(B, 'version.json'), JSON.stringify({ ...v, version: '9.9.9' }) + '\n');
  writeFileSync(join(B, 'sw.js'), readFileSync(join(B, 'sw.js'), 'utf8').replace(/const BUILD = "[0-9a-f]+"/, 'const BUILD = "bbbbbbbbbbbb"'));
}

let server = null, served = '';
const swap = async (dir) => {
  if (server) { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); }
  server = await serve(dir, { port: PORT }); served = dir === A ? 'A' : 'B';
};

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); if (!ok) failed++; };
const shot = async (page, name) => writeFileSync(join(OUT, name + '.png'), await page.screenshot());
const bundle = (page) => page.eval(`[...document.scripts].map((s) => s.getAttribute('src') || '').find((s) => /assets\\/index-.*\\.js/.test(s)) || ''`);
const text = (page, sel) => page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim()).join(' | ')`);
const ready = async (page) => { for (let i = 0; i < 200 && !(await page.eval(`!!document.querySelector('.status .ready')`).catch(() => false)); i++) await sleep(250); };

process.env.UX_CHROME_ARGS = `--unsafely-treat-insecure-origin-as-secure=http://${HOST}:${PORT}`;
const chrome = await launchChrome({ port: CHROME, width: 1280, height: 800 });
const flags = [];
try {
  /** One case: serve A, open it with `setup`, go to B, hide for 70 s and come back; `touch` taps the page right after coming back. */
  const scenario = async (name, { setup = async () => {}, setStorage = {}, touch = false, wantReload, wantNotice, wantToast, dirtyText }) => {
    console.log(`\n== ${name}`);
    await swap(A);
    const page = await Page.open(CHROME);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew; let vis = 'visible'; Object.defineProperty(document, 'visibilityState', { get: () => vis }); window.__setVis = (v) => { vis = v; document.dispatchEvent(new Event('visibilitychange')); }; window.__navs = (window.__navs || 0); })()` });
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await page.goto(URL_);
    for (let i = 0; i < 60 && !(await page.eval(`location.href.startsWith('http://${HOST}') && document.readyState !== 'loading'`).catch(() => false)); i++) await sleep(250);
    await page.eval(`localStorage.clear(); sessionStorage.clear(); const it = ${JSON.stringify({ 'cad.theme': '"light"', ...setStorage })}; for (const k in it) localStorage.setItem(k, it[k]); 0`);
    await page.send('Page.reload'); await sleep(1000);
    await ready(page);
    await setup(page);
    const before = await bundle(page);
    await page.eval(`window.__marker = 'same-page'; 0`);
    check('opened build A', /index-/.test(before) && !/ZZZZZZZZ/.test(before), before);
    await sleep(1500);
    await shot(page, `${name}-1-open`);
    await swap(B);
    await page.eval(`window.__setVis('hidden'); window.__skew += 70000; 0`);
    await sleep(300);
    // a touch lands in the same task as the return, before the check's answer arrives (the app reloads within a few ms otherwise)
    await page.eval(`window.__setVis('visible'); ${touch ? `window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));` : ''} 0`);
    await sleep(4000);
    let after, marker;
    try { after = await bundle(page); marker = await page.eval(`window.__marker ?? null`); } catch { await sleep(2500); after = await bundle(page); marker = await page.eval(`window.__marker ?? null`); }
    for (let i = 0; i < 40 && wantReload && !(await page.eval(`!!document.querySelector('.status')`).catch(() => false)); i++) await sleep(250);
    const reloaded = marker === null;
    const notice = await text(page, '.update-note');
    const toast = await text(page, '.toast');
    await shot(page, `${name}-2-after`);
    check(`reloaded: ${wantReload}`, reloaded === wantReload, `bundle ${before} -> ${after}`);
    check(`bundle is ${wantReload ? 'B' : 'A'}`, wantReload ? /ZZZZZZZZ/.test(after) : !/ZZZZZZZZ/.test(after), after);
    check(`notice shown: ${wantNotice}`, !!notice === wantNotice, notice);
    if (dirtyText) check('notice says to save first', /unsaved/i.test(notice), notice);
    check(`toast "Updated to 9.9.9": ${!!wantToast}`, /Updated to 9\.9\.9/.test(toast) === !!wantToast, toast);
    if (wantToast) { await sleep(300); await shot(page, `${name}-3-toast`); }
    const sw = await page.eval(`navigator.serviceWorker ? navigator.serviceWorker.getRegistration().then((r) => r ? (r.active ? 'active' : 'registered') : 'none') : 'unsupported'`).catch(() => '?');
    flags.push(`${name}: service worker ${sw}`);
    page.close();
  };

  const fresh = async () => {};   // a fresh start: one empty part, nothing modified
  const restoreSample = (file) => async (page) => {
    const d = JSON.parse(readFileSync(join(A, 'samples', file), 'utf8'));
    await page.eval(`localStorage.setItem('cad.autosave.v1', ${JSON.stringify(JSON.stringify({ name: d.name ?? 'Part', doc: d, savedAt: Date.now() }))}); 0`);
    await page.send('Page.reload'); await sleep(1200);
    for (let i = 0; i < 40; i++) { const hit = await page.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Restore'); if (b) b.click(); return !!b; })()`).catch(() => false); if (hit) break; await sleep(150); }
    await ready(page); await sleep(1000);
  };
  const sample = readdirSync(join(A, 'samples')).find((f) => f.endsWith('.ckpart'));

  await scenario('clean-auto-reload', { setup: fresh, wantReload: true, wantNotice: false, wantToast: true });
  await scenario('unsaved-notice', { setup: restoreSample(sample), wantReload: false, wantNotice: true, wantToast: false, dirtyText: true });
  await scenario('setting-off-notice', { setup: fresh, setStorage: { 'cad.autoUpdate': 'false' }, wantReload: false, wantNotice: true, wantToast: false });
  await scenario('dialog-open-notice', { setup: async (p) => { await p.eval(`document.querySelector('.topbar button[aria-label*="ettings"]')?.click(); 0`); await sleep(800); if (!(await p.eval(`!!document.querySelector('[role="dialog"], dialog[open]')`))) throw new Error('the Settings dialog did not open'); await p.eval(`[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'General')?.click(); 0`); await sleep(400); await shot(p, 'settings-general'); }, wantReload: false, wantNotice: true, wantToast: false });
  await scenario('touched-notice', { setup: fresh, touch: true, wantReload: false, wantNotice: true, wantToast: false });
} finally { chrome.close(); if (server) server.close(); }
for (const f of flags) console.log(f);
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
