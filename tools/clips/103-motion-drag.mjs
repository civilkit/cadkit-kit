// Drag a part to move the mechanism (0.8.18): on the Motion tab the hinge-door sample is opened, New study is pressed, and the door is dragged: the hinge follows the cursor and Auto key
// records the move on the timeline. Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { openDoc, kit } from './clipkit.mjs';

const sample = () => JSON.parse(readFileSync(new URL('../../apps/cad/public/samples/assembly-hinge-door.ckpart', import.meta.url), 'utf8'));
const BTN = (t) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${t}' && b.getBoundingClientRect().width > 0)`;

export default {
  id: 'motion-drag',
  viewport: [1600, 1000],
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    const doc = sample();
    await openDoc(ctx, doc, { workspace: null, name: doc.name ?? 'Hinge door' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 250) await rec.wait(250); };
    await k.settle();
    await k.snap('103a-open');
    await rec.begin();
    rec.x = 1300; rec.y = 800;
    await k.caption('A hinged door on its pin', 1);
    await hold(1800);
    await k.caption('Motion tab, New study', 2);
    await k.clickEl(`[...document.querySelectorAll('[role=tab], .ribbon-tab, button')].find((b) => b.textContent.trim() === 'Motion' && b.getBoundingClientRect().width > 0)`, 'left', 600);
    await k.clickEl(BTN('New study'), 'left', 700);
    await k.settle();
    await k.snap('103b-study');
    await hold(1500);
    await k.caption('Grab the door and drag: the hinge follows', 3);
    await k.drag(1080, 632, 1176, 470, 14);
    await k.settle();
    await k.snap('103c-dragged');
    await hold(2500);
    if (process.env.CLIP_DRY) return { id: 'motion-drag', dry: true };
    return rec.finish('motion-drag', ctx.outDir, ctx.posterDir);
  },
};
