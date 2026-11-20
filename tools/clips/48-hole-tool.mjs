// The Hole tool without a selection (0.8.4): a 60 x 40 x 20 block; Hole is clicked with nothing selected and a bar asks for the flat face; the top face is clicked and a
// point sketch opens on it; a centre is placed, the sketch is confirmed and the Hole panel opens (Simple, M6, Through); OK, and the hole goes through the block.
// The block is made from numbers in this file. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc, rectSketch } from '../doc_shots_defs.mjs';

const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const part = () => newDoc('Block', [
  rectSketch('F1', 'Outline', 'top', 60, 40, { cx: -30, cy: -20 }),
  { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
]);

export default {
  id: 'hole-tool',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, part(), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('48a-block');
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await rec.wait(1600);
    await k.clickEl(`document.querySelector('.slot[data-slot="hole"] .slot-btn') || ${TID('slot-hole')}`, 'left', 600);
    await k.settle(600);
    await k.snap('48b-bar');
    rec.mark('poster');
    await rec.wait(2400);
    // ---- the top face: a point sketch opens on it
    await k.click(736, 442, 'left', 400);
    await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the point sketch');
    await k.settle();
    await k.snap('48c-sketch');
    await rec.wait(2600);
    // ---- a hole centre
    await k.glide(706, 380, 4);
    await rec.wait(500);
    await k.click(706, 380, 'left', 600);
    await k.snap('48d-centre');
    await rec.wait(1800);
    await k.clickEl(`document.querySelector('[data-action="sketch-ok"]')`, 'left', 600);
    await k.waitUi(`!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch to close');
    await k.settle();
    await k.snap('48e-panel');
    rec.mark('poster');
    await rec.wait(3200);
    // OK: the hole is made and shows through the body
    await k.clickEl(`document.elementFromPoint(564, 193).closest('button')`, 'left', 500);
    await k.waitUi(`!document.querySelector('[data-testid="editor-card"], .editor-card') || document.querySelectorAll('.tree .row[data-id]').length > 3`, 'the hole').catch(() => {});
    await k.settle();
    await k.snap('48f-done');
    await k.clickEl(`document.elementFromPoint(1132, 345).closest('button')`, 'left', 500);
    await k.settle();
    await k.click(960, 560, 'left', 400);
    await k.settle();
    await k.snap('48g-iso');
    await rec.wait(3600);
    if (process.env.CLIP_DRY) return { id: 'hole-tool', dry: true };
    return rec.finish('hole-tool', ctx.outDir, ctx.posterDir);
  },
};
