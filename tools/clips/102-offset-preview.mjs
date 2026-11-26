// Offset previews as you move (0.8.18): a rectangle is drawn; Offset is chosen and the rectangle's lines are picked; the hint says to press Enter, then move to a side, type a distance
// and click; the offset outline follows the pointer live; typing 5 and Enter makes it. Load-tolerant (see clipkit.mjs).
import { sketchTop, SLOT } from './sketchkit.mjs';

export default {
  id: 'offset-preview',
  viewport: [2200, 1100],
  dpr: 2,
  async run(rec, ctx) {
    const { k, P, clickMm, esc, page } = await sketchTop(rec, ctx, 'Offset');
    const hold = async (ms) => { for (let t = 0; t < ms; t += 250) await rec.wait(250); };
    await rec.begin();
    rec.x = 700; rec.y = 500;
    await rec.wait(1200);
    await k.caption('A circle of radius 12 mm', 1);
    await k.clickEl(SLOT('circle'), 'left', 500);
    await clickMm(0, 0); await clickMm(12, 0);
    await esc();
    await k.hop(130, 700);
    await k.snap('102a-rect');
    rec.mark('poster');
    await hold(1500);
    await k.caption('Offset: pick the circle, press Enter', 2);
    await k.clickEl(SLOT('sketch-select'), 'left', 400);
    await k.glide(700, 300, 3);
    await k.step(async () => { await page.mouse('mousePressed', 700, 300); await page.mouse('mouseReleased', 700, 300); await k.sleep(500); }, 200);   // empty canvas: nothing selected
    await k.clickEl(SLOT('offset'), 'left', 500);
    await clickMm(0, 12);
    await k.step(() => page.key('Enter'), 400);
    await k.snap('102b-picked');
    await hold(1500);
    await k.caption('Move out: the new outline follows the pointer', 3);
    const [x1, y1] = P(18, 0), [x2, y2] = P(24, 4);
    await k.glide(x1, y1, 4);
    await k.snap('102c-live-a');
    await hold(1500);
    await k.glide(x2, y2, 4);
    await k.snap('102d-live-b');
    await hold(1500);
    await k.caption('Type a distance, Enter: 5 mm', 4);
    await k.step(() => page.key('5'), 500);
    await k.snap('102e-typed');
    await hold(1500);
    await k.step(() => page.key('Enter'), 400);
    await k.settle();
    await k.hop(130, 700);
    await k.snap('102f-done');
    await hold(2000);
    if (process.env.CLIP_DRY) return { id: 'offset-preview', dry: true };
    return rec.finish('offset-preview', ctx.outDir, ctx.posterDir);
  },
};
