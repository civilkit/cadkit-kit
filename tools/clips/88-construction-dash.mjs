// Construction lines keep their dashes (0.8.15): in a sketch a normal line and two construction lines are drawn (Construction toggle in the sketch bar); with Select one construction
// line is selected (orange, still dashed) and the other hovered (also dashed, orange); the unselected look is the teal dash. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export const doc = () => ({ ...newDoc('Dashes', []), upAxis: 'z' });
const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const SLOT = (s) => `(document.querySelector('.slot[data-slot="${s}"] .slot-btn') || document.querySelector('.slot[data-slot="${s}"]'))`;
const SEL = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Select' && b.getBoundingClientRect().width > 0)`;
const CONS = `document.querySelector('[data-slot="sketch-construction"] button')`;

export default {
  id: 'construction-dash',
  viewport: [1500, 820],
  dpr: 2,
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };   // one wait() is capped at 1.5 s in the encode, so long holds are made of short ones
    const pc = async (expr) => { const [x, y] = await rec.rect(expr); await page.mouse('mouseMoved', x, y); await k.sleep(200); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await k.sleep(600); };
    await pc(`document.querySelector('.slot[data-slot="new-sketch"] .slot-more') || document.querySelector('.slot[data-slot="new-sketch"] .slot-btn')`);
    await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'the plane list');
    await pc(TID('cmd-sketch-new-top'));
    await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
    await k.settle();
    const readout = async (x, y) => { await page.mouse('mouseMoved', x, y); await k.sleep(350); return (await page.eval(`(document.querySelector('.status')?.textContent.match(/(-?[0-9.]+) mm, (-?[0-9.]+) mm/) || []).slice(1, 3).join(',')`)).split(',').map(Number); };
    const a = await readout(400, 250), b = await readout(1100, 550);
    const kk = 700 / (b[0] - a[0]), ox = 400 - a[0] * kk, oy = 250 + a[1] * kk;
    const P = (x, y) => [ox + x * kk, oy - y * kk];
    const clickMm = (x, y, mod = 0) => { const [px, py] = P(x, y); return k.glide(px, py, 3).then(() => k.step(async () => { for (const [t, bt] of [['mousePressed', 1], ['mouseReleased', 0]]) await page.send('Input.dispatchMouseEvent', { type: t, x: px, y: py, button: 'left', buttons: bt, clickCount: 1, modifiers: mod }); await k.sleep(1000); }, 300)); };
    const esc = () => k.step(async () => { await page.key('Escape'); await k.sleep(800); }, 200);
    await rec.begin();
    rec.x = 1300; rec.y = 500;
    await rec.wait(1200);
    // 1: a normal line, then Construction on and two construction lines
    await k.caption('A normal line and two construction lines', 1);
    await k.clickEl(SLOT('line'), 'left', 400);
    await clickMm(-24, -16); await clickMm(24, -16); await esc();
    await k.clickEl(CONS, 'left', 500);
    await k.clickEl(SLOT('line'), 'left', 300);
    await clickMm(-24, 6); await clickMm(24, 6); await esc();
    await clickMm(-24, 26); await clickMm(24, 26); await esc();
    await k.clickEl(CONS, 'left', 400);
    await k.clickEl(SEL, 'left', 400);
    await esc();
    await k.hop(1300, 500);
    await k.snap('88a-lines');
    await hold(3000);
    // 2: select one construction line
    await k.caption('Select a construction line: orange, still dashed', 2);
    await clickMm(-12, 26);
    await k.hop(1300, 500);
    await rec.wait(1000);
    await k.snap('88b-selected');
    await hold(4500);
    // 3: hover the other
    await k.caption('Hover another: also dashed', 3);
    const [hx, hy] = P(-12, 6);
    await k.glide(hx, hy, 4);
    await rec.wait(800);
    await k.snap('88c-hover');
    rec.mark('poster');
    await hold(5000);
    if (process.env.CLIP_DRY) return { id: 'construction-dash', dry: true };
    return rec.finish('construction-dash', ctx.outDir, ctx.posterDir);
  },
};
