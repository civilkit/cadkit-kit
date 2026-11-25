// Plane editor, Angle mode with an Offset (0.8.15): the Offset field now shows in Angle mode. A Top-plane angle plane (X axis, 30 degrees) is made on a disc, its offset is typed
// as 40 (the plane moves along its tilted normal, origin (0, -20, 34.64), normal (0, -0.5, 0.866)), then a rectangle is sketched on it and extruded 10 mm as a new body: the solid stands
// lifted and tilted beside the disc. Everything goes through the UI. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const circ = { type: 'sketch', id: 'F1', name: 'Circle', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 25 }], constraints: [] };
const post = { type: 'extrude', id: 'F2', name: 'Disc', op: 'add', sketch: 'F1', end: 'blind', depth: 8 };
export const doc = () => ({ ...newDoc('Disc', [circ, post]), upAxis: 'z' });   // Z up: without upAxis the document opens Y-up and lies on its side
const CARD = `[data-testid=editor-card]`;
const MODE = `document.querySelector('${CARD} label[data-path="mode"] select')`;
const DEPTH = `document.querySelector('${CARD} label[data-path="depth"] input')`;
const OFFSET = `document.querySelector('${CARD} label[data-path="offset"] input')`;
const TAB = (n) => `[...document.querySelectorAll('[role=tab], button')].find((b) => b.textContent.trim() === '${n}')`;
const ROW = (id) => `document.querySelector('.tree .row[data-id="${id}"]')`;
const BTN = (label) => `document.querySelector('button[aria-label="${label}"]')`;

export default {
  id: 'plane-offset',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc(), { workspace: {}, name: 'Disc' });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`(() => { const st = document.createElement('style'); st.textContent = '.toast{display:none !important}'; document.head.appendChild(st); return 1; })()`);   // no rebuild notice in the picture
    const noTip = () => rec.skip(() => page.eval(`document.querySelectorAll('.tip').forEach((e) => e.remove()); 0`));   // a ribbon tooltip left over from the pointer's way
    const hold = async (ms) => { await noTip(); for (let t = 0; t < ms * 0.35; t += 250) await rec.wait(250); };
    await k.step(() => page.key('7'), 300, false);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.zoom(840, 560, -1);
    await k.snap('87a-disc');
    await rec.begin();
    rec.x = 1000; rec.y = 620;
    await k.caption('A disc on the Top plane', 1);
    await hold(2800);
    await k.glide(rec.x, 62, 2);   // up the free right side, then along the tab bar: a disabled ribbon button under the pointer leaves its tooltip stuck
    await k.clickEl(TAB('Features'), 'left', 400);
    await noTip();
    await k.caption('Features > Plane: Angle mode', 2);
    await k.glide(820, 600, 2);   // the pointer rests in the empty viewport; the Plane button is pressed without hovering it (the button goes disabled while its editor is open and would leave its tooltip stuck)
    await k.step(() => page.eval(`${BTN('Plane')}.click(); 0`), 400, false);
    await noTip();
    await k.waitUi(`!!${MODE}`, 'the Plane editor', 30000);
    await k.settle();
    await noTip();
    await k.choose(MODE, /Angle/, 300);
    await k.snap('87b-angle');
    rec.mark('before');
    await k.caption('Angle 30 degrees about the X axis', 3);
    await hold(5000);
    await k.snap('87c-angle');
    await k.caption('Offset 40 mm moves it along its tilted normal', 4);
    const typeInto = async (EXPR, text) => {
      const r = await k.rect(EXPR);
      await k.click(r.x, r.y, 'left', 300);
      await k.step(() => page.eval(`(() => { const i = ${EXPR}; i.focus(); i.select(); })()`), 250);
      await k.step(() => page.send('Input.insertText', { text }), 400);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
    };
    await k.caption('Offset 40 mm moves it along its tilted normal', 4);
    await typeInto(OFFSET, '40');
    await k.snap('87d-offset');
    await hold(5400);
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 700);
    await k.waitUi(`!document.querySelector('${CARD}')`, 'the Plane editor to close', 60000);
    await k.settle();
    await k.snap('87e-plane');
    await hold(2400);
    // ---- build on the plane: sketch a rectangle, extrude it as a new body
    await k.caption('Sketch a rectangle on the plane', 5);
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
    await k.snap('87f-rect');
    await noTip();
    await hold(1600);
    await k.clickEl(BTN('Confirm sketch'), 'left', 700);
    await k.settle();
    await k.glide(900, 640, 2);
    await noTip();
    await k.caption('Extrude: a solid on the offset plane', 6);
    await k.clickEl(ROW('F4'), 'left', 400);
    await k.clickEl(BTN('Extrude'), 'left', 150);
    await noTip();
    await k.glide(900, 640, 2);
    await k.waitUi(`!!${DEPTH}`, 'the Extrude editor', 30000);
    await k.settle();
    await noTip();
    await k.step(() => page.eval(`(() => { const b = [...document.querySelectorAll('${CARD} button')].find((x) => x.textContent.trim() === 'New body'); if (b) b.click(); else { const s = document.querySelector('${CARD} label[data-path="op"] select'); const o = s && [...s.options].find((x) => /New body/.test(x.textContent)); if (o) { const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); } } return 1; })()`), 300);
    await k.settle();
    await typeInto(DEPTH, '10');
    await k.snap('87g-extrude-editor');
    await hold(1600);
    await k.clickEl(`document.querySelector('${CARD} .fedit-confirm')`, 'left', 700);
    await k.waitUi(`!document.querySelector('${CARD}')`, 'the Extrude editor to close', 60000);
    await k.settle();
    await k.glide(1000, 640, 2);
    await k.step(() => page.key('7'), 300);
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.click(900, 205, 'left', 400);   // empty viewport: the extrude's drag handles go
    await k.settle();
    await k.glide(1000, 640, 2);
    await noTip();
    await k.caption('Errors 0', 7);
    await k.snap('87h-done');
    rec.mark('poster');
    await hold(9000);
    if (process.env.CLIP_DRY) return { id: 'plane-offset', dry: true };
    return rec.finish('plane-offset', ctx.outDir, ctx.posterDir);
  },
};
