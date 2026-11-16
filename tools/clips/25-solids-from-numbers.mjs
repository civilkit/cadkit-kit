// Torus, Coil and Bounding solid: each is made from numbers, with no sketch. A ring, a spring inside it, then the box round both. The sizes
// are typed into the Editor. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FIELD = (path) => `document.querySelector('.tree-wrap label[data-path="${path}"] input')`;

export default {
  id: 'solids-from-numbers',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Solids', []), { workspace: {} });
    const k = kit(rec, ctx);
    const setField = async (path, text, hold = 700) => {
      const f = await k.rect(FIELD(path));
      await k.click(f.x, f.y, 'left', 200);
      await k.step(() => page.eval(`(() => { const i = ${FIELD(path)}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text }), 400);   // in one go: typing '2' then '5' would pass through a ring smaller than the tube
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
      await rec.wait(hold);
    };
    const command = async (name) => {
      await k.key('f');
      await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
      await k.step(() => page.send('Input.insertText', { text: name }), 900);
      await k.step(() => page.key('Enter'), 300);
      await k.settle();
    };
    await page.key('7'); await k.sleep(600);
    await rec.begin();
    rec.x = 760; rec.y = 620;
    await rec.wait(900);
    // ---- a torus: ring radius 25, tube 5
    await command('Torus');
    await k.waitUi(`!!${FIELD('majorRadius')}`, 'the Torus editor');
    await rec.wait(1200);
    await setField('majorRadius', '25');
    await setField('minorRadius', '5');
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.wait(1000);
    // ---- a coil inside the ring
    await command('Coil');
    await k.waitUi(`!!${FIELD('wireRadius')}`, 'the Coil editor');
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.wait(1600);
    rec.mark('poster');
    k.log('coil');
    // ---- the box round both
    await command('Bounding solid');
    await k.settle();
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.wait(2000);
    k.log('bounding');
    if (process.env.CLIP_DRY) return { id: 'solids-from-numbers', dry: true };
    return rec.finish('solids-from-numbers', ctx.outDir, ctx.posterDir);
  },
};
