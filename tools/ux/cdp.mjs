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
  const proc = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { port, proc, close() { try { proc.kill('SIGTERM'); } catch { /* gone */ } } };
}

export class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.logs = [];
    ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && this.pending.has(d.id)) { const { res, rej } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') this.logs.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
      else if (d.method === 'Runtime.exceptionThrown') this.logs.push('exception: ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)); }); }
  static async open(port) {
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const p = new Page(ws); await p.send('Page.enable'); await p.send('Runtime.enable'); return p;
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr, { await: aw = true } = {}) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: aw, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async setViewport(width, height, dark) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
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
