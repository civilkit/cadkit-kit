// Arc length dimension (0.8.17): a centre-point arc is drawn with free ends; the Dimension tool is clicked on it and L pressed, which switches the box from the radius to the arc
// length ('⌒' prefix); 25 and Enter re-solve the arc to 25 mm, the label '⌒25 mm' drawn across the chord. Load-tolerant (see clipkit.mjs).
import { sketchTop, SLOT } from './sketchkit.mjs';

export default {
  id: 'arc-length',
  viewport: [2200, 1100],
  dpr: 2,
  async run(rec, ctx) {
    const { k, P, clickMm, esc, type, page } = await sketchTop(rec, ctx, 'Arc');
    await rec.begin();
    rec.x = 700; rec.y = 500;
    await rec.wait(1200);
    await k.caption('An arc with free ends', 1);
    await k.clickEl(`document.querySelector('.slot[data-slot="arc-three-point"] .slot-more') || ${SLOT('arc-three-point')}`, 'left', 500);
    await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-arc-centre"]')`, 'the arc list');
    await k.clickEl(`document.querySelector('[data-testid="cmd-arc-centre"]')`, 'left', 400);
    await clickMm(0, 0); await clickMm(20, 0); await clickMm(0, 20);
    await esc();
    await k.snap('95a-arc');
    rec.mark('poster');
    await rec.wait(2000);
    await k.caption('Dimension tool: click the arc, press L', 2);
    await k.clickEl(SLOT('dimension'), 'left', 500);
    await clickMm(14.14, 14.14);
    await k.snap('95b-radius');
    await rec.wait(1500);
    await k.key('l');
    await k.snap('95c-length');
    await rec.wait(2000);
    await k.caption('Type 25 mm: the arc is that long', 3);
    for (const ch of '25') await k.step(() => page.key(ch), 450);
    await k.step(() => page.key('Enter'), 300);
    await k.settle();
    await k.hop(130, 700);
    await esc();
    await k.snap('95d-done');
    await rec.wait(3500);
    if (process.env.CLIP_DRY) return { id: 'arc-length', dry: true };
    return rec.finish('arc-length', ctx.outDir, ctx.posterDir);
  },
};
