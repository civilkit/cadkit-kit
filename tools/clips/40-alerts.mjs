// Alerts (Unreleased): messages stack at the bottom right. Box select (X) gives an info message; importing a damaged STEP file gives an error that wraps its long text (Show more, Copy);
// the pointer over a message holds its timer; then the status bar Alerts count opens the list of recent messages. The part and the damaged file are made in this script. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const plateDoc = () => {
  const plate = rectSketch('F1', 'Plate outline', 'front', 70, 44, { cx: -35, cy: -22 });
  return newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 12 }]);
};
// a STEP file with a broken data section
const BAD_STEP = 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'bracket\'),\'2;1\');\nENDSEC;\nDATA;\n#1=CARTESIAN_POINT(\'\',(0.,0.,\nENDSEC;\nEND-ISO-10303-21;\n';
const MENU = (re) => `[...document.querySelectorAll('[role=menuitem]')].find((e) => ${re}.test(e.innerText.trim()))`;
const TOAST = (lvl) => `document.querySelector('.toast.${lvl}')`;

export default {
  id: 'alerts',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, plateDoc());
    const k = kit(rec, ctx);
    await page.eval(`(() => { window.__file = new File([${JSON.stringify(BAD_STEP)}], 'bracket-v3-revision-C-final-for-the-machine-shop-with-all-the-fixes-from-the-last-review-applied-2026-11-16-FINAL-v2.step');
      const orig = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type !== 'file') return orig.call(this); const dt = new DataTransfer(); dt.items.add(window.__file); Object.defineProperty(this, 'files', { value: dt.files }); setTimeout(() => this.onchange && this.onchange(), 400); }; return 0; })()`);
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const wait0 = rec.wait.bind(rec);
    rec.wait = async (ms) => { for (let t = 0; t < ms; t += 700) await wait0(Math.min(700, ms - t)); };
    await rec.begin();
    rec.x = 900; rec.y = 520;
    await rec.wait(1200);
    // ---- an info message: box select on
    await k.key('x');
    await k.waitUi(`!!(${TOAST('info')})`, 'the info message');
    await k.snap('40a-info');
    await rec.wait(2200);
    // ---- an error: import a damaged STEP file
    await k.clickEl(`document.querySelector('button[aria-label="More file actions"]')`, 'left', 700);
    await k.waitUi(`!!(${MENU('/Import STEP/')})`, 'the file menu');
    await k.clickEl(MENU('/Import STEP/'), 'left', 300);
    const IMPORT_BTN = `[...document.querySelectorAll('[role=dialog] button')].find((e) => e.textContent.trim() === 'Import')`;
    await k.waitUi(`!!(${IMPORT_BTN})`, 'the import box');
    await rec.wait(1000);
    await k.clickEl(IMPORT_BTN, 'left', 300);
    try { await k.waitUi(`!!(${TOAST('error')})`, 'the error message', 120000); }
    catch (e) { await k.snap('40x-fail'); console.error(await page.eval(`document.body.innerText.slice(0, 500)`)); throw e; }
    await k.settle(600);
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    await k.clickEl(`[...document.querySelectorAll('[role=tab], .tab, .doc-tab')].find((e) => /^Plate/.test(e.textContent.trim()))`, 'left', 600);   // back to the plate; the messages stay
    await k.settle(600);
    await k.snap('40b-error');
    // ---- hover the stack: the timer holds; open the long text, then Copy
    const stack = await k.rect(`document.querySelector('.toast.error')`);
    await k.glide(stack.x, stack.y, 4);
    await rec.wait(1800);
    await k.snap('40c-hover');
    const more = `document.querySelector('.toast.error .toast-more')`;
    if (await page.eval(`!!(${more})`)) { await k.clickEl(more, 'left', 1800); await k.snap('40d-more'); }
    await k.clickEl(`document.querySelector('.toast.error .toast-copy')`, 'left', 1500);
    await k.snap('40e-copied');
    // ---- the status bar: Alerts count, then the list
    await k.clickEl(`document.querySelector('[data-testid="alerts-chip"]')`, 'left', 300);
    await k.waitUi(`!!document.querySelector('.alert-history')`, 'the list');
    await k.settle(600);
    await k.glide(1000, 300, 3);
    await k.snap('40f-list');
    await rec.wait(1200);
    rec.mark('poster');
    await rec.wait(4200);
    if (process.env.CLIP_DRY) return { id: 'alerts', dry: true };
    return rec.finish('alerts', ctx.outDir, ctx.posterDir);
  },
};
