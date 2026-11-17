// Heat-set seat (Unreleased): a plate with four round holes; right-click a hole wall, Heat-set seat, and the Heat-set insert panel opens with the insert at the hole's mouth, along its axis,
// in the size whose hole is nearest. The part is made from numbers in this file. Load-tolerant (see clipkit.mjs).
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

/** A 70 x 44 x 12 plate with four 5 mm holes near the corners (the part of the Fasten this hole clip). */
const plateDoc = () => {
  const plate = rectSketch('F1', 'Plate outline', 'front', 70, 44, { cx: -35, cy: -22 });
  const pts = [['h1', -24, -12], ['h2', 24, -12], ['h3', 24, 12], ['h4', -24, 12]];
  const holes = { type: 'sketch', id: 'F3', name: 'Hole centres', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map(([id, x, y]) => ({ id, x, y }))], entities: pts.map(([id], i) => ({ id: 'e' + (i + 1), type: 'point', p: id })), constraints: [] };
  return newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 12 }, holes,
    { type: 'hole', id: 'F4', name: 'Mounting holes', sketch: 'F3', kind: 'simple', standard: 'iso', size: 'M4', fit: 'normal', end: 'through' }]);
};

export default {
  id: 'heat-set-seat',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, plateDoc());
    const k = kit(rec, ctx);
    await k.snap('39a-view');
    await rec.begin();
    rec.x = 760; rec.y = 560;
    await rec.wait(1600);
    // ---- right-click the wall of a hole
    await k.rightClick(871, 368, 1500);
    await k.snap('39b-menu');
    try { await k.clickEl(k.menuItem('/^Heat-set seat$/'), 'left', 300); }
    catch (e) { await k.snap('39x-fail'); console.error(await page.eval(`document.querySelector('.ctx-menu')?.innerText`)); throw e; }
    try { await k.waitUi(`/Heat-set insert/i.test(document.body.innerText)`, 'the insert panel', 20000); }
    catch (e) { await k.snap('39x-fail'); throw e; }
    await k.step(() => page.eval(`document.activeElement?.blur?.(); 0`), 100, false);
    await k.glide(871, 368, 3);
    for (let i = 0; i < 8; i++) await k.step(() => page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 871, y: 368, deltaX: 0, deltaY: -240 }), 150);   // zoom in on the hole's mouth
    await k.glide(1000, 560, 3);
    await k.settle();
    await k.snap('39c-panel');
    await rec.wait(4200);   // read the panel; the insert sits at the hole's mouth
    rec.mark('poster');
    await k.drag(700, 600, 760, 560, 8);
    await rec.wait(2800);
    await k.snap('39d-end');
    if (process.env.CLIP_DRY) return { id: 'heat-set-seat', dry: true };
    return rec.finish('heat-set-seat', ctx.outDir, ctx.posterDir);
  },
};
