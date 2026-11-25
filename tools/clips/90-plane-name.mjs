// Plane name (0.8.16): a Plane in Angle mode (Top, X axis) is named after its angle and offset, live while the fields are edited:
// "Plane 30 deg, 40 away, from Top". A sketch on that plane then carries the same name. Everything goes through the UI. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const circ = { type: 'sketch', id: 'F1', name: 'Circle', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 25 }], constraints: [] };
const post = { type: 'extrude', id: 'F2', name: 'Disc', op: 'add', sketch: 'F1', end: 'blind', depth: 8 };
export const doc = () => ({ ...newDoc('Disc', [circ, post]), upAxis: 'z' });
const CARD = `[data-testid=editor-card]`;
const FLD = (p) => `document.querySelector('${CARD} label[data-path="${p}"] input')`;
const MODE = `document.querySelector('${CARD} label[data-path="mode"] select')`;
const TAB = (n) => `[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === '${n}')`;
const ROW = (id) => `document.querySelector('.tree .row[data-id="${id}"]')`;
const BTN = (label) => `document.querySelector('button[aria-label="${label}"]')`;

export default {
  id: 'plane-name',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: { floatWidth: 520 }, name: 'Disc' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important} .tree .row-name{font-size:19px !important}'; document.head.appendChild(st); return 1; })()`);   // no notice in the picture; the tree names larger so they read at video size
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    const names = () => page.eval(`[...document.querySelectorAll('.tree .row .row-name')].map((e) => e.textContent.trim()).join(' | ')`);
    await k.step(() => page.key('7'), 300, false);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.zoom(840, 560, -1);
    await k.snap('90a-disc');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('Features > Plane: Angle mode', 1);
    await hold(900);
    await k.glide(rec.x, 62, 2);
    await k.clickEl(TAB('Features'), 'left', 400);
    await noTip();
    await k.glide(820, 600, 2);
    await k.step(() => page.eval(`${BTN('Plane')}.click(); 0`), 400, false);
    await noTip();
    await k.waitUi(`!!${MODE}`, 'the Plane editor', 30000);
    await k.settle();
    await noTip();
    await k.choose(MODE, /Angle/, 300);
    await k.snap('90b-angle');
    console.error('NAMES', await names());
    await hold(1600);
    const typeInto = async (EXPR, text) => {
      const r = await k.rect(EXPR);
      await k.click(r.x, r.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${EXPR}; i.focus(); i.select(); })()`), 250);
      await k.typeOut(text, 300);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
    };
    const confirm = async () => {
      await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 700);
      await k.waitUi(`!document.querySelector('${CARD}')`, 'the Plane editor to close', 60000);
      await k.settle();
      await k.glide(1000, 640, 2);
      await noTip();
    };
    await k.caption('The plane\'s name follows its angle and offset', 2);
    await typeInto(FLD('angle'), '30');
    await k.snap('90c-angle30');
    await confirm();
    console.error('NAMES', await names());
    await k.snap('90d-angle30-confirmed');
    await hold(2200);
    await k.clickEl(`document.querySelector('.tree .row[data-id="F3"] button[aria-label*="dit"], .tree .row[data-id="F3"] [title*="dit"]')`, 'left', 600);
    await k.waitUi(`!!${FLD('offset')}`, 'the Plane editor again', 30000);
    await k.settle();
    await typeInto(FLD('offset'), '40');
    await k.snap('90e-offset40');
    await confirm();
    console.error('NAMES', await names());
    rec.mark('poster');
    await k.snap('90f-name');
    await hold(4500);
    await k.caption('A sketch on it carries the same name', 3);
    await k.glide(rec.x, 62, 2);
    await k.clickEl(TAB('Home'), 'left', 300);
    await k.clickEl(ROW('F3'), 'left', 400);
    await k.clickEl(BTN('Sketch on selected face or plane'), 'left', 150);
    await noTip();
    await k.waitUi(`!!${BTN('Rectangle')}`, 'the sketch tools', 30000);
    await k.settle();
    await k.clickEl(BTN('Rectangle'), 'left', 150);
    await noTip();
    const c = await k.rect(`document.querySelector('#vp canvas')`);
    await k.click(c.x - 90, c.y - 40, 'left', 500);
    await k.glide(c.x + 130, c.y + 40, 4);
    await k.click(c.x + 130, c.y + 40, 'left', 700);
    await noTip();
    await k.clickEl(BTN('Confirm sketch'), 'left', 700);
    await k.settle();
    await k.glide(1000, 640, 2);
    await noTip();
    console.error('NAMES', await names());
    await k.snap('90g-sketch');
    await hold(5500);
    if (process.env.CLIP_DRY) return { id: 'plane-name', dry: true };
    return rec.finish('plane-name', ctx.outDir, ctx.posterDir);
  },
};
