#!/usr/bin/env node
// Renders the installable-app icons (a cube on the app's dark background) to apps/cad/public/icons/ with headless Chrome:
//   node tools/pwa_icons.mjs --profile <scratch dir> [--port 9351]
// icon-192.png, icon-512.png (purpose any), icon-maskable-512.png (full-bleed, glyph inside the 80 % safe zone), apple-touch-icon.png (180).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, Page } from './ux/cdp.mjs';

const a = process.argv.slice(2);
const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const profile = opt('--profile');
if (!profile) { console.error('--profile <dir> (a scratch folder for the Chrome profile) is required'); process.exit(2); }
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/cad/public/icons');
mkdirSync(out, { recursive: true });

// the glyph lives in a 100 x 100 box; `scale` shrinks it about the centre (the maskable icon keeps it inside the safe zone)
const svg = (scale, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <rect width="100" height="100" ${rounded ? 'rx="22"' : ''} fill="#131b25"/>
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">
    <polygon points="50,16 82,34 50,52 18,34" fill="#dfe9f7"/>
    <polygon points="18,34 50,52 50,86 18,68" fill="#9db4d6"/>
    <polygon points="82,34 50,52 50,86 82,68" fill="#6f8fbd"/>
    <polyline points="18,34 50,52 82,34" fill="none" stroke="#4a9eff" stroke-width="2.2" stroke-linejoin="round"/>
    <line x1="50" y1="52" x2="50" y2="86" stroke="#4a9eff" stroke-width="2.2"/>
  </g></svg>`;

const jobs = [
  ['icon-192.png', 192, svg(1, true)],
  ['icon-512.png', 512, svg(1, true)],
  ['icon-maskable-512.png', 512, svg(0.8, false)],
  ['apple-touch-icon.png', 180, svg(1, false)],
];

const chrome = await launchChrome({ port: +opt('--port', 9351), profileDir: resolve(profile) });
try {
  const page = await Page.open(chrome.port);
  for (const [name, size, markup] of jobs) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const html = `<!doctype html><meta charset=utf-8><style>html,body{margin:0;width:${size}px;height:${size}px;background:transparent;overflow:hidden}</style>${markup}`;
    await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(resolve(out, name), await page.screenshot());
    console.log('wrote', name, size + 'x' + size);
  }
} finally { chrome.close(); }
process.exit(0);
