// Knit surfaces into a solid (0.8.5). The part starts as the open side wall of a 20 mm tall, 20 mm wide cylinder (a Surface extrude of a circle) with two plain circle sketches
// at its ends, all made from numbers. One caption per step: a Planar surface closes the bottom, a Planar surface closes the top, then Knit with Make a solid sews the three
// surface bodies along their shared edges into one solid; the status bar stays on Errors 0 and the Inspect tab shows the volume (a surface body has none).
// Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const FEATURES = [
  { type: 'plane', id: 'PT', mode: 'frame', origin: [0, 20, 0], xDir: [1, 0, 0], yDir: [0, 0, 1] },
  { type: 'sketch', id: 'S1', name: 'Bottom circle', plane: { kind: 'std', id: 'top' }, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 10 }], constraints: [] },
  { type: 'sketch', id: 'S2', name: 'Top circle', plane: { kind: 'feature', id: 'PT' }, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 10 }], constraints: [] },
  { type: 'surfaceExtrude', id: 'W1', name: 'Side wall', sketch: 'S1', end: 'blind', depth: 20 },
];

export default {
  id: 'surface-knit',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Surface knit', FEATURES), { workspace: null });
    await page.eval(`document.querySelector('.start-close')?.click(); 0`);
    const k = kit(rec, ctx);
    const CARD = `document.querySelector('[data-testid=editor-card]')`;
    const tab = (name) => k.clickEl(`[...document.querySelectorAll('[role=tab], .tab, button')].find((e) => e.textContent.trim() === '${name}')`, 'left', 600);
    const tool = async (id) => {
      await k.clickEl(`document.querySelector('[data-testid="cmd-${id}"]')`, 'left', 500);
      await k.glide(1050, 640, 3);   // off the ribbon at once, so no "not available" tooltip is left over the tree
      await k.waitUi(`!!${CARD}`, 'the editor card', 60000);
      await k.settle();
    };
    const toasts = `document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`;
    await page.eval(`document.querySelector('button[aria-label="Fit"]')?.click(); 0`);
    await k.settle();
    await k.snap('53a-start');
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await k.caption('This surface is a wall with open ends: it has no volume, so it is not a solid yet.');
    await rec.wait(3400);
    await tab('Surfaces');
    const away = () => k.glide(1050, 640, 4);
    const confirm = async () => { await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 700); await k.settle(); };
    const leftTab = (id) => k.clickEl(`document.querySelector('[data-testid="left-tab-${id}"]')`, 'left', 900);
    // ---- 1. close the top
    await k.caption('Pick the top circle in the tree', 1);
    await k.clickEl(k.row(/^Top circle|^S2/), 'left', 900);
    await k.settle();
    await k.caption('Planar surface: a flat disc across the circle closes the top', 1);
    await tool('add-surface-planar');
    await page.eval(toasts);
    await away();
    await k.snap('53b-top');
    await rec.wait(2600);
    await confirm();
    await rec.wait(800);
    // ---- 2. close the bottom (turn the view to see the underside first)
    await k.caption('Turn the view to see the underside, and pick the bottom circle', 2);
    await k.drag(1000, 480, 1000, 570, 6);
    await rec.wait(900);
    await k.clickEl(k.row(/^Bottom circle|^S1/), 'left', 900);
    await k.settle();
    await k.caption('Planar surface again: a second flat disc closes the bottom', 2);
    await tool('add-surface-planar');
    await page.eval(toasts);
    await away();
    await k.snap('53c-bottom');
    await rec.wait(2600);
    await confirm();
    await k.drag(1000, 570, 1000, 470, 6);
    await rec.wait(800);
    // ---- the three bodies
    await k.caption('Bodies tab: three separate surface bodies', 2);
    await leftTab('Bodies');
    await k.snap('53d-three');
    await rec.wait(3200);
    await leftTab('Features');
    // ---- 3. Knit
    await k.caption('Knit: sew the three surfaces together along their shared edges', 3);
    await tool('add-knit');
    for (let i = 0; i < 3; i++) {
      const box = `[...${CARD}.querySelectorAll('[data-section] input[type=checkbox]')].filter((e) => !e.closest('[data-path]'))[${i}] || [...${CARD}.querySelectorAll('input[type=checkbox]')][${i}]`;
      const on = await page.eval(`!!(${box}).checked`);
      if (!on) await k.clickEl(box, 'left', 500);
    }
    await away();
    await rec.wait(1400);
    await k.caption('Tick Make a solid: the closed skin becomes a solid body', 4);
    await k.clickEl(`${CARD}.querySelector('[data-path="solid"] input') || [...${CARD}.querySelectorAll('input[type=checkbox]')].at(-1)`, 'left', 600);
    await k.settle();
    await page.eval(toasts);
    await away();
    await k.snap('53e-knit');
    rec.mark('poster');
    await rec.wait(2600);
    await confirm();
    await k.snap('53f-solid');
    await k.caption('One solid body: 6.3 cm³ of volume, and Errors 0', '');
    await leftTab('Bodies');
    await k.snap('53g-bodies');
    await rec.wait(3000);
    await k.drag(1000, 575, 1000, 530, 4);
    await rec.wait(800);
    await k.drag(900, 560, 1060, 580, 10);
    await rec.wait(2000);
    await k.snap('53h-orbit');
    if (process.env.CLIP_DRY) return { id: 'surface-knit', dry: true };
    return rec.finish('surface-knit', ctx.outDir, ctx.posterDir);
  },
};
