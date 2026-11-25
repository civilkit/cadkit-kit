// Loft end conditions (0.8.10): two 20 mm circles 40 mm apart, lofted. The End condition is set to Directional and its Angle edited: 60 bows the sides outward, 90 leaves it
// straight, 120 necks it in. Errors stay 0. Only the End side is shown. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const circ = (id, name, plane) => ({ type: 'sketch', id, name, plane, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 10 }], constraints: [] });
const FEATURES = [
  circ('F1', 'Bottom circle', { kind: 'std', id: 'front' }),
  { type: 'plane', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: 40, name: 'Plane 40', autoName: true, id: 'F2' },
  circ('F3', 'Top circle', { kind: 'feature', id: 'F2' }),
  { type: 'loft', op: 'new', name: 'Vase', sketches: ['F1', 'F3'], id: 'F4' },
];
export const doc = () => newDoc('Loft with an end condition', [...FEATURES]);
const ANGLE = `document.querySelector('label[data-path="conditions.1.angle"] input')`;
const ENDSEL = `document.querySelector('label[data-path="conditions.1.type"] select')`;
const STATUS = (re) => `[...document.querySelectorAll('.status *')].filter((e) => ${re}.test(e.textContent.trim())).pop()`;

export default {
  id: 'loft-end-conditions',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    const setAngle = async (v) => {
      const rf = await k.rect(ANGLE);
      await k.click(rf.x, rf.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${ANGLE}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text: String(v) }), 400);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
    };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('71a-part');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A loft between two 20 mm circles, 40 mm apart', 1);
    await hold(2200);
    await k.clickEl(k.row(/Vase/), 'left', 300);
    await k.step(() => page.eval(`(() => { const r = ${k.row(/Vase/)}; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`), 400, false);
    try { await k.waitUi(`!!${ENDSEL}`, 'the End condition', 30000); } catch (e) { await k.snap('71x-editor'); throw e; }
    await k.settle();
    await k.snap('71b-editor');
    await k.caption('End condition: Directional', 2);
    await k.choose(ENDSEL, /Directional/);
    await k.snap('71c-dir');
    await hold(1500);
    await k.caption('Angle 60: the sides bow outward', 3);
    await setAngle(60);
    await k.snap('71d-60');
    rec.mark('poster');
    await hold(3000);
    await k.caption('Angle 90: straight out of the profile', 4);
    await setAngle(90);
    await k.snap('71e-90');
    await hold(3000);
    await k.caption('Angle 120: the body necks in', 5);
    await setAngle(120);
    await k.snap('71f-120');
    await hold(3000);
    await k.clickEl(`document.querySelector('[data-testid=editor-card] .fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.caption('Errors 0', 6);
    await k.snap('71g-done');
    await hold(2500);
    if (process.env.CLIP_DRY) return { id: 'loft-end-conditions', dry: true };
    return rec.finish('loft-end-conditions', ctx.outDir, ctx.posterDir);
  },
};
