// Sweep a surface along an offset curve (0.8.5). The part is two sketches made from numbers: a small circle (the profile) and a quarter arc (the path), with the
// circle sitting 1 mm inside the arc. One caption per step: Offset curve moves the arc 1 mm in (it is picked in the tree first), Sweep surface follows that curve with
// the circle, Cap the ends closes the tube, then the view turns so the surface can be seen from all sides. A surface body is a skin with no volume.
// Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { newDoc } from '../doc_shots_defs.mjs';

const front = { kind: 'std', id: 'front' };
const FEATURES = [
  { type: 'plane', id: 'PS3', mode: 'frame', origin: [5, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1] },
  { type: 'sketch', id: 'S3', name: 'Circle', plane: { kind: 'feature', id: 'PS3' }, points: [{ id: 'c', x: 0, y: 0 }], entities: [{ id: 'k', type: 'circle', c: 'c', r: 1.5 }], constraints: [] },
  { type: 'sketch', id: 'S4', name: 'Arc', plane: front, points: [{ id: 'c', x: 0, y: 0 }, { id: 'a', x: 6, y: 0 }, { id: 'b', x: 0, y: 6 }], entities: [{ id: 'k', type: 'arc', c: 'c', p1: 'a', p2: 'b' }], constraints: [] },
];

export default {
  id: 'surface-sweep',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, newDoc('Surface sweep', FEATURES), { workspace: null });
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
    await k.zoom(817, 392, -17, 240);
    await k.settle();
    await k.snap('52a-start');
    await rec.begin();
    rec.x = 900; rec.y = 560;
    await k.caption('A circle and an arc. We will sweep the circle along the arc.');
    await rec.wait(3200);
    // ---- 1. Offset curve
    await k.caption('Pick the arc in the tree', 1);
    await k.clickEl(k.row(/^Arc|^S4/), 'left', 900);
    await k.settle();
    await tab('Features');
    await k.caption('Offset curve: make a copy of the arc, 1 mm inside', 1);
    await tool('add-offset-curve');
    await page.eval(`document.querySelectorAll('.toast button').forEach((b) => b.click()); 0`);
    await rec.wait(1200);
    const dist = `${CARD}.querySelector('[data-path="distance"] input')`;
    await k.clickEl(dist, 'left', 400);
    await k.step(() => page.eval(`(${dist}).select(); 0`), 200, false);
    await k.typeOut('-1', 300);
    await k.step(() => page.key('Tab'), 300);
    await k.settle();
    await k.snap('52b-offset');
    await rec.wait(2600);
    await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.snap('52c-offset-done');
    await rec.wait(1800);
    // ---- 2. Sweep surface along the offset curve
    await k.caption('Sweep surface: move the circle along the new curve to make a tube', 2);
    await tab('Surfaces');
    await tool('add-sweep-surface');
    await k.choose(`${CARD}.querySelector('[data-path="path"] select') || [...${CARD}.querySelectorAll('select')][1]`, /Offset curve/, 900);
    await page.eval(toasts);
    await k.snap('52d-sweep');
    await rec.wait(3000);
    // ---- 3. Cap the ends
    await k.caption('Cap the ends: flat faces seal the tube into a closed shell', 3);
    await k.clickEl(`${CARD}.querySelector('[data-path="caps"] input')`, 'left', 600);
    await k.settle();
    await page.eval(toasts);
    await k.glide(1000, 640, 4);
    await k.snap('52e-caps');
    rec.mark('poster');
    await rec.wait(2600);
    await k.clickEl(`${CARD}.querySelector('.fedit-confirm')`, 'left', 700);
    await k.settle();
    await k.snap('52f-done');
    // ---- look round it
    await k.caption('This is a surface body: a skin with no thickness or volume yet', '');
    await rec.wait(1600);
    await k.drag(760, 560, 680, 520, 8);
    await rec.wait(900);
    await k.drag(680, 520, 800, 580, 10);
    await rec.wait(2400);
    await k.snap('52g-orbit');
    if (process.env.CLIP_DRY) return { id: 'surface-sweep', dry: true };
    return rec.finish('surface-sweep', ctx.outDir, ctx.posterDir);
  },
};
