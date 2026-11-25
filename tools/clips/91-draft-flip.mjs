// Draft with Flip (0.8.16): a 40 x 40 x 30 mm box; the two opposite side faces are selected (Select > Face, click one, Shift-click the other),
// Features > Draft at 3 degrees, then Flip is ticked, unticked and ticked: the faces lean the other way (seen in the orthographic front view). Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc, rectSketch } from '../doc_shots_defs.mjs';

const post = { type: 'extrude', id: 'F2', name: 'Box', op: 'add', sketch: 'F1', end: 'blind', depth: 30 };
export const doc = () => ({ ...newDoc('Box', [rectSketch('F1', 'Square', 'front', 40, 40, { cx: -20, cy: -20 }), post]), upAxis: 'z' });
const CARD = `[data-testid=editor-card]`;
const TAB = (n) => `[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === '${n}')`;
const BTN = (label) => `document.querySelector('button[aria-label="${label}"]')`;

export default {
  id: 'draft-flip',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: {}, name: 'Box' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important}'; document.head.appendChild(st); return 1; })()`);
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    const view = async (key) => { await k.step(() => page.key(key), 300, false); await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`); await k.settle(800); };
    const clickPx = (x, y, mod = 0) => k.glide(x, y, 3).then(() => k.step(async () => { for (const [t, bt] of [['mousePressed', 1], ['mouseReleased', 0]]) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', buttons: bt, clickCount: 1, modifiers: mod }); await k.sleep(900); }, 400));
    const cv = async () => k.rect(`document.querySelector('#vp canvas')`);
    await k.step(() => page.key('p'), 300, false);   // orthographic: the lean reads true, not foreshortened
    await view('7');
    await k.snap('91a-box');
    await rec.begin();
    rec.x = 1000; rec.y = 640;
    await k.caption('Select two side faces', 1);
    await hold(1800);
    await k.glide(rec.x, 62, 2);
    await k.clickEl(TAB('Select'), 'left', 400);
    await noTip();
    await k.clickEl(`document.querySelector('button[aria-label="Face"], [data-id="sel-face"]') || [...document.querySelectorAll('button')].find((b) => /^Face$/.test(b.textContent.trim()))`, 'left', 400);
    await noTip();
    await view('3');
    await clickPx(830, 360);
    await k.snap('91b-face1');
    await view('5');
    await clickPx(830, 360, 8);
    console.error('SEL', await page.eval(`document.querySelector('.status')?.textContent`));
    await k.snap('91c-face2');
    await view('7');
    await hold(2200);
    await k.glide(rec.x, 62, 2);
    await k.clickEl(TAB('Features'), 'left', 400);
    await noTip();
    await k.caption('Features > Draft: 3 degrees', 2);
    await k.glide(900, 640, 2);
    await k.step(() => page.eval(`${BTN('Draft')}.click(); 0`), 400, false);
    await noTip();
    await k.waitUi(`!!document.querySelector('${CARD}')`, 'the Draft editor', 30000);
    await k.settle();
    await noTip();
    await k.snap('91d-editor');
    console.error('EDITOR', await page.eval(`document.querySelector('${CARD}')?.innerText.replace(/\\n+/g, ' | ')`));
    await view('2');
    await k.snap('91e-front-off');
    await hold(4500);
    await k.caption('Flip tilts the faces the other way', 3);
    const FLIP = `document.querySelector('${CARD} label[data-path="flip"] input') || [...document.querySelectorAll('${CARD} label')].find((l) => /Flip/.test(l.textContent))?.querySelector('input')`;
    const flip = async () => { await k.clickEl(FLIP, 'left', 300); await k.settle(); await k.glide(1000, 700, 2); await noTip(); };
    await flip();
    await k.snap('91f-front-on');
    rec.mark('poster');
    await hold(4500);
    await flip();
    await k.snap('91g-front-off2');
    await hold(3500);
    await flip();
    await k.snap('91h-front-on2');
    await hold(4500);
    if (process.env.CLIP_DRY) return { id: 'draft-flip', dry: true };
    return rec.finish('draft-flip', ctx.outDir, ctx.posterDir);
  },
};
