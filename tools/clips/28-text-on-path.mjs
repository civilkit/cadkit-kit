// Text along a curve: lettering placed straight in a sketch, then "Along a curve" ticked and a construction arc picked: the letters bend to follow it.
// Load-tolerant (see clipkit.mjs). Public sample: a sketch made from numbers (a construction arc and a text entity).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const dial = () => newDoc('Dial', [
  { type: 'sketch', id: 'F1', name: 'Lettering', plane: { kind: 'std', id: 'front' },
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: -10 }, { id: 'a1', x: 45, y: -10 }, { id: 'a2', x: -45, y: -10 }, { id: 't', x: 0, y: 0 }],
    entities: [{ id: 'e1', type: 'arc', c: 'c', p1: 'a1', p2: 'a2', construction: true }, { id: 'e2', type: 'text', string: 'COLD START', font: 'gauge', height: 7, p: 't', anchor: ['center', 'baseline'] }],
    constraints: [] },
  { type: 'extrude', id: 'F2', name: 'Raised letters', op: 'add', sketch: 'F1', end: 'blind', depth: 2 },
]);
const CHECK = (field) => `document.querySelector('.text-panel [data-field="${field}"] input')`;

export default {
  id: 'text-on-path',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, dial(), { workspace: {} });
    const k = kit(rec, ctx);
    // off camera: open the sketch for editing
    await k.waitUi(`!!document.querySelector('.tree .row[data-id="F1"]')`, 'the sketch row');
    await page.eval(`(() => { const r = document.querySelector('.tree .row[data-id="F1"]'); r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
    await k.waitUi(`!!document.querySelector('#vp canvas') && !!document.querySelector('button[aria-label="Fit"]')`, 'the sketch view');
    await k.settle();
    await page.key('7'); await k.sleep(800);                 // the iso view from the front, then Look normal: straight at the sketch
    await page.key('n'); await k.sleep(800);
    for (let i = 0; i < 2; i++) { await page.mouse('mouseMoved', 852, 296); await page.mouse('mousePressed', 852, 296); await page.mouse('mouseReleased', 852, 296); await k.sleep(900); }   // two quarter turns: the sketch is looked at from its reading side
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await k.snap('a-sketch');
    await rec.begin();
    rec.x = 900; rec.y = 760;
    await rec.wait(1200);                                      // the lettering, straight, and the construction arc above it
    // ---- select the text: its panel opens
    const TX = 500, TY = 461;                                  // the lettering, in the 1280 x 720 page
    await k.click(TX, TY, 'left', 500);
    await k.waitUi(`!!document.querySelector('.text-panel')`, 'the Text panel');
    await rec.wait(1200);
    await k.snap('b-panel');
    // ---- Along a curve, then the arc
    await k.clickEl(CHECK('onPath'), 'left', 500);
    await rec.wait(900);
    await k.clickEl(`document.querySelector('.text-panel [data-act="pickPath"]')`, 'left', 500);
    await rec.wait(700);
    await k.snap('c-picking');
    await k.glide(TX, 336, 5);
    await k.click(TX, 336, 'left', 500);                       // the construction arc (its top is at 336 in the front view)
    await k.settle();
    await rec.wait(1600);                                      // the letters follow the arc, tops inwards (an arc is travelled counter-clockwise)
    await k.clickEl(CHECK('pathFlip'), 'left', 500);           // Other side: tops outwards, reading left to right over the top
    await k.settle();
    await rec.wait(2000);
    rec.mark('poster');
    // ---- finish the sketch: the raised letters follow the arc in the model, seen from the front-top
    await k.click(119, 96, 'left', 600);
    await k.settle();
    await k.key('7');
    await k.glide(760, 560, 4);                                // the pointer off the ribbon
    await k.settle(2500);
    await rec.wait(2600);
    await k.snap('e-model');
    await k.snap('d-done');
    if (process.env.CLIP_DRY) return { id: 'text-on-path', dry: true };
    return rec.finish('text-on-path', ctx.outDir, ctx.posterDir);
  },
};
