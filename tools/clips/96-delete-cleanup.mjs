// Delete cleans up (0.8.17): a circle is made by typing its centre (30,20) and radius (9): the centre carries two position dimensions. Select is chosen, the circle outline is
// clicked and Delete pressed: the circle, its centre point and the dimensions on that point all go (before, the point and its labels stayed behind). Load-tolerant (see clipkit.mjs).
import { sketchTop, SLOT } from './sketchkit.mjs';

export default {
  id: 'delete-cleanup',
  viewport: [2200, 1100],
  dpr: 2,
  async run(rec, ctx) {
    const { k, P, clickMm, esc, page } = await sketchTop(rec, ctx, 'Delete');
    await rec.begin();
    rec.x = 700; rec.y = 500;
    await rec.wait(1200);
    await k.caption('A circle, centre typed as 30, 20', 1);
    await k.clickEl(SLOT('circle'), 'left', 600);
    await k.glide(760, 420, 3);
    await k.step(() => page.eval(`document.activeElement?.blur?.(); 0`), 200);
    for (const ch of '30,20') await k.step(() => page.key(ch), 450);
    await k.step(() => page.key('Enter'), 300);
    await k.settle(600);
    for (const ch of '9') await k.step(() => page.key(ch), 450);
    await k.step(() => page.key('Enter'), 300);
    await k.settle(600);
    await esc();
    await k.clickEl(`(document.querySelector('.slot[data-slot="sketch-select"] .slot-btn') || document.querySelector('[data-slot="sketch-select"]'))`, 'left', 500);
    await k.hop(130, 700);
    await k.snap('96a-before');
    rec.mark('poster');
    await rec.wait(3500);
    await k.caption('Click the circle, press Delete', 2);
    await clickMm(30 + 9, 20);
    await k.hop(130, 700);
    await k.snap('96b-picked');
    await rec.wait(1800);
    await k.key('Delete');
    await k.settle();
    await k.hop(130, 700);
    await k.snap('96c-after');
    await k.caption('The centre point and its dimensions go too', 3);
    await rec.wait(4500);
    if (process.env.CLIP_DRY) return { id: 'delete-cleanup', dry: true };
    return rec.finish('delete-cleanup', ctx.outDir, ctx.posterDir);
  },
};
