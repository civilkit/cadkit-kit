// One scrolling list for the selection (0.8.3): an 80 x 50 x 10 plate with eight drilled holes (28 edges), every edge selected (the Selection tray lists them in its
// own scrolling box), then Fillet opens: the tray steps aside and the editor's edge field shows the same list, which scrolls inside its box, fills on hover (the
// edge lights in the view) and has Clear. The part is made from numbers in this file. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const part = () => {
  const holes = []; const pts = [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -40, y: -25 }, { id: 'p2', x: 40, y: -25 }, { id: 'p3', x: 40, y: 25 }, { id: 'p4', x: -40, y: 25 }];
  const ents = [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b }));
  let n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { n++; pts.push({ id: 'h' + n, x: -30 + i * 20, y: -12 + j * 24 }); ents.push({ id: 'c' + n, type: 'circle', c: 'h' + n, r: 5 }); }
  return newDoc('Drilled plate', [
    { type: 'sketch', id: 'F1', name: 'Outline', plane: { kind: 'std', id: 'top' }, points: pts, entities: ents, constraints: [] },
    { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 10 },
  ]);
};
const LIST = `document.querySelector('[data-path="edges"] .chips')`;

export default {
  id: 'selection-list',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, part());
    const k = kit(rec, ctx);
    const command = async (name) => {
      await k.key('f');
      await k.waitUi(`!!document.querySelector('[role=dialog] input, .cmdk input, input[placeholder*="Search"]')`, 'the command search');
      await k.step(() => page.send('Input.insertText', { text: name }), 900);
      await k.step(() => page.key('Enter'), 300);
      await k.settle();
    };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click()`); await k.settle();
    await k.snap('43a-view');
    await rec.begin();
    rec.x = 900; rec.y = 640;
    await rec.wait(1400);
    // ---- every edge selected: the tray lists them
    await k.key('e');
    await k.key('a', { ctrl: true });
    await k.settle();
    await k.snap('43b-selected');
    rec.mark('poster');
    await rec.wait(2600);
    // ---- Fillet: the editor's edge field shows the same list; the tray steps aside
    await command('Fillet');
    await k.waitUi(`!!${LIST}`, 'the edge list', 30000);
    await k.settle();
    await k.snap('43c-editor');
    await k.glide(1000, 700, 4);
    await rec.wait(1800);
    // hover chips down the list (the edge lights in the view), then scroll it
    const box = await k.rect(LIST);
    const chip = async (i) => k.rect(`${LIST}.querySelectorAll('.chip')[${i}]`);
    for (const i of [1, 3]) { const c = await chip(i); await k.glide(c.x - 30, c.y, 3); await rec.wait(900); }
    await k.snap('43d-hover');
    for (const top of [90, 200, 400]) {
      await k.step(() => page.eval(`${LIST}.scrollTop = ${top}; 0`), 900);
    }
    await k.snap('43e-scrolled');
    await k.step(() => page.eval(`${LIST}.scrollTop = 0; 0`), 600);
    // Clear
    await k.clickEl(`[...document.querySelectorAll('[data-path="edges"] button')].find((b) => /^clear$/i.test(b.textContent.trim()))`, 'left', 300);
    await k.settle();
    await k.glide(1000, 700, 3);
    await k.snap('43f-cleared');
    await rec.wait(2200);
    if (process.env.CLIP_DRY) return { id: 'selection-list', dry: true };
    return rec.finish('selection-list', ctx.outDir, ctx.posterDir);
  },
};
