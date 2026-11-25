// Case wizard names (0.8.15): the Case wizard is run twice; the second run finds Base and Lid taken and makes the bodies Base 2 and Lid 2. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export const emptyDoc = () => ({ ...newDoc('Case', []), upAxis: 'z' });
const BTN = (label) => `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === '${label}')`;
const FIELD = (path) => `document.querySelector('label[data-path="${path}"] input')`;

export default {
  id: 'case-names',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, emptyDoc());
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };   // one wait() is capped at 1.5 s in the encode, so long holds are made of short ones
    const cap = async (t, n) => { await k.caption(t, n); await rec.skip(() => page.eval(`(() => { const e = document.getElementById('__cap'); if (e) { e.style.left = '70%'; e.style.bottom = '24px'; e.style.maxWidth = '620px'; } })()`)); await rec.paint(); };
    // the Create slot of the Features tab (its button shows the last command used, so find it by the slot, not the label)
    const slot = await page.eval(`document.querySelector('.slot [aria-label="Gear"]')?.closest('.slot')?.getAttribute('data-slot') ?? ''`);
    if (!slot) throw new Error('no Create slot');
    const SLOTBTN = `(document.querySelector('.slot[data-slot="${slot}"] .slot-btn') || document.querySelector('.slot[data-slot="${slot}"]'))`;
    const openWizard = async () => {
      const g = await k.rect(SLOTBTN);
      await k.glide(g.x, g.y, 3);
      await k.step(async () => { await page.mouse('mousePressed', g.x, g.y, 'right'); await page.mouse('mouseReleased', g.x, g.y, 'right'); }, 600);
      await k.waitUi(`!!document.querySelector('[data-testid=cmd-add-case]')`, 'the Case command');
      await k.clickEl(`document.querySelector('[data-testid=cmd-add-case]')`, 'left', 400);
      await k.waitUi(`!!document.querySelector('[data-testid=case-wizard]') && !!document.querySelector('[data-testid=case-apply]')`, 'the Case wizard', 60000);
      await k.settle(1000);
      await rec.wait(1800);
    };
    const add = async () => {
      await k.waitUi(`!!document.querySelector('[data-testid=case-apply]') && !document.querySelector('[data-testid=case-apply]').disabled`, 'Add to enable', 120000);
      await k.settle(1500);
      await k.clickEl(`document.querySelector('[data-testid=case-apply]')`, 'left', 40);
      await k.hop(760, 560);
      await k.waitUi(`!document.querySelector('[data-testid=case-wizard]')`, 'the case to be added', 90000).catch(async (e) => { await k.snap('89-dbg-add'); console.error('HINT', await page.eval(`[...document.querySelectorAll('[role=alert],.toast,.fedit-hint')].map((x) => x.textContent).join(' | ')`)); throw e; });
      await k.settle();
      await k.step(() => page.mouse('mouseMoved', 760, 560), 100, false);
    };
    await rec.begin();
    rec.x = 760; rec.y = 560;
    await rec.wait(1000);
    await cap('The Case wizard makes Base and Lid', 1);
    await openWizard();
    await add();
    await rec.wait(1000);
    await k.clickEl(BTN('Bodies'), 'left', 300);
    await k.waitUi(`document.querySelectorAll('[aria-label^="Hide body"]').length >= 2`, 'the two bodies', 40000).catch(async (e) => { await k.snap('89-dbg-bodies'); throw e; });
    await k.settle(3000);
    console.error('BODIES', await page.eval(`[...document.querySelectorAll('[aria-label^="Hide body"],[aria-label^="Show body"]')].map((e) => e.parentElement?.textContent.trim().slice(0, 40)).join(' | ')`));
    await k.hop(760, 900);
    await k.snap('89a-first');
    await hold(2800);
    await cap('Run it again: the names Base and Lid are taken', 2);
    await k.clickEl(BTN('Features'), 'left', 400);
    await openWizard();
    await k.snap('89b-wizard2');
    await rec.wait(1500);
    await add();
    await k.clickEl(BTN('Bodies'), 'left', 300);
    await k.waitUi(`document.querySelectorAll('[aria-label^="Hide body"]').length >= 4`, 'four bodies', 40000).catch(async (e) => { await k.snap('89-dbg-four'); throw e; });
    await k.settle(3000);
    console.error('BODIES', await page.eval(`[...document.querySelectorAll('[aria-label^="Hide body"],[aria-label^="Show body"]')].map((e) => e.parentElement?.textContent.trim().slice(0, 40)).join(' | ')`));
    await k.hop(760, 900);
    await rec.wait(800);
    await cap('The new bodies are named Base 2 and Lid 2', 3);
    rec.mark('poster');
    await k.snap('89c-four');
    await hold(6000);
    if (process.env.CLIP_DRY) return { id: 'case-names', dry: true };
    return rec.finish('case-names', ctx.outDir, ctx.posterDir);
  },
};
