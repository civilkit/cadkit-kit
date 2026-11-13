// The fastener wizards one after another on the Catalog tab (Primitives): Nut, Standoff and Heat-set insert. Each shows its preview, is placed
// along X with its first face centre, and is added; the clip ends with all three in the view. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export const emptyDoc = () => newDoc('Fasteners', []);
const TAB = (name) => `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === '${name}' && b.closest('.tree-wrap, .ptabs'))`;
const WIZARD_BTN = (name) => `[...document.querySelectorAll('.tree-wrap button')].find((b) => b.textContent.trim() === '${name}')`;
const FIELD = (path) => `document.querySelector('.tree-wrap label[data-path="${path}"] input')`;
const APPLY = (name) => `[...document.querySelectorAll('.tree-wrap button')].find((b) => b.textContent.trim() === '${name}')`;

export default {
  id: 'fastener-wizards',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, emptyDoc());
    // off camera: the Catalog tab, Primitives
    await page.eval(`(${TAB('Catalog')}).click()`);
    await rec.waitFor(`[...document.querySelectorAll('[role=tab]')].some((e) => /Primitives/.test(e.textContent))`, 'the Primitives tab');
    await page.eval(`[...document.querySelectorAll('[role=tab]')].find((e) => /Primitives/.test(e.textContent)).click()`);
    await rec.waitFor(`!!(${WIZARD_BTN('Nut')})`, 'the Nut button');
    const k = kit(rec, ctx);
    k.log('loaded');
    await k.snap('20a-catalog');
    await rec.begin();
    rec.x = 700; rec.y = 600;
    await rec.wait(700);
    const wizard = async (name, applyText, x, n) => {
      if (n !== 'b') {   // after an Add the panel is back on the feature tree: open the Catalog again
        await k.clickEl(TAB('Catalog'), 'left', 250);
        await k.waitUi(`!!(${WIZARD_BTN(name)}) || [...document.querySelectorAll('[role=tab]')].some((e) => /Primitives/.test(e.textContent))`, 'the Catalog');
        await k.step(() => page.eval(`(() => { if (!(${WIZARD_BTN(name)})) [...document.querySelectorAll('[role=tab]')].find((e) => /Primitives/.test(e.textContent))?.click(); return 0; })()`), 300);
        await k.waitUi(`!!(${WIZARD_BTN(name)})`, `the ${name} button`);
      }
      await k.clickEl(WIZARD_BTN(name), 'left', 300);
      await k.waitUi(`!!${FIELD('x')} && !!document.querySelector('.tree-wrap [data-testid$="-unverified"]')`, `the ${name} wizard`);
      await k.settle();
      await rec.wait(1500);                                          // the preview, the size and the dimensions
      await k.snap(`20${n}-${name}`);
      // place it along X, so the three do not stand on each other
      const f = await k.rect(FIELD('x'));
      await k.click(f.x, f.y, 'left', 200);
      await k.step(() => page.eval(`(() => { const i = ${FIELD('x')}; i.focus(); i.select(); })()`), 250);
      await k.typeOut(String(x), 150);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
      await rec.wait(600);
      await k.clickEl(APPLY(applyText), 'left', 300);
      await k.waitUi(`!${FIELD('x')}`, `the ${name} to be added`);
      await k.settle();
      await rec.wait(400);
      k.log(name);
    };
    await wizard('Nut', 'Add nut', -22, 'b');
    await wizard('Standoff', 'Add standoff', 0, 'c');
    await wizard('Heat-set insert', 'Add insert', 22, 'd');
    // ---- fit the view on the three
    await k.clickEl(`document.querySelector('button[aria-label="Fit"]')`, 'left', 300);
    await k.settle();
    await rec.wait(1800);
    rec.mark('poster');
    await rec.wait(900);
    await k.snap('20e-end');
    k.log('done');
    if (process.env.CLIP_DRY) return { id: 'fastener-wizards', dry: true };
    return rec.finish('fastener-wizards', ctx.outDir, ctx.posterDir);
  },
};
