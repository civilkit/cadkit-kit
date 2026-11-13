// Patterns about any axis and along any direction: a round pocket, patterned in a circle (the Circular pattern editor turns about the origin
// until its axis is set to "Direction and point" with the point at the centre of a bolt circle), then a square pocket patterned in a linear
// pattern along an oblique direction vector. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

/** A 200 x 140 x 8 plate with a round pocket at (80, 0) and a square pocket near its top left corner. */
export const plateDoc = () => {
  const circle = { type: 'sketch', id: 'F3', name: 'Round pocket sketch', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'k', x: 80, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'k', r: 5 }], constraints: [] };
  const sq = { type: 'sketch', id: 'F5', name: 'Square pocket sketch', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: -90, y: 50 }, { id: 'b', x: -82, y: 50 }, { id: 'c', x: -82, y: 58 }, { id: 'd', x: -90, y: 58 }],
    entities: [['e1', 'a', 'b'], ['e2', 'b', 'c'], ['e3', 'c', 'd'], ['e4', 'd', 'a']].map(([i, p, q]) => ({ id: i, type: 'line', p1: p, p2: q })), constraints: [] };
  return newDoc('Plate', [rectSketch('F1', 'Plate outline', 'front', 200, 140, { cx: -100, cy: -70 }), { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 8 },
    circle, { type: 'extrude', id: 'F4', name: 'Round pocket', op: 'cut', sketch: 'F3', end: 'blind', depth: 4 },
    sq, { type: 'extrude', id: 'F6', name: 'Square pocket', op: 'cut', sketch: 'F5', end: 'blind', depth: 4 }]);
};
const ROW = (name) => `[...document.querySelectorAll('.tree .row')].find((e) => e.querySelector('.row-name')?.textContent.trim() === '${name}')`;
const FIELD = (path) => `document.querySelector('.tree-wrap label[data-path="${path}"] input')`;
const SELECT = (path) => `document.querySelector('.tree-wrap label[data-path="${path}"] select')`;
const FLYOUT = (name) => `document.querySelector('button[aria-label="More tools like ${name}"]')`;
const ITEM = (text) => `[...document.querySelectorAll('span,div,button')].find((e) => e.children.length === 0 && e.textContent.trim() === '${text}')`;
const OK = `[...document.querySelectorAll('.tree-wrap button')].find((b) => (b.getAttribute('aria-label') || b.title) === 'Confirm')`;

export default {
  id: 'pattern-axes',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, plateDoc());
    const k = kit(rec, ctx);
    k.log('loaded');
    const setField = async (path, text, hold = 700) => {
      const f = await k.rect(FIELD(path));
      await k.click(f.x, f.y, 'left', 200);
      await k.step(() => page.eval(`(() => { const i = ${FIELD(path)}; i.focus(); i.select(); })()`), 250);
      await k.typeOut(text, 150);
      await k.step(() => page.key('Tab'), 250);
      await k.settle();
      await rec.wait(hold);
    };
    /** a command by its name in the command search (F), as the rail's pattern buttons sit below the fold of the rail */
    const command = async (name) => {
      await k.key('f');
      await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
      await k.step(() => page.send('Input.insertText', { text: name }), 900);
      await k.step(() => page.key('Enter'), 300);
    };
    // off camera: the front view, fitted, so the pocket outlines read
    await page.key('2'); await new Promise((r) => setTimeout(r, 800));
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await rec.begin();
    rec.x = 760; rec.y = 620;
    await rec.wait(900);
    // ---- the round pocket, repeated in a circle
    await k.clickEl(ROW('Round pocket'), 'left', 300, -20);
    await k.settle();
    await command('Circular pattern');
    await k.waitUi(`!!${SELECT('axis')}`, 'the Circular pattern editor');
    await k.settle();
    await rec.wait(1800);                            // the pattern turns about the origin
    await k.snap('21a-circ');
    k.log('circular editor');
    // the axis choices: the standard axes, a typed direction (Direction and point) or a picked edge (Pick); the point it passes through
    const pick = await k.rect(`document.querySelector('.tree-wrap label[data-path="axis"] button')`);
    await k.glide(pick.x, pick.y, 3);
    await rec.wait(1500);
    await k.snap('21b-axis');
    await setField('axis.point.x', '60', 1800);       // the bolt circle's centre: the pattern moves to it
    await k.snap('21c-point');
    k.log('axis set');
    await k.clickEl(OK, 'left', 300);
    await k.waitUi(`!${SELECT('axis')}`, 'the pattern');
    await k.settle();
    await rec.wait(1000);
    // ---- the square pocket, repeated along an oblique direction
    await k.clickEl(ROW('Square pocket'), 'left', 300, -20);
    await k.settle();
    await command('Linear pattern');
    await k.waitUi(`!!${SELECT('dir')}`, 'the Linear pattern editor');
    await k.settle();
    await rec.wait(1200);
    await k.choose(SELECT('dir'), '/Direction vector/', 600);
    await k.waitUi(`!!${FIELD('dir.y')}`, 'the direction vector fields');
    await rec.wait(900);
    await k.snap('21d-vec');
    await setField('dir.y', '-1', 1800);
    await k.snap('21e-oblique');
    k.log('vector set');
    await k.clickEl(OK, 'left', 300);
    await k.waitUi(`!${SELECT('dir')}`, 'the pattern');
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 760, 640), 100, false);
    await rec.wait(1800);
    rec.mark('poster');
    await rec.wait(900);
    await k.snap('21f-end');
    k.log('done');
    if (process.env.CLIP_DRY) return { id: 'pattern-axes', dry: true };
    return rec.finish('pattern-axes', ctx.outDir, ctx.posterDir);
  },
};
