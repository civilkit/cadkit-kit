// Wrap a curve around a cylinder (0.8.10): a wavy spline drawn flat on the Front plane, laid around a 50 mm cylinder with Project curve > Wrap, keeping its length. The feature is opened,
// the curve is turned around the cylinder (Around) and slid along the axis (Along the axis). Errors stay 0. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FEATURES = [
  { type: 'sketch', id: 'F1', name: 'Cylinder outline', plane: { kind: 'std', id: 'top' }, points: [{ id: 'p1', x: 0, y: 0 }], entities: [{ type: 'circle', id: 'e1', c: 'p1', r: 25 }], constraints: [] },
  { type: 'extrude', id: 'F2', name: 'Cylinder', op: 'add', sketch: 'F1', end: 'blind', depth: 80 },
  { type: 'sketch', id: 'F3', name: 'Flat curve', plane: { kind: 'std', id: 'front' },
    points: [0, 12, 23, 35, 47, 58, 70].map((x, i) => ({ id: 'q' + i, x, y: [38, 46, 36, 46, 36, 46, 40][i] })),
    entities: [{ type: 'spline', id: 'e0', pts: ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6'] }], constraints: [] },
  { type: 'projectCurve', id: 'F4', name: 'Wrapped curve', sketch: 'F3', faces: ['F2.S.e1'], method: 'wrap', alongAxis: 0, around: -34, rotation: 0, flip: false },
];
export const doc = () => newDoc('Wrap a curve around a cylinder', [...FEATURES]);
const FIELD = (p) => `document.querySelector('label[data-path="${p}"] input')`;

export default {
  id: 'wrap-curve',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: undefined });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    const setField = async (p, v) => {
      const rf = await k.rect(FIELD(p));
      await k.click(rf.x, rf.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${FIELD(p)}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text: String(v) }), 400);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
    };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('74a-part');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A wavy curve drawn flat, wrapped onto a cylinder', 1);
    await hold(2200);
    await k.clickEl(k.row(/Wrapped curve/), 'left', 300);
    await k.step(() => page.eval(`(() => { const r = ${k.row(/Wrapped curve/)}; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`), 400, false);
    try { await k.waitUi(`!!${FIELD('around')}`, 'the Project curve editor', 30000); } catch (e) { await k.snap('74x-editor'); throw e; }
    await k.settle();
    await k.snap('74b-editor');
    await k.caption('Project curve, method Wrap: the curve keeps its length', 2);
    rec.mark('poster');
    await hold(2500);
    await k.caption('Turn it around the cylinder: 34 degrees', 3);
    await setField('around', 0);
    await k.snap('74c-around');
    await hold(2500);
    await k.caption('Slide it along the axis: 15 mm', 4);
    await setField('alongAxis', 15);
    await k.snap('74d-along');
    await hold(2500);
    await k.clickEl(`document.querySelector('[data-testid=editor-card] .fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.caption('Errors 0', 5);
    await k.snap('74e-done');
    await hold(2500);
    if (process.env.CLIP_DRY) return { id: 'wrap-curve', dry: true };
    return rec.finish('wrap-curve', ctx.outDir, ctx.posterDir);
  },
};
