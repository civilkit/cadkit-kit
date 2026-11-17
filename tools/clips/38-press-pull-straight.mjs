// Press Pull, Continue Straight (Unreleased): a 60 x 40 x 20 block; pick its top face, Press Pull, Continue: Straight, a 15 mm distance, then Taper: End scale 0.6, and the
// panel shows the wall angle it makes; accept and the tapered piece joins the block. The part is made from numbers in this file. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const part = () => newDoc('Block', [rectSketch('F1', 'Outline', 'front', 60, 40, { cx: -30, cy: -20 }), { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }]);
const SEL = (path) => `document.querySelector('label[data-path="${path}"] select')`;
const INP = (path) => `document.querySelector('label[data-path="${path}"] input')`;

export default {
  id: 'press-pull-straight',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, part());
    const k = kit(rec, ctx);
    const command = async (name) => {
      await k.key('f');
      await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
      await k.step(() => page.send('Input.insertText', { text: name }), 900);
      await k.step(() => page.key('Enter'), 300);
      await k.settle();
    };
    const typeInto = async (expr, text) => {
      const f = await k.rect(expr);
      await k.click(f.x, f.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${expr}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text }), 500);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
    };
    await page.key('7'); await k.sleep(600);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await k.snap('38a-view');
    await rec.begin();
    rec.x = 900; rec.y = 640;
    await rec.wait(1500);
    // ---- face mode, pick the top face
    await k.key('q');
    await k.glide(790, 262, 4);
    await k.click(790, 262, 'left', 700);
    await k.snap('38b-picked');
    await command('Press Pull');
    try { await k.waitUi(`!!(${SEL('continue')})`, 'the Press Pull panel', 30000); }
    catch (e) { await k.snap('38x-fail'); console.error(await page.eval(`document.body.innerText.slice(0, 500)`)); throw e; }
    await k.settle();
    await k.snap('38c-panel');
    await rec.wait(2000);
    // ---- Continue: Straight
    await k.choose(SEL('continue'), '/^Straight$/', 1200);
    await k.waitUi(`!!(${INP('distance')})`, 'the distance');
    await typeInto(INP('distance'), '15');
    await k.snap('38d-straight');
    await rec.wait(1800);
    // ---- Taper: End scale, 0.6; the wall angle shows
    await k.choose(SEL('taper'), '/scale/i', 1000);
    await k.waitUi(`!!(${INP('taper.endScale')})`, 'the End scale field');
    await typeInto(INP('taper.endScale'), '0.6');
    try { await k.waitUi(`!!document.querySelector('[data-path="taper.readout"]')`, 'the wall angle', 30000); }
    catch (e) { await k.snap('38x-fail2'); throw e; }
    await k.step(() => page.eval(`document.activeElement?.blur?.(); 0`), 100, false);
    await k.glide(1060, 680, 4);
    await k.snap('38e-readout');
    await rec.wait(3600);
    rec.mark('poster');
    // ---- accept
    await k.clickEl(`document.querySelector('[data-testid="feature-ok"]')`, 'left', 300);
    await k.waitUi(`!document.querySelector('[data-testid="feature-ok"]')`, 'the editor to close');
    await k.settle();
    await k.key('Escape');
    await k.settle();
    await k.glide(1060, 660, 3);
    await k.snap('38f-accepted');
    await rec.wait(1800);
    const vp = await k.rect(`document.querySelector('canvas')`);
    await k.drag(vp.x + 60, vp.y + 80, vp.x - 80, vp.y + 60, 8);
    await k.settle(600);
    await rec.wait(2200);
    if (process.env.CLIP_DRY) return { id: 'press-pull-straight', dry: true };
    return rec.finish('press-pull-straight', ctx.outDir, ctx.posterDir);
  },
};
