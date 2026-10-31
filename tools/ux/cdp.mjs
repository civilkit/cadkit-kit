// Minimal Chrome DevTools Protocol client (ws package) and a headless Chrome launcher.
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const CHROME_CANDIDATES = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);

export function findChrome() {
  const c = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!c) throw new Error('no Chrome binary found; set CHROME_BIN');
  return c;
}

/** Launch ONE headless Chrome with a remote debugging port; returns {port, close()}. */
export async function launchChrome({ port, profileDir, width = 1440, height = 900 }) {
  const dir = profileDir ?? mkdtempSync(join(process.env.UX_TMP ?? tmpdir(), 'ux-chrome-'));
  const proc = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(process.env.UX_CHROME_ARGS ?? '').split(/\s+/).filter(Boolean), `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { port, proc, close() { try { proc.kill('SIGTERM'); setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 3000).unref(); } catch { /* gone */ } } };
}

export class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = [];
    ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && this.pending.has(d.id)) { const { res, rej } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
      else if (d.method === 'Page.javascriptDialogOpening') this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});   // beforeunload prompt of a dirty document would freeze every call
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') this.logs.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
      else if (d.method === 'Runtime.exceptionThrown') this.logs.push('exception: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)); }); }
  static async open(port) {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const p = new Page(ws); await p.send('Page.enable'); await p.send('Runtime.enable'); return p;
  }
  send(method, params = {}, timeout = 30000) { const id = ++this.id; return new Promise((res, rej) => { const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP ${method} timed out (page busy or hung)`)); }, timeout); this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr, { await: aw = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: aw, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async setViewport(width, height, dark) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  }
  /** Phone or tablet: mobile metrics (device pixel ratio, orientation), touch events, and so a coarse pointer without hover. */
  async setMobile(width, height, { dark = false, dpr = 2 } = {}) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: true, screenWidth: width, screenHeight: height,
      screenOrientation: width > height ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  }
  async clearMobile() {
    await this.send('Emulation.clearDeviceMetricsOverride');
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
  /** One touch event; `points` are {x, y, id?} for every finger that is down after it ([] for the end of the last one). */
  async touch(type, points = []) {
    await this.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 1, radiusY: 1, force: 1 })) });
  }
  async tap(x, y) { await this.touch('touchStart', [{ x, y }]); await new Promise((r) => setTimeout(r, 40)); await this.touch('touchEnd'); }
  /** One finger from (x0, y0) to (x1, y1) in `steps` moves. */
  async swipe(x0, y0, x1, y1, { steps = 10, ms = 16 } = {}) {
    await this.touch('touchStart', [{ x: x0, y: y0 }]);
    for (let i = 1; i <= steps; i++) { await new Promise((r) => setTimeout(r, ms)); await this.touch('touchMove', [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }]); }
    await this.touch('touchEnd');
  }
  /** Two fingers either side of (cx, cy), `r0` px from it apart each, moving to `r1`: a pinch (r1 < r0) or a spread. */
  async pinch(cx, cy, r0, r1, { steps = 10, ms = 16 } = {}) {
    const at = (r) => [{ x: cx - r, y: cy, id: 0 }, { x: cx + r, y: cy, id: 1 }];
    await this.touch('touchStart', at(r0));
    for (let i = 1; i <= steps; i++) { await new Promise((r) => setTimeout(r, ms)); await this.touch('touchMove', at(r0 + ((r1 - r0) * i) / steps)); }
    await this.touch('touchEnd');
  }
  async goto(url) { await this.send('Page.navigate', { url }); await new Promise((r) => setTimeout(r, 300)); }
  async screenshot() { const r = await this.send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(r.data, 'base64'); }
  async key(key, { ctrl = false, shift = false } = {}) {
    const code = key.length === 1 ? 'Key' + key.toUpperCase() : key;
    const mods = (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const base = { key, code, modifiers: mods, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : ({ Escape: 27, Enter: 13, Tab: 9 }[key] ?? 0) };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key.length === 1 && !ctrl ? key : undefined });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async mouse(type, x, y, button = 'left') { await this.send('Input.dispatchMouseEvent', { type, x, y, button, buttons: button === 'left' ? 1 : 0, clickCount: 1 }); }
  async click(x, y) { await this.mouse('mouseMoved', x, y); await this.mouse('mousePressed', x, y); await this.mouse('mouseReleased', x, y); }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}
