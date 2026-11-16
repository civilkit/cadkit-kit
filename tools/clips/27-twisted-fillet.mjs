// A fillet on a twisted extrude: a 40 mm square extruded 40 mm with a 30 degree twist; the corner that faces the camera (the two near top edges and
// the near twisted edge) is picked and Fillet with a 5 mm radius rounds it. Load-tolerant (see clipkit.mjs). Public sample: a plain square made from numbers.
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
    await k.snap('a-view');
    await rec.begin();
    rec.x = 760; rec.y = 620;
    await rec.wait(1400);                                  // the twisted square
    const [cx, cy] = await rec.rect(`document.querySelector('#vp canvas')`);
    // ---- looking down on the top face every edge of its ring faces the camera: pick one, Select loop takes the ring of four, Fillet rounds all four
    const nav = async (x, y) => { await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await k.sleep(900); };
    await nav(1192, 311);                                   // the view cube's down arrow: tilt onto the top face (off camera)
    await k.settle();
    await k.key('e');                                       // edge mode
    await k.glide(723, 320, 5);
    await k.click(723, 320, 'left', 500);                   // an edge of the top face (positions follow the fitted part, 1280 x 720)
    await command('Loop');
    await rec.wait(1200);
    await command('Fillet');
    await k.waitUi(`!!document.querySelector('.tree-wrap label[data-path="radius"] input')`, 'the Fillet editor');
    await k.settle();
    // the radius, typed: 5 mm reads as a wide rounded band round the whole ring (the default 2 mm is hard to see at this size)
    const rf = await k.rect(`document.querySelector('.tree-wrap label[data-path="radius"] input')`);
    await k.click(rf.x, rf.y, 'left', 300);
    await k.step(() => page.eval(`(() => { const i = document.querySelector('.tree-wrap label[data-path="radius"] input'); i.focus(); i.select(); })()`), 250);
    await k.step(() => page.send('Input.insertText', { text: '5' }), 400);
    await k.step(() => page.key('Tab'), 250);
    await k.settle();
    await k.glide(1000, 640, 4);                            // the pointer off the part
    await rec.wait(1800);
    rec.mark('poster');                                     // the poster: all four rounded edges in view
    await rec.wait(2400);                                   // hold on the rounded ring
    k.log('filleted');
    if (process.env.CLIP_DRY) return { id: 'twisted-fillet', dry: true };
    return rec.finish('twisted-fillet', ctx.outDir, ctx.posterDir);
  },
};
