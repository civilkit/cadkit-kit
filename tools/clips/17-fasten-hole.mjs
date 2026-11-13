// "Fasten this hole": a plate with four identical M5 holes; right-click a hole wall, Add fastener to hole, the dialog matches the size, the
// length comes out automatic, add washers and a nut, the identical-holes box is ticked, apply, then turn the view a little: a bolt in every hole.
// Made load-tolerant (see clipkit.mjs): each action runs inside rec.skip and the clip holds for fixed times between them.
import { openDoc, kit } from './clipkit.mjs';
import { rectSketch, newDoc } from '../doc_shots_defs.mjs';

/** A 70 x 44 x 12 plate with four M5 clearance holes near the corners. */
export const plateDoc = () => {
  const plate = rectSketch('F1', 'Plate outline', 'front', 70, 44, { cx: -35, cy: -22 });
  const pts = [['h1', -24, -12], ['h2', 24, -12], ['h3', 24, 12], ['h4', -24, 12]];
  const holes = { type: 'sketch', id: 'F3', name: 'Hole centres', plane: { kind: 'face', id: 'F2.C1' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, ...pts.map(([id, x, y]) => ({ id, x, y }))], entities: pts.map(([id], i) => ({ id: 'e' + (i + 1), type: 'point', p: id })), constraints: [] };
  return newDoc('Plate', [plate, { type: 'extrude', id: 'F2', name: 'Plate', op: 'add', sketch: 'F1', end: 'blind', depth: 12 }, holes,
    { type: 'hole', id: 'F4', name: 'Mounting holes', sketch: 'F3', kind: 'simple', standard: 'iso', size: 'M5', fit: 'normal', end: 'through' }]);
};
const SELECT = (n) => `document.querySelectorAll('.tree-wrap select')[${n}]`;   // Bolt, Size, Washer, Nut

export default {
  id: 'fasten-hole',
  async run(rec, ctx) {
    const { page } = ctx;
    await ctx.openApp();
    await openDoc(ctx, plateDoc());
    const k = kit(rec, ctx);
    k.log('loaded');
    await rec.begin();
    rec.x = 760; rec.y = 560;
    await rec.wait(1600);
    // ---- right-click the wall of a hole in the view
    await k.rightClick(871, 368, 1500);
    await k.snap('17a-menu');
    k.log('menu');
    await k.clickEl(k.menuItem('/^Add fastener to hole$/'), 'left', 300);
    await k.waitUi(`!!document.querySelector('.tree-wrap select')`, 'the dialog');
    await rec.wait(3600);                          // the size matched to the bore, the length automatic
    await k.snap('17b-dialog');
    k.log('dialog');
    // ---- washers and a nut
    await k.choose(SELECT(2), '/^Under the head$/', 1500);
    await k.choose(SELECT(3), '/^Hex nut/', 1800);
    await k.snap('17c-options');
    // ---- the identical holes, ticked by default: the pointer points at the box
    const cb = await k.rect(`document.querySelector('.tree-wrap input[type=checkbox][checked], .tree-wrap input[type=checkbox]:checked')`);
    await k.glide(cb.x + 40, cb.y, 3);
    await rec.wait(2400);
    k.log('options');
    // ---- apply
    await k.clickEl(`[...document.querySelectorAll('.tree-wrap button')].find((b) => /^Add fasteners/.test(b.textContent.trim()))`, 'left', 300);
    await k.waitUi(`!document.querySelector('.tree-wrap select') && /Fastener/i.test(document.querySelector('.tree')?.textContent || '')`, 'the fasteners to be added');
    await k.step(() => page.mouse('mouseMoved', 760, 600), 100, false);
    await rec.wait(1500);
    await k.snap('17d-added');
    k.log('added');
    // ---- turn the view a little, so the bolts show in every hole
    await k.drag(700, 600, 770, 560, 8);
    await rec.wait(1200);
    rec.mark('poster');
    await k.drag(770, 560, 690, 590, 8);
    await rec.wait(2600);
    await k.snap('17e-end');
    k.log('done');
    if (process.env.CLIP_DRY) return { id: 'fasten-hole', dry: true };
    return rec.finish('fasten-hole', ctx.outDir, ctx.posterDir);
  },
};
