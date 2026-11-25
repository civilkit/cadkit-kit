// Reference plane modes (0.8.13): the Plane editor's Angle mode, used on a disc. A circle on the Top plane is extruded into a disc; an Angle plane
// (axis X, 30 degrees) is made, a rectangle is sketched on it and cut through the disc both ways (a slanted opening); the clip plane-midperp (85) shows Midplane and Perpendicular. Everything goes through the UI. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const circ = { type: 'sketch', id: 'F1', name: 'Circle', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 25 }], constraints: [] };
const post = { type: 'extrude', id: 'F2', name: 'Disc', op: 'add', sketch: 'F1', end: 'blind', depth: 8 };
export const doc = () => ({ ...newDoc('Disc', [circ, post]), upAxis: 'z' });   // Z up: without upAxis the document opens Y-up and lies on its side
const CARD = `[data-testid=editor-card]`;
const MODE = `document.querySelector('${CARD} label[data-path="mode"] select')`;
const FIELD = (p) => `document.querySelector('${CARD} label[data-path="${p}"] select')`;
const TAB = (n) => `[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === '${n}')`;
const ROW = (id) => `document.querySelector('.tree .row[data-id="${id}"]')`;
const BTN = (label) => `document.querySelector('button[aria-label="${label}"]')`;

export default {
  id: 'plane-modes',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: {}, name: 'Disc' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };   // short holds: the clip is long enough with every step
    const pick = async (sel, value) => { await k.step(() => page.eval(`(() => { const s = (${sel}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`), 100); await k.settle(); await rec.wait(300); };
    const confirm = async () => { await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 700); await k.settle(); };
    const newPlane = async () => { await k.clickEl(TAB('Features'), 'left', 400); await k.clickEl(BTN('Plane'), 'left', 400); await k.glide(820, 600, 2); await k.waitUi(`!!${MODE}`, 'the Plane editor', 30000); await k.settle(); };   // the pointer is parked in the empty viewport, off the ribbon (no tooltip)
    const iso = async () => { await k.glide(800, 560, 2); await k.step(() => page.key('7'), 300); await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`); await k.settle(); };
    await k.step(() => page.key('7'), 300, false);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('76a-disc');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A disc: a circle on the Top plane, extruded 8 mm', 1);
    rec.mark('poster');
    await hold(2200);
    // ---- Angle
    await k.caption('Features > Plane: choose the Angle mode', 2);
    await newPlane();
    await k.snap('76b-editor');
    await hold(1200);
    await k.caption('Angle: base plane Top, X axis, 30 degrees', 3);
    await k.choose(MODE, /Angle/, 300);
    await k.snap('76c-angle');
    await hold(3200);
    await confirm();
    await k.snap('76d-angle-done');
    await hold(1500);
    // ---- sketch on the tilted plane
    await k.caption('Sketch a rectangle on the tilted plane', 4);
    await k.clickEl(TAB('Home'), 'left', 300);
    await k.clickEl(ROW('F3'), 'left', 400);
    await k.clickEl(BTN('Sketch on selected face or plane'), 'left', 400);
    await k.waitUi(`!!${BTN('Rectangle')}`, 'the sketch tools', 30000);
    await k.settle();
    await k.clickEl(BTN('Rectangle'), 'left', 400);
    const c = await k.rect(`document.querySelector('#vp canvas')`);
    const ox = c.x + 138, oy = c.y + 11;   // the model origin in the sketch view (the view is not centred on it)
    await k.click(ox - 110, oy - 35, 'left', 500);
    await k.glide(ox + 110, oy + 45, 4);
    await k.click(ox + 110, oy + 45, 'left', 700);
    await k.snap('76e-rect');
    await hold(1200);
    await k.clickEl(BTN('Confirm sketch'), 'left', 700);
    await k.settle();
    // ---- cut through
    await k.caption('Extrude it as a cut, through all both ways: a slanted opening', 5);
    await k.clickEl(ROW('F4'), 'left', 400);
    await k.clickEl(BTN('Extrude'), 'left', 400);
    await k.waitUi(`!!${FIELD('end')}`, 'the Extrude editor', 30000);
    await k.settle();
    await k.choose(FIELD('end'), /both ways/, 300);
    await k.clickEl(`[...document.querySelectorAll('${CARD} button')].find((b) => b.textContent.trim() === 'Cut')`, 'left', 700);
    await k.settle();
    await k.snap('76f-cut-editor');
    await hold(1500);
    await confirm();
    await iso();
    await k.snap('76g-cut');
    await hold(2000);
    await k.caption('Errors 0', 6);
    await k.snap('76h-done');
    await hold(2600);
    if (process.env.CLIP_DRY) return { id: 'plane-modes', dry: true };
    return rec.finish('plane-modes', ctx.outDir, ctx.posterDir);
  },
};
