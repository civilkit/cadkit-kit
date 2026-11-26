// The problem flyout (0.8.19): on a 30 x 30 x 8 mm plate the Fillet editor is given a radius of 50 mm. The kernel refuses it; the alert icon beside the title appears and a click on it
// opens the flyout beside the panel with the cause and what to do (the button that uses the largest size that works). Load-tolerant (see clipkit.mjs).
import { openDoc, kit, PRESET } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const plate = rectSketch('F1', 'Plate outline', 'front', 30, 30, { cx: -15, cy: -15 });
export const doc = () => ({ ...newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 }]), upAxis: 'z' });
const CARD = `[data-testid=editor-card]`;

export default {
  id: 'problem-flyout',
  viewport: [1600, 1000],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: PRESET, name: 'Plate' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important}'; document.head.appendChild(st); return 1; })()`);
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    await k.settle();
    await rec.begin();
    rec.x = 1400; rec.y = 900;
    await k.caption('A plate 30 x 30 mm, 8 mm thick', 1);
    await hold(3000);
    await k.caption('Edge mode: pick a top edge, then open Fillet', 2);
    await k.key('e');
    await k.click(778, 598, 'left', 500);
    await k.hop(1400, 900);
    await hold(1500);
    await k.step(() => page.eval(`document.querySelector('button[aria-label="Fillet"]').click(); 0`), 400, false);
    await k.waitUi(`!!document.querySelector('${CARD}')`, 'the Fillet editor', 150000);
    await k.settle();
    await k.caption('A radius of 50 mm: far larger than the plate', 3);
    const F = `document.querySelector('${CARD} label[data-path="radius"] input')`;
    const r = await k.rect(F);
    await k.click(r.x, r.y, 'left', 300);
    await k.step(() => page.eval(`(() => { const i = ${F}; i.focus(); i.select(); })()`), 250);
    await k.step(() => page.send('Input.insertText', { text: '50' }), 400);
    await k.step(() => page.key('Tab'), 250);
    await k.settle(1500);
    await k.hop(1400, 900);
    await noTip();
    await k.snap('108a-refused');
    await k.waitUi(`!!document.querySelector('[data-testid=problem-badge]')`, 'the alert icon', 90000);
    await k.caption('The alert icon: click it', 4);
    await hold(1500);
    await k.clickEl(`document.querySelector('[data-testid=problem-badge]')`, 'left', 300);
    await k.waitUi(`!!document.querySelector('[data-testid=problem-popover]')`, 'the problem flyout', 30000);
    await k.settle(800);
    await k.hop(1400, 900);
    await k.caption('The flyout says what is wrong and what to do', 5);
    await k.snap('108b-flyout');
    rec.mark('poster');
    await hold(11000);
    if (process.env.CLIP_DRY) return { id: 'problem-flyout', dry: true };
    return rec.finish('problem-flyout', ctx.outDir, ctx.posterDir);
  },
};
