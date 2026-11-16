// The Create menu: Home > Create > Primitives, a Cylinder armed and placed on the plate with one click, then Press Pull on the plate top.
// Load-tolerant (see clipkit.mjs). Public sample: a plain plate made from numbers.
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const plate = () => newDoc('Plate', [rectSketch('F1', 'Plate outline', 'front', 160, 100, { cx: -80, cy: -50 }), { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }]);
const FLYOUT = (name) => `document.querySelector('button[aria-label="More tools like ${name}"]')`;
const ROW = (re) => `[...document.querySelectorAll('button.slot-row')].find((e) => ${re}.test(e.textContent.trim()))`;

export default {
  id: 'create-menu',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, plate(), { workspace: {} });          // the first-visit layout: the ribbon carries the tools
    const k = kit(rec, ctx);
    await page.key('7'); await k.sleep(800);                 // the iso view, fitted
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.begin();
    rec.x = 760; rec.y = 620;
    await rec.wait(900);
    // ---- the Create menu: the primitives
    await k.clickEl(FLYOUT('Box'), 'left', 300);
    await rec.wait(1400);
    await k.clickEl(ROW(/^Cylinder/), 'left', 300);
    await rec.wait(700);
    // ---- click the plate top: the cylinder stands there
    const [cx, cy] = await rec.rect(`document.querySelector('#vp canvas')`);
    await k.glide(cx + 40, cy - 10, 5);
    await rec.wait(700);
    await k.click(cx + 40, cy - 10, 'left', 400);
    await k.settle();
    await rec.wait(1600);
    rec.mark('poster');
    k.log('placed');
    // ---- Press Pull on the plate top face
    await k.key('Escape');
    await k.glide(618, 413, 5);
    await k.click(618, 413, 'left', 400);                    // the cylinder's end face
    await k.key('f');
    await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
    await k.step(() => page.send('Input.insertText', { text: 'Press Pull' }), 900);
    await k.step(() => page.key('Enter'), 300);
    await rec.wait(600);
    await k.settle();
    await rec.wait(2200);
    k.log('pulled');
    if (process.env.CLIP_DRY) return { id: 'create-menu', dry: true };
    return rec.finish('create-menu', ctx.outDir, ctx.posterDir);
  },
};
