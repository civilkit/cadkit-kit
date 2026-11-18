// Tangent chain picks a whole run (0.8.3): a 60 x 40 x 20 block with rounded corners (r 10), the Fillet editor open with Tangent chain on; one edge of the top outline
// is picked and the whole run of eight edges lights as one item with its edge count; the item's x removes the run. The part is made from numbers in this file.
// Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const part = () => newDoc('Rounded block', [
  { type: 'sketch', id: 'F1', name: 'Outline', plane: { kind: 'std', id: 'top' },
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: -20, y: -20 }, { id: 'b', x: 20, y: -20 }, { id: 'cb', x: 20, y: -10 }, { id: 'c', x: 30, y: -10 }, { id: 'd', x: 30, y: 10 }, { id: 'cc', x: 20, y: 10 }, { id: 'e', x: 20, y: 20 }, { id: 'f', x: -20, y: 20 }, { id: 'cd', x: -20, y: 10 }, { id: 'g', x: -30, y: 10 }, { id: 'h', x: -30, y: -10 }, { id: 'ce', x: -20, y: -10 }, { id: 'ha', x: -20, y: -20 }],
    entities: [
      { id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'arc', c: 'cb', p1: 'b', p2: 'c' }, { id: 'e3', type: 'line', p1: 'c', p2: 'd' }, { id: 'e4', type: 'arc', c: 'cc', p1: 'd', p2: 'e' },
      { id: 'e5', type: 'line', p1: 'e', p2: 'f' }, { id: 'e6', type: 'arc', c: 'cd', p1: 'f', p2: 'g' }, { id: 'e7', type: 'line', p1: 'g', p2: 'h' }, { id: 'e8', type: 'arc', c: 'ce', p1: 'h', p2: 'a' },
    ],
    constraints: [] },
  { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
]);

export default {
  id: 'chain-run',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, part());
    const k = kit(rec, ctx);
    const command = async (name) => {
      await k.key('f');
      await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
      await k.step(() => page.send('Input.insertText', { text: name }), 900);
      await k.step(() => page.key('Enter'), 300);
      await k.settle();
    };
    await page.key('7'); await k.sleep(600);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await k.snap('42a-view');
    await rec.begin();
    rec.x = 900; rec.y = 640;
    await rec.wait(1400);
    // pick one edge of the top outline (edge mode), then open Fillet: with Tangent chain on the editor lists the whole run as one item
    await k.key('e');
    await k.glide(678, 356, 5);
    await k.click(678, 356, 'left', 900);
    await k.snap('42b-picked');
    await command('Fillet');
    await k.waitUi(`!!document.querySelector('[data-path="radius"] input')`, 'the Fillet editor', 30000);
    await k.settle();
    await k.snap('42c-editor');
    await k.glide(1000, 700, 4);
    await rec.wait(900);
    rec.mark('poster');
    await rec.wait(2600);                                   // one item, with its edge count; the whole outline is lit
    // a click on one edge of the bottom outline adds its whole run as a second item
    await k.glide(704, 490, 4);
    await k.click(704, 490, 'left', 300);
    await k.settle();
    await k.glide(1000, 760, 4);
    await k.snap('42d-two-runs');
    await rec.wait(3000);
    // the item's x takes the whole run out (a click on any of its edges in the view does the same)
    await k.clickEl(`document.querySelector('[data-path="edges"] .chip-x')`, 'left', 300);
    await k.settle();
    await k.glide(1000, 760, 3);
    await k.snap('42e-removed');
    await rec.wait(2800);
    if (process.env.CLIP_DRY) return { id: 'chain-run', dry: true };
    return rec.finish('chain-run', ctx.outDir, ctx.posterDir);
  },
};
