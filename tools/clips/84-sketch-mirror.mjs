// Sketch Mirror (0.8.14): in a sketch on the Top plane a construction line runs down the centre (teal, dashed); the right half of a U is drawn beside it; the two lines are
// selected, Mirror is pressed, the construction line is clicked and the left half appears, tied to the right one by symmetric constraints. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

export const doc = () => ({ ...newDoc('Mirror', []), upAxis: 'z' });
const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const SLOT = (s) => `(document.querySelector('.slot[data-slot="${s}"] .slot-btn') || document.querySelector('.slot[data-slot="${s}"]'))`;
const BTN = (t) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '${t}' && b.getBoundingClientRect().width > 0)`;

export default {
  id: 'sketch-mirror',
  viewport: [2200, 1100],
  dpr: 2,
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    // a sketch on the Top plane, made off camera
    const pc = async (expr) => { const [x, y] = await rec.rect(expr); await page.mouse('mouseMoved', x, y); await k.sleep(200); await page.mouse('mousePressed', x, y); await page.mouse('mouseReleased', x, y); await k.sleep(600); };
    await pc(`document.querySelector('.slot[data-slot="new-sketch"] .slot-more') || document.querySelector('.slot[data-slot="new-sketch"] .slot-btn')`);
    await k.waitUi(`!!document.querySelector('.slot-flyout [data-testid="cmd-sketch-new-top"]')`, 'the plane list');
    await pc(TID('cmd-sketch-new-top'));
    await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
    await k.settle();
    // sketch mm -> screen px, read from the pointer position readout in the status bar
    const readout = async (x, y) => { await page.mouse('mouseMoved', x, y); await k.sleep(350); return (await page.eval(`(document.querySelector('.status')?.textContent.match(/(-?[0-9.]+) mm, (-?[0-9.]+) mm/) || []).slice(1, 3).join(',')`)).split(',').map(Number); };
    const a = await readout(500, 300), b = await readout(1500, 700);
    const kk = 1000 / (b[0] - a[0]), ox = 500 - a[0] * kk, oy = 300 + a[1] * kk;
    const P = (x, y) => [ox + x * kk, oy - y * kk];
    const clickMm = (x, y, mod = 0) => { const [px, py] = P(x, y); return k.glide(px, py, 3).then(() => k.step(async () => { for (const [t, bt] of [['mousePressed', 1], ['mouseReleased', 0]]) await page.send('Input.dispatchMouseEvent', { type: t, x: px, y: py, button: 'left', buttons: bt, clickCount: 1, modifiers: mod }); await k.sleep(1200); }, 300)); };
    const esc = () => k.step(async () => { await page.key('Escape'); await k.sleep(900); }, 200);
    await rec.begin();
    rec.x = 700; rec.y = 500;
    await rec.wait(1200);
    // 1: the centre line, made construction
    await k.caption('A construction line down the centre', 1);
    await k.clickEl(SLOT('line'), 'left', 400);
    await clickMm(10, -20); await clickMm(10, 20); await esc();
    await k.clickEl(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Select' && b.getBoundingClientRect().width > 0)`, 'left', 400);
    await esc();
    await clickMm(10, 12);
    await k.step(() => page.eval(`document.querySelector('[data-action="sketch-make-construction"]').click(); 0`), 300);
    await k.settle();
    await k.hop(700, 900);
    await k.step(async () => { await page.mouse('mousePressed', 700, 900); await page.mouse('mouseReleased', 700, 900); await k.sleep(600); }, 300);   // nothing selected: the construction line shows its own look
    await k.snap('84a-centre');
    await rec.wait(2500);
    // 2: the right half of a U
    await k.caption('The right half of a U beside it', 2);
    await k.clickEl(SLOT('line'), 'left', 400);
    await clickMm(10, -20); await clickMm(40, -20); await clickMm(40, 20); await esc();
    await k.clickEl(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Select' && b.getBoundingClientRect().width > 0)`, 'left', 400);
    await esc();
    await k.snap('84b-half');
    rec.mark('poster');
    await rec.wait(2000);
    // 3: select both lines, press Mirror
    await k.caption('Select the lines, press Mirror', 3);
    await clickMm(18, -20); await clickMm(40, 12, 8);
    await k.hop(700, 900);   // the pointer off the constraint glyph, so no tooltip covers the lines
    await rec.wait(1500);
    await k.snap('84c-selected');
    await k.clickEl(BTN('Mirror'), 'left', 700);
    await k.hop(700, 900);
    await k.settle();
    await k.snap('84d-mirror');
    await rec.wait(2200);
    // 4: click the mirror line
    await k.caption('Click the mirror line', 4);
    await clickMm(10, 12);
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 700, 900), 100, false);
    await esc();
    await k.snap('84e-done');
    await k.caption('The other half appears, symmetric', 5);
    await rec.wait(3500);
    if (process.env.CLIP_DRY) return { id: 'sketch-mirror', dry: true };
    return rec.finish('sketch-mirror', ctx.outDir, ctx.posterDir);
  },
};
