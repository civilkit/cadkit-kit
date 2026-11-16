// The iPad-style layout, second round (0.7.4): fold the left panel with the handle on its edge and unfold it, then an edit and the undo / redo card beside the tool column.
// (Based on the clip of 0.7.2: the app in an iPad-style layout in portrait (820 x 1180 css px, touch emulation) with the mounting-plate sample open and the tree docked (the canvas has about two
// thirds of the width, the panel tabs are icons). Tap Sketch and a plane; the ribbon is one row: a real touch swipe scrolls it to Dimension and the constraints (the chevron and the fade at the
// edge show there is more), a swipe brings it back; the circle tool, a touch drag and a lift: the radius field has the focus with the sign key beside it, 12 is typed and Enter pressed; finish.
// Recorded as a touch device (device: 'tablet'), the yellow dot is the finger. Load-tolerant (see clipkit.mjs): each touch step is made off the clock, then held for a fixed time.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kit } from './clipkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = JSON.parse(readFileSync(resolve(here, '../../apps/cad/public/samples/mounting-plate.ckpart'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: 'tablet-layout-2',
  device: 'tablet',
  viewport: [820, 1180],
  width: 1640,
  async run(rec, ctx) {
    const { page, base } = ctx;
    // the sample as the restored last session, light theme, the layout the app chooses for a tablet; off camera
    const items = { 'cad.theme': '"light"', 'cad.autosave.v1': JSON.stringify({ name: SAMPLE.name, doc: SAMPLE, savedAt: Date.now() }) };
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); const it = ${JSON.stringify(items)}; for (const k in it) localStorage.setItem(k, it[k]); } catch {}` });
    await page.goto(base);
    await rec.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Restore')`, 'the restore box');
    await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Restore').click()`);
    await rec.waitFor(`document.querySelectorAll('.tree .row[data-id]').length > 1 && /ready/i.test(document.querySelector('.status')?.textContent || '')`, 'the part to load', 120000);
    await rec.waitFor(`!document.querySelector('.toast')`, 'the restore notice to go', 20000).catch(() => {});
    await sleep(1500);
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    k.log('loaded');

    const touch = (type, pts) => page.touch(type, pts);
    const rectOf = (expr) => k.rect(expr);
    /** a tap: finger down and up in one step, the dot shown, then a hold */
    const tap = async (x, y, hold = 500) => { await k.step(async () => { await touch('touchStart', [{ x, y }]); await sleep(80); await touch('touchEnd'); await sleep(250); }, hold); };
    const tapEl = async (expr, hold = 500) => { const r = await rectOf(expr); await tap(r.x, r.y, hold); };
    /** a drag in n steps, each step off the clock and held a moment so the motion is seen */
    const drag = async (x0, y0, x1, y1, n = 8, hold = 90) => {
      await k.step(() => touch('touchStart', [{ x: x0, y: y0 }]), 200, false);
      for (let i = 1; i <= n; i++) await k.step(() => touch('touchMove', [{ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }]), hold);
      await k.step(() => touch('touchEnd'), 300);
    };
    const SLOT = (s) => `document.querySelector('.slot[data-slot="${s}"] .slot-btn')`;
    const RIBBON = `document.querySelector('.ribbon-wrap .rb-groups')`;

    const HANDLE = `document.querySelector('[data-testid="nav-handle"]')`;
    await rec.begin();
    await rec.wait(2600);                        // the layout: the tree docked, the tool column, the undo and redo card
    await k.snap('30a-open');
    // ---- fold the left panel with the handle on its edge: the canvas gets the width back, the tool column stays
    await tapEl(HANDLE, 900);
    await k.settle();
    await rec.wait(2400);
    await k.snap('30b-folded');
    // ---- unfold it again
    await tapEl(HANDLE, 900);
    await k.settle();
    await rec.wait(1600);
    // ---- an edit, then the undo and redo card: suppress the Hole (the holes in the plate go), undo brings them back, redo takes them away again
    await tapEl(`[...document.querySelectorAll('.tree .row[data-id="F4"] button')].find((b) => /suppress/i.test(b.getAttribute('aria-label') || b.title))`, 700);
    await k.settle();
    await rec.wait(1800);
    await k.snap('30c-edited');
    rec.mark('poster');
    await tapEl(`document.querySelector('.undo-card [data-act="undo"]')`, 700);
    await k.settle();
    await rec.wait(1500);
    await k.snap('30d-undone');
    await tapEl(`document.querySelector('.undo-card [data-act="redo"]')`, 700);
    await k.settle();
    await rec.wait(2000);
    await k.snap('30e-redone');
    if (process.env.CLIP_DRY) return { id: 'tablet-layout-2', dry: true };
    return rec.finish('tablet-layout-2', ctx.outDir, ctx.posterDir);
  },
};
