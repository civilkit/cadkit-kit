// A fillet on a twisted extrude: a 40 mm square extruded 40 mm with a 30 degree twist; pick one top edge, Select loop takes the ring of four,
// Fillet with the default 2 mm radius rounds it. Load-tolerant (see clipkit.mjs). Public sample: a plain square made from numbers.
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const twisted = () => newDoc('Twisted square', [rectSketch('F1', 'Square', 'front', 40, 40, { cx: -20, cy: -20 }), { type: 'extrude', id: 'F2', name: 'Twisted extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 40, twist: 30 }]);

export default {
  id: 'twisted-fillet',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, twisted(), { workspace: {} });
    const k = kit(rec, ctx);
    const command = async (name) => {
      await k.key('f');
      await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
      await k.step(() => page.send('Input.insertText', { text: name }), 900);
      await k.step(() => page.key('Enter'), 300);
      await k.settle();
    };
    await page.key('7'); await k.sleep(800);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.begin();
    rec.x = 760; rec.y = 620;
    await rec.wait(1400);                                  // the twisted square
    const [cx, cy] = await rec.rect(`document.querySelector('#vp canvas')`);
    // ---- one top edge, then its loop
    await k.key('e');                                       // edge mode
    await k.glide(716, 285, 5);
    await k.click(716, 285, 'left', 500);                   // a top edge (the iso view of the fitted part, 1280 x 720)
    await command('Loop');
    await rec.wait(1200);
    // ---- the fillet
    await command('Fillet');
    await k.waitUi(`!!document.querySelector('.tree-wrap label[data-path="radius"] input')`, 'the Fillet editor');
    await rec.wait(2400);
    rec.mark('poster');
    k.log('filleted');
    if (process.env.CLIP_DRY) return { id: 'twisted-fillet', dry: true };
    return rec.finish('twisted-fillet', ctx.outDir, ctx.posterDir);
  },
};
