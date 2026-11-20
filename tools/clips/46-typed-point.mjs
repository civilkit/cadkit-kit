// Type a point instead of clicking it (0.8.4): in a new sketch on the Top plane, Circle is chosen and the first point is typed as -30,0 into the Position box that opens;
// Enter puts the centre there with a 30 mm dimension and a horizontal constraint; 9 and Enter make the radius; the badge says Fully defined.
// Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;

export default {
  id: 'typed-point',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Disc', []), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await rec.begin();
    rec.x = 700; rec.y = 420;
    await rec.wait(1200);
    // ---- a sketch on the Top plane
    await k.clickEl(`document.querySelector('.slot[data-slot="new-sketch"] .slot-more') || document.querySelector('.slot[data-slot="new-sketch"] .slot-btn')`, 'left', 900);
    await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'the plane list');
    await k.clickEl(`document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'left', 300);
    await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
    await k.settle();
    await k.snap('46a-sketch');
    await rec.wait(1200);
    await k.clickEl(`document.querySelector('[data-slot="circle"] .slot-btn, [data-slot="circle"]')`, 'left', 600);
    await k.glide(760, 420, 3);
    await k.step(() => page.eval(`document.activeElement?.blur?.(); 0`), 200);
    for (const ch of '-30,0') { await k.step(() => page.key(ch), 450); }
    await k.waitUi(`!!document.querySelector('.coord-box, [aria-label="Position"]')`, 'the Position box');
    await rec.wait(1500);
    await k.snap('46b-typed');
    rec.mark('poster');
    await rec.wait(900);
    await k.step(() => page.key('Enter'), 300);
    await k.settle(600);
    await k.snap('46c-centre');
    await rec.wait(1800);
    await k.step(() => page.key('9'), 500);
    await k.snap('46d-nine');
    await rec.wait(1200);
    await k.step(() => page.key('Enter'), 300);
    await k.settle(600);
    await k.snap('46e-circle');
    await rec.wait(2500);
    if (process.env.CLIP_DRY) return { id: 'typed-point', dry: true };
    return rec.finish('typed-point', ctx.outDir, ctx.posterDir);
  },
};
