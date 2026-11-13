// The tablet layout (release 0.7.2): the app on an iPad in portrait (820 x 1180 css px, touch emulation) with the mounting-plate sample open and the tree docked (the canvas has about two
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
  id: 'tablet-layout',
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

    await rec.begin();
    await rec.wait(2600);                        // the layout: tree docked, icon tabs, the canvas two thirds
    k.log('layout');
    await k.snap('23a-open');

    // ---- Sketch, then a plane
    await tapEl(`document.querySelector('.slot[data-slot="new-sketch"] .slot-more') || ${SLOT('new-sketch')}`, 900);
    await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-front"]')`, 'the plane list');
    await k.snap('23b-planes');
    await rec.wait(700);
    await tapEl(`document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-front"]')`, 400);
    await k.waitUi(`!!document.querySelector('.ribbon-wrap .rb-groups') && !!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
    await k.settle();
    await rec.wait(1800);                       // the sketch is open; the ribbon is one row with an edge chevron
    await k.snap('23c-sketch');
    k.log('sketch');

    // ---- swipe the ribbon left to Dimension and the constraints, then back
    const rb = await rectOf(RIBBON);
    const rx = rb.x - rb.w / 2, ry = rb.y + rb.h / 2 - 8;   // a plain spot of the strip (the group titles), as the mobile check swipes
    await drag(rx + rb.w * 0.85, ry, rx + rb.w * 0.15, ry, 10, 70);
    await rec.wait(900);
    await k.snap('23d-ribbon-swiped');
    await drag(rx + rb.w * 0.85, ry, rx + rb.w * 0.15, ry, 10, 70);
    await rec.wait(1800);                       // Dimension and the constraints, the fade at the left edge
    await k.snap('23e-ribbon-end');
    k.log('ribbon');
    await drag(rx + rb.w * 0.15, ry, rx + rb.w * 0.9, ry, 10, 70);
    await drag(rx + rb.w * 0.15, ry, rx + rb.w * 0.9, ry, 10, 70);
    await k.step(() => page.eval(`${RIBBON}.scrollLeft = 0; 0`), 100);
    await rec.wait(1400);

    // ---- the circle tool, a touch drag, a lift
    await tapEl(SLOT('circle'), 600);
    const cv = await rectOf(`document.querySelector('#vp canvas')`);
    const cx = cv.x, cy = cv.y - cv.h * 0.1;
    await drag(cx, cy, cx + 90, cy, 8, 110);
    await k.waitUi(`!!document.querySelector('#vp .sketch-fields input') && !!document.querySelector('#vp .sketch-fields .expr-sign')`, 'the radius field');
    await k.settle(800);
    await rec.wait(2500);                       // the radius field with the sign key beside it
    rec.mark('poster');
    await k.snap('23f-radius-field');
    k.log('radius');
    await k.step(() => page.eval(`(() => { const i = document.querySelector('#vp .sketch-fields input'); i.focus(); i.select(); })()`), 300);
    await k.typeOut('12', 450);
    await rec.wait(900);
    await k.snap('23g-typed');
    await k.step(() => page.key('Enter'), 300);
    await k.settle();
    await rec.wait(1800);                       // the circle at radius 12
    await k.snap('23h-radius-set');
    k.log('radius set');

    // ---- finish the sketch
    await tapEl(`document.querySelector('[data-action="sketch-ok"]')`, 600);
    await k.waitUi(`!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch to close');
    await k.settle();
    await rec.wait(2200);
    await k.snap('23i-done');
    k.log('done');
    if (process.env.CLIP_DRY) return { id: 'tablet-layout', dry: true };
    return rec.finish('tablet-layout', ctx.outDir, ctx.posterDir);
  },
};
