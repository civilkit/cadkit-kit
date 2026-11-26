// Cancelling a sketch warns first (0.8.18): a circle is drawn; the red X says "Cancelling throws away what was drawn since this sketch was opened, and Undo cannot bring it back";
// a second click within five seconds discards it. An empty sketch cancels at once. Load-tolerant (see clipkit.mjs).
import { sketchTop, SLOT } from './sketchkit.mjs';

export default {
  id: 'cancel-sketch',
  viewport: [2200, 1100],
  dpr: 2,
  async run(rec, ctx) {
    const { k, clickMm, esc, page } = await sketchTop(rec, ctx, 'Cancel');
    await rec.begin();
    rec.x = 700; rec.y = 500;
    await rec.wait(1200);
    await k.caption('A circle drawn in a sketch', 1);
    await k.clickEl(SLOT('circle'), 'left', 500);
    await clickMm(0, 0); await clickMm(14, 0);
    await esc();
    await k.hop(130, 700);
    await k.snap('101a-circle');
    rec.mark('poster');
    await rec.wait(2500);
    await k.caption('The red X warns before it throws the sketch away', 2);
    const X = await k.rect(`document.querySelector('[data-action="sketch-cancel"]')`);
    await k.click(X.x, X.y, 'left', 400);
    await k.snap('101b-warning');
    await rec.wait(1500);
    await k.caption('A second click cancels; Undo cannot bring it back', 3);
    await k.click(X.x, X.y, 'left', 400);
    await k.settle();
    await k.hop(130, 700);
    await k.snap('101c-cancelled');
    await rec.wait(3500);
    if (process.env.CLIP_DRY) return { id: 'cancel-sketch', dry: true };
    return rec.finish('cancel-sketch', ctx.outDir, ctx.posterDir);
  },
};
