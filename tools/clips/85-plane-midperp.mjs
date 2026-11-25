// Reference plane modes, second part (0.8.13): Midplane (needs a base plane and a second plane) and Perpendicular (needs a base plane and an axis) in the Plane editor, on the disc of
// the plane-modes clip (an Angle plane at 30 degrees about X and a slanted opening cut through it, written here as plain feature records). Everything new goes through the UI.
// Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const circ = { type: 'sketch', id: 'F1', name: 'Circle', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 25 }], constraints: [] };
const P = (id, x, y) => ({ id, x, y });
const FEATURES = [
  circ,
  { type: 'extrude', id: 'F2', name: 'Disc', op: 'add', sketch: 'F1', end: 'blind', depth: 8 },
  { type: 'plane', id: 'F3', name: 'Angle plane', mode: 'angle', base: { kind: 'std', id: 'front' }, axis: { kind: 'axis', axis: 'x' }, angle: 30 },
  { type: 'sketch', id: 'F4', name: 'Slot', plane: { kind: 'feature', id: 'F3' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, P('p1', -18, -8), P('p2', 18, -8), P('p3', 18, 8), P('p4', -18, 8)],
    entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [] },
  { type: 'extrude', id: 'F5', name: 'Slanted opening', op: 'cut', sketch: 'F4', end: 'throughBoth' },
];
export const doc = () => ({ ...newDoc('Disc with slanted opening', FEATURES), upAxis: 'z' });   // Z up: without upAxis the document opens Y-up and lies on its side
const CARD = `[data-testid=editor-card]`;
const MODE = `document.querySelector('${CARD} label[data-path="mode"] select')`;
const FIELD = (p) => `document.querySelector('${CARD} label[data-path="${p}"] select')`;
const TAB = (n) => `[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === '${n}')`;
const BTN = (label) => `document.querySelector('button[aria-label="${label}"]')`;

export default {
  id: 'plane-midperp',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: {}, name: 'Disc with slanted opening' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const hold = async (ms) => { for (let t = 0; t < ms * 0.5; t += 250) await rec.wait(250); };
    const pick = async (sel, value) => { await k.step(() => page.eval(`(() => { const s = (${sel}); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(value)}); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`), 100); await k.settle(); await rec.wait(300); };
    const confirm = async () => { await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 700); await k.settle(); };
    const newPlane = async () => { await k.clickEl(BTN('Plane'), 'left', 400); await k.glide(820, 600, 2); await k.waitUi(`!!${MODE}`, 'the Plane editor', 30000); await k.settle(); };   // the pointer is parked in the empty viewport, off the ribbon (no tooltip)
    await k.step(() => page.key('7'), 300, false);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.zoom(840, 560, -2);   // closer, so the new planes read
    await k.snap('79a-part');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A disc with a slanted opening, cut through an Angle plane', 1);
    rec.mark('poster');
    await hold(2600);
    // ---- Midplane
    await k.clickEl(TAB('Features'), 'left', 400);
    await k.caption('Midplane: a base plane and a second plane', 2);
    await newPlane();
    await k.choose(MODE, /Midplane/);
    await pick(FIELD('base'), 'std:front');
    await pick(FIELD('base2'), 'feature:F3');
    await k.snap('79b-mid');
    await hold(3200);
    await confirm();
    await k.snap('79c-mid-done');
    await hold(1500);
    // ---- Perpendicular
    await k.caption('Perpendicular: a base plane, an axis and Flip direction', 3);
    await newPlane();
    await k.choose(MODE, /Perpendicular/);
    await pick(FIELD('base'), 'std:front');
    await k.choose(FIELD('axis'), /Y axis/);
    await k.clickEl(`document.querySelector('${CARD} label[data-path="flip"] input')`, 'left', 500);
    await k.snap('79d-perp');
    await hold(3200);
    await confirm();
    await k.glide(800, 560, 2);
    await k.caption('Errors 0', 4);
    await k.snap('79e-done');
    await hold(2600);
    if (process.env.CLIP_DRY) return { id: 'plane-midperp', dry: true };
    return rec.finish('plane-midperp', ctx.outDir, ctx.posterDir);
  },
};
