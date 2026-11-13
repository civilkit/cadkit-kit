// Helpers shared by the load-tolerant clips (17 and up): open a part from a document object, and step / hop / glide / click / key actions
// that run inside rec.skip, so the time a busy machine spends on a redraw is cut out of the clip and the pace is a fixed, readable hold.
// record.mjs only loads NN-name.mjs files, so this module is not a clip.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The first-visit layout has the ribbon carry the tools; this one has the tool rail and a docked, full-height left panel. */
export const PRESET = { ribbon: 'off', leftPanel: 'docked', leftTabs: true, leftCollapsed: false, rightPanel: 'off', toolRail: true, sketchPalette: false, toolLabels: 'icons-and-text', selectionBar: true, commandBar: true, drawerOpen: false, handles: true, opacity: 0.62, blur: 14, lineWidth: 3 };

/** Open a part (a ck-part document object) as the restored last session, with a layout, and wait until it has built. Off camera. */
export async function openDoc(ctx, doc, { workspace = PRESET, name = doc.name } = {}) {
  const { page, base, rec } = ctx;
  const items = { 'cad.autosave.v1': JSON.stringify({ name, doc, savedAt: Date.now() }), 'cad.workspace': JSON.stringify(workspace) };
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); const it = ${JSON.stringify(items)}; for (const k in it) localStorage.setItem(k, it[k]); } catch {}` });
  await page.goto(base);
  const restore = doc.features.length > 0;   // an empty part has nothing to restore: the app opens on a new part
  if (restore) {
    await rec.waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Restore')`, 'the restore box');
    await page.eval(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Restore').click()`);
    await rec.waitFor(`document.querySelectorAll('.tree .row[data-id]').length > 1 && /ready/i.test(document.querySelector('.status')?.textContent || '')`, 'the part to load', 120000);
  } else {
    await rec.waitFor(`/ready/i.test(document.querySelector('.status')?.textContent || '') && document.querySelectorAll('canvas').length > 0`, 'the app to load', 120000);
  }
  await rec.waitFor(`!document.querySelector('.toast')`, 'the restore notice to go', 20000).catch(() => {});
  await sleep(1200);
}

/** The step helpers of one clip (see 12-sketch-guides.mjs): every action is made inside rec.skip, then held for a fixed time. */
export function kit(rec, ctx) {
  const { page } = ctx;
  const T0 = Date.now();
  const k = {
    page, rec, sleep,
    log: (n) => { if (process.env.CLIP_TIME) console.error(((Date.now() - T0) / 1000).toFixed(1), n); },
    async snap(name) { const d = process.env.CLIP_SNAPS; if (!d) return; mkdirSync(d, { recursive: true }); writeFileSync(join(d, name + '.png'), Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); },
    /** one step made off the clock, then a short hold on the result */
    async step(fn, hold = 130, still = true) { await rec.skip(async () => { await fn(); if (still) await rec.paint(); await sleep(150); }); if (still) await rec.paint(); await sleep(hold); },
    hop: (x, y) => k.step(async () => { await page.mouse('mouseMoved', x, y); rec.x = x; rec.y = y; }, 70, false),
    /** the pointer moves in n eased hops */
    async glide(x, y, n = 4) { const x0 = rec.x, y0 = rec.y; for (let i = 1; i <= n; i++) { const t = i / n, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await k.hop(x0 + (x - x0) * e, y0 + (y - y0) * e); } },
    async click(x, y, btn = 'left', hold = 220) { await k.glide(x, y, 2); await k.step(async () => { await page.mouse('mousePressed', x, y, btn); await page.mouse('mouseReleased', x, y, btn); await sleep(200); }, hold); },
    /** a drag with the left button, in n hops */
    async drag(x0, y0, x1, y1, n = 6) {
      await k.glide(x0, y0, 3);
      await k.step(() => page.mouse('mousePressed', x0, y0), 60, false);
      for (let i = 1; i <= n; i++) { const t = i / n; await k.step(async () => { await page.mouse('mouseMoved', x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); rec.x = x0 + (x1 - x0) * t; rec.y = y0 + (y1 - y0) * t; }, 90); }
      await k.step(() => page.mouse('mouseReleased', x1, y1), 200);
    },
    key: (key, opt) => k.step(async () => { await page.eval(`document.activeElement?.blur?.(); 0`); await page.key(key, opt); }, 120),
    /** type into the focused box, one character at a time */
    async typeOut(text, hold = 150) { for (const ch of text) await k.step(() => page.send('Input.insertText', { text: ch }), hold); },
    waitUi: (expr, what, ms = 90000) => rec.skip(() => rec.waitFor(expr, what, ms)),
    /** the centre of an element, scrolled into view */
    rect: (expr) => rec.skip(async () => { for (let i = 0; ; i++) { try { const [x, y, w, h] = await rec.rect(expr); return { x, y, w, h }; } catch (e) { if (i > 8 || !/timed out/.test(e.message)) throw e; await sleep(1000); } } }),
    /** wait (off the clock) until the page is idle: the status bar says Ready and a few quiet seconds have passed */
    settle: (ms = 1500) => rec.skip(async () => { await sleep(ms); await rec.waitFor(`/ready/i.test(document.querySelector('.status')?.textContent || '')`, 'the page to be ready', 180000); await sleep(ms); }),
    /** click an element by an expression, the pointer gliding to it first */
    async clickEl(expr, btn = 'left', hold = 220, dx = 0) { const r = await k.rect(expr); await k.click(r.x + dx, r.y, btn, hold); },
    /** choose an option (by its text) of a native <select>, as a click on the box followed by the choice */
    async choose(selectExpr, optionRe, hold = 900) {
      const r = await k.rect(selectExpr);
      await k.glide(r.x, r.y, 3);
      await k.step(async () => { await page.eval(`(() => { const s = (${selectExpr}); const o = [...s.options].find((x) => ${optionRe}.test(x.textContent)); if (!o) throw new Error('no option ${optionRe}'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, o.value); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`); }, 100);
      await k.settle(); await rec.wait(hold);
    },
    /** right-click a point, wait for the context menu */
    async rightClick(x, y, hold = 1100) { await k.glide(x, y, 3); await rec.wait(150); await k.step(async () => { await page.mouse('mousePressed', x, y, 'right'); await page.mouse('mouseReleased', x, y, 'right'); await rec.waitFor(`!!document.querySelector('.ctx-menu')`, 'the context menu'); }, hold); },
    /** the leaf element of the open context menu whose text matches */
    menuItem: (re) => `[...document.querySelectorAll('.ctx-menu *')].find((e) => e.children.length === 0 && ${re}.test(e.textContent.trim()))`,
    row: (re) => `[...document.querySelectorAll('.tree .row')].find((e) => ${re}.test(e.querySelector('.row-name')?.textContent.trim() ?? ''))`,
  };
  return k;
}
