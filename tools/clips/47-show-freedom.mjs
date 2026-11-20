// Show freedom and Show constraints in a sketch (0.8.4): a rectangle with one dimension and a free circle; Show freedom turns what can still move amber and the
// badge's popover lists it with chips that pin it; one chip is clicked. Show constraints (Shift+C) then draws every symbol and dimension, and a hover over a point lists
// its constraints. The sketch is made from numbers in this file. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const TID = (id) => `document.querySelector('[data-testid="${id}"]')`;
const part = () => newDoc('Plate', [
  { type: 'sketch', id: 'F1', name: 'Outline', plane: { kind: 'std', id: 'front' },
    points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -30, y: -20 }, { id: 'p2', x: 30, y: -20 }, { id: 'p3', x: 30, y: 20 }, { id: 'p4', x: -30, y: 20 }, { id: 'c', x: 5, y: 3 }, { id: 'q1', x: -20, y: -8 }, { id: 'q2', x: -5, y: -8 }],
    entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })).concat([{ id: 'k1', type: 'circle', c: 'c', r: 8 }, { id: 'e5', type: 'line', p1: 'q1', p2: 'q2' }]),
    constraints: [{ id: 'c1', type: 'horizontal', refs: ['e1'] }, { id: 'c2', type: 'vertical', refs: ['e2'] }, { id: 'c3', type: 'horizontal', refs: ['e3'] }, { id: 'c4', type: 'vertical', refs: ['e4'] }, { id: 'c5', type: 'hdist', refs: ['p1', 'p2'], value: 60 }, { id: 'c6', type: 'horizontal', refs: ['e5'] }] },
  { type: 'sketch', id: 'F2', name: 'Spare', plane: { kind: 'std', id: 'right' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'a', x: 90, y: 90 }], entities: [{ id: 'k', type: 'circle', c: 'a', r: 2 }], constraints: [] },
]);

export default {
  id: 'show-freedom',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, part(), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    await page.eval(`document.querySelector('.tree .row[data-id="F1"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 0`);
    await k.waitUi(`!!document.querySelector('[data-action="sketch-ok"]')`, 'the sketch');
    await k.settle();
    await k.clickEl(`document.querySelector('[data-action="look-normal"]')`, 'left', 300).catch(() => {});
    await k.settle();
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('47a-sketch');
    await rec.begin();
    rec.x = 900; rec.y = 640;
    await rec.wait(1800);
    // ---- Show freedom: what can still move turns amber
    await k.clickEl(`document.querySelector('[data-action="show-freedom"]')`, 'left', 500);
    await k.settle(800);
    await k.glide(900, 660, 3);
    await k.snap('47c-freedom');
    rec.mark('poster');
    await rec.wait(2200);
    // ---- the badge lists it, with chips that pin it
    await k.clickEl(`document.querySelector('.dof-chip')`, 'left', 900);
    await k.waitUi(`!!document.querySelector('.sketch-free .free-chip')`, 'the free list');
    await k.snap('47d-list');
    await rec.wait(3500);
    const chip = `[...document.querySelectorAll('.sketch-free .free-chip')].find((c) => /Fix position|At origin|Radius/.test(c.textContent)) || document.querySelector('.sketch-free .free-chip')`;
    await k.clickEl(chip, 'left', 300);
    await k.waitUi(`!!document.querySelector('.dim-box input, input[aria-label="Value"], [aria-label="Value"]')`, 'the value box').catch(() => {});
    await k.snap('47e-value');
    await rec.wait(1600);
    await k.step(() => page.key('Enter'), 300);
    await k.settle(800);
    await k.glide(1100, 700, 3);
    await k.snap('47f-pinned');
    await rec.wait(2400);
    // ---- Show constraints (Shift+C): off, then on again, with every symbol and dimension
    await k.clickEl(`document.querySelector('.dof-chip')`, 'left', 500);
    await k.glide(1100, 700, 3);
    await k.click(1100, 330, 'left', 300);
    await k.key('C', { shift: true });
    await k.settle(600);
    await k.snap('47g-off');
    await rec.wait(1800);
    await k.key('C', { shift: true });
    await k.settle(600);
    await k.snap('47g-on');
    await rec.wait(2600);
    // a hover over a point lists its constraints
    await k.glide(470, 532, 5);
    await rec.wait(400);
    await k.snap('47h-hover');
    await rec.wait(3200);
    if (process.env.CLIP_DRY) return { id: 'show-freedom', dry: true };
    return rec.finish('show-freedom', ctx.outDir, ctx.posterDir);
  },
};
