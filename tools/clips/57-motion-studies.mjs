// Motion studies (0.8.6). The shipped hinge door: the Motion tab drives the door with a slider, Find limits says where the swing stops and why, and a
// two-key study in the timeline along the bottom plays the door open. One caption per step. Load-tolerant (see clipkit.mjs).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDoc, kit } from './clipkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DOOR = JSON.parse(readFileSync(resolve(here, '../../apps/cad/public/samples/assembly-hinge-door.ckpart'), 'utf8'));

export default {
  id: 'motion-studies',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, DOOR, { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const setv = (sel, v) => page.eval(`(() => { const el = ${sel}; if (!el) return 0; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(String(v))}); el.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`);
    const hinge = `[...document.querySelectorAll('input[type=range]')].find((i) => (i.getAttribute('aria-label') || '').startsWith('Hinge'))`;
    const scrub = `document.querySelector('.mtl-scrub')`;
    // a slider moved a small step at a time: the clip is made of the frames the page paints, so a motion is smooth only if the page is asked for many small steps
    const run = async (sel, from, to, steps, ms) => { for (let i = 0; i <= steps; i++) { await setv(sel, from + ((to - from) * i) / steps); await rec.wait(ms); } };
    const btn = (txt) => k.clickEl(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(txt)}))`, 'left', 800);
    const tab = (name) => k.clickEl(`[...document.querySelectorAll('[role=tab], .tab, button')].find((e) => e.textContent.trim() === ${JSON.stringify(name)})`, 'left', 900);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('55a-start');
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await k.caption('A hinged door: drive it without changing the model', 1);
    await tab('Motion');
    await rec.wait(1400);
    await k.caption('The Motion tab: sliders for every mate that can move', 1);
    await btn('Sliders');
    await rec.wait(1200);
    await run(hinge, 0, 95, 38, 45);
    await rec.wait(700);
    await k.snap('55b-slider');
    await k.caption('Limits: where does the swing stop, and why?', 2);
    await btn('Limits');
    await rec.waitFor(`!!document.querySelector('[data-found]')`, 'the limits', 60000);
    await rec.wait(900);
    await k.snap('55c-limits');
    rec.mark('poster');
    await rec.wait(3200);
    await k.caption('A study: the timeline along the bottom, door shut at 0 s', 2);
    await btn('Reset to the assembled pose');
    await btn('New study');
    await rec.wait(900);
    await k.clickEl(`document.querySelector('button.mtl-key')`, 'left', 900);
    await k.caption('Slide to 90 degrees, move the playhead to 2 s, key it again', 3);
    await run(hinge, 95, 90, 4, 100);
    await rec.wait(800);
    await setv(scrub, 2);
    await rec.wait(1400);
    await k.clickEl(`document.querySelector('button.mtl-key')`, 'left', 900);
    await k.snap('55d-keys');
    await rec.wait(1400);
    await k.caption('Drag the playhead (or press Play): the door swings open', 4);
    await setv(scrub, 0);
    await rec.wait(900);
    await run(scrub, 0, 2, 50, 45);
    await rec.wait(900);
    await run(scrub, 2, 0, 50, 45);
    await k.snap('55e-played');
    await rec.wait(1200);
    if (process.env.CLIP_DRY) return { id: 'motion-studies', dry: true };
    return rec.finish('motion-studies', ctx.outDir, ctx.posterDir);
  },
};
