// Split face step (Unreleased): a 60 x 40 x 20 block; pick its top face, Split face cuts it in two along the middle, pick one half (no size box shows, the
// one that would move the whole extrude), Move Face by +10 raises that half with a wall along the split line, then -8 sinks it. The part is made from numbers
// in this file. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const part = () => newDoc('Block', [rectSketch('F1', 'Outline', 'top', 60, 40, { cx: -30, cy: -20 }), { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }]);
const INP = (path) => `document.querySelector('label[data-path="${path}"] input')`;
const SIZEBOX = process.env.CLIP_SIZEBOX_PROBE;

export default {
  id: 'split-face-step',
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
    await k.snap('41a-view');
    await rec.begin();
    rec.x = 900; rec.y = 640;
    await rec.wait(1500);
    // ---- face mode, pick the top face
    await k.key('q');
    await k.glide(790, 262, 4);
    await k.click(790, 262, 'left', 700);
    await k.snap('41b-picked');
    await rec.wait(1200);
    await command('Split face');
    await k.waitUi(`!!document.querySelector('[data-testid="feature-ok"]')`, 'the Split face editor', 30000);
    await k.settle();
    await k.snap('41c-split-editor');
    await rec.wait(1400);
    await k.clickEl(`document.querySelector('[data-testid="feature-ok"]')`, 'left', 300);
    await k.waitUi(`!document.querySelector('[data-testid="feature-ok"]')`, 'the editor to close');
    await k.settle();
    await k.key('Escape');
    await k.settle();
    await k.snap('41d-split');
    await rec.wait(1500);
    // ---- pick one half: the Block row is not selected as a shape, no size box shows
    await k.glide(704, 320, 4);
    await k.click(704, 320, 'left', 900);
    await k.snap('41e-half');
    await rec.wait(2100);
    // ---- Move Face (Press Pull, Continue: Offset)
    await command('Press Pull');
    try { await k.waitUi(`!!(${INP('distance')})`, 'the distance field', 30000); }
    catch (e) { await k.snap('41x-fail'); console.error(await page.eval(`document.body.innerText.slice(0, 600)`)); throw e; }
    await k.settle();
    await k.snap('41f-panel');
    await rec.wait(1500);
    await typeInto(INP('distance'), '10');
    await k.step(() => page.eval(`document.activeElement?.blur?.(); 0`), 100, false);
    await k.glide(1060, 640, 4);
    await k.snap('41g-raised');
    rec.mark('poster');
    await rec.wait(2800);   // the half rises with a wall along the split line
    await typeInto(INP('distance'), '-8');
    await k.step(() => page.eval(`document.activeElement?.blur?.(); 0`), 100, false);
    await k.glide(1070, 650, 3);
    await k.snap('41h-sunk');
    await rec.wait(2600);   // a negative distance sinks it
    await k.clickEl(`document.querySelector('[data-testid="feature-ok"]')`, 'left', 300);
    await k.waitUi(`!document.querySelector('[data-testid="feature-ok"]')`, 'the editor to close');
    await k.settle();
    await k.key('Escape');
    await k.settle();
    await k.glide(1060, 660, 3);
    await k.snap('41i-accepted');
    await rec.wait(1400);
    const vp = await k.rect(`document.querySelector('canvas')`);
    await k.drag(vp.x + 60, vp.y + 80, vp.x - 80, vp.y + 60, 8);
    await k.settle(600);
    await rec.wait(1500);
    if (process.env.CLIP_DRY) return { id: 'split-face-step', dry: true };
    return rec.finish('split-face-step', ctx.outDir, ctx.posterDir);
  },
};
