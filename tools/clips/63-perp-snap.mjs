// Perpendicular and extension snap (0.8.8): in a new sketch on the Top plane a circle and a loose line are drawn; Perpendicular takes the line and the circle and
// turns the line so it runs through the centre. Then a second line is drawn, and a third is started and pulled along the straight-on continuation of the second:
// it snaps to it with a dashed guide and the word extension. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export default {
  id: 'perp-snap',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Circle and line', []));
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const cap = async (text, n) => { await k.caption(text, n); await rec.skip(() => page.eval(`(() => { const e = document.getElementById('__cap'); e.style.left = '730px'; e.style.bottom = 'auto'; e.style.top = '100px'; e.style.maxWidth = '640px'; })()`)); await rec.paint(); };
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    await k.settle();
    await rec.begin();
    rec.x = 700; rec.y = 560;
    await cap('A sketch on the Top plane', 1);
    await hold(1200);
    await k.clickEl(`document.querySelector('.slot[data-slot="new-sketch"] .slot-more') || document.querySelector('.slot[data-slot="new-sketch"] .slot-btn')`, 'left', 900);
    await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'the plane list');
    await k.clickEl(`document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'left', 300);
    await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
    await k.settle();
    const [cx, cy] = await rec.rect(`document.querySelector('#vp canvas')`);
    const at = (dx, dy) => [cx + dx, cy + dy];
    await k.snap('63a-sketch');
    await cap('Draw a circle and a loose line', 2);
    await k.clickEl(`document.querySelector('[data-slot="circle"] .slot-btn, [data-slot="circle"]')`, 'left', 500);
    const C = at(-150, 20), R = at(-70, 20);
    await k.click(C[0], C[1], 'left', 300); await k.glide(R[0], R[1], 3); await k.click(R[0], R[1], 'left', 400);
    await k.key('Escape'); await k.key('l');
    const A = at(40, -120), B = at(230, -50);
    await k.click(A[0], A[1], 'left', 300); await k.glide(B[0], B[1], 4); await k.click(B[0], B[1], 'left', 400);
    await k.key('Escape');
    await k.snap('63b-drawn');
    await hold(1500);
    await cap('Perpendicular, then the line, then the circle', 3);
    await k.clickEl(`document.querySelector('[data-slot="equal"] .slot-more')`, 'left', 700);
    await k.waitUi(`!!document.querySelector('[data-testid="cmd-perpendicular"]')`, 'the constraint list');
    await k.clickEl(`document.querySelector('[data-testid="cmd-perpendicular"]')`, 'left', 600);
    const M = at(135, -85), E = at(-150 - 57, 20 - 57);
    await k.click(M[0], M[1], 'left', 700);
    await k.snap('63c-line');
    await k.click(E[0], E[1], 'left', 700);
    await k.settle();
    await k.key('Escape');
    await k.step(() => page.mouse('mouseMoved', 760, 640), 100, false);
    await k.snap('63d-perp');
    rec.mark('poster');
    await cap('The line now runs through the centre of the circle', 4);
    await hold(4500);
    await cap('Draw a line, then start another beyond its end', 5);
    await k.key('l');
    const P = at(60, 150), Q = at(180, 100);
    await k.click(P[0], P[1], 'left', 300); await k.glide(Q[0], Q[1], 4); await k.click(Q[0], Q[1], 'left', 400);
    await k.key('Escape'); await k.key('l');
    const S = at(230, 175), X = at(355, 27);
    await k.click(S[0], S[1], 'left', 300);
    await k.glide(X[0] - 50, X[1] + 60, 3);
    await cap('The pointer snaps to the extension of the line, with a dashed guide', 6);
    await k.glide(X[0], X[1], 4);
    await k.snap('63e-ext');
    await hold(5500);
    await k.click(X[0], X[1], 'left', 500);
    await k.key('Escape');
    await k.snap('63f-done');
    await hold(2500);
    if (process.env.CLIP_DRY) return { id: 'perp-snap', dry: true };
    return rec.finish('perp-snap', ctx.outDir, ctx.posterDir);
  },
};
