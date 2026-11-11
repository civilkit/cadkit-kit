#!/usr/bin/env node
// Records the What's new clips against a built pages app (served locally, headless Chrome), one module per clip: tools/clips/NN-name.mjs
// exports { id, viewport?, crop?, width?, fps?, run(rec, ctx) }.  Clip files go to apps/cad/public/whats-new/clips (not committed), posters to
// apps/cad/public/whats-new/posters (committed, at most 60 KB).
//   node tools/clips/record.mjs --dir dist-pages-civilkit/cad --profile <scratch dir> [--only <id>] [--chrome-port 9391]
import { readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from '../pages_serve.mjs';
import { launchChrome, Page } from '../ux/cdp.mjs';
import { Rec, sleep } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const opt = (k, d) => (a.includes(k) ? a[a.indexOf(k) + 1] : d);
const dir = opt('--dir', 'dist-pages-civilkit/cad');
const profile = opt('--profile');
if (!profile) { console.error('--profile <dir> (a scratch folder for the Chrome profile) is required'); process.exit(2); }
const only = opt('--only');
const outDir = resolve(here, '../../apps/cad/public/whats-new/clips');
const posterDir = resolve(here, '../../apps/cad/public/whats-new/posters');

const mods = [];
for (const f of readdirSync(here).filter((x) => /^\d\d-.*\.mjs$/.test(x)).sort()) mods.push((await import(pathToFileURL(join(here, f)))).default);
const todo = mods.filter((m) => !only || m.id === only);
if (!todo.length) { console.error('no clip matches'); process.exit(2); }

const server = await serve(resolve(dir), { port: 0, prefix: '/', log: () => {} });
const base = `http://127.0.0.1:${server.address().port}/`;
const chrome = await launchChrome({ port: +opt('--chrome-port', 9391), profileDir: resolve(profile) });
let failed = 0;
try {
  for (const m of todo) {
    const page = await Page.open(chrome.port);
    try {
      const vp = m.viewport ?? [1280, 720];
      await page.setViewport(vp[0], vp[1], false);
      const rec = new Rec(page, { width: m.width ?? 960, fps: m.fps ?? 22, crop: m.crop ?? null });
      await rec.install();
      const ctx = {
        page, base, rec, outDir, posterDir,
        async openApp() { await page.goto(base); await rec.waitFor(`!!document.querySelector('button[aria-label="Library"]')`, 'the app to render'); await sleep(800); },
        async openSample(slug) {
          await page.eval(`document.querySelector('button[aria-label="Library"]').click()`);
          await rec.waitFor(`document.querySelectorAll('.dlg-item').length > 0`, 'the library');
          await sleep(800);
          const ok = await page.eval(`(() => { const b = [...document.querySelectorAll('.dlg-item')].find((e) => e.querySelector('img')?.src.endsWith('/${slug}.webp')); if (!b) return false; b.click(); return true; })()`);
          if (!ok) throw new Error('sample not listed: ' + slug);
          await rec.waitFor(`(() => { const s = document.querySelector('.status'); return !!s && /ready/i.test(s.textContent || '') && document.querySelectorAll('canvas').length > 0; })()`, 'the part to load');
          await sleep(1500);
        },
      };
      const report = await m.run(rec, ctx);
      console.log(JSON.stringify(report ?? await rec.finish(m.id, outDir, posterDir)));
    } catch (e) { failed++; console.error(`${m.id}: ${e.message}`); }
    finally { page.close(); }
  }
} finally { chrome.close(); server.close(); }
process.exit(failed ? 1 : 0);
