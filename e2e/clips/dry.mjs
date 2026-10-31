// Dry run of one clip script without encoding: node e2e/clips/dry.mjs --url URL --only NAME   (CLIP_SHOTS=DIR writes rec.shot() pictures)
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdirSync, mkdirSync } from 'node:fs';
import { installPointer, makeRec, openApp } from './lib.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('--url', ''), only = arg('--only', '');
if (process.env.CLIP_SHOTS) mkdirSync(process.env.CLIP_SHOTS, { recursive: true });
const file = readdirSync(here).find((f) => /^\d\d-.*\.mjs$/.test(f) && f.includes(only));
const mod = (await import(pathToFileURL(join(here, file)).href)).default;
const browser = await chromium.launch({ args: process.env.CLIP_GL === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const ctx = await browser.newContext({ viewport: mod.viewport ?? { width: 1440, height: 810 }, colorScheme: 'light', deviceScaleFactor: 1 });
await installPointer(ctx);
const page = await ctx.newPage();
const rec = makeRec(page, { t0: Date.now() });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
let err = null;
try { await openApp(page, url); await mod.run(rec, { url }); } catch (e) { err = e; console.log('FAIL', e.stack ?? e); await rec.shot('zz-failure'); }
console.log(err ? 'dry run failed' : `dry run ok in ${rec.now().toFixed(1)} s`);
await browser.close();
process.exit(err ? 1 : 0);
