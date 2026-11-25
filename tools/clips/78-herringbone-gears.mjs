// Herringbone gears (0.8.12): the Gear generator, Herringbone type, 48 teeth, 36 mm face (module 2, 30 deg helix) builds; the view is then lowered to the side so the V of the teeth shows. The wait for the build is cut out of the clip (a status bar
// "Ready" is waited for off camera), so the clip states no duration. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export const doc = () => ({ ...newDoc('Gear', []), upAxis: 'z' });   // Z up: without upAxis the document opens Y-up
const ED = `[data-testid=gear-editor]`;
const TYPE_BTN = (re) => `[...document.querySelectorAll('${ED} label[data-path="type"] button, ${ED} [data-path="type"] button')].find((b) => ${re}.test((b.textContent + ' ' + (b.title ?? '')).trim()))`;
const TEETH = `document.querySelector('${ED} [data-path="teeth"] input')`;
const FLD = (n) => `document.querySelector('${ED} [data-path="${n}"] input')`;
const setNum = (k, page, n, v) => k.step(() => page.eval(`(() => { const i = ${FLD(n)}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '${v}'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`), 300, false);
const TAB = (n) => `[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === '${n}')`;

export default {
  id: 'herringbone-gears',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: {}, name: 'Gear' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms * 0.6; t += 250) await rec.wait(250); };
    await k.settle();
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('Features > Gear opens the Gear editor', 1);
    await k.clickEl(TAB('Features'), 'left', 400);
    await k.clickEl(`document.querySelector('button[aria-label="Gear"]')`, 'left', 500);
    await k.glide(700, 520, 2);                                // off the ribbon, so no tooltip shows
    await k.waitUi(`!!${TEETH}`, 'the Gear editor', 60000);
    await k.settle();
    await k.snap('78a-editor');
    await hold(1200);
    await k.caption('Choose the Herringbone type', 2);
    await k.clickEl(TYPE_BTN(/Herringbone/), 'left', 600);
    await k.settle();
    await k.snap('78b-type');
    await hold(1800);
    await k.caption('A wide face (36 mm) so the V shows', 3);
    await k.clickEl(FLD('faceWidth'), 'left', 300);
    await setNum(k, page, 'faceWidth', 36);
    await k.settle();
    await hold(1500);
    await k.caption('Teeth: 48', 4);
    await k.clickEl(TEETH, 'left', 300);
    await setNum(k, page, 'teeth', 48);
    await k.settle();
    await k.snap('78c-teeth');
    await k.glide(1000, 620, 2);
    await hold(1500);
    await k.caption('Confirm to build the gear', 5);
    await hold(1800);
    await k.clickEl(`document.querySelector('${ED} .fedit-confirm')`, 'left', 600);
    // the build: waited for off camera
    await k.waitUi(`!document.querySelector('${ED}') && document.querySelectorAll('.tree .row[data-id]').length > 0 && /ready/i.test(document.querySelector('.status')?.textContent || '')`, 'the gear to build', 600000);
    await k.settle(3000);
    await rec.skip(async () => {                                // the view change to iso + Fit is made off the clock
      await page.eval(`document.activeElement?.blur?.(); 0`);
      await page.key('Escape'); await page.key('7');
      await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    });
    await k.settle();
    await k.snap('78d-iso');
    await k.caption('The two helical halves meet in a V', 6);
    await hold(1500);
    await k.drag(900, 640, 900, 585, 6);                       // lower the eye towards the side
    await k.zoom(608, 320, -18);
    await k.snap('78e-side');
    rec.mark('poster');
    await hold(2600);
    await k.drag(900, 640, 960, 640, 6);                       // turn the gear a little
    await k.snap('78f-turned');
    await hold(2600);
    if (process.env.CLIP_DRY) return { id: 'herringbone-gears', dry: true };
    return rec.finish('herringbone-gears', ctx.outDir, ctx.posterDir);
  },
};
