// Frozen pose (0.8.8): a reference plane sits 6 mm above the top face of a block, a circle sketch is on the plane and a boss is extruded from it. Delete the
// block: the notice offers "Keep dependents in place", the plane holds its last known position (marked in the History) and the boss keeps building; then the
// plane is opened and reattached to the Top plane from its Base plane box. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

const doc = () => newDoc('Boss on block', [
  rectSketch('F1', 'Block outline', 'top', 60, 40, { cx: -30, cy: -20 }),
  { type: 'extrude', id: 'F2', name: 'Block', op: 'add', sketch: 'F1', end: 'blind', depth: 20 },
  { type: 'plane', id: 'F3', name: 'Plane 1', mode: 'offset', base: { kind: 'face', id: 'F2.C1' }, offset: 6 },
  { type: 'sketch', id: 'F4', name: 'Boss circle', plane: { kind: 'feature', id: 'F3' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y: 0 }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 10 }], constraints: [] },
  { type: 'extrude', id: 'F5', name: 'Boss', op: 'add', sketch: 'F4', end: 'blind', depth: 12 },
]);
const ROW = (id) => `[...document.querySelectorAll('.row')].find((r) => r.querySelector('.row-id')?.textContent === '${id}')`;

export default {
  id: 'frozen-pose',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, doc());
    const k = kit(rec, ctx);
    const cap = async (text, n) => { await k.caption(text, n); await rec.skip(() => page.eval(`(() => { const e = document.getElementById('__cap'); e.style.left = '730px'; e.style.bottom = 'auto'; e.style.top = '100px'; e.style.maxWidth = '600px'; })()`)); await rec.paint(); };
    const hold = async (ms) => { for (let t = 0; t < ms; t += 500) await rec.wait(500); };
    await k.settle();
    await rec.begin();
    rec.x = 700; rec.y = 560;
    await cap('A plane above the block carries the sketch of a boss', 1);
    await hold(3500);
    await k.snap('61a-start');
    await cap('Delete the block: the plane depends on it', 2);
    await k.clickEl(`${ROW('F2')}?.querySelector('.row-name')`, 'left', 500);
    await k.clickEl(`${ROW('F2')}?.querySelector('.row-del')`, 'left', 300);
    await k.waitUi(`[...document.querySelectorAll('button')].some((b) => /keep dependents/i.test(b.textContent))`, 'the blocked-delete notice');
    await rec.paint();
    await k.snap('61b-notice');
    await hold(3800);
    await cap('Keep dependents in place', 3);
    await k.clickEl(`[...document.querySelectorAll('button')].find((b) => /keep dependents/i.test(b.textContent))`, 'left', 500);
    await k.waitUi(`!${ROW('F2')}`, 'the block to go');
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 700, 600), 100, false);
    await k.snap('61c-kept');
    rec.mark('poster');
    await cap('The plane holds its last position and is marked; the boss still builds', 4);
    await hold(6500);
    await cap('Open the plane to reattach it', 5);
    await k.step(() => page.eval(`(() => { const r = ${ROW('F3')}; r.querySelector('.row-edit').click(); })()`), 400);
    await k.waitUi(`!!document.querySelector('[data-note="detached"]')`, 'the reattach note');
    await k.settle();
    await k.snap('61d-editor');
    await hold(4500);
    await cap('Pick a live Base plane: Top Plane', 6);
    await k.choose(`document.querySelector('[data-path="base"] select')`, '/Top Plane/', 1500);
    await k.snap('61e-select');
    await hold(3000);
    await cap('Confirm: the warning is gone and the plane follows its base again', 7);
    await k.clickEl(`[...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title) === 'Confirm')`, 'left', 400);
    await k.waitUi(`!document.querySelector('[data-note="detached"]')`, 'the editor to close');
    await k.settle();
    await k.step(() => page.mouse('mouseMoved', 700, 620), 100, false);
    await k.snap('61f-done');
    await hold(5000);
    if (process.env.CLIP_DRY) return { id: 'frozen-pose', dry: true };
    return rec.finish('frozen-pose', ctx.outDir, ctx.posterDir);
  },
};
