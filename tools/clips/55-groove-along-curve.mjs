// Groove along a curve on a face (0.8.5). The part is a 40 x 20 x 10 mm block, a sketch 15 mm above it with a straight line and a quarter arc, and a small circle (the profile)
// standing at the start of the groove, all made from numbers. One caption per step: the sketch is picked, Composite curve joins the line and the arc, Project curve (the new curve
// and the top face picked first) lays that curve on the face, and Sweep with Cut runs the circle along it, which cuts a groove. The view turns at the end. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const front = { kind: 'std', id: 'front' };
const rect = (id, pts) => pts.map((_, i) => ({ id: 'e' + (i + 1), type: 'line', p1: 'p' + (i + 1), p2: 'p' + (((i + 1) % pts.length) + 1) }));
const BLOCK = [[0, 0], [40, 0], [40, 20], [0, 20]];
const FEATURES = [
  { type: 'sketch', id: 'S1', name: 'Block outline', plane: front, points: BLOCK.map(([x, y], i) => ({ id: 'p' + (i + 1), x, y })), entities: rect('S1', BLOCK), constraints: [] },
  { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'S1', end: 'blind', depth: 10 },
  { type: 'plane', id: 'PS2', mode: 'offset', base: front, offset: 25 },
  { type: 'sketch', id: 'S2', name: 'Line and arc', plane: { kind: 'feature', id: 'PS2' }, points: [{ id: 'a', x: 5, y: 5 }, { id: 'b', x: 20, y: 5 }, { id: 'c', x: 20, y: 10 }, { id: 'd', x: 25, y: 10 }],
    entities: [{ id: 'e1', type: 'line', p1: 'a', p2: 'b' }, { id: 'e2', type: 'arc', c: 'c', p1: 'b', p2: 'd' }], constraints: [] },
  { type: 'plane', id: 'PG', mode: 'frame', origin: [5, 5, 10], xDir: [0, 1, 0], yDir: [0, 0, 1] },
  { type: 'sketch', id: 'S9', name: 'Groove profile', plane: { kind: 'feature', id: 'PG' }, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 1.5 }], constraints: [] },
];

export default {
  id: 'groove-along-curve',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Groove along a curve', FEATURES), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const CARD = `document.querySelector('[data-testid=editor-card]')`;
    const tab = (name) => k.clickEl(`[...document.querySelectorAll('[role=tab], .tab, button')].find((e) => e.textContent.trim() === '${name}')`, 'left', 600);
    const tool = async (id) => {
      await k.clickEl(`document.querySelector('[data-testid="cmd-${id}"]')`, 'left', 500);
      await k.glide(1050, 640, 3);
      await k.waitUi(`!!${CARD}`, 'the editor card', 60000);
      await k.settle();
    };
    const toasts = `document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`;
    const confirm = async () => { await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 700); await k.settle(); };
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.zoom(900, 560, -3);
    await k.settle();
    await k.snap('55a-start');
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await k.caption('A block, a sketch above it with a line and an arc, and a small circle. We will cut a groove along the line and arc.');
    await rec.wait(3600);
    await tab('Features');
    await k.caption('Pick the sketch with the line and the arc', 1);
    await k.clickEl(k.row(/^Line and arc|^S2/), 'left', 900);
    await k.settle();
    await k.caption('Composite curve: join the line and the arc into one curve', 2);
    await tool('add-composite-curve');
    await page.eval(toasts);
    await k.snap('55b-composite');
    await rec.wait(2600);
    await confirm();
    await rec.wait(1000);
    await k.caption('Pick the new curve in the tree', 3);
    await k.clickEl(k.row(/^Composite curve/), 'left', 900);
    await k.settle();
    await k.caption('Click the front face of the block to say where the curve goes', 3);
    await k.click(800, 400, 'left', 1200);
    await k.settle();
    await k.snap('55c-picked');
    await k.caption('Project curve: drop the curve straight down onto that face', 3);
    await tool('add-project-curve');
    await page.eval(toasts);
    await k.snap('55d-project');
    await rec.wait(2800);
    await confirm();
    await k.caption('The curve now lies on the face of the block', 3);
    await k.snap('55e-projected');
    await rec.wait(2400);
    // ---- sweep with cut
    await k.caption('Pick the small circle, the shape of the groove', 4);
    await k.clickEl(`(${k.row(/^Groove profile|^S9/)}).querySelector('.row-name')`, 'left', 900);
    await k.settle();
    await tab('Home');
    await k.caption('Sweep with Cut: move the circle along the projected curve', 4);
    await k.clickEl(`document.querySelector('[data-slot=loft-sweep] .slot-more')`, 'left', 700);
    await tool('add-sweep');
    await page.eval(toasts);
    const SELS = `[...${CARD}.querySelectorAll('select')]`;
    await k.choose(`${SELS}.find((s) => s.dataset.path === 'path')`, /Project curve/, 900);
    await k.choose(`${SELS}.find((s) => [...s.options].some((o) => o.value === 'cut'))`, /^Cut/, 900);
    await page.eval(toasts);
    await k.snap('55f-sweep');
    rec.mark('poster');
    await rec.wait(3000);
    await confirm();
    await page.eval(toasts);
    await k.caption('A groove now runs along the face, following the curve', 4);
    await k.snap('55g-done');
    await rec.wait(2600);
    await k.zoom(1150, 700, -3);
    await rec.wait(1000);
    await k.drag(960, 230, 900, 250, 8);
    await rec.wait(900);
    await k.drag(900, 250, 980, 270, 8);
    await rec.wait(2600);
    await k.snap('55h-orbit');
    if (process.env.CLIP_DRY) return { id: 'groove-along-curve', dry: true };
    return rec.finish('groove-along-curve', ctx.outDir, ctx.posterDir);
  },
};
