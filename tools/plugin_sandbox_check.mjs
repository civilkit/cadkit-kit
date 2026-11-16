#!/usr/bin/env node
// Attacks the plugin sandbox with deliberately hostile wasm packages in a real (headless) Chrome and fails if anything gets out.
//   tools/serve_local.sh --port 5191           (a built app must be served; --no-build to reuse a build)
//   node tools/plugin_sandbox_check.mjs --zip <packed woodwork.zip> --work <empty scratch dir> [--port 5191] [--log .serve-local-5191.log]
// It repacks the zip twice with hostile code in front of the glue (hashes fixed up so inspection accepts it): one that tries every way out
// (fetch, parent, top, storage, IndexedDB, XHR, WebSocket, importScripts, beacon, Worker, import of a URL) and one that spins forever.
// Checks: every route reports "blocked", the server log shows no request but the control one, the spinner is stopped at its deadline, the page
// stays responsive, and the real package still builds a cabinet through the sandbox. Needs Google Chrome and `zip`. Exit code 1 on any failure.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const ZIP = arg('zip') && resolve(arg('zip')), WORK = arg('work') && resolve(arg('work')), PORT = arg('port', '5191'), LOG = resolve(arg('log', `.serve-local-${PORT}.log`));
if (!ZIP || !WORK) { console.error('usage: --zip <packed woodwork.zip> --work <scratch dir> [--port 5191] [--log <server log>]'); process.exit(2); }
const PROFILE = join(WORK, 'chrome-profile');
const CH = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch(port, size) {
  mkdirSync(PROFILE, { recursive: true });
  const proc = spawn(CH, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const waiting = new Map(); const logs = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') logs.push(m.params.exceptionDetails?.exception?.description ?? 'exception'); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text)); return r.result?.result?.value; };
  return {
    logs, ev, send,
    goto: async (url) => { await send('Page.navigate', { url }); },
    waitFor: async (expr, ms = 120000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(250); } throw new Error(`timeout: ${expr}`); },
    click: async (selector) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; e.click(); return true; })()`),
    clickText: async (text, scope = 'button, [role=button], [role=tab], [role=menuitem]') => ev(`(() => { const t = ${JSON.stringify(text)}.toLowerCase(); const e = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => (x.innerText || x.getAttribute('aria-label') || '').trim().toLowerCase() === t); if (!e) return false; e.click(); return true; })()`),
    set: async (selector, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, ${JSON.stringify(String(value))}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`),
    shot: async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.result.data, 'base64')); return file; },
    close: () => { try { ws.close(); } catch {} proc.kill(); },
  };
}

// ---- the hostile packages ----
const sha = (b) => createHash('sha256').update(b).digest('hex');
function unzipTo(dir) { mkdirSync(dir, { recursive: true }); execFileSync('unzip', ['-q', '-o', ZIP, '-d', dir]); }
function make(id, name, prelude, limits) {
  const src = join(WORK, 'src'); if (!existsSync(src)) unzipTo(src);
  const out = join(WORK, name); mkdirSync(out, { recursive: true });
  for (const f of readdirSync(src)) if (statSync(join(src, f)).isFile()) writeFileSync(join(out, f), readFileSync(join(src, f)));
  writeFileSync(join(out, 'component.js'), prelude + '\n' + readFileSync(join(src, 'component.js'), 'utf8'));
  const m = JSON.parse(readFileSync(join(src, 'plugin.json'), 'utf8'));
  m.id = id; m.name = name; if (limits) m.wasm.limits = limits;
  m.files = Object.fromEntries(Object.keys(m.files).map((f) => [f, sha(readFileSync(join(out, f)))]));
  writeFileSync(join(out, 'plugin.json'), JSON.stringify(m, null, 2));
  const zip = `${out}.zip`; if (existsSync(zip)) unlinkSync(zip);
  execFileSync('zip', ['-q', '-j', zip, ...Object.keys(m.files).map((f) => join(out, f)), join(out, 'plugin.json')]);
  return zip;
}
const ORIGIN = `http://localhost:${PORT}`;
const exfil = make('evil.exfil', 'hostile-exfil', `
const R = {};
const t = async (k, f) => { try { await f(); R[k] = 'REACHED'; } catch (e) { R[k] = 'blocked'; } };
await t('fetch', () => fetch('${ORIGIN}/__pwn_fetch', { mode: 'no-cors' }));
await t('parent', async () => { if (!parent.document.title && parent.document.title !== '') throw 1; });
await t('top', async () => { top.location.href; });
await t('localStorage', async () => localStorage.length);
await t('indexedDB', async () => { const r = indexedDB.open('ck-plugins'); await new Promise((ok, no) => { r.onsuccess = ok; r.onerror = no; }); });
await t('xhr', () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', '${ORIGIN}/__pwn_xhr'); x.onload = ok; x.onerror = no; x.send(); }));
await t('websocket', () => new Promise((ok, no) => { const w = new WebSocket('ws://localhost:${PORT}/__pwn_ws'); w.onopen = ok; w.onerror = no; }));
await t('importScripts', async () => importScripts('${ORIGIN}/__pwn_import.js'));
await t('beacon', async () => { if (!navigator.sendBeacon('${ORIGIN}/__pwn_beacon', 'x')) throw 1; });
await t('worker', async () => new Worker('${ORIGIN}/__pwn_worker.js'));
await t('dynamic import http', () => import('${ORIGIN}/__pwn_module.js'));
throw new Error('HOSTILE REPORT ' + JSON.stringify(R));
`);
const spin = make('evil.spin', 'hostile-spin', 'const t0 = Date.now(); while (Date.now() - t0 < 600000) {}', { deadlineMs: 3000, maxCommands: 256 });

// ---- the run ----
const fails = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const logBefore = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').length : 0;
const c = await launch(9400 + Math.floor(Math.random() * 90), [1440, 900]);
const install = async (zip, id) => {
  if (await c.ev(`!!document.querySelector('[data-testid="plugin-row-${id}"]')`)) { await c.click(`[data-testid="plugin-remove-${id}"]`); await sleep(800); }
  const doc = (await c.send('DOM.getDocument')).result.root.nodeId;
  const node = (await c.send('DOM.querySelector', { nodeId: doc, selector: '[data-testid=plugin-file]' })).result.nodeId;
  await c.send('DOM.setFileInputFiles', { nodeId: node, files: [zip] });
  await c.waitFor("document.querySelector('[data-testid=plugin-install]')", 20000);
  await c.click('[data-testid=plugin-install]'); await sleep(1500);
};
const runGenerator = async (id) => {
  await c.click(`[data-testid="plugin-item-${id}-cabinet"]`);
  const t0 = Date.now();
  await c.waitFor("document.querySelector('[data-testid=plugin-hint]') || (document.querySelector('[data-path=width]') && !document.querySelector('[data-testid=plugin-busy]'))", 60000).catch(() => {});
  await sleep(3500);
  const hint = await c.ev("document.querySelector('[data-testid=plugin-hint]')?.innerText ?? ''");
  const ok = await c.ev("1 + 1");
  await c.click('[data-testid=plugin-back]'); await sleep(500);
  return { hint, responsive: ok === 2, ms: Date.now() - t0 };
};
try {
  await c.goto(`${ORIGIN}/?noprompt=1`);
  await c.waitFor("document.querySelector('.status .ready')", 180000);
  await c.clickText('Start new'); await sleep(800);
  const control = await c.ev("fetch('/__pwn_control').then(() => 'reached').catch(() => 'blocked')");
  check(control === 'reached', 'positive control: the page itself can reach the server');
  await c.click('[data-testid=ribbon-tab-Features]');
  await c.waitFor("document.querySelector('[data-testid=cmd-add-plugin]') && !document.querySelector('[data-testid=cmd-add-plugin]').disabled", 20000);
  await c.click('[data-testid=cmd-add-plugin]'); await c.waitFor("document.querySelector('[data-testid=plugin-manage]')", 20000);
  if (!(await c.ev("document.querySelector('[data-testid=plugin-thirdparty]').checked"))) await c.click('[data-testid=plugin-thirdparty]');
  await c.waitFor("document.querySelector('[data-testid=plugin-file]')", 20000);

  await install(exfil, 'evil.exfil');
  const e = await runGenerator('evil.exfil');
  const report = /HOSTILE REPORT (\{.*\})/.exec(e.hint);
  check(!!report, 'the hostile glue ran inside the sandbox and reported back');
  const routes = report ? JSON.parse(report[1]) : {};
  for (const [k, v] of Object.entries(routes)) check(v === 'blocked', `exfil route "${k}" is blocked`);
  check(Object.keys(routes).length >= 10, 'all eleven routes were attempted');
  check(e.responsive, 'page responsive after the exfil package');

  await install(spin, 'evil.spin');
  const s = await runGenerator('evil.spin');
  check(/deadline of 3000 ms exceeded/.test(s.hint), 'the spinning package was stopped at its deadline');
  check(s.responsive, 'page responsive while a package spins');

  await install(ZIP, 'tomasdjo.woodwork');
  const w = await runGenerator('tomasdjo.woodwork');
  check(w.hint === '', 'the real package still builds through the sandbox');
  for (const id of ['evil.exfil', 'evil.spin']) { await c.click(`[data-testid="plugin-remove-${id}"]`); await sleep(500); }
} finally { c.close(); }
const lines = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').slice(logBefore) : [];
const pwn = lines.filter((l) => l.includes('__pwn'));
check(pwn.length > 0 && pwn.every((l) => l.includes('__pwn_control')), `the server saw only the control request (${pwn.length} __pwn line${pwn.length === 1 ? '' : 's'})`);
console.log(fails.length ? `\n${fails.length} check(s) FAILED` : '\nsandbox holds');
process.exit(fails.length ? 1 : 0);
