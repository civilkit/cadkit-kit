// Rib with its options: one open line sketched on the front plane of a clevis bracket, then Rib (Features > Modify, under Draft): the editor
// with Thickness, Thickness side, Fillet on the free edge and Draft angle, a fillet and a draft set, the rib shown. The part (the guide's
// "A bracket with a rib", without the rib) comes from 19-rib-options.doc.json. Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { openDoc, kit } from './clipkit.mjs';

export const clevisDoc = () => JSON.parse(readFileSync(new URL('./19-rib-options.doc.json', import.meta.url), 'utf8'));
const FRONT = `[...document.querySelectorAll('.tree .row')].find((e) => /^Front Plane/.test(e.querySelector('.row-name')?.textContent.trim() ?? ''))`;
const INPUT = (n) => `document.querySelectorAll('.tree-wrap input')[${n}]`;   // Profile sketch, Thickness, Fillet, Draft (the fields set here are the last two)
const BAR_OK = `[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === 'Confirm' || b.title === 'Confirm sketch')`;

export default {
  id: 'rib-options',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, clevisDoc());
    const k = kit(rec, ctx);
    k.log('loaded');
    await rec.begin();
    rec.x = 700; rec.y = 600;
    await rec.wait(1000);
    // ---- a sketch on the front plane
    const { x: px, y: py } = await k.rect(FRONT);
    await k.rightClick(px - 20, py, 700);
    await k.clickEl(k.menuItem('/Sketch on this plane/'), 'left', 300);
    await k.waitUi(`!!document.querySelector('.sketch-bar')`, 'the sketch bar');
    await k.settle();
    await rec.wait(800);
    // ---- ONE open line, from the plate up to the block
    await k.click(665, 475);
    await k.click(768, 342);
    await k.key('Escape');
    await rec.wait(1200);
    k.log('line');
    await k.snap('19a-line');
    await k.clickEl(BAR_OK, 'left', 300);
    await k.waitUi(`!document.querySelector('.sketch-bar')`, 'the sketch to close');
    await k.settle();
    await rec.wait(900);
    // ---- Rib, in the flyout under Draft, on that sketch
    await k.clickEl(`document.querySelector('button[aria-label="More tools like Draft"]')`, 'left', 600);
    await k.clickEl(`[...document.querySelectorAll('span,div,button')].find((e) => e.children.length === 0 && e.textContent.trim() === 'Rib')`, 'left', 300);
    await k.waitUi(`!!document.querySelector('.tree-wrap select') && /Draft angle/.test(document.querySelector('.tree-wrap')?.textContent || '')`, 'the Rib editor');
    await k.settle();
    await rec.wait(1800);                            // the editor and the rib it gives with the defaults
    await k.snap('19b-editor');
    k.log('editor');
    // ---- the fields: thickness, a fillet on the free edge, a draft angle
    const set = async (n, text) => {
      const r = await k.rect(INPUT(n));
      await k.click(r.x, r.y, 'left', 200);
      await k.step(() => page.eval(`(() => { const i = ${INPUT(n)}; i.focus(); i.select(); })()`), 250);
      await k.typeOut(text, 150);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
      await rec.wait(600);
    };
    await set(2, '1.5');
    await set(3, '3');
    await rec.wait(900);
    await k.snap('19c-set');
    k.log('set');
    await k.clickEl(`[...document.querySelectorAll('.tree-wrap button')].find((b) => (b.getAttribute('aria-label') || b.title) === 'Confirm')`, 'left', 300);
    await k.waitUi(`!document.querySelector('.tree-wrap select') && /Rib/.test(document.querySelector('.tree')?.textContent || '')`, 'the rib');
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 800, 620), 100, false);
    await rec.wait(600);
    // ---- turn the view to see the rib
    await k.drag(710, 560, 800, 620, 5);
    await rec.wait(1600);
    rec.mark('poster');
    await rec.wait(1600);
    await k.snap('19d-end');
    k.log('done');
    if (process.env.CLIP_DRY) return { id: 'rib-options', dry: true };
    return rec.finish('rib-options', ctx.outDir, ctx.posterDir);
  },
};
